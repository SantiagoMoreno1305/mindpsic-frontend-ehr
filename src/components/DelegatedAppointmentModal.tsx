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
import { X, Plus, Pencil, Video, Building2, Link2, CalendarClock, User } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import PsychologistAvailabilityGrid from './PsychologistAvailabilityGrid';

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
}

interface ServiceLocationOption {
  id: string;
  name: string;
  address?: string | null;
}

interface CompanyOption {
  id: string;
  name: string;
  domain?: string | null;
  clientType: 'EMPRESA' | 'PARTICULAR';
  status: string;
  locations: ServiceLocationOption[];
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
}

interface ScheduleSummary {
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    documentId: string;
    phone: string | null;
    companyName: string | null;
  };
  // Lote de sesiones VIGENTE del paciente — null si nunca se le autorizó
  // ninguno, o si el último se cerró (agotado o cambio de convenio). Sin
  // lote activo no se puede agendar (ver authorizeSessions/createAppointment
  // en el backend).
  activeAuthorization: ActiveAuthorization | null;
  sessionsTaken: number;
  sessionsRemaining: number | null;
  appointments: ScheduleSummaryAppointment[];
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

// ── Agendamiento múltiple (varias sesiones en una sola confirmación) ──────
// `slotDates` guarda un datetime-local por sesión a crear. Al crecer la
// lista, las fechas nuevas se sugieren +7 días desde la última fecha ya
// llena (cadencia semanal, típica de terapia) — quedan editables, no es una
// cadena rígida.
function addWeeks(dateTimeLocal: string, weeks: number): string {
  if (!dateTimeLocal) return '';
  const d = new Date(dateTimeLocal);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + weeks * 7);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
    const prev = next[next.length - 1];
    next.push(prev ? addWeeks(prev, 1) : '');
  }
  return next;
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
  companies: CompanyOption[];
  specialties: SpecialtyOption[];
}

let selectoresCache: (SelectoresData & { ts: number }) | null = null;

/** Petición en vuelo — evita disparar dos cargas simultáneas (p. ej. si el
 *  prefetch aún no terminó y el usuario ya abrió el modal). */
let cargaEnVuelo: Promise<SelectoresData> | null = null;

const cacheEsValida = (): boolean =>
  !!selectoresCache && Date.now() - selectoresCache.ts < SELECTORES_CACHE_TTL_MS;

// NOTA: los pacientes NO se precargan/cachean aquí a propósito — a diferencia
// de especialistas/convenios/especialidades (catálogos acotados al tamaño del
// staff/convenios del tenant), el universo de pacientes puede ser enorme
// (decenas o cientos de miles). Se buscan bajo demanda con debounce contra
// GET /api/appointments/patients?q=… (ver efecto de búsqueda más abajo),
// nunca se trae el listado completo al frontend.
async function cargarSelectores(): Promise<SelectoresData> {
  if (cargaEnVuelo) return cargaEnVuelo;

  cargaEnVuelo = (async () => {
    const [specRes, compRes, specialtyRes] = await Promise.all([
      apiFetch('/api/users/specialists'),
      apiFetch('/api/companies'),
      apiFetch('/api/specialties/options'),
    ]);

    const leer = async <T,>(res: Response): Promise<T[]> => {
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    };

    const frescos: SelectoresData = {
      specialists:  await leer<Specialist>(specRes),
      companies:    await leer<CompanyOption>(compRes),
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
}

export default function DelegatedAppointmentModal({
  isOpen,
  onClose,
  onSuccess,
  initialData,
}: DelegatedAppointmentModalProps) {
  // ── Data state ──────────────────────────────────────────────────────────
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [specialties, setSpecialties] = useState<SpecialtyOption[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditingAppointment = !!initialData?.id;
  // Una cita ya atendida/cancelada, o cuya fecha ya pasó, no se puede
  // reprogramar — es un registro cerrado o vencido. El backend también lo
  // valida (defensa en profundidad); esto es para no dejar ni intentar.
  const isLockedForReschedule = isEditingAppointment && !!initialData && (
    initialData.status === 'Atendida' ||
    initialData.status === 'Cancelada' ||
    (!!initialData.date && new Date(initialData.date).getTime() < Date.now())
  );
  const lockedRescheduleReason = !isLockedForReschedule ? null
    : initialData.status === 'Atendida' ? 'Esta cita ya fue atendida — no se puede reprogramar.'
    : initialData.status === 'Cancelada' ? 'Esta cita fue cancelada — no se puede reprogramar.'
    : 'La fecha y hora de esta cita ya pasaron — no se puede reprogramar.';

  // ── Buscador de paciente (autocomplete, no listado completo) ───────────
  // El universo de pacientes de un tenant puede ser enorme — se busca bajo
  // demanda contra GET /api/appointments/patients?q=…, con debounce, en vez
  // de traer/cachear el listado entero como sí se hace con especialistas,
  // convenios y especialidades (esos son catálogos acotados por diseño).
  const [selectedPatientFull, setSelectedPatientFull] = useState<PatientOption | null>(null);
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
  const lastAutoSizedPatientId = useRef<string | null>(null);
  // Fecha/hora original de la cita al entrar en modo edición — para saber si
  // el usuario realmente la movió (y por lo tanto sí toca marcarla como
  // "Reprogramada") o si guardó sin tocar la fecha (no hay nada que reprogramar).
  const originalDateTimeRef = useRef<string>('');

  // Clic en un espacio libre del grid de disponibilidad del psicólogo →
  // llena la primera sesión sin fecha. Si es la Sesión 1, aplica la misma
  // cascada semanal (+7 días) que al editarla a mano; si es una sesión
  // intermedia, solo llena esa (no pisa fechas ya ajustadas manualmente).
  const fillSlotFromAvailability = (dateTimeLocal: string) => {
    setSlotDates((prev) => {
      const idx = prev.findIndex((s) => !s);
      if (idx === -1) {
        toast('Todas las sesiones ya tienen fecha asignada.');
        return prev;
      }
      if (idx === 0) {
        return prev.map((s, i) => {
          if (i === 0) return dateTimeLocal;
          if (s) return s;
          // No autocompleta la cascada semanal sobre un horario que ya está
          // ocupado — deja esa sesión sin fecha para que quede pendiente y
          // el administrativo elija otro horario a propósito.
          const suggested = addWeeks(dateTimeLocal, i);
          return psychologistBusyTimes.has(suggested) ? '' : suggested;
        });
      }
      return prev.map((s, i) => (i === idx ? dateTimeLocal : s));
    });
  };

  // Clic en una sesión ya resaltada como pendiente en el grid → la limpia,
  // para corregir un día mal seleccionado sin tener que borrar el campo a mano.
  const clearSlotFromAvailability = (dateTimeLocal: string) => {
    setSlotDates((prev) => prev.map((s) => (s === dateTimeLocal ? '' : s)));
  };

  // ── Autorizar sesiones (crear el primer lote, ampliar el vigente, o
  // cambiar de convenio) — un solo flujo, ver POST .../authorize-sessions.
  // Mismo convenio del lote activo = suma; convenio distinto = cierra el
  // lote actual (pierde lo que le quedaba) y abre uno nuevo.
  const [authCompanyId, setAuthCompanyId] = useState('');
  const [authSessionsInput, setAuthSessionsInput] = useState('');
  const [authLibres, setAuthLibres] = useState(false);
  const [authorizingSessions, setAuthorizingSessions] = useState(false);
  // Fuerza mostrar el formulario de autorizar aunque todavía queden sesiones
  // disponibles (para cambiar de convenio de forma proactiva, no solo al agotar).
  const [showAuthForm, setShowAuthForm] = useState(false);

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
  });

  // ── Horarios ya ocupados del psicólogo seleccionado (próximos 90 días) ──
  // Se usa para NO autocompletar la cascada semanal sobre un horario que ya
  // tiene otra cita, y para marcar con alerta visual cualquier sesión cuya
  // fecha (llenada a mano, por cascada o desde el grid) choque con una cita
  // existente — el backend igual lo rechaza al confirmar, pero así se
  // detecta antes de intentar guardar. Clave = mismo string "YYYY-MM-DDTHH:mm"
  // que usan los inputs datetime-local, para comparar sin conversión.
  const [psychologistBusyTimes, setPsychologistBusyTimes] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!form.userId) { setPsychologistBusyTimes(new Set()); return; }
    let cancelled = false;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
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
          if (appt.status === 'Cancelada') continue;
          if (isEditingAppointment && appt.id === initialData?.id) continue; // no choca contra sí misma
          busy.add(toLocalKey(new Date(appt.date)));
        }
        setPsychologistBusyTimes(busy);
      })
      .catch(() => { if (!cancelled) setPsychologistBusyTimes(new Set()); });
    return () => { cancelled = true; };
  }, [form.userId, isEditingAppointment, initialData?.id]);

  // Si initialData cambia, actualizar el form
  useEffect(() => {
    if (initialData) {
      const initialDateTime = initialData.date ? (() => {
        const d = new Date(initialData.date);
        const pad = (n: number) => n.toString().padStart(2, '0');
        return !isNaN(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
      })() : '';
      originalDateTimeRef.current = initialDateTime;
      setForm({
        userId: initialData.psychologist?.id || initialData.userId || '',
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
        });
      } else {
        setSelectedPatientFull(null);
      }
    } else {
      setForm({
        userId: '', patientId: '', specialtyId: '', dateTime: '', timeSlot: '',
        appointmentType: 'clinico', modality: 'Virtual', location: '', notes: '',
        corporateClient: '', locationId: '',
      });
      setSelectedPatientFull(null);
    }
    setPatientSearchTerm('');
    setPatientSearchResults([]);
    setShowPatientResults(false);
    setSlotDates(['']);
    setAuthCompanyId('');
    setAuthSessionsInput('');
    setAuthLibres(false);
    setShowAuthForm(false);
    lastAutoSizedPatientId.current = null;
  }, [initialData, isOpen]);

  // ── Fetch datos al abrir ──────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    fetchSelectorsData();
  }, [isOpen]);

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

  // ── Ficha del paciente: se recarga cada vez que cambia el paciente seleccionado ──
  useEffect(() => {
    if (!form.patientId || isCreatingPatient) {
      setScheduleSummary(null);
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
    setIsSubmitting(true);

    try {
      const token  = localStorage.getItem('mind_token');
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
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

        const payload: Record<string, unknown> = {
          date:            form.dateTime,
          timeSlot:        form.timeSlot || form.dateTime?.split('T')[1]?.slice(0, 5) || '08:00',
          specialistId:    form.userId,
          userId:          form.userId,
          specialtyId:     form.specialtyId || null,
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

      // ── Agendamiento nuevo — una cita por cada fecha en slotDates ───────
      // (1 sola si el paciente agenda una única sesión, varias si se está
      // programando de una vez el bloque de sesiones disponibles).
      let created = 0;
      for (const dateTime of slotDates) {
        const payload = {
          patientId:       form.patientId,
          userId:          form.userId,
          specialtyId:     form.specialtyId || null,
          date:            dateTime,
          timeSlot:        dateTime.split('T')[1]?.slice(0, 5) || '08:00',
          appointmentType: form.appointmentType,
          modality:        form.modality,
          roomUrl:         form.modality === 'Virtual' ? '' : null,
          notes:           form.notes || null,
          status:          'Confirmada',
          corporateClient: form.corporateClient,
          companyId:       selectedCompany?.id || null,
          locationId:      form.locationId || null,
        };

        const res = await fetch(`${apiUrl}/api/appointments`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(
            created > 0
              ? `Se agendaron ${created} de ${slotDates.length} sesiones — falló la siguiente: ${errData.error || `HTTP ${res.status}`}`
              : (errData.error || `HTTP ${res.status}`)
          );
        }
        created += 1;
      }

      toast.success(created === 1 ? 'Cita creada exitosamente.' : `${created} citas creadas exitosamente.`);
      onSuccess?.();
      resetAndClose();
    } catch (err: any) {
      toast.error(`Error al agendar: ${err.message}`);
      // Si fue un fallo parcial (algunas sesiones sí se crearon), refresca la
      // ficha para reflejarlas y deja el modal abierto en vez de resetearlo.
      if (form.patientId) {
        apiFetch(`/api/patients/${form.patientId}/schedule-summary`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => data && setScheduleSummary(data))
          .catch(() => {});
        onSuccess?.();
      }
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
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
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
      corporateClient: '', locationId: '',
    });
    setIsEditingPatient(false);
    setIsCreatingPatient(false);
    setScheduleSummary(null);
    setSelectedPatientFull(null);
    setPatientSearchTerm('');
    setPatientSearchResults([]);
    setShowPatientResults(false);
    setSlotDates(['']);
    setAuthCompanyId('');
    setAuthSessionsInput('');
    setAuthLibres(false);
    setShowAuthForm(false);
    lastAutoSizedPatientId.current = null;
    onClose();
  };

  // ── Autorizar sesiones (crear el primer lote / ampliar el vigente /
  // cambiar de convenio) — un solo flujo, ver POST .../authorize-sessions.
  // El backend decide si suma al lote activo (mismo convenio) o cierra el
  // actual y abre uno nuevo (convenio distinto).
  const handleAuthorizeSessions = async () => {
    if (!authCompanyId) {
      toast.error('Selecciona el convenio con el que se autorizan estas sesiones.');
      return;
    }
    const n = Number(authSessionsInput);
    if (!authLibres && (!Number.isInteger(n) || n <= 0)) {
      toast.error('Ingresa un número entero de sesiones mayor a 0 (o marca "sesiones libres").');
      return;
    }
    setAuthorizingSessions(true);
    try {
      const res = await apiFetch(`/api/patients/${form.patientId}/authorize-sessions`, {
        method: 'POST',
        body: JSON.stringify({ companyId: authCompanyId, unlimited: authLibres, sessionsAuthorized: authLibres ? undefined : n }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const result = await res.json();

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
      toast.success(
        result.renewed
          ? `Lote anterior cerrado (${result.closedReason}) — nuevas sesiones autorizadas con ${result.companyName}.`
          : `Sesiones autorizadas con ${result.companyName}.`
      );
    } catch (err: any) {
      toast.error(`Error al autorizar sesiones: ${err.message}`);
    } finally {
      setAuthorizingSessions(false);
    }
  };

  const startEditPatient = () => {
    if (!selectedPatientFull) return;
    setNewPatientFirstName(selectedPatientFull.firstName);
    setNewPatientLastName(selectedPatientFull.lastName);
    setNewPatientDocument(selectedPatientFull.documentId);
    setNewPatientEmail(selectedPatientFull.email || '');
    // Teléfono, tipo de documento y fecha de nacimiento no vienen en
    // PatientOption (el listado de selección no los trae) — quedan en su
    // valor por defecto / en blanco para completar o corregir.
    setNewPatientPhone('');
    setNewPatientDocumentType('CC');
    setNewPatientBirthDate('');
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
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
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
        id: updatedPatient.id,
        firstName: updatedPatient.firstName,
        lastName: updatedPatient.lastName,
        documentId: updatedPatient.documentId,
        email: updatedPatient.email,
      });

      setIsEditingPatient(false);
      toast.success('Paciente actualizado exitosamente.');
    } catch (err: any) {
      toast.error(`Error al actualizar paciente: ${err.message}`);
    } finally {
      setIsProvisioning(false);
    }
  };

  // ── Hint del footer: qué sesión(es) se está(n) registrando ─────────────
  const footerHint = (() => {
    if (!form.patientId) return 'Sin paciente seleccionado.';
    if (isEditingAppointment) return 'Se reprogramará la cita seleccionada.';
    const start = (scheduleSummary?.appointments.length || 0) + 1;
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
  // Mismo estilo "bloqueado" que la caja de Convenio / Cliente Corporativo —
  // misma altura, color y fuente en cualquier caja de solo lectura.
  const lockedBoxClass = 'flex min-h-[42px] w-full items-center border border-slate-200 rounded-lg p-2.5 text-sm bg-slate-100 text-slate-600';

  const companySelect = (
    <select
      value={authCompanyId}
      onChange={(e) => setAuthCompanyId(e.target.value)}
      className="min-h-[42px] w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
    >
      <option value="" disabled>Seleccione un convenio</option>
      {companies.filter((c) => c.status === 'activo').map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );

  const authorizeControls = (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {authLibres ? (
          <div className="flex-1 rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-xs font-semibold text-emerald-700">Libres</div>
        ) : (
          <input
            type="number" min={1} value={authSessionsInput}
            onChange={(e) => setAuthSessionsInput(e.target.value)}
            placeholder="Ej. 3"
            className="min-w-0 flex-1 border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
          />
        )}
        <button
          type="button"
          onClick={() => { void handleAuthorizeSessions().then(() => setShowAuthForm(false)); }}
          disabled={authorizingSessions}
          className="shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold px-2.5 py-2 disabled:opacity-50"
        >
          {authorizingSessions ? '...' : 'Agregar sesión'}
        </button>
      </div>
      <label className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
        <input type="checkbox" checked={authLibres} onChange={(e) => { setAuthLibres(e.target.checked); if (e.target.checked) setAuthSessionsInput(''); }} />
        Libres (sin tope)
      </label>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-7xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center rounded-t-2xl shrink-0">
          <div>
            <h3 className="text-base font-bold text-slate-800">
              {isEditingAppointment ? 'Editar Cita Delegada' : 'Agendamiento de paciente'}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Registre la cita, valide las sesiones autorizadas y consulte el historial del paciente.
            </p>
          </div>
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
          <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] overflow-hidden flex-1">
            <form onSubmit={handleSubmit} className="p-6 space-y-4 text-left overflow-y-auto">
              {/* ── Especialidad + Especialista ────────────────────────── */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                    Especialidad
                  </label>
                  <select
                    required
                    value={form.specialtyId}
                    onChange={(e) => setForm({ ...form, specialtyId: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                  >
                    <option value="" disabled>Seleccione especialidad</option>
                    {specialties.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                    Especialista (Psicólogo)
                  </label>
                  <select
                    required
                    value={form.userId}
                    onChange={(e) => setForm({ ...form, userId: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                  >
                    <option value="" disabled>Seleccione un especialista</option>
                    {specialists.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.specialty ? ` – ${s.specialty}` : ''}
                        {s.level ? ` (Nivel ${s.level})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ── Selector de Paciente ──────────────────────────────────── */}
              <div>
                <div className="flex justify-between items-end mb-1">
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    Paciente
                  </label>
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
                        <select value={emergencyParentesco} onChange={e => setEmergencyParentesco(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                          <option value="">— Seleccione parentesco —</option>
                          {PARENTESCO_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
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
                        type="text"
                        required={!form.patientId}
                        value={form.patientId ? `${selectedPatientFull?.firstName || ''} ${selectedPatientFull?.lastName || ''} — CC ${selectedPatientFull?.documentId || ''}` : patientSearchTerm}
                        onChange={(e) => {
                          if (form.patientId) setForm(prev => ({ ...prev, patientId: '', corporateClient: '' }));
                          setSelectedPatientFull(null);
                          setPatientSearchTerm(e.target.value);
                          setShowPatientResults(true);
                        }}
                        onFocus={() => setShowPatientResults(true)}
                        onBlur={() => setTimeout(() => setShowPatientResults(false), 150)}
                        disabled={isEditingAppointment}
                        placeholder="Buscar paciente por nombre o documento…"
                        className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white disabled:opacity-50 disabled:bg-slate-100"
                      />
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
                                    setForm(prev => ({ ...prev, patientId: p.id, corporateClient: '' }));
                                    setPatientSearchTerm('');
                                    setShowPatientResults(false);
                                  }}
                                  className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-indigo-50"
                                >
                                  {p.firstName} {p.lastName} — CC {p.documentId}
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
                    {form.patientId && !isCreatingPatient && !isEditingPatient && (
                      <div className="flex gap-4 mt-1.5">
                        <button type="button" onClick={startEditPatient} className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline">
                          <Pencil className="w-3 h-3" /> Corregir datos de este paciente
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Fila 1: Convenio / Cliente Corporativo + Convenio actual ── */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                    Convenio / Cliente Corporativo
                  </label>
                  {form.patientId && !isCreatingPatient ? (
                    <>
                      <div className={lockedBoxClass}>
                        {form.corporateClient || '—'}
                      </div>
                      <p className="mt-1 text-[10.5px] text-slate-400">Último convenio que registra el paciente.</p>
                    </>
                  ) : (
                    <select
                      required
                      value={form.corporateClient}
                      onChange={(e) => setForm({ ...form, corporateClient: e.target.value, locationId: '' })}
                      className="min-h-[42px] w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
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
                  )}
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                    Convenio actual
                  </label>
                  {isCreatingPatient || !form.patientId ? (
                    <div className="p-2.5 text-xs text-slate-400">Crea o selecciona el paciente para gestionar sus sesiones.</div>
                  ) : loadingSummary || !scheduleSummary ? (
                    <div className="p-2.5 text-xs text-slate-400 animate-pulse">Cargando cupo…</div>
                  ) : isEditingAppointment ? (
                    // Reprogramando una cita existente: solo se muestra el estado.
                    <div className={lockedBoxClass}>
                      {!activeAuth ? 'Sin autorización vigente' : isUnlimitedAuth ? `Libres - ${activeAuth.companyName}` : `${remainingSessions} disponibles - ${activeAuth.companyName}`}
                    </div>
                  ) : !hasUsableBatch || showAuthForm ? (
                    companySelect
                  ) : (
                    <div className={lockedBoxClass}>
                      {isUnlimitedAuth ? `Libres - ${activeAuth!.companyName}` : `${remainingSessions} disponibles - ${activeAuth!.companyName}`}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Fila 2: Sesiones (estado) + Agregar sesión / agendar ahora ── */}
              {!isCreatingPatient && form.patientId && !isEditingAppointment && !loadingSummary && scheduleSummary && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                      Sesiones
                    </label>
                    <div className={!hasUsableBatch ? 'flex min-h-[42px] w-full items-center rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-700' : lockedBoxClass}>
                      {!activeAuth
                        ? 'Sin autorización vigente.'
                        : !hasUsableBatch
                          ? `0 sesiones disponibles con ${activeAuth.companyName}.`
                          : isUnlimitedAuth
                            ? `Libres - ${activeAuth.companyName}`
                            : `${remainingSessions} disponibles - ${activeAuth.companyName}`}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                      {hasUsableBatch && !showAuthForm ? '¿Cuántas agendar ahora?' : 'Agregar sesión'}
                    </label>
                    {!hasUsableBatch ? (
                      authorizeControls
                    ) : showAuthForm ? (
                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-[10px] text-slate-400">Convenio distinto = cierra el lote actual (pierde lo que quede).</span>
                          <button type="button" onClick={() => setShowAuthForm(false)} className="text-[10px] font-semibold text-slate-400 hover:text-slate-600">Cancelar</button>
                        </div>
                        {authorizeControls}
                      </div>
                    ) : (
                      <>
                        <input
                          type="number" min={1} max={isUnlimitedAuth ? undefined : remainingSessions}
                          value={slotDates.length}
                          onChange={(e) => {
                            const n = Math.max(1, Math.min(Number(e.target.value) || 1, isUnlimitedAuth ? Infinity : remainingSessions));
                            setSlotDates((prev) => resizeSlotDates(prev, n));
                          }}
                          className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => setShowAuthForm(true)}
                          className="mt-1.5 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                          Cambiar de convenio
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ── Fecha y Hora ──────────────────────────────────────────── */}
              {isEditingAppointment ? (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                    Fecha y Hora
                  </label>
                  {isLockedForReschedule ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm font-semibold text-amber-700">
                      {lockedRescheduleReason}
                    </div>
                  ) : (
                    <input
                      type="datetime-local"
                      required
                      value={form.dateTime || ''}
                      onChange={(e) =>
                        setForm(prev => ({ ...prev, dateTime: e.target.value }))
                      }
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  )}
                </div>
              ) : !hasUsableBatch ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-center text-[11px] text-slate-400">
                  Autoriza sesiones disponibles arriba para habilitar el calendario de agendamiento.
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    Fecha y Hora {slotDates.length > 1 ? `— ${slotDates.length} sesiones` : ''}
                  </label>
                  {slotDates.map((slot, i) => {
                    const isBusy = !!slot && psychologistBusyTimes.has(slot);
                    // Si esta sesión quedó vacía porque la cascada semanal
                    // (basada en la Sesión 1) encontró ocupado el horario que le
                    // tocaba, lo indicamos aunque el campo esté en blanco — si
                    // no, no hay ninguna pista de por qué no se autocompletó.
                    const cascadeSuggestion = !slot && i > 0 && slotDates[0] ? addWeeks(slotDates[0], i) : null;
                    const cascadeSkipped = !!cascadeSuggestion && psychologistBusyTimes.has(cascadeSuggestion);
                    return (
                      <div key={i}>
                        <div className="flex items-center gap-2">
                          <span className="w-14 shrink-0 text-[10.5px] font-semibold text-slate-400">
                            Sesión {(scheduleSummary?.appointments.length || 0) + i + 1}
                          </span>
                          <input
                            type="datetime-local"
                            required
                            value={slot}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setSlotDates((prev) => prev.map((s, idx) => {
                                if (idx === i) return newValue;
                                // Al fijar la sesión 1, sugiere semanalmente las
                                // siguientes (misma hora, +7 días cada una) —
                                // solo en las que sigan vacías, para no pisar
                                // fechas que el administrativo ya haya ajustado.
                                // Si ese horario ya está ocupado, no lo autocompleta:
                                // la deja pendiente en vez de chocar en silencio.
                                if (i === 0 && idx > 0 && !s) {
                                  const suggested = addWeeks(newValue, idx);
                                  return psychologistBusyTimes.has(suggested) ? '' : suggested;
                                }
                                return s;
                              }));
                            }}
                            className={`w-full rounded-lg border p-2.5 text-sm outline-none focus:ring-2 ${
                              isBusy || cascadeSkipped
                                ? 'border-red-300 bg-red-50 focus:ring-red-400'
                                : 'border-slate-200 focus:ring-indigo-500'
                            }`}
                          />
                        </div>
                        {isBusy && (
                          <p className="ml-16 mt-1 text-[10.5px] font-semibold text-red-600">
                            Este horario ya está ocupado para este psicólogo — elige otro.
                          </p>
                        )}
                        {cascadeSkipped && (() => {
                          const { dateLabel, timeLabel } = formatDateTime(cascadeSuggestion!);
                          return (
                            <p className="ml-16 mt-1 text-[10.5px] font-semibold text-red-600">
                              El horario sugerido ({dateLabel}, {timeLabel}) ya está ocupado — elige otro para esta sesión.
                            </p>
                          );
                        })()}
                      </div>
                    );
                  })}
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
                        ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-sm'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <Video className="w-4 h-4" /> Telepsicología
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, modality: 'Presencial' })
                    }
                    className={`p-2.5 rounded-lg text-sm font-medium border flex items-center justify-center gap-2 transition-all ${
                      form.modality === 'Presencial'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <Building2 className="w-4 h-4" /> Presencial
                  </button>
                </div>
              </div>

              {/* ── Campo condicional de modalidad ────────────────────────── */}
              {form.modality === 'Virtual' ? (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-indigo-50/50 border border-indigo-100">
                  <Link2 className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span className="text-[11px] text-indigo-600 font-medium">
                    La sala virtual será asignada automáticamente por el
                    enrutador WebRTC al confirmar la cita.
                  </span>
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
                      <select
                        value={form.locationId}
                        onChange={(e) => setForm({ ...form, locationId: e.target.value })}
                        className="w-full border border-emerald-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 bg-emerald-50/30 outline-none"
                      >
                        <option value="">— Seleccione una sede —</option>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}{loc.address ? ` — ${loc.address}` : ''}
                          </option>
                        ))}
                      </select>
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

              {/* ── Acciones ─────────────────────────────────────────────── */}
              <div className="pt-3 flex items-center justify-between gap-2 border-t border-slate-100">
                <span className="text-[11px] text-slate-400">{footerHint}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={resetAndClose}
                    className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isSubmitting || isLoadingData || isLockedForReschedule ||
                      (!isEditingAppointment && !!form.patientId && !isCreatingPatient && !loadingSummary &&
                        (!scheduleSummary?.activeAuthorization ||
                          (scheduleSummary.activeAuthorization.sessionsAuthorized !== null && (scheduleSummary.sessionsRemaining ?? 0) <= 0))) ||
                      (!isEditingAppointment && slotDates.some((s) => s && psychologistBusyTimes.has(s)))
                    }
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                      isSubmitting
                        ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                    }`}
                  >
                    <CalendarClock className="w-3.5 h-3.5" />
                    {isSubmitting
                      ? 'Procesando...'
                      : isEditingAppointment
                        ? 'Guardar Cambios'
                        : slotDates.length > 1
                          ? `Confirmar ${slotDates.length} agendamientos`
                          : 'Confirmar agendamiento'}
                  </button>
                </div>
              </div>
            </form>

            {/* ── Disponibilidad del psicólogo + Ficha del paciente ─────────── */}
            <div className="border-l border-slate-100 bg-slate-50/50 p-5 overflow-y-auto space-y-5">
              {form.userId && (
                <PsychologistAvailabilityGrid
                  psychologistId={form.userId}
                  psychologistName={specialists.find((s) => s.id === form.userId)?.name}
                  initialWeekDate={isEditingAppointment && form.dateTime ? new Date(form.dateTime) : undefined}
                  excludeAppointmentId={isEditingAppointment && !isLockedForReschedule ? initialData?.id : undefined}
                  onSlotPick={isEditingAppointment
                    ? (isLockedForReschedule ? () => {} : (dt) => setForm((prev) => ({ ...prev, dateTime: dt })))
                    : fillSlotFromAvailability}
                  pendingDateTimes={isEditingAppointment ? (isLockedForReschedule ? [] : [form.dateTime]) : slotDates}
                  onSlotClear={isEditingAppointment
                    ? (isLockedForReschedule ? () => {} : () => setForm((prev) => ({ ...prev, dateTime: '' })))
                    : clearSlotFromAvailability}
                />
              )}

              {!form.userId && (!form.patientId || isCreatingPatient) ? (
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
                      CC {scheduleSummary.patient.documentId}{scheduleSummary.patient.phone ? ` · ${scheduleSummary.patient.phone}` : ''}
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
      </div>
    </div>
  );
}
