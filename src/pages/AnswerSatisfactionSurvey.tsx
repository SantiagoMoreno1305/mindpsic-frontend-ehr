/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pantalla PÚBLICA de la encuesta de satisfacción — decisión 2026-10-28.
 *
 * A propósito NO pasa por Login ni por el shell autenticado, igual que
 * SignConsent.tsx/AnswerAssessment.tsx: el token opaco de la URL ES la
 * credencial, generado por el staff al tocar "Enviar encuesta de
 * satisfacción" en la ficha del paciente (ver POST
 * /api/satisfaction-surveys en el backend de Mind).
 *
 * El paciente NUNCA escribe su nombre ni documento acá — el token ya lo
 * identifica internamente. Pedírselo sesgaría la respuesta sobre su propio
 * psicólogo.
 *
 * Las preguntas y sus opciones NO viven aquí — se piden a la API (misma
 * fuente de verdad que utils/satisfaction-survey-questions.js en Mind) para
 * que la pantalla nunca pueda desincronizarse de lo que el backend valida.
 */

import { useEffect, useState } from 'react';
import { MessageCircleHeart, Loader2, AlertTriangle, CheckCircle2, Check } from 'lucide-react';
import { getApiBase } from '../lib/apiClient';

const API_BASE = getApiBase();

interface SurveyOption {
  valor: string;
  etiqueta: string;
}

interface SurveyQuestion {
  id: string;
  texto: string;
  opciones: SurveyOption[];
}

interface SurveyContext {
  patientFirstName: string;
  expiresAt: string;
  questions: SurveyQuestion[];
}

type ViewState = 'loading' | 'error' | 'ready' | 'submitting' | 'done';

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'Este enlace no es válido. Verifica que lo copiaste completo, o pide al consultorio que te envíe uno nuevo.',
  ALREADY_ANSWERED: 'Ya respondiste esta encuesta. ¡Gracias por tu tiempo!',
  EXPIRED: 'Este enlace venció. Pide al consultorio que te envíe uno nuevo.',
};

function getTokenFromPath(): string {
  const marker = '/encuesta/';
  const idx = window.location.pathname.indexOf(marker);
  if (idx === -1) return '';
  return decodeURIComponent(window.location.pathname.slice(idx + marker.length)).replace(/\/+$/, '');
}

export default function AnswerSatisfactionSurvey() {
  const [token] = useState(getTokenFromPath);
  const [state, setState] = useState<ViewState>('loading');
  const [context, setContext] = useState<SurveyContext | null>(null);
  const [errorCode, setErrorCode] = useState<string>('NOT_FOUND');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [comentario, setComentario] = useState('');

  useEffect(() => {
    if (!token) {
      setErrorCode('NOT_FOUND');
      setState('error');
      return;
    }
    fetch(`${API_BASE}/api/satisfaction-surveys/${token}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          setErrorCode(body.error || 'NOT_FOUND');
          setState('error');
          return;
        }
        setContext(body);
        setState('ready');
      })
      .catch(() => {
        setErrorCode('NOT_FOUND');
        setState('error');
      });
  }, [token]);

  const preguntas = context?.questions ?? [];
  const canSubmit = preguntas.length > 0 && preguntas.every((q) => !!respuestas[q.id]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setState('submitting');
    setSubmitError(null);
    try {
      const res = await fetch(`${API_BASE}/api/satisfaction-surveys/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ respuestas, comentarios: comentario.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSubmitError(body.error || 'No se pudo enviar tu respuesta. Intenta de nuevo.');
        setState('ready');
        return;
      }
      setState('done');
    } catch {
      setSubmitError('No se pudo conectar. Verifica tu conexión e intenta de nuevo.');
      setState('ready');
    }
  };

  return (
    <div className="min-h-screen bg-toast-50 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="flex items-center justify-center gap-2 mb-8">
          <span
            className="text-charcoal-900 font-black text-lg tracking-wide"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
          >
            MINDPSIC
          </span>
        </div>

        {state === 'loading' && (
          <div className="flex flex-col items-center justify-center py-24 text-charcoal-400">
            <Loader2 className="w-6 h-6 animate-spin mb-3" />
            <p className="text-sm">Cargando la encuesta…</p>
          </div>
        )}

        {state === 'error' && (
          <div className="bg-white border border-toast-200 rounded-2xl p-8 text-center shadow-sm">
            <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
            </div>
            <h1 className="text-charcoal-900 font-bold text-base mb-2">No pudimos abrir este enlace</h1>
            <p className="text-charcoal-400 text-sm leading-relaxed">{ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.NOT_FOUND}</p>
          </div>
        )}

        {state === 'done' && (
          <div className="bg-white border border-toast-200 rounded-2xl p-8 text-center shadow-sm">
            <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            </div>
            <h1 className="text-charcoal-900 font-bold text-base mb-2">¡Gracias por tu respuesta!</h1>
            <p className="text-charcoal-400 text-sm leading-relaxed">
              Tu opinión nos ayuda a mejorar. Puedes cerrar esta ventana.
            </p>
          </div>
        )}

        {(state === 'ready' || state === 'submitting') && context && (
          <div className="bg-white border border-toast-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-toast-100">
              <h1 className="text-charcoal-900 font-bold text-sm">Encuesta de satisfacción</h1>
              <p className="text-charcoal-400 text-xs mt-0.5">
                Hola {context.patientFirstName}, cuéntanos cómo fue tu experiencia en MindPsic. Toma menos de 2 minutos.
              </p>
            </div>

            <div className="px-6 py-6 max-h-[32rem] overflow-y-auto space-y-5">
              {preguntas.map((pregunta, i) => (
                <div key={pregunta.id} className="border border-toast-100 rounded-xl p-4">
                  <p className="text-charcoal-700 text-sm leading-relaxed mb-3 font-medium">
                    {i + 1}. {pregunta.texto}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {pregunta.opciones.map((opcion) => {
                      const seleccionada = respuestas[pregunta.id] === opcion.valor;
                      return (
                        <button
                          key={opcion.valor}
                          type="button"
                          aria-pressed={seleccionada}
                          onClick={() => setRespuestas((prev) => ({ ...prev, [pregunta.id]: opcion.valor }))}
                          className={`flex items-center gap-1.5 rounded-xl border-2 px-3.5 py-2 text-sm transition-all ${
                            seleccionada
                              ? 'border-toast-500 bg-toast-100 text-charcoal-900 font-semibold -translate-y-0.5 shadow-sm'
                              : 'border-toast-200 text-charcoal-700 hover:border-toast-300'
                          }`}
                        >
                          {seleccionada && <Check className="w-3.5 h-3.5 text-toast-500" />}
                          {opcion.etiqueta}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-charcoal-400">
                    ¿Hay algo más que quieras compartir? (Opcional)
                  </span>
                  <textarea
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    rows={3}
                    className="mt-1 w-full text-sm border border-toast-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-toast-300 resize-none"
                    placeholder="Escribe tu respuesta"
                  />
                </label>
              </div>
            </div>

            <div className="px-6 py-5 border-t border-toast-100 bg-toast-50/60 space-y-3">
              {submitError && <p className="text-xs text-rose-500 font-medium">{submitError}</p>}

              <button
                type="button"
                disabled={!canSubmit || state === 'submitting'}
                onClick={handleSubmit}
                className="w-full flex items-center justify-center gap-2 bg-charcoal-900 text-white text-sm font-bold rounded-xl py-3 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-charcoal-800 transition-colors"
              >
                {state === 'submitting' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <MessageCircleHeart className="w-4 h-4" />
                )}
                Enviar respuesta
              </button>

              <p className="text-[10px] text-charcoal-400 text-center">
                Este enlace es personal y vence el{' '}
                {new Date(context.expiresAt).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })}.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
