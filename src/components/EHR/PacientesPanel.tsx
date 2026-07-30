/**
 * PacientesPanel.tsx
 *
 * Tab "Pacientes": listado general + creación + agendamiento. Compartido
 * entre PsychologistPortal (ESPECIALISTA_B2B) y AdminPortal (CEO/DIRECTIVO/
 * OPERATIVO) — el backend ya expone /api/patients y /api/appointments a
 * cualquier rol autenticado del tenant, así que la disponibilidad real la
 * da simplemente montar este componente en el tab de cada portal.
 */
import { useMemo, useState } from 'react';
import { Search, UserPlus, CalendarPlus, Users, Building2, CalendarClock } from 'lucide-react';
import { usePatients } from '../../hooks/usePatients';
import CreatePatientModal from './CreatePatientModal';
import DelegatedAppointmentModal from '../DelegatedAppointmentModal';
import type { BackendPatient } from '../../types';

interface PacientesPanelProps {
  token: string | null;
}

export default function PacientesPanel({ token }: PacientesPanelProps) {
  const { patients, loading, refetch } = usePatients(token);
  const [query, setQuery] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForPatientId, setScheduleForPatientId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => {
      const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
      return fullName.includes(q) || (p.documentId || '').toLowerCase().includes(q);
    });
  }, [patients, query]);

  const conConvenio = patients.filter((p) => p.corporateClient && p.corporateClient !== 'Particular').length;

  function openScheduleFor(patientId: string) {
    setScheduleForPatientId(patientId);
    setScheduleOpen(true);
  }

  function openScheduleGeneral() {
    setScheduleForPatientId(null);
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
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard icon={Users} label="Pacientes registrados" value={patients.length} />
        <StatCard icon={Building2} label="Con convenio corporativo" value={conConvenio} />
        <StatCard icon={CalendarClock} label="Resultados filtrados" value={filtered.length} />
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
              {!loading && filtered.map((p) => (
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
                      onClick={() => openScheduleFor(p.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-charcoal-900 transition-colors hover:bg-toast-50 cursor-pointer"
                    >
                      <CalendarPlus className="h-3.5 w-3.5 text-toast-500" />
                      Agendar
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-slate-400">
                    No se encontraron pacientes con los filtros aplicados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
          refetch();
          showToast(`Paciente "${patient.firstName} ${patient.lastName}" creado correctamente.`);
        }}
      />
      <DelegatedAppointmentModal
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        initialData={scheduleForPatientId ? { patientId: scheduleForPatientId } : undefined}
        onSuccess={() => {
          setScheduleOpen(false);
          refetch();
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

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-1 text-2xl font-bold text-charcoal-900">{value}</p>
    </div>
  );
}
