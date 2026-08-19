/**
 * AnswerAssessment.tsx — Pantalla PÚBLICA de autoaplicación (/evaluacion/:token)
 *
 * El paciente no tiene sesión de MindPsic. Se entra con el token opaco del
 * enlace más el número de documento; el backend devuelve una sesión corta que
 * autoriza a responder ESA aplicación y nada más.
 *
 * Deliberadamente NO usa apiClient: ese cliente adjunta el `mind_token` del
 * profesional y dispara el interceptor global de 403, que aquí no aplica.
 *
 * El paciente nunca ve puntajes ni etiquetas clínicas. Mostrar "Depresión
 * grave" en una pantalla, sin un profesional al lado, es iatrogénico — al
 * enviar solo recibe confirmación, y recursos de crisis si su respuesta activó
 * una alerta crítica.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Lock, LifeBuoy, AlertCircle } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3001';

interface ResponseOption { value: number; label: string; order: number }
interface Item {
  itemId: string;
  number: number;
  text: string;
  responseType: string;
  responseSetId: string | null;
  valueMin: number | null;
  valueMax: number | null;
  required: boolean;
  visibleIf: string | null;
}
interface Instrument {
  code: string;
  name: string;
  nameEs: string | null;
  instructions: string;
  timeWindow: string | null;
  durationMin: number | null;
  items: Item[];
  responseSets: { setId: string; options: ResponseOption[] }[];
}
interface Gate {
  firstName: string;
  instrumentName: string;
  instrumentCode: string;
  durationMin: number | null;
  expiresAt: string;
}
interface Crisis {
  title: string;
  message: string;
  lines: { label: string; value: string }[];
}
type Answer = { value: number | null; optionOrder: number | null };

const CONDITION_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|==|!=|>|<)\s*(-?\d+)\s*$/;

function isVisible(condition: string | null, answers: Record<string, Answer>): boolean {
  if (!condition) return true;
  const m = CONDITION_RE.exec(condition);
  if (!m) return true;
  const [, id, op, literal] = m;
  const left = answers[id]?.value;
  if (left === null || left === undefined) return false;
  const right = Number(literal);
  switch (op) {
    case '>=': return left >= right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '<': return left < right;
    case '==': return left === right;
    case '!=': return left !== right;
    default: return true;
  }
}

function getToken(): string {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

export default function AnswerAssessment() {
  const token = useMemo(getToken, []);

  const [gate, setGate] = useState<Gate | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [documentId, setDocumentId] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [session, setSession] = useState<string | null>(null);
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [crisis, setCrisis] = useState<Crisis | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // ── Puerta ────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/assessments/public/${token}`);
        const data = await res.json();
        if (!res.ok) setGateError(data?.error || 'No pudimos abrir este enlace.');
        else setGate(data);
      } catch {
        setGateError('No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const verify = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch(`${API_BASE}/api/assessments/public/${token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyError(data?.error || 'No pudimos verificar tu identidad.');
        return;
      }
      setSession(data.session);
      setInstrument(data.instrument);
      setAnswers(data.responses || {});
    } catch {
      setVerifyError('No pudimos conectarnos. Intenta de nuevo.');
    } finally {
      setVerifying(false);
    }
  };

  // ── Autoguardado ──────────────────────────────────────────────────────────
  const pending = useRef<Record<string, Answer> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (!pending.current || !session) return;
    const payload = pending.current;
    pending.current = null;
    setSaveState('saving');
    try {
      await fetch(`${API_BASE}/api/assessments/public/${token}/responses`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({ responses: payload }),
      });
      setSaveState('saved');
    } catch {
      setSaveState('idle');
    }
  }, [session, token]);

  const choose = (item: Item, option: ResponseOption) => {
    const next = { ...answers, [item.itemId]: { value: option.value, optionOrder: option.order } };
    setAnswers(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  };

  const visibleItems = useMemo(
    () => (instrument?.items || []).filter((i) => isVisible(i.visibleIf, answers)),
    [instrument, answers]
  );
  const missing = visibleItems.filter((i) => i.required && answers[i.itemId]?.value == null);
  const answered = visibleItems.length - missing.length;

  const optionsBySet = useMemo(() => {
    const map = new Map<string, ResponseOption[]>();
    instrument?.responseSets.forEach((s) => map.set(s.setId, s.options));
    return map;
  }, [instrument]);

  const submit = async () => {
    if (missing.length || !session) return;
    setSubmitting(true);
    try {
      if (timer.current) clearTimeout(timer.current);
      await fetch(`${API_BASE}/api/assessments/public/${token}/responses`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({ responses: answers }),
      });
      const res = await fetch(`${API_BASE}/api/assessments/public/${token}/submit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyError(data?.error || 'No pudimos enviar tus respuestas.');
        return;
      }
      setCrisis(data.crisis || null);
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch {
      setVerifyError('No pudimos enviar tus respuestas. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  );

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center py-20 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </Shell>
    );
  }

  if (gateError) {
    return (
      <Shell>
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-4 text-lg font-bold text-slate-900">No pudimos abrir el enlace</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{gateError}</p>
          <p className="mt-4 text-xs text-slate-400">
            Comunícate con tu profesional para que te envíe uno nuevo.
          </p>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h1 className="mt-4 text-xl font-bold text-slate-900">¡Listo, gracias!</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Tus respuestas fueron enviadas a tu profesional, que las revisará antes de tu
            próxima sesión. Ya puedes cerrar esta página.
          </p>
        </div>

        {crisis && (
          <div className="mt-4 rounded-xl border-2 border-red-300 bg-red-50 p-6">
            <div className="flex items-start gap-3">
              <LifeBuoy className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
              <div>
                <h2 className="text-base font-bold text-red-800">{crisis.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-800">{crisis.message}</p>
                <ul className="mt-4 space-y-2">
                  {crisis.lines.map((l) => (
                    <li key={l.value} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                      <span className="text-sm text-slate-700">{l.label}</span>
                      <a href={`tel:${l.value.replace(/\D/g, '')}`}
                         className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-sm font-bold text-white">
                        {l.value}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </Shell>
    );
  }

  // Puerta de identidad
  if (!session || !instrument) {
    return (
      <Shell>
        <div className="rounded-xl border border-slate-200 bg-white p-8">
          <Lock className="h-8 w-8 text-toast-500" />
          <h1 className="mt-4 text-xl font-bold text-slate-900">
            Hola {gate?.firstName}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Tu profesional te asignó el cuestionario <strong>{gate?.instrumentName}</strong>
            {gate?.durationMin ? ` (unos ${gate.durationMin} minutos)` : ''}.
            Para continuar, confirma tu identidad.
          </p>

          <label className="mt-6 block text-sm font-semibold text-slate-700">
            Número de documento
            <input
              autoFocus
              inputMode="numeric"
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && documentId.trim()) verify(); }}
              placeholder="Sin puntos ni comas"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base font-normal text-slate-900 outline-none focus:border-toast-500"
            />
          </label>

          {verifyError && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{verifyError}</p>
          )}

          <button
            onClick={verify}
            disabled={!documentId.trim() || verifying}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-toast-500 px-5 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {verifying ? <><Loader2 className="h-4 w-4 animate-spin" /> Verificando…</> : 'Continuar'}
          </button>

          <p className="mt-4 text-xs leading-relaxed text-slate-400">
            Este enlace es personal. Si no reconoces esta solicitud, no continúes y avisa a
            tu profesional.
          </p>
        </div>
      </Shell>
    );
  }

  // Cuestionario
  return (
    <Shell>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h1 className="text-lg font-bold text-slate-900">
          {instrument.nameEs || instrument.name}
        </h1>
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
          {instrument.instructions}
        </p>
        <p className="mt-3 text-xs text-slate-400">
          Puedes pausar y volver: tus respuestas se guardan solas.
        </p>
      </div>

      <div className="mt-4 space-y-3">
        {visibleItems.map((item) => {
          const options = item.responseSetId ? optionsBySet.get(item.responseSetId) || [] : [];
          const answer = answers[item.itemId];
          return (
            <div key={item.itemId} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-600">
                  {item.number}
                </span>
                <p className="text-sm font-semibold leading-relaxed text-slate-900">{item.text}</p>
              </div>
              <div className="mt-3 space-y-1.5 pl-8">
                {options.map((option) => {
                  const selected = answer?.optionOrder === option.order;
                  return (
                    <button
                      key={option.order}
                      type="button"
                      onClick={() => choose(item, option)}
                      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                        selected
                          ? 'border-toast-500 bg-toast-50 text-slate-900'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                        selected ? 'border-toast-500' : 'border-slate-300'
                      }`}>
                        {selected && <span className="h-2 w-2 rounded-full bg-toast-500" />}
                      </span>
                      <span className="flex-1 leading-relaxed">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-4 mt-4 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
        <div className="text-xs text-slate-500">
          <span className="font-bold text-slate-900">{answered}</span> de {visibleItems.length}
          {saveState === 'saving' && <span className="ml-2 text-slate-400">guardando…</span>}
          {saveState === 'saved' && <span className="ml-2 text-emerald-600">guardado</span>}
        </div>
        <button
          onClick={submit}
          disabled={submitting || missing.length > 0}
          className="inline-flex items-center gap-2 rounded-lg bg-toast-500 px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {submitting
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</>
            : <>Enviar respuestas</>}
        </button>
      </div>

      {verifyError && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{verifyError}</p>
      )}
    </Shell>
  );
}
