/**
 * hooks/useChatModel.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Modelo de mensajería clínica interna con persistencia real en backend.
 *
 * Estrategia: Long Polling ligero
 *   - Al seleccionar un contacto: carga el historial completo (GET /api/chat/history/:peerId)
 *   - Mientras la conversación esté abierta: poll cada POLL_INTERVAL_MS para mensajes nuevos
 *   - Al enviar: POST /api/chat/send → actualización optimista + confirmación del servidor
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
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount: number;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: string;   // Hora formateada HH:MM para la UI
  createdAt: string;   // ISO8601 — usado como cursor para Long Polling incremental
  isRead: boolean;
}

// ── Helper: normalizar mensaje del backend → DirectMessage para la UI ────────
function normalizeMessage(raw: any): DirectMessage {
  const date = new Date(raw.createdAt);
  return {
    id:         raw.id,
    senderId:   raw.senderId,
    receiverId: raw.receiverId,
    content:    raw.content,
    timestamp:  date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
    createdAt:  raw.createdAt,
    isRead:     raw.read ?? false,
  };
}

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

  // Mantener ref sincronizada con estado (para usar dentro del setInterval sin closure stale)
  useEffect(() => {
    activeContactRef.current = activeContact;
  }, [activeContact]);

  // ── 1. Cargar colegas del backend ────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;

    const token = localStorage.getItem('mind_token');

    fetch(`${apiUrl}/users/colleagues`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: any[]) => {
        const mapped: ChatContact[] = data
          .filter((u) => u.id !== currentUser.id)
          .map((u) => ({
            id:              u.id,
            name:            u.name ?? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
            role:            u.role as UserRole,
            avatarUrl:       u.avatarUrl ?? u.profilePicture ?? undefined,
            online:          u.online ?? false,
            specialty:       u.specialty ?? undefined,
            lastMessage:     undefined,
            lastMessageTime: undefined,
            unreadCount:     0,
          }));
        setContacts(mapped);
        if (mapped.length > 0) {
          // Seleccionar el primer contacto automáticamente y arrancar polling
          handleSelectContact(mapped[0]);
        }
      })
      .catch((err) => {
        console.error('[useChatModel] Error al cargar colegas:', err);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // ── 2. Long Polling: arrancar/parar cuando cambia el contacto activo ─────
  useEffect(() => {
    // Limpiar intervalo anterior
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (!activeContact || !currentUser) return;

    // Iniciar Long Polling
    pollIntervalRef.current = setInterval(async () => {
      const contact = activeContactRef.current;
      if (!contact) return;

      const token = localStorage.getItem('mind_token');
      // Usar cursor incremental para pedir solo mensajes nuevos
      const sinceParam = lastMessageAt.current
        ? `?since=${encodeURIComponent(lastMessageAt.current)}`
        : '';

      try {
        const res = await fetch(`${apiUrl}/api/chat/history/${contact.id}${sinceParam}`, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (!res.ok) return; // No interrumpir el ciclo en errores transitorios

        const raw: any[] = await res.json();
        if (!Array.isArray(raw) || raw.length === 0) return;

        const newMsgs = raw.map(normalizeMessage);

        // --- INYECCIÓN: TOAST DE CHAT ---
        newMsgs.forEach((msg) => {
          // Si el mensaje NO es mío Y NO estoy viendo ese chat actualmente
          if (msg.senderId !== currentUser.id && msg.senderId !== activeContactRef.current?.id) {
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

          // Actualizar lastMessage del contacto en la lista lateral
          const lastMsg = fresh.at(-1);
          if (lastMsg) {
            setContacts((cs) =>
              cs.map((c) =>
                c.id === contact.id
                  ? { ...c, lastMessage: lastMsg.content, lastMessageTime: lastMsg.timestamp }
                  : c
              )
            );
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
  }, [activeContact?.id, currentUser]);

  // ── 3. Cargar historial completo al seleccionar un contacto ─────────────
  const handleSelectContact = useCallback(async (contact: ChatContact) => {
    setActiveContact(contact);
    setMessages([]);
    lastMessageAt.current = null;

    // Marcar como leídos en la lista de contactos
    setContacts((prev) =>
      prev.map((c) => (c.id === contact.id ? { ...c, unreadCount: 0 } : c))
    );

    const token = localStorage.getItem('mind_token');
    try {
      const res = await fetch(`${apiUrl}/api/chat/history/${contact.id}?limit=100`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        console.error(`[useChatModel] Error al cargar historial: HTTP ${res.status}`);
        return;
      }

      const raw: any[] = await res.json();
      if (!Array.isArray(raw)) return;

      const history = raw.map(normalizeMessage);
      setMessages(history);

      // Fijar cursor en el mensaje más reciente
      const latest = history.at(-1);
      if (latest) lastMessageAt.current = latest.createdAt;

    } catch (err) {
      console.error('[useChatModel] Error al cargar historial:', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  // ── 4. Enviar mensaje (optimista → persistencia real) ────────────────────
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || !activeContact || !currentUser || isSending) return;

    const token = localStorage.getItem('mind_token');
    const now   = new Date();

    // 4a. Actualización optimista en la UI
    const optimisticMsg: DirectMessage = {
      id:         `optimistic_${Date.now()}`,
      senderId:   currentUser.id,
      receiverId: activeContact.id,
      content:    content.trim(),
      timestamp:  now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      createdAt:  now.toISOString(),
      isRead:     false,
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
      const res = await fetch(`${apiUrl}/api/chat/send`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          receiverId: activeContact.id,
          content:    content.trim(),
        }),
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
        prev.map((m) => (m.id === optimisticMsg.id ? normalizeMessage(saved) : m))
      );

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

  // ── 5. Filtrar contactos por búsqueda ────────────────────────────────────
  const filteredContacts = contacts.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.specialty && c.specialty.toLowerCase().includes(searchQuery.toLowerCase()))
  );

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
  };
}
