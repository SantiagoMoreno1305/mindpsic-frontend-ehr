/**
 * hooks/useChatModel.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Modelo de mensajería clínica interna con persistencia real en backend.
 *
 * Basado en Conversation/ConversationParticipant (no en pares sender/receiver
 * sueltos): la bandeja de entrada (último mensaje + no leídos) la resuelve el
 * backend en una sola llamada — no se agrega nada en el cliente.
 *
 * Estrategia: Long Polling ligero
 *   - Al cargar: GET /chat/conversations trae el resumen real de cada chat.
 *   - Al seleccionar un contacto: si ya tiene conversationId, carga su
 *     historial (GET /chat/conversations/:id/messages). Si es la primera vez
 *     que le escribes, primero se hace find-or-create (POST /chat/conversations/direct).
 *   - Mientras la conversación esté abierta: poll cada POLL_INTERVAL_MS.
 *   - Al enviar: POST /chat/conversations/:id/messages → optimista + confirmación.
 *
 * No se usan WebSockets (se planifican para la fase 2 con Redis Pub/Sub).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { User, UserRole } from '../types';
import { toast } from 'react-hot-toast';

// ── Intervalo del Long Polling (ms) ─────────────────────────────────────────
const POLL_INTERVAL_MS = 4000; // 4 segundos — balance entre latencia y carga del servidor

// ── Tipos exportados ─────────────────────────────────────────────────────────
export interface ChatContact {
  id: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  online: boolean;
  specialty?: string;
  conversationId?: string;   // undefined = todavía no existe conversación con esta persona
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount: number;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  content: string | null;
  timestamp: string;   // Hora formateada HH:MM para la UI
  createdAt: string;   // ISO8601 — usado como cursor para Long Polling incremental
  // Adjunto (documento o foto) — undefined si el mensaje es solo texto
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  downloadUrl?: string; // URL firmada de S3, regenerada en cada carga del historial
}

interface ConversationSummary {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  participants: Array<{ id: string; name: string; role: UserRole; specialty?: string }>;
}

// ── Caché de URLs firmadas persistente (sessionStorage) ───────────────────────
// El backend firma una URL nueva de S3 en cada respuesta. Si la aceptáramos
// tal cual siempre, la URL cambiaría en cada poll/recarga y el navegador
// nunca podría cachear la imagen/avatar (la URL es la clave de caché HTTP).
//
// Un useRef normal no alcanza: se pierde cada vez que el componente se
// desmonta, y eso pasa cada vez que sales de la pestaña de Mensajería
// (InternalChat se renderiza condicionalmente). sessionStorage sobrevive a
// eso — solo se limpia al cerrar la pestaña del navegador — así que salir y
// volver a entrar a Mensajería no vuelve a descargar lo que ya se vio.
interface CachedUrl { url: string; expiresAt: number }

function loadPersistedUrlCache(storageKey: string): Map<string, CachedUrl> {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, CachedUrl>));
  } catch {
    return new Map();
  }
}

function persistUrlCache(storageKey: string, cache: Map<string, CachedUrl>) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // sessionStorage lleno o no disponible (ej. modo incógnito) — no crítico,
    // solo se pierde la optimización, el chat sigue funcionando igual.
  }
}

// Resuelve una URL estable para `key`: si ya hay una vigente en caché, la
// reutiliza tal cual; si no, guarda la nueva recibida. Los TTL se mantienen
// por debajo de la vigencia real firmada en el backend (ver s3.service.js)
// para nunca reutilizar una URL que ya expiró del lado de S3.
function resolveCachedUrl(
  key: string,
  rawUrl: string | null | undefined,
  cache: Map<string, CachedUrl>,
  ttlMs: number,
): string | undefined {
  if (!rawUrl) return undefined;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  cache.set(key, { url: rawUrl, expiresAt: Date.now() + ttlMs });
  return rawUrl;
}

const CHAT_MESSAGE_URL_CACHE_KEY = 'mind_chat_msg_url_cache_v1';
const DOWNLOAD_URL_CACHE_TTL_MS  = (6 * 60 - 15) * 60 * 1000; // 5h45min (< 6h firmadas en backend)

const AVATAR_URL_CACHE_KEY      = 'mind_chat_avatar_url_cache_v1';
const AVATAR_URL_CACHE_TTL_MS   = (24 * 60 - 30) * 60 * 1000; // 23h30min (< 24h firmadas en backend)

// ── Helper: normalizar mensaje del backend → DirectMessage para la UI ────────
function normalizeMessage(raw: any, urlCache?: Map<string, CachedUrl>): DirectMessage {
  const date = new Date(raw.createdAt);
  const downloadUrl = urlCache
    ? resolveCachedUrl(raw.id, raw.downloadUrl, urlCache, DOWNLOAD_URL_CACHE_TTL_MS)
    : (raw.downloadUrl ?? undefined);

  return {
    id:          raw.id,
    senderId:    raw.senderId,
    content:     raw.content,
    timestamp:   date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
    createdAt:   raw.createdAt,
    fileName:    raw.fileName ?? undefined,
    fileType:    raw.fileType ?? undefined,
    fileSize:    raw.fileSize ?? undefined,
    downloadUrl,
  };
}

// Tamaño máximo de adjunto (documento/foto) — debe coincidir con el backend
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Hook principal ────────────────────────────────────────────────────────────
export function useChatModel(currentUser: User | null) {
  const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

  const [contacts, setContacts]           = useState<ChatContact[]>([]);
  const [activeContact, setActiveContact]  = useState<ChatContact | null>(null);
  const [messages, setMessages]            = useState<DirectMessage[]>([]);
  const [isTyping, setIsTyping]            = useState(false);
  const [searchQuery, setSearchQuery]      = useState('');
  const [isSending, setIsSending]          = useState(false);

  // Cursor incremental: ISO8601 del último mensaje recibido (evita cargar toda la historia en cada poll)
  const lastMessageAt   = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeContactRef = useRef<ChatContact | null>(null);
  // Caché de URLs estables (id -> url) persistida en sessionStorage — ver
  // resolveCachedUrl/persistUrlCache más arriba.
  const downloadUrlCacheRef = useRef<Map<string, CachedUrl>>(loadPersistedUrlCache(CHAT_MESSAGE_URL_CACHE_KEY));
  const avatarUrlCacheRef   = useRef<Map<string, CachedUrl>>(loadPersistedUrlCache(AVATAR_URL_CACHE_KEY));

  const authHeaders = useCallback((): HeadersInit => {
    const token = localStorage.getItem('mind_token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  // Mantener ref sincronizada con estado (para usar dentro del setInterval sin closure stale)
  useEffect(() => {
    activeContactRef.current = activeContact;
  }, [activeContact]);

  // ── 1. Cargar colegas + resumen real de conversaciones, y fusionarlos ───
  useEffect(() => {
    if (!currentUser) return;

    (async () => {
      try {
        const [colleaguesRes, conversationsRes] = await Promise.all([
          fetch(`${apiUrl}/users/colleagues`, { headers: authHeaders() }),
          fetch(`${apiUrl}/api/chat/conversations`, { headers: authHeaders() }),
        ]);

        if (!colleaguesRes.ok) throw new Error(`HTTP ${colleaguesRes.status}`);
        const colleagues: any[] = await colleaguesRes.json();
        const conversations: ConversationSummary[] = conversationsRes.ok ? await conversationsRes.json() : [];

        // Mapa peerId -> resumen de conversación DIRECT (solo 1-a-1 por ahora)
        const summaryByPeerId = new Map<string, ConversationSummary>();
        conversations
          .filter((c) => c.type === 'DIRECT' && c.participants.length === 1)
          .forEach((c) => summaryByPeerId.set(c.participants[0].id, c));

        const mapped: ChatContact[] = colleagues
          .filter((u) => u.id !== currentUser.id)
          .map((u) => {
            const summary = summaryByPeerId.get(u.id);
            return {
              id:              u.id,
              name:            u.name ?? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
              role:            u.role as UserRole,
              avatarUrl:       resolveCachedUrl(u.id, u.avatarUrl ?? u.profilePicture, avatarUrlCacheRef.current, AVATAR_URL_CACHE_TTL_MS),
              online:          u.online ?? false,
              specialty:       u.specialty ?? undefined,
              conversationId:  summary?.id,
              lastMessage:     summary?.lastMessagePreview ?? undefined,
              lastMessageTime: summary?.lastMessageAt
                ? new Date(summary.lastMessageAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
                : undefined,
              unreadCount:     summary?.unreadCount ?? 0,
            };
          });

        // No se auto-selecciona ningún contacto — el usuario elige con quién
        // empezar desde la lista (antes se abría el primero automáticamente).
        setContacts(mapped);
        persistUrlCache(AVATAR_URL_CACHE_KEY, avatarUrlCacheRef.current);
      } catch (err) {
        console.error('[useChatModel] Error al cargar colegas/conversaciones:', err);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // ── 2. Long Polling: arrancar/parar cuando cambia el contacto activo ─────
  useEffect(() => {
    // Limpiar intervalo anterior
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (!activeContact?.conversationId || !currentUser) return;

    // Iniciar Long Polling
    pollIntervalRef.current = setInterval(async () => {
      const contact = activeContactRef.current;
      if (!contact?.conversationId) return;

      // Usar cursor incremental para pedir solo mensajes nuevos
      const sinceParam = lastMessageAt.current
        ? `?since=${encodeURIComponent(lastMessageAt.current)}`
        : '';

      try {
        const res = await fetch(`${apiUrl}/api/chat/conversations/${contact.conversationId}/messages${sinceParam}`, {
          headers: authHeaders(),
        });

        if (!res.ok) return; // No interrumpir el ciclo en errores transitorios

        const raw: any[] = await res.json();
        if (!Array.isArray(raw) || raw.length === 0) return;

        const newMsgs = raw.map((m: any) => normalizeMessage(m, downloadUrlCacheRef.current));
        persistUrlCache(CHAT_MESSAGE_URL_CACHE_KEY, downloadUrlCacheRef.current);

        // --- INYECCIÓN: TOAST DE CHAT ---
        newMsgs.forEach((msg) => {
          // Si el mensaje NO es mío Y NO estoy viendo ese chat actualmente
          if (msg.senderId !== currentUser.id && contact.id !== activeContactRef.current?.id) {
            toast(`Nuevo mensaje recibido`, {
              icon: '💬',
              duration: 4000,
              position: 'top-right'
            });
          }
        });

        // Actualizar cursor al mensaje más reciente
        const latestCreatedAt = newMsgs.at(-1)?.createdAt;
        if (latestCreatedAt) lastMessageAt.current = latestCreatedAt;

        setMessages((prev) => {
          // Deduplicar por id para evitar duplicados por solape de fechas
          const existingIds = new Set(prev.map((m) => m.id));
          const fresh = newMsgs.filter((m) => !existingIds.has(m.id));
          if (fresh.length === 0) return prev;

          const lastMsg = fresh.at(-1);
          if (lastMsg) {
            setContacts((cs) => cs.map((c) =>
              c.id === contact.id
                ? { ...c, lastMessage: lastMsg.content, lastMessageTime: lastMsg.timestamp }
                : c
            ));
          }

          return [...prev, ...fresh];
        });
      } catch (err) {
        console.warn('[useChatModel][poll] Error en Long Polling (transitorio):', err);
      }
    }, POLL_INTERVAL_MS);

    // Cleanup al desmontar o cambiar contacto
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContact?.conversationId, currentUser]);

  // ── 3. Seleccionar contacto: resolver conversationId (find-or-create) + historial ──
  const handleSelectContact = useCallback(async (contact: ChatContact) => {
    setMessages([]);
    lastMessageAt.current = null;

    // Marcar como leído en la lista de contactos
    setContacts((prev) =>
      prev.map((c) => (c.id === contact.id ? { ...c, unreadCount: 0 } : c))
    );

    try {
      let conversationId = contact.conversationId;

      if (!conversationId) {
        // Primera vez que se le escribe a este colega — find-or-create
        const res = await fetch(`${apiUrl}/api/chat/conversations/direct`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ peerId: contact.id }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { conversation } = await res.json();
        conversationId = conversation.id;

        setContacts((prev) => prev.map((c) => (c.id === contact.id ? { ...c, conversationId } : c)));
      }

      setActiveContact({ ...contact, conversationId });

      const res = await fetch(`${apiUrl}/api/chat/conversations/${conversationId}/messages?limit=100`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        console.error(`[useChatModel] Error al cargar historial: HTTP ${res.status}`);
        return;
      }
      const raw: any[] = await res.json();
      if (!Array.isArray(raw)) return;

      const history = raw.map((m: any) => normalizeMessage(m, downloadUrlCacheRef.current));
      persistUrlCache(CHAT_MESSAGE_URL_CACHE_KEY, downloadUrlCacheRef.current);
      setMessages(history);

      const latest = history.at(-1);
      if (latest) lastMessageAt.current = latest.createdAt;

    } catch (err) {
      console.error('[useChatModel] Error al abrir la conversación:', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  // ── 4. Enviar mensaje (optimista → persistencia real) ────────────────────
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || !activeContact?.conversationId || !currentUser || isSending) return;

    const conversationId = activeContact.conversationId;
    const now = new Date();

    // 4a. Actualización optimista en la UI
    const optimisticMsg: DirectMessage = {
      id:        `optimistic_${Date.now()}`,
      senderId:  currentUser.id,
      content:   content.trim(),
      timestamp: now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      createdAt: now.toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setContacts((cs) =>
      cs.map((c) =>
        c.id === activeContact.id
          ? { ...c, lastMessage: content, lastMessageTime: optimisticMsg.timestamp }
          : c
      )
    );

    setIsSending(true);

    try {
      // 4b. Persistir en backend
      const res = await fetch(`${apiUrl}/api/chat/conversations/${conversationId}/messages`, {
        method:  'POST',
        headers: authHeaders(),
        body: JSON.stringify({ content: content.trim() }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.error('[useChatModel] Error al enviar mensaje:', errBody);
        // Revertir el optimistic update en caso de fallo
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
        return;
      }

      const { message: saved } = await res.json();

      // 4c. Reemplazar el optimistic con el mensaje real del servidor
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticMsg.id ? normalizeMessage(saved, downloadUrlCacheRef.current) : m))
      );
      persistUrlCache(CHAT_MESSAGE_URL_CACHE_KEY, downloadUrlCacheRef.current);

      // Actualizar cursor al mensaje enviado
      lastMessageAt.current = saved.createdAt;

    } catch (err) {
      console.error('[useChatModel] Error de red al enviar:', err);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
    } finally {
      setIsSending(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContact, currentUser, isSending, apiUrl]);

  // ── 4b. Enviar un adjunto (documento o foto) ──────────────────────────────
  //    1. Pide URL firmada de S3 → 2. Sube el archivo directo a S3 →
  //    3. Registra el mensaje con la metadata del archivo.
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  const sendAttachment = useCallback(async (file: File, caption?: string) => {
    if (!activeContact?.conversationId || !currentUser || isUploadingAttachment) return;

    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      toast.error(`El archivo supera el límite de ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB.`);
      return;
    }

    const conversationId = activeContact.conversationId;
    const now = new Date();

    // Actualización optimista: preview local mientras se sube
    const optimisticMsg: DirectMessage = {
      id:          `optimistic_${Date.now()}`,
      senderId:    currentUser.id,
      content:     caption?.trim() || null,
      timestamp:   now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      createdAt:   now.toISOString(),
      fileName:    file.name,
      fileType:    file.type,
      fileSize:    file.size,
      downloadUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    setIsUploadingAttachment(true);
    try {
      // 1. URL firmada de subida
      const uploadUrlRes = await fetch(`${apiUrl}/api/chat/conversations/${conversationId}/attachments/upload-url`, {
        method:  'POST',
        headers: authHeaders(),
        body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size }),
      });
      if (!uploadUrlRes.ok) {
        const errBody = await uploadUrlRes.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${uploadUrlRes.status}`);
      }
      const { url, s3Key } = await uploadUrlRes.json();

      // 2. Subida directa a S3 (no pasa por nuestro backend)
      // Cache-Control debe coincidir con el que el backend usó para firmar la
      // URL — un adjunto de chat nunca cambia, así que el navegador puede
      // cachearlo largo tiempo sin volver a pedirlo (ver s3.service.js).
      const s3Res = await fetch(url, {
        method:  'PUT',
        headers: {
          'Content-Type':  file.type,
          'Cache-Control': 'private, max-age=604800',
        },
        body: file,
      });
      if (!s3Res.ok) throw new Error('Error al subir el archivo a S3');

      // 3. Registrar el mensaje con la metadata del adjunto
      const res = await fetch(`${apiUrl}/api/chat/conversations/${conversationId}/messages`, {
        method:  'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          content:  caption?.trim() || undefined,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          s3Key,
        }),
      });
      if (!res.ok) throw new Error('Error al registrar el mensaje');

      const { message: saved } = await res.json();
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticMsg.id ? normalizeMessage(saved, downloadUrlCacheRef.current) : m))
      );
      persistUrlCache(CHAT_MESSAGE_URL_CACHE_KEY, downloadUrlCacheRef.current);
      lastMessageAt.current = saved.createdAt;

    } catch (err) {
      console.error('[useChatModel] Error al enviar adjunto:', err);
      toast.error('No se pudo enviar el archivo.');
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
    } finally {
      setIsUploadingAttachment(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContact, currentUser, isUploadingAttachment, apiUrl]);

  // ── 5. Filtrar y ordenar contactos ─────────────────────────────────────
  //    Prioridad: 1) chats con unread > 0 al tope, 2) por fecha de último mensaje desc
  const filteredContacts = contacts
    .filter((c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.specialty && c.specialty.toLowerCase().includes(searchQuery.toLowerCase()))
    )
    .sort((a, b) => {
      // 1. Unread primero
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
      // 2. Por último mensaje (más reciente primero)
      const timeA = a.lastMessageTime || '';
      const timeB = b.lastMessageTime || '';
      return timeB.localeCompare(timeA);
    });

  // ── 6. Conteo global de no leídos (para badge en sidebar) ──────────────
  const totalUnreadCount = contacts.reduce((sum, c) => sum + c.unreadCount, 0);

  return {
    contacts:      filteredContacts,
    activeContact,
    messages,
    isTyping,        // Mantenido por compatibilidad (no se simula respuesta automática)
    isSending,
    searchQuery,
    setSearchQuery,
    selectContact: handleSelectContact,
    sendMessage,
    sendAttachment,
    isUploadingAttachment,
    totalUnreadCount,
  };
}
