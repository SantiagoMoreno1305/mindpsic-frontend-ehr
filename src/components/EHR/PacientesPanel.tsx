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
import { Search, UserPlus, CalendarPlus, ChevronLeft, ChevronRight, ChevronDown, Filter, X, Pencil, PhoneCall, Upload, SendHorizontal, MoreVertical, History, Smartphone, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Check } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import CreatePatientModal, { PATIENT_STATUS_LABELS } from './CreatePatientModal';
import BulkImportPatientsModal from './BulkImportPatientsModal';
import PatientStatusHistoryModal from './PatientStatusHistoryModal';
import DeletePatientConfirmModal from './DeletePatientConfirmModal';
import DelegatedAppointmentModal, { prefetchSelectoresAgendamiento } from '../DelegatedAppointmentModal';
import { useCompanies } from '../../hooks/useCompanies';
import type { BackendPatient } from '../../types';

interface PacientesPanelProps {
  token: string | null;
  /** Navega a la ficha/historia clínica del paciente (tab "Historias Clínicas"). */
  onSelectPatient?: (patientId: string) => void;
  /** Rol del usuario logueado — determina si "Cargar masivo" está disponible (solo CEO/DIRECTIVO). */
  userRole?: string;
  /** Id del usuario logueado — para la pestaña "Mis Pacientes" (psychologistId = este id). */
  userId?: string;
}

interface SpecialistOption {
  id: string;
  name: string;
}

const PAGE_SIZE = 10;

// Color SOLO del punto — el nombre del estado va siempre en texto normal
// (decisión 2026-10-26, rediseño de la tabla). bg-slate-300 es el fallback
// para cualquier valor que no esté en este mapa.
const STATUS_DOT_COLORS: Record<string, string> = {
  agendado: 'bg-blue-500',
  activo: 'bg-emerald-500',
  notificado_1: 'bg-amber-500',
  notificado_2: 'bg-amber-500',
  notificado_3: 'bg-amber-500',
  notificado_4: 'bg-amber-500',
  alta: 'bg-slate-400',
  pausa: 'bg-violet-400',
  finalizado: 'bg-teal-500',
  anulado: 'bg-rose-500',
};

const STATUS_OPTIONS: { value: string; label: string }[] = Object.entries(PATIENT_STATUS_LABELS).map(
  ([value, label]) => ({ value, label })
);

// Búsqueda/filtros/página — se guardan en sessionStorage (dura mientras la
// pestaña siga abierta, no para siempre como localStorage) porque este panel
// se DESMONTA por completo al entrar a la ficha de un paciente (activeTab
// cambia a 'clinical_history') y se remonta desde cero al volver — sin esto,
// el buscador y los filtros quedaban en blanco cada vez que regresabas,
// aunque hubieras estado buscando algo específico.
type ViewTab = 'mine' | 'all' | 'finalizado';
type SortField = 'nombre' | 'convenio' | 'profesional' | 'estado';
type SortDir = 'asc' | 'desc';

interface PacientesSearchState {
  query: string;
  companyId: string;
  psychologistId: string;
  status: string;
  page: number;
  viewTab: ViewTab | '';
  sortField: SortField;
  sortDir: SortDir;
}
const SEARCH_STATE_KEY = 'mind_pacientes_search_state';
// Densidad de fila — a propósito en localStorage, no en sessionStorage: es
// una preferencia de la persona, no estado de una búsqueda puntual (debe
// sobrevivir a cerrar la pestaña, igual en todas las sesiones).
const DENSITY_KEY = 'mind_pacientes_density';

function readSearchState(): PacientesSearchState {
  const empty: PacientesSearchState = {
    query: '', companyId: '', psychologistId: '', status: '', page: 1,
    viewTab: '', sortField: 'nombre', sortDir: 'asc',
  };
  try {
    const raw = sessionStorage.getItem(SEARCH_STATE_KEY);
    if (!raw) return empty;
    return { ...empty, ...JSON.parse(raw) };
  } catch {
    return empty;
  }
}

function readDensity(): 'compact' | 'comfortable' {
  try {
    const raw = localStorage.getItem(DENSITY_KEY);
    return raw === 'comfortable' ? 'comfortable' : 'compact';
  } catch {
    return 'compact';
  }
}

// Caché en memoria de la última página de resultados, por combinación
// exacta de filtros+orden+página (decisión 2026-10-27) — este panel se
// desmonta por completo al entrar a la ficha de un paciente o al cambiar de
// pestaña del portal, y se remonta desde cero al volver; sin esto, cada
// regreso repetía el mismo fetch que ya se había hecho segundos antes.
// Vive a nivel de módulo (mismo patrón que selectoresCache en
// DelegatedAppointmentModal.tsx), sobrevive al remount de React. TTL corto
// (30s, no los 5 min de selectoresCache) porque esta lista cambia seguido
// (altas, cambios de estado) — se prioriza que el regreso sea instantáneo,
// pero revalidando en segundo plano apenas se muestra lo cacheado.
const PATIENTS_LIST_CACHE_TTL_MS = 30 * 1000;
interface PatientsListCacheEntry {
  patients: BackendPatient[];
  total: number;
  ts: number;
}
const patientsListCache = new Map<string, PatientsListCacheEntry>();

// Mismo criterio que invalidateSelectoresCache/invalidateCompaniesCache (ver
// App.tsx/Login.tsx) — se llama en logout/cambio de sesión para que una
// cuenta de OTRO tenant en la misma pestaña no siga viendo pacientes del
// tenant anterior.
export function invalidatePatientsListCache(): void {
  patientsListCache.clear();
}

export default function PacientesPanel({ token, onSelectPatient, userRole, userId }: PacientesPanelProps) {
  const canBulkImport = userRole === 'CEO' || userRole === 'DIRECTIVO';
  // Cambiar (o incluso ver la lista completa de) el estado del paciente es
  // una decisión administrativa/de seguimiento comercial — un especialista
  // clínico ve su estado ACTUAL como referencia, de solo lectura, pero no
  // puede modificarlo desde acá.
  const canManageStatus = userRole === 'CEO' || userRole === 'DIRECTIVO' || userRole === 'OPERATIVO';
  // Borrado físico real (decisión 2026-10-24) — CEO únicamente, el backend
  // también lo exige (ver DELETE /api/patients/:id en patient.controller.js).
  const canHardDelete = userRole === 'CEO';
  // "Mis Pacientes" (decisión 2026-10-26) solo existe para quien de verdad
  // tiene pacientes "propios" — CEO/DIRECTIVO/OPERATIVO no son psicólogos
  // tratantes, psychologistId=su-id siempre les daría una tabla vacía.
  const hasOwnPatients = userRole === 'ESPECIALISTA_B2B';
  const initialSearchState = readSearchState();
  const [viewTab, setViewTab] = useState<ViewTab>(
    initialSearchState.viewTab || (hasOwnPatients ? 'mine' : 'all')
  );
  const [patients, setPatients] = useState<BackendPatient[]>([]);
  const [total, setTotal] = useState(0);
  // Conteos de cada pestaña — independientes de los filtros manuales
  // (convenio/psicólogo/búsqueda), para que el número junto a cada pestaña
  // diga "cuántos habría" y no se recalcule contra el filtro ya aplicado.
  // Se refrescan en los mismos puntos donde el estado de un paciente puede
  // cambiar (crear/editar/reactivar/cambio inline).
  const [tabCounts, setTabCounts] = useState({ mine: 0, all: 0, finalizado: 0 });
  const [page, setPage] = useState(initialSearchState.page);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(initialSearchState.query);
  const [companyId, setCompanyId] = useState(initialSearchState.companyId);
  // Filtro MANUAL de psicólogo/estado — solo aplica en la pestaña donde no
  // está ya fijado por la pestaña misma (ver effectivePsychologistId/
  // effectiveStatus más abajo): "Mis Pacientes" fija el psicólogo a uno
  // mismo, "Finalizados" fija el estado.
  const [psychologistId, setPsychologistId] = useState(initialSearchState.psychologistId);
  const [status, setStatus] = useState(initialSearchState.status);
  const [sortField, setSortField] = useState<SortField>(initialSearchState.sortField);
  const [sortDir, setSortDir] = useState<SortDir>(initialSearchState.sortDir);
  const [density, setDensity] = useState<'compact' | 'comfortable'>(readDensity());
  const { companies } = useCompanies();
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);

  const effectivePsychologistId = viewTab === 'mine' ? (userId || '') : psychologistId;
  const effectiveStatus = viewTab === 'finalizado' ? 'finalizado' : status;

  function changeDensity(next: 'compact' | 'comfortable') {
    setDensity(next);
    try { localStorage.setItem(DENSITY_KEY, next); } catch { /* localStorage puede no estar disponible (modo privado) */ }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  const [createOpen, setCreateOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForPatient, setScheduleForPatient] = useState<BackendPatient | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editPatientTarget, setEditPatientTarget] = useState<BackendPatient | null>(null);
  const [statusHistoryPatient, setStatusHistoryPatient] = useState<BackendPatient | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackendPatient | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sendingLinea247Id, setSendingLinea247Id] = useState<string | null>(null);
  const [sendingInvitationId, setSendingInvitationId] = useState<string | null>(null);
  const [resendingConfirmationId, setResendingConfirmationId] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  // Menú "más acciones" (Editar/Historial de estados/Línea 24-7/Reenviar
  // confirmación) — "Agendar cita" se quitó de acá, se agenda desde el botón
  // "Agendar paciente" de la barra superior. Reemplaza los botones sueltos de antes, que hacían la tabla demasiado
  // ancha. Se renderiza en un portal a document.body con posición fija
  // calculada del botón (ver actionMenu.top/bottom/right) — si viviera dentro
  // de la tabla, el contenedor "overflow-x-auto" de la tabla (que por CSS
  // también recorta el eje vertical) lo cortaba para las filas cercanas al
  // final. Se ancla con `top` (debajo del botón) o `bottom` (encima del
  // botón, para las últimas filas donde no cabe hacia abajo) según el
  // espacio disponible en el viewport al momento de abrirlo.
  const ACTION_MENU_HEIGHT = canHardDelete ? 264 : 220; // ≈44px c/u (6 ítems si es CEO) — usado para decidir si abre hacia arriba
  const [actionMenu, setActionMenu] = useState<{ patientId: string; top?: number; bottom?: number; right: number } | null>(null);
  // Menú de Estado — reemplaza el <select> nativo (decisión 2026-10-27: el
  // estilo del select nativo "parece de principios de los 2000" y no se puede
  // re-diseñar más allá del borde/fondo del control cerrado, la lista
  // desplegada la pinta el sistema operativo). Mismo patrón de portal +
  // posición calculada que el menú ⋮ de abajo.
  const STATUS_MENU_HEIGHT = STATUS_OPTIONS.length * 34 + 8;
  const [statusMenu, setStatusMenu] = useState<{ patientId: string; top?: number; bottom?: number; left: number } | null>(null);

  useEffect(() => {
    if (!statusMenu) return;
    const close = () => setStatusMenu(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [statusMenu]);

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

  async function handleSendAppInvitation(patient: BackendPatient) {
    setSendingInvitationId(patient.id);
    try {
      const res = await apiFetch(`/api/patients/${patient.id}/invitation`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showToast(data?.error || 'No se pudo enviar la invitación a la app.');
        return;
      }
      const destino = data.sentTo?.email || data.sentTo?.phone;
      showToast(destino ? `Invitación a la app enviada a ${destino}.` : 'Invitación creada (el paciente no tiene correo ni teléfono registrado para enviarla).');
    } catch {
      showToast('No se pudo contactar el servidor.');
    } finally {
      setSendingInvitationId(null);
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

  const fetchTabCounts = async () => {
    if (!token) return;
    try {
      const requests: Promise<void>[] = [];
      let mine = tabCounts.mine;
      let all = tabCounts.all;
      let finalizado = tabCounts.finalizado;
      requests.push(
        apiFetch('/api/patients?page=1&limit=1')
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => { if (data) all = typeof data.total === 'number' ? data.total : 0; })
      );
      requests.push(
        apiFetch('/api/patients?status=finalizado&page=1&limit=1')
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => { if (data) finalizado = typeof data.total === 'number' ? data.total : 0; })
      );
      if (hasOwnPatients && userId) {
        requests.push(
          apiFetch(`/api/patients?psychologistId=${userId}&page=1&limit=1`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => { if (data) mine = typeof data.total === 'number' ? data.total : 0; })
        );
      }
      await Promise.all(requests);
      setTabCounts({ mine, all, finalizado });
    } catch {
      // Silencioso — los contadores simplemente no se actualizan en este ciclo
    }
  };

  useEffect(() => {
    fetchTabCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // `force` se usa tras crear/editar/eliminar/agendar — en esos casos el
  // caché de este mismo filtro+página puede seguir "fresco" pero ya no
  // refleja el cambio que el usuario acaba de hacer, así que debe ignorarse.
  const fetchPatients = async (opts?: { force?: boolean }) => {
    if (!token) { setLoading(false); return; }
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort: `${sortField}_${sortDir}` });
    if (query.trim()) params.set('q', query.trim());
    if (companyId) params.set('companyId', companyId);
    if (effectivePsychologistId) params.set('psychologistId', effectivePsychologistId);
    if (effectiveStatus) params.set('status', effectiveStatus);
    const cacheKey = params.toString();

    const cached = !opts?.force ? patientsListCache.get(cacheKey) : undefined;
    if (cached) {
      // Instantáneo: se pinta lo que ya había, sin spinner.
      setPatients(cached.patients);
      setTotal(cached.total);
      setLoading(false);
      if (Date.now() - cached.ts < PATIENTS_LIST_CACHE_TTL_MS) return; // sigue fresco, nada que revalidar
      // vencido — se deja lo cacheado en pantalla y se revalida abajo en silencio.
    } else {
      setLoading(true);
    }

    try {
      const res = await apiFetch(`/api/patients?${cacheKey}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const nextPatients: BackendPatient[] = Array.isArray(data.patients) ? data.patients : [];
      const nextTotal = typeof data.total === 'number' ? data.total : 0;
      patientsListCache.set(cacheKey, { patients: nextPatients, total: nextTotal, ts: Date.now() });
      setPatients(nextPatients);
      setTotal(nextTotal);
    } catch (err) {
      console.error('[PacientesPanel] Error cargando pacientes:', err);
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

  // Cambiar de página se aplica de inmediato; la búsqueda se debounce (el
  // administrativo suele seguir escribiendo) y siempre vuelve a la página 1.
  useEffect(() => {
    const handle = setTimeout(fetchPatients, query ? 300 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, page, query, companyId, effectivePsychologistId, effectiveStatus, sortField, sortDir]);

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
  }, [query, companyId, psychologistId, status, viewTab, sortField, sortDir]);

  // Persiste búsqueda/filtros/página/pestaña/orden para que sobrevivan al
  // desmontar este panel (ver comentario en readSearchState más arriba).
  useEffect(() => {
    const state: PacientesSearchState = { query, companyId, psychologistId, status, page, viewTab, sortField, sortDir };
    sessionStorage.setItem(SEARCH_STATE_KEY, JSON.stringify(state));
  }, [query, companyId, psychologistId, status, page, viewTab, sortField, sortDir]);

  // Ignora el filtro que la pestaña misma ya fija (oculto en el select) — si
  // no, "Limpiar filtros" aparecía aunque no hubiera ningún select visible
  // con un valor puesto.
  const hasActiveFilters = !!(companyId || (viewTab !== 'mine' && psychologistId) || (viewTab !== 'finalizado' && status));
  function clearFilters() {
    setCompanyId('');
    setPsychologistId('');
    setStatus('');
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

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
      // Update optimista vía setPatients, no pasa por fetchPatients — sin
      // esto, el caché de esta combinación de filtros se quedaba con el
      // estado viejo y lo volvía a mostrar si regresabas a esta pantalla
      // dentro de los 30s del TTL.
      patientsListCache.clear();
      if (newStatus === 'finalizado' || previousStatus === 'finalizado') fetchTabCounts();
    } catch (err: any) {
      setPatients((prev) => prev.map((p) => (p.id === patient.id ? { ...p, status: previousStatus } : p)));
      showToast(err.message || 'No se pudo actualizar el estado.');
    } finally {
      setUpdatingStatusId(null);
    }
  }

  // Filas de ~52-56px en compacta (decisión 2026-10-26) vs. el alto cómodo
  // de siempre — mismo valor aplicado a todas las celdas de una fila.
  const rowPad = density === 'compact' ? 'py-2' : 'py-3.5';

  return (
    <div className="mx-auto max-w-7xl">
      {/* Header corto — título y acciones en la misma fila (decisión
          2026-10-26, rediseño: antes los botones vivían sueltos adentro de
          la caja, en su propia fila). */}
      <div className="mb-5 flex flex-col gap-3 text-left sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Pacientes</h1>
          <p className="mt-1 text-sm text-slate-500">Registro y seguimiento de pacientes.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={openScheduleGeneral}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-charcoal-900 shadow-sm transition-colors hover:bg-toast-50 cursor-pointer"
          >
            <CalendarPlus className="h-4 w-4 text-toast-500" />
            Agendar cita
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
            Nuevo paciente
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        {/* Pestañas: Mis Pacientes (solo ESPECIALISTA_B2B) | Todos | Finalizados.
            Reemplazan el stat suelto y la tarjeta clicable de "Finalizados"
            de antes — el contador vive en la pestaña misma. */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
          <div className="flex items-center gap-4">
            {hasOwnPatients && (
              <TabButton active={viewTab === 'mine'} label="Mis Pacientes" count={tabCounts.mine} onClick={() => setViewTab('mine')} />
            )}
            <TabButton
              active={viewTab === 'all'}
              label="Todos"
              count={tabCounts.all}
              onClick={() => { setViewTab('all'); clearFilters(); }}
            />
            <TabButton active={viewTab === 'finalizado'} label="Finalizados" count={tabCounts.finalizado} onClick={() => setViewTab('finalizado')} />
          </div>
          <select
            value={density}
            onChange={(e) => changeDensity(e.target.value as 'compact' | 'comfortable')}
            title="Densidad de la tabla"
            className="mb-2 rounded-lg border border-slate-200 bg-white py-1.5 pl-2.5 pr-7 text-xs font-medium text-slate-500 outline-none transition-colors focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20"
          >
            <option value="compact">Vista compacta</option>
            <option value="comfortable">Vista cómoda</option>
          </select>
        </div>

        <div className="mb-4 mt-4 flex flex-wrap items-center gap-2">
          <div className="relative w-full flex-1 sm:min-w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, documento o código..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-9 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20"
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
            className="w-44 rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-8 text-xs font-medium text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20"
          >
            <option value="">Todos los convenios</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {/* "Mis Pacientes" ya fija el psicólogo a uno mismo — mostrar este
              filtro ahí sería redundante y confuso. */}
          {viewTab !== 'mine' && (
            <select
              value={psychologistId}
              onChange={(e) => setPsychologistId(e.target.value)}
              className="w-44 rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-8 text-xs font-medium text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20"
            >
              <option value="">Todos los psicólogos</option>
              {specialists.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          {/* "Finalizados" ya fija el estado — mismo motivo que arriba. */}
          {viewTab !== 'finalizado' && (
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-44 rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-8 text-xs font-medium text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20"
            >
              <option value="">Todos los estados</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          )}
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
            <thead className="sticky top-0 z-[5] bg-white">
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <SortableHeader label="Paciente" field="nombre" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Convenio" field="convenio" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <SortableHeader label="Profesional asignado" field="profesional" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <th className="px-3 py-2.5 font-semibold">Contacto</th>
                <SortableHeader label="Estado" field="estado" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <th className="px-3 py-2.5 text-right font-semibold">Acciones</th>
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
                  className={`transition-colors hover:bg-toast-100/50 ${onSelectPatient ? 'cursor-pointer' : ''}`}
                >
                  <td className={`whitespace-nowrap px-3 ${rowPad}`}>
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
                  </td>
                  <td className={`px-3 ${rowPad}`}>
                    <ConvenioTag name={p.corporateClient} />
                  </td>
                  <td className={`whitespace-nowrap px-3 ${rowPad}`}>
                    {p.psychologist?.name
                      ? <span className="text-charcoal-900">{p.psychologist.name}</span>
                      : <span className="italic text-slate-400">Por asignar</span>}
                  </td>
                  <td className={`px-3 ${rowPad} text-slate-500`}>
                    <span className={`block truncate ${p.email ? '' : 'italic text-slate-400'}`}>{p.email || 'Sin correo'}</span>
                    <span className="block text-xs">{p.phone || ''}</span>
                  </td>
                  <td className={`px-3 ${rowPad}`}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_COLORS[p.status || 'activo'] || 'bg-slate-300'}`} />
                      {canManageStatus ? (
                        <button
                          type="button"
                          disabled={updatingStatusId === p.id}
                          title="Cambiar estado del paciente"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (statusMenu?.patientId === p.id) { setStatusMenu(null); return; }
                            const rect = e.currentTarget.getBoundingClientRect();
                            const fitsBelow = window.innerHeight - rect.bottom >= STATUS_MENU_HEIGHT;
                            setStatusMenu(
                              fitsBelow
                                ? { patientId: p.id, top: rect.bottom + 4, left: rect.left }
                                : { patientId: p.id, bottom: window.innerHeight - rect.top + 4, left: rect.left }
                            );
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-charcoal-900 outline-none transition-colors hover:text-toast-600 disabled:cursor-wait disabled:opacity-50 cursor-pointer"
                        >
                          {PATIENT_STATUS_LABELS[p.status || 'activo'] || p.status}
                          <ChevronDown className="h-3 w-3 text-slate-400" />
                        </button>
                      ) : (
                        <span
                          title="Cambiar el estado del paciente es una acción exclusiva del área administrativa."
                          className="text-xs font-medium text-charcoal-900"
                        >
                          {PATIENT_STATUS_LABELS[p.status || 'activo'] || p.status}
                        </span>
                      )}
                      {statusMenu?.patientId === p.id && createPortal(
                        <>
                          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setStatusMenu(null); }} />
                          <div
                            className="fixed z-50 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg"
                            style={{
                              left: statusMenu.left,
                              ...(statusMenu.top !== undefined ? { top: statusMenu.top } : { bottom: statusMenu.bottom }),
                            }}
                          >
                            {STATUS_OPTIONS.map((s) => {
                              const isCurrent = (p.status || 'activo') === s.value;
                              return (
                                <button
                                  key={s.value}
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setStatusMenu(null); if (!isCurrent) handleInlineStatusChange(p, s.value); }}
                                  className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-sm transition-colors hover:bg-slate-50 cursor-pointer ${
                                    isCurrent ? 'font-semibold text-toast-600' : 'text-charcoal-900'
                                  }`}
                                >
                                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_COLORS[s.value] || 'bg-slate-300'}`} />
                                  <span className="flex-1">{s.label}</span>
                                  {isCurrent && <Check className="h-3.5 w-3.5 shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        </>,
                        document.body
                      )}
                    </div>
                  </td>
                  <td className={`px-3 ${rowPad} text-right`}>
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
                            onClick={(e) => { e.stopPropagation(); setActionMenu(null); handleSendAppInvitation(p); }}
                            disabled={sendingInvitationId === p.id}
                            className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-sm text-charcoal-900 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-40 cursor-pointer"
                          >
                            <Smartphone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            Enviar invitación a la app
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setActionMenu(null); handleResendConfirmation(p); }}
                            disabled={resendingConfirmationId === p.id}
                            className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-sm text-charcoal-900 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-40 cursor-pointer"
                          >
                            <SendHorizontal className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            Reenviar confirmación
                          </button>
                          {canHardDelete && (
                            <>
                              <div className="my-1 border-t border-slate-100" />
                              <button
                                onClick={(e) => { e.stopPropagation(); setActionMenu(null); setDeleteTarget(p); }}
                                className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5 shrink-0 text-red-500" />
                                Eliminar paciente
                              </button>
                            </>
                          )}
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
        onCreated={(patient, wasReactivated, appInvitation) => {
          fetchPatients({ force: true });
          fetchTabCounts();
          const baseMsg = wasReactivated
            ? `Paciente "${patient.firstName} ${patient.lastName}" reactivado correctamente.`
            : `Paciente "${patient.firstName} ${patient.lastName}" creado correctamente.`;
          if (!appInvitation) {
            showToast(baseMsg);
          } else if (appInvitation.sent) {
            showToast(`${baseMsg} Invitación a la app enviada a ${appInvitation.destino}.`);
          } else {
            showToast(`${baseMsg} No se pudo enviar la invitación a la app: ${appInvitation.error}.`);
          }
        }}
      />
      <DelegatedAppointmentModal
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        initialData={scheduleForPatient ? { patient: scheduleForPatient, patientId: scheduleForPatient.id } : undefined}
        onSuccess={() => {
          setScheduleOpen(false);
          fetchPatients({ force: true });
          fetchTabCounts();
          showToast('Cita agendada correctamente.');
        }}
      />
      <CreatePatientModal
        isOpen={editOpen}
        patient={editPatientTarget}
        userRole={userRole}
        onClose={() => setEditOpen(false)}
        onUpdated={(patient) => {
          fetchPatients({ force: true });
          fetchTabCounts();
          showToast(`Paciente "${patient.firstName} ${patient.lastName}" actualizado correctamente.`);
        }}
      />
      <DeletePatientConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        patient={deleteTarget}
        onDeleted={({ rowCounts, s3ObjectsDeleted, accountDeleted }) => {
          const totalRows = Object.values(rowCounts).reduce((sum, n) => sum + n, 0);
          fetchPatients({ force: true });
          fetchTabCounts();
          showToast(
            `Paciente eliminado permanentemente (${totalRows} registro(s) relacionados${s3ObjectsDeleted ? `, ${s3ObjectsDeleted} archivo(s)` : ''}${accountDeleted ? ', cuenta de acceso incluida' : ''}).`
          );
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
            fetchPatients({ force: true });
            showToast(`${count} paciente(s) importado(s) correctamente.`);
          }}
        />
      )}
    </div>
  );
}

// Texto sencillo, sin píldora — decisión 2026-10-26, rediseño: una columna
// entera de píldoras de color competía visualmente con el punto de Estado,
// que es el único color que debe llamar la atención en la fila.
function ConvenioTag({ name }: { name?: string }) {
  const isParticular = !name || name === 'Particular';
  return (
    <span className={isParticular ? 'text-slate-400' : 'text-charcoal-900'}>
      {isParticular ? 'Particular' : name}
    </span>
  );
}

function TabButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-1 pb-2.5 text-sm font-semibold transition-colors cursor-pointer ${
        active
          ? 'border-charcoal-900 text-charcoal-900'
          : 'border-transparent text-slate-400 hover:text-charcoal-900'
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${active ? 'bg-toast-100 text-toast-600' : 'bg-slate-100 text-slate-400'}`}>
        {count.toLocaleString('es-CO')}
      </span>
    </button>
  );
}

function SortableHeader({
  label, field, sortField, sortDir, onSort, align,
}: {
  label: string; field: SortField; sortField: SortField; sortDir: SortDir; onSort: (f: SortField) => void; align?: 'right';
}) {
  const active = sortField === field;
  return (
    <th className={`px-3 py-2.5 font-semibold ${align === 'right' ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 cursor-pointer transition-colors hover:text-charcoal-900 ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        {active ? (
          sortDir === 'asc' ? <ArrowUp className="h-3 w-3 text-toast-500" /> : <ArrowDown className="h-3 w-3 text-toast-500" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </button>
    </th>
  );
}
