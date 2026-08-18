/**
 * AssessmentRunner.tsx
 *
 * Aplicación de una prueba psicométrica: presenta los ítems y las opciones
 * REALES del instrumento (vienen de la DB, no están escritas en el front),
 * guarda las respuestas y pide al backend que califique.
 *
 * El puntaje NUNCA se calcula aquí. El front manda respuestas crudas y el
 * backend devuelve resultados — el motor de scoring es determinista y su
 * salida se firma con un hash de integridad. Un cálculo hecho en el navegador
 * no sería auditable ni reproducible.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  ArrowLeft, AlertTriangle, CheckCircle2, Clock, Loader2, ShieldAlert, Save,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

interface ResponseOption {
  value: number;
  label: string;
  order: number;
}

interface Item {
  id: string;
  itemId: string;
  number: number;
  text: string;
  responseType: 'OPCION_UNICA' | 'NUMERO' | 'TIEMPO_SEG' | 'CONTEO' | 'TEXTO';
  responseSetId: string | null;
  valueMin: number | null;
  valueMax: number | null;
  required: boolean;
  isCritical: boolean;
  visibleIf: string | null;
}

interface Scale {
  scaleId: string;
  name: string;
  minTheoretical: number;
  maxTheoretical: number;
  direction: string;
  isPrimary: boolean;
}

interface Instrument {
  id: string;
  code: string;
  version: string;
  name: string;
  nameEs: string | null;
  tier: string;
  instructions: string;
  timeWindow: string | null;
  durationMin: number | null;
  scales: Scale[];
  items: Item[];
  responseSets: { setId: string; options: ResponseOption[] }[];
}

interface ScoreResult {
  scaleId: string;
  scaleName: string;
  rawScore: number;
  label: string | null;
  severity: string | null;
  color: string | null;
  action: string | null;
  minTheoretical: number;
  maxTheoretical: number;
  direction: string;
}

interface FiredAlert {
  alertId: string;
  severity: string;
  message: string;
}

interface Administration {
  id: string;
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'INVALID';
  informant: string;
  companyName: string | null;
  ageAtTest: number | null;
  sexAtTest: string | null;
  patient: { id: string; firstName: string; lastName: string; recordNumber: string | null };
  results: ScoreResult[];
  firedAlerts: FiredAlert[];
  responses: Record<string, { value: number | null; optionOrder: number | null }>;
}

type Answer = { value: number | null; optionOrder: number | null };

const SEVERITY_STYLES: Record<string, string> = {
  NINGUNA: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  LEVE: 'bg-amber-50 text-amber-700 border-amber-200',
  MODERADA: 'bg-orange-50 text-orange-700 border-orange-200',
  MODERADA_SEVERA: 'bg-orange-100 text-orange-800 border-orange-300',
  SEVERA: 'bg-red-50 text-red-700 border-red-200',
};

// Evaluador de `visibleIf` ("I1 >= 1"). Es la misma gramática cerrada que usa
// el motor del backend; aquí solo decide si el ítem se muestra. La validez de
// la respuesta la vuelve a verificar el servidor.
const CONDITION_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|==|!=|>|<)\s*(-?\d+)\s*$/;

function isVisible(condition: string | null, answers: Record<string, Answer>): boolean {
  if (!condition) return true;
  const match = CONDITION_RE.exec(condition);
  if (!match) return true;
  const [, id, op, literal] = match;
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

interface Props {
  administrationId: string;
  onBack: () => void;
  onCompleted?: () => void;
}

export default function AssessmentRunner({ administrationId, onBack, onCompleted }: Props) {
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [administration, setAdministration] = useState<Administration | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/assessments/administrations/${administrationId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInstrument(data.instrument);
      setAdministration(data.administration);
      setAnswers(data.administration.responses || {});
    } catch (err) {
      console.error('[AssessmentRunner] Error cargando la aplicación:', err);
      toast.error('No se pudo cargar la prueba.');
    } finally {
      setLoading(false);
    }
  }, [administrationId]);

  useEffect(() => { load(); }, [load]);

  const optionsBySet = useMemo(() => {
    const map = new Map<string, ResponseOption[]>();
    instrument?.responseSets.forEach((s) => map.set(s.setId, s.options));
    return map;
  }, [instrument]);

  const visibleItems = useMemo(
    () => (instrument?.items || []).filter((i) => isVisible(i.visibleIf, answers)),
    [instrument, answers]
  );

  const answeredCount = visibleItems.filter((i) => answers[i.itemId]?.value != null).length;
  const missing = visibleItems.filter((i) => i.required && answers[i.itemId]?.value == null);
  const isCompleted = administration?.status === 'COMPLETED';

  const choose = (item: Item, option: ResponseOption) => {
    setAnswers((prev) => ({
      ...prev,
      [item.itemId]: { value: option.value, optionOrder: option.order },
    }));
    setDirty(true);
  };

  const setNumeric = (item: Item, raw: string) => {
    const value = raw === '' ? null : Number(raw);
    setAnswers((prev) => ({ ...prev, [item.itemId]: { value, optionOrder: null } }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/assessments/administrations/${administrationId}/responses`, {
        method: 'PUT',
        body: JSON.stringify({ responses: answers }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDirty(false);
      toast.success('Respuestas guardadas.');
    } catch (err) {
      console.error('[AssessmentRunner] Error guardando:', err);
      toast.error('No se pudieron guardar las respuestas.');
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (missing.length) {
      toast.error(`Faltan ${missing.length} ítem(s) por responder.`);
      return;
    }
    setSubmitting(true);
    try {
      const saveRes = await apiFetch(
        `/api/assessments/administrations/${administrationId}/responses`,
        { method: 'PUT', body: JSON.stringify({ responses: answers }) }
      );
      if (!saveRes.ok) throw new Error(`HTTP ${saveRes.status}`);

      const res = await apiFetch(
        `/api/assessments/administrations/${administrationId}/submit`, { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || 'No se pudo calificar la prueba.');
        return;
      }
      setDirty(false);
      toast.success('Prueba calificada.');
      await load();
      onCompleted?.();
    } catch (err) {
      console.error('[AssessmentRunner] Error calificando:', err);
      toast.error('No se pudo calificar la prueba.');
    } finally {
      setSubmitting(false);
    }
  };

  const acknowledge = async (alertId: string) => {
    try {
      await apiFetch(
        `/api/assessments/administrations/${administrationId}/alerts/${alertId}/acknowledge`,
        { method: 'POST' }
      );
      toast.success('Alerta confirmada.');
    } catch {
      toast.error('No se pudo confirmar la alerta.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!instrument || !administration) {
    return (
      <div className="py-20 text-center text-sm text-slate-400">
        No se encontró la aplicación.
      </div>
    );
  }

  const patientName = `${administration.patient.firstName} ${administration.patient.lastName}`;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>
        {!isCompleted && (
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Guardando…' : 'Guardar avance'}
          </button>
        )}
      </div>

      {/* Encabezado del instrumento */}
      <div className="rounded-xl border border-slate-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {instrument.nameEs || instrument.name}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {instrument.code} v{instrument.version} · {patientName}
              {administration.patient.recordNumber && ` · HC ${administration.patient.recordNumber}`}
              {administration.companyName && ` · ${administration.companyName}`}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {instrument.durationMin && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> ~{instrument.durationMin} min
              </span>
            )}
          </div>
        </div>

        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
          {instrument.instructions}
        </p>
        {instrument.timeWindow && (
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-toast-500">
            Periodo evaluado: {instrument.timeWindow}
          </p>
        )}
      </div>

      {/* Resultados */}
      {isCompleted && (
        <div className="space-y-3">
          {administration.firedAlerts.map((alert) => (
            <div
              key={alert.alertId}
              className={`flex items-start gap-3 rounded-xl border p-4 ${
                alert.severity === 'CRITICA'
                  ? 'border-red-300 bg-red-50'
                  : 'border-amber-200 bg-amber-50'
              }`}
            >
              {alert.severity === 'CRITICA'
                ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
              <div className="flex-1">
                <p className={`text-xs font-bold uppercase tracking-wide ${
                  alert.severity === 'CRITICA' ? 'text-red-700' : 'text-amber-700'
                }`}>
                  {alert.alertId.replace(/_/g, ' ')}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-slate-800">{alert.message}</p>
                {alert.severity === 'CRITICA' && (
                  <button
                    onClick={() => acknowledge(alert.alertId)}
                    className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:opacity-90"
                  >
                    Confirmar que fue atendida
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="grid gap-3 sm:grid-cols-2">
            {administration.results.map((r) => {
              const pct = r.maxTheoretical > 0
                ? Math.round((r.rawScore / r.maxTheoretical) * 100) : 0;
              return (
                <div key={r.scaleId} className="rounded-xl border border-slate-100 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {r.scaleName}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {r.rawScore}
                    <span className="text-base font-medium text-slate-400"> / {r.maxTheoretical}</span>
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-toast-500" style={{ width: `${pct}%` }} />
                  </div>
                  {r.label && (
                    <span className={`mt-3 inline-block rounded-lg border px-2.5 py-1 text-xs font-bold ${
                      SEVERITY_STYLES[r.severity || ''] || 'bg-slate-50 text-slate-600 border-slate-200'
                    }`}>
                      {r.label}
                    </span>
                  )}
                  {r.action && (
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">{r.action}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ítems */}
      <div className="space-y-3">
        {visibleItems.map((item) => {
          const options = item.responseSetId ? optionsBySet.get(item.responseSetId) || [] : [];
          const answer = answers[item.itemId];
          const unanswered = item.required && answer?.value == null;

          return (
            <div
              key={item.itemId}
              className={`rounded-xl border bg-white p-4 ${
                unanswered && dirty ? 'border-amber-200' : 'border-slate-100'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-600">
                  {item.number}
                </span>
                <p className="text-sm font-semibold leading-relaxed text-slate-900">
                  {item.text}
                  {item.isCritical && (
                    <span className="ml-2 align-middle text-[10px] font-bold uppercase text-red-600">
                      ítem crítico
                    </span>
                  )}
                </p>
              </div>

              {item.responseType === 'OPCION_UNICA' ? (
                <div className="mt-3 space-y-1.5 pl-8">
                  {options.map((option) => {
                    const selected = answer?.optionOrder === option.order;
                    return (
                      <button
                        key={option.order}
                        type="button"
                        disabled={isCompleted}
                        onClick={() => choose(item, option)}
                        className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${
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
                        <span className="shrink-0 text-xs font-bold text-slate-400">{option.value}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 pl-8">
                  <input
                    type="number"
                    disabled={isCompleted}
                    value={answer?.value ?? ''}
                    min={item.valueMin ?? undefined}
                    max={item.valueMax ?? undefined}
                    onChange={(e) => setNumeric(item, e.target.value)}
                    placeholder={
                      item.responseType === 'TIEMPO_SEG' ? 'Segundos'
                        : item.responseType === 'CONTEO' ? 'Cantidad' : 'Valor'
                    }
                    className="w-40 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-toast-500"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Barra de envío */}
      {!isCompleted && (
        <div className="sticky bottom-0 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <div className="text-xs text-slate-500">
            <span className="font-bold text-slate-900">{answeredCount}</span> de {visibleItems.length} respondidos
            {missing.length > 0 && (
              <span className="ml-2 text-amber-600">· faltan {missing.length}</span>
            )}
          </div>
          <button
            onClick={submit}
            disabled={submitting || missing.length > 0}
            className="inline-flex items-center gap-2 rounded-lg bg-toast-500 px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Calificando…</>
              : <><CheckCircle2 className="h-4 w-4" /> Calificar prueba</>}
          </button>
        </div>
      )}
    </div>
  );
}
