/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pantalla PÚBLICA de cancelación de cita.
 *
 * Mismo modelo de confianza que SignConsent.tsx: no pasa por Login ni por el
 * shell autenticado — el paciente nunca ha tenido cuenta en esta plataforma.
 * El token opaco de la URL ES la credencial, de un solo uso, generado por el
 * backend cada vez que se envía un correo de cita (ver
 * utils/messaging.service.js y modules/appointments/cancel-token.* en Mind).
 *
 * A propósito NO cancela con solo abrir el enlace (GET) — los clientes de
 * correo y varios antivirus "pre-visitan" los links por seguridad, así que
 * el GET solo trae el contexto para mostrar una pantalla de confirmación; la
 * cancelación real ocurre con el POST que dispara el botón.
 */

import { useEffect, useState } from 'react';
import { CalendarX, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:9000';

interface CancelContext {
  patientName: string;
  psychologistName: string | null;
  date: string;
  timeSlot: string;
  modality: 'VIRTUAL' | 'PRESENCIAL';
  location: { name: string; address: string | null } | null;
}

type ViewState = 'loading' | 'error' | 'ready' | 'submitting' | 'done';

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'Este enlace no es válido. Verifica que lo copiaste completo, o revisa tu correo más reciente.',
  ALREADY_USED: 'Esta cita ya fue cancelada con este mismo enlace.',
  ALREADY_CANCELLED: 'Esta cita ya está cancelada.',
  REVOKED: 'Este enlace ya no está activo — seguramente se generó uno más reciente. Revisa tu correo más nuevo.',
  EXPIRED: 'Este enlace venció. Si necesitas cancelar, contacta al consultorio.',
};

function getTokenFromPath(): string {
  const marker = '/cancelar/';
  const idx = window.location.pathname.indexOf(marker);
  if (idx === -1) return '';
  return decodeURIComponent(window.location.pathname.slice(idx + marker.length)).replace(/\/+$/, '');
}

export default function CancelAppointment() {
  const [token] = useState(getTokenFromPath);
  const [state, setState] = useState<ViewState>('loading');
  const [context, setContext] = useState<CancelContext | null>(null);
  const [errorCode, setErrorCode] = useState<string>('NOT_FOUND');
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setErrorCode('NOT_FOUND');
      setState('error');
      return;
    }
    fetch(`${API_BASE}/api/appointment-cancel/${token}`)
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

  const handleCancel = async () => {
    setState('submitting');
    setSubmitError(null);
    try {
      const res = await fetch(`${API_BASE}/api/appointment-cancel/${token}`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setSubmitError(body.error || 'No se pudo cancelar la cita. Intenta de nuevo.');
        setState('ready');
        return;
      }
      setState('done');
    } catch {
      setSubmitError('No se pudo conectar. Verifica tu conexión e intenta de nuevo.');
      setState('ready');
    }
  };

  const dateLabel = context
    ? new Date(context.date).toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  return (
    <div className="min-h-screen bg-toast-50 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md">
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
            <p className="text-sm">Cargando tu cita…</p>
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
            <h1 className="text-charcoal-900 font-bold text-base mb-2">Cita cancelada</h1>
            <p className="text-charcoal-400 text-sm leading-relaxed">
              Tu cita quedó cancelada. Puedes cerrar esta ventana — si necesitas agendar una nueva, contáctanos.
            </p>
          </div>
        )}

        {(state === 'ready' || state === 'submitting') && context && (
          <div className="bg-white border border-toast-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-toast-100">
              <h1 className="text-charcoal-900 font-bold text-sm">Cancelar cita</h1>
              <p className="text-charcoal-400 text-xs mt-0.5">Paciente: {context.patientName}</p>
            </div>

            <div className="px-6 py-6">
              <table className="w-full">
                <tbody>
                  <tr>
                    <td className="text-xs text-charcoal-400 py-1.5 w-28">Fecha</td>
                    <td className="text-sm text-charcoal-900 font-semibold py-1.5">{dateLabel}</td>
                  </tr>
                  <tr>
                    <td className="text-xs text-charcoal-400 py-1.5">Hora</td>
                    <td className="text-sm text-charcoal-900 font-semibold py-1.5">{context.timeSlot}</td>
                  </tr>
                  {context.psychologistName && (
                    <tr>
                      <td className="text-xs text-charcoal-400 py-1.5">Psicólogo</td>
                      <td className="text-sm text-charcoal-900 font-semibold py-1.5">{context.psychologistName}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="text-xs text-charcoal-400 py-1.5">Modalidad</td>
                    <td className="text-sm text-charcoal-900 font-semibold py-1.5">
                      {context.modality === 'VIRTUAL' ? 'Virtual (Telepsicología)' : 'Presencial'}
                    </td>
                  </tr>
                  {context.location && (
                    <tr>
                      <td className="text-xs text-charcoal-400 py-1.5">Ubicación</td>
                      <td className="text-sm text-charcoal-900 font-semibold py-1.5">
                        {[context.location.name, context.location.address].filter(Boolean).join(' — ')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-5 border-t border-toast-100 bg-toast-50/60 space-y-3">
              <p className="text-xs text-charcoal-700 leading-relaxed">
                ¿Seguro que deseas cancelar esta cita? Esta acción no se puede deshacer — si más adelante quieres agendar de nuevo, deberás contactar al consultorio.
              </p>

              {submitError && <p className="text-xs text-rose-500 font-medium">{submitError}</p>}

              <button
                type="button"
                disabled={state === 'submitting'}
                onClick={handleCancel}
                className="w-full flex items-center justify-center gap-2 bg-charcoal-900 text-white text-sm font-bold rounded-xl py-3 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-charcoal-800 transition-colors"
              >
                {state === 'submitting' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarX className="w-4 h-4" />}
                Sí, cancelar mi cita
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
