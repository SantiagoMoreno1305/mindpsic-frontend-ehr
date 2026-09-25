/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pantalla PÚBLICA de un Programa de medición — /programa/:token
 *
 * Mismo modelo de confianza que /firmar/ y /evaluacion/: el participante no
 * tiene cuenta y el token del enlace es la única credencial de entrada. Aquí
 * hay UN enlace general por corte (T0/T1/T2); la persona se identifica con su
 * cédula (pedida dos veces) y la plataforma le asigna el código seudónimo.
 *
 * Toda regla que importa (cédula 5–11 dígitos, no reingresar tras terminar,
 * retomar solo desde el mismo dispositivo, quién ve la Forma A) la valida y la
 * impone el servidor; esta pantalla solo la presenta.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2, ArrowRight, ArrowLeft } from 'lucide-react';
import { getApiBase } from '../lib/apiClient';

const API = `${getApiBase()}/api/programs`;

interface Option { value: number; label: string }
interface FormItem { itemId: string; text: string; type: 'single' | 'likert' | 'text'; options: Option[] | null }
interface Block { id: string; title: string; instructions?: string; legend?: string; itemIds: string[] }
interface FormDef { code: string; name: string; instructions: string; layout: { blocks: Block[] }; items: Record<string, FormItem> }
type Answers = Record<string, { value?: number | null; text?: string }>;
type FormKey = 'FICHA' | 'T' | 'A';
interface SessionState { step: FormKey | 'DONE'; forms: FormKey[]; completed: FormKey[]; codes?: { T: string | null; A: string | null } }
interface Consent {
  intro: { title: string; body: string }[];
  authorization1: { title: string; text: string; yes: string; no: string };
  authorization2: { title: string; text: string; yes: string; no: string; note: string };
}
interface PublicCtx {
  state: 'OPEN' | 'CLOSED' | 'EXPIRED' | 'NOT_OPEN';
  moment: 'T0' | 'T1' | 'T2';
  closesAt: string;
  program: { clientName: string; title: string };
  welcome?: string[];
  consent?: Consent;
}

type Stage = 'loading' | 'blocked' | 'consent' | 'cedula' | 'form' | 'done';

const SESSION_KEY = 'mind_program_session';
const DEVICE_KEY = 'mind_program_device';
const PAGE_SIZE = 6;

const FORM_TITLES: Record<FormKey, string> = {
  FICHA: 'Ficha de caracterización',
  T: 'Cuestionario de competencias psicosociales',
  A: 'Cuestionario para colaboradores con personal a cargo',
};

const safeGet = (s: Storage | undefined, k: string) => { try { return s?.getItem(k) ?? null; } catch { return null; } };
const safeSet = (s: Storage | undefined, k: string, v: string) => { try { s?.setItem(k, v); } catch { /* sin almacenamiento */ } };
const safeDel = (s: Storage | undefined, k: string) => { try { s?.removeItem(k); } catch { /* sin almacenamiento */ } };

function deviceKey(): string {
  const existing = safeGet(window.localStorage, DEVICE_KEY);
  if (existing && existing.length >= 16) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  safeSet(window.localStorage, DEVICE_KEY, key);
  return key;
}

function tokenFromPath(): string {
  const marker = '/programa/';
  const idx = window.location.pathname.indexOf(marker);
  if (idx === -1) return '';
  return decodeURIComponent(window.location.pathname.slice(idx + marker.length)).replace(/\/+$/, '');
}

class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function api<T>(path: string, init?: RequestInit & { session?: string }): Promise<T> {
  const { session, ...rest } = init || {};
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...rest,
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}) },
    });
  } catch {
    throw new ApiError('NETWORK', 'No hay conexión. Revisa tu internet e inténtalo de nuevo.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.code || 'ERROR', body.error || 'Ocurrió un error inesperado.', res.status);
  return body as T;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' });

// ─── Piezas de UI ───────────────────────────────────────────────────────────

function Shell({ children, footer, wide }: { children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-toast-50 text-charcoal-900 antialiased selection:bg-toast-200">
      <header className="border-b border-charcoal-900/10 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <ShieldCheck className="h-5 w-5 text-toast-500" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">MINDPSIC</span>
          <span className="text-sm text-charcoal-900/50">· Medición del programa</span>
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 sm:py-10 ${wide ? 'max-w-3xl' : 'max-w-2xl'}`}>{children}</main>
      {footer}
    </div>
  );
}

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <section className={`rounded-2xl border border-charcoal-900/10 bg-white p-5 shadow-sm sm:p-7 ${className}`}>{children}</section>
);

function PrimaryButton({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className="inline-flex items-center justify-center gap-2 rounded-xl bg-toast-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-toast-500/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-toast-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

const ErrorNote = ({ message }: { message: string }) => (
  <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
    <span>{message}</span>
  </div>
);

// ─── Elementos del formulario ───────────────────────────────────────────────

// Bloques Likert: una tabla compacta (una fila por pregunta) en vez de una tarjeta por
// pregunta, para que quepan 12–15 preguntas en pantalla. En escritorio la escala va como
// encabezado de columnas; en móvil cada fila lleva sus cinco botones y el "no responder".
function LikertTable({ ids, items, answers, numberOf, onChange }: {
  ids: string[]; items: Record<string, FormItem>; answers: Answers; numberOf: (id: string) => number; onChange: (id: string, v: number) => void;
}) {
  const first = items[ids[0]];
  const scale = (first.options || []);
  const cols = 'sm:grid-cols-[minmax(0,1fr)_repeat(5,4.5rem)]';
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-charcoal-900/10">
      <div className={`sticky top-0 z-10 hidden items-start gap-0.5 border-b border-charcoal-900/10 bg-toast-50 px-3 py-2 text-[10px] leading-tight text-charcoal-900/60 sm:grid ${cols}`}>
        <span />
        {scale.map((o) => <span key={o.value} className="flex flex-col items-center px-1 text-center"><b className="text-xs text-charcoal-900/80">{o.value}</b><span className="mt-0.5 min-h-[2.4em]">{o.label}</span></span>)}
      </div>
      <ul className="divide-y divide-charcoal-900/10">
        {ids.map((id) => {
          const it = items[id];
          const v = answers[id]?.value;
          return (
            <li key={id} role="radiogroup" aria-label={it.text} className={`grid items-center gap-x-1 gap-y-2 px-3 py-3 transition-colors ${v != null ? 'bg-toast-50/60' : ''} ${cols}`}>
              <p className="text-[14px] leading-snug"><span className="mr-1.5 text-charcoal-900/40">{numberOf(id)}.</span>{it.text}</p>
              <div className="flex items-center justify-between gap-1 sm:contents">
                {scale.map((o) => (
                  <button
                    key={o.value} type="button" role="radio" aria-checked={v === o.value}
                    aria-label={`${o.value} — ${o.label}`} title={o.label}
                    onClick={() => onChange(id, o.value)}
                    className={`mx-auto h-9 w-9 shrink-0 rounded-full border text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-toast-500 ${
                      v === o.value ? 'border-toast-500 bg-toast-500 text-white' : 'border-charcoal-900/20 bg-white hover:border-toast-500'
                    }`}
                  >
                    {o.value}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChoiceItem({ item, value, onChange, index, lettered }: { item: FormItem; value?: number | null; onChange: (v: number) => void; index: number; lettered: boolean }) {
  return (
    <fieldset className="rounded-xl border border-charcoal-900/10 p-4">
      <legend className="sr-only">{item.text}</legend>
      <p className="mb-3 text-[15px] leading-snug"><span className="mr-2 text-charcoal-900/40">{index}.</span>{item.text}</p>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={item.text}>
        {(item.options || []).map((o, i) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-toast-500 ${
              value === o.value ? 'border-toast-500 bg-toast-500/10' : 'border-charcoal-900/15 hover:border-toast-500/60'
            }`}
          >
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${value === o.value ? 'border-toast-500 bg-toast-500 text-white' : 'border-charcoal-900/30 text-charcoal-900/50'}`}>
              {lettered ? 'abc'[i] : ''}
            </span>
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function TextItem({ item, value, onChange, index }: { item: FormItem; value?: string; onChange: (v: string) => void; index: number }) {
  return (
    <label className="block rounded-xl border border-charcoal-900/10 p-4">
      <span className="mb-3 block text-[15px] leading-snug"><span className="mr-2 text-charcoal-900/40">{index}.</span>{item.text}</span>
      <input
        type="text"
        maxLength={300}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-charcoal-900/15 px-3 py-2.5 text-sm focus:border-toast-500 focus:outline-none focus:ring-2 focus:ring-toast-500/30"
      />
    </label>
  );
}

function SelectItem({ item, value, onChange }: { item: FormItem; value?: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium leading-snug">{item.text}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm focus:border-toast-500 focus:outline-none focus:ring-2 focus:ring-toast-500/30 ${value == null ? 'border-charcoal-900/15 text-charcoal-900/50' : 'border-charcoal-900/25 text-charcoal-900'}`}
      >
        <option value="">Selecciona…</option>
        {(item.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function FichaTextItem({ item, value, onChange }: { item: FormItem; value?: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium leading-snug">{item.text}</span>
      <input
        type="text" maxLength={300} value={value || ''} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-charcoal-900/15 px-3 py-2.5 text-sm focus:border-toast-500 focus:outline-none focus:ring-2 focus:ring-toast-500/30"
      />
    </label>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────────

export default function ProgramParticipant() {
  const token = useMemo(tokenFromPath, []);
  const [stage, setStage] = useState<Stage>('loading');
  const [ctx, setCtx] = useState<PublicCtx | null>(null);
  const [session, setSession] = useState<string | null>(() => safeGet(window.sessionStorage, SESSION_KEY));
  const [state, setState] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Consentimiento
  const [auth1, setAuth1] = useState<'yes' | 'no' | null>(null);
  const [auth2, setAuth2] = useState<'yes' | 'no' | null>(null);
  // Cédula
  const [cedula, setCedula] = useState('');
  const [cedula2, setCedula2] = useState('');
  // Formulario en curso
  const [form, setForm] = useState<FormDef | null>(null);
  const [formKey, setFormKey] = useState<FormKey | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [page, setPage] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);

  const dropSession = useCallback(() => {
    safeDel(window.sessionStorage, SESSION_KEY);
    setSession(null);
  }, []);

  const loadForm = useCallback(async (key: FormKey, sess: string) => {
    const r = await api<{ form: FormDef; answers: Answers }>(`/session/forms/${key}`, { session: sess });
    setForm(r.form);
    setFormKey(key);
    setAnswers(r.answers);
    // Retoma en la primera página con algo sin responder.
    const flat = r.form.layout.blocks.flatMap((b) => b.itemIds);
    const firstMissing = flat.findIndex((id) => r.answers[id] === undefined);
    // La ficha va en una sola pantalla.
    setPage(key === 'FICHA' || firstMissing < 0 ? 0 : (() => {
      // Mismo troceo que el render: los bloques Likert (con leyenda) van enteros.
      let n = 0;
      for (const b of r.form.layout.blocks) {
        const size = b.legend ? b.itemIds.length : PAGE_SIZE;
        for (let i = 0; i < b.itemIds.length; i += size) { if (b.itemIds.slice(i, i + size).some((id) => r.answers[id] === undefined)) return n; n += 1; }
      }
      return 0;
    })());
    setStage('form');
  }, []);

  const goToStep = useCallback(async (st: SessionState, sess: string) => {
    setState(st);
    if (st.step === 'DONE') { setStage('done'); return; }
    await loadForm(st.step, sess);
  }, [loadForm]);

  // Carga inicial: contexto público y, si hay sesión viva, continuar donde iba.
  useEffect(() => {
    (async () => {
      try {
        const c = await api<PublicCtx>(`/public/${encodeURIComponent(token)}`);
        setCtx(c);
        if (c.state !== 'OPEN') { setStage('blocked'); return; }
        if (session) {
          try {
            const r = await api<{ state: SessionState }>('/session/state', { session });
            await goToStep(r.state, session);
            return;
          } catch { dropSession(); }
        }
        setStage('consent');
      } catch (e) {
        setError((e as Error).message);
        setStage('blocked');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { topRef.current?.scrollIntoView({ block: 'start' }); }, [stage, page, formKey]);

  const submitCedula = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ session: string; state: SessionState }>(`/public/${encodeURIComponent(token)}/register`, {
        method: 'POST',
        body: JSON.stringify({
          cedula, cedulaConfirm: cedula2, authParticipation: auth1 === 'yes', authResearch: auth2 === 'yes', deviceKey: deviceKey(),
        }),
      });
      safeSet(window.sessionStorage, SESSION_KEY, r.session);
      setSession(r.session);
      setCedula(''); setCedula2('');
      await goToStep(r.state, r.session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ── Vistas sin formulario ────────────────────────────────────────────────
  if (stage === 'loading') {
    return <Shell><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-toast-500" aria-label="Cargando" /></div></Shell>;
  }

  if (stage === 'blocked') {
    const msg = error
      || (ctx?.state === 'EXPIRED' ? `Este enlace venció el ${formatDate(ctx.closesAt)}.`
        : ctx?.state === 'CLOSED' ? 'Este enlace ya fue cerrado.'
          : 'Este enlace aún no está habilitado.');
    return (
      <Shell>
        <Card className="text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-toast-500" aria-hidden />
          <h1 className="text-xl font-semibold">No es posible continuar</h1>
          <p className="mt-2 text-sm text-charcoal-900/70">{msg}</p>
          <p className="mt-2 text-sm text-charcoal-900/70">Si crees que es un error, comunícate con MINDPSIC.</p>
        </Card>
      </Shell>
    );
  }

  if (stage === 'consent' && ctx?.consent) {
    const c = ctx.consent;
    const radio = (name: string, val: 'yes' | 'no' | null, set: (v: 'yes' | 'no') => void, yes: string, no: string) => (
      <div role="radiogroup" aria-label={name} className="mt-3 flex flex-col gap-2 sm:flex-row">
        {([['yes', yes], ['no', no]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={val === k}
            onClick={() => set(k)}
            className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-toast-500 ${
              val === k ? 'border-toast-500 bg-toast-500/10' : 'border-charcoal-900/15 hover:border-toast-500/60'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    );
    return (
      <Shell>
        <div ref={topRef} />
        <Card>
          <h1 className="text-2xl font-semibold tracking-tight">Consentimiento informado</h1>
          <p className="mt-1 text-sm text-charcoal-900/60">{ctx.program.title}</p>
          <div className="mt-5 space-y-3 text-[15px] leading-relaxed">
            {c.intro.map((s) => (
              <p key={s.title}><strong className="font-semibold">{s.title}.</strong> {s.body}</p>
            ))}
          </div>

          <div className="mt-7 rounded-xl bg-toast-50 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide">Autorización 1 — {c.authorization1.title}</h2>
            <p className="mt-2 text-[15px]">{c.authorization1.text}</p>
            {radio('Autorización 1', auth1, setAuth1, c.authorization1.yes, c.authorization1.no)}
            {auth1 === 'no' && (
              <p className="mt-3 text-sm text-charcoal-900/70">Sin esta autorización no es posible participar en las mediciones del programa.</p>
            )}
          </div>

          <div className="mt-4 rounded-xl bg-toast-50 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide">Autorización 2 — {c.authorization2.title}</h2>
            <p className="mt-2 text-[15px]">{c.authorization2.text}</p>
            {radio('Autorización 2', auth2, setAuth2, c.authorization2.yes, c.authorization2.no)}
            <p className="mt-3 text-sm text-charcoal-900/70">{c.authorization2.note}</p>
          </div>

          <div className="mt-6 flex items-center justify-end">
            <PrimaryButton disabled={auth1 !== 'yes' || auth2 === null} onClick={() => { setError(null); setStage('cedula'); }}>
              Continuar <ArrowRight className="h-4 w-4" aria-hidden />
            </PrimaryButton>
          </div>
        </Card>
      </Shell>
    );
  }

  if (stage === 'cedula') {
    const valid = /^\d{5,11}$/.test(cedula) && cedula === cedula2;
    const mismatch = cedula2.length > 0 && cedula.length > 0 && cedula !== cedula2 && cedula2.length >= cedula.length;
    const digits = (v: string) => v.replace(/\D/g, '').slice(0, 11);
    return (
      <Shell>
        <div ref={topRef} />
        <Card>
          <h1 className="text-2xl font-semibold tracking-tight">Regístrate con tu número de documento</h1>
          <p className="mt-2 text-sm text-charcoal-900/70">
            Por favor escríbelo tal cual aparece en tu documento de identidad: sin puntos, sin espacios y solo números (por ejemplo, 1109420111).
          </p>
          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void submitCedula(); }}
          >
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Número de cédula</span>
              <input
                type="text" inputMode="numeric" autoComplete="off" maxLength={11} placeholder="Ej. 1109420111" value={cedula}
                onChange={(e) => setCedula(digits(e.target.value))}
                className="w-full rounded-xl border border-charcoal-900/15 px-4 py-3 text-lg tracking-wider focus:border-toast-500 focus:outline-none focus:ring-2 focus:ring-toast-500/30"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Confirma tu número de cédula</span>
              {/* Sin copiar/pegar a propósito: se escribe de nuevo, no se replica. */}
              <input
                type="text" inputMode="numeric" autoComplete="off" maxLength={11} placeholder="Escríbelo de nuevo" value={cedula2}
                onChange={(e) => setCedula2(digits(e.target.value))}
                onPaste={(e) => e.preventDefault()}
                onCopy={(e) => e.preventDefault()}
                onCut={(e) => e.preventDefault()}
                onDrop={(e) => e.preventDefault()}
                onContextMenu={(e) => e.preventDefault()}
                aria-invalid={mismatch}
                className={`w-full rounded-xl border px-4 py-3 text-lg tracking-wider focus:outline-none focus:ring-2 ${
                  mismatch ? 'border-red-400 focus:ring-red-200' : 'border-charcoal-900/15 focus:border-toast-500 focus:ring-toast-500/30'
                }`}
              />
              {mismatch && <span className="mt-1 block text-sm text-red-700">Los números no coinciden.</span>}
              <span className="mt-1 block text-xs text-charcoal-900/50">Sin puntos ni espacios, solo números (entre 5 y 11 dígitos).</span>
            </label>
            {error && <ErrorNote message={error} />}
            <div className="flex items-center justify-between pt-2">
              <button type="button" onClick={() => setStage('consent')} className="inline-flex items-center gap-1 text-sm text-charcoal-900/60 hover:text-charcoal-900">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Atrás
              </button>
              <PrimaryButton type="submit" disabled={!valid || busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Continuar
              </PrimaryButton>
            </div>
          </form>
        </Card>
      </Shell>
    );
  }

  if (stage === 'done') {
    return (
      <Shell>
        <Card className="text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-toast-500" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">¡Gracias por responder!</h1>
          <p className="mt-2 text-[15px] text-charcoal-900/75">Tus respuestas quedaron registradas. Ya puedes cerrar esta página.</p>
          {state?.codes?.T && (
            <div className="mx-auto mt-5 inline-block rounded-xl bg-toast-50 px-5 py-3 text-sm">
              <div className="text-charcoal-900/60">Tu código de participante</div>
              <div className="mt-0.5 font-mono text-lg font-semibold tracking-wide">{state.codes.T}</div>
            </div>
          )}
          <p className="mt-5 text-xs text-charcoal-900/50">Este documento ya completó esta medición; no es necesario volver a ingresar.</p>
        </Card>
      </Shell>
    );
  }

  // ── Formulario ───────────────────────────────────────────────────────────
  if (stage === 'form' && form && formKey && session) {
    // Páginas: bloques troceados en grupos de PAGE_SIZE ítems.
    const pages = form.layout.blocks.flatMap((b) => {
      const out: { block: Block; ids: string[]; first: boolean }[] = [];
      const size = formKey === 'FICHA' || b.legend ? b.itemIds.length : PAGE_SIZE;
      for (let i = 0; i < b.itemIds.length; i += size) out.push({ block: b, ids: b.itemIds.slice(i, i + size), first: i === 0 });
      return out;
    });
    const current = pages[Math.min(page, pages.length - 1)];
    const allIds = pages.flatMap((p) => p.ids);
    const answered = (id: string) => {
      const a = answers[id];
      const it = form.items[id];
      return it.type === 'text' ? !!a?.text?.trim() : a?.value !== undefined && a?.value !== null;
    };
    const doneCount = allIds.filter(answered).length;
    const pageComplete = current.ids.every(answered);
    const isLast = page >= pages.length - 1;
    const numberOf = (id: string) => allIds.indexOf(id) + 1;

    const setAnswer = (id: string, a: { value?: number | null; text?: string }) => setAnswers((prev) => ({ ...prev, [id]: a }));
    const isFicha = formKey === 'FICHA';
    const personalACargo = isFicha && form.items.FC02?.options?.find((o) => o.value === answers.FC02?.value)?.label.startsWith('Colaborador con personal');

    const savePage = async () => {
      const payload: Answers = {};
      for (const id of current.ids) payload[id] = answers[id];
      await api(`/session/forms/${formKey}/answers`, { method: 'PUT', session, body: JSON.stringify({ answers: payload }) });
    };

    const next = async () => {
      setError(null);
      setBusy(true);
      try {
        await savePage();
        if (!isLast) { setPage((p) => p + 1); return; }
        const r = await api<{ state: SessionState }>(`/session/forms/${formKey}/submit`, { method: 'POST', session });
        await goToStep(r.state, session);
      } catch (e) {
        const err = e as ApiError;
        if (err.code === 'SESSION_INVALID' || err.code?.startsWith('WAVE_')) { dropSession(); setStage('consent'); }
        setError(err.message);
      } finally {
        setBusy(false);
      }
    };

    // Última pantalla de TODA la encuesta: la Forma A si aplica; si no, la T.
    const isFinal = isLast && (formKey === 'A' || (formKey === 'T' && !state?.forms.includes('A')));
    const confirmAndSend = async () => { await next(); setConfirmOpen(false); };

    const stepIdx = state ? Math.max(0, state.forms.indexOf(formKey)) : 0;
    const totalSteps = (state?.forms.length ?? 1) + (isFicha && personalACargo && !state?.forms.includes('A') ? 1 : 0);

    return (
      <Shell wide>
        <div ref={topRef} />
        <div className="mb-4">
          <div className="flex items-center justify-between gap-3 text-xs text-charcoal-900/60">
            <span>Paso {stepIdx + 1} de {totalSteps} · {FORM_TITLES[formKey]}</span>
            <span>{doneCount} de {allIds.length}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-charcoal-900/10" role="progressbar" aria-valuemin={0} aria-valuemax={allIds.length} aria-valuenow={doneCount}>
            <div className="h-full rounded-full bg-toast-500 transition-all" style={{ width: `${(doneCount / allIds.length) * 100}%` }} />
          </div>
        </div>

        <Card>
          <h1 className="text-xl font-semibold tracking-tight">{current.block.title}</h1>
          {page === 0 && formKey !== 'FICHA' && <p className="mt-2 text-sm text-charcoal-900/70">{form.instructions}</p>}
          {current.block.instructions && <p className="mt-2 text-sm text-charcoal-900/70">{current.block.instructions}</p>}
          {current.block.legend && (
            <p className="mt-3 rounded-lg bg-toast-50 px-3 py-2 text-xs leading-relaxed text-charcoal-900/70 sm:hidden">{current.block.legend}</p>
          )}

          {isFicha ? (
            <div className="mt-5 grid gap-x-4 gap-y-4 sm:grid-cols-2">
              {current.ids.map((id) => {
                const it = form.items[id];
                const a = answers[id];
                return it.type === 'text'
                  ? <FichaTextItem key={id} item={it} value={a?.text} onChange={(v) => setAnswer(id, { text: v })} />
                  : <SelectItem key={id} item={it} value={a?.value} onChange={(v) => { if (v === null) setAnswers((prev) => { const n = { ...prev }; delete n[id]; return n; }); else setAnswer(id, { value: v }); }} />;
              })}
            </div>
          ) : null}
          {personalACargo && (
            <p className="mt-4 rounded-lg bg-toast-50 px-3 py-2 text-xs leading-relaxed text-charcoal-900/70">
              Al terminar el cuestionario general responderás también uno adicional para colaboradores con personal a cargo.
            </p>
          )}
          {!isFicha && current.block.legend && (
            <LikertTable ids={current.ids} items={form.items} answers={answers} numberOf={numberOf} onChange={(id, v) => setAnswer(id, { value: v })} />
          )}
          <div className={isFicha || current.block.legend ? 'hidden' : 'mt-5 space-y-3'}>
            {(isFicha || current.block.legend ? [] : current.ids).map((id) => {
              const it = form.items[id];
              const a = answers[id];
              if (it.type === 'text') return <TextItem key={id} item={it} index={numberOf(id)} value={a?.text} onChange={(v) => setAnswer(id, { text: v })} />;
              return <ChoiceItem key={id} item={it} index={numberOf(id)} lettered={formKey !== 'FICHA'} value={a?.value} onChange={(v) => setAnswer(id, { value: v })} />;
            })}
          </div>

          {error && <div className="mt-4"><ErrorNote message={error} /></div>}

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || busy}
              className="inline-flex items-center gap-1 text-sm text-charcoal-900/60 hover:text-charcoal-900 disabled:invisible"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden /> Anterior
            </button>
            <PrimaryButton disabled={!pageComplete || busy} onClick={() => (isFinal ? setConfirmOpen(true) : void next())}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {isFinal ? 'Terminar encuesta' : isLast ? (isFicha ? 'Continuar' : 'Enviar y continuar') : 'Siguiente'} {!busy && !isFinal && <ArrowRight className="h-4 w-4" aria-hidden />}
            </PrimaryButton>
          </div>
          {!pageComplete && <p className="mt-3 text-right text-xs text-charcoal-900/50">Responde todas las preguntas de esta página para continuar.</p>}
        </Card>
        {confirmOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-charcoal-900/50 p-4 sm:items-center"
            onKeyDown={(e) => { if (e.key === 'Escape' && !busy) setConfirmOpen(false); }}
            onClick={(e) => { if (e.target === e.currentTarget && !busy) setConfirmOpen(false); }}
          >
            <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-toast-500/10 text-toast-500"><CheckCircle2 className="h-6 w-6" aria-hidden /></span>
              <h2 id="confirm-title" className="mt-4 text-lg font-semibold tracking-tight">¿Terminar y enviar la encuesta?</h2>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-900/70">
                Al enviarla, tus respuestas quedan registradas y ya no podrás modificarlas ni volver a ingresar con tu documento a esta medición.
              </p>
              {error && <div className="mt-3"><ErrorNote message={error} /></div>}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" autoFocus disabled={busy} onClick={() => setConfirmOpen(false)} className="rounded-xl border border-charcoal-900/15 px-5 py-3 text-sm font-medium hover:bg-toast-50 disabled:opacity-40">
                  Revisar mis respuestas
                </button>
                <PrimaryButton disabled={busy} onClick={() => void confirmAndSend()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Aceptar y enviar
                </PrimaryButton>
              </div>
            </div>
          </div>
        )}
        <p className="mt-4 text-center text-xs text-charcoal-900/50">Tus respuestas se guardan al avanzar; si sales, podrás continuar desde este mismo dispositivo.</p>
      </Shell>
    );
  }

  return <Shell><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-toast-500" aria-label="Cargando" /></div></Shell>;
}
