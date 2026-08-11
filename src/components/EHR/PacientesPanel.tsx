/**
 * PacientesPanel.tsx
 *
 * Tab "Pacientes": listado general + creación + agendamiento. Compartido
 * entre PsychologistPortal (ESPECIALISTA_B2B) y AdminPortal (CEO/DIRECTIVO/
 * OPERATIVO) — el backend ya expone /api/patients y /api/appointments a
 * cualquier rol autenticado del tenant, así que la disponibilidad real la
 * da simplemente montar este componente en el tab de cada portal.
 *
 * RENDIMIENTO: esta tabla NO usa el hook usePatients (trae el listado
 * completo del tenant, pensado para vistas acotadas). Un tenant real puede
 * tener decenas o cientos de miles de pacientes, así que aquí se pagina y
 * busca del lado del servidor — GET /api/patients?q=&page=&limit=20 — nunca
 * se trae todo de una vez.
 */
import { useEffect, useState } from 'react';
import { Search, UserPlus, CalendarPlus, Users, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import CreatePatientModal from './CreatePatientModal';
import DelegatedAppointmentModal, { prefetchSelectoresAgendamiento } from '../DelegatedAppointmentModal';
import type { BackendPatient } from '../../types';

interface PacientesPanelProps {
  token: string | null;
}

const PAGE_SIZE = 10;

export default function PacientesPanel({ token }: PacientesPanelProps) {
  const [patients, setPatients] = useState<BackendPatient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForPatient, setScheduleForPatient] = useState<BackendPatient | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // RENDIMIENTO: desde este panel se agenda constantemente, así que se precargan
  // los catálogos al montar para que el modal abra sin espera perceptible.
  useEffect(() => {
    prefetchSelectoresAgendamiento();
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  const fetchPatients = async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (query.trim()) params.set('q', query.trim());
      const res = await apiFetch(`/api/patients?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPatients(Array.isArray(data.patients) ? data.patients : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
    } catch (err) {
      console.error('[PacientesPanel] Error cargando pacientes:', err);
      setPatients([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  // Cambiar de página se aplica de inmediato; la búsqueda se debounce (el
  // administrativo suele seguir escribiendo) y siempre vuelve a la página 1.
  useEffect(() => {
    const handle = setTimeout(fetchPatients, query ? 300 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, page, query]);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  function openScheduleFor(patient: BackendPatient) {
    setScheduleForPatient(patient);
    setScheduleOpen(true);
  }

  function openScheduleGeneral() {
    setScheduleForPatient(null);
    setScheduleOpen(true);
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="text-left">
          <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Pacientes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Gestione el registro de pacientes, cree nuevas fichas y agende sus citas con el profesional a cargo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={openScheduleGeneral}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-charcoal-900 shadow-sm transition-colors hover:bg-toast-50 cursor-pointer"
          >
            <CalendarPlus className="h-4 w-4 text-toast-500" />
            Agendar paciente
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-charcoal-800 cursor-pointer"
          >
            <UserPlus className="h-4 w-4" />
            Crear nuevo paciente
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-5">
        <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <Users className="h-4 w-4 text-toast-500" />
          <span className="text-xs font-medium text-slate-500">
            {query.trim() ? 'Resultados de la búsqueda:' : 'Pacientes registrados:'}
          </span>
          <span className="text-sm font-bold text-charcoal-900">{total.toLocaleString('es-CO')}</span>
        </div>
      </div>

      {/* Filters + table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4 relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o documento..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2.5 font-semibold">Paciente</th>
                <th className="px-3 py-2.5 font-semibold">Documento</th>
                <th className="px-3 py-2.5 font-semibold">Convenio</th>
                <th className="px-3 py-2.5 font-semibold">Psicólogo asignado</th>
                <th className="px-3 py-2.5 font-semibold">Contacto</th>
                <th className="px-3 py-2.5 text-right font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-slate-400">Cargando pacientes...</td>
                </tr>
              )}
              {!loading && patients.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-toast-50/40">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-toast-100 text-xs font-bold text-toast-500">
                        {`${p.firstName?.[0] || ''}${p.lastName?.[0] || ''}`.toUpperCase()}
                      </div>
                      <span className="font-semibold text-charcoal-900">{p.firstName} {p.lastName}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-slate-500">{p.documentId}</td>
                  <td className="px-3 py-3">
                    <ConvenioTag name={p.corporateClient} />
                  </td>
                  <td className="px-3 py-3 text-slate-600">{p.psychologist?.name || '—'}</td>
                  <td className="px-3 py-3 text-slate-500">
                    <span className="block truncate">{p.email || '—'}</span>
                    <span className="block text-xs">{p.phone || ''}</span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      onClick={() => openScheduleFor(p)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-charcoal-900 transition-colors hover:bg-toast-50 cursor-pointer"
                    >
                      <CalendarPlus className="h-3.5 w-3.5 text-toast-500" />
                      Agendar
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && patients.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-slate-400">
                    No se encontraron pacientes con los filtros aplicados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {!loading && total > 0 && (
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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 right-6 z-50 flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm font-medium text-charcoal-900 shadow-lg">
          {toast}
        </div>
      )}

      {/* Modals */}
      <CreatePatientModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(patient) => {
          fetchPatients();
          showToast(`Paciente "${patient.firstName} ${patient.lastName}" creado correctamente.`);
        }}
      />
      <DelegatedAppointmentModal
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        initialData={scheduleForPatient ? { patient: scheduleForPatient, patientId: scheduleForPatient.id } : undefined}
        onSuccess={() => {
          setScheduleOpen(false);
          fetchPatients();
          showToast('Cita agendada correctamente.');
        }}
      />
    </div>
  );
}

function ConvenioTag({ name }: { name?: string }) {
  const isParticular = !name || name === 'Particular';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
      isParticular ? 'bg-slate-100 text-slate-500' : 'bg-toast-100 text-toast-500'
    }`}>
      {isParticular ? 'Particular' : name}
    </span>
  );
}
