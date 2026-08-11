import React, { useState, useRef, useEffect } from 'react';
import { User, UserRole } from '../types';
import { useChatModel, MAX_ATTACHMENT_SIZE_BYTES } from '../hooks/useChatModel';
import { toast } from 'react-hot-toast';
import {
  Send,
  Search,
  MessageSquare,
  Lock,
  CheckCheck,
  AlertCircle,
  Network,
  User as UserIcon,
  Paperclip,
  FileText,
  Download,
  Loader2,
  Mic,
  X as XIcon,
} from 'lucide-react';

/** Formatea bytes a una unidad legible (KB/MB). */
function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Formatea segundos a mm:ss para el cronómetro de grabación. */
function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Descarga un adjunto sin exponer la URL firmada de S3 en la barra de
 * direcciones. En vez de navegar (`<a target="_blank">`), trae el archivo
 * con fetch y dispara la descarga desde un blob local — la pestaña nunca
 * sale del dominio de la app.
 */
async function downloadFile(url: string, fileName: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('[InternalChat] Error al descargar adjunto:', err);
    toast.error('No se pudo descargar el archivo.');
  }
}

// ── Etiquetas de rol para el banner del chat ─────────────────────────────────
const CHAT_ROLE_LABELS: Record<UserRole, string> = {
  CEO:              'CEO / Director',
  DIRECTIVO:        'Directivo',
  ESPECIALISTA_B2B: 'Psicólogo Clínico',
  OPERATIVO:        'Operativo / RRHH',
  USUARIO_B2C:      'Usuario / Paciente',
};

/** Devuelve la etiqueta de rol + especialidad (si aplica) para el banner. */
function getRoleLabel(role: UserRole, specialty?: string): string {
  const base = CHAT_ROLE_LABELS[role] ?? role;
  if (specialty && role === 'ESPECIALISTA_B2B') return `${base} • ${specialty}`;
  return base;
}

/** Genera iniciales a partir de un nombre (máx 2 letras) */
function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

/** Colores de avatar basados en el hash del nombre */
const AVATAR_COLORS = [
  'bg-indigo-500', 'bg-emerald-500', 'bg-rose-500', 'bg-amber-500',
  'bg-cyan-500', 'bg-violet-500', 'bg-teal-500', 'bg-pink-500',
  'bg-blue-600', 'bg-orange-500', 'bg-fuchsia-500', 'bg-lime-600'
];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface InternalChatProps {
  currentUser: User | null;
}

export default function InternalChat({ currentUser }: InternalChatProps) {
  const {
    contacts,
    activeContact,
    messages,
    isTyping,
    searchQuery,
    setSearchQuery,
    selectContact,
    sendMessage,
    sendAttachment,
    isUploadingAttachment,
  } = useChatModel(currentUser);

  const [inputVal, setInputVal] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll al último mensaje
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim()) return;
    sendMessage(inputVal);
    setInputVal('');
  };

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      toast.error(`El archivo supera el límite de ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB.`);
      return;
    }
    sendAttachment(file);
  };

  // Visor ampliado de imágenes — nunca navega a la URL de S3, solo agranda
  // el <img> dentro de la misma app.
  const [lightboxImage, setLightboxImage] = useState<{ url: string; fileName: string } | null>(null);

  // ── Notas de voz (MediaRecorder) ──────────────────────────────────────────
  // Reutiliza sendAttachment tal cual — un audio grabado es, para el backend,
  // un adjunto más (mismo endpoint de URL firmada, mismo límite de tamaño).
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRecordingStream = () => {
    recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordingStreamRef.current = null;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
  };

  // Al desmontar el componente con una grabación activa, liberar el micrófono
  useEffect(() => stopRecordingStream, []);

  const startRecording = async () => {
    if (!activeContact) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 0) {
          const file = new File([blob], `nota-de-voz-${Date.now()}.webm`, { type: blob.type });
          sendAttachment(file);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch (err) {
      console.error('[InternalChat] No se pudo acceder al micrófono:', err);
      toast.error('No se pudo acceder al micrófono. Revisa los permisos del navegador.');
    }
  };

  // Detiene y ENVÍA la nota de voz grabada
  const finishRecording = () => {
    mediaRecorderRef.current?.stop(); // dispara onstop -> sendAttachment
    mediaRecorderRef.current = null;
    stopRecordingStream();
  };

  // Detiene y DESCARTA la grabación (sin enviar)
  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null; // evita que se envíe
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    stopRecordingStream();
  };

  return (
    <div className="bg-white rounded-2xl border border-toast-300 shadow-xl overflow-hidden flex flex-col h-[calc(100vh-210px)] relative font-sans">
      
      {/* SECURE HEADER BLOCK */}
      <div className="bg-gradient-to-r from-charcoal-900 to-charcoal-950 text-white p-4.5 border-b border-toast-400 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-toast-500/20 border border-toast-500/30 rounded-lg text-toast-300 animate-pulse">
              <Network className="w-4 h-4" />
            </span>
            <span className="font-serif font-black text-sm tracking-tight">
              Mind<span className="text-toast-300">Psic</span>
              <span className="mx-1 text-toast-400">×</span>
              <span className="italic font-semibold not-italic">Health</span>
            </span>
          </div>
          <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-toast-300 flex items-center">
            <Lock className="w-3.5 h-3.5 mr-1 text-toast-400" />
            Canal de Mensajería Interna Seguro (PEP-EHR)
          </h2>
        </div>
        
        {/* Connection status pills */}
        <div className="flex items-center space-x-2 shrink-0">
          <div className="bg-charcoal-900/60 border border-toast-300/25 px-2.5 py-1 rounded-lg text-[10px] text-toast-200 font-mono flex items-center">
            <span className="w-2 h-2 rounded-full bg-toast-400 mr-1.5 animate-pulse" />
            REDIS: gateway_comunicacion_mind [ACTIVE]
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        
        {/* ═══ LEFT COLUMN: WhatsApp-Style Contact List ═══ */}
        <div className="w-full sm:w-80 border-r border-toast-200 flex flex-col bg-white max-h-[100%] overflow-hidden">
          {/* SEARCH INPUT */}
          <div className="p-3 border-b border-toast-200 bg-slate-50/80">
            <div className="relative rounded-xl shadow-2xs">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar o iniciar un chat..."
                className="block w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 text-charcoal-950 rounded-xl text-xs focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400 focus:outline-hidden font-medium"
              />
            </div>
          </div>

          {/* CONTACTS LIST — WhatsApp Style */}
          <div className="flex-1 overflow-y-auto">
            {contacts.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs">
                No se encontraron contactos.
              </div>
            ) : (
              contacts.map((contact) => {
                const hasUnread = contact.unreadCount > 0 && activeContact?.id !== contact.id;
                const isActive = activeContact?.id === contact.id;
                const initials = getInitials(contact.name);
                const avatarColor = getAvatarColor(contact.name);

                return (
                <button
                  key={contact.id}
                  onClick={() => selectContact(contact)}
                  className={`w-full text-left px-4 py-3 transition-all flex items-center space-x-3 cursor-pointer border-b border-slate-100/80 ${
                    isActive
                      ? 'bg-emerald-50/80 border-l-2 border-l-emerald-500'
                      : hasUnread
                        ? 'bg-emerald-50/40 hover:bg-emerald-50/70'
                        : 'hover:bg-slate-50'
                  }`}
                >
                  {/* Avatar circular con iniciales */}
                  <div className="relative shrink-0">
                    {contact.avatarUrl ? (
                      <img
                        src={contact.avatarUrl}
                        alt={contact.name}
                        referrerPolicy="no-referrer"
                        className="w-12 h-12 rounded-full border-2 border-white shadow-sm object-cover"
                      />
                    ) : (
                      <div className={`w-12 h-12 rounded-full ${avatarColor} flex items-center justify-center shadow-sm`}>
                        <span className="text-white text-sm font-bold">{initials}</span>
                      </div>
                    )}
                    {contact.online && (
                      <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white" />
                    )}
                  </div>

                  {/* Content area */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h4 className={`text-sm truncate pr-1 ${hasUnread ? 'font-bold text-charcoal-900' : isActive ? 'font-semibold text-charcoal-900' : 'font-medium text-charcoal-800'}`}>
                        {contact.name}
                      </h4>
                      <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                        {contact.lastMessageTime && (
                          <span className={`text-[10px] leading-none ${
                            hasUnread ? 'font-bold text-emerald-600' : 'text-slate-400'
                          }`}>
                            {contact.lastMessageTime}
                          </span>
                        )}
                        {hasUnread && (
                          <div className="bg-emerald-500 rounded-full h-5 min-w-[20px] px-1 flex items-center justify-center text-white text-[10px] font-bold shadow-sm">
                            {contact.unreadCount}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Preview del último mensaje */}
                    {contact.lastMessage ? (
                      <p className={`text-xs truncate mt-0.5 ${
                        hasUnread ? 'font-semibold text-charcoal-700' : 'text-slate-400'
                      }`}>
                        {contact.lastMessage}
                      </p>
                    ) : contact.specialty ? (
                      <p className={`text-[10px] truncate tracking-wide uppercase font-mono mt-0.5 ${
                        isActive ? 'text-emerald-600/80' : 'text-slate-400'
                      }`}>
                        {contact.specialty}
                      </p>
                    ) : null}
                  </div>
                </button>
              )})
            )}
          </div>
        </div>

        {/* ═══ RIGHT COLUMN: Active Chat Screen ═══ */}
        <div className="flex-1 flex flex-col justify-between max-h-[100%] overflow-hidden bg-toast-50/15">
          {activeContact ? (
            <>
              {/* CHAT BANNER HEADER */}
              <div className="bg-white border-b border-toast-200 p-3.5 flex items-center justify-between text-left shadow-sm">
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="relative shrink-0">
                    {activeContact.avatarUrl ? (
                      <img
                        src={activeContact.avatarUrl}
                        alt={activeContact.name}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-full border border-toast-300 object-cover"
                      />
                    ) : (
                      <div className={`w-10 h-10 rounded-full ${getAvatarColor(activeContact.name)} flex items-center justify-center`}>
                        <span className="text-white text-sm font-bold">{getInitials(activeContact.name)}</span>
                      </div>
                    )}
                    {activeContact.online && (
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white animate-pulse" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-xs font-extrabold text-charcoal-900 truncate">
                      {activeContact.name}
                    </h3>
                    <p className="text-[10px] text-toast-500 font-bold uppercase tracking-wider font-mono">
                      {getRoleLabel(activeContact.role, activeContact.specialty)}
                    </p>
                  </div>
                </div>

                <div className="text-[10px] text-toast-500 font-semibold font-sans flex items-center border border-toast-200 bg-toast-50 px-2 py-0.8 rounded-lg">
                  <Lock className="w-3.5 h-3.5 text-toast-400 mr-1" />
                  Cifrado E2EE
                </div>
              </div>

              {/* MESSAGES VIEW CONTAINER */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col">
                <div className="mx-auto text-center py-1">
                  <span className="bg-toast-100 text-toast-500 border border-toast-200 text-[10px] font-bold px-2 py-0.5 rounded-lg font-mono">
                    Canal seguro abierto hoy - HIPAA Compliant
                  </span>
                </div>

                {messages.map((msg) => {
                  const isMe = msg.senderId !== activeContact.id;
                  const isImage = msg.fileType?.startsWith('image/');
                  const isAudio = msg.fileType?.startsWith('audio/');
                  return (
                    <div
                      key={msg.id}
                      className={`max-w-[80%] flex flex-col space-y-1 ${
                        isMe ? 'self-end text-right' : 'self-start text-left'
                      }`}
                    >
                      {/* Adjunto: imagen inline — clic abre el visor interno, nunca navega a S3 */}
                      {msg.fileName && isImage && msg.downloadUrl && (
                        <button
                          type="button"
                          onClick={() => setLightboxImage({ url: msg.downloadUrl!, fileName: msg.fileName! })}
                          className={`block overflow-hidden rounded-2xl border cursor-pointer ${isMe ? 'border-charcoal-950' : 'border-toast-300/60'}`}
                        >
                          <img src={msg.downloadUrl} alt={msg.fileName} className="max-h-64 w-full object-cover" />
                        </button>
                      )}

                      {/* Adjunto: nota de voz (reproductor nativo) */}
                      {msg.fileName && isAudio && msg.downloadUrl && (
                        <div
                          className={`rounded-2xl border p-2.5 ${
                            isMe ? 'bg-charcoal-900 border-charcoal-950' : 'bg-toast-100 border-toast-300/60'
                          }`}
                        >
                          <audio controls src={msg.downloadUrl} className="h-9 max-w-full" style={{ minWidth: '220px' }} />
                        </div>
                      )}

                      {/* Adjunto: archivo/documento — descarga vía blob, nunca navega a S3 */}
                      {msg.fileName && !isImage && !isAudio && (
                        <button
                          type="button"
                          onClick={() => msg.downloadUrl && downloadFile(msg.downloadUrl, msg.fileName!)}
                          disabled={!msg.downloadUrl}
                          className={`flex items-center gap-2 rounded-2xl border p-3 text-xs cursor-pointer disabled:opacity-60 disabled:cursor-default ${
                            isMe
                              ? 'bg-charcoal-900 text-white border-charcoal-950 hover:bg-charcoal-800'
                              : 'bg-toast-100 text-charcoal-900 border-toast-300/60 hover:bg-toast-200/60'
                          }`}
                        >
                          <FileText className="w-5 h-5 shrink-0" />
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block truncate font-semibold">{msg.fileName}</span>
                            <span className={`block text-[10px] ${isMe ? 'text-white/60' : 'text-charcoal-700/60'}`}>{formatFileSize(msg.fileSize)}</span>
                          </span>
                          <Download className="w-4 h-4 shrink-0" />
                        </button>
                      )}

                      {/* Texto (pie de foto o mensaje normal) */}
                      {msg.content && (
                        <div
                          className={`text-xs p-3 rounded-2xl relative border ${
                            isMe
                              ? 'bg-charcoal-900 text-white rounded-tr-none border-charcoal-950'
                              : 'bg-toast-100 text-charcoal-900 rounded-tl-none border-toast-300/60'
                          }`}
                        >
                          <p className="leading-relaxed font-sans font-medium whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      )}

                      <div className="flex items-center space-x-1 justify-end text-[9px] text-toast-400 font-mono">
                        <span>{msg.timestamp}</span>
                        {isMe && <CheckCheck className="w-3.5 h-3.5 text-toast-400 shrink-0" />}
                      </div>
                    </div>
                  );
                })}

                {isTyping && (
                  <div className="self-start text-left max-w-[80%] flex items-center space-x-2 bg-toast-100/60 border border-toast-200 p-2.5 rounded-xl rounded-tl-none">
                    <div className="flex space-x-1">
                      <span className="w-1.5 h-1.5 bg-toast-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-toast-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-toast-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-[10px] text-toast-500 font-bold font-mono uppercase tracking-wide">Escribiendo...</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* ACTIVE INPUT FORM BAR */}
              <form onSubmit={handleSend} className="p-3 border-t border-toast-200 bg-white">
                <div className="flex items-center space-x-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileSelected}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  />

                  {isRecording ? (
                    <>
                      <button
                        type="button"
                        onClick={cancelRecording}
                        title="Cancelar grabación"
                        className="p-2.5 bg-slate-50 hover:bg-slate-100 text-charcoal-700 border border-slate-200 rounded-xl transition-all cursor-pointer shrink-0"
                      >
                        <XIcon className="w-4 h-4" />
                      </button>
                      <div className="flex-1 flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5">
                        <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                        <span className="text-xs font-mono font-bold text-rose-600">{formatDuration(recordingSeconds)}</span>
                        <span className="text-[10px] text-rose-400 truncate">Grabando nota de voz...</span>
                      </div>
                      <button
                        type="button"
                        onClick={finishRecording}
                        title="Enviar nota de voz"
                        className="p-2.5 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700 rounded-xl shadow-md transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98] shrink-0"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={handleAttachClick}
                        disabled={isUploadingAttachment}
                        title="Adjuntar documento o foto"
                        className="p-2.5 bg-slate-50 hover:bg-slate-100 text-charcoal-700 border border-slate-200 rounded-xl transition-all cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        {isUploadingAttachment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                      </button>
                      <input
                        type="text"
                        value={inputVal}
                        onChange={(e) => setInputVal(e.target.value)}
                        placeholder={`Escribe un mensaje a ${activeContact.name.split(' ')[0] || 'colega'}...`}
                        className="flex-1 bg-slate-50 border border-slate-200 text-charcoal-950 rounded-xl px-4 py-2.5 text-xs focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400 focus:outline-hidden font-medium"
                      />
                      <button
                        type="button"
                        onClick={startRecording}
                        disabled={isUploadingAttachment}
                        title="Grabar nota de voz"
                        className="p-2.5 bg-slate-50 hover:bg-slate-100 text-charcoal-700 border border-slate-200 rounded-xl transition-all cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        <Mic className="w-4 h-4" />
                      </button>
                      <button
                        type="submit"
                        id="btn-chat-send"
                        className="p-2.5 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700 rounded-xl shadow-md transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98] shrink-0"
                        title="Enviar Mensaje"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
                <p className="text-[9px] text-toast-400 text-left mt-1.5 flex items-center font-mono">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Los mensajes son cifrados y persistidos en la bóveda clínica del tenant.
                </p>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-toast-400 space-y-2">
              <MessageSquare className="w-12 h-12 text-toast-300 animate-bounce" style={{ animationDuration: '4s' }} />
              <h3 className="font-serif font-black text-charcoal-950 text-lg">
                Mensajería Directa Profesional
              </h3>
              <p className="text-xs max-w-sm leading-relaxed">
                Selecciona un colega psicólogo o personal administrativo a la izquierda para iniciar de manera segura un flujo de comunicación bidireccional cifrado.
              </p>
            </div>
          )}

        </div>

      </div>

      {/* Visor ampliado de imágenes — overlay dentro de la app, nunca navega a S3 */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal-950/90 p-6"
          onClick={() => setLightboxImage(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg cursor-pointer"
            title="Cerrar"
          >
            <XIcon className="w-5 h-5" />
          </button>
          <img
            src={lightboxImage.url}
            alt={lightboxImage.fileName}
            className="max-h-[85vh] max-w-full rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); downloadFile(lightboxImage.url, lightboxImage.fileName); }}
            className="absolute bottom-4 flex items-center gap-1.5 px-4 py-2 bg-white text-charcoal-900 text-xs font-semibold rounded-xl shadow-lg cursor-pointer hover:bg-slate-100"
          >
            <Download className="w-4 h-4" />
            Descargar
          </button>
        </div>
      )}

    </div>
  );
}
