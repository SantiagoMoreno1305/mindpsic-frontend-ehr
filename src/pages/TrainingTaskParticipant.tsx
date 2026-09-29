/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pantalla PÚBLICA de Tareas de Capacitaciones — /capacitacion/tareas/:token
 *
 * Mismo modelo de confianza que /programa/:token: sin cuenta, el token del
 * enlace es la credencial, el colaborador se identifica con su cédula (×2).
 * A propósito NO cruza datos con Programas de medición — puede que ni sean
 * los mismos colaboradores.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2, ArrowRight, ArrowLeft, Clock } from 'lucide-react';
import { getApiBase } from '../lib/apiClient';

const API = `${getApiBase()}/api/training/tasks`;
const SESSION_KEY = 'mind_training_task_session';
const DEVICE_KEY = 'mind_training_task_device';

interface Field { key: string; label: string }
interface Task {
  code: string; title: string; instructions: string;
  kind: 'alert_or_na' | 'text_fields' | 'option_text' | 'week_table';
  fields?: Field[]; naLabel?: string; options?: string[]; days?: string[];
}
type Answers = Record<string, any>;
interface StateTask { code: string; title: string; status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' }
type ParticipantState =
  | { phase: 'NOT_STARTED' }
  | { phase: 'OPEN'; visitOrder: number; deadline: string; allDone: boolean; tasks: StateTask[] }
  | { phase: 'WAITING'; nextVisitOrder: number; nextDate: string }
  | { phase: 'CLOSED'; visitOrder: number; tasks: StateTask[] };

const safeGet = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const safeGetL = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSetL = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

function deviceKey(): string {
  const existing = safeGetL(DEVICE_KEY);
  if (existing && existing.length >= 16) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  safeSetL(DEVICE_KEY, key);
  return key;
}
function tokenFromPath(): string {
  const marker = '/capacitacion/tareas/';
  const idx = window.location.pathname.indexOf(marker);
  return idx === -1 ? '' : decodeURIComponent(window.location.pathname.slice(idx + marker.length)).replace(/\/+$/, '');
}
class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }
async function api<T>(path: string, init?: RequestInit & { session?: string }): Promise<T> {
  const { session, ...rest } = init || {};
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...rest, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}) } });
  } catch { throw new ApiError('NETWORK', 'No hay conexión. Revisa tu internet e inténtalo de nuevo.', 0); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.code || 'ERROR', body.error || 'Ocurrió un error inesperado.', res.status);
  return body as T;
}
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' });

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-toast-50 text-charcoal-900 antialiased selection:bg-toast-200">
      <header className="border-b border-charcoal-900/10 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <ShieldCheck className="h-5 w-5 text-toast-500" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">MINDPSIC</span>
          <span className="text-sm text-charcoal-900/50">· Capacitaciones</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">{children}</main>
    </div>
  );
}
const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <section className={`rounded-2xl border border-charcoal-900/10 bg-white p-5 shadow-sm sm:p-7 ${className}`}>{children}</section>
);
function PrimaryButton({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className="inline-flex items-center justify-center gap-2 rounded-xl bg-toast-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-toast-500/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-toast-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40">{children}</button>;
}
const ErrorNote = ({ message }: { message: string }) => (
  <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{message}</span>
  </div>
);
const MAX_LEN = 600;
const TextArea = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <label className="block">
    <span className="mb-1.5 block text-sm font-medium">{label}</span>
    <textarea
      value={value} maxLength={MAX_LEN} rows={3} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-charcoal-900/15 px-3 py-2.5 text-sm focus:border-toast-500 focus:outline-none focus:ring-2 focus:ring-toast-500/30"
    />
    <span className="mt-1 block text-right text-[11px] text-charcoal-900/40">{value.length}/{MAX_LEN} · unas 5 líneas</span>
  </label>
);

type Stage = 'loading' | 'blocked' | 'cedula' | 'form' | 'done';

export default function TrainingTaskParticipant() {
  const token = useMemo(tokenFromPath, []);
  const [stage, setStage] = useState<Stage>('loading');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<string | null>(() => safeGet(SESSION_KEY));
  const [pState, setPState] = useState<ParticipantState | null>(null);
  const [busy, setBusy] = useState(false);

  const [cedula, setCedula] = useState('');
  const [cedula2, setCedula2] = useState('');

  const [task, setTask] = useState<Task | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [taskCode, setTaskCode] = useState<string | null>(null);

  const dropSession = useCallback(() => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } setSession(null); }, []);

  const loadState = useCallback(async (sess: string) => {
    const r = await api<{ state: ParticipantState }>('/session/state', { session: sess });
    setPState(r.state);
    setTask(null); setTaskCode(null);
    setStage('form');
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await api(`/public/${encodeURIComponent(token)}`);
      } catch (e) { setError((e as Error).message); setStage('blocked'); return; }
      if (session) {
        try { await loadState(session); return; } catch { dropSession(); }
      }
      setStage('cedula');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const submitCedula = async () => {
    setError(null); setBusy(true);
    try {
      const r = await api<{ session: string }>(`/public/${encodeURIComponent(token)}/register`, {
        method: 'POST', body: JSON.stringify({ cedula, cedulaConfirm: cedula2, deviceKey: deviceKey() }),
      });
      safeSet(SESSION_KEY, r.session);
      setSession(r.session);
      setCedula(''); setCedula2('');
      await loadState(r.session);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const openTask = async (code: string) => {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ task: Task; answers: Answers }>(`/session/tasks/${code}`, { session });
      setTask(r.task); setAnswers(r.answers || {}); setTaskCode(code);
      // Sin esto, el botón/gesto "atrás" del navegador saca de la app entera
      // en vez de volver a la lista de tareas — empujamos una entrada de
      // historial al abrir, y la escuchamos abajo para cerrar el detalle.
      window.history.pushState({ trainingTask: code }, '', window.location.href);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const closeTask = useCallback(() => { setTask(null); setTaskCode(null); setAnswers({}); setError(null); }, []);

  useEffect(() => {
    const onPopState = () => { if (taskCode) closeTask(); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [taskCode, closeTask]);

  const isComplete = (): boolean => {
    if (!task) return false;
    if (task.kind === 'alert_or_na') {
      if (answers.na) return true;
      return (task.fields || []).every((f) => (answers[f.key] || '').trim());
    }
    if (task.kind === 'text_fields') return (task.fields || []).every((f) => (answers[f.key] || '').trim());
    if (task.kind === 'option_text') return !!answers.option && !!(answers.detalle || '').trim();
    if (task.kind === 'week_table') {
      return (task.days || []).every((d) => {
        const row = answers[d];
        return row && (row.did === true || row.did === false) && Number.isInteger(row.fatigue) && row.fatigue >= 0 && row.fatigue <= 10;
      });
    }
    return false;
  };

  const submitTask = async () => {
    if (!session || !taskCode) return;
    setBusy(true); setError(null);
    try {
      await api(`/session/tasks/${taskCode}/answers`, { method: 'PUT', session, body: JSON.stringify({ answers }) });
      const r = await api<{ state: ParticipantState }>(`/session/tasks/${taskCode}/submit`, { method: 'POST', session });
      setPState(r.state);
      setTask(null); setTaskCode(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'SESSION_INVALID') { dropSession(); setStage('cedula'); }
      setError(err.message);
    } finally { setBusy(false); }
  };

  if (stage === 'loading') return <Shell><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-toast-500" aria-label="Cargando" /></div></Shell>;

  if (stage === 'blocked') {
    return (
      <Shell>
        <Card className="text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-toast-500" aria-hidden />
          <h1 className="text-xl font-semibold">No es posible continuar</h1>
          <p className="mt-2 text-sm text-charcoal-900/70">{error || 'Este enlace no es válido.'}</p>
        </Card>
      </Shell>
    );
  }

  if (stage === 'cedula') {
    const valid = /^\d{5,11}$/.test(cedula) && cedula === cedula2;
    const mismatch = cedula2.length > 0 && cedula !== cedula2 && cedula2.length >= cedula.length;
    const digits = (v: string) => v.replace(/\D/g, '').slice(0, 11);
    return (
      <Shell>
        <Card>
          <h1 className="text-2xl font-semibold tracking-tight">Regístrate con tu número de documento</h1>
          <p className="mt-2 text-sm text-charcoal-900/70">Por favor escríbelo tal cual aparece en tu documento de identidad: sin puntos, sin espacios y solo números.</p>
          <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void submitCedula(); }}>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Número de cédula</span>
              <input type="text" inputMode="numeric" autoComplete="off" maxLength={11} placeholder="Ej. 1109420111" value={cedula} onChange={(e) => setCedula(digits(e.target.value))} className="w-full rounded-xl border border-charcoal-900/15 px-4 py-3 text-lg tracking-wider focus:border-toast-500 focus:outline-none focus:ring-2 focus:ring-toast-500/30" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Confirma tu número de cédula</span>
              <input
                type="text" inputMode="numeric" autoComplete="off" maxLength={11} placeholder="Escríbelo de nuevo" value={cedula2}
                onChange={(e) => setCedula2(digits(e.target.value))}
                onPaste={(e) => e.preventDefault()} onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}
                aria-invalid={mismatch}
                className={`w-full rounded-xl border px-4 py-3 text-lg tracking-wider focus:outline-none focus:ring-2 ${mismatch ? 'border-red-400 focus:ring-red-200' : 'border-charcoal-900/15 focus:border-toast-500 focus:ring-toast-500/30'}`}
              />
              {mismatch && <span className="mt-1 block text-sm text-red-700">Los números no coinciden.</span>}
              <span className="mt-1 block text-xs text-charcoal-900/50">Sin puntos ni espacios, solo números (entre 5 y 11 dígitos).</span>
            </label>
            {error && <ErrorNote message={error} />}
            <div className="flex justify-end pt-2">
              <PrimaryButton type="submit" disabled={!valid || busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Continuar</PrimaryButton>
            </div>
          </form>
        </Card>
      </Shell>
    );
  }

  if (stage === 'form' && pState) {
    if (pState.phase === 'NOT_STARTED') {
      return <Shell><Card className="text-center"><Clock className="mx-auto mb-3 h-8 w-8 text-toast-400" aria-hidden /><h1 className="text-xl font-semibold">Todavía no hay tareas disponibles</h1><p className="mt-2 text-sm text-charcoal-900/70">Vuelve a entrar después de la primera sesión.</p></Card></Shell>;
    }
    if (pState.phase === 'WAITING') {
      return <Shell><Card className="text-center"><Clock className="mx-auto mb-3 h-8 w-8 text-toast-400" aria-hidden /><h1 className="text-xl font-semibold">Tu próxima tarea aún no está disponible</h1><p className="mt-2 text-sm text-charcoal-900/70">Se habilita el {formatDate(pState.nextDate)}, con la Visita {pState.nextVisitOrder}.</p></Card></Shell>;
    }
    if (pState.phase === 'CLOSED') {
      return <Shell><Card className="text-center"><Clock className="mx-auto mb-3 h-8 w-8 text-toast-400" aria-hidden /><h1 className="text-xl font-semibold">El plazo para esta tarea ya venció</h1></Card></Shell>;
    }
    // OPEN
    if (task && taskCode) {
      return (
        <Shell>
          <button
            type="button" onClick={() => window.history.back()}
            className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-charcoal-900/60 hover:text-charcoal-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Volver a mis tareas
          </button>
          <Card>
            <h1 className="text-xl font-semibold tracking-tight">{task.title}</h1>
            <p className="mt-2 text-sm text-charcoal-900/70">{task.instructions}</p>

            <div className="mt-5 space-y-4">
              {task.kind === 'alert_or_na' && (
                <>
                  <label className="flex items-start gap-2.5 rounded-xl border border-charcoal-900/10 bg-toast-50 p-3">
                    <input type="checkbox" checked={!!answers.na} onChange={(e) => setAnswers({ na: e.target.checked })} className="mt-0.5" />
                    <span className="text-sm">{task.naLabel}</span>
                  </label>
                  {!answers.na && (task.fields || []).map((f) => (
                    <TextArea key={f.key} label={f.label} value={answers[f.key] || ''} onChange={(v) => setAnswers((a) => ({ ...a, [f.key]: v }))} />
                  ))}
                </>
              )}
              {task.kind === 'text_fields' && (task.fields || []).map((f) => (
                <TextArea key={f.key} label={f.label} value={answers[f.key] || ''} onChange={(v) => setAnswers((a) => ({ ...a, [f.key]: v }))} />
              ))}
              {task.kind === 'option_text' && (
                <>
                  <fieldset className="space-y-2">
                    <legend className="mb-1 text-sm font-medium">¿Cuál realizó?</legend>
                    {(task.options || []).map((o) => (
                      <label key={o} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm ${answers.option === o ? 'border-toast-500 bg-toast-500/10' : 'border-charcoal-900/10'}`}>
                        <input type="radio" name="option" checked={answers.option === o} onChange={() => setAnswers((a) => ({ ...a, option: o }))} />
                        {o}
                      </label>
                    ))}
                  </fieldset>
                  <TextArea label={(task.fields || [])[0]?.label || 'Detalle'} value={answers.detalle || ''} onChange={(v) => setAnswers((a) => ({ ...a, detalle: v }))} />
                </>
              )}
              {task.kind === 'week_table' && (
                <div className="overflow-hidden rounded-xl border border-charcoal-900/10">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-toast-50 text-left text-xs text-charcoal-900/60"><th className="p-2">Día</th><th className="p-2">¿Hizo la rutina?</th><th className="p-2">Fatiga (0-10)</th></tr></thead>
                    <tbody>
                      {(task.days || []).map((d) => {
                        const row = answers[d] || {};
                        return (
                          <tr key={d} className="border-t border-charcoal-900/10">
                            <td className="p-2 font-medium">{d}</td>
                            <td className="p-2">
                              <div className="flex gap-1.5">
                                {[['Sí', true], ['No', false]].map(([lbl, val]) => (
                                  <button key={String(val)} type="button" onClick={() => setAnswers((a) => ({ ...a, [d]: { ...row, did: val } }))} className={`rounded-lg border px-2.5 py-1 text-xs ${row.did === val ? 'border-toast-500 bg-toast-500 text-white' : 'border-charcoal-900/15'}`}>{lbl as string}</button>
                                ))}
                              </div>
                            </td>
                            <td className="p-2">
                              <select value={row.fatigue ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [d]: { ...row, fatigue: Number(e.target.value) } }))} className="w-16 rounded-lg border border-charcoal-900/15 px-1.5 py-1 text-xs">
                                <option value="">—</option>
                                {[...Array(11)].map((_, i) => <option key={i} value={i}>{i}</option>)}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {error && <div className="mt-4"><ErrorNote message={error} /></div>}
            <div className="mt-6 flex justify-end">
              <PrimaryButton disabled={!isComplete() || busy} onClick={() => void submitTask()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Enviar tarea <ArrowRight className="h-4 w-4" aria-hidden />
              </PrimaryButton>
            </div>
          </Card>
        </Shell>
      );
    }
    // Lista de tareas de la visita vigente
    return (
      <Shell>
        <div className="mb-4 flex items-center justify-between text-xs text-charcoal-900/60">
          <span>Visita {pState.visitOrder}</span>
          <span>Tienes hasta el {formatDate(pState.deadline)}</span>
        </div>
        {pState.allDone ? (
          <Card className="text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-toast-500" aria-hidden />
            <h1 className="text-xl font-semibold">¡Ya enviaste tus tareas!</h1>
            <p className="mt-2 text-sm text-charcoal-900/70">Vuelve a entrar con tu cédula cuando llegue tu próxima visita.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {pState.tasks.map((t) => (
              <button
                key={t.code} onClick={() => void openTask(t.code)} disabled={t.status === 'COMPLETED' || busy}
                className={`flex w-full items-center justify-between rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-toast-500 disabled:cursor-default disabled:opacity-60 ${t.status === 'COMPLETED' ? 'border-emerald-200' : 'border-charcoal-900/10'}`}
              >
                <div>
                  <p className="text-sm font-semibold text-charcoal-900">{t.title}</p>
                  <p className="text-xs text-charcoal-900/50">{t.status === 'COMPLETED' ? 'Enviada' : 'Por responder'}</p>
                </div>
                {t.status === 'COMPLETED' ? <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden /> : <ArrowRight className="h-5 w-5 text-charcoal-900/30" aria-hidden />}
              </button>
            ))}
            {error && <ErrorNote message={error} />}
          </div>
        )}
      </Shell>
    );
  }

  return <Shell><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-toast-500" aria-label="Cargando" /></div></Shell>;
}
