/**
 * CreatePatientModal.tsx
 *
 * Registro rápido de un nuevo paciente (sin agendar cita) y edición de uno ya
 * existente — mismo formulario en ambos casos (pasar `patient` activa el modo
 * edición, precargado con sus datos actuales). Disponible tanto para
 * administradores/soporte operativo como para especialistas — cualquier
 * usuario autenticado del tenant puede crear/editar pacientes (el backend no
 * restringe estos endpoints por rol, solo exige tenant).
 *
 * El contacto de emergencia vive en InitialAssessment (Valoración Individual),
 * no en Patient — al crear, este modal lo manda dentro del POST /api/patients
 * (el backend arma el borrador de Valoración con esos datos). En modo edición
 * se lee y actualiza aparte, contra /api/initial-assessment/:patientId — si
 * esa valoración ya fue FIRMADA, esos 4 campos quedan de solo lectura (misma
 * regla de inmutabilidad clínica que rige el resto de la valoración).
 *
 * Endpoints consumidos:
 *   GET  /api/companies              → Convenios / clientes corporativos del tenant
 *   GET  /api/users/specialists      → Psicólogos del tenant (para asignar responsable)
 *   POST /api/patients               → Creación del paciente
 *   PUT  /api/patients/:id           → Actualización del paciente (modo edición)
 *   GET  /api/initial-assessment/:id → Contacto de emergencia actual (modo edición)
 *   PUT  /api/initial-assessment/:id → Actualización del contacto de emergencia (modo edición)
 */
import { useState, useEffect } from 'react';
import { X, UserPlus, Save, Loader2, User, Building2, HeartPulse, CalendarClock, BarChart3 } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useCompanies } from '../../hooks/useCompanies';
import type { BackendPatient } from '../../types';

interface AgreementTypeOption {
  id: string;
  name: string;
}

// Sesiones del cupo vigente del paciente, agrupadas por estado — ver
// GET /api/patients/:id/schedule-summary. "aprobadas" es el total del lote
// activo (null = sesiones libres/ilimitadas); las otras cuatro son conteos
// reales de citas por estado, no valores editables a mano.
interface SessionStats {
  aprobadas: number | null;
  cumplidas: number;
  reprogramadas: number;
  canceladas: number;
  pendientes: number;
}

// Ícono + título con línea divisoria — separa visualmente cada bloque del
// formulario (antes solo había un border-t suelto sin jerarquía visual).
function SectionHeader({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-toast-50 text-toast-500">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    </div>
  );
}

// Tarjeta de solo lectura para un conteo de sesiones — value === null se
// muestra como "Libres" (lote sin tope, ver activeAuthorization.sessionsAuthorized).
const SESSION_STAT_TONES: Record<string, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-charcoal-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
};
function SessionStatCard({ label, value, tone }: { label: string; value: number | null; tone: keyof typeof SESSION_STAT_TONES }) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 text-center ${SESSION_STAT_TONES[tone]}`}>
      <p className="text-lg font-bold leading-tight">{value === null ? 'Libres' : value}</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
    </div>
  );
}

interface SpecialistOption {
  id: string;
  name: string;
}

interface DuplicatePatientInfo {
  id: string;
  firstName: string;
  lastName: string;
  documentId: string;
  status: string;
  recordNumber?: string | null;
}

interface CreatePatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Modo creación (patient ausente): onCreated es obligatorio.
  // Modo edición (patient presente): onUpdated es obligatorio.
  patient?: BackendPatient | null;
  onCreated?: (patient: BackendPatient, wasReactivated?: boolean) => void;
  onUpdated?: (patient: BackendPatient) => void;
  // Autorizar sesiones es una decisión administrativa/financiera — mismo
  // gate de rol que exige el backend (ver authorizeSessions en
  // patient.controller.js): solo CEO/DIRECTIVO pueden asignar el cupo
  // inicial al crear. Sin este prop, el campo simplemente no se muestra.
  userRole?: string;
}

// Exportado — PacientesPanel.tsx lo reutiliza para el filtro y la columna
// "Estado" de la tabla, así las dos vistas nunca se desincronizan.
export const PATIENT_STATUS_LABELS: Record<string, string> = {
  notificado_1: 'Notificado 1°vez',
  notificado_2: 'Notificado 2°vez',
  notificado_3: 'Notificado 3°vez',
  notificado_4: 'Notificado 4°vez',
  anulado: 'Anulado',
  // "agendado" lo asigna automáticamente el backend al crear cualquier cita
  // para el paciente (ver createAppointment) — no tiene sentido elegirlo a
  // mano, pero sí debe verse/filtrarse como cualquier otro estado.
  agendado: 'Agendado',
  // Solo la etiqueta visible cambió (de "Activo" a "Atendida") — la clave
  // interna "activo" sigue igual en BD y en toda la lógica de negocio.
  activo: 'Atendida',
  alta: 'De alta',
  pausa: 'En pausa',
  finalizado: 'Finalizado',
};

// Estado con el que arranca un paciente creado desde este modal (registro sin
// agendar todavía) — no aplica al alta inline que hace el agendamiento, que
// sigue cayendo al default "activo" del backend porque ese flujo no manda
// este campo.
const INITIAL_CONTACT_STATUS_OPTIONS = [
  'notificado_1', 'notificado_2', 'notificado_3', 'notificado_4', 'anulado',
] as const;

// En modo edición se puede corregir a cualquier estado del ciclo de vida,
// incluidos los que no tiene sentido elegir al crear (activo/alta/pausa
// porque son posteriores, finalizado porque es automático).
const ALL_STATUS_OPTIONS = Object.keys(PATIENT_STATUS_LABELS);

// Píldora de "obligatorio" junto al label — más visible que un asterisco suelto.
function RequiredBadge() {
  return (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-rose-50 px-1.5 py-px align-middle text-[9px] font-bold uppercase tracking-wide text-rose-500">
      Requerido
    </span>
  );
}

const DOCUMENT_TYPE_OPTIONS = ['CC', 'TI', 'PEP', 'PA', 'CE'];
const ESTRATO_OPTIONS = [1, 2, 3, 4, 5, 6];
// Mismo catálogo que usa Valoración Individual (InitialAssessmentWizard) para
// el contacto de emergencia — se mantiene igual para no confundir con dos
// listas distintas de parentesco en la misma app.
const PARENTESCO_OPTIONS = ['Madre', 'Padre', 'Hermano/a', 'Cónyuge / Pareja', 'Hijo/a', 'Abuelo/a', 'Tutor legal', 'Otro'];
// Relación del paciente con el convenio que lo cubre — debe coincidir
// exactamente con PATIENT_RELACION_VALUES en patient.controller.js.
const RELACION_OPTIONS = ['Estudiante', 'Colaborador', 'Familiar de colaborador', 'Familiar de estudiante', 'Consultante'];
// Debe coincidir exactamente con PATIENT_TIPO_ATENCION_VALUES en patient.controller.js.
const TIPO_ATENCION_OPTIONS: { value: string; label: string }[] = [
  { value: 'Presencial', label: 'Presencial' },
  { value: 'Telepsicologia', label: 'Telepsicología' },
];

// Filtrado en vivo — mismas reglas que valida el backend (validateName/
// validateDocumentId/validatePhone en patient.controller.js), para que el
// error aparezca al escribir en vez de recién al enviar el formulario.
function onlyLetters(value: string): string {
  return value.replace(/[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ\s-]/g, '');
}
function onlyDigits(value: string, maxLen: number): string {
  return value.replace(/\D/g, '').slice(0, maxLen);
}

export default function CreatePatientModal({ isOpen, onClose, patient, onCreated, onUpdated, userRole }: CreatePatientModalProps) {
  const isEditMode = !!patient;
  // Cupo inicial de sesiones — solo tiene sentido al CREAR (en edición, el
  // cupo se gestiona aparte vía "Autorizar sesiones", nunca desde este
  // formulario general — ver comentario en updatePatient). Mismo gate de rol
  // que exige el backend en authorizeSessions.
  const canAuthorizeSessions = userRole === 'CEO' || userRole === 'DIRECTIVO';
  const [initialSessions, setInitialSessions] = useState('');
  const [initialSessionsLibres, setInitialSessionsLibres] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [documentType, setDocumentType] = useState('CC');
  const [documentId, setDocumentId] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [estrato, setEstrato] = useState('');
  const [status, setStatus] = useState<string>(INITIAL_CONTACT_STATUS_OPTIONS[0]);
  const [emergencyContactNombres, setEmergencyContactNombres] = useState('');
  const [emergencyContactApellidos, setEmergencyContactApellidos] = useState('');
  const [emergencyContactTelefono, setEmergencyContactTelefono] = useState('');
  const [emergencyContactParentesco, setEmergencyContactParentesco] = useState('');
  const [companyId, setCompanyId] = useState('');
  const { companies, loading: loadingCompanies } = useCompanies();
  const [psychologistId, setPsychologistId] = useState('');
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [loadingSpecialists, setLoadingSpecialists] = useState(false);
  const [agreementType, setAgreementType] = useState('');
  const [agreementTypes, setAgreementTypes] = useState<AgreementTypeOption[]>([]);
  const [relacion, setRelacion] = useState('');
  const [tipoAtencion, setTipoAtencion] = useState('');
  const [fechaSolicitud, setFechaSolicitud] = useState('');
  const [fechaAgendamiento, setFechaAgendamiento] = useState('');
  const [fechaFinalizacion, setFechaFinalizacion] = useState('');
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  const [loadingSessionStats, setLoadingSessionStats] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicatePatient, setDuplicatePatient] = useState<DuplicatePatientInfo | null>(null);
  const [reactivating, setReactivating] = useState(false);
  // Modo edición: el contacto de emergencia se lee/edita aparte (vive en
  // InitialAssessment). Si esa valoración ya está SIGNED, queda bloqueado.
  const [emergencyContactLocked, setEmergencyContactLocked] = useState(false);
  const [loadingEmergencyContact, setLoadingEmergencyContact] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingSpecialists(true);
    apiFetch('/api/users/specialists')
      .then(res => res.ok ? res.json() : [])
      .then(data => setSpecialists(Array.isArray(data?.specialists) ? data.specialists : Array.isArray(data) ? data : []))
      .catch(() => setSpecialists([]))
      .finally(() => setLoadingSpecialists(false));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    apiFetch('/api/agreement-types')
      .then(res => res.ok ? res.json() : [])
      .then(data => setAgreementTypes(Array.isArray(data) ? data : []))
      .catch(() => setAgreementTypes([]));
  }, [isOpen]);

  // Precarga los campos del paciente al abrir en modo edición. En modo
  // creación, fechaSolicitud arranca en "hoy" (editable) — es el default que
  // igual aplicaría el backend si se enviara vacía, pero mostrarla ya
  // rellenada dejar claro de una vez cuál va a quedar.
  useEffect(() => {
    if (!isOpen) return;
    if (!patient) {
      setFechaSolicitud(new Date().toISOString().slice(0, 10));
      return;
    }
    setFirstName(patient.firstName || '');
    setLastName(patient.lastName || '');
    setDocumentType(patient.documentType || 'CC');
    setDocumentId(patient.documentId || '');
    setBirthDate(patient.birthDate ? patient.birthDate.slice(0, 10) : '');
    setEmail(patient.email || '');
    setPhone(patient.phone || '');
    setEstrato(patient.estrato != null ? String(patient.estrato) : '');
    setStatus(patient.status || 'activo');
    setCompanyId(patient.companyId || '');
    setPsychologistId(patient.psychologist?.id || '');
    setAgreementType(patient.agreementType || '');
    setRelacion(patient.relacion || '');
    setTipoAtencion(patient.tipoAtencion || '');
    setFechaSolicitud(patient.fechaSolicitud ? patient.fechaSolicitud.slice(0, 10) : '');
    setFechaAgendamiento(patient.fechaAgendamiento ? patient.fechaAgendamiento.slice(0, 10) : '');
    setFechaFinalizacion(patient.fechaFinalizacion ? patient.fechaFinalizacion.slice(0, 10) : '');
    setError(null);
    setDuplicatePatient(null);
  }, [isOpen, patient]);

  // Seguimiento de sesiones — solo en modo edición (un paciente nuevo no
  // tiene agendamientos todavía). Mismo endpoint que usa el modal de
  // agendamiento para el cupo vigente; aquí se reutiliza para mostrar los
  // conteos por estado, de solo lectura.
  useEffect(() => {
    if (!isOpen || !patient) {
      setSessionStats(null);
      return;
    }
    setLoadingSessionStats(true);
    apiFetch(`/api/patients/${patient.id}/schedule-summary`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data) { setSessionStats(null); return; }
        const appointments: { status: string }[] = Array.isArray(data.appointments) ? data.appointments : [];
        setSessionStats({
          aprobadas: data.activeAuthorization?.sessionsAuthorized ?? null,
          cumplidas: appointments.filter(a => a.status === 'Atendida').length,
          reprogramadas: appointments.filter(a => a.status === 'Reprogramada').length,
          canceladas: appointments.filter(a => a.status === 'Cancelada').length,
          pendientes: appointments.filter(a => a.status === 'Pendiente' || a.status === 'Confirmada').length,
        });
      })
      .catch(() => setSessionStats(null))
      .finally(() => setLoadingSessionStats(false));
  }, [isOpen, patient]);

  // Contacto de emergencia — se lee aparte porque vive en InitialAssessment,
  // no en Patient. Si la valoración ya fue firmada, los campos se muestran
  // pero bloqueados (misma regla que el resto de la valoración).
  useEffect(() => {
    if (!isOpen || !patient) {
      setEmergencyContactLocked(false);
      return;
    }
    setLoadingEmergencyContact(true);
    apiFetch(`/api/initial-assessment/${patient.id}`)
      .then(res => res.ok ? res.json() : { assessment: null })
      .then(data => {
        const a = data?.assessment;
        setEmergencyContactNombres(a?.contactoEmergenciaNombres || '');
        setEmergencyContactApellidos(a?.contactoEmergenciaApellidos || '');
        setEmergencyContactTelefono(a?.contactoEmergenciaTelefono || '');
        setEmergencyContactParentesco(a?.contactoEmergenciaParentesco || '');
        setEmergencyContactLocked(a?.status === 'SIGNED');
      })
      .catch(() => {
        setEmergencyContactNombres('');
        setEmergencyContactApellidos('');
        setEmergencyContactTelefono('');
        setEmergencyContactParentesco('');
        setEmergencyContactLocked(false);
      })
      .finally(() => setLoadingEmergencyContact(false));
  }, [isOpen, patient]);

  function reset() {
    setFirstName('');
    setLastName('');
    setDocumentType('CC');
    setDocumentId('');
    setBirthDate('');
    setEmail('');
    setPhone('');
    setEstrato('');
    setStatus(INITIAL_CONTACT_STATUS_OPTIONS[0]);
    setEmergencyContactNombres('');
    setEmergencyContactApellidos('');
    setEmergencyContactTelefono('');
    setEmergencyContactParentesco('');
    setEmergencyContactLocked(false);
    setCompanyId('');
    setPsychologistId('');
    setAgreementType('');
    setRelacion('');
    setTipoAtencion('');
    setFechaSolicitud('');
    setFechaAgendamiento('');
    setFechaFinalizacion('');
    setSessionStats(null);
    setInitialSessions('');
    setInitialSessionsLibres(false);
    setError(null);
    setDuplicatePatient(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !documentId.trim()) {
      setError('Nombre, apellido y documento son obligatorios.');
      return;
    }
    if (documentId.trim().length < 1 || documentId.trim().length > 10) {
      setError('El documento debe tener máximo 10 dígitos.');
      return;
    }
    if (phone.trim() && phone.trim().length !== 10) {
      setError('El teléfono debe tener exactamente 10 dígitos.');
      return;
    }
    if (emergencyContactTelefono.trim() && emergencyContactTelefono.trim().length !== 10) {
      setError('El teléfono de contacto de emergencia debe tener exactamente 10 dígitos.');
      return;
    }
    if (!isEditMode && canAuthorizeSessions && !initialSessionsLibres && initialSessions.trim()) {
      const n = Number(initialSessions.trim());
      if (!Number.isInteger(n) || n <= 0) {
        setError('Las sesiones aprobadas deben ser un número entero mayor a 0.');
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    setDuplicatePatient(null);
    try {
      const selectedCompany = companies.find(c => c.id === companyId);

      if (isEditMode && patient) {
        const res = await apiFetch(`/api/patients/${patient.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            documentType: documentType || undefined,
            documentId: documentId.trim(),
            birthDate: birthDate || null,
            email: email.trim() || undefined,
            phone: phone.trim() || undefined,
            estrato: estrato || null,
            status,
            companyId: companyId || null,
            corporateClient: selectedCompany?.name || 'Particular',
            psychologistId: psychologistId || null,
            agreementType: agreementType || null,
            relacion: relacion || null,
            tipoAtencion: tipoAtencion || null,
            fechaSolicitud: fechaSolicitud || null,
            fechaAgendamiento: fechaAgendamiento || null,
            fechaFinalizacion: fechaFinalizacion || null,
          }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }
        const updated = await res.json();

        // Contacto de emergencia — best-effort aparte, no bloquea el guardado
        // del paciente si falla (ej. alguien la firmó justo en este instante).
        if (!emergencyContactLocked) {
          const contactRes = await apiFetch(`/api/initial-assessment/${patient.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              contactoEmergenciaNombres: emergencyContactNombres.trim() || undefined,
              contactoEmergenciaApellidos: emergencyContactApellidos.trim() || undefined,
              contactoEmergenciaTelefono: emergencyContactTelefono.trim() || undefined,
              contactoEmergenciaParentesco: emergencyContactParentesco || undefined,
            }),
          }).catch(() => null);
          if (!contactRes?.ok) {
            console.warn('[CreatePatientModal] No se pudo guardar el contacto de emergencia.');
          }
        }

        onUpdated?.(updated);
        onClose();
        return;
      }

      const res = await apiFetch('/api/patients', {
        method: 'POST',
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          documentType: documentType || undefined,
          documentId: documentId.trim(),
          birthDate: birthDate || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          estrato: estrato || undefined,
          status,
          emergencyContactNombres: emergencyContactNombres.trim() || undefined,
          emergencyContactApellidos: emergencyContactApellidos.trim() || undefined,
          emergencyContactTelefono: emergencyContactTelefono.trim() || undefined,
          emergencyContactParentesco: emergencyContactParentesco || undefined,
          companyId: companyId || undefined,
          corporateClient: selectedCompany?.name || 'Particular',
          psychologistId: psychologistId || undefined,
          agreementType: agreementType || undefined,
          relacion: relacion || undefined,
          tipoAtencion: tipoAtencion || undefined,
          fechaSolicitud: fechaSolicitud || undefined,
          fechaAgendamiento: fechaAgendamiento || undefined,
          fechaFinalizacion: fechaFinalizacion || undefined,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        // Un paciente que ya existió (p. ej. dado de alta hace años y vuelve)
        // no debe duplicarse — su historia clínica sigue enlazada al registro
        // original. En vez de un error genérico, se ofrece reactivarlo.
        if (errBody.code === 'DUPLICATE_DOCUMENT' && errBody.existingPatient) {
          setDuplicatePatient(errBody.existingPatient);
          return;
        }
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const created = await res.json();

      // Cupo inicial de sesiones — best-effort aparte, no bloquea la
      // creación del paciente si falla (mismo criterio que el contacto de
      // emergencia en modo edición). Usa el companyId REALMENTE resuelto por
      // el backend (created.companyId), no el que se envió — createPatient
      // cae al convenio por defecto del tenant si no se elige ninguno, y ese
      // es el convenio real contra el que debe quedar la autorización.
      if (canAuthorizeSessions && (initialSessionsLibres || initialSessions.trim())) {
        const authRes = await apiFetch(`/api/patients/${created.id}/authorize-sessions`, {
          method: 'POST',
          body: JSON.stringify({
            companyId: created.companyId,
            unlimited: initialSessionsLibres,
            sessionsAuthorized: initialSessionsLibres ? undefined : Number(initialSessions.trim()),
          }),
        }).catch(() => null);
        if (!authRes?.ok) {
          console.warn('[CreatePatientModal] No se pudo autorizar el cupo inicial de sesiones.');
        }
      }

      onCreated?.(created);
      reset();
      onClose();
    } catch (err: any) {
      setError(err.message || (isEditMode ? 'Error al actualizar el paciente.' : 'Error al crear el paciente.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReactivate() {
    if (!duplicatePatient) return;
    setReactivating(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/patients/${duplicatePatient.id}/reactivate`, { method: 'POST' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      const reactivated = await res.json();
      onCreated?.(reactivated, true);
      reset();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al reactivar el paciente.');
    } finally {
      setReactivating(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs sm:p-6">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-charcoal-900">
              {isEditMode ? 'Editar paciente' : 'Crear nuevo paciente'}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {isEditMode
                ? `Actualiza los datos de ${patient?.firstName} ${patient?.lastName}.`
                : 'Registre los datos básicos para abrir la ficha del paciente.'}
            </p>
          </div>
          <button
            onClick={handleClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-charcoal-900 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          <div>
          <SectionHeader icon={User} title="Datos personales" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="patient-firstName" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Nombres<RequiredBadge />
              </label>
              <input
                id="patient-firstName"
                name="patient-firstName"
                autoComplete="off"
                value={firstName}
                onChange={(e) => setFirstName(onlyLetters(e.target.value))}
                placeholder="Ej. Juan"
                autoFocus
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
              />
            </div>
            <div>
              <label htmlFor="patient-lastName" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Apellidos<RequiredBadge />
              </label>
              <input
                id="patient-lastName"
                name="patient-lastName"
                autoComplete="off"
                value={lastName}
                onChange={(e) => setLastName(onlyLetters(e.target.value))}
                placeholder="Ej. Pérez"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Documento<RequiredBadge />
              </label>
              <div className="flex gap-2">
                <select
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                  className="w-20 shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                >
                  {DOCUMENT_TYPE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
                <input
                  value={documentId}
                  onChange={(e) => { setDocumentId(onlyDigits(e.target.value, 10)); setDuplicatePatient(null); }}
                  placeholder="Ej. 1024556778"
                  inputMode="numeric"
                  maxLength={10}
                  className="w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha de nacimiento</label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
              />
            </div>
            <div>
              <label htmlFor="patient-phone" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Teléfono</label>
              <input
                id="patient-phone"
                name="patient-phone"
                autoComplete="off"
                value={phone}
                onChange={(e) => setPhone(onlyDigits(e.target.value, 10))}
                placeholder="Ej. 3132220587"
                inputMode="numeric"
                maxLength={10}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Estrato</label>
              <select
                value={estrato}
                onChange={(e) => setEstrato(e.target.value)}
                className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
              >
                <option value="">Sin especificar</option>
                {ESTRATO_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {isEditMode ? 'Estado' : <>Estado de contacto<RequiredBadge /></>}
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
              >
                {(isEditMode ? ALL_STATUS_OPTIONS : INITIAL_CONTACT_STATUS_OPTIONS).map((s) => (
                  <option key={s} value={s}>{PATIENT_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Correo electrónico</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="juan@correo.com"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
            />
          </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <SectionHeader icon={Building2} title="Convenio y atención" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Convenio / Cliente corporativo</label>
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  disabled={loadingCompanies}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                >
                  <option value="">Particular (sin convenio)</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tipo de convenio</label>
                <select
                  value={agreementType}
                  onChange={(e) => setAgreementType(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                >
                  <option value="">Sin especificar</option>
                  {agreementTypes.map((t) => (
                    <option key={t.id} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Relación</label>
                <select
                  value={relacion}
                  onChange={(e) => setRelacion(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                >
                  <option value="">Sin especificar</option>
                  {RELACION_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tipo de atención</label>
                <select
                  value={tipoAtencion}
                  onChange={(e) => setTipoAtencion(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                >
                  <option value="">Sin especificar</option>
                  {TIPO_ATENCION_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Psicólogo asignado
                </label>
                <select
                  value={psychologistId}
                  onChange={(e) => setPsychologistId(e.target.value)}
                  disabled={loadingSpecialists}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                >
                  <option value="">Sin asignar (se define después)</option>
                  {specialists.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10.5px] text-slate-400">Opcional — si no lo eliges ahora, se asignará automáticamente al agendar la primera cita.</p>
              </div>
              {!isEditMode && canAuthorizeSessions && (
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Sesiones aprobadas
                  </label>
                  <div className="flex items-center gap-2">
                    {initialSessionsLibres ? (
                      <div className="flex-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700">
                        Libres (sin tope)
                      </div>
                    ) : (
                      <input
                        type="number"
                        min={1}
                        value={initialSessions}
                        onChange={(e) => setInitialSessions(e.target.value)}
                        placeholder="Ej. 8"
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                      />
                    )}
                    <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-slate-500">
                      <input
                        type="checkbox"
                        checked={initialSessionsLibres}
                        onChange={(e) => { setInitialSessionsLibres(e.target.checked); if (e.target.checked) setInitialSessions(''); }}
                      />
                      Sin tope
                    </label>
                  </div>
                  <p className="mt-1 text-[10.5px] text-slate-400">
                    Opcional — abre el cupo inicial de sesiones con el convenio elegido arriba. Si lo dejas vacío, se autoriza después desde el agendamiento.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <SectionHeader icon={CalendarClock} title="Fechas del proceso" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha de solicitud</label>
                <input
                  type="date"
                  value={fechaSolicitud}
                  onChange={(e) => setFechaSolicitud(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha de agendamiento</label>
                <input
                  type="date"
                  value={fechaAgendamiento}
                  onChange={(e) => setFechaAgendamiento(e.target.value)}
                  placeholder="Se completa al agendar"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                />
                <p className="mt-1 text-[10.5px] text-slate-400">Se completa sola con la primera cita agendada.</p>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha de finalización</label>
                <input
                  type="date"
                  value={fechaFinalizacion}
                  onChange={(e) => setFechaFinalizacion(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                />
                <p className="mt-1 text-[10.5px] text-slate-400">Se completa sola al cerrar el proceso.</p>
              </div>
            </div>
          </div>

          {isEditMode && (sessionStats || loadingSessionStats) && (
            <div className="border-t border-slate-100 pt-4">
              <div className="mb-3 flex items-center gap-2">
                <SectionHeader icon={BarChart3} title="Seguimiento de sesiones" />
                {loadingSessionStats && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                <SessionStatCard label="Aprobadas" value={sessionStats?.aprobadas ?? null} tone="neutral" />
                <SessionStatCard label="Cumplidas" value={sessionStats?.cumplidas ?? 0} tone="success" />
                <SessionStatCard label="Reprogramadas" value={sessionStats?.reprogramadas ?? 0} tone="warning" />
                <SessionStatCard label="Canceladas" value={sessionStats?.canceladas ?? 0} tone="danger" />
                <SessionStatCard label="Pendientes" value={sessionStats?.pendientes ?? 0} tone="neutral" />
              </div>
            </div>
          )}

          <div className="border-t border-slate-100 pt-4">
            <SectionHeader icon={HeartPulse} title={`Contacto de emergencia ${!isEditMode ? '(opcional)' : ''}`} />
            <div className="mb-3 flex items-center gap-2">
              {isEditMode && loadingEmergencyContact && (
                <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
              )}
              {isEditMode && emergencyContactLocked && (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-slate-500">
                  Bloqueado
                </span>
              )}
            </div>
            {isEditMode && emergencyContactLocked && (
              <p className="mb-3 text-xs text-slate-400">
                La Valoración Individual de este paciente ya fue firmada — el contacto de emergencia no se puede editar aquí. Corrígelo desde una nueva valoración.
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ec-nombres" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nombres</label>
                <input
                  id="ec-nombres"
                  name="ec-nombres"
                  autoComplete="off"
                  value={emergencyContactNombres}
                  onChange={(e) => setEmergencyContactNombres(onlyLetters(e.target.value))}
                  placeholder="Ej. María"
                  disabled={emergencyContactLocked}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div>
                <label htmlFor="ec-apellidos" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Apellidos</label>
                <input
                  id="ec-apellidos"
                  name="ec-apellidos"
                  autoComplete="off"
                  value={emergencyContactApellidos}
                  onChange={(e) => setEmergencyContactApellidos(onlyLetters(e.target.value))}
                  placeholder="Ej. Pérez"
                  disabled={emergencyContactLocked}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div>
                <label htmlFor="ec-telefono" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Teléfono</label>
                <input
                  id="ec-telefono"
                  name="ec-telefono"
                  autoComplete="off"
                  value={emergencyContactTelefono}
                  onChange={(e) => setEmergencyContactTelefono(onlyDigits(e.target.value, 10))}
                  placeholder="Ej. 3132220587"
                  inputMode="numeric"
                  maxLength={10}
                  disabled={emergencyContactLocked}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div>
                <label htmlFor="ec-parentesco" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Parentesco</label>
                <select
                  id="ec-parentesco"
                  name="ec-parentesco"
                  value={emergencyContactParentesco}
                  onChange={(e) => setEmergencyContactParentesco(e.target.value)}
                  disabled={emergencyContactLocked}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">Selecciona</option>
                  {PARENTESCO_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </div>

          {duplicatePatient && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              <p className="font-semibold">
                Ya existe un paciente con este documento: {duplicatePatient.firstName} {duplicatePatient.lastName}
              </p>
              <p className="mt-0.5 text-xs text-amber-700">
                Estado actual: {PATIENT_STATUS_LABELS[duplicatePatient.status] || duplicatePatient.status}
                {duplicatePatient.recordNumber ? ` · ${duplicatePatient.recordNumber}` : ''}
              </p>
              <p className="mt-1.5 text-xs text-amber-700">
                Su historia clínica sigue intacta — no se crea un paciente nuevo. Si es la misma persona que vuelve, reactívalo en vez de duplicarlo.
              </p>
              <button
                type="button"
                onClick={handleReactivate}
                disabled={reactivating}
                className="mt-2.5 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
              >
                {reactivating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                {reactivating ? 'Reactivando...' : 'Reactivar paciente existente'}
              </button>
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>
          )}
        </div>

          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-500 transition-colors hover:text-charcoal-900 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isEditMode ? <Save className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {submitting ? 'Guardando...' : isEditMode ? 'Guardar cambios' : 'Guardar paciente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
