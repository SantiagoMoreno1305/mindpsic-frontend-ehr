/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pantalla PÚBLICA de firma de consentimiento/asentimiento informado.
 *
 * A propósito NO pasa por Login ni por el shell autenticado (Navbar,
 * ContextSwitcher, etc.) — el paciente nunca ha tenido cuenta en esta
 * plataforma (ver comentario "RBAC ROUTER" en App.tsx: USUARIO_B2C usa
 * "portal externo"). El token opaco de la URL ES la credencial: de un solo
 * uso, con vencimiento corto, generado por el staff al agendar la primera
 * cita (ver POST /api/consent/tokens en el backend de Mind).
 *
 * El texto legal NO vive aquí — se pide a la API (utils/consent-templates.js
 * en Mind) para que la pantalla y el PDF final firmado nunca puedan
 * desincronizarse.
 */

import { useEffect, useState } from 'react';
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:9000';

type ContentBlock = { h: string } | { list: string[] } | string;

interface SigningContext {
  consentType: 'Consentimiento informado' | 'Asentimiento informado';
  patientName: string;
  patientDocument: string;
  guardianName: string | null;
  guardianRelationship: string | null;
  expiresAt: string;
  content: {
    consentimientoParrafos?: ContentBlock[];
    asentimientoItems?: string[];
    asentimientoNota?: string;
    // Autorización de datos (Ley 1581) — legalmente distinta del
    // consentimiento clínico, siempre presente sin importar consentType.
    dataAuthorization: { parrafos: string[]; declaracion: string };
  };
}

type ViewState = 'loading' | 'error' | 'ready' | 'submitting' | 'done';

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'Este enlace no es válido. Verifica que lo copiaste completo, o pide al consultorio que te envíe uno nuevo.',
  ALREADY_SIGNED: 'Este documento ya fue firmado. Si crees que es un error, contacta al consultorio.',
  REVOKED: 'Este enlace ya no está activo — seguramente se generó uno más reciente. Revisa tu correo más nuevo.',
  EXPIRED: 'Este enlace venció. Pide al consultorio que te envíe uno nuevo.',
};

function getTokenFromPath(): string {
  const marker = '/firmar/';
  const idx = window.location.pathname.indexOf(marker);
  if (idx === -1) return '';
  return decodeURIComponent(window.location.pathname.slice(idx + marker.length)).replace(/\/+$/, '');
}

function isParagraphBlock(block: ContentBlock): block is string {
  return typeof block === 'string';
}

export default function SignConsent() {
  const [token] = useState(getTokenFromPath);
  const [state, setState] = useState<ViewState>('loading');
  const [context, setContext] = useState<SigningContext | null>(null);
  const [errorCode, setErrorCode] = useState<string>('NOT_FOUND');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [signerName, setSignerName] = useState('');
  const [signerDocument, setSignerDocument] = useState('');
  const [guardianRelationship, setGuardianRelationship] = useState('');
  const [minorName, setMinorName] = useState('');
  const [minorAge, setMinorAge] = useState('');
  const [q1, setQ1] = useState<'si' | 'no' | null>(null);
  const [q2, setQ2] = useState<'si' | 'no' | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [dataAuthAccepted, setDataAuthAccepted] = useState(false);

  useEffect(() => {
    if (!token) {
      setErrorCode('NOT_FOUND');
      setState('error');
      return;
    }
    fetch(`${API_BASE}/api/consent/${token}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          setErrorCode(body.error || 'NOT_FOUND');
          setState('error');
          return;
        }
        setContext(body);
        setSignerName(body.guardianName || body.patientName || '');
        setSignerDocument(body.patientDocument || '');
        setGuardianRelationship(body.guardianRelationship || '');
        setState('ready');
      })
      .catch(() => {
        setErrorCode('NOT_FOUND');
        setState('error');
      });
  }, [token]);

  const isAsentimiento = context?.consentType === 'Asentimiento informado';

  const canSubmit =
    signerName.trim().length > 2 &&
    signerDocument.trim().length > 3 &&
    accepted &&
    dataAuthAccepted &&
    (!isAsentimiento || (q1 !== null && q2 !== null && minorName.trim().length > 1 && minorAge.trim().length > 0));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setState('submitting');
    setSubmitError(null);
    try {
      const res = await fetch(`${API_BASE}/api/consent/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerName: signerName.trim(),
          signerDocument: signerDocument.trim(),
          guardianRelationship: isAsentimiento ? guardianRelationship.trim() : undefined,
          minorName: isAsentimiento ? minorName.trim() : undefined,
          minorAge: isAsentimiento ? Number(minorAge) : undefined,
          asentimientoQ1: isAsentimiento ? q1 : undefined,
          asentimientoQ2: isAsentimiento ? q2 : undefined,
          dataAuthorizationAccepted: dataAuthAccepted,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSubmitError(body.error || 'No se pudo completar la firma. Intenta de nuevo.');
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
            <p className="text-sm">Cargando tu documento…</p>
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
            <h1 className="text-charcoal-900 font-bold text-base mb-2">Firma registrada</h1>
            <p className="text-charcoal-400 text-sm leading-relaxed">
              Quedó guardada en tu historia clínica. Puedes cerrar esta ventana — el consultorio ya tiene el documento firmado.
            </p>
          </div>
        )}

        {(state === 'ready' || state === 'submitting') && context && (
          <div className="bg-white border border-toast-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-toast-100 flex items-center justify-between gap-3">
              <div>
                <h1 className="text-charcoal-900 font-bold text-sm">
                  {isAsentimiento ? 'Asentimiento informado' : 'Consentimiento informado'}
                </h1>
                <p className="text-charcoal-400 text-xs mt-0.5">
                  {isAsentimiento
                    ? 'Representante legal y menor de edad'
                    : `Paciente: ${context.patientName}`}
                </p>
              </div>
              <span className="text-[10px] font-mono text-toast-500 bg-toast-100 border border-toast-200 rounded-full px-2.5 py-1 whitespace-nowrap">
                {isAsentimiento ? 'MINDP-ASE-CLIN-003' : 'MINDP-CON-CLIN-002'}
              </span>
            </div>

            <div className="px-6 py-6 max-h-[26rem] overflow-y-auto space-y-4">
              {!isAsentimiento &&
                context.content.consentimientoParrafos?.map((block, i) => {
                  if (isParagraphBlock(block)) {
                    return (
                      <p key={i} className="text-charcoal-700 text-sm leading-relaxed">
                        {block}
                      </p>
                    );
                  }
                  if ('h' in block) {
                    return (
                      <h2 key={i} className="text-charcoal-900 font-bold text-sm pt-1">
                        {block.h}
                      </h2>
                    );
                  }
                  return (
                    <ol key={i} className="list-decimal list-inside space-y-2 text-charcoal-700 text-sm">
                      {block.list.map((item, j) => (
                        <li key={j}>{item}</li>
                      ))}
                    </ol>
                  );
                })}

              {isAsentimiento && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-charcoal-400">Nombre del menor</span>
                      <input
                        value={minorName}
                        onChange={(e) => setMinorName(e.target.value)}
                        className="mt-1 w-full text-sm border border-toast-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-toast-300"
                        placeholder="Nombre completo"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-charcoal-400">Edad</span>
                      <input
                        value={minorAge}
                        onChange={(e) => setMinorAge(e.target.value.replace(/\D/g, ''))}
                        inputMode="numeric"
                        className="mt-1 w-full text-sm border border-toast-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-toast-300"
                        placeholder="Años"
                      />
                    </label>
                  </div>

                  {context.content.asentimientoItems?.map((item, i) => {
                    const value = i === 0 ? q1 : q2;
                    const setValue = i === 0 ? setQ1 : setQ2;
                    return (
                      <div key={i} className="border border-toast-100 rounded-xl p-4">
                        <p className="text-charcoal-700 text-sm leading-relaxed mb-3">{item}</p>
                        <div className="flex gap-3">
                          <button
                            type="button"
                            aria-label="Sí, acepto"
                            aria-pressed={value === 'si'}
                            onClick={() => setValue('si')}
                            className={`relative flex items-center justify-center rounded-xl border-2 px-5 py-2 transition-all ${
                              value === 'si' ? 'border-toast-500 bg-toast-100 -translate-y-0.5 shadow-sm' : 'border-toast-200 hover:border-toast-300'
                            }`}
                          >
                            <img src="/consent/letter-s.png" alt="" className="h-8" />
                            <img src="/consent/letter-i.png" alt="" className="h-8" />
                            {value === 'si' && (
                              <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-toast-500 text-white text-[10px] flex items-center justify-center">✓</span>
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label="No, todavía no"
                            aria-pressed={value === 'no'}
                            onClick={() => setValue('no')}
                            className={`relative flex items-center justify-center rounded-xl border-2 px-5 py-2 transition-all ${
                              value === 'no' ? 'border-toast-500 bg-toast-100 -translate-y-0.5 shadow-sm' : 'border-toast-200 hover:border-toast-300'
                            }`}
                          >
                            <img src="/consent/letter-n.png" alt="" className="h-8" />
                            <img src="/consent/letter-o.png" alt="" className="h-8" />
                            {value === 'no' && (
                              <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-toast-500 text-white text-[10px] flex items-center justify-center">✓</span>
                            )}
                          </button>
                        </div>
                        {value && (
                          <p className={`text-xs mt-2 font-semibold ${value === 'si' ? 'text-toast-500' : 'text-charcoal-400'}`}>
                            Seleccionaste: {value === 'si' ? 'Sí, acepto' : 'No, todavía no'}
                          </p>
                        )}
                      </div>
                    );
                  })}

                  {context.content.asentimientoNota && (
                    <p className="text-charcoal-400 text-xs italic border-t border-dashed border-toast-200 pt-3">
                      {context.content.asentimientoNota}
                    </p>
                  )}
                </div>
              )}

              {/* Autorización de datos — legalmente distinta del consentimiento
                  clínico (Ley 1581 vs. Ley 1090), se firma en la misma sesión
                  pero queda como documento y registro aparte. */}
              <div className="pt-5 border-t-2 border-toast-100">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-charcoal-900 font-bold text-sm">Autorización de tratamiento de datos personales</h2>
                  <span className="text-[10px] font-mono text-toast-500 bg-toast-100 border border-toast-200 rounded-full px-2 py-0.5 whitespace-nowrap">
                    MINDP-DAT-CLIN-004
                  </span>
                </div>
                <div className="space-y-3">
                  {context.content.dataAuthorization.parrafos.map((p, i) => (
                    <p key={i} className="text-charcoal-700 text-sm leading-relaxed">
                      {p}
                    </p>
                  ))}
                  <p className="text-charcoal-700 text-sm leading-relaxed font-medium">{context.content.dataAuthorization.declaracion}</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-5 border-t border-toast-100 bg-toast-50/60 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-charcoal-400">
                    {isAsentimiento ? 'Nombre del representante legal' : 'Tu nombre completo'}
                  </span>
                  <input
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    className="mt-1 w-full text-sm border border-toast-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-toast-300"
                    placeholder="Como firma legalmente"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-charcoal-400">Documento de identidad</span>
                  <input
                    value={signerDocument}
                    onChange={(e) => setSignerDocument(e.target.value)}
                    className="mt-1 w-full text-sm border border-toast-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-toast-300"
                    placeholder="Número de cédula"
                  />
                </label>
              </div>

              {isAsentimiento && (
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-charcoal-400">Parentesco con el menor</span>
                  <input
                    value={guardianRelationship}
                    onChange={(e) => setGuardianRelationship(e.target.value)}
                    className="mt-1 w-full text-sm border border-toast-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-toast-300"
                    placeholder="Ej. Madre, Padre, Tutor"
                  />
                </label>
              )}

              <div className="space-y-2.5">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                    className="mt-0.5 accent-toast-500 w-4 h-4"
                  />
                  <span className="text-xs text-charcoal-700 leading-relaxed">
                    He leído y comprendido el {isAsentimiento ? 'asentimiento' : 'consentimiento'} informado, y {isAsentimiento ? 'firmo como representante legal del menor' : 'acepto sus condiciones'}.
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dataAuthAccepted}
                    onChange={(e) => setDataAuthAccepted(e.target.checked)}
                    className="mt-0.5 accent-toast-500 w-4 h-4"
                  />
                  <span className="text-xs text-charcoal-700 leading-relaxed">
                    He leído y comprendido la autorización de tratamiento de datos personales, y la otorgo libremente.
                  </span>
                </label>
              </div>

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
                  <ShieldCheck className="w-4 h-4" />
                )}
                Firmar {isAsentimiento ? 'consentimiento y asentimiento' : 'consentimiento'}
              </button>

              <p className="text-[10px] text-charcoal-400 text-center">
                Este enlace es personal e intransferible y vence el{' '}
                {new Date(context.expiresAt).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })}.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
