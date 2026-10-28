/**
 * PendingDocumentationTab.tsx
 *
 * Pestaña "Pendientes" de Historias Clínicas (decisión 2026-10-27) — ver
 * GET /api/clinical-history/pending en el backend (pending-documentation.service.js)
 * para el detalle de qué se considera "pendiente" y sus límites conocidos.
 *
 * La unidad de cada fila es un DOCUMENTO requerido para una atención, o un
 * documento existente sin firmar — nunca el paciente completo.
 */
import { useEffect, useRef, useState } from 'react';
import { Search, Filter, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

interface PendingItem {
  tipo: 'EVALUACION_INICIAL' | 'EVOLUCION';
  patientId: string;
  firstName: string;
  lastName: string;
  documentId: string;
  recordNumber: string | null;
  atencionFecha: string;
  clinicalHistoryId: string | null;
  estado: 'SIN_REGISTRO' | 'BORRADOR';
  ultimoGuardado: string | null;
  profesionalResponsable: string | null;
}

interface SpecialistOption {
  id: string;
  name: string;
}

const PAGE_SIZE = 20;
const TIPO_LABELS: Record<string, string> = { EVALUACION_INICIAL: 'Evaluación inicial', EVOLUCION: 'Evolución' };
const ESTADO_LABELS: Record<string, string> = { SIN_REGISTRO: 'Sin registro', BORRADOR: 'Borrador' };

// Caché en memoria por combinación exacta de filtros+página (decisión
// 2026-10-27, mismo patrón que patientsListCache en PacientesPanel.tsx) —
// esta pestaña se desmonta por completo al salir de "Historias Clínicas" o
// al entrar a la ficha de un paciente, y se remonta desde cero al volver.
// Sin esto, cada regreso mostraba "Cargando…" aunque los mismos filtros ya
// se hubieran consultado segundos antes. TTL corto (30s): esta lista puede
// cambiar seguido (nuevas atenciones, borradores firmados).
const PENDING_DOCS_CACHE_TTL_MS = 30 * 1000;
interface PendingDocsCacheEntry {
  items: PendingItem[];
  total: number;
  ts: number;
}
const pendingDocsCache = new Map<string, PendingDocsCacheEntry>();

// Mismo criterio que invalidatePatientsListCache — se llama en logout/cambio
// de sesión (ver App.tsx/Login.tsx) para que una cuenta de OTRO tenant en la
// misma pestaña no siga viendo documentación pendiente del tenant anterior.
export function invalidatePendingDocsCache(): void {
  pendingDocsCache.clear();
}

// Zona horaria del producto (decisión 2026-10-27) — la clínica opera en
// Colombia, las horas se presentan en America/Bogota sin importar dónde
// esté físicamente el navegador que las ve.
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PendingDocumentationTab({ token, userRole, onSelectPatient }: {
  token: string | null;
  userRole?: string;
  onSelectPatient: (patientId: string) => void;
}) {
  // Alcance fijo por rol (decisión 2026-10-27, charla con el usuario): no
  // existe "equipo"/supervisor en el modelo, así que cada rol tiene
  // exactamente un alcance posible, sin selector — ESPECIALISTA_B2B siempre
  // "Mis pacientes", DIRECTIVO/CEO siempre "Clínica" (con filtro de
  // profesional, porque ahí sí hay varias personas en el listado).
  const isClinicaScope = userRole === 'CEO' || userRole === 'DIRECTIVO';

  // Sembrar el estado inicial desde el caché (si hay) — todos los filtros
  // empiezan vacíos/en página 1, así que esta es siempre la misma clave con
  // la que arranca el componente. Sin esto, el PRIMER render siempre pinta
  // "Cargando…" (el valor inicial de `loading`) y recién en el siguiente
  // tick (el efecto de fetchPending corre en un setTimeout) se corrige con
  // lo cacheado — ese salto entre el estado de carga y el de datos es
  // exactamente el parpadeo reportado en producción, aunque el caché ya
  // tuviera el dato listo.
  const initialCacheKey = new URLSearchParams({ page: '1', limit: String(PAGE_SIZE) }).toString();
  const initialCached = pendingDocsCache.get(initialCacheKey);

  const [items, setItems] = useState<PendingItem[]>(initialCached?.items ?? []);
  const [total, setTotal] = useState(initialCached?.total ?? 0);
  const [loading, setLoading] = useState(!initialCached);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [estado, setEstado] = useState('');
  const [tipo, setTipo] = useState('');
  const [profesionalId, setProfesionalId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);

  useEffect(() => {
    if (!isClinicaScope) return;
    apiFetch('/api/users/specialists')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setSpecialists(Array.isArray(data?.specialists) ? data.specialists : Array.isArray(data) ? data : []))
      .catch(() => setSpecialists([]));
  }, [isClinicaScope]);

  const fetchPending = async () => {
    if (!token) { setLoading(false); return; }
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (query.trim()) params.set('q', query.trim());
    if (estado) params.set('estado', estado);
    if (tipo) params.set('tipo', tipo);
    if (isClinicaScope && profesionalId) params.set('profesionalId', profesionalId);
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    const cacheKey = params.toString();

    const cached = pendingDocsCache.get(cacheKey);
    if (cached) {
      // Instantáneo: se pinta lo que ya había, sin "Cargando…".
      setItems(cached.items);
      setTotal(cached.total);
      setLoading(false);
      setError(false);
      if (Date.now() - cached.ts < PENDING_DOCS_CACHE_TTL_MS) return; // sigue fresco, nada que revalidar
      // vencido — se deja lo cacheado en pantalla y se revalida abajo en silencio.
    } else {
      setLoading(true);
      setError(false);
    }

    try {
      const res = await apiFetch(`/api/clinical-history/pending?${cacheKey}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const nextItems: PendingItem[] = Array.isArray(data.items) ? data.items : [];
      const nextTotal = typeof data.total === 'number' ? data.total : 0;
      pendingDocsCache.set(cacheKey, { items: nextItems, total: nextTotal, ts: Date.now() });
      setItems(nextItems);
      setTotal(nextTotal);
    } catch {
      if (!cached) {
        setError(true);
        setItems([]);
        setTotal(0);
      }
      // Si había algo cacheado (aunque vencido), se deja en pantalla en vez
      // de vaciarlo por un error de red pasajero durante la revalidación.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handle = setTimeout(fetchPending, query ? 300 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, page, query, estado, tipo, profesionalId, desde, hasta]);

  const isFirstFilterRun = useRef(true);
  useEffect(() => {
    if (isFirstFilterRun.current) { isFirstFilterRun.current = false; return; }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, estado, tipo, profesionalId, desde, hasta]);

  const hasActiveFilters = !!(estado || tipo || profesionalId || desde || hasta);
  function clearFilters() {
    setEstado(''); setTipo(''); setProfesionalId(''); setDesde(''); setHasta('');
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const colSpan = isClinicaScope ? 7 : 6;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full flex-1 sm:min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, documento o código..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-9 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} title="Limpiar búsqueda" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-charcoal-900 cursor-pointer">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
          <Filter className="h-3.5 w-3.5" />
          Filtros:
        </span>
        <input
          type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
          title="Fecha de atención — desde"
          className="w-[8.5rem] rounded-lg border border-slate-200 bg-slate-50 py-2 px-2 text-xs text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
        />
        <input
          type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
          title="Fecha de atención — hasta"
          className="w-[8.5rem] rounded-lg border border-slate-200 bg-slate-50 py-2 px-2 text-xs text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
        />
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-xs font-medium text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20">
          <option value="">Todos los estados</option>
          <option value="SIN_REGISTRO">Sin registro</option>
          <option value="BORRADOR">Borrador</option>
        </select>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-xs font-medium text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20">
          <option value="">Todos los tipos</option>
          <option value="EVALUACION_INICIAL">Evaluación inicial</option>
          <option value="EVOLUCION">Evolución</option>
        </select>
        {isClinicaScope && (
          <select value={profesionalId} onChange={(e) => setProfesionalId(e.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-xs font-medium text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20">
            <option value="">Todos los psicólogos</option>
            {specialists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {hasActiveFilters && (
          <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-charcoal-900 cursor-pointer">
            <X className="h-3.5 w-3.5" />
            Limpiar filtros
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2.5 font-semibold">Paciente</th>
              <th className="px-3 py-2.5 font-semibold">Atención</th>
              <th className="px-3 py-2.5 font-semibold">Tipo de registro</th>
              {isClinicaScope && <th className="px-3 py-2.5 font-semibold">Profesional responsable</th>}
              <th className="px-3 py-2.5 font-semibold">Estado documental</th>
              <th className="px-3 py-2.5 font-semibold">Último guardado</th>
              <th className="px-3 py-2.5 text-right font-semibold">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={colSpan} className="py-10 text-center text-sm text-slate-400">Cargando…</td></tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={colSpan} className="py-10 text-center text-sm text-rose-500">
                  No se pudo cargar la documentación pendiente.{' '}
                  <button type="button" onClick={fetchPending} className="font-semibold underline cursor-pointer">Reintentar</button>
                </td>
              </tr>
            )}
            {!loading && !error && items.length === 0 && !hasActiveFilters && !query.trim() && (
              <tr><td colSpan={colSpan} className="py-10 text-center text-sm text-slate-400">No tienes documentación pendiente.</td></tr>
            )}
            {!loading && !error && items.length === 0 && (hasActiveFilters || query.trim()) && (
              <tr><td colSpan={colSpan} className="py-10 text-center text-sm text-slate-400">No encontramos registros con estos filtros.</td></tr>
            )}
            {!loading && !error && items.map((it, idx) => (
              <tr
                key={`${it.tipo}-${it.patientId}-${it.clinicalHistoryId || idx}`}
                onClick={() => onSelectPatient(it.patientId)}
                className="cursor-pointer transition-colors hover:bg-toast-50/40"
              >
                <td className="whitespace-nowrap px-3 py-3">
                  <span className="block font-semibold text-charcoal-900">{it.firstName} {it.lastName}</span>
                  <span className="block font-mono text-[10.5px] text-slate-400">
                    {it.recordNumber ? `${it.recordNumber} · ` : ''}{it.documentId}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatDateTime(it.atencionFecha)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-600">{TIPO_LABELS[it.tipo] || it.tipo}</td>
                {isClinicaScope && (
                  <td className="whitespace-nowrap px-3 py-3">
                    {it.profesionalResponsable
                      ? <span className="text-slate-600">{it.profesionalResponsable}</span>
                      : <span className="italic text-slate-400">Por asignar</span>}
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-3">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${it.estado === 'BORRADOR' ? 'text-amber-600' : 'text-slate-500'}`}>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${it.estado === 'BORRADOR' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                    {ESTADO_LABELS[it.estado] || it.estado}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-500">{it.ultimoGuardado ? formatDate(it.ultimoGuardado) : '—'}</td>
                <td className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onSelectPatient(it.patientId); }}
                    className="text-xs font-semibold text-toast-500 hover:underline cursor-pointer"
                  >
                    {it.estado === 'BORRADOR' ? 'Continuar borrador' : 'Registrar atención'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && !error && total > 0 && (
        <div className="mt-4 flex flex-col items-center justify-between gap-2 border-t border-slate-100 pt-3 sm:flex-row">
          <span className="text-xs text-slate-400">{total.toLocaleString('es-CO')} pendiente(s)</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-charcoal-900 transition-colors hover:bg-toast-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Anterior
            </button>
            <span className="px-2 text-xs text-slate-400">Página {page} de {totalPages}</span>
            <button
              type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-charcoal-900 transition-colors hover:bg-toast-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Siguiente <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
