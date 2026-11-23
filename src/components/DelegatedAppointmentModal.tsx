/**
 * DelegatedAppointmentModal.tsx
 * Modal para Agendamiento Delegado desde el Portal Administrativo del EHR.
 *
 * Permite a usuarios CEO / DIRECTIVO crear citas asignándolas a un
 * especialista y paciente específicos, seleccionando modalidad
 * (Virtual / Presencial) de forma visual.
 *
 * Endpoints consumidos:
 *   GET  /api/users/specialists           → Lista de psicólogos del tenant
 *   GET  /api/appointments/patients?q=…    → Buscador de pacientes (máx. 20 resultados, nunca el listado completo)
 *   GET  /api/companies                    → Lista de Socios Corporativos reales
 *   GET  /api/specialties/options          → Catálogo de especialidades (sin costo)
 *   GET  /api/patients/:id/schedule-summary → Ficha del paciente (cupo + historial)
 *   POST /api/appointments                 → Creación de la cita delegada
 */

import { useState, useEffect, useRef, FormEvent } from 'react';
import { toast } from 'react-hot-toast';
import { X, Plus, Pencil, Video, Building2, CalendarClock, LockKeyhole, CircleCheck, CircleAlert, Loader2, User, UserRound, Info, Send, ChevronUp, ChevronDown } from 'lucide-react';
import { apiFetch, getApiBase } from '../lib/apiClient';
import { esCitaInactiva, ocupaHorario, ESTADO_POR_REAGENDAR } from '../lib/appointmentStatus';
import { getCompaniesCached, type CompanyRecord } from '../hooks/useCompanies';
import PsychologistAvailabilityGrid, { APPOINTMENT_DURATION_MINUTES, formatSlotTime, slotConflicts } from './PsychologistAvailabilityGrid';
import { ChangePsychologistDrawer, NewAgreementDrawer, type ChangePsychologistResult, type NewAgreementResult, type NewAgreementSelection } from './PatientHistoryDrawers';

// ── Tipos locales (alineados con Prisma pero desacoplados) ────────────────
interface Specialist {
  id: string;
  name: string;
  email: string;
  specialty?: string | null;
  level?: string | null;
}

interface PatientOption {
  id: string;
  firstName: string;
  lastName: string;
  documentId: string;
  email?: string | null;
  // Ya vienen en la respuesta de /api/appointments/patients?q=… y de
  // /api/patients/:id (PUT/POST) — antes esta interfaz los ocultaba y
  // "Corregir datos de este paciente" los reseteaba en blanco (o, peor,
  // reenviaba documentType='CC' fijo aunque el paciente real fuera TI/CE/…),
  // pisando en silencio un dato que nunca se había tocado.
  phone?: string | null;
  documentType?: string | null;
  birthDate?: string | null;
  recordNumber?: string | null;
  companyId?: string | null;
  corporateClient?: string | null;
  psychologistId?: string | null;
  psychologist?: { id: string; name: string } | null;
}


interface SpecialtyOption {
  id: string;
  name: string;
}

interface ScheduleSummaryAppointment {
  id: string;
  date: string;
  timeSlot: string;
  status: string;
  statusLabel: string;
  modality: string;
  psychologistName: string | null;
  specialtyName: string | null;
  companyName: string | null;
  sessionNumber: number;
}

interface ActiveAuthorization {
  id: string;
  companyId: string;
  companyName: string;
  sessionsAuthorized: number | null; // null = sesiones libres
  isConsultaExterna?: boolean;
}

interface ScheduleSummary {
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    documentId: string;
    documentType: string | null;
    phone: string | null;
    companyName: string | null;
    companyShortCode: string | null;
    agreementType: string | null;
    relacion: string | null;
    isConsultaExterna: boolean;
  };
  // Lote de sesiones VIGENTE del paciente — null si nunca se le autorizó
  // ninguno, o si el último se cerró (agotado o cambio de convenio). Sin
  // lote activo no se puede agendar (ver authorizeSessions/createAppointment
  // en el backend).
  activeAuthorization: ActiveAuthorization | null;
  sessionsTaken: number;
  sessionsRemaining: number | null;
  // Solo relevante para ESPECIALISTA_B2B: true si Tenant.
  // allowSpecialistSelfAuthorizeSessions está activo Y este paciente es
  // propio (Patient.psychologistId === el especialista logueado) — lo
  // calcula el backend (getScheduleSummary) para que el modal no tenga que
  // duplicar esa regla acá.
  canCallerSelfAuthorizeSessions: boolean;
  appointments: ScheduleSummaryAppointment[];
}

// Un ESPECIALISTA_B2B que entra a agendar solo puede quedar asignado a sí
// mismo — no debe ver (ni poder elegir) a los demás psicólogos del tenant en
// el selector. Mismo patrón de lectura de rol que ya usa este archivo para
// canAuthorizeSessions (localStorage.mind_user, sin prop nuevo desde los dos
// portales que montan este modal).
function getStoredUser(): { id: string; role: string } | null {
  try {
    const userStr = localStorage.getItem('mind_user');
    return userStr ? JSON.parse(userStr) : null;
  } catch {
    return null;
  }
}

const PARENTESCO_OPTIONS = ['Madre', 'Padre', 'Hermano/a', 'Cónyuge / Pareja', 'Hijo/a', 'Abuelo/a', 'Tutor legal', 'Otro'];
const DOCUMENT_TYPE_OPTIONS = ['CC', 'TI', 'PEP', 'PA', 'CE'];

const STATUS_BADGE_STYLES: Record<string, string> = {
  Pendiente: 'bg-orange-50 text-orange-600 border border-orange-200',
  Atendida: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  'No Atendido': 'bg-red-50 text-red-600 border border-red-200',
  Reprogramada: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  Cancelada: 'bg-slate-100 text-slate-500 border border-slate-200',
};

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr);
  const dateLabel = d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeLabel = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  return { dateLabel, timeLabel };
}

function formatScheduleDate(dateTimeLocal: string, year = false): string {
  const date = new Date(dateTimeLocal);
  if (Number.isNaN(date.getTime())) return 'Selecciona una fecha';
  return date.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }).replace(/\./g, '');
}

// ── Agendamiento múltiple (varias sesiones en una sola confirmación) ──────
// `slotDates` guarda un datetime-local por cita. Cada horario se elige
// explícitamente en la grilla, sin crear selecciones automáticas.

// ── Documento / Teléfono: solo dígitos, tope de longitud aplicado al vuelo
// (no se puede ni escribir un carácter inválido, no es solo un mensaje de
// error después de enviar) ─────────────────────────────────────────────
function onlyDigits(value: string, maxLen: number): string {
  return value.replace(/\D/g, '').slice(0, maxLen);
}

// Nombres/apellidos: solo letras (incluye tildes/ñ), espacios y guion — sin
// dígitos ni símbolos. Igual que onlyDigits, filtra al vuelo.
function onlyLetters(value: string): string {
  return value.replace(/[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ\s-]/g, '');
}

function resizeSlotDates(current: string[], targetCount: number): string[] {
  const safeTarget = Math.max(1, targetCount);
  if (safeTarget <= current.length) return current.slice(0, safeTarget);
  const next = [...current];
  while (next.length < safeTarget) {
    next.push('');
  }
  return next;
}

// Mismo día/hora, una semana después — para autocompletar las sesiones
// restantes de un bloque (ver fillSlotFromAvailability más abajo).
function addWeekToDateTimeLocal(dateTimeLocal: string): string {
  const d = new Date(dateTimeLocal);
  d.setDate(d.getDate() + 7);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Caché de los catálogos que alimentan los selectores del modal.
//
// Vive a nivel de módulo (no en estado de React) a propósito: así sobrevive al
// desmontaje del modal y la segunda apertura es instantánea. Son datos que
// cambian con poca frecuencia — especialistas, pacientes, convenios y
// especialidades del tenant — y se revalidan en segundo plano en cada apertura,
// de modo que nunca quedan obsoletos más de lo que dura una sesión de trabajo.
// ─────────────────────────────────────────────────────────────────────────────
const SELECTORES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

interface SelectoresData {
  specialists: Specialist[];
  companies: CompanyRecord[];
  specialties: SpecialtyOption[];
}

let selectoresCache: (SelectoresData & { ts: number }) | null = null;

/** Petición en vuelo — evita disparar dos cargas simultáneas (p. ej. si el
 *  prefetch aún no terminó y el usuario ya abrió el modal). */
let cargaEnVuelo: Promise<SelectoresData> | null = null;

const cacheEsValida = (): boolean =>
  !!selectoresCache && Date.now() - selectoresCache.ts < SELECTORES_CACHE_TTL_MS;

// Se llama al iniciar/cerrar sesión (ver Login.tsx/App.tsx) — sin esto, un
// cambio de tenant/usuario dentro de la misma pestaña (sin recargar la
// página) podía seguir sirviendo especialistas/convenios/especialidades del
// tenant ANTERIOR durante hasta 5 minutos: el caché vive a nivel de módulo,
// no se resetea solo con un remount de React.
export function invalidateSelectoresCache(): void {
  selectoresCache = null;
}

// NOTA: los pacientes NO se precargan/cachean aquí a propósito — a diferencia
// de especialistas/convenios/especialidades (catálogos acotados al tamaño del
// staff/convenios del tenant), el universo de pacientes puede ser enorme
// (decenas o cientos de miles). Se buscan bajo demanda con debounce contra
// GET /api/appointments/patients?q=… (ver efecto de búsqueda más abajo),
// nunca se trae el listado completo al frontend.
async function cargarSelectores(): Promise<SelectoresData> {
  if (cargaEnVuelo) return cargaEnVuelo;

  cargaEnVuelo = (async () => {
    const [specialists, companies, specialtyRes] = await Promise.all([
      apiFetch('/api/users/specialists'),
      // Reutiliza la misma caché compartida que PacientesPanel/CreatePatientModal/
      // el panel de Convenios de AdminPortal (ver src/hooks/useCompanies.ts) — así
      // este modal no dispara su propia petición a /api/companies si alguno de
      // esos consumidores ya la trajo recientemente.
      getCompaniesCached(),
      apiFetch('/api/specialties/options'),
    ]);

    const leer = async <T,>(res: Response): Promise<T[]> => {
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    };

    const frescos: SelectoresData = {
      specialists:  await leer<Specialist>(specialists),
      companies,
      specialties:  await leer<SpecialtyOption>(specialtyRes),
    };

    selectoresCache = { ...frescos, ts: Date.now() };
    return frescos;
  })();

  try {
    return await cargaEnVuelo;
  } finally {
    cargaEnVuelo = null;
  }
}

/**
 * RENDIMIENTO — Precarga de los catálogos del agendamiento.
 *
 * El agendamiento es el flujo central del producto y se usa a diario, así que
 * no debe percibirse ninguna espera al abrir el modal. Las páginas que montan
 * este modal (AdminPortal, PsychologistPortal, PacientesPanel) llaman a esta
 * función al montarse: para cuando el usuario pulsa "Agendar cita", los datos
 * ya están en caché y el modal abre de inmediato.
 *
 * Esto ataca la causa real del retraso observado: el backend corre en Lambda y
 * un arranque en frío anade segundos a la primera petición. Adelantarla al
 * montaje de la página mueve esa espera a un momento en que el usuario no la
 * percibe, en vez de cobrarla justo cuando quiere agendar.
 *
 * Es silenciosa a propósito: si falla, el modal reintentará al abrirse.
 */
export function prefetchSelectoresAgendamiento(): void {
  if (cacheEsValida() || cargaEnVuelo) return;
  cargarSelectores().catch(() => {
    /* silencioso: el modal reintenta al abrirse */
  });
}

interface DelegatedAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialData?: any; // Datos de la cita existente para modo edición
  // Ir al perfil/historia clínica del paciente ya seleccionado (decisión
  // 2026-10-29) — cada portal navega distinto (AdminPortal cambia de
  // pestaña a "patients", PsychologistPortal a "clinical_history"), así que
  // este modal compartido delega la navegación en vez de asumir una.
  // Opcional: si no se pasa, el ícono simplemente no aparece.
  onViewPatientProfile?: (patientId: string) => void;
}

export default function DelegatedAppointmentModal({
  isOpen,
  onClose,
  onSuccess,
  initialData,
  onViewPatientProfile,
}: DelegatedAppointmentModalProps) {
  // ── Data state ──────────────────────────────────────────────────────────
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [specialties, setSpecialties] = useState<SpecialtyOption[]>([]);
  const [agreementTypes, setAgreementTypes] = useState<{ id: string; name: string }[]>([]);
  // Crear un tipo de convenio sin salir de este modal (decisión 2026-10-23) —
  // antes había que cancelar el agendamiento, ir a Convenios, crearlo ahí y
  // volver a empezar. Queda asociado al convenio YA elegido arriba
  // (form.corporateClient) y se autoselecciona apenas se guarda.
  const [isCreatingAgreementType, setIsCreatingAgreementType] = useState(false);
  const [newAgreementTypeName, setNewAgreementTypeName] = useState('');
  const [savingAgreementType, setSavingAgreementType] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditingAppointment = !!initialData?.id;
  // Una cita ya atendida/cancelada, o cuya fecha ya pasó, no se puede
  // reprogramar — es un registro cerrado o vencido. El backend también lo
  // valida (defensa en profundidad); esto es para no dejar ni intentar.
  const isLockedForReschedule = isEditingAppointment && !!initialData && (
    initialData.status === 'Atendida' ||
    esCitaInactiva(initialData.status) ||
    // 'Por reagendar' se puede reprogramar aunque su fecha ya pasó: esa
    // fecha nunca fue válida (el nuevo tratante ya la tenía ocupada).
    (initialData.status !== ESTADO_POR_REAGENDAR && !!initialData.date && new Date(initialData.date).getTime() < Date.now())
  );
  const lockedRescheduleReason = !isLockedForReschedule ? null
    : initialData.status === 'Atendida' ? 'Esta cita ya fue atendida — no se puede reprogramar.'
    : initialData.status === 'Cancelada' ? 'Esta cita fue cancelada — no se puede reprogramar.'
    : initialData.status === 'Anulada' ? 'Esta cita fue anulada — no se puede reprogramar.'
    : initialData.status === 'Reasignada' ? 'Esta cita se reasignó a otro profesional — no se puede reprogramar.'
    : 'La fecha y hora de esta cita ya pasaron — no se puede reprogramar.';

  // ── Buscador de paciente (autocomplete, no listado completo) ───────────
  // El universo de pacientes de un tenant puede ser enorme — se busca bajo
  // demanda contra GET /api/appointments/patients?q=…, con debounce, en vez
  // de traer/cachear el listado entero como sí se hace con especialistas,
  // convenios y especialidades (esos son catálogos acotados por diseño).
  const [selectedPatientFull, setSelectedPatientFull] = useState<PatientOption | null>(null);
  // Convenio+relación del paciente no cambian por esto — solo marca que ESTE
  // episodio llegó por Consulta Externa en vez del canal corporativo
  // habitual, para mantener el costo que se le venía manejando y agregar
  // "(CE)" a la historia clínica (ver isConsultaExterna en patient.controller.js).
  // Es administrativo, no clínico — editable solo para CEO/DIRECTIVO/OPERATIVO,
  // mismo criterio que canManageStatus en PacientesPanel.tsx.
  const [isConsultaExterna, setIsConsultaExterna] = useState(false);
  const [savingConsultaExterna, setSavingConsultaExterna] = useState(false);
  const [patientSearchTerm, setPatientSearchTerm] = useState('');
  const [patientSearchResults, setPatientSearchResults] = useState<PatientOption[]>([]);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [showPatientResults, setShowPatientResults] = useState(false);

  // ── Ficha del paciente (cupo de sesiones + historial) ──────────────────
  const [scheduleSummary, setScheduleSummary] = useState<ScheduleSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  // Solo hay cupo para agendar si existe un lote activo Y (es libre o le
  // queda saldo) — se usa para ocultar el calendario de Fecha y Hora cuando
  // no tiene sentido dejar elegir un día que no se podrá confirmar.
  const hasUsableBatch = !!scheduleSummary?.activeAuthorization && (
    scheduleSummary.activeAuthorization.sessionsAuthorized === null ||
    (scheduleSummary.sessionsRemaining ?? 0) > 0
  );

  // ── Sesiones autorizadas (numérico libre + toggle "sesiones libres") ───
  // Solo se usan para AUTORIZAR el cupo inicial al crear un paciente nuevo
  // ── Agendamiento múltiple: una fecha/hora por sesión a crear ahora ─────
  const [slotDates, setSlotDates] = useState<string[]>(['']);
  const [activeSlotIndex, setActiveSlotIndex] = useState<number | null>(null);
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | null>(null);
  const [editingSlotDateTime, setEditingSlotDateTime] = useState('');
  const [editingSlotOriginal, setEditingSlotOriginal] = useState('');
  const lastAutoSizedPatientId = useRef<string | null>(null);
  // Fecha/hora original de la cita al entrar en modo edición — para saber si
  // el usuario realmente la movió (y por lo tanto sí toca marcarla como
  // "Reprogramada") o si guardó sin tocar la fecha (no hay nada que reprogramar).
  const originalDateTimeRef = useRef<string>('');

  // Cada clic en el calendario asigna exactamente un horario. Las sesiones
  // restantes siguen vacías para poder elegirlas en cualquier día visible.
  const fillSlotFromAvailability = (dateTimeLocal: string) => {
    if (slotConflicts(dateTimeLocal, [...psychologistBusyTimes, ...slotDates.filter(Boolean)])) {
      toast.error('Ese horario se cruza con otra cita o sesión elegida.');
      return;
    }
    const firstEmptyIndex = slotDates.findIndex((slot) => !slot);
    if (firstEmptyIndex === -1) {
      toast('Todas las sesiones ya tienen fecha asignada.');
      return;
    }
    setSlotDates((prev) => {
      const idx = prev.findIndex((s) => !s);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = dateTimeLocal;
      // Autocompleta semanalmente las sesiones restantes (mismo día/hora, una
      // semana después de la anterior) — si una semana choca con otra cita,
      // se detiene ahí y deja esa sesión en adelante sin fecha, para que el
      // usuario las elija manualmente en el calendario (ver "Horarios elegidos").
      let cursor = dateTimeLocal;
      for (let i = idx + 1; i < next.length; i++) {
        if (next[i]) continue;
        cursor = addWeekToDateTimeLocal(cursor);
        const occupied = [...psychologistBusyTimes, ...next.filter((s, j) => j !== i && s)];
        if (slotConflicts(cursor, occupied)) break;
        next[i] = cursor;
      }
      return next;
    });
    setActiveSlotIndex(firstEmptyIndex);
  };

  // Clic en una sesión ya resaltada como pendiente en el grid → la limpia,
  // para corregir un día mal seleccionado sin tener que borrar el campo a mano.
  const clearSlotFromAvailability = (dateTimeLocal: string) => {
    setSlotDates((prev) => prev.map((s) => (s === dateTimeLocal ? '' : s)));
    if (activeSlotIndex !== null && slotDates[activeSlotIndex] === dateTimeLocal) setActiveSlotIndex(null);
    if (editingSlotIndex !== null && slotDates[editingSlotIndex] === dateTimeLocal) closeSlotEdit();
  };

  const startSlotEdit = (index: number) => {
    const original = slotDates[index];
    if (!original) return;
    setShowAuthorizationDrawer(false);
    setAvailabilityTab('availability');
    setEditingSlotIndex(index);
    setActiveSlotIndex(index);
    setEditingSlotDateTime(original);
    setEditingSlotOriginal(original);
  };

  const closeSlotEdit = () => {
    setEditingSlotIndex(null);
    setEditingSlotDateTime('');
    setEditingSlotOriginal('');
    setEditingDayCheckedDate('');
  };

  // ── Autorizar sesiones (crear el primer lote, ampliar el vigente, o
  // cambiar de convenio) — un solo flujo, ver POST .../authorize-sessions.
  // Mismo convenio del lote activo = suma; convenio distinto = cierra el
  // lote actual (pierde lo que le quedaba) y abre uno nuevo.
  //
  // Este endpoint YA NO aplica el cambio directo — arma una solicitud y
  // manda un código de confirmación a un "aprobador" elegido (control de dos
  // personas, ver session-change.service.js en el backend). El cambio real
  // solo ocurre al verificar ese código.
  const [authCompanyId, setAuthCompanyId] = useState('');
  const [authSessionsInput, setAuthSessionsInput] = useState('');
  const [authLibres, setAuthLibres] = useState(false);
  // 'SUBTRACT' corrige el caso real de "me equivoqué y agregué de más" — ver
  // applySessionSubtraction en el backend. Solo aplica sobre el lote VIGENTE
  // del paciente, así que no tiene sentido combinarlo con "Libres (sin tope)".
  const [authChangeType, setAuthChangeType] = useState<'ADD' | 'SUBTRACT'>('ADD');
  const [authorizingSessions, setAuthorizingSessions] = useState(false);
  const [approvers, setApprovers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [authApproverId, setAuthApproverId] = useState('');
  const [pendingChangeRequestId, setPendingChangeRequestId] = useState<string | null>(null);
  const [pendingChangeExpiresInMinutes, setPendingChangeExpiresInMinutes] = useState<number | null>(null);
  const [verifyCodeInput, setVerifyCodeInput] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [showAuthorizationDrawer, setShowAuthorizationDrawer] = useState(false);
  const [historyDrawer, setHistoryDrawer] = useState<'change' | 'agreement' | null>(null);
  const [availabilityRefreshKey, setAvailabilityRefreshKey] = useState(0);
  const [availabilityTab, setAvailabilityTab] = useState<'availability' | 'history'>('availability');

  // ── Patient Provisioning State ──────────────────────────────────────────
  const [isCreatingPatient, setIsCreatingPatient] = useState(false);
  const [isEditingPatient, setIsEditingPatient] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [newPatientFirstName, setNewPatientFirstName] = useState('');
  const [newPatientLastName, setNewPatientLastName] = useState('');
  const [newPatientEmail, setNewPatientEmail] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [newPatientDocumentType, setNewPatientDocumentType] = useState('CC');
  const [newPatientDocument, setNewPatientDocument] = useState('');
  const [newPatientBirthDate, setNewPatientBirthDate] = useState('');
  const [emergencyNombres, setEmergencyNombres] = useState('');
  const [emergencyApellidos, setEmergencyApellidos] = useState('');
  const [emergencyTelefono, setEmergencyTelefono] = useState('');
  const [emergencyParentesco, setEmergencyParentesco] = useState('');

  // ── Form state ──────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    userId: initialData?.psychologist?.id || '',
    patientId: initialData?.patient?.id || '',
    specialtyId: initialData?.specialtyId || '',
    dateTime: initialData?.date ? new Date(initialData.date).toISOString().slice(0, 16) : '',
    timeSlot: initialData?.timeSlot || '',
    appointmentType: initialData?.appointmentType || 'clinico',
    modality: initialData?.modality || ('Virtual' as 'Virtual' | 'Presencial'),
    location: initialData?.location || '',
    notes: initialData?.notes || '',
    corporateClient: initialData?.corporateClient || '',
    locationId: initialData?.locationId || '',
    agreementType: initialData?.agreementType || '',
  });

  // ── Horarios ya ocupados del psicólogo seleccionado (próximos 90 días) ──
  // Se usa para NO autocompletar la cascada semanal sobre un horario que ya
  // tiene otra cita, y para marcar con alerta visual cualquier sesión cuya
  // fecha (llenada a mano, por cascada o desde el grid) choque con una cita
  // existente — el backend igual lo rechaza al confirmar, pero así se
  // detecta antes de intentar guardar. Clave = mismo string "YYYY-MM-DDTHH:mm"
  // que usan los inputs datetime-local, para comparar sin conversión.
  const [psychologistBusyTimes, setPsychologistBusyTimes] = useState<Set<string>>(new Set());
  const [editingDayBusyTimes, setEditingDayBusyTimes] = useState<Set<string>>(new Set());
  const [editingDayLoading, setEditingDayLoading] = useState(false);
  const [editingDayError, setEditingDayError] = useState(false);
  const [editingDayCheckedDate, setEditingDayCheckedDate] = useState('');
  const editingSlotConflicts = editingSlotIndex !== null && slotConflicts(editingSlotDateTime, [
    ...psychologistBusyTimes,
    ...editingDayBusyTimes,
    ...slotDates.filter((value, index) => index !== editingSlotIndex && value),
  ]);
  const editingSlotIsPast = editingSlotDateTime ? new Date(editingSlotDateTime).getTime() < Date.now() : true;
  const editingDayReady = !editingDayLoading && !editingDayError && editingDayCheckedDate === editingSlotDateTime.slice(0, 10);

  useEffect(() => {
    if (editingSlotIndex === null || !editingSlotDateTime || !form.userId) return;
    let cancelled = false;
    const dayStart = new Date(`${editingSlotDateTime.slice(0, 10)}T00:00`);
    if (Number.isNaN(dayStart.getTime())) return;
    const nextDay = new Date(dayStart);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setMinutes(nextDay.getMinutes() + APPOINTMENT_DURATION_MINUTES);
    const from = new Date(dayStart.getTime() - APPOINTMENT_DURATION_MINUTES * 60_000);
    setEditingDayLoading(true);
    setEditingDayError(false);
    setEditingDayCheckedDate('');
    apiFetch(`/api/appointments?psychologistId=${form.userId}&from=${from.toISOString()}&to=${nextDay.toISOString()}`)
      .then((res) => { if (!res.ok) throw new Error('No se pudo consultar la disponibilidad'); return res.json(); })
      .then((data: any[]) => {
        if (cancelled) return;
        if (!Array.isArray(data)) throw new Error('Respuesta de disponibilidad inválida');
        const busy = new Set<string>();
        for (const appt of data) {
          if (!ocupaHorario(appt.status)) continue;
          const date = new Date(appt.date);
          busy.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
        }
        setEditingDayBusyTimes(busy);
        setEditingDayCheckedDate(editingSlotDateTime.slice(0, 10));
      })
      .catch(() => { if (!cancelled) setEditingDayError(true); })
      .finally(() => { if (!cancelled) setEditingDayLoading(false); });
    return () => { cancelled = true; };
  }, [editingSlotIndex, editingSlotDateTime.slice(0, 10), form.userId]);

  useEffect(() => {
    if (!form.userId) { setPsychologistBusyTimes(new Set()); return; }
    let cancelled = false;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    // Límite EXCLUSIVO (ver listAppointments en Mind) — medianoche de dentro
    // de 90 días, así que el rango real cubierto son los próximos 90 días
    // completos (hoy incluido), no 89.
    const to = new Date(from);
    to.setDate(to.getDate() + 90);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const toLocalKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    apiFetch(`/api/appointments?psychologistId=${form.userId}&from=${from.toISOString()}&to=${to.toISOString()}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: any[]) => {
        if (cancelled || !Array.isArray(data)) return;
        const busy = new Set<string>();
        for (const appt of data) {
          if (!ocupaHorario(appt.status)) continue;
          if (isEditingAppointment && appt.id === initialData?.id) continue; // no choca contra sí misma
          busy.add(toLocalKey(new Date(appt.date)));
        }
        setPsychologistBusyTimes(busy);
      })
      .catch(() => { if (!cancelled) setPsychologistBusyTimes(new Set()); });
    return () => { cancelled = true; };
  }, [form.userId, isEditingAppointment, initialData?.id, availabilityRefreshKey]);

  // Si initialData cambia, actualizar el form
  useEffect(() => {
    const storedUser = getStoredUser();
    // Un especialista solo puede agendarse a sí mismo — se precarga de una
    // vez para que no tenga que buscarse en un selector que de todos modos
    // solo lo va a mostrar a él (ver visibleSpecialists más abajo).
    const ownIdIfSpecialist = storedUser?.role === 'ESPECIALISTA_B2B' ? storedUser.id : '';
    if (initialData) {
      const initialDateTime = initialData.date ? (() => {
        const d = new Date(initialData.date);
        const pad = (n: number) => n.toString().padStart(2, '0');
        return !isNaN(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
      })() : '';
      originalDateTimeRef.current = initialDateTime;
      setForm({
        userId: initialData.psychologist?.id || initialData.userId || ownIdIfSpecialist,
        patientId: initialData.patient?.id || initialData.patientId || '',
        specialtyId: initialData.specialtyId || '',
        dateTime: initialDateTime,
        timeSlot: initialData.timeSlot || '',
        appointmentType: initialData.appointmentType || 'clinico',
        modality: initialData.modality || ('Virtual' as 'Virtual' | 'Presencial'),
        location: initialData.location || '',
        notes: initialData.notes || '',
        corporateClient: initialData.corporateClient || '',
        locationId: initialData.locationId || '',
        agreementType: initialData.agreementType || '',
      });
      // Precarga el paciente ya conocido (reprogramar una cita existente, o
      // "Agendar" desde la fila de un paciente en PacientesPanel) para que el
      // buscador muestre su nombre de inmediato, sin tener que buscarlo.
      if (initialData.patient?.firstName) {
        setSelectedPatientFull({
          id: initialData.patient.id,
          firstName: initialData.patient.firstName,
          lastName: initialData.patient.lastName,
          documentId: initialData.patient.documentId || '',
          email: initialData.patient.email,
          phone: initialData.patient.phone,
          documentType: initialData.patient.documentType,
          birthDate: initialData.patient.birthDate,
          recordNumber: initialData.patient.recordNumber,
          companyId: initialData.patient.companyId,
          corporateClient: initialData.patient.corporateClient,
          psychologistId: initialData.patient.psychologistId || initialData.patient.psychologist?.id,
          psychologist: initialData.patient.psychologist,
        });
      } else {
        setSelectedPatientFull(null);
      }
    } else {
      setForm({
        userId: ownIdIfSpecialist, patientId: '', specialtyId: '', dateTime: '', timeSlot: '',
        appointmentType: 'clinico', modality: 'Virtual', location: '', notes: '',
        corporateClient: '', locationId: '', agreementType: '',
      });
      setSelectedPatientFull(null);
    }
    setPatientSearchTerm('');
    setPatientSearchResults([]);
    setShowPatientResults(false);
    setSlotDates(['']);
    closeSlotEdit();
    setAuthCompanyId('');
    setAuthSessionsInput('');
    setAuthLibres(false);
    setAuthChangeType('ADD');
    setShowAuthorizationDrawer(false);
    setHistoryDrawer(null);
    setAuthApproverId('');
    setPendingChangeRequestId(null);
    setPendingChangeExpiresInMinutes(null);
    setVerifyCodeInput('');
    lastAutoSizedPatientId.current = null;
  }, [initialData, isOpen]);

  // ── Fetch datos al abrir ──────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    fetchSelectorsData();
  }, [isOpen]);

  // Aprobadores elegibles (User.canApproveSessionChanges) para el
  // desplegable "¿A quién le llega el código?" — solo tiene sentido pedirlo
  // si el caller de verdad puede autorizar sesiones. Usa getStoredUser()
  // directo (no la constante canAuthorizeSessions de más abajo, declarada
  // después en el render) para no depender del orden de declaración.
  // Se manda patientId: un CEO puede autorizar sesiones de un paciente de
  // OTRO tenant, y los aprobadores válidos son los de ESE tenant, no los del
  // tenant del propio CEO — sin esto, el desplegable salía vacío (o con
  // gente que el backend iba a rechazar igual) cada vez que el paciente no
  // era del tenant del caller.
  useEffect(() => {
    const role = getStoredUser()?.role;
    if (!isOpen || (role !== 'CEO' && role !== 'DIRECTIVO') || !form.patientId) return;
    apiFetch(`/api/session-changes/approvers?patientId=${form.patientId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setApprovers(Array.isArray(data) ? data : []))
      .catch(() => setApprovers([]));
  }, [isOpen, form.patientId]);

  /**
   * Carga de los selectores con caché y revalidación en segundo plano
   * (stale-while-revalidate).
   *
   * Antes, cada apertura disparaba las 4 peticiones y bloqueaba TODO el cuerpo
   * con "Cargando especialistas y pacientes del tenant…" hasta que terminaba la
   * MÁS LENTA (Promise.all espera a todas). Sin caché, abrir/cerrar/abrir
   * repetía la espera completa. Y como el backend corre en Lambda, un arranque
   * en frío anade segundos justo en el momento de agendar.
   *
   * Ahora, en orden de preferencia:
   *   1. Las páginas precargan con prefetchSelectoresAgendamiento() al montar,
   *      así que al abrir el modal la caché ya suele estar lista.
   *   2. Si hay datos en caché, se pintan al instante y se revalida por detrás.
   *   3. Solo se muestra el estado de carga cuando no hay nada que mostrar.
   */
  const aplicarDatos = (d: SelectoresData) => {
    setSpecialists(d.specialists);
    setCompanies(d.companies);
    setSpecialties(d.specialties);
  };

  const fetchSelectorsData = async () => {
    if (cacheEsValida()) {
      // Apertura inmediata con lo cacheado; se revalida más abajo sin bloquear
      aplicarDatos(selectoresCache!);
      setIsLoadingData(false);
    } else {
      setIsLoadingData(true);
    }

    try {
      aplicarDatos(await cargarSelectores());
    } catch (err) {
      console.error('[DelegatedModal] Error cargando datos de selectores:', err);
    } finally {
      setIsLoadingData(false);
    }
  };

  // "Tipo de convenio" es propio de CADA convenio (companyId) — no un
  // catálogo compartido de todo el tenant (ver comentario en schema.prisma).
  // Se recarga cada vez que cambia el convenio resuelto de la cita
  // (form.corporateClient), sea porque el usuario lo eligió a mano o porque
  // ya vino fijo del paciente seleccionado. No toca form.agreementType acá
  // a propósito — eso se limpia en el momento exacto en que el usuario
  // cambia de convenio (ver los setForm de arriba), no en este efecto.
  useEffect(() => {
    const selectedCompany = companies.find((c) => c.name === form.corporateClient);
    if (!selectedCompany) { setAgreementTypes([]); return; }
    let cancelled = false;
    apiFetch(`/api/agreement-types?companyId=${selectedCompany.id}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => { if (!cancelled) setAgreementTypes(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setAgreementTypes([]); });
    return () => { cancelled = true; };
  }, [form.corporateClient, companies]);

  const handleCreateAgreementType = async () => {
    const name = newAgreementTypeName.trim();
    if (!name) return;
    const selectedCompany = companies.find((c) => c.name === form.corporateClient);
    if (!selectedCompany) {
      toast.error('Elige primero un convenio.');
      return;
    }
    setSavingAgreementType(true);
    try {
      const res = await apiFetch('/api/agreement-types', {
        method: 'POST',
        body: JSON.stringify({ name, companyId: selectedCompany.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Error al crear el tipo de convenio');
        return;
      }
      setAgreementTypes((prev) => [...prev, data]);
      setForm((prev) => ({ ...prev, agreementType: data.name }));
      setNewAgreementTypeName('');
      setIsCreatingAgreementType(false);
      toast.success('Tipo de convenio creado y seleccionado.');
    } catch {
      toast.error('Error de red al crear el tipo de convenio');
    } finally {
      setSavingAgreementType(false);
    }
  };

  // ── Ficha del paciente: se recarga cada vez que cambia el paciente seleccionado ──
  useEffect(() => {
    if (!form.patientId || isCreatingPatient) {
      setScheduleSummary(null);
      setIsConsultaExterna(false);
      lastAutoSizedPatientId.current = null;
      return;
    }
    let cancelled = false;
    setLoadingSummary(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/patients/${form.patientId}/schedule-summary`);
        if (!res.ok) return;
        const data: ScheduleSummary = await res.json();
        if (cancelled) return;
        setScheduleSummary(data);

        // Convenio con el que el paciente fue registrado — solo se muestra,
        // nunca se reasigna desde aquí (ver punto 1: el backend tampoco lo
        // sobrescribe una vez el paciente ya tiene uno).
        if (data.patient.companyName) {
          setForm((prev) => ({ ...prev, corporateClient: data.patient.companyName! }));
        }
        // Tipo de convenio ya guardado del paciente — antes faltaba este
        // precargue y el selector siempre arrancaba en "Sin especificar"
        // aunque el paciente ya tuviera uno asignado.
        setForm((prev) => ({ ...prev, agreementType: data.patient.agreementType || '' }));
        setIsConsultaExterna(!!data.patient.isConsultaExterna);

        // Sugerir cuántas sesiones agendar ahora, y precargar el convenio en
        // el formulario de "Autorizar sesiones" — solo la primera vez que se
        // carga la ficha de ESTE paciente, para no pisar lo que el
        // administrativo ya haya ajustado a mano (p. ej. tras autorizar más).
        if (lastAutoSizedPatientId.current !== data.patient.id) {
          lastAutoSizedPatientId.current = data.patient.id;
          const remaining = data.sessionsRemaining;
          const suggested = remaining === null || remaining <= 0 ? 1 : remaining;
          setSlotDates((prev) => resizeSlotDates(prev, suggested));

          const fallbackCompanyId = companies.find((c) => c.name === data.patient.companyName)?.id || '';
          setAuthCompanyId(data.activeAuthorization?.companyId || fallbackCompanyId);
        }
      } catch {
        // silencioso — la ficha es informativa, no bloquea el agendamiento
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    })();
    return () => { cancelled = true; };
  }, [form.patientId, isCreatingPatient]);

  // ── Buscador de paciente: debounce contra el backend, nunca el listado
  // completo. Se dispara mientras el dropdown de resultados está abierto —
  // incluso con término vacío, para mostrar algo apenas se hace foco (el
  // backend igual limita a 20 resultados). ──────────────────────────────
  useEffect(() => {
    if (!showPatientResults || isEditingAppointment) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setPatientSearchLoading(true);
      try {
        const q = patientSearchTerm.trim();
        const res = await apiFetch(`/api/appointments/patients${q ? `?q=${encodeURIComponent(q)}` : ''}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setPatientSearchResults(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setPatientSearchResults([]);
      } finally {
        if (!cancelled) setPatientSearchLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [patientSearchTerm, showPatientResults, isEditingAppointment]);

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isEditingAppointment) {
      if (!form.patientId || !hasUsableBatch) {
        toast.error('Selecciona un paciente con sesiones autorizadas antes de agendar.');
        return;
      }
      if (!slotDates.length || slotDates.some((dateTime) => !dateTime || Number.isNaN(new Date(dateTime).getTime()))) {
        toast.error('Selecciona un horario para cada cita en el calendario.');
        return;
      }
      if ((!isUnlimitedAuth && slotDates.length > (scheduleSummary?.sessionsRemaining ?? 0)) || slotDates.some((dateTime, index) => slotConflicts(dateTime, [...psychologistBusyTimes, ...slotDates.filter((_, otherIndex) => otherIndex !== index)]))) {
        toast.error('Revisa el cupo y los horarios seleccionados antes de confirmar.');
        return;
      }
      if (new Set(slotDates).size !== slotDates.length) {
        toast.error('Cada cita debe tener un horario distinto.');
        return;
      }
    }
    setIsSubmitting(true);

    // Declarado ACÁ (no dentro del try) para que el catch pueda leerlo: solo
    // cuenta cuántas citas se alcanzaron a crear de verdad en ESTE envío, sin
    // importar si el paciente ya estaba seleccionado — ver el catch más abajo.
    let created = 0;

    try {
      const token  = localStorage.getItem('mind_token');
      const apiUrl = getApiBase();
      const selectedCompany = companies.find(c => c.name === form.corporateClient);

      // ── Reprogramación (edición de una cita existente) ──────────────────
      if (isEditingAppointment) {
        const dateChanged = form.dateTime !== originalDateTimeRef.current;
        const originalUserId = initialData.psychologist?.id || initialData.userId || '';
        const originalSpecialtyId = initialData.specialtyId || '';
        const otherFieldsChanged = form.userId !== originalUserId || form.specialtyId !== originalSpecialtyId;

        // Nada cambió — no tiene sentido pegarle al backend ni mucho menos
        // marcarla como "Reprogramada" cuando la fecha sigue siendo la misma.
        if (!dateChanged && !otherFieldsChanged) {
          toast('Sin cambios — no se guardó nada.', { icon: 'ℹ️' });
          resetAndClose();
          return;
        }

        // form.timeSlot solo se llena una vez al abrir el modal (desde
        // initialData.timeSlot) y ningún selector de fecha/hora lo vuelve a
        // tocar cuando el usuario elige un horario nuevo — por eso, al
        // reprogramar, hay que derivar el timeSlot del dateTime recién
        // editado (fuente de verdad real), no confiar en el valor viejo de
        // form.timeSlot. Si no se hace así, la cita queda con la hora nueva
        // en `date` pero la hora VIEJA en `timeSlot`, y como el correo/
        // WhatsApp de confirmación usa `timeSlot`, el paciente recibe una
        // hora distinta a la que realmente quedó agendada.
        // form.dateTime es un datetime-local "ingenuo" (ej. "2026-08-18T10:00",
        // sin zona horaria) — el navegador lo interpreta como hora de Bogotá,
        // pero el backend en Lambda corre en UTC. Si se manda tal cual, Lambda
        // lo reinterpreta como 10:00 UTC = 5:00 a.m. Bogotá, un desfase de 5h.
        // toISOString() lo convierte a un instante UTC inequívoco ANTES de
        // enviarlo, para que no importe en qué huso horario corra el backend.
        const dateTimeIso = form.dateTime ? new Date(form.dateTime).toISOString() : form.dateTime;
        const payload: Record<string, unknown> = {
          date:            dateTimeIso,
          timeSlot:        form.dateTime?.split('T')[1]?.slice(0, 5) || form.timeSlot || '08:00',
          specialistId:    form.userId,
          userId:          form.userId,
          specialtyId:     form.specialtyId || null,
          agreementType:   form.agreementType || null,
        };
        // Solo es una "reprogramación" real si la fecha/hora efectivamente
        // cambió — si solo se ajustó el especialista/especialidad, se guarda
        // el cambio pero se conserva el estado actual de la cita.
        if (dateChanged) payload.status = 'Reprogramada';

        const res = await fetch(`${apiUrl}/api/appointments/${initialData.id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        toast.success(dateChanged ? 'Cita reprogramada exitosamente.' : 'Cita actualizada exitosamente.');
        onSuccess?.();
        resetAndClose();
        return;
      }

      // ── Agendamiento nuevo — UNA sola llamada con todas las fechas de
      // slotDates (1 si el paciente agenda una única sesión, varias si se
      // está programando de una vez el bloque de sesiones disponibles).
      // El backend las crea en una transacción (todo o nada) y manda UN
      // solo correo/WhatsApp con la lista completa — antes esto era un loop
      // de N llamadas sueltas a /api/appointments, y cada una disparaba su
      // propia confirmación por separado (ver createAppointmentBatch en
      // appointment.controller.js).
      const dates = slotDates.map((dateTime) => ({
        // Mismo motivo que en la reprogramación: dateTime es un
        // datetime-local ingenuo (hora de Bogotá sin zona horaria) — se
        // convierte a UTC inequívoco antes de enviarlo para que Lambda no
        // lo reinterprete como si ya fuera UTC (desfase de 5 horas).
        date: new Date(dateTime).toISOString(),
        timeSlot: dateTime.split('T')[1]?.slice(0, 5) || '08:00',
      }));

      const payload = {
        patientId:       form.patientId,
        userId:          form.userId,
        specialtyId:     form.specialtyId || null,
        dates,
        appointmentType: form.appointmentType,
        modality:        form.modality,
        roomUrl:         form.modality === 'Virtual' ? '' : null,
        notes:           form.notes || null,
        corporateClient: form.corporateClient,
        companyId:       selectedCompany?.id || null,
        locationId:      form.locationId || null,
        agreementType:   form.agreementType || null,
      };

      const res = await fetch(`${apiUrl}/api/appointments/batch`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      created = slotDates.length;

      toast.success(created === 1 ? 'Cita creada exitosamente.' : `${created} citas creadas exitosamente.`);
      apiFetch(`/api/patients/${form.patientId}/schedule-summary`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setScheduleSummary(data))
        .catch(() => {});
      onSuccess?.();
      resetAndClose();
    } catch (err: any) {
      toast.error(`Error al agendar: ${err.message}`);
      // El endpoint de lote (/api/appointments/batch) es todo-o-nada: crea
      // TODAS las citas en una transacción, o ninguna. Antes esto era un
      // loop de llamadas sueltas, así que un fallo a mitad de camino podía
      // dejar algunas citas ya creadas ("éxito parcial") — ese caso ya no
      // puede ocurrir, así que si se llega acá, de verdad no se creó nada
      // (`created` sigue en 0; nunca se incrementa antes de lanzar). El
      // modal se queda abierto con todo lo que ya llenaste intacto, y el
      // toast de arriba es el único aviso.
    } finally {
      setIsSubmitting(false);
    }
  };

  const provisionPatient = async () => {
    if (!newPatientFirstName.trim() || !newPatientLastName.trim() || !newPatientDocument) {
      toast.error('Por favor, ingresa el nombre, apellido y documento del paciente.');
      return;
    }
    if (newPatientDocument.length > 10) {
      toast.error('El documento no puede tener más de 10 dígitos.');
      return;
    }
    if (newPatientPhone.length !== 10) {
      toast.error('El teléfono del paciente debe tener exactamente 10 dígitos.');
      return;
    }
    if (emergencyTelefono.length !== 10) {
      toast.error('El teléfono del contacto de emergencia debe tener exactamente 10 dígitos.');
      return;
    }

    if (!form.corporateClient) {
      toast.error('Selecciona primero el Convenio / Cliente Corporativo de la cita — el paciente se crea con ese convenio.');
      return;
    }

    setIsProvisioning(true);
    try {
      const token  = localStorage.getItem('mind_token');
      const apiUrl = getApiBase();
      const selectedCompany = companies.find((c) => c.name === form.corporateClient);
      const res = await fetch(`${apiUrl}/api/patients`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firstName: newPatientFirstName.trim(),
          lastName: newPatientLastName.trim(),
          email: newPatientEmail,
          phone: newPatientPhone,
          documentId: newPatientDocument,
          documentType: newPatientDocumentType,
          birthDate: newPatientBirthDate || undefined,
          corporateClient: form.corporateClient,
          companyId: selectedCompany?.id || undefined,
          psychologistId: form.userId || undefined,
          emergencyContactNombres: emergencyNombres || undefined,
          emergencyContactApellidos: emergencyApellidos || undefined,
          emergencyContactTelefono: emergencyTelefono || undefined,
          emergencyContactParentesco: emergencyParentesco || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const newPatient = await res.json();

      const newOption: PatientOption = {
        id: newPatient.id,
        firstName: newPatient.firstName,
        lastName: newPatient.lastName,
        documentId: newPatient.documentId,
        email: newPatient.email,
        phone: newPatient.phone,
        documentType: newPatient.documentType,
        birthDate: newPatient.birthDate,
        recordNumber: newPatient.recordNumber,
        companyId: newPatient.companyId,
        corporateClient: newPatient.corporateClient,
        psychologistId: newPatient.psychologistId,
        psychologist: newPatient.psychologist,
      };

      setSelectedPatientFull(newOption);
      setForm(prev => ({ ...prev, patientId: newOption.id }));
      setIsCreatingPatient(false);

      // Reset fields
      setNewPatientFirstName('');
      setNewPatientLastName('');
      setNewPatientEmail('');
      setNewPatientPhone('');
      setNewPatientDocumentType('CC');
      setNewPatientDocument('');
      setNewPatientBirthDate('');
      setEmergencyNombres('');
      setEmergencyApellidos('');
      setEmergencyTelefono('');
      setEmergencyParentesco('');

      toast.success('Paciente creado y seleccionado exitosamente.');
    } catch (err: any) {
      toast.error(`Error al crear paciente: ${err.message}`);
    } finally {
      setIsProvisioning(false);
    }
  };

  const resetAndClose = () => {
    setForm({
      userId: '', patientId: '', specialtyId: '', dateTime: '', timeSlot: '',
      appointmentType: 'clinico', modality: 'Virtual', location: '', notes: '',
      corporateClient: '', locationId: '', agreementType: '',
    });
    setIsEditingPatient(false);
    setIsCreatingPatient(false);
    setScheduleSummary(null);
    setSelectedPatientFull(null);
    setPatientSearchTerm('');
    setPatientSearchResults([]);
    setShowPatientResults(false);
    setSlotDates(['']);
    closeSlotEdit();
    setAuthCompanyId('');
    setAuthSessionsInput('');
    setAuthLibres(false);
    setAuthChangeType('ADD');
    setShowAuthorizationDrawer(false);
    setHistoryDrawer(null);
    setAuthApproverId('');
    setPendingChangeRequestId(null);
    setPendingChangeExpiresInMinutes(null);
    setVerifyCodeInput('');
    lastAutoSizedPatientId.current = null;
    onClose();
  };

  // Refresca la ficha del paciente y limpia el formulario de autorización
  // tras un cambio de cupo YA aplicado — usado tanto por el camino directo
  // (self-authorize, ver handleAuthorizeSessions) como por la verificación
  // del código del camino normal (ver handleVerifySessionChange). Antes esta
  // lógica solo vivía dentro de handleVerifySessionChange; se extrajo para
  // no duplicarla entre los dos caminos.
  const refreshAfterSessionChange = async (result: { renewed: boolean; closedReason: string | null; companyName: string }) => {
    const summaryRes = await apiFetch(`/api/patients/${form.patientId}/schedule-summary`);
    if (summaryRes.ok) {
      const data: ScheduleSummary = await summaryRes.json();
      setScheduleSummary(data);
      setForm((prev) => ({ ...prev, corporateClient: data.patient.companyName || prev.corporateClient }));
      // Amplía slotDates para cubrir el cupo TOTAL ya disponible (no solo lo
      // recién autorizado en esta pasada) sin perder las fechas que el
      // administrativo ya había llenado antes de autorizar — así se puede
      // autorizar de a poco (p. ej. 1 y luego 1 más) sin perder el avance.
      setSlotDates((prev) => {
        const filledCount = prev.filter(Boolean).length;
        const target = data.sessionsRemaining === null
          ? Math.max(filledCount, 1)
          : Math.max(data.sessionsRemaining, filledCount, 1);
        return resizeSlotDates(prev, target);
      });
    }

    setAuthSessionsInput('');
    setAuthLibres(false);
    setAuthChangeType('ADD');
    setAuthApproverId('');
    setPendingChangeRequestId(null);
    setPendingChangeExpiresInMinutes(null);
    setVerifyCodeInput('');
    setShowAuthorizationDrawer(false);
    toast.success(
      result.renewed
        ? `Lote anterior cerrado (${result.closedReason}) — nuevas sesiones autorizadas con ${result.companyName}.`
        : `Sesiones autorizadas con ${result.companyName}.`
    );
  };

  // ── Autorizar sesiones (crear el primer lote / ampliar el vigente /
  // cambiar de convenio). Dos caminos, según lo que devuelva el backend:
  //   - { applied: true, ... } — especialista con self-authorize activo
  //     sobre su propio paciente: el cambio YA se aplicó, sin código ni
  //     aprobador (ver Tenant.allowSpecialistSelfAuthorizeSessions).
  //   - { requestId, expiresInMinutes } — camino normal: arma la solicitud y
  //     manda el código al aprobador elegido (ver handleVerifySessionChange,
  //     que es quien de verdad aplica el cambio una vez el código coincide).
  const handleAuthorizeSessions = async () => {
    const n = Number(authSessionsInput);
    if (authChangeType === 'SUBTRACT') {
      if (!Number.isInteger(n) || n <= 0) {
        toast.error('Ingresa un número entero de sesiones a restar mayor a 0.');
        return;
      }
    } else {
      if (!authCompanyId) {
        toast.error('Selecciona el convenio con el que se autorizan estas sesiones.');
        return;
      }
      if (!authLibres && (!Number.isInteger(n) || n <= 0)) {
        toast.error('Ingresa un número entero de sesiones mayor a 0 (o marca "sesiones libres").');
        return;
      }
    }
    if (!isSelfAuthorize && !authApproverId) {
      toast.error('Elige a quién le va a llegar el código de confirmación.');
      return;
    }
    setAuthorizingSessions(true);
    try {
      const res = await apiFetch(`/api/patients/${form.patientId}/authorize-sessions`, {
        method: 'POST',
        body: JSON.stringify({
          changeType: authChangeType,
          ...(authChangeType === 'SUBTRACT'
            ? { sessionsAuthorized: n }
            : { companyId: authCompanyId, unlimited: authLibres, sessionsAuthorized: authLibres ? undefined : n }),
          ...(isSelfAuthorize ? {} : { approverId: authApproverId }),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.applied) {
        await refreshAfterSessionChange(data);
        return;
      }
      const { requestId, expiresInMinutes } = data;
      setPendingChangeRequestId(requestId);
      setPendingChangeExpiresInMinutes(expiresInMinutes);
      const approverName = approvers.find((a) => a.id === authApproverId)?.name || 'el aprobador elegido';
      toast.success(`Código enviado a ${approverName} — pídele que te lo dicte.`);
    } catch (err: any) {
      toast.error(`Error al solicitar la autorización: ${err.message}`);
    } finally {
      setAuthorizingSessions(false);
    }
  };

  // Verifica el código que el aprobador dictó — solo acá se aplica el
  // cambio real (ver POST /api/session-changes/verify en el backend).
  const handleVerifySessionChange = async () => {
    if (!pendingChangeRequestId || !verifyCodeInput.trim()) {
      toast.error('Ingresa el código que te dictaron.');
      return;
    }
    setVerifyingCode(true);
    try {
      const res = await apiFetch('/api/session-changes/verify', {
        method: 'POST',
        body: JSON.stringify({ requestId: pendingChangeRequestId, code: verifyCodeInput.trim() }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const { result } = await res.json();
      await refreshAfterSessionChange(result);
    } catch (err: any) {
      toast.error(`Error al verificar el código: ${err.message}`);
    } finally {
      setVerifyingCode(false);
    }
  };

  const startEditPatient = () => {
    if (!selectedPatientFull) return;
    setNewPatientFirstName(selectedPatientFull.firstName);
    setNewPatientLastName(selectedPatientFull.lastName);
    setNewPatientDocument(selectedPatientFull.documentId);
    setNewPatientEmail(selectedPatientFull.email || '');
    // Precargados con el dato REAL del paciente cuando está disponible (ver
    // PatientOption) — antes siempre quedaban en blanco/'CC' por defecto,
    // así que guardar sin tocarlos de verdad SOBRESCRIBÍA en silencio el
    // teléfono/tipo de documento/fecha de nacimiento reales del paciente.
    setNewPatientPhone(selectedPatientFull.phone || '');
    setNewPatientDocumentType(selectedPatientFull.documentType || 'CC');
    setNewPatientBirthDate(selectedPatientFull.birthDate ? selectedPatientFull.birthDate.slice(0, 10) : '');
    setIsEditingPatient(true);
  };

  const updatePatient = async () => {
    if (!newPatientFirstName.trim() || !newPatientLastName.trim() || !newPatientDocument) {
      toast.error('Por favor, ingresa el nombre, apellido y documento del paciente.');
      return;
    }
    if (newPatientDocument.length > 10) {
      toast.error('El documento no puede tener más de 10 dígitos.');
      return;
    }
    if (newPatientPhone && newPatientPhone.length !== 10) {
      toast.error('El teléfono debe tener exactamente 10 dígitos (o déjalo vacío para no cambiarlo).');
      return;
    }

    setIsProvisioning(true);
    try {
      const token  = localStorage.getItem('mind_token');
      const apiUrl = getApiBase();
      const res = await fetch(`${apiUrl}/api/patients/${form.patientId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firstName: newPatientFirstName.trim(),
          lastName: newPatientLastName.trim(),
          email: newPatientEmail,
          phone: newPatientPhone || undefined,
          documentId: newPatientDocument,
          documentType: newPatientDocumentType,
          birthDate: newPatientBirthDate || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const updatedPatient = await res.json();

      setSelectedPatientFull({
        ...selectedPatientFull,
        id: updatedPatient.id,
        firstName: updatedPatient.firstName,
        lastName: updatedPatient.lastName,
        documentId: updatedPatient.documentId,
        email: updatedPatient.email,
        phone: updatedPatient.phone,
        documentType: updatedPatient.documentType,
        birthDate: updatedPatient.birthDate,
      });

      setIsEditingPatient(false);
      toast.success('Paciente actualizado exitosamente.');
    } catch (err: any) {
      toast.error(`Error al actualizar paciente: ${err.message}`);
    } finally {
      setIsProvisioning(false);
    }
  };

  const handleChangePsychologistComplete = async (result: ChangePsychologistResult) => {
    const patientId = form.patientId;
    setHistoryDrawer(null);
    setSelectedPatientFull((current) => current?.id === patientId ? {
      ...current,
      psychologistId: result.psychologistId,
      psychologist: { id: result.psychologistId, name: result.psychologistName },
    } : current);
    setForm((current) => ({ ...current, userId: result.psychologistId }));
    setSlotDates(['']);
    setAvailabilityRefreshKey((current) => current + 1);
    try {
      const response = await apiFetch(`/api/patients/${patientId}/schedule-summary`);
      if (response.ok) setScheduleSummary(await response.json() as ScheduleSummary);
    } catch {
      toast.error('El tratante cambió, pero no se pudo actualizar la ficha. Vuelve a abrir el modal para verla al día.');
    }
    onSuccess?.();
    toast.success(`Tratante actualizado a ${result.psychologistName}.`);
  };

  const handleNewAgreementComplete = (result: NewAgreementResult, selection: NewAgreementSelection) => {
    setHistoryDrawer(null);
    setSelectedPatientFull((current) => current ? {
      ...current,
      id: result.newPatientId,
      recordNumber: result.recordNumber,
      companyId: selection.companyId,
      corporateClient: result.companyName,
      psychologistId: selection.proposedPsychologistId || null,
      psychologist: selection.proposedPsychologistId ? { id: selection.proposedPsychologistId, name: result.psychologistName || 'Profesional propuesto' } : null,
    } : current);
    setScheduleSummary(null);
    setIsConsultaExterna(selection.isConsultaExterna);
    setForm((current) => ({
      ...current,
      patientId: result.newPatientId,
      corporateClient: result.companyName,
      agreementType: selection.agreementType,
      userId: selection.proposedPsychologistId,
    }));
    setAuthCompanyId(selection.companyId);
    setSlotDates(['']);
    lastAutoSizedPatientId.current = null;
    setAvailabilityRefreshKey((current) => current + 1);
    onSuccess?.();
    toast.success(`Historia ${result.recordNumber} creada en ${result.companyName}.`);
  };

  // ── Hint del footer: qué sesión(es) se está(n) registrando ─────────────
  const footerHint = (() => {
    if (!form.patientId) return 'Sin paciente seleccionado.';
    if (isEditingAppointment) return 'Se reprogramará la cita seleccionada.';
    const start = (scheduleSummary?.appointments?.length || 0) + 1;
    const end = start + slotDates.length - 1;
    if (slotDates.length <= 1) return `Se registrará como sesión #${start}.`;
    return `Se registrará como sesiones #${start} a #${end}.`;
  })();

  // ── Render ──────────────────────────────────────────────────────────────
  if (!isOpen) return null;

  // Derivados del cupo del lote activo — se usan tanto en la celda "Convenio
  // actual" como en la fila "Sesiones" / "Agregar sesión" de abajo.
  const activeAuth = scheduleSummary?.activeAuthorization ?? null;
  const isUnlimitedAuth = activeAuth?.sessionsAuthorized === null;
  const remainingSessions = scheduleSummary?.sessionsRemaining ?? 0;
  // Autorizar sesiones (agregar cupo o dejarlo "libre") es una decisión
  // administrativa/financiera, no clínica — un psicólogo puede AGENDAR si
  // ya hay cupo disponible, pero no crear cupo nuevo, SALVO que su tenant
  // active allowSpecialistSelfAuthorizeSessions para sus propios pacientes
  // (ver canCallerSelfAuthorizeSessions, ya calculado por el backend en
  // schedule-summary). El backend ya lo rechaza (403) igual, esto es solo
  // para no mostrar un formulario que de todos modos va a fallar. Mismo
  // patrón de lectura de rol que el resto del EHR (localStorage.mind_user),
  // sin necesidad de pasar un prop nuevo desde los dos portales que usan
  // este modal.
  const storedUser = getStoredUser();
  const isSelfAuthorize = !!scheduleSummary?.canCallerSelfAuthorizeSessions;
  const canAuthorizeSessions = storedUser?.role === 'CEO' || storedUser?.role === 'DIRECTIVO' || isSelfAuthorize;
  // "Consulta Externa" es administrativo, no clínico — mismo criterio que
  // canManageStatus en PacientesPanel.tsx. El backend (updatePatient) rechaza
  // igual el cambio si lo intenta un ESPECIALISTA_B2B; esto es solo para que
  // el checkbox se vea deshabilitado en vez de fallar en silencio.
  const canEditConsultaExterna = storedUser?.role === 'CEO' || storedUser?.role === 'DIRECTIVO' || storedUser?.role === 'OPERATIVO';
  const canManageHistory = (storedUser?.role === 'CEO' || storedUser?.role === 'DIRECTIVO')
    && !!form.patientId && !!selectedPatientFull && !isCreatingPatient && !isEditingPatient && !isEditingAppointment;
  const historyCompanyName = companies.find((company) => company.id === selectedPatientFull?.companyId)?.name
    || selectedPatientFull?.corporateClient || scheduleSummary?.patient.companyName || 'Sin convenio';
  const historyPsychologistId = selectedPatientFull?.psychologistId || selectedPatientFull?.psychologist?.id || null;
  const historyPsychologistName = selectedPatientFull?.psychologist?.name
    || specialists.find((specialist) => specialist.id === historyPsychologistId)?.name || 'Sin tratante asignado';
  const historyPatientName = `${selectedPatientFull?.firstName || scheduleSummary?.patient.firstName || ''} ${selectedPatientFull?.lastName || scheduleSummary?.patient.lastName || ''}`.trim();
  const historyChannel = (scheduleSummary?.patient.isConsultaExterna ?? isConsultaExterna) ? 'Consulta externa' : 'Convenio';

  const handleToggleConsultaExterna = async (checked: boolean) => {
    if (!form.patientId) return;
    const previous = isConsultaExterna;
    setIsConsultaExterna(checked);
    setSavingConsultaExterna(true);
    try {
      const res = await apiFetch(`/api/patients/${form.patientId}`, {
        method: 'PUT',
        body: JSON.stringify({ isConsultaExterna: checked }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setIsConsultaExterna(previous);
        toast.error(errBody?.error || 'No se pudo actualizar "Consulta Externa".');
      }
    } catch {
      setIsConsultaExterna(previous);
      toast.error('Error de red al actualizar "Consulta Externa".');
    } finally {
      setSavingConsultaExterna(false);
    }
  };
  // Un especialista solo puede agendarse a sí mismo — nunca debe ver (ni
  // poder elegir) a los demás psicólogos del tenant en este selector, aunque
  // el endpoint /api/users/specialists sí le traiga la lista completa (la
  // usa igual el buscador de disponibilidad de otros roles).
  const visibleSpecialists = storedUser?.role === 'ESPECIALISTA_B2B'
    ? specialists.filter((s) => s.id === storedUser.id)
    : specialists;
  // Mismo estilo "bloqueado" que la caja de Convenio / Cliente Corporativo —
  // misma altura, color y fuente en cualquier caja de solo lectura.
  const lockedBoxClass = 'flex min-h-[42px] w-full items-center border border-slate-200 rounded-lg p-2.5 text-sm bg-slate-100 text-slate-600';

  return (
    <div
      className="fixed inset-0 bg-slate-950/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isSubmitting) resetAndClose(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-[1500px] shadow-2xl flex flex-col max-h-[96vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-2.5 border-b border-slate-200 bg-white flex justify-between items-center rounded-t-2xl shrink-0">
          <h3 className="text-2xl font-bold text-slate-900">
            {isEditingAppointment ? 'Editar cita' : 'Agendar'}
          </h3>
          <button
            onClick={resetAndClose}
            className="text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        {isLoadingData ? (
          <div className="p-10 text-center text-slate-400 text-sm animate-pulse">
            Cargando especialistas y pacientes del tenant…
          </div>
        ) : (
          <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(350px,35%)_minmax(0,1fr)] overflow-y-auto lg:overflow-hidden flex-1">
            <form id="delegated-appointment-form" onSubmit={handleSubmit} className="p-6 space-y-4 text-left lg:overflow-y-auto">
              {/* ── Selector de Paciente ──────────────────────────────────── */}
              <div>
                <div className="flex justify-between items-end mb-1">
                  <label htmlFor="delegated-patient-search" className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    Paciente
                  </label>
                  <div className="flex items-center gap-3">
                    {form.patientId && !isCreatingPatient && !isEditingPatient && (
                      <button type="button" onClick={startEditPatient} className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline">
                        <Pencil className="w-3 h-3" /> Corregir datos de este paciente
                      </button>
                    )}
                    {!isCreatingPatient && !isEditingAppointment && (
                      <button
                        type="button"
                        onClick={() => setIsCreatingPatient(true)}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                      >
                        <Plus className="w-3 h-3" /> Crear nuevo paciente
                      </button>
                    )}
                  </div>
                </div>

                {isCreatingPatient ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Nombre *</label>
                        <input type="text" value={newPatientFirstName} onChange={e => setNewPatientFirstName(onlyLetters(e.target.value))} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. Juan" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Apellido *</label>
                        <input type="text" value={newPatientLastName} onChange={e => setNewPatientLastName(onlyLetters(e.target.value))} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. Pérez" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Documento *</label>
                        <div className="flex gap-2">
                          <select value={newPatientDocumentType} onChange={e => setNewPatientDocumentType(e.target.value)} className="w-20 shrink-0 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                            {DOCUMENT_TYPE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                          <input type="text" inputMode="numeric" maxLength={10} value={newPatientDocument} onChange={e => setNewPatientDocument(onlyDigits(e.target.value, 10))} className="w-full min-w-0 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. 1234567890" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Fecha de nacimiento</label>
                        <input type="date" value={newPatientBirthDate} onChange={e => setNewPatientBirthDate(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Correo Electrónico</label>
                        <input type="email" value={newPatientEmail} onChange={e => setNewPatientEmail(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="juan@correo.com" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Teléfono *</label>
                        <input type="text" inputMode="numeric" maxLength={10} value={newPatientPhone} onChange={e => setNewPatientPhone(onlyDigits(e.target.value, 10))} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="3001234567" />
                      </div>
                    </div>

                    <p className="pt-1 text-[11px] font-bold uppercase tracking-wider text-toast-600">Contacto de emergencia</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Nombres *</label>
                        <input type="text" value={emergencyNombres} onChange={e => setEmergencyNombres(onlyLetters(e.target.value))} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. María" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Apellidos *</label>
                        <input type="text" value={emergencyApellidos} onChange={e => setEmergencyApellidos(onlyLetters(e.target.value))} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. Gómez Ruiz" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Teléfono *</label>
                        <input type="text" inputMode="numeric" maxLength={10} value={emergencyTelefono} onChange={e => setEmergencyTelefono(onlyDigits(e.target.value, 10))} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="3001234567" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Parentesco *</label>
                        <div className="relative">
                          <select value={emergencyParentesco} onChange={e => setEmergencyParentesco(e.target.value)} className="w-full appearance-none border border-slate-200 rounded-lg p-2.5 pr-9 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                            <option value="">— Seleccione parentesco —</option>
                            {PARENTESCO_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-1 mt-2">
                      <button type="button" onClick={() => setIsCreatingPatient(false)} className="px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 rounded-md transition-colors">
                        Cancelar
                      </button>
                      <button type="button" onClick={provisionPatient} disabled={isProvisioning} className="px-3 py-1.5 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors disabled:opacity-50">
                        {isProvisioning ? 'Guardando...' : 'Guardar Paciente'}
                      </button>
                    </div>
                  </div>
                ) : isEditingPatient ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Nombre *</label>
                        <input type="text" value={newPatientFirstName} onChange={e => setNewPatientFirstName(onlyLetters(e.target.value))} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. Juan" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Apellido *</label>
                        <input type="text" value={newPatientLastName} onChange={e => setNewPatientLastName(onlyLetters(e.target.value))} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. Pérez" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Documento *</label>
                        <div className="flex gap-2">
                          <select value={newPatientDocumentType} onChange={e => setNewPatientDocumentType(e.target.value)} className="w-20 shrink-0 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                            {DOCUMENT_TYPE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                          <input type="text" inputMode="numeric" maxLength={10} value={newPatientDocument} onChange={e => setNewPatientDocument(onlyDigits(e.target.value, 10))} className="w-full min-w-0 border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. 1234567890" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Fecha de nacimiento</label>
                        <input type="date" value={newPatientBirthDate} onChange={e => setNewPatientBirthDate(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Correo Electrónico</label>
                        <input type="email" value={newPatientEmail} onChange={e => setNewPatientEmail(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="juan@correo.com" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Teléfono</label>
                        <input type="text" inputMode="numeric" maxLength={10} value={newPatientPhone} onChange={e => setNewPatientPhone(onlyDigits(e.target.value, 10))} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="3001234567" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-1 mt-2">
                      <button type="button" onClick={() => setIsEditingPatient(false)} className="px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 rounded-md transition-colors">
                        Cancelar
                      </button>
                      <button type="button" onClick={updatePatient} disabled={isProvisioning} className="px-3 py-1.5 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50">
                        {isProvisioning ? 'Guardando...' : 'Guardar Cambios'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <input
                        id="delegated-patient-search"
                        type="text"
                        required={!form.patientId}
                        value={form.patientId ? `${selectedPatientFull?.firstName || ''} ${selectedPatientFull?.lastName || ''} — ${selectedPatientFull?.documentType || 'CC'} ${selectedPatientFull?.documentId || ''}${selectedPatientFull?.recordNumber ? ` · ${selectedPatientFull.recordNumber}` : ''}` : patientSearchTerm}
                        onChange={(e) => {
                          if (form.patientId) setForm(prev => ({ ...prev, patientId: '', corporateClient: '', agreementType: '' }));
                          setSelectedPatientFull(null);
                          setPatientSearchTerm(e.target.value);
                          setShowPatientResults(true);
                        }}
                        onFocus={() => setShowPatientResults(true)}
                        onBlur={() => setTimeout(() => setShowPatientResults(false), 150)}
                        disabled={isEditingAppointment}
                        placeholder="Buscar paciente por nombre o documento…"
                        className={`w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white disabled:opacity-50 disabled:bg-slate-100 ${
                          form.patientId && !isCreatingPatient && onViewPatientProfile ? 'pr-9' : ''
                        }`}
                      />
                      {form.patientId && !isCreatingPatient && onViewPatientProfile && (
                        <button
                          type="button"
                          onClick={() => {
                            const patientId = form.patientId;
                            resetAndClose();
                            onViewPatientProfile(patientId);
                          }}
                          title="Ver perfil del paciente"
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-indigo-500 transition-colors hover:bg-indigo-50 hover:text-indigo-700 cursor-pointer"
                        >
                          <UserRound className="h-4 w-4" />
                        </button>
                      )}
                      {showPatientResults && !isEditingAppointment && (
                        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                          {patientSearchLoading ? (
                            <div className="p-3 text-xs text-slate-400">Buscando…</div>
                          ) : patientSearchResults.length === 0 ? (
                            <div className="p-3 text-xs text-slate-400">
                              {patientSearchTerm.trim() ? 'Sin resultados para esa búsqueda.' : 'Escribe un nombre o documento para buscar.'}
                            </div>
                          ) : (
                            <>
                              {patientSearchResults.map((p) => (
                                <button
                                  type="button"
                                  key={p.id}
                                  // onMouseDown (no onClick) — dispara antes del onBlur del input,
                                  // así el clic registra aunque el blur cierre el dropdown.
                                  onMouseDown={() => {
                                    setSelectedPatientFull(p);
                                    // Precarga el tratante registrado del paciente — evita que el
                                    // administrativo tenga que recordarlo/buscarlo manualmente cada
                                    // vez. Solo si sigue activo en el tenant (está en `specialists`)
                                    // y el usuario logueado no es un ESPECIALISTA_B2B (ese select
                                    // queda bloqueado siempre a sí mismo).
                                    const patientPsychologistId = p.psychologistId || p.psychologist?.id || '';
                                    const canPreselect = !!patientPsychologistId
                                      && storedUser?.role !== 'ESPECIALISTA_B2B'
                                      && specialists.some((s) => s.id === patientPsychologistId);
                                    setForm(prev => ({
                                      ...prev,
                                      patientId: p.id,
                                      corporateClient: '',
                                      agreementType: '',
                                      userId: canPreselect ? patientPsychologistId : prev.userId,
                                    }));
                                    setPatientSearchTerm('');
                                    setShowPatientResults(false);
                                  }}
                                  className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-indigo-50"
                                >
                                  <span>{p.firstName} {p.lastName} — {p.documentType || 'CC'} {p.documentId}</span>
                                  {(p.recordNumber || p.corporateClient) && (
                                    <span className="block text-[11px] text-slate-400 mt-0.5">
                                      {p.recordNumber || ''}{p.recordNumber && p.corporateClient ? ' · ' : ''}{p.corporateClient || ''}
                                    </span>
                                  )}
                                </button>
                              ))}
                              {patientSearchResults.length >= 20 && (
                                <div className="border-t border-slate-100 p-2 text-center text-[10px] text-slate-400">
                                  Mostrando los primeros 20 — sigue escribiendo para acotar la búsqueda.
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* ── Especialidad + Especialista ────────────────────────── */}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                    Especialidad
                  </label>
                  <div className="relative">
                    <select
                      required
                      value={form.specialtyId}
                      onChange={(e) => setForm({ ...form, specialtyId: e.target.value })}
                      className="w-full appearance-none border border-slate-200 rounded-lg p-2.5 pr-9 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    >
                      <option value="" disabled>Seleccione especialidad</option>
                      {specialties.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor="appointment-specialist" className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Especialista (Psicólogo)</label>
                    {canManageHistory && <button type="button" onClick={() => { setShowAuthorizationDrawer(false); closeSlotEdit(); setHistoryDrawer('change'); }} className="text-xs font-semibold text-indigo-700 hover:underline">Cambiar de tratante</button>}
                  </div>
                  <div className="relative">
                    <select
                      id="appointment-specialist"
                      required
                      value={form.userId}
                      onChange={(e) => setForm({ ...form, userId: e.target.value })}
                      disabled={storedUser?.role === 'ESPECIALISTA_B2B'}
                      title={storedUser?.role === 'ESPECIALISTA_B2B' ? 'Solo puedes agendarte a ti mismo.' : undefined}
                      className="w-full appearance-none border border-slate-200 rounded-lg p-2.5 pr-9 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-600"
                    >
                      <option value="" disabled>Seleccione un especialista</option>
                      {visibleSpecialists.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.specialty ? ` – ${s.specialty}` : ''}
                          {s.level ? ` (Nivel ${s.level})` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                  {canManageHistory && <p className="mt-1 text-[10.5px] text-slate-500">Tratante de esta historia: <b>{historyPsychologistName}</b></p>}
                </div>
              </div>

              {/* ── Convenio y tipo de convenio ── */}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="min-w-0 text-[11px] font-semibold uppercase tracking-wider text-slate-600">Convenio para agendar</label>
                    {canManageHistory && <button type="button" onClick={() => { setShowAuthorizationDrawer(false); closeSlotEdit(); setHistoryDrawer('agreement'); }} className="shrink-0 text-xs font-semibold text-indigo-700 hover:underline">+ Nuevo convenio</button>}
                  </div>
                  {form.patientId && !isCreatingPatient ? (
                    <>
                      <div className={lockedBoxClass}>
                        {form.corporateClient || '—'}
                      </div>
                      <p className="mt-1 text-[10.5px] text-slate-500">Convenio de esta historia: <b>{historyCompanyName}</b></p>
                    </>
                  ) : (
                    <div className="relative">
                      <select
                        required
                        value={form.corporateClient}
                        onChange={(e) => setForm({ ...form, corporateClient: e.target.value, locationId: '', agreementType: '' })}
                        className="min-h-[42px] w-full appearance-none border border-slate-200 rounded-lg p-2.5 pr-9 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                      >
                        <option value="" disabled>Seleccione un convenio</option>
                        <option value="Particular">Particular (sin convenio)</option>
                        {companies.filter((c) => c.status === 'activo' && c.clientType === 'EMPRESA').length > 0 && (
                          <optgroup label="Empresas">
                            {companies.filter((c) => c.status === 'activo' && c.clientType === 'EMPRESA').map((c) => (
                              <option key={c.id} value={c.name}>{c.name}</option>
                            ))}
                          </optgroup>
                        )}
                        {companies.filter((c) => c.status === 'activo' && c.clientType === 'PARTICULAR').length > 0 && (
                          <optgroup label="Particulares con convenio/paquete">
                            {companies.filter((c) => c.status === 'activo' && c.clientType === 'PARTICULAR').map((c) => (
                              <option key={c.id} value={c.name}>{c.name}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    </div>
                  )}
                </div>
              {/* ── Tipo de convenio — catálogo propio del convenio elegido arriba
                  (ver AdminPortal → Editar convenio/cliente → "Tipos de convenio").
                  Se copia como texto plano a la cita al agendar/reprogramar, igual
                  que Company.agreementType, para que quede fijo en el historial
                  aunque el catálogo cambie después. Opcional: no todos los
                  convenios distinguen tipos, así que el bloque entero se oculta
                  si el convenio elegido no tiene ninguno registrado. ── */}
              {form.corporateClient ? (
                <div>
                  <div className="flex justify-between items-end mb-1">
                    <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                      Tipo de convenio
                      {scheduleSummary?.patient.companyShortCode && (
                        <span
                          className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-indigo-600 normal-case"
                          title="Indicativo con el que este paciente venía registrado (HC)"
                        >
                          {scheduleSummary.patient.companyShortCode}
                        </span>
                      )}
                    </label>
                    {!isCreatingAgreementType && (
                      <button
                        type="button"
                        onClick={() => setIsCreatingAgreementType(true)}
                        aria-label="Agregar tipo de convenio"
                        title="Agregar tipo de convenio"
                        className="inline-flex items-center text-indigo-600 hover:text-indigo-800 transition-colors"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {isCreatingAgreementType ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        autoFocus
                        value={newAgreementTypeName}
                        onChange={(e) => setNewAgreementTypeName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateAgreementType(); } }}
                        placeholder={`Nuevo tipo para ${form.corporateClient}...`}
                        className="min-h-[42px] flex-1 border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                      />
                      <button
                        type="button"
                        onClick={handleCreateAgreementType}
                        disabled={savingAgreementType || !newAgreementTypeName.trim()}
                        className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                      >
                        {savingAgreementType ? '...' : 'Guardar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setIsCreatingAgreementType(false); setNewAgreementTypeName(''); }}
                        disabled={savingAgreementType}
                        className="shrink-0 flex h-[42px] w-[42px] items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : agreementTypes.length > 0 ? (
                    <div className="relative">
                      <select
                        value={form.agreementType}
                        onChange={(e) => setForm({ ...form, agreementType: e.target.value })}
                        className="min-h-[42px] w-full appearance-none border border-slate-200 rounded-lg p-2.5 pr-9 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                      >
                        <option value="">Sin especificar</option>
                        {agreementTypes.map((t) => (
                          <option key={t.id} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    </div>
                  ) : (
                    <div className={lockedBoxClass}>No aplica</div>
                  )}
                </div>
              ) : (
                <div className="min-h-[42px]" />
              )}
              </div>

              {/* ── Consulta Externa — convenio/relación del paciente NO cambian;
                  solo marca que ESTE episodio llegó por Consulta Externa en vez
                  del canal corporativo habitual, para mantener el costo que se
                  le venía manejando y agregar "(CE)" a la historia clínica.
                  Administrativo, no clínico — ver canEditConsultaExterna. ── */}
              {form.patientId && !isCreatingPatient && (
                <label
                  className={`flex items-center gap-2.5 py-1 text-xs text-slate-900 ${canEditConsultaExterna ? 'cursor-pointer' : 'cursor-not-allowed opacity-75'}`}
                >
                  <input
                    type="checkbox"
                    checked={isConsultaExterna}
                    disabled={!canEditConsultaExterna || savingConsultaExterna}
                    onChange={(e) => handleToggleConsultaExterna(e.target.checked)}
                    className="h-4 w-4 shrink-0 rounded border-slate-300 accent-indigo-700 focus:ring-indigo-500"
                  />
                  <span>Consulta externa{savingConsultaExterna ? ' (guardando…)' : ''}</span>
                  <Info className="h-4 w-4 text-slate-500" aria-label="El convenio y la relación del paciente no cambian" />
                </label>
              )}

              {!isCreatingPatient && form.patientId && !isEditingAppointment && !loadingSummary && scheduleSummary && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <div className="text-xs text-slate-500">
                      <span className="block">Sesiones autorizadas</span>
                      <b className={!hasUsableBatch ? 'text-amber-700' : 'text-slate-900'}>
                        {!activeAuth ? 'Sin autorización vigente' : isUnlimitedAuth ? 'Sesiones libres' : `${remainingSessions} disponibles`}
                      </b>
                    </div>
                    {canAuthorizeSessions && (
                      <button type="button" onClick={() => { setAuthCompanyId((current) => current || companies.find((company) => company.name === form.corporateClient)?.id || ''); setShowAuthorizationDrawer(true); }} className="shrink-0 rounded-lg border border-indigo-400 bg-white px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50">
                        Gestionar autorización
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-slate-900">Citas a programar</label>
                    <div className="flex items-center rounded-lg border border-slate-200">
                      <button type="button" aria-label="Reducir citas" disabled={slotDates.length <= 1} onClick={() => setSlotDates((prev) => resizeSlotDates(prev, prev.length - 1))} className="px-3 py-1.5 font-bold text-indigo-700 disabled:text-slate-300">−</button>
                      <span className="min-w-8 text-center text-xs font-semibold">{slotDates.length}</span>
                      <button type="button" aria-label="Aumentar citas" disabled={hasUsableBatch && !isUnlimitedAuth && slotDates.length >= remainingSessions} onClick={() => setSlotDates((prev) => resizeSlotDates(prev, prev.length + 1))} className="px-3 py-1.5 font-bold text-indigo-700 disabled:text-slate-300">+</button>
                    </div>
                  </div>
                </div>
              )}
              {isEditingAppointment && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Fecha y hora</label>
                  {isLockedForReschedule ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm font-semibold text-amber-700">{lockedRescheduleReason}</div>
                  ) : (
                    <input type="datetime-local" required value={form.dateTime || ''} onChange={(e) => setForm((prev) => ({ ...prev, dateTime: e.target.value }))} className="w-full rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                  )}
                </div>
              )}
              {/* ── Selector de Modalidad ─────────────────────────────────── */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                  Modalidad de Atención
                </label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, modality: 'Virtual', location: '', locationId: '' })
                    }
                    className={`p-2.5 rounded-lg text-sm font-medium border flex items-center justify-center gap-2 transition-all ${
                      form.modality === 'Virtual'
                        ? 'bg-indigo-50 border-indigo-600 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${form.modality === 'Virtual' ? 'border-indigo-700' : 'border-slate-400'}`}>{form.modality === 'Virtual' && <span className="h-2 w-2 rounded-full bg-indigo-700" />}</span><Video className="w-4 h-4" /> Telepsicología
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, modality: 'Presencial' })
                    }
                    className={`p-2.5 rounded-lg text-sm font-medium border flex items-center justify-center gap-2 transition-all ${
                      form.modality === 'Presencial'
                        ? 'bg-indigo-50 border-indigo-600 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${form.modality === 'Presencial' ? 'border-indigo-700' : 'border-slate-400'}`}>{form.modality === 'Presencial' && <span className="h-2 w-2 rounded-full bg-indigo-700" />}</span><Building2 className="w-4 h-4" /> Presencial
                  </button>
                </div>
              </div>

              {/* ── Campo condicional de modalidad ────────────────────────── */}
              {form.modality === 'Virtual' ? (
                <div className="text-[11px] text-slate-500">
                  El enlace se generará al confirmar la cita.
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] font-semibold text-emerald-700 mb-1">
                    Ubicación de atención
                  </label>
                  {(() => {
                    const selectedCompany = companies.find((c) => c.name === form.corporateClient);
                    const locations = selectedCompany?.locations || [];
                    if (locations.length === 0) {
                      return (
                        <input
                          type="text"
                          value={form.location}
                          onChange={(e) =>
                            setForm({ ...form, location: e.target.value })
                          }
                          className="w-full border border-emerald-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 bg-emerald-50/30 outline-none"
                          placeholder="Sede Central — Consultorio 4B"
                        />
                      );
                    }
                    return (
                      <div className="relative">
                      <select
                        value={form.locationId}
                        onChange={(e) => setForm({ ...form, locationId: e.target.value })}
                        className="w-full appearance-none border border-emerald-200 rounded-lg p-2.5 pr-9 text-sm focus:ring-2 focus:ring-emerald-500 bg-emerald-50/30 outline-none"
                      >
                        <option value="">— Seleccione una sede —</option>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}{loc.address ? ` — ${loc.address}` : ''}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500" />
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Notas opcionales ──────────────────────────────────────── */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                  Notas (Opcional)
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                  placeholder="Observaciones para el especialista…"
                />
              </div>

            </form>

            {/* ── Disponibilidad del psicólogo + Ficha del paciente ─────────── */}
            <div className="min-w-0 border-l border-slate-200 bg-white px-5 py-4 lg:overflow-y-auto">
              <div className="mb-3 flex gap-2 border-b border-slate-200">
                <button type="button" onClick={() => setAvailabilityTab('availability')} className={`px-3 pb-2 text-sm font-semibold ${availabilityTab === 'availability' ? 'border-b-2 border-indigo-700 text-indigo-700' : 'text-slate-500'}`}>Disponibilidad</button>
                <button type="button" onClick={() => setAvailabilityTab('history')} className={`px-3 pb-2 text-sm font-semibold ${availabilityTab === 'history' ? 'border-b-2 border-indigo-700 text-indigo-700' : 'text-slate-500'}`}>Historial del paciente</button>
              </div>
              {availabilityTab === 'availability' && (
                <PsychologistAvailabilityGrid
                  psychologistId={form.userId}
                  psychologistName={specialists.find((s) => s.id === form.userId)?.name}
                  sessionNumberStart={(scheduleSummary?.appointments?.length || 0) + 1}
                  initialWeekDate={isEditingAppointment && form.dateTime ? new Date(form.dateTime) : undefined}
                  excludeAppointmentId={isEditingAppointment && !isLockedForReschedule ? initialData?.id : undefined}
                  onSlotPick={isEditingAppointment
                    ? (isLockedForReschedule ? () => {} : (dt) => setForm((prev) => ({ ...prev, dateTime: dt })))
                    : fillSlotFromAvailability}
                  pendingDateTimes={isEditingAppointment ? (isLockedForReschedule ? [] : [form.dateTime]) : slotDates}
                  onSlotClear={isEditingAppointment
                    ? (isLockedForReschedule ? () => {} : () => setForm((prev) => ({ ...prev, dateTime: '' })))
                    : clearSlotFromAvailability}
                  onSlotEdit={isEditingAppointment ? undefined : startSlotEdit}
                  editingIndex={editingSlotIndex}
                  previewDateTime={editingSlotDateTime}
                  focusDateTime={editingSlotIndex !== null ? editingSlotDateTime : undefined}
                  activeDateTime={editingSlotIndex !== null ? editingSlotDateTime : isEditingAppointment ? form.dateTime : activeSlotIndex !== null ? slotDates[activeSlotIndex] : undefined}
                  busyDateTimes={psychologistBusyTimes}
                  refreshKey={availabilityRefreshKey}
                />
              )}

              {availabilityTab === 'availability' ? null : !form.userId && (!form.patientId || isCreatingPatient) ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
                  <CalendarClock className="mb-3 h-8 w-8 text-slate-300" />
                  <p className="text-xs">Seleccione un especialista y un paciente para ver disponibilidad, historial de agendamientos y sesiones autorizadas.</p>
                </div>
              ) : !form.patientId || isCreatingPatient ? (
                <p className="text-center text-[11px] text-slate-400">Seleccione un paciente para ver su historial de agendamientos y sus sesiones autorizadas.</p>
              ) : loadingSummary || !scheduleSummary ? (
                <div className="flex h-full items-center justify-center text-xs text-slate-400 animate-pulse">
                  Cargando ficha del paciente…
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ficha del paciente</p>
                    <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                      <User className="h-4 w-4 text-slate-400" /> {scheduleSummary.patient.firstName} {scheduleSummary.patient.lastName}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {scheduleSummary.patient.documentType || 'CC'} {scheduleSummary.patient.documentId}{scheduleSummary.patient.phone ? ` · ${scheduleSummary.patient.phone}` : ''}
                    </p>
                    {scheduleSummary.patient.companyName && (
                      <span className="mt-1.5 inline-block rounded-md bg-toast-100 px-2 py-0.5 text-[10px] font-bold text-charcoal-900">
                        {scheduleSummary.patient.companyName}
                      </span>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sesiones agendadas por convenio</p>
                    {!scheduleSummary.activeAuthorization ? (
                      <p className="mt-1 text-[11px] font-semibold text-amber-600">Sin autorización vigente — autoriza sesiones para poder agendar.</p>
                    ) : scheduleSummary.activeAuthorization.sessionsAuthorized === null ? (
                      <>
                        <span className="mt-1 inline-block rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Sesiones libres</span>
                        <p className="mt-1 text-[11px] text-slate-500">Sin tope contractual con {scheduleSummary.activeAuthorization.companyName}. {scheduleSummary.sessionsTaken} sesiones tomadas.</p>
                      </>
                    ) : (
                      <>
                        <p className="mt-0.5 text-xl font-black text-slate-900">
                          {scheduleSummary.sessionsTaken}{' '}
                          <span className="text-xs font-medium text-slate-400">de {scheduleSummary.activeAuthorization.sessionsAuthorized}</span>
                        </p>
                        <p className="text-[10.5px] text-slate-400">Convenio: {scheduleSummary.activeAuthorization.companyName}</p>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.min(100, (scheduleSummary.sessionsTaken / scheduleSummary.activeAuthorization.sessionsAuthorized) * 100)}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>

                  <div>
                    {scheduleSummary.appointments.length === 0 ? (
                      <>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Agendamientos previos</p>
                        <p className="mt-2 text-[11px] text-slate-400">Sin agendamientos previos.</p>
                      </>
                    ) : (
                      Object.entries(
                        scheduleSummary.appointments.reduce((acc, a) => {
                          const key = a.companyName || 'Sin convenio asociado';
                          if (!acc[key]) acc[key] = [];
                          acc[key].push(a);
                          return acc;
                        }, {} as Record<string, ScheduleSummaryAppointment[]>)
                      ).map(([companyName, appts], groupIdx) => (
                        <div key={companyName} className={groupIdx > 0 ? 'mt-4' : ''}>
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Agendamientos previos — {companyName}</p>
                            <span className="text-[10px] text-slate-400">{appts.length} {appts.length === 1 ? 'registro' : 'registros'}</span>
                          </div>
                          <ul className="mt-2 space-y-2">
                            {appts.map((a) => {
                              const { dateLabel, timeLabel } = formatDateTime(a.date);
                              return (
                                <li key={a.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-800">{dateLabel}, {timeLabel}</span>
                                    <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_BADGE_STYLES[a.status] || 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                                      {a.statusLabel}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[10.5px] text-slate-500">
                                    Sesión #{a.sessionNumber}{a.specialtyName ? ` · ${a.specialtyName}` : ''}{a.psychologistName ? ` · ${a.psychologistName}` : ''}
                                  </p>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white px-6 py-3">
          <div className="min-w-0">
            <p className="text-base font-bold text-slate-900">
              {isEditingAppointment ? 'Cita lista para guardar' : !hasUsableBatch && form.patientId ? 'Autoriza sesiones para continuar' : editingSlotIndex !== null ? `${slotDates.filter(Boolean).length} citas seleccionadas · Edición en curso` : `${slotDates.filter(Boolean).length} citas listas para agendar`}
            </p>
            <p className="text-xs text-slate-500">{form.modality === 'Virtual' ? 'Telepsicología' : 'Presencial'} · {form.corporateClient || 'Sin convenio'}</p>
          </div>
          <span className="ml-auto text-xs text-slate-500">{footerHint}</span>
          <button type="button" onClick={resetAndClose} className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50">Cancelar</button>
          <button
            type="submit"
            form="delegated-appointment-form"
            disabled={isSubmitting || isLoadingData || isLockedForReschedule || editingSlotIndex !== null || (!isEditingAppointment && (!hasUsableBatch || slotDates.some((s, index) => !s || slotConflicts(s, [...psychologistBusyTimes, ...slotDates.filter((_, otherIndex) => otherIndex !== index)])) || (!isUnlimitedAuth && slotDates.length > remainingSessions)))}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-600"
          >
            <CalendarClock className="h-4 w-4" />
            {isSubmitting ? 'Procesando…' : isEditingAppointment ? 'Guardar cambios' : `Confirmar ${slotDates.length} ${slotDates.length === 1 ? 'cita' : 'citas'}`}
          </button>
        </div>
      </div>
      {editingSlotIndex !== null && (
        <div className="pointer-events-none fixed inset-0 z-[60]">
          <aside role="dialog" aria-labelledby="edit-slot-title" onKeyDown={(event) => { if (event.key === 'Escape') closeSlotEdit(); }} className="pointer-events-auto absolute inset-y-0 right-0 flex w-full max-w-[470px] flex-col rounded-l-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 id="edit-slot-title" className="text-xl font-bold text-slate-900">Editar horario</h3>
                <p className="text-sm text-slate-500">Sesión {(scheduleSummary?.appointments?.length || 0) + editingSlotIndex + 1} · Selección sin guardar</p>
              </div>
              <button type="button" onClick={closeSlotEdit} aria-label="Cerrar edición de horario" className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-6 py-4 text-sm text-slate-900">
              <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-1.5">
                <dt className="font-semibold">Paciente</dt><dd>{scheduleSummary?.patient.firstName || selectedPatientFull?.firstName} {scheduleSummary?.patient.lastName || selectedPatientFull?.lastName}</dd>
                <dt className="font-semibold">Profesional</dt><dd>{specialists.find((specialist) => specialist.id === form.userId)?.name || 'Profesional seleccionado'}</dd>
              </dl>
              <div className="border-y border-slate-200 py-2">
                <p className="text-xs text-slate-500">Horario actual</p>
                <p className="mt-0.5 font-semibold capitalize">{formatScheduleDate(editingSlotOriginal, true)} · {formatSlotTime(editingSlotOriginal)}</p>
              </div>
              <div>
                <label htmlFor="edit-slot-date" className="mb-1 block font-semibold">Fecha</label>
                <input id="edit-slot-date" type="date" value={editingSlotDateTime.slice(0, 10)} onChange={(event) => setEditingSlotDateTime(`${event.target.value}T${editingSlotDateTime.slice(11) || '08:00'}`)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-slot-time" className="mb-1 block font-semibold">Hora de inicio</label>
                  <input id="edit-slot-time" type="time" step="60" value={editingSlotDateTime.slice(11, 16)} onChange={(event) => setEditingSlotDateTime(`${editingSlotDateTime.slice(0, 10)}T${event.target.value}`)} className="w-full rounded-lg border border-indigo-500 bg-white px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-600" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">Duración</label>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600"><LockKeyhole className="h-4 w-4" /> {APPOINTMENT_DURATION_MINUTES} min</div>
                  <p className="mt-0.5 text-xs text-slate-500">Según el servicio</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs">
                <p>Finaliza a las <b>{editingSlotDateTime && !Number.isNaN(new Date(editingSlotDateTime).getTime()) ? new Date(new Date(editingSlotDateTime).getTime() + APPOINTMENT_DURATION_MINUTES * 60_000).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</b></p>
                <p className={`flex items-center gap-1.5 font-semibold ${editingSlotConflicts || editingSlotIsPast || editingDayError ? 'text-red-700' : !editingDayReady ? 'text-slate-500' : 'text-emerald-700'}`}>
                  {editingSlotConflicts || editingSlotIsPast || editingDayError ? <CircleAlert className="h-4 w-4" /> : !editingDayReady ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleCheck className="h-4 w-4" />}
                  {editingDayError ? 'No se pudo comprobar' : editingSlotIsPast ? 'Horario pasado' : editingSlotConflicts ? 'Se cruza con otra cita' : !editingDayReady ? 'Comprobando…' : 'Horario disponible'}
                </p>
              </div>
              <div className="rounded-xl bg-indigo-50 p-3.5">
                <p className="text-xs font-semibold text-indigo-700">Nuevo horario</p>
                <p className="mt-0.5 font-semibold capitalize">{formatScheduleDate(editingSlotDateTime)}</p>
                <p className="text-xl font-bold tabular-nums text-slate-900">{editingSlotDateTime && !Number.isNaN(new Date(editingSlotDateTime).getTime()) ? formatSlotTime(editingSlotDateTime) : '—'}</p>
                <p className="mt-0.5 text-xs text-slate-600">Bogotá (UTC−5)</p>
              </div>
              <p className="flex items-center gap-2 text-xs text-slate-500"><Info className="h-4 w-4 shrink-0" /> La cita se registrará al confirmar el agendamiento.</p>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button type="button" onClick={closeSlotEdit} className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50">Cancelar</button>
              <button type="button" disabled={!editingDayReady || editingSlotConflicts || editingSlotIsPast} onClick={() => { setSlotDates((prev) => prev.map((value, index) => index === editingSlotIndex ? editingSlotDateTime : value)); closeSlotEdit(); }} className="rounded-lg bg-indigo-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-400">Aplicar horario</button>
            </div>
          </aside>
        </div>
      )}
      {showAuthorizationDrawer && (
        <div className="fixed inset-0 z-[60] bg-slate-950/35" onClick={() => setShowAuthorizationDrawer(false)}>
          <aside role="dialog" aria-modal="true" aria-labelledby="authorization-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') setShowAuthorizationDrawer(false); }} className="absolute inset-y-0 right-0 flex w-full max-w-[590px] flex-col rounded-l-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h3 id="authorization-title" className="text-2xl font-bold text-slate-900">Gestionar autorización</h3>
                <p className="text-sm text-slate-500">{scheduleSummary?.patient.firstName} {scheduleSummary?.patient.lastName} · {form.corporateClient || 'Sin convenio'}</p>
              </div>
              <button type="button" onClick={() => setShowAuthorizationDrawer(false)} aria-label="Cerrar gestión de autorización" className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-8">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-semibold text-slate-600">Estado actual</p>
                <p className="mt-1 flex items-center gap-2 text-base font-bold text-amber-700">
                  {!activeAuth ? 'Sin autorización vigente' : isUnlimitedAuth ? 'Sesiones libres' : `${remainingSessions} sesiones disponibles`}
                  <Info className="h-4 w-4" />
                </p>
              </div>
              {pendingChangeRequestId ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-600">Código enviado{pendingChangeExpiresInMinutes ? ` · vence en ${pendingChangeExpiresInMinutes} min` : ''}. Pídele el código a quien lo recibió.</p>
                  <div>
                    <label htmlFor="authorization-code" className="mb-2 block text-sm font-semibold text-slate-900">Código de confirmación</label>
                    <input id="authorization-code" type="text" inputMode="numeric" maxLength={6} value={verifyCodeInput} onChange={(event) => setVerifyCodeInput(event.target.value.replace(/\D/g, ''))} placeholder="Código de 6 dígitos" className="w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <button type="button" onClick={() => { setPendingChangeRequestId(null); setPendingChangeExpiresInMinutes(null); setVerifyCodeInput(''); }} className="text-sm font-semibold text-indigo-700 hover:underline">Cancelar y pedir un código nuevo</button>
                </div>
              ) : (
                <>
                  <div>
                    <p className="mb-2 text-sm font-semibold text-slate-900">Operación</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['ADD', 'SUBTRACT'] as const).map((changeType) => (
                        <label key={changeType} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm font-semibold ${authChangeType === changeType ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-800'}`}>
                          <input type="radio" name="authorization-operation" checked={authChangeType === changeType} disabled={changeType === 'SUBTRACT' && (!activeAuth || isUnlimitedAuth)} onChange={() => { setAuthChangeType(changeType); if (changeType === 'SUBTRACT') setAuthLibres(false); }} className="accent-indigo-700" />
                          {changeType === 'ADD' ? 'Agregar' : 'Restar'}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="authorization-quantity" className="mb-2 block text-sm font-semibold text-slate-900">Cantidad de sesiones</label>
                    <div className="flex overflow-hidden rounded-lg border border-slate-300">
                      <input id="authorization-quantity" type="number" min={1} step={1} disabled={authLibres} value={authSessionsInput} onChange={(event) => setAuthSessionsInput(event.target.value)} className="min-w-0 flex-1 p-3 text-sm outline-none disabled:bg-slate-50" placeholder="3" />
                      <div className="flex flex-col border-l border-slate-200">
                        <button type="button" aria-label="Aumentar sesiones" disabled={authLibres} onClick={() => setAuthSessionsInput(String(Math.max(0, Number(authSessionsInput) || 0) + 1))} className="px-3 hover:bg-slate-50 disabled:text-slate-300"><ChevronUp className="h-4 w-4" /></button>
                        <button type="button" aria-label="Reducir sesiones" disabled={authLibres || Number(authSessionsInput) <= 1} onClick={() => setAuthSessionsInput(String(Math.max(1, (Number(authSessionsInput) || 1) - 1)))} className="border-t border-slate-200 px-3 hover:bg-slate-50 disabled:text-slate-300"><ChevronDown className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </div>
                  <label className="flex items-center gap-3 text-sm text-slate-900">
                    <input type="checkbox" checked={authLibres} disabled={authChangeType === 'SUBTRACT'} onChange={(event) => setAuthLibres(event.target.checked)} className="h-4 w-4 accent-indigo-700" />
                    Sesiones libres (sin tope)
                  </label>
                  {!isSelfAuthorize && (
                    <div>
                      <label htmlFor="authorization-approver" className="mb-2 block text-sm font-semibold text-slate-900">Destinatario del código</label>
                      <div className="relative">
                        <select id="authorization-approver" value={authApproverId} onChange={(event) => setAuthApproverId(event.target.value)} className="w-full appearance-none rounded-lg border border-slate-300 bg-white p-3 pr-9 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500">
                          <option value="">Selecciona un destinatario</option>
                          {approvers.map((approver) => <option key={approver.id} value={approver.id}>{approver.name}</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      </div>
                      <p className="mt-2 text-xs text-slate-500">{approvers.length ? 'Selecciona a quién se enviará el código.' : 'No hay aprobadores disponibles. Configúralos desde Equipo y Accesos.'}</p>
                    </div>
                  )}
                </>
              )}
              <p className="flex items-center gap-2 border-t border-slate-200 pt-5 text-xs text-slate-500"><Info className="h-4 w-4 shrink-0" /> La autorización y la selección de citas se gestionan por separado.</p>
            </div>
            <div className="flex items-center gap-3 border-t border-slate-200 px-6 py-4">
              <p className="mr-auto max-w-44 text-xs text-slate-500">{pendingChangeRequestId ? 'Ingresa el código recibido para continuar.' : !isSelfAuthorize && !authApproverId ? 'Selecciona un destinatario para continuar.' : 'Confirma el cambio de sesiones.'}</p>
              <button type="button" onClick={() => setShowAuthorizationDrawer(false)} className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50">Cerrar</button>
              <button type="button" onClick={pendingChangeRequestId ? handleVerifySessionChange : handleAuthorizeSessions} disabled={authorizingSessions || verifyingCode || (pendingChangeRequestId ? verifyCodeInput.length !== 6 : (!isSelfAuthorize && !authApproverId) || (authChangeType === 'ADD' && !authCompanyId) || (!authLibres && (!Number.isInteger(Number(authSessionsInput)) || Number(authSessionsInput) <= 0)))} className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-600">
                <Send className="h-4 w-4" /> {pendingChangeRequestId ? 'Confirmar código' : isSelfAuthorize ? 'Aplicar cambio' : 'Solicitar código'}
              </button>
            </div>
          </aside>
        </div>
      )}
      {historyDrawer === 'change' && canManageHistory && (
        <ChangePsychologistDrawer
          patientId={form.patientId}
          patientName={historyPatientName}
          recordNumber={selectedPatientFull?.recordNumber}
          currentCompanyName={historyCompanyName}
          currentPsychologistId={historyPsychologistId}
          currentPsychologistName={historyPsychologistName}
          channel={historyChannel}
          specialists={visibleSpecialists}
          onClose={() => setHistoryDrawer(null)}
          onComplete={handleChangePsychologistComplete}
        />
      )}
      {historyDrawer === 'agreement' && canManageHistory && (
        <NewAgreementDrawer
          patientId={form.patientId}
          patientName={historyPatientName}
          recordNumber={selectedPatientFull?.recordNumber}
          currentCompanyName={historyCompanyName}
          currentCompanyId={selectedPatientFull?.companyId}
          currentPsychologistName={historyPsychologistName}
          specialists={visibleSpecialists}
          companies={companies}
          onClose={() => setHistoryDrawer(null)}
          onComplete={handleNewAgreementComplete}
          onOpenExisting={onViewPatientProfile ? (patientId) => { resetAndClose(); onViewPatientProfile(patientId); } : undefined}
        />
      )}
    </div>
  );
}
