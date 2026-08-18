/**
 * AssessmentsPanel.tsx
 *
 * Tab "Pruebas y Evaluaciones". Tres piezas:
 *   1. Catálogo de instrumentos publicados (viene de la DB, no de mockData).
 *   2. Asignación de una prueba a un paciente del tenant, filtrable por convenio.
 *   3. Listado de aplicaciones: pendientes por resolver y ya calificadas.
 *
 * El catálogo se muestra COMPLETO aunque el instrumento no sea aplicable
 * digitalmente. Los de licencia propietaria (tier B) se aplican por fuera y
 * aquí solo se registra el puntaje — capar el catálogo escondería instrumentos
 * que el psicólogo sí usa en consulta.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  ClipboardList, Search, X, Loader2, CheckCircle2, AlertTriangle,
  ShieldAlert, Lock,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useCompanies } from '../../hooks/useCompanies';
import AssessmentRunner from './AssessmentRunner';

interface CatalogItem {
  id: string;
  code: string;
  version: string;
  name: string;
  nameEs: string | null;
  domain: string;
  area: string;
  construct: string;
  tier: string;
  license: string;
  publisher: string | null;
  minAge: number;
  maxAge: number;
  durationMin: number | null;
  modality: string;
  itemCount: number;
  applicable: boolean;
}

interface AdministrationRow {
  id: string;
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'INVALID';
  assignedAt: string;
  completedAt: string | null;
  companyName: string | null;
  instrument: { code: string; name: string; version: string; tier: string };
  patient: { id: string; firstName: string; lastName: string; recordNumber: string | null };
  results: { scaleId: string; rawScore: number; maxTheoretical: number; label: string | null }[];
  firedAlerts: { alertId: string; severity: string }[];
}

interface PatientOption {
  id: string;
  firstName: string;
  lastName: string;
  documentId: string;
  recordNumber?: string | null;
  companyId?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: 'Asignada',
  IN_PROGRESS: 'En progreso',
  COMPLETED: 'Calificada',
  INVALID: 'Inválida',
};

const STATUS_STYLE: Record<string, string> = {
  ASSIGNED: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  INVALID: 'bg-red-50 text-red-700',
};

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export default function AssessmentsPanel() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [administrations, setAdministrations] = useState<AdministrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [runnerId, setRunnerId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<CatalogItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catalogRes, adminRes] = await Promise.all([
        apiFetch('/api/assessments/catalog'),
        apiFetch('/api/assessments/administrations'),
      ]);
      if (catalogRes.ok) setCatalog((await catalogRes.json()).instruments || []);
      if (adminRes.ok) setAdministrations((await adminRes.json()).administrations || []);
    } catch (err) {
      console.error('[AssessmentsPanel] Error cargando:', err);
      toast.error('No se pudo cargar el módulo de pruebas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((t) =>
      t.code.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      (t.nameEs || '').toLowerCase().includes(q) ||
      t.area.toLowerCase().includes(q) ||
      t.construct.toLowerCase().includes(q)
    );
  }, [catalog, query]);

  const pending = administrations.filter((a) => a.status !== 'COMPLETED');
  const completed = administrations.filter((a) => a.status === 'COMPLETED');

  if (runnerId) {
    return (
      <AssessmentRunner
        administrationId={runnerId}
        onBack={() => { setRunnerId(null); load(); }}
        onCompleted={load}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 text-left">
      {/* ── Pendientes ──────────────────────────────────────────────── */}
      {pending.length > 0 && (
        <section className="rounded-xl border border-slate-100 bg-white p-5">
          <h2 className="mb-4 text-sm font-bold text-slate-900">
            Pruebas pendientes ({pending.length})
          </h2>
          <div className="space-y-2">
            {pending.map((a) => (
              <button
                key={a.id}
                onClick={() => setRunnerId(a.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-toast-500 hover:bg-toast-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {a.instrument.code} · {a.patient.firstName} {a.patient.lastName}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    Asignada {formatDate(a.assignedAt)}
                    {a.companyName && ` · ${a.companyName}`}
                  </p>
                </div>
                <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase ${STATUS_STYLE[a.status]}`}>
                  {STATUS_LABEL[a.status]}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Catálogo ────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-100 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-900">Catálogo de Pruebas Psicotécnicas</h2>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por sigla, nombre o constructo…"
              className="w-72 rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-toast-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-10 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            {catalog.length === 0
              ? 'Aún no hay instrumentos publicados. Cárgalos con scripts/seed-instruments.js.'
              : 'Ningún instrumento coincide con la búsqueda.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filtered.map((test) => (
              <div key={test.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    {test.code}
                    <span className="ml-2 text-xs font-normal text-slate-400">v{test.version}</span>
                  </p>
                  <p className="truncate text-xs text-slate-500">{test.nameEs || test.name}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {test.area} · {test.itemCount} ítems · {test.minAge}-{test.maxAge} años
                    {test.durationMin && ` · ~${test.durationMin} min`}
                  </p>
                  {!test.applicable && (
                    <p className="mt-1.5 inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                      <Lock className="h-3 w-3" />
                      {test.license === 'propietaria' ? 'Licencia propietaria — solo registro' : 'Solo catálogo'}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setAssignTarget(test)}
                  className="shrink-0 text-xs font-bold text-toast-500 hover:underline"
                >
                  Asignar
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Calificadas ─────────────────────────────────────────────── */}
      {completed.length > 0 && (
        <section className="rounded-xl border border-slate-100 bg-white p-5">
          <h2 className="mb-4 text-sm font-bold text-slate-900">
            Aplicaciones calificadas ({completed.length})
          </h2>
          <div className="space-y-2">
            {completed.map((a) => {
              const primary = a.results[0];
              const critical = a.firedAlerts.some((x) => x.severity === 'CRITICA');
              return (
                <button
                  key={a.id}
                  onClick={() => setRunnerId(a.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {critical
                      ? <ShieldAlert className="h-5 w-5 shrink-0 text-red-600" />
                      : <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {a.instrument.code} · {a.patient.firstName} {a.patient.lastName}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {formatDate(a.completedAt)}
                        {primary?.label && ` · ${primary.label}`}
                      </p>
                    </div>
                  </div>
                  {primary && (
                    <span className="shrink-0 rounded-lg bg-toast-100 px-3 py-1 text-sm font-bold text-toast-500">
                      {primary.rawScore} / {primary.maxTheoretical}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {assignTarget && (
        <AssignModal
          instrument={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssigned={(administrationId) => {
            setAssignTarget(null);
            load();
            setRunnerId(administrationId);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal de asignación — busca pacientes del tenant, filtrables por convenio
// ─────────────────────────────────────────────────────────────────────────────
function AssignModal({
  instrument, onClose, onAssigned,
}: {
  instrument: CatalogItem;
  onClose: () => void;
  onAssigned: (administrationId: string) => void;
}) {
  const { companies } = useCompanies();
  const [query, setQuery] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [selected, setSelected] = useState<PatientOption | null>(null);
  const [appliedMode, setAppliedMode] = useState(instrument.modality);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: '1', limit: '10' });
        if (query.trim()) params.set('q', query.trim());
        if (companyId) params.set('companyId', companyId);
        const res = await apiFetch(`/api/patients?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setPatients(Array.isArray(data.patients) ? data.patients : []);
        }
      } catch (err) {
        console.error('[AssignModal] Error buscando pacientes:', err);
      } finally {
        setLoading(false);
      }
    }, query ? 300 : 0);
    return () => clearTimeout(handle);
  }, [query, companyId]);

  const assign = async () => {
    if (!selected) return;
    setAssigning(true);
    try {
      const res = await apiFetch('/api/assessments/administrations', {
        method: 'POST',
        body: JSON.stringify({
          instrumentCode: instrument.code,
          patientId: selected.id,
          appliedMode,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || 'No se pudo asignar la prueba.');
        return;
      }
      toast.success(`${instrument.code} asignada a ${selected.firstName} ${selected.lastName}.`);
      onAssigned(data.administration.id);
    } catch (err) {
      console.error('[AssignModal] Error asignando:', err);
      toast.error('No se pudo asignar la prueba.');
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Asignar {instrument.code}
            </h3>
            <p className="text-xs text-slate-500">{instrument.nameEs || instrument.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!instrument.applicable && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs leading-relaxed text-amber-800">
              Instrumento de licencia {instrument.license}
              {instrument.publisher && ` (${instrument.publisher})`}. Se aplica por fuera de MindPsic
              y aquí solo se registra el resultado.
            </p>
          </div>
        )}

        {/* Filtros */}
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar paciente por nombre o documento…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-toast-500"
            />
          </div>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-toast-500"
          >
            <option value="">Todos los convenios</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Resultados */}
        <div className="mb-4 max-h-64 space-y-1.5 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-6 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : patients.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Sin pacientes que coincidan.</p>
          ) : (
            patients.map((p) => {
              const active = selected?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'border-toast-500 bg-toast-50'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className="font-semibold text-slate-900">
                    {p.firstName} {p.lastName}
                  </span>
                  <span className="text-xs text-slate-400">
                    {p.recordNumber || p.documentId}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Modo de aplicación */}
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">
            Modo de aplicación
            <select
              value={appliedMode}
              onChange={(e) => setAppliedMode(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-toast-500"
            >
              <option value="autoaplicada">Autoaplicada (responde el paciente)</option>
              <option value="heteroaplicada">Heteroaplicada (responde el profesional)</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Nota (opcional)
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Motivo de la aplicación"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-toast-500"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={assign}
            disabled={!selected || assigning}
            className="inline-flex items-center gap-2 rounded-lg bg-toast-500 px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40"
          >
            {assigning
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Asignando…</>
              : <><ClipboardList className="h-3.5 w-3.5" /> Asignar prueba</>}
          </button>
        </div>
      </div>
    </div>
  );
}
