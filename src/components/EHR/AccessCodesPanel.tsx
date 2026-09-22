/**
 * AccessCodesPanel.tsx
 *
 * Códigos de acceso auto-servibles, creados por el propio tenant para SUS
 * clientes — no confundir con las licencias del tenant (Subscription.
 * seatLimit/patientLimit, eso se gestiona desde AdminCenter). Dos usos:
 *
 *   - LINEA247: quien no sabe cómo se llama su convenio en el sistema (o no
 *     quiere buscarlo) escribe este código al autorregistrarse en línea24x7
 *     y el sistema resuelve el convenio solo (ver linea247-pre-register.
 *     controller.js).
 *   - EVALUATION_CAMPAIGN: además del convenio, precarga qué instrumento se
 *     le asigna automáticamente a quien se registre con este código — para
 *     campañas de evaluación masiva a varios clientes de una vez.
 *
 * El código es único en TODA la plataforma (no solo en este tenant) — quien
 * lo usa todavía no sabe a qué tenant pertenece, así que no hay forma de
 * acotar la búsqueda por tenant al momento de canjearlo.
 *
 * Endpoints consumidos:
 *   GET   /api/access-codes            → listado de códigos del tenant
 *   POST  /api/access-codes            → crear uno nuevo
 *   PATCH /api/access-codes/:id/close  → revocar uno antes de tiempo
 *   GET   /api/assessments/catalog     → catálogo de instrumentos (solo para EVALUATION_CAMPAIGN)
 */
import React, { useEffect, useState } from 'react';
import { KeyRound, Plus, X, Copy, Check, Loader2, Ban, Building2, ClipboardList, ChevronDown, ChevronRight, BellRing } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useCompanies } from '../../hooks/useCompanies';

interface InstrumentOption {
  id: string;
  code: string;
  name: string;
  nameEs?: string | null;
  modality: string;
}

interface AccessCodeRecord {
  id: string;
  code: string;
  purpose: 'LINEA247' | 'EVALUATION_CAMPAIGN';
  name: string | null;
  status: 'activo' | 'cerrado';
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  createdByName: string | null;
  createdAt: string;
  company: { id: string; name: string };
  instrument: { id: string; code: string; name: string } | null;
  evaluationDeadline: string | null;
  // Estado como CANAL DE ENTRADA (¿todavía se puede canjear?) — lo calcula el
  // backend. Independiente del avance de lo ya canjeado (progress).
  lifecycle: Lifecycle;
  progress: Progress;
}

type Lifecycle = 'ACTIVO' | 'AGOTADO' | 'VENCIDO' | 'CERRADO';

interface Progress {
  redeemed: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  overdue: number;
  invalid: number;
  pending: number;
}

type EvalState = 'SIN_INICIAR' | 'EN_PROGRESO' | 'COMPLETADA' | 'FUERA_DE_PLAZO' | 'INVALIDA';

interface RedemptionRecord {
  id: string;
  redeemedAt: string;
  patient: { id: string; firstName: string; lastName: string; documentId: string; email: string | null };
  evaluation: { state: EvalState; instrumentName: string; dueAt: string | null; startedAt: string | null; completedAt: string | null } | null;
  lastRemindedAt: string | null;
  reminderCount: number;
  canRemind: boolean;
}

const LIFECYCLE_STYLES: Record<Lifecycle, { label: string; badge: string; hint: string }> = {
  ACTIVO: { label: 'Activo', badge: 'bg-emerald-100 text-emerald-700', hint: 'Se puede canjear' },
  AGOTADO: { label: 'Agotado', badge: 'bg-indigo-100 text-indigo-700', hint: 'Ya se usó todo su cupo' },
  VENCIDO: { label: 'Vencido', badge: 'bg-amber-100 text-amber-700', hint: 'Pasó su fecha de vencimiento' },
  CERRADO: { label: 'Cerrado', badge: 'bg-slate-200 text-slate-500', hint: 'Se cerró manualmente' },
};

const EVAL_STATE_STYLES: Record<EvalState, { label: string; badge: string }> = {
  SIN_INICIAR: { label: 'Sin iniciar', badge: 'bg-slate-100 text-slate-600' },
  EN_PROGRESO: { label: 'En progreso', badge: 'bg-sky-100 text-sky-700' },
  COMPLETADA: { label: 'Completada', badge: 'bg-emerald-100 text-emerald-700' },
  FUERA_DE_PLAZO: { label: 'Fuera de plazo', badge: 'bg-rose-100 text-rose-700' },
  INVALIDA: { label: 'Inválida', badge: 'bg-slate-200 text-slate-500' },
};

type Filter = 'TODOS' | Lifecycle | 'PENDIENTES';

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const PURPOSE_LABELS: Record<string, string> = {
  LINEA247: 'Línea 24/7',
  EVALUATION_CAMPAIGN: 'Campaña de evaluación',
};

export default function AccessCodesPanel() {
  const { companies } = useCompanies();
  const [codes, setCodes] = useState<AccessCodeRecord[]>([]);
  const [instruments, setInstruments] = useState<InstrumentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form state
  const [companyId, setCompanyId] = useState('');
  const [purpose, setPurpose] = useState<'LINEA247' | 'EVALUATION_CAMPAIGN'>('LINEA247');
  const [instrumentId, setInstrumentId] = useState('');
  const [name, setName] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [evaluationDeadline, setEvaluationDeadline] = useState('');
  const [filter, setFilter] = useState<Filter>('TODOS');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchCodes = () => {
    setLoading(true);
    apiFetch('/api/access-codes')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setCodes(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudieron cargar los códigos de acceso.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCodes();
    apiFetch('/api/assessments/catalog')
      .then((res) => (res.ok ? res.json() : { instruments: [] }))
      .then((data) => {
        const list = Array.isArray(data?.instruments) ? data.instruments : [];
        // Un instrumento heteroaplicado no se puede autoaplicar por código —
        // mismo criterio que ya rechaza el backend, se filtra acá para no
        // ofrecer una opción que de todas formas va a fallar al guardar.
        setInstruments(list.filter((i: any) => i.modality !== 'heteroaplicada'));
      })
      .catch(() => setInstruments([]));
  }, []);

  function resetForm() {
    setCompanyId('');
    setPurpose('LINEA247');
    setInstrumentId('');
    setName('');
    setCustomCode('');
    setMaxUses('');
    setExpiresAt('');
    setEvaluationDeadline('');
    setFormError(null);
  }

  function openForm() {
    resetForm();
    setShowForm(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId) {
      setFormError('Elige un convenio/cliente.');
      return;
    }
    if (purpose === 'EVALUATION_CAMPAIGN' && !instrumentId) {
      setFormError('Elige qué instrumento se asigna con este código.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await apiFetch('/api/access-codes', {
        method: 'POST',
        body: JSON.stringify({
          companyId,
          purpose,
          instrumentId: purpose === 'EVALUATION_CAMPAIGN' ? instrumentId : undefined,
          name: name.trim() || undefined,
          code: customCode.trim() || undefined,
          maxUses: maxUses.trim() || undefined,
          expiresAt: expiresAt || undefined,
          evaluationDeadline: purpose === 'EVALUATION_CAMPAIGN' ? evaluationDeadline || undefined : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || `HTTP ${res.status}`);
        return;
      }
      setShowForm(false);
      fetchCodes();
    } catch {
      setFormError('No se pudo contactar el servidor.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClose(id: string) {
    if (!confirm('¿Cerrar este código? Ya no se podrá usar para registrarse, pero los registros que ya lo usaron no se ven afectados.')) return;
    const res = await apiFetch(`/api/access-codes/${id}/close`, { method: 'PATCH' });
    if (res.ok) fetchCodes();
  }

  function copyCode(id: string, code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'TODOS', label: 'Todos' },
    { id: 'ACTIVO', label: 'Activos' },
    { id: 'AGOTADO', label: 'Agotados' },
    { id: 'VENCIDO', label: 'Vencidos' },
    { id: 'CERRADO', label: 'Cerrados' },
    { id: 'PENDIENTES', label: 'Con pendientes' },
  ];
  const countFor = (f: Filter) =>
    codes.filter((c) => (f === 'TODOS' ? true : f === 'PENDIENTES' ? c.progress.pending > 0 : c.lifecycle === f)).length;
  const visibleCodes = codes.filter((c) => (filter === 'TODOS' ? true : filter === 'PENDIENTES' ? c.progress.pending > 0 : c.lifecycle === filter));

  return (
    <div className="max-w-6xl mx-auto space-y-6 text-left">
      <div className="border-b border-slate-200 pb-4 flex items-center justify-between gap-4">
        <div>
          <span className="bg-toast-100 text-charcoal-900 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border border-toast-300 font-mono">
            Autoservicio para tus clientes
          </span>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">Códigos de acceso</h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Un código que reparten a sus clientes — quien lo escribe al registrarse en línea24/7 o en la app queda vinculado automáticamente a su convenio (y, si es una campaña de evaluación, con su evaluación ya asignada).
          </p>
        </div>
        <button
          onClick={openForm}
          className="inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-charcoal-800 cursor-pointer shrink-0"
        >
          <Plus className="h-4 w-4" />
          Nuevo código
        </button>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : codes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-14 text-center">
          <KeyRound className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">Todavía no has creado ningún código de acceso.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => {
              const count = countFor(f.id);
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                    active ? 'border-charcoal-900 bg-charcoal-900 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {f.label}
                  <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
                </button>
              );
            })}
          </div>

          {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-semibold">Código</th>
                  <th className="px-4 py-3 font-semibold">Propósito</th>
                  <th className="px-4 py-3 font-semibold">Convenio</th>
                  <th className="px-4 py-3 font-semibold">Canjes</th>
                  <th className="px-4 py-3 font-semibold">Avance</th>
                  <th className="px-4 py-3 font-semibold">Vence</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 text-right font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleCodes.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">Ningún código en este filtro.</td></tr>
                )}
                {visibleCodes.map((c) => {
                  const style = LIFECYCLE_STYLES[c.lifecycle];
                  const isCampaign = c.purpose === 'EVALUATION_CAMPAIGN';
                  const expanded = expandedId === c.id;
                  // Un código que ya no se puede canjear pero aún tiene evaluaciones
                  // sin resolver NO es "terminado": se resalta para no perderlo de vista.
                  const stalePending = c.lifecycle !== 'ACTIVO' && c.progress.pending > 0;
                  return (
                    <React.Fragment key={c.id}>
                      <tr className={c.lifecycle === 'CERRADO' ? 'opacity-60' : ''}>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => copyCode(c.id, c.code)}
                            title="Copiar código"
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs font-bold text-charcoal-900 hover:bg-toast-50 cursor-pointer"
                          >
                            {c.code}
                            {copiedId === c.id ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-slate-400" />}
                          </button>
                          {c.name && <span className="mt-1 block text-[10.5px] text-slate-400">{c.name}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                            {c.purpose === 'LINEA247' ? <Building2 className="h-3.5 w-3.5 text-toast-500" /> : <ClipboardList className="h-3.5 w-3.5 text-toast-500" />}
                            {PURPOSE_LABELS[c.purpose] || c.purpose}
                          </span>
                          {c.instrument && <span className="mt-0.5 block text-[10.5px] text-slate-400">{c.instrument.name}</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{c.company.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {c.usedCount}{c.maxUses != null ? ` / ${c.maxUses}` : ' / ∞'}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {isCampaign ? (
                            c.progress.redeemed === 0 ? (
                              <span className="text-slate-400">Sin canjes</span>
                            ) : (
                              <div className="space-y-0.5">
                                <span className="text-slate-600">
                                  {c.progress.completed}/{c.progress.redeemed} completadas
                                </span>
                                {c.progress.pending > 0 && (
                                  <span className={`block font-semibold ${stalePending || c.progress.overdue > 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                                    {c.progress.pending} pendiente{c.progress.pending === 1 ? '' : 's'}
                                    {c.progress.overdue > 0 ? ` · ${c.progress.overdue} fuera de plazo` : ''}
                                  </span>
                                )}
                              </div>
                            )
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                          {isCampaign && c.evaluationDeadline && (
                            <span className="mt-0.5 block text-[10.5px] text-slate-400">Plazo: {formatDate(c.evaluationDeadline)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">{formatDate(c.expiresAt)}</td>
                        <td className="px-4 py-3">
                          <span title={style.hint} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${style.badge}`}>
                            {style.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            {c.progress.redeemed > 0 && (
                              <button
                                onClick={() => setExpandedId(expanded ? null : c.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-toast-300 cursor-pointer"
                              >
                                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                Ver canjes
                              </button>
                            )}
                            {c.lifecycle === 'ACTIVO' && (
                              <button
                                onClick={() => handleClose(c.id)}
                                title="Cerrar código"
                                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-rose-300 hover:text-rose-600 cursor-pointer"
                              >
                                <Ban className="h-3.5 w-3.5" />
                                Cerrar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={8} className="px-4 py-4">
                            <RedemptionsPanel
                              code={c}
                              onChanged={(msg) => { if (msg) { setNotice(msg); setTimeout(() => setNotice(null), 4000); } fetchCodes(); }}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-bold text-charcoal-900">Nuevo código de acceso</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-charcoal-900 cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4 px-6 py-5">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Convenio / Cliente *</label>
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                >
                  <option value="">Selecciona...</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">¿Para qué sirve este código? *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPurpose('LINEA247')}
                    className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                      purpose === 'LINEA247' ? 'border-toast-400 bg-toast-50 text-charcoal-900' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    Línea 24/7
                    <span className="mt-0.5 block text-[10px] font-normal text-slate-400">Resuelve el convenio, sin buscarlo por nombre</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPurpose('EVALUATION_CAMPAIGN')}
                    className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                      purpose === 'EVALUATION_CAMPAIGN' ? 'border-toast-400 bg-toast-50 text-charcoal-900' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    Campaña de evaluación
                    <span className="mt-0.5 block text-[10px] font-normal text-slate-400">Además, precarga una evaluación</span>
                  </button>
                </div>
              </div>

              {purpose === 'EVALUATION_CAMPAIGN' && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Instrumento a asignar *</label>
                  <select
                    value={instrumentId}
                    onChange={(e) => setInstrumentId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                  >
                    <option value="">Selecciona...</option>
                    {instruments.map((i) => (
                      <option key={i.id} value={i.id}>{i.nameEs || i.name} ({i.code})</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nombre interno (opcional)</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Bienestar funcionarios Alcaldía 2026"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                />
                <p className="mt-1 text-[10.5px] text-slate-400">Solo para que ustedes lo identifiquen — el cliente nunca lo ve.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Código (opcional)</label>
                  <input
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                    placeholder="Se genera solo"
                    maxLength={20}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-mono text-charcoal-900 outline-none placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cupo máximo</label>
                  <input
                    type="number"
                    min={1}
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                    placeholder="Sin límite"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vigencia del código (opcional)</label>
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                />
                <p className="mt-1 text-[10.5px] text-slate-400">Hasta cuándo se puede CANJEAR (inclusive). Quien ya lo canjeó puede terminar su evaluación después.</p>
              </div>

              {purpose === 'EVALUATION_CAMPAIGN' && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha límite para completar la evaluación (opcional)</label>
                  <input
                    type="date"
                    value={evaluationDeadline}
                    onChange={(e) => setEvaluationDeadline(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                  />
                  <p className="mt-1 text-[10.5px] text-slate-400">Se le muestra al paciente y marca como "fuera de plazo" lo que siga pendiente. No le impide responder tarde.</p>
                </div>
              )}

              {formError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{formError}</p>}

              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-charcoal-900 cursor-pointer">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  {submitting ? 'Creando...' : 'Crear código'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function RedemptionsPanel({ code, onChanged }: { code: AccessCodeRecord; onChanged: (message?: string) => void }) {
  const [rows, setRows] = useState<RedemptionRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // id del canje, o 'ALL'
  const [actionError, setActionError] = useState<string | null>(null);

  const load = () => {
    apiFetch(`/api/access-codes/${code.id}/redemptions`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setRows(await res.json());
      })
      .catch(() => setLoadError('No se pudieron cargar los canjes.'));
  };

  useEffect(load, [code.id]);

  async function remind(redemptionId: string) {
    setBusy(redemptionId);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/access-codes/${code.id}/redemptions/${redemptionId}/remind`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || `HTTP ${res.status}`);
      } else {
        onChanged('Recordatorio enviado.');
      }
      load();
    } catch {
      setActionError('No se pudo contactar el servidor.');
    } finally {
      setBusy(null);
    }
  }

  async function remindAll() {
    setBusy('ALL');
    setActionError(null);
    try {
      const res = await apiFetch(`/api/access-codes/${code.id}/remind-pending`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || `HTTP ${res.status}`);
      } else {
        const skipped = data.skippedRecently ? ` (${data.skippedRecently} ya recibieron uno en las últimas 24 h)` : '';
        onChanged(`Recordatorios enviados: ${data.sent}${skipped}.`);
      }
      load();
    } catch {
      setActionError('No se pudo contactar el servidor.');
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <p className="text-sm text-rose-600">{loadError}</p>;
  if (!rows) return <div className="flex justify-center py-4 text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /></div>;

  const remindable = rows.filter((r) => r.canRemind).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {rows.length} {rows.length === 1 ? 'persona canjeó' : 'personas canjearon'} este código. Solo se muestra el estado de la evaluación, no sus resultados.
        </p>
        {code.purpose === 'EVALUATION_CAMPAIGN' && (
          <button
            onClick={remindAll}
            disabled={busy !== null || remindable === 0}
            title={remindable === 0 ? 'No hay pendientes por recordar (o ya se les recordó hoy)' : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-charcoal-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-charcoal-800 disabled:opacity-40 cursor-pointer"
          >
            {busy === 'ALL' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
            Recordar a los pendientes ({remindable})
          </button>
        )}
      </div>

      {actionError && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700">{actionError}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[10.5px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2 font-semibold">Paciente</th>
              <th className="px-3 py-2 font-semibold">Canjeó</th>
              <th className="px-3 py-2 font-semibold">Evaluación</th>
              <th className="px-3 py-2 font-semibold">Recordatorios</th>
              <th className="px-3 py-2 text-right font-semibold" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <span className="block font-semibold text-charcoal-900">{r.patient.firstName} {r.patient.lastName}</span>
                  <span className="block text-[10.5px] text-slate-400">{r.patient.documentId}{r.patient.email ? ` · ${r.patient.email}` : ''}</span>
                </td>
                <td className="px-3 py-2 text-slate-500">{formatDate(r.redeemedAt)}</td>
                <td className="px-3 py-2">
                  {r.evaluation ? (
                    <>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${EVAL_STATE_STYLES[r.evaluation.state].badge}`}>
                        {EVAL_STATE_STYLES[r.evaluation.state].label}
                      </span>
                      <span className="mt-0.5 block text-[10.5px] text-slate-400">
                        {r.evaluation.completedAt ? `Terminó ${formatDate(r.evaluation.completedAt)}` : r.evaluation.dueAt ? `Plazo ${formatDate(r.evaluation.dueAt)}` : r.evaluation.instrumentName}
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-300">Sin evaluación</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {r.reminderCount > 0 ? `${r.reminderCount} · último ${formatDate(r.lastRemindedAt)}` : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.evaluation && r.evaluation.state !== 'COMPLETADA' && r.evaluation.state !== 'INVALIDA' && (
                    <button
                      onClick={() => remind(r.id)}
                      disabled={!r.canRemind || busy !== null}
                      title={r.canRemind ? 'Enviarle un recordatorio' : 'Ya se le recordó en las últimas 24 horas'}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-toast-300 disabled:opacity-40 cursor-pointer"
                    >
                      {busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <BellRing className="h-3 w-3" />}
                      Recordar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
