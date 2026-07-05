import React, { useState, useRef, useEffect } from 'react';
import { User, UserRole } from '../types';
import { useChatModel } from '../hooks/useChatModel';
import { 
  Send, 
  Search, 
  MessageSquare, 
  Lock, 
  CheckCheck, 
  AlertCircle,
  Network,
  User as UserIcon
} from 'lucide-react';

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
    sendMessage
  } = useChatModel(currentUser);

  const [inputVal, setInputVal] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="bg-white rounded-2xl border border-toast-300 shadow-xl overflow-hidden flex flex-col h-[calc(110vh-210px)] relative font-sans">
      
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
                  return (
                    <div
                      key={msg.id}
                      className={`max-w-[80%] flex flex-col space-y-1 ${
                        isMe ? 'self-end text-right' : 'self-start text-left'
                      }`}
                    >
                      <div
                        className={`text-xs p-3 rounded-2xl relative border ${
                          isMe
                            ? 'bg-charcoal-900 text-white rounded-tr-none border-charcoal-950'
                            : 'bg-toast-100 text-charcoal-900 rounded-tl-none border-toast-300/60'
                        }`}
                      >
                        <p className="leading-relaxed font-sans font-medium whitespace-pre-wrap">{msg.content}</p>
                      </div>
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
                    type="text"
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    placeholder={`Escribe un mensaje a ${activeContact.name.split(' ')[0] || 'colega'}...`}
                    className="flex-1 bg-slate-50 border border-slate-200 text-charcoal-950 rounded-xl px-4 py-2.5 text-xs focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400 focus:outline-hidden font-medium"
                  />
                  <button
                    type="submit"
                    id="btn-chat-send"
                    className="p-2.5 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700 rounded-xl shadow-md transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                    title="Enviar Mensaje"
                  >
                    <Send className="w-4 h-4" />
                  </button>
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

    </div>
  );
}
