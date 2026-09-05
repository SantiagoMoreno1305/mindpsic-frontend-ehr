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
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, UserPlus, CalendarPlus, Users, ChevronLeft, ChevronRight, Filter, X, Pencil, PhoneCall, Upload, SendHorizontal, CheckCircle2, MoreVertical, History } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import CreatePatientModal, { PATIENT_STATUS_LABELS } from './CreatePatientModal';
import BulkImportPatientsModal from './BulkImportPatientsModal';
import PatientStatusHistoryModal from './PatientStatusHistoryModal';
import DelegatedAppointmentModal, { prefetchSelectoresAgendamiento } from '../DelegatedAppointmentModal';
import { useCompanies } from '../../hooks/useCompanies';
import type { BackendPatient } from '../../types';

interface PacientesPanelProps {
  token: string | null;
  /** Navega a la ficha/historia clínica del paciente (tab "Historias Clínicas"). */
  onSelectPatient?: (patientId: string) => void;
  /** Rol del usuario logueado — determina si "Cargar masivo" está disponible (solo CEO/DIRECTIVO). */
  userRole?: string;
}

interface SpecialistOption {
  id: string;
  name: string;
}

const PAGE_SIZE = 10;

const STATUS_OPTIONS: { value: string; label: string }[] = Object.entries(PATIENT_STATUS_LABELS).map(
  ([value, label]) => ({ value, label })
);

// Búsqueda/filtros/página — se guardan en sessionStorage (dura mientras la
// pestaña siga abierta, no para siempre como localStorage) porque este panel
// se DESMONTA por completo al entrar a la ficha de un paciente (activeTab
// cambia a 'clinical_history') y se remonta desde cero al volver — sin esto,
// el buscador y los filtros quedaban en blanco cada vez que regresabas,
// aunque hubieras estado buscando algo específico.
interface PacientesSearchState {
  query: string;
  companyId: string;
  psychologistId: string;
  status: string;
  page: number;
}
const SEARCH_STATE_KEY = 'mind_pacientes_search_state';

function readSearchState(): PacientesSearchState {
  const empty: PacientesSearchState = { query: '', companyId: '', psychologistId: '', status: '', page: 1 };
  try {
    const raw = sessionStorage.getItem(SEARCH_STATE_KEY);
    if (!raw) return empty;
    return { ...empty, ...JSON.parse(raw) };
  } catch {
    return empty;
  }
}

export default function PacientesPanel({ token, onSelectPatient, userRole }: PacientesPanelProps) {
  const canBulkImport = userRole === 'CEO' || userRole === 'DIRECTIVO';
  // Cambiar (o incluso ver la lista completa de) el estado del paciente es
  // una decisión administrativa/de seguimiento comercial — un especialista
  // clínico ve su estado ACTUAL como referencia, de solo lectura, pero no
  // puede modificarlo desde acá.
  const canManageStatus = userRole === 'CEO' || userRole === 'DIRECTIVO' || userRole === 'OPERATIVO';
  const initialSearchState = readSearchState();
  const [patients, setPatients] = useState<BackendPatient[]>([]);
  const [total, setTotal] = useState(0);
  // Conteo de pacientes "Finalizado" — independiente de los filtros activos
  // (siempre el total del tenant), para la tarjeta clicable que filtra por
  // ese estado. Se refresca en los mismos puntos donde el estado de un
  // paciente puede cambiar (crear/editar/reactivar/cambio inline).
  const [finalizadoCount, setFinalizadoCount] = useState(0);
  const [page, setPage] = useState(initialSearchState.page);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(initialSearchState.query);
  const [companyId, setCompanyId] = useState(initialSearchState.companyId);
  const [psychologistId, setPsychologistId] = useState(initialSearchState.psychologistId);
  const [status, setStatus] = useState(initialSearchState.status);
  const { companies } = useCompanies();
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForPatient, setScheduleForPatient] = useState<BackendPatient | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editPatientTarget, setEditPatientTarget] = useState<BackendPatient | null>(null);
  const [statusHistoryPatient, setStatusHistoryPatient] = useState<BackendPatient | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sendingLinea247Id, setSendingLinea247Id] = useState<string | null>(null);
  const [resendingConfirmationId, setResendingConfirmationId] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  // Menú "más acciones" (Editar/Agendar/Línea 24-7/Reenviar confirmación) —
  // reemplaza los 4 botones sueltos de antes, que hacían la tabla demasiado
  // ancha. Se renderiza en un portal a document.body con posición fija
  // calculada del botón (ver actionMenu.top/bottom/right) — si viviera dentro
  // de la tabla, el contenedor "overflow-x-auto" de la tabla (que por CSS
  // también recorta el eje vertical) lo cortaba para las filas cercanas al
  // final. Se ancla con `top` (debajo del botón) o `bottom` (encima del
  // botón, para las últimas filas donde no cabe hacia abajo) según el
  // espacio disponible en el viewport al momento de abrirlo.
  const ACTION_MENU_HEIGHT = 176; // 4 ítems ≈ 44px c/u — usado para decidir si abre hacia arriba
  const [actionMenu, setActionMenu] = useState<{ patientId: string; top?: number; bottom?: number; right: number } | null>(null);

  useEffect(() => {
    if (!actionMenu) return;
    const close = () => setActionMenu(null);
    // capture: true porque el scroll dentro de un contenedor anidado no
    // burbujea — solo así se detecta el scroll de la tabla, no solo el de window.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [actionMenu]);

  // RENDIMIENTO: desde este panel se agenda constantemente, así que se precargan
  // los catálogos al montar para que el modal abra sin espera perceptible.
  useEffect(() => {
    prefetchSelectoresAgendamiento();
  }, []);

  // Catálogo del filtro de psicólogo — el de convenio ya lo trae useCompanies
  // (caché compartida, ver src/hooks/useCompanies.ts).
  useEffect(() => {
    if (!token) return;
    apiFetch('/api/users/specialists')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setSpecialists(Array.isArray(data?.specialists) ? data.specialists : Array.isArray(data) ? data : []))
      .catch(() => setSpecialists([]));
  }, [token]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  async function handleSendLinea247Access(patient: BackendPatient) {
    setSendingLinea247Id(patient.id);
    try {
      const res = await apiFetch(`/api/patients/${patient.id}/linea247-access`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showToast(data?.error || 'No se pudo enviar el acceso a línea 24/7.');
        return;
      }
      const destino = data.sentTo?.email || data.sentTo?.phone;
      showToast(destino ? `Acceso a línea 24/7 enviado a ${destino}.` : `Usuario generado: ${data.username} (sin correo/teléfono para enviarlo).`);
    } catch {
      showToast('No se pudo contactar el servidor.');
    } finally {
      setSendingLinea247Id(null);
    }
  }

  // Reenvía la confirmación de la cita vigente del paciente por Email/
  // WhatsApp, tomando su correo/teléfono ACTUALES — pensado para cuando el
  // dato de contacto estaba mal y se corrigió después de haber agendado, sin
  // tener que cancelar y volver a crear la cita.
  async function handleResendConfirmation(patient: BackendPatient) {
    setResendingConfirmationId(patient.id);
    try {
      const res = await apiFetch(`/api/appointments/patients/${patient.id}/resend-confirmation`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showToast(data?.error || 'No se pudo reenviar la confirmación de la cita.');
        return;
      }
      const destino = [data.sentTo?.email, data.sentTo?.phone].filter(Boolean).join(' / ');
      showToast(destino ? `Confirmación reenviada a ${destino}.` : 'Confirmación reenviada.');
    } catch {
      showToast('No se pudo contactar el servidor.');
    } finally {
      setResendingConfirmationId(null);
    }
  }

  const fetchFinalizadoCount = async () => {
    if (!token) return;
    try {
      const res = await apiFetch('/api/patients?status=finalizado&page=1&limit=1');
      if (!res.ok) return;
      const data = await res.json();
      setFinalizadoCount(typeof data.total === 'number' ? data.total : 0);
    } catch {
      // Silencioso — la tarjeta simplemente no se actualiza en este ciclo
    }
  };

  useEffect(() => {
    fetchFinalizadoCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchPatients = async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (query.trim()) params.set('q', query.trim());
      if (companyId) params.set('companyId', companyId);
      if (psychologistId) params.set('psychologistId', psychologistId);
      if (status) params.set('status', status);
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
  }, [token, page, query, companyId, psychologistId, status]);

  // Se salta el primer disparo (montaje) para no pisar la página restaurada
  // de sessionStorage — solo debe volver a la página 1 cuando el USUARIO
  // cambia un filtro, no cuando el filtro llega ya restaurado al volver.
  const isFirstFilterRun = useRef(true);
  useEffect(() => {
    if (isFirstFilterRun.current) {
      isFirstFilterRun.current = false;
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, companyId, psychologistId, status]);

  // Persiste búsqueda/filtros/página para que sobrevivan al desmontar este
  // panel (ver comentario en readSearchState más arriba).
  useEffect(() => {
    const state: PacientesSearchState = { query, companyId, psychologistId, status, page };
    sessionStorage.setItem(SEARCH_STATE_KEY, JSON.stringify(state));
  }, [query, companyId, psychologistId, status, page]);

  const hasActiveFilters = !!(companyId || psychologistId || status);
  function clearFilters() {
    setCompanyId('');
    setPsychologistId('');
    setStatus('');
  }

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

  function openEditFor(patient: BackendPatient) {
    setEditPatientTarget(patient);
    setEditOpen(true);
  }

  // Cambio de estado directo desde la tabla — sin abrir el modal completo,
  // para hacer seguimiento rápido (ej. Notificado 1°vez → 2°vez).
  async function handleInlineStatusChange(patient: BackendPatient, newStatus: string) {
    const previousStatus = patient.status;
    setUpdatingStatusId(patient.id);
    setPatients((prev) => prev.map((p) => (p.id === patient.id ? { ...p, status: newStatus } : p)));
    try {
      const res = await apiFetch(`/api/patients/${patient.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      showToast(`Estado de ${patient.firstName} ${patient.lastName} actualizado a "${PATIENT_STATUS_LABELS[newStatus] || newStatus}".`);
      if (newStatus === 'finalizado' || previousStatus === 'finalizado') fetchFinalizadoCount();
    } catch (err: any) {
      setPatients((prev) => prev.map((p) => (p.id === patient.id ? { ...p, status: previousStatus } : p)));
      showToast(err.message || 'No se pudo actualizar el estado.');
    } finally {
      setUpdatingStatusId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      {/* Header — solo título, sin botones ni stat sueltos flotando arriba. */}
      <div className="mb-5 text-left">
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Pacientes</h1>
        <p className="mt-1 text-sm text-slate-500">
          Gestione el registro de pacientes, cree nuevas fichas y agende sus citas con el profesional a cargo.
        </p>
      </div>

      {/* Filters + table — el stat de conteo y los botones de acción viven
          adentro, en su propia fila, en vez de flotar sueltos arriba de la
          caja. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Users className="h-4 w-4 text-toast-500" />
              <span className="text-xs font-medium text-slate-500">
                {query.trim() ? 'Resultados de la búsqueda:' : 'Pacientes registrados:'}
              </span>
              <span className="text-sm font-bold text-charcoal-900">{total.toLocaleString('es-CO')}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatus((s) => (s === 'finalizado' ? '' : 'finalizado'))}
              title="Filtrar por pacientes finalizados"
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors cursor-pointer ${
                status === 'finalizado'
                  ? 'border-toast-400 bg-toast-50'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
              }`}
            >
              <CheckCircle2 className={`h-4 w-4 ${status === 'finalizado' ? 'text-toast-500' : 'text-slate-400'}`} />
              <span className="text-xs font-medium text-slate-500">Finalizados:</span>
              <span className="text-sm font-bold text-charcoal-900">{finalizadoCount.toLocaleString('es-CO')}</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={openScheduleGeneral}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-charcoal-900 shadow-sm transition-colors hover:bg-toast-50 cursor-pointer"
            >
              <CalendarPlus className="h-4 w-4 text-toast-500" />
              Agendar paciente
            </button>
            {canBulkImport && (
              <button
                onClick={() => setBulkImportOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-charcoal-900 shadow-sm transition-colors hover:bg-toast-50 cursor-pointer"
              >
                <Upload className="h-4 w-4 text-toast-500" />
                Cargar masivo
              </button>
            )}
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-charcoal-800 cursor-pointer"
            >
              <UserPlus className="h-4 w-4" />
              Crear nuevo paciente
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
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
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
            <Filter className="h-3.5 w-3.5" />
            Filtros:
          </span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-xs font-medium text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
          >
            <option value="">Todos los convenios</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={psychologistId}
            onChange={(e) => setPsychologistId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-xs font-medium text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
          >
            <option value="">Todos los psicólogos</option>
            {specialists.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-xs font-medium text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
          >
            <option value="">Todos los estados</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-charcoal-900 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              Limpiar filtros
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2.5 font-semibold">Paciente</th>
                <th className="px-3 py-2.5 font-semibold">Convenio</th>
                <th className="px-3 py-2.5 font-semibold">Psicólogo asignado</th>
                <th className="px-3 py-2.5 font-semibold">Contacto</th>
                <th className="px-3 py-2.5 font-semibold">Estado</th>
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
                <tr
                  key={p.id}
                  onClick={onSelectPatient ? () => onSelectPatient(p.id) : undefined}
                  className={`transition-colors hover:bg-toast-50/40 ${onSelectPatient ? 'cursor-pointer' : ''}`}
                >
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-toast-100 text-xs font-bold text-toast-500">
                        {`${p.firstName?.[0] || ''}${p.lastName?.[0] || ''}`.toUpperCase()}
                      </div>
                      <div>
                        <span className="block font-semibold text-charcoal-900">
                          {onSelectPatient ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onSelectPatient(p.id); }}
                              className="hover:underline cursor-pointer"
                            >
                              {p.firstName} {p.lastName}
                            </button>
                          ) : (
                            <>{p.firstName} {p.lastName}</>
                          )}
                        </span>
                        {(p.recordNumber || p.documentId) && (
                          <span className="block font-mono text-[10.5px] text-slate-400">
                            {p.recordNumber}
                            {p.recordNumber && p.documentId && ' · '}
                            {p.documentType ? `${p.documentType} ` : ''}{p.documentId}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <ConvenioTag name={p.corporateClient} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">{p.psychologist?.name || '—'}</td>
                  <td className="px-3 py-3 text-slate-500">
                    <span className="block truncate">{p.email || '—'}</span>
                    <span className="block text-xs">{p.phone || ''}</span>
                  </td>
                  <td className="px-3 py-3">
                    {canManageStatus ? (
                      <select
                        value={p.status || 'activo'}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { e.stopPropagation(); handleInlineStatusChange(p, e.target.value); }}
                        disabled={updatingStatusId === p.id}
                        title="Cambiar estado del paciente"
                        className="w-full max-w-[150px] rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-2.5 pr-6 text-xs font-medium text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20 disabled:cursor-wait disabled:opacity-50 cursor-pointer"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span
                        title="Cambiar el estado del paciente es una acción exclusiva del área administrativa."
                        className="inline-flex w-full max-w-[150px] items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-charcoal-900"
                      >
                        {PATIENT_STATUS_LABELS[p.status || 'activo'] || p.status}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (actionMenu?.patientId === p.id) { setActionMenu(null); return; }
                        const rect = e.currentTarget.getBoundingClientRect();
                        const right = window.innerWidth - rect.right;
                        const fitsBelow = window.innerHeight - rect.bottom >= ACTION_MENU_HEIGHT;
                        setActionMenu(
                          fitsBelow
                            ? { patientId: p.id, top: rect.bottom + 4, right }
                            : { patientId: p.id, bottom: window.innerHeight - rect.top + 4, right }
                        );
                      }}
                      title="Más acciones"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-charcoal-900 cursor-pointer"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {actionMenu?.patientId === p.id && createPortal(
                      <>
                        {/* Portal: aunque el nodo vive en document.body, React sigue
                            burbujeando el evento por el árbol de React (no el DOM) —
                            sin stopPropagation, este clic (y el de cada opción de abajo)
                            también dispara el onClick de la fila y navegaba a la
                            historia clínica del paciente. */}
                        <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setActionMenu(null); }} />
                        <div
                          className="fixed z-50 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg"
                          style={{
                            right: actionMenu.right,
                            ...(actionMenu.top !== undefined ? { top: actionMenu.top } : { bottom: actionMenu.bottom }),
                          }}
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); setActionMenu(null); openScheduleFor(p); }}
                            className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-sm font-medium text-charcoal-900 transition-colors hover:bg-toast-50 cursor-pointer"
                          >
                            <CalendarPlus className="h-3.5 w-3.5 shrink-0 text-toast-500" />
                            Agendar cita
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setActionMenu(null); openEditFor(p); }}
                            className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-sm text-charcoal-900 transition-colors hover:bg-slate-50 cursor-pointer"
                          >
                            <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            Editar paciente
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setActionMenu(null); setStatusHistoryPatient(p); }}
                            className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-sm text-charcoal-900 transition-colors hover:bg-slate-50 cursor-pointer"
                          >
                            <History className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            Historial de estados
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setActionMenu(null); handleSendLinea247Access(p); }}
                            disabled={sendingLinea247Id === p.id}
                            className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-sm text-charcoal-900 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-40 cursor-pointer"
                          >
                            <PhoneCall className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            Enviar acceso a línea 24/7
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setActionMenu(null); handleResendConfirmation(p); }}
                            disabled={resendingConfirmationId === p.id}
                            className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-sm text-charcoal-900 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-40 cursor-pointer"
                          >
                            <SendHorizontal className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            Reenviar confirmación
                          </button>
                        </div>
                      </>,
                      document.body
                    )}
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
        userRole={userRole}
        onCreated={(patient, wasReactivated) => {
          fetchPatients();
          fetchFinalizadoCount();
          showToast(
            wasReactivated
              ? `Paciente "${patient.firstName} ${patient.lastName}" reactivado correctamente.`
              : `Paciente "${patient.firstName} ${patient.lastName}" creado correctamente.`
          );
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
      <CreatePatientModal
        isOpen={editOpen}
        patient={editPatientTarget}
        userRole={userRole}
        onClose={() => setEditOpen(false)}
        onUpdated={(patient) => {
          fetchPatients();
          fetchFinalizadoCount();
          showToast(`Paciente "${patient.firstName} ${patient.lastName}" actualizado correctamente.`);
        }}
      />
      <PatientStatusHistoryModal
        isOpen={!!statusHistoryPatient}
        onClose={() => setStatusHistoryPatient(null)}
        patientId={statusHistoryPatient?.id ?? null}
        patientName={statusHistoryPatient ? `${statusHistoryPatient.firstName} ${statusHistoryPatient.lastName}` : undefined}
      />
      {canBulkImport && (
        <BulkImportPatientsModal
          isOpen={bulkImportOpen}
          onClose={() => setBulkImportOpen(false)}
          onImported={(count) => {
            fetchPatients();
            showToast(`${count} paciente(s) importado(s) correctamente.`);
          }}
        />
      )}
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
