import { useEffect, useMemo, useState } from 'react';
import { Search, FileText, Users, ChevronRight, ClipboardX, X } from 'lucide-react';

interface RealPatient {
  id: string;
  firstName: string;
  lastName: string;
  documentId: string;
  email?: string | null;
  phone?: string | null;
}

interface Summary {
  totalPatients: number;
  patientsWithHistory: number;
  unsignedDrafts: number;
}

interface PendingRipsPatient {
  id: string;
  firstName: string;
  lastName: string;
  recordNumber?: string | null;
}

// Igual que en PacientesPanel: este componente se desmonta por completo al
// entrar a la ficha de un paciente y se remonta desde cero al volver — sin
// esto, la búsqueda quedaba en blanco cada vez. sessionStorage (no
// localStorage) porque solo debe durar mientras la pestaña siga abierta.
const SEARCH_STATE_KEY = 'mind_clinical_records_search_state';

function readSearchQuery(): string {
  try {
    return sessionStorage.getItem(SEARCH_STATE_KEY) || '';
  } catch {
    return '';
  }
}

export default function ClinicalRecordsList({
  patients,
  onSelect,
}: {
  patients: RealPatient[];
  onSelect: (patientId: string) => void;
}) {
  const [query, setQuery] = useState(readSearchQuery());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pendingRips, setPendingRips] = useState<PendingRipsPatient[]>([]);
  const [showPendingRips, setShowPendingRips] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('mind_token');
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';
    const headers = { 'Authorization': `Bearer ${token}` };

    const fetchSummary = async () => {
      try {
        const res = await fetch(`${apiBase}/api/clinical-history/summary`, { headers });
        if (!res.ok) return;
        setSummary(await res.json());
      } catch {
        // Silencioso — las tarjetas simplemente no se muestran
      }
    };

    const fetchPendingRips = async () => {
      try {
        const res = await fetch(`${apiBase}/api/rips-diagnosis/pending`, { headers });
        if (!res.ok) return;
        const data = await res.json();
        setPendingRips(data.pending || []);
      } catch {
        // Silencioso
      }
    };

    fetchSummary();
    fetchPendingRips();
  }, []);

  useEffect(() => {
    sessionStorage.setItem(SEARCH_STATE_KEY, query);
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => {
      const name = `${p.firstName} ${p.lastName}`.toLowerCase();
      return name.includes(q) || p.documentId?.toLowerCase().includes(q);
    });
  }, [patients, query]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Gestor de Historias Clínicas</h1>
          <p className="mt-1 text-sm text-slate-400">
            Seleccione un paciente para ver o redactar su evolución clínica, firmar digitalmente y subir anexos.
          </p>
        </div>
      </div>

      {summary && (
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Users} label="Pacientes" value={summary.totalPatients} />
          <StatCard icon={FileText} label="Historias abiertas" value={summary.patientsWithHistory} />
          <StatCard
            icon={FileText}
            label="Notas sin firmar"
            value={summary.unsignedDrafts}
            highlight={summary.unsignedDrafts > 0}
          />
          <StatCard
            icon={ClipboardX}
            label="Sin diagnóstico RIPS (mes)"
            value={pendingRips.length}
            highlight={pendingRips.length > 0}
            onClick={pendingRips.length > 0 ? () => setShowPendingRips((v) => !v) : undefined}
          />
        </div>
      )}

      {showPendingRips && pendingRips.length > 0 && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-700">
            Pacientes atendidos este mes sin diagnóstico RIPS
          </p>
          <ul className="flex flex-col gap-1.5">
            {pendingRips.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onSelect(p.id)}
                  className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-slate-900 hover:bg-amber-100"
                >
                  {p.firstName} {p.lastName} {p.recordNumber ? <span className="text-slate-400">· {p.recordNumber}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="relative mb-4 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o documento..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-9 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              title="Limpiar búsqueda"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-charcoal-900 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <ul className="flex flex-col divide-y divide-slate-200">
          {filtered.map((p) => {
            const initials = `${p.firstName?.[0] ?? ''}${p.lastName?.[0] ?? ''}`.toUpperCase();
            return (
              <li key={p.id}>
                <button
                  onClick={() => onSelect(p.id)}
                  className="group flex w-full items-center gap-4 py-3 text-left transition-colors hover:bg-slate-50 sm:rounded-lg sm:px-3"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-toast-100 text-sm font-bold text-toast-500">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">
                      {p.firstName} {p.lastName}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      Documento: {p.documentId}
                      {p.email ? ` · ${p.email}` : ''}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="py-10 text-center text-sm text-slate-400">
              No se encontraron pacientes para &ldquo;{query}&rdquo;.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  highlight,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  highlight?: boolean;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={`rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm ${onClick ? 'cursor-pointer transition-colors hover:bg-slate-50' : ''}`}
    >
      <div className="flex items-center gap-2 text-slate-400">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={highlight ? 'mt-1 text-2xl font-bold text-amber-600' : 'mt-1 text-2xl font-bold text-slate-900'}>
        {value}
      </p>
    </Wrapper>
  );
}
