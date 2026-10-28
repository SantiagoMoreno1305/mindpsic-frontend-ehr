import { useEffect, useRef, useState } from 'react';
import { Search, FileText, Users, ChevronLeft, ChevronRight, ClipboardX, X } from 'lucide-react';
import { apiFetch, getApiBase } from '../../lib/apiClient';

const PAGE_SIZE = 10;

interface RealPatient {
  id: string;
  firstName: string;
  lastName: string;
  documentId: string;
  email?: string | null;
  phone?: string | null;
  recordNumber?: string | null;
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

// Caché en memoria por combinación exacta de búsqueda+página (decisión
// 2026-10-27, mismo patrón que patientsListCache en PacientesPanel.tsx) —
// "Expedientes" se desmonta por completo al salir de "Historias Clínicas" o
// al entrar a la ficha de un paciente, y se remonta desde cero al volver.
// TTL corto (30s): esta lista puede cambiar (altas de pacientes nuevas).
const EXPEDIENTES_CACHE_TTL_MS = 30 * 1000;
interface ExpedientesCacheEntry {
  patients: RealPatient[];
  total: number;
  ts: number;
}
const expedientesCache = new Map<string, ExpedientesCacheEntry>();

// Mismo criterio que invalidatePatientsListCache/invalidatePendingDocsCache —
// se llama en logout/cambio de sesión (ver App.tsx/Login.tsx).
export function invalidateExpedientesCache(): void {
  expedientesCache.clear();
}

export default function ClinicalRecordsList({
  onSelect,
}: {
  onSelect: (patientId: string) => void;
}) {
  const [query, setQuery] = useState(readSearchQuery());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pendingRips, setPendingRips] = useState<PendingRipsPatient[]>([]);
  const [showPendingRips, setShowPendingRips] = useState(false);

  // RENDIMIENTO (mismo criterio que PacientesPanel, ver su comentario de
  // cabecera): esta pestaña ("Expedientes") antes recibía el listado
  // COMPLETO del tenant vía el hook usePatients (sin paginar) y filtraba del
  // lado del cliente. Con un tenant de miles/cientos de miles de pacientes
  // eso significa traer todo a memoria del navegador en cada login — además
  // de bloquear el primer render de AdminPortal completo, que esperaba a que
  // esa carga terminara. Se cambia a paginar y buscar del lado del servidor,
  // igual que /api/patients?q=&page=&limit= en PacientesPanel (decisión
  // 2026-10-27).
  //
  // Sembrar desde el caché (si hay) para la combinación query+página=1 con
  // la que arranca el componente — sin esto, el PRIMER render siempre pinta
  // "Cargando…" (el valor inicial de `loading`) y recién en el siguiente
  // tick se corrige con lo cacheado (el efecto de fetchPatients corre en un
  // setTimeout). Ese salto es el parpadeo reportado en producción.
  const initialCacheParams = new URLSearchParams({ page: '1', limit: String(PAGE_SIZE) });
  if (query.trim()) initialCacheParams.set('q', query.trim());
  const initialCached = expedientesCache.get(initialCacheParams.toString());

  const [patients, setPatients] = useState<RealPatient[]>(initialCached?.patients ?? []);
  const [total, setTotal] = useState(initialCached?.total ?? 0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(!initialCached);

  useEffect(() => {
    const token = localStorage.getItem('mind_token');
    const apiBase = getApiBase();
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

  const fetchPatients = async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (query.trim()) params.set('q', query.trim());
    const cacheKey = params.toString();

    const cached = expedientesCache.get(cacheKey);
    if (cached) {
      // Instantáneo: se pinta lo que ya había, sin "Cargando…".
      setPatients(cached.patients);
      setTotal(cached.total);
      setLoading(false);
      if (Date.now() - cached.ts < EXPEDIENTES_CACHE_TTL_MS) return; // sigue fresco, nada que revalidar
      // vencido — se deja lo cacheado en pantalla y se revalida abajo en silencio.
    } else {
      setLoading(true);
    }

    try {
      const res = await apiFetch(`/api/patients?${cacheKey}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const nextPatients: RealPatient[] = Array.isArray(data.patients) ? data.patients : [];
      const nextTotal = typeof data.total === 'number' ? data.total : 0;
      expedientesCache.set(cacheKey, { patients: nextPatients, total: nextTotal, ts: Date.now() });
      setPatients(nextPatients);
      setTotal(nextTotal);
    } catch (err) {
      console.error('[ClinicalRecordsList] Error cargando pacientes:', err);
      if (!cached) {
        setPatients([]);
        setTotal(0);
      }
      // Si había algo cacheado (aunque vencido), se deja en pantalla en vez
      // de vaciarlo por un error de red pasajero durante la revalidación.
    } finally {
      setLoading(false);
    }
  };

  // Búsqueda con debounce (igual que PacientesPanel) — cambiar de página se
  // aplica de inmediato.
  useEffect(() => {
    const handle = setTimeout(fetchPatients, query ? 300 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query]);

  // Una búsqueda nueva cambia el conjunto de resultados — si te quedabas en
  // la página 3, un filtro que deja solo 1 resultado no debe seguir
  // mostrando una página vacía.
  const isFirstQueryRun = useRef(true);
  useEffect(() => {
    if (isFirstQueryRun.current) {
      isFirstQueryRun.current = false;
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="mx-auto max-w-7xl">
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
            placeholder="Buscar por nombre, documento o número de historia clínica..."
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
          {patients.map((p) => {
            const initials = `${p.firstName?.[0] ?? ''}${p.lastName?.[0] ?? ''}`.toUpperCase();
            return (
              <li key={p.id}>
                <button
                  onClick={() => onSelect(p.id)}
                  className="group flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-slate-50 sm:rounded-lg sm:px-3"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-toast-100 text-xs font-bold text-toast-500">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {p.firstName} {p.lastName}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                      Documento: {p.documentId}
                      {p.email ? ` · ${p.email}` : ''}
                    </p>
                  </div>
                  <div className="hidden shrink-0 flex-col items-end sm:flex">
                    <span className="text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">N.º historia</span>
                    <span className="font-mono text-xs text-slate-600">{p.recordNumber || '—'}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>
            );
          })}
          {!loading && patients.length === 0 && (
            <li className="py-10 text-center text-sm text-slate-400">
              {query ? <>No se encontraron pacientes para &ldquo;{query}&rdquo;.</> : 'No hay pacientes registrados.'}
            </li>
          )}
        </ul>

        {total > 0 && (
          <div className="mt-4 flex flex-col items-center justify-between gap-2 border-t border-slate-100 pt-3 sm:flex-row">
            <span className="text-xs text-slate-400">
              Mostrando {rangeStart}–{rangeEnd} de {total.toLocaleString('es-CO')}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-charcoal-900 transition-colors hover:bg-toast-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Anterior
              </button>
              <span className="px-2 text-xs text-slate-400">Página {page} de {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-charcoal-900 transition-colors hover:bg-toast-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Siguiente <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
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
      className={`rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm ${onClick ? 'cursor-pointer transition-colors hover:bg-slate-50' : ''}`}
    >
      <div className="flex items-center gap-1.5 text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className={highlight ? 'mt-0.5 text-lg font-bold text-amber-600' : 'mt-0.5 text-lg font-bold text-slate-900'}>
        {value}
      </p>
    </Wrapper>
  );
}
