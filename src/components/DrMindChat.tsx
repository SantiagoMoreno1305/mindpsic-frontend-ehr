/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, 
  Send, 
  X, 
  ChevronDown, 
  Bot, 
  User as UserIcon, 
  Loader2, 
  AlertCircle, 
  FileText, 
  CheckSquare, 
  Database,
  RefreshCw
} from 'lucide-react';
import { ChatMessage, Patient } from '../types';

interface DrMindChatProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPatient?: Patient | null;
}

export default function DrMindChat({ isOpen, onClose, selectedPatient }: DrMindChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '¡Hola! Soy **Dr.Mind**, tu asesor asistente de salud mental. Puedo ayudarte a estructurar notas de evolución clínica, proponer diagnósticos CIE-10/DSM-5 o sugerir pruebas psicométricas basadas en la sintomatología del paciente actual.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Pre-configured clinic action tags for fast AI prompting
  const promptSuggestions = [
    { label: "Redactar evolución sugerida", text: "Ayúdame a redactar una nota de evolución sobre el paciente, detallando posible plan TCC y Estado Mental sugerido." },
    { label: "Sugerir pruebas de diagnóstico", text: "Qué baterías de pruebas psicológicas o escalas psicométricas me recomiendas para este caso?" },
    { label: "Códigos de diagnóstico CIE-10", text: "Cuáles son los códigos diagnósticos CIE-10 más comunes asociados a crisis de ansiedad laboral y burnout?" }
  ];

  const handleSend = async (textToSend?: string) => {
    const query = textToSend || inputValue;
    if (!query.trim()) return;

    if (!textToSend) {
      setInputValue('');
    }

    const userMsgId = 'msg-' + Date.now();
    const newUserMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, newUserMsg]);
    setIsLoading(true);
    setErrorStatus(null);

    // Call REST API
    // COMENTARIO CLÍNICO CONECTOR EN ESPAÑOL:
    // Aquí se conecta con el endpoint del backend /api/chat que llama a Gemini o tu propio LLM / RAG local.
    // También puedes modificar la ruta o implementar WebSockets si necesitas transmisión (streaming) en vivo.
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: [...messages, newUserMsg].map(m => ({ role: m.role, content: m.content })),
          patientContext: selectedPatient ? {
            name: selectedPatient.name,
            age: selectedPatient.age,
            gender: selectedPatient.gender,
            agreement: selectedPatient.agreement,
            notesCount: selectedPatient.progressNotesCount,
            lastSession: selectedPatient.lastSessionDate
          } : null
        })
      });

      if (!response.ok) {
        throw new Error(`Error de conexión con el servidor: Código ${response.status}`);
      }

      const data = await response.json();
      
      const assistantMsg: ChatMessage = {
        id: 'msg-' + (Date.now() + 1),
        role: 'assistant',
        content: data.content,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isClinicalInsight: data.isClinicalInsight
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error("Error al obtener respuesta de Dr.Mind:", err);
      setErrorStatus(err.message || "No se pudo establecer conexión.");
      
      // Fallback local secundario explicativo
      setMessages(prev => [...prev, {
        id: 'error-msg-' + Date.now(),
        role: 'assistant',
        content: `⚠️ **Error de Comunicación:** No obtuve respuesta del servidor clínico.
        
        *   **Causa posible:** El backend Express o el servicio de red no están respondiendo a tiempo.
        *   **Prueba Local:** No te preocupes, el simulador del servidor sigue activo. Intenta reenviar la consulta o asegúrate de que el servidor local de desarrollo en el puerto 3000 esté corriendo correctamente sin bloqueos.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Simple and ultra-resilient custom Markdown Parser for bold text, listings, bullet points and checklists
  const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      let trimmed = line.trim();
      // Headers ###
      if (trimmed.startsWith('###')) {
        return (
          <h4 key={idx} className="text-sm font-bold text-charcoal-900 mt-3 mb-1 font-sans flex items-center">
            <Sparkles className="w-4 h-4 mr-1 text-toast-500" />
            {trimmed.replace('###', '').trim()}
          </h4>
        );
      }
      
      // Bold bullet points * **Title:** Text or list item with check
      if (trimmed.startsWith('*') || trimmed.startsWith('-')) {
        let content = trimmed.substring(1).trim();
        // Check if has bold inside **Title:**
        if (content.startsWith('**') && content.includes('**')) {
          const parts = content.split('**');
          // parts[1] is bold title, parts[2] is remainder text
          return (
            <div key={idx} className="ml-4 pl-2 border-l border-toast-200 py-1 flex items-start text-xs text-slate-700 leading-relaxed font-sans">
              <span className="text-toast-400 mr-2">•</span>
              <div>
                <strong className="text-slate-900 font-semibold">{parts[1]}</strong>
                <span>{parts.slice(2).join('**')}</span>
              </div>
            </div>
          );
        }
        return (
          <div key={idx} className="ml-4 pl-2 py-0.5 flex items-start text-xs text-slate-700 leading-relaxed font-sans">
            <span className="text-toast-400 mr-2">•</span>
            <span>{content}</span>
          </div>
        );
      }

      // Check for simple listing 1. 2. 3.
      if (trimmed.match(/^\d+\./)) {
        return (
          <div key={idx} className="ml-4 pl-2 py-0.5 flex items-start text-xs text-slate-700 leading-relaxed font-sans">
            <span className="text-toast-500 font-bold mr-2 text-[11px]">{trimmed.match(/^\d+\./)?.[0]}</span>
            <span>{trimmed.replace(/^\d+\./, '').trim()}</span>
          </div>
        );
      }

      // Default paragraph, replacing bold matches safely
      if (trimmed === '') return <div key={idx} className="h-2" />;

      let content = trimmed;
      // Match all occurrences of **text**
      const regex = /\*\*(.*?)\*\*/g;
      let match;
      const elements = [];
      let lastIndex = 0;
      let i = 0;

      while ((match = regex.exec(content)) !== null) {
        if (match.index > lastIndex) {
          elements.push(<span key={`text-${i}`}>{content.substring(lastIndex, match.index)}</span>);
          i++;
        }
        elements.push(<strong key={`bold-${i}`} className="font-semibold text-slate-900">{match[1]}</strong>);
        i++;
        lastIndex = regex.lastIndex;
      }

      if (lastIndex < content.length) {
        elements.push(<span key={`text-${i}`}>{content.substring(lastIndex)}</span>);
      }

      return (
        <p key={idx} className="text-slate-700 text-xs leading-relaxed mb-1.5 font-sans break-words">
          {elements.length > 0 ? elements : content}
        </p>
      );
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-110 bg-slate-50 shadow-2xl z-50 border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-200">
      
      {/* Drawer Header */}
      <div className="bg-gradient-to-r from-charcoal-900 to-charcoal-800 p-4 text-white flex items-center justify-between shadow-xs border-b border-toast-300">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center border border-white/20">
            <Bot className="w-6 h-6 text-toast-300 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-sm tracking-tight">Asistente Dr.Mind</h3>
              <span className="text-[9px] bg-charcoal-950 px-1.5 py-0.2 rounded-full font-mono uppercase font-bold text-white tracking-wider animate-pulse border border-toast-400/30">
                LLM Clinico
              </span>
            </div>
            <p className="text-[11px] text-toast-100 flex items-center mt-0.5">
              <Database className="w-3.5 h-3.5 mr-1" />
              Ecovisualización Activa
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-300 hover:text-white rounded-lg p-1.5 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Patient Specific Context Banner */}
      {selectedPatient && (
        <div className="bg-toast-55 border-b border-toast-200 p-3 px-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-toast-500 animate-ping" />
            <p className="text-xs text-charcoal-900 font-medium">
              Sintonizado con: <span className="font-bold">{selectedPatient.name}</span> ({selectedPatient.age} años • {selectedPatient.agreement})
            </p>
          </div>
          <span className="text-[9px] bg-toast-200 text-toast-500 font-bold uppercase rounded-md px-1.5 py-0.5 border border-toast-300">
            Contexto Activo
          </span>
        </div>
      )}

      {/* Chat Messages Log */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        
        {messages.map((msg) => {
          const isAI = msg.role === 'assistant';
          return (
            <div key={msg.id} className={`flex gap-3 ${isAI ? 'justify-start' : 'justify-end'}`}>
              
              {/* Avatar Icon */}
              {isAI && (
                <div className="w-8 h-8 rounded-lg bg-toast-100 text-toast-500 flex items-center justify-center border border-toast-300 shrink-0">
                  <Bot className="w-5 h-5" />
                </div>
              )}

              {/* Message Bubble */}
              <div className="max-w-[85%] flex flex-col">
                <div className={`p-3.5 rounded-2xl border text-xs shadow-xs ${
                  isAI 
                    ? msg.isClinicalInsight
                      ? 'bg-white border-toast-200 rounded-tl-none text-slate-800 relative overflow-hidden' 
                      : 'bg-white border-slate-100 rounded-tl-none text-slate-800'
                    : 'bg-charcoal-900 hover:bg-charcoal-950 text-white rounded-tr-none border-charcoal-950 font-medium'
                }`}>
                  {/* Insight Marker Decoration */}
                  {isAI && msg.isClinicalInsight && (
                    <div className="absolute top-0 right-0 w-12 h-12 bg-toast-500/5 rotate-45 transform translate-x-6 -translate-y-6 flex items-start justify-center pr-2 pt-2">
                      <Sparkles className="w-3.5 h-3.5 text-toast-400 rotate-45" />
                    </div>
                  )}

                  {/* Body Content */}
                  <div className="space-y-1">
                    {msg.role === 'assistant' ? renderMarkdown(msg.content) : <p className="leading-relaxed">{msg.content}</p>}
                  </div>
                </div>

                {/* Time Badge */}
                <span className={`text-[10px] text-slate-400 mt-1 font-mono px-1 ${!isAI ? 'text-right' : 'text-left'}`}>
                  {msg.timestamp}
                </span>
              </div>

              {/* User Avatar */}
              {!isAI && (
                <div className="w-8 h-8 rounded-lg bg-toast-100 text-charcoal-900 flex items-center justify-center border border-toast-300 shrink-0">
                  <UserIcon className="w-4 h-4" />
                </div>
              )}

            </div>
          );
        })}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-lg bg-toast-100 text-toast-500 flex items-center justify-center border border-toast-200 shrink-0">
              <Bot className="w-5 h-5 animate-spin" />
            </div>
            <div className="max-w-[80%] bg-white border border-slate-100 rounded-2xl rounded-tl-none p-4 text-xs text-slate-500 flex items-center space-x-2 shadow-xs">
              <Loader2 className="w-4 h-4 animate-spin text-toast-500" />
              <span>Dr.Mind está redactando análisis clínico...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested clinical actions based on active patient */}
      {selectedPatient && !isLoading && (
        <div className="bg-slate-100 border-t border-slate-200/50 p-3 space-y-1.5 shrink-0">
          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1 px-1 flex items-center">
            <Sparkles className="w-3.5 h-3.5 mr-1 text-toast-500 animate-bounce" />
            Sugerencias de acción terapéutica ({selectedPatient.name}):
          </p>
          <div className="flex flex-col gap-1.5">
            {promptSuggestions.map((sug, sIndex) => (
              <button
                key={sIndex}
                onClick={() => handleSend(sug.text)}
                id={`btn-drmind-sug-${sIndex}`}
                className="text-left bg-white hover:bg-toast-50 border border-slate-200 hover:border-toast-300 text-xs text-slate-700 p-2 rounded-xl transition-all shadow-2xs font-medium cursor-pointer flex items-center justify-between group"
              >
                <span>{sug.label}</span>
                <span className="text-[10px] text-toast-500 font-bold opacity-0 group-hover:opacity-100 transition-opacity">Ejecutar →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat Typing Input Area */}
      <div className="p-3 bg-white border-t border-slate-100 shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center space-x-2"
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Consúltame criterios, evoluciones..."
            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs focus:ring-2 focus:ring-charcoal-900 focus:outline-hidden font-sans placeholder-slate-400"
          />
          
          <button
            type="submit"
            id="btn-drmind-send-chat"
            disabled={isLoading || !inputValue.trim()}
            className="bg-charcoal-900 hover:bg-charcoal-950 disabled:bg-slate-100 text-white p-3 rounded-xl disabled:text-slate-300 transition-colors shadow-xs cursor-pointer text-center flex items-center justify-center border border-charcoal-950"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <div className="text-[10px] text-slate-400 text-center mt-2 flex items-center justify-center">
          <Bot className="w-3 h-3 mr-1 text-toast-500" />
          <span>Inteligencia asertiva calibrada bajo HIPAA &amp; Ley 1581</span>
        </div>
      </div>

    </div>
  );
}
