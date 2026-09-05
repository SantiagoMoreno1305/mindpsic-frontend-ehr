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
 * Organizado en pestañas (no un solo formulario largo con scroll infinito):
 * Datos personales, Salud y residencia, Convenio y atención, Fechas y
 * seguimiento, Contacto de emergencia. Los campos de "Datos personales" y
 * "Salud y residencia" son los MISMOS que antes solo se pedían en la
 * Valoración Individual (paso 1 y parte del paso 2) — ahora se capturan aquí,
 * en Patient, y la Valoración los trae precargados (ver getAssessment →
 * patientDefaults) para que el psicólogo no los vuelva a teclear.
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
 *   GET  /api/eps?q=                 → Catálogo de EPS (búsqueda por código/nombre)
 *   POST /api/patients               → Creación del paciente
 *   PUT  /api/patients/:id           → Actualización del paciente (modo edición)
 *   GET  /api/initial-assessment/:id → Contacto de emergencia actual (modo edición)
 *   PUT  /api/initial-assessment/:id → Actualización del contacto de emergencia (modo edición)
 */
import { useState, useEffect } from 'react';
import {
  X, UserPlus, Save, Loader2, User, Building2, HeartPulse, CalendarClock, BarChart3,
  Stethoscope, MapPin, Check,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useCompanies } from '../../hooks/useCompanies';
import { COLOMBIA_DEPARTAMENTOS, DEPARTAMENTOS_ORDENADOS } from '../../data/colombiaData';
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

interface SpecialistOption {
  id: string;
  name: string;
}

interface EpsOption {
  code: string;
  nombre: string;
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
// Mismos catálogos que usa el paso 1/2 de Valoración Individual
// (InitialAssessmentWizard) — se repiten aquí a propósito (no exportados de
// allá) para que ambos formularios queden alineados sin acoplar los archivos.
const REGIMEN_OPTIONS = ['Contributivo', 'Subsidiado', 'Especial — Fuerzas Militares, Policía Nacional, entre otros', 'Excepcional — PPL, entre otros'];
const ESTADO_CIVIL_OPTIONS = ['Soltero/a', 'Casado/a', 'Unión libre', 'Viudo/a', 'Divorciado/a'];
const SEXO_OPTIONS = ['Hombre', 'Mujer', 'Intersexual'];
const GENERO_OPTIONS = ['Masculino', 'Femenino', 'Intersexual'];

// Filtrado en vivo — mismas reglas que valida el backend (validateName/
// validateDocumentId/validatePhone en patient.controller.js), para que el
// error aparezca al escribir en vez de recién al enviar el formulario.
function onlyLetters(value: string): string {
  return value.replace(/[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ\s-]/g, '');
}
function onlyDigits(value: string, maxLen: number): string {
  return value.replace(/\D/g, '').slice(0, maxLen);
}

function calculateAge(birthDate: string): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (isNaN(b.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age >= 0 ? age : null;
}

// ── UI genérica reutilizada en varias pestañas ──────────────────────────────
function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      {children}{required && <RequiredBadge />}
    </label>
  );
}

const INPUT_CLASS = 'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20';
const SELECT_CLASS = 'w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20';

// Buscador de EPS por código o nombre — mismo patrón que EpsSelect en
// InitialAssessmentWizard, adaptado a apiFetch (wrapper que ya usa el resto
// de este archivo) en vez de fetch+authHeaders crudo.
function EpsPicker({ codigo, nombre, onChange }: { codigo: string; nombre: string; onChange: (codigo: string, nombre: string) => void }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<EpsOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) { setOptions([]); return; }
    const timer = setTimeout(() => {
      apiFetch(`/api/eps?q=${encodeURIComponent(query.trim())}`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => setOptions(Array.isArray(data) ? data : []))
        .catch(() => setOptions([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  if (codigo && nombre && !open) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm">
        <span><span className="font-mono font-semibold text-charcoal-900">{codigo}</span> — {nombre}</span>
        <button type="button" onClick={() => { setOpen(true); setQuery(''); }} className="shrink-0 text-xs font-semibold text-toast-500 hover:underline cursor-pointer">
          Cambiar
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Buscar por código o nombre de EPS…"
        className={INPUT_CLASS}
      />
      {open && options.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.code}
              type="button"
              onMouseDown={() => { onChange(opt.code, opt.nombre); setOpen(false); setQuery(''); }}
              className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-toast-50"
            >
              <span className="font-mono font-semibold text-charcoal-900">{opt.code}</span> — {opt.nombre}
            </button>
          ))}
        </div>
      )}
      {open && query.trim().length >= 2 && options.length === 0 && (
        <p className="mt-1 text-[10.5px] text-slate-400">Sin resultados en el catálogo.</p>
      )}
    </div>
  );
}

type TabKey = 'personal' | 'salud' | 'convenio' | 'fechas' | 'emergencia';

export default function CreatePatientModal({ isOpen, onClose, patient, onCreated, onUpdated, userRole }: CreatePatientModalProps) {
  const isEditMode = !!patient;
  const [activeTab, setActiveTab] = useState<TabKey>('personal');

  // Cupo inicial de sesiones — solo tiene sentido al CREAR (en edición, el
  // cupo se gestiona aparte vía "Autorizar sesiones", nunca desde este
  // formulario general — ver comentario en updatePatient). Mismo gate de rol
  // que exige el backend en authorizeSessions.
  const canAuthorizeSessions = userRole === 'CEO' || userRole === 'DIRECTIVO';
  const [initialSessions, setInitialSessions] = useState('');
  const [initialSessionsLibres, setInitialSessionsLibres] = useState(false);

  // ── Datos personales ──
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [documentType, setDocumentType] = useState('CC');
  const [documentId, setDocumentId] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [sexoBiologico, setSexoBiologico] = useState('');
  const [genero, setGenero] = useState('');
  const [estadoCivil, setEstadoCivil] = useState('');
  const [departamentoNacimiento, setDepartamentoNacimiento] = useState('');
  const [ciudadNacimiento, setCiudadNacimiento] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<string>(INITIAL_CONTACT_STATUS_OPTIONS[0]);

  // ── Salud y residencia ──
  const [epsCodigo, setEpsCodigo] = useState('');
  const [epsNombre, setEpsNombre] = useState('');
  const [regimenSalud, setRegimenSalud] = useState('');
  const [direccionResidencia, setDireccionResidencia] = useState('');
  const [departamentoResidencia, setDepartamentoResidencia] = useState('');
  const [ciudadResidencia, setCiudadResidencia] = useState('');
  const [barrio, setBarrio] = useState('');
  const [estrato, setEstrato] = useState('');

  // ── Contacto de emergencia ──
  const [emergencyContactNombres, setEmergencyContactNombres] = useState('');
  const [emergencyContactApellidos, setEmergencyContactApellidos] = useState('');
  const [emergencyContactTelefono, setEmergencyContactTelefono] = useState('');
  const [emergencyContactParentesco, setEmergencyContactParentesco] = useState('');
  // Modo edición: el contacto de emergencia se lee/edita aparte (vive en
  // InitialAssessment). Si esa valoración ya está SIGNED, queda bloqueado.
  const [emergencyContactLocked, setEmergencyContactLocked] = useState(false);
  const [loadingEmergencyContact, setLoadingEmergencyContact] = useState(false);

  // ── Representante legal (menores de edad, tutelados, etc.) — mismo campo
  // que el paso 3 de la Valoración Individual (legalRep1*), capturable ya
  // desde este modal para no repetir la pregunta al psicólogo. Solo se
  // captura el representante PRINCIPAL aquí — un segundo representante (poco
  // frecuente) se sigue agregando desde la propia Valoración.
  const [requiereRepresentanteLegal, setRequiereRepresentanteLegal] = useState(false);
  // Toggle de UX, no se manda tal cual al backend — si está activo, al
  // guardar se copian los datos del contacto de emergencia de arriba en los
  // campos legalRep1* (salvo el correo, que es exclusivo del representante).
  const [legalRepSameAsEmergency, setLegalRepSameAsEmergency] = useState(true);
  const [legalRep1Nombres, setLegalRep1Nombres] = useState('');
  const [legalRep1Apellidos, setLegalRep1Apellidos] = useState('');
  const [legalRep1Telefono, setLegalRep1Telefono] = useState('');
  const [legalRep1Parentesco, setLegalRep1Parentesco] = useState('');
  const [legalRep1Correo, setLegalRep1Correo] = useState('');

  // ── Convenio y atención ──
  const [companyId, setCompanyId] = useState('');
  const { companies, loading: loadingCompanies } = useCompanies();
  const [psychologistId, setPsychologistId] = useState('');
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [loadingSpecialists, setLoadingSpecialists] = useState(false);
  const [agreementType, setAgreementType] = useState('');
  const [agreementTypes, setAgreementTypes] = useState<AgreementTypeOption[]>([]);
  const [relacion, setRelacion] = useState('');
  const [tipoAtencion, setTipoAtencion] = useState('');

  // ── Fechas del proceso ──
  const [fechaSolicitud, setFechaSolicitud] = useState('');
  const [fechaAgendamiento, setFechaAgendamiento] = useState('');
  const [fechaFinalizacion, setFechaFinalizacion] = useState('');
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  const [loadingSessionStats, setLoadingSessionStats] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicatePatient, setDuplicatePatient] = useState<DuplicatePatientInfo | null>(null);
  const [reactivating, setReactivating] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingSpecialists(true);
    apiFetch('/api/users/specialists')
      .then(res => res.ok ? res.json() : [])
      .then(data => setSpecialists(Array.isArray(data?.specialists) ? data.specialists : Array.isArray(data) ? data : []))
      .catch(() => setSpecialists([]))
      .finally(() => setLoadingSpecialists(false));
  }, [isOpen]);

  // Propio de CADA convenio (companyId) — no un catálogo compartido de todo
  // el tenant, ver comentario en schema.prisma. Se recarga cada vez que
  // cambia el convenio elegido arriba.
  useEffect(() => {
    if (!isOpen || !companyId) { setAgreementTypes([]); return; }
    apiFetch(`/api/agreement-types?companyId=${companyId}`)
      .then(res => res.ok ? res.json() : [])
      .then(data => setAgreementTypes(Array.isArray(data) ? data : []))
      .catch(() => setAgreementTypes([]));
  }, [isOpen, companyId]);

  // Precarga los campos del paciente al abrir en modo edición. En modo
  // creación, fechaSolicitud arranca en "hoy" (editable) — es el default que
  // igual aplicaría el backend si se enviara vacía, pero mostrarla ya
  // rellenada deja claro de una vez cuál va a quedar.
  useEffect(() => {
    if (!isOpen) return;
    setActiveTab('personal');
    if (!patient) {
      setFechaSolicitud(new Date().toISOString().slice(0, 10));
      return;
    }
    setFirstName(patient.firstName || '');
    setLastName(patient.lastName || '');
    setDocumentType(patient.documentType || 'CC');
    setDocumentId(patient.documentId || '');
    setBirthDate(patient.birthDate ? patient.birthDate.slice(0, 10) : '');
    setSexoBiologico(patient.sexoBiologico || '');
    setGenero(patient.gender || '');
    setEstadoCivil(patient.estadoCivil || '');
    setDepartamentoNacimiento(patient.departamentoNacimiento || '');
    setCiudadNacimiento(patient.ciudadNacimiento || '');
    setEmail(patient.email || '');
    setPhone(patient.phone || '');
    setStatus(patient.status || 'activo');
    setEpsCodigo(patient.epsCodigo || '');
    setEpsNombre(patient.epsNombre || '');
    setRegimenSalud(patient.regimenSalud || '');
    setDireccionResidencia(patient.direccionResidencia || '');
    setDepartamentoResidencia(patient.departamentoResidencia || '');
    setCiudadResidencia(patient.ciudadResidencia || '');
    setBarrio(patient.barrio || '');
    setEstrato(patient.estrato != null ? String(patient.estrato) : '');
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
        setRequiereRepresentanteLegal(!!a?.requiereRepresentanteLegal);
        setLegalRep1Nombres(a?.legalRep1Nombres || '');
        setLegalRep1Apellidos(a?.legalRep1Apellidos || '');
        setLegalRep1Telefono(a?.legalRep1Telefono || '');
        setLegalRep1Parentesco(a?.legalRep1Parentesco || '');
        setLegalRep1Correo(a?.legalRep1Correo || '');
        // Heurística: si nombres/apellidos/teléfono del representante coinciden
        // con los del contacto de emergencia, asumimos que se guardaron como
        // "la misma persona" (no hay un flag dedicado en el schema para esto).
        setLegalRepSameAsEmergency(
          !!a?.legalRep1Nombres &&
          a.legalRep1Nombres === a?.contactoEmergenciaNombres &&
          a.legalRep1Apellidos === a?.contactoEmergenciaApellidos &&
          a.legalRep1Telefono === a?.contactoEmergenciaTelefono
        );
      })
      .catch(() => {
        setEmergencyContactNombres('');
        setEmergencyContactApellidos('');
        setEmergencyContactTelefono('');
        setEmergencyContactParentesco('');
        setEmergencyContactLocked(false);
        setRequiereRepresentanteLegal(false);
        setLegalRep1Nombres('');
        setLegalRep1Apellidos('');
        setLegalRep1Telefono('');
        setLegalRep1Parentesco('');
        setLegalRep1Correo('');
        setLegalRepSameAsEmergency(true);
      })
      .finally(() => setLoadingEmergencyContact(false));
  }, [isOpen, patient]);

  function reset() {
    setActiveTab('personal');
    setFirstName('');
    setLastName('');
    setDocumentType('CC');
    setDocumentId('');
    setBirthDate('');
    setSexoBiologico('');
    setGenero('');
    setEstadoCivil('');
    setDepartamentoNacimiento('');
    setCiudadNacimiento('');
    setEmail('');
    setPhone('');
    setStatus(INITIAL_CONTACT_STATUS_OPTIONS[0]);
    setEpsCodigo('');
    setEpsNombre('');
    setRegimenSalud('');
    setDireccionResidencia('');
    setDepartamentoResidencia('');
    setCiudadResidencia('');
    setBarrio('');
    setEstrato('');
    setEmergencyContactNombres('');
    setEmergencyContactApellidos('');
    setEmergencyContactTelefono('');
    setEmergencyContactParentesco('');
    setEmergencyContactLocked(false);
    setRequiereRepresentanteLegal(false);
    setLegalRepSameAsEmergency(true);
    setLegalRep1Nombres('');
    setLegalRep1Apellidos('');
    setLegalRep1Telefono('');
    setLegalRep1Parentesco('');
    setLegalRep1Correo('');
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
      setActiveTab('personal');
      setError('Nombre, apellido y documento son obligatorios.');
      return;
    }
    if (documentId.trim().length < 1 || documentId.trim().length > 10) {
      setActiveTab('personal');
      setError('El documento debe tener máximo 10 dígitos.');
      return;
    }
    if (phone.trim() && phone.trim().length !== 10) {
      setActiveTab('personal');
      setError('El teléfono debe tener exactamente 10 dígitos.');
      return;
    }
    if (emergencyContactTelefono.trim() && emergencyContactTelefono.trim().length !== 10) {
      setActiveTab('emergencia');
      setError('El teléfono de contacto de emergencia debe tener exactamente 10 dígitos.');
      return;
    }
    if (requiereRepresentanteLegal && !legalRepSameAsEmergency && legalRep1Telefono.trim() && legalRep1Telefono.trim().length !== 10) {
      setActiveTab('emergencia');
      setError('El teléfono del representante legal debe tener exactamente 10 dígitos.');
      return;
    }
    if (!isEditMode && canAuthorizeSessions && !initialSessionsLibres && initialSessions.trim()) {
      const n = Number(initialSessions.trim());
      if (!Number.isInteger(n) || n <= 0) {
        setActiveTab('convenio');
        setError('Las sesiones aprobadas deben ser un número entero mayor a 0.');
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    setDuplicatePatient(null);
    try {
      const selectedCompany = companies.find(c => c.id === companyId);
      // Si el representante legal es "la misma persona" del contacto de
      // emergencia, se reutilizan esos datos — el correo es el único campo
      // exclusivo del representante (el contacto de emergencia no tiene uno).
      const effectiveLegalRep = requiereRepresentanteLegal
        ? {
            nombres: legalRepSameAsEmergency ? emergencyContactNombres.trim() : legalRep1Nombres.trim(),
            apellidos: legalRepSameAsEmergency ? emergencyContactApellidos.trim() : legalRep1Apellidos.trim(),
            telefono: legalRepSameAsEmergency ? emergencyContactTelefono.trim() : legalRep1Telefono.trim(),
            parentesco: legalRepSameAsEmergency ? emergencyContactParentesco : legalRep1Parentesco,
            correo: legalRep1Correo.trim(),
          }
        : null;

      if (isEditMode && patient) {
        const res = await apiFetch(`/api/patients/${patient.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            documentType: documentType || undefined,
            documentId: documentId.trim(),
            birthDate: birthDate || null,
            gender: genero || null,
            sexoBiologico: sexoBiologico || null,
            estadoCivil: estadoCivil || null,
            departamentoNacimiento: departamentoNacimiento || null,
            ciudadNacimiento: ciudadNacimiento || null,
            email: email.trim() || undefined,
            phone: phone.trim() || undefined,
            epsCodigo: epsCodigo || null,
            regimenSalud: regimenSalud || null,
            direccionResidencia: direccionResidencia || null,
            departamentoResidencia: departamentoResidencia || null,
            ciudadResidencia: ciudadResidencia || null,
            barrio: barrio || null,
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
              requiereRepresentanteLegal,
              legalRep1Nombres: effectiveLegalRep?.nombres || null,
              legalRep1Apellidos: effectiveLegalRep?.apellidos || null,
              legalRep1Telefono: effectiveLegalRep?.telefono || null,
              legalRep1Parentesco: effectiveLegalRep?.parentesco || null,
              legalRep1Correo: effectiveLegalRep?.correo || null,
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
          gender: genero || undefined,
          sexoBiologico: sexoBiologico || undefined,
          estadoCivil: estadoCivil || undefined,
          departamentoNacimiento: departamentoNacimiento || undefined,
          ciudadNacimiento: ciudadNacimiento || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          epsCodigo: epsCodigo || undefined,
          regimenSalud: regimenSalud || undefined,
          direccionResidencia: direccionResidencia || undefined,
          departamentoResidencia: departamentoResidencia || undefined,
          ciudadResidencia: ciudadResidencia || undefined,
          barrio: barrio || undefined,
          estrato: estrato || undefined,
          status,
          emergencyContactNombres: emergencyContactNombres.trim() || undefined,
          emergencyContactApellidos: emergencyContactApellidos.trim() || undefined,
          emergencyContactTelefono: emergencyContactTelefono.trim() || undefined,
          emergencyContactParentesco: emergencyContactParentesco || undefined,
          requiereRepresentanteLegal: requiereRepresentanteLegal || undefined,
          legalRep1Nombres: effectiveLegalRep?.nombres || undefined,
          legalRep1Apellidos: effectiveLegalRep?.apellidos || undefined,
          legalRep1Telefono: effectiveLegalRep?.telefono || undefined,
          legalRep1Parentesco: effectiveLegalRep?.parentesco || undefined,
          legalRep1Correo: effectiveLegalRep?.correo || undefined,
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

  const age = calculateAge(birthDate);

  const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'personal', label: 'Datos personales', icon: User },
    { key: 'salud', label: 'Salud y residencia', icon: Stethoscope },
    { key: 'convenio', label: 'Convenio y atención', icon: Building2 },
    { key: 'fechas', label: 'Fechas y seguimiento', icon: CalendarClock },
    { key: 'emergencia', label: 'Contacto de emergencia', icon: HeartPulse },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs sm:p-6">
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-charcoal-900">
              {isEditMode ? 'Editar paciente' : 'Crear nuevo paciente'}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {isEditMode
                ? `Actualiza los datos de ${patient?.firstName} ${patient?.lastName}.`
                : 'Registre la ficha completa del paciente — estos datos se precargan luego en su Valoración Individual.'}
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

        {/* Pestañas tipo píldora — nada de un formulario largo con scroll infinito */}
        <div className="flex shrink-0 flex-wrap gap-2 border-b border-slate-100 px-6 py-3">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === key
                  ? 'bg-charcoal-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-500 hover:border-toast-300 hover:text-charcoal-900'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-[380px] flex-1 overflow-y-auto px-6 py-5">

            {/* ── Pestaña: Datos personales ───────────────────────────────── */}
            {activeTab === 'personal' && (
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
                    className={INPUT_CLASS}
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
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <FieldLabel required>Documento</FieldLabel>
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
                  <FieldLabel>Fecha de nacimiento</FieldLabel>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                      max={new Date().toISOString().slice(0, 10)}
                      className={`${INPUT_CLASS} flex-1`}
                    />
                    {age !== null && (
                      <span className="flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-500">
                        {age} años
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <FieldLabel>Sexo biológico</FieldLabel>
                  <select value={sexoBiologico} onChange={(e) => setSexoBiologico(e.target.value)} className={SELECT_CLASS}>
                    <option value="">Sin especificar</option>
                    {SEXO_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>Género</FieldLabel>
                  <select value={genero} onChange={(e) => setGenero(e.target.value)} className={SELECT_CLASS}>
                    <option value="">Sin especificar</option>
                    {GENERO_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>Estado civil</FieldLabel>
                  <select value={estadoCivil} onChange={(e) => setEstadoCivil(e.target.value)} className={SELECT_CLASS}>
                    <option value="">Sin especificar</option>
                    {ESTADO_CIVIL_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div />
                <div>
                  <FieldLabel>Lugar de nacimiento — Departamento</FieldLabel>
                  <select
                    value={departamentoNacimiento}
                    onChange={(e) => { setDepartamentoNacimiento(e.target.value); setCiudadNacimiento(''); }}
                    className={SELECT_CLASS}
                  >
                    <option value="">Sin especificar</option>
                    {DEPARTAMENTOS_ORDENADOS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>Lugar de nacimiento — Ciudad / Municipio</FieldLabel>
                  <select
                    value={ciudadNacimiento}
                    onChange={(e) => setCiudadNacimiento(e.target.value)}
                    disabled={!departamentoNacimiento}
                    className={`${SELECT_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <option value="">{departamentoNacimiento ? 'Sin especificar' : 'Seleccione primero el departamento'}</option>
                    {(departamentoNacimiento ? (COLOMBIA_DEPARTAMENTOS[departamentoNacimiento] ?? []) : []).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
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
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <FieldLabel>Correo electrónico</FieldLabel>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="juan@correo.com"
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {isEditMode ? 'Estado' : <>Estado de contacto<RequiredBadge /></>}
                  </label>
                  {isEditMode && userRole === 'ESPECIALISTA_B2B' ? (
                    <span
                      title="Cambiar el estado del paciente es una acción exclusiva del área administrativa."
                      className="flex min-h-[42px] w-full items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900"
                    >
                      {PATIENT_STATUS_LABELS[status] || status}
                    </span>
                  ) : (
                    <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${SELECT_CLASS} sm:max-w-xs`}>
                      {(isEditMode ? ALL_STATUS_OPTIONS : INITIAL_CONTACT_STATUS_OPTIONS).map((s) => (
                        <option key={s} value={s}>{PATIENT_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}

            {/* ── Pestaña: Salud y residencia ─────────────────────────────── */}
            {activeTab === 'salud' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <FieldLabel>Entidad prestadora de servicios de salud (EPS)</FieldLabel>
                  <EpsPicker codigo={epsCodigo} nombre={epsNombre} onChange={(c, n) => { setEpsCodigo(c); setEpsNombre(n); }} />
                </div>
                <div>
                  <FieldLabel>Régimen de salud</FieldLabel>
                  <select value={regimenSalud} onChange={(e) => setRegimenSalud(e.target.value)} className={SELECT_CLASS}>
                    <option value="">Sin especificar</option>
                    {REGIMEN_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>Estrato</FieldLabel>
                  <select value={estrato} onChange={(e) => setEstrato(e.target.value)} className={SELECT_CLASS}>
                    <option value="">Sin especificar</option>
                    {ESTRATO_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel>Dirección de residencia</FieldLabel>
                  <input
                    value={direccionResidencia}
                    onChange={(e) => setDireccionResidencia(e.target.value)}
                    placeholder="Ej. Calle 10 # 5-23"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <FieldLabel>Residencia — Departamento</FieldLabel>
                  <select
                    value={departamentoResidencia}
                    onChange={(e) => { setDepartamentoResidencia(e.target.value); setCiudadResidencia(''); }}
                    className={SELECT_CLASS}
                  >
                    <option value="">Sin especificar</option>
                    {DEPARTAMENTOS_ORDENADOS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>Residencia — Ciudad / Municipio</FieldLabel>
                  <select
                    value={ciudadResidencia}
                    onChange={(e) => setCiudadResidencia(e.target.value)}
                    disabled={!departamentoResidencia}
                    className={`${SELECT_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <option value="">{departamentoResidencia ? 'Sin especificar' : 'Seleccione primero el departamento'}</option>
                    {(departamentoResidencia ? (COLOMBIA_DEPARTAMENTOS[departamentoResidencia] ?? []) : []).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>Barrio</FieldLabel>
                  <input
                    value={barrio}
                    onChange={(e) => setBarrio(e.target.value)}
                    placeholder="Ej. El Poblado"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>
            )}

            {/* ── Pestaña: Convenio y atención ─────────────────────────────── */}
            {activeTab === 'convenio' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel>Convenio / Cliente corporativo</FieldLabel>
                  <select
                    value={companyId}
                    onChange={(e) => { setCompanyId(e.target.value); setAgreementType(''); }}
                    disabled={loadingCompanies}
                    className={SELECT_CLASS}
                  >
                    <option value="">Particular (sin convenio)</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>Tipo de convenio</FieldLabel>
                  <select
                    value={agreementType}
                    onChange={(e) => setAgreementType(e.target.value)}
                    disabled={!companyId}
                    title={!companyId ? 'Elige primero un convenio / cliente corporativo.' : undefined}
                    className={`${SELECT_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <option value="">Sin especificar</option>
                    {agreementTypes.map((t) => (
                      <option key={t.id} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>Relación</FieldLabel>
                  <select value={relacion} onChange={(e) => setRelacion(e.target.value)} className={SELECT_CLASS}>
                    <option value="">Sin especificar</option>
                    {RELACION_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>Tipo de atención</FieldLabel>
                  <select value={tipoAtencion} onChange={(e) => setTipoAtencion(e.target.value)} className={SELECT_CLASS}>
                    <option value="">Sin especificar</option>
                    {TIPO_ATENCION_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel>Psicólogo asignado</FieldLabel>
                  <select
                    value={psychologistId}
                    onChange={(e) => setPsychologistId(e.target.value)}
                    disabled={loadingSpecialists}
                    className={SELECT_CLASS}
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
                    <FieldLabel>Sesiones aprobadas</FieldLabel>
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
            )}

            {/* ── Pestaña: Fechas y seguimiento ────────────────────────────── */}
            {activeTab === 'fechas' && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <FieldLabel>Fecha de solicitud</FieldLabel>
                    <input type="date" value={fechaSolicitud} onChange={(e) => setFechaSolicitud(e.target.value)} className={INPUT_CLASS} />
                  </div>
                  <div>
                    <FieldLabel>Fecha de agendamiento</FieldLabel>
                    <input type="date" value={fechaAgendamiento} onChange={(e) => setFechaAgendamiento(e.target.value)} className={INPUT_CLASS} />
                    <p className="mt-1 text-[10.5px] text-slate-400">Se completa sola con la primera cita agendada.</p>
                  </div>
                  <div>
                    <FieldLabel>Fecha de finalización</FieldLabel>
                    <input type="date" value={fechaFinalizacion} onChange={(e) => setFechaFinalizacion(e.target.value)} className={INPUT_CLASS} />
                    <p className="mt-1 text-[10.5px] text-slate-400">Se completa sola al cerrar el proceso.</p>
                  </div>
                </div>

                {isEditMode && (sessionStats || loadingSessionStats) && (
                  <div className="border-t border-slate-100 pt-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-toast-50 text-toast-500">
                        <BarChart3 className="h-3.5 w-3.5" />
                      </span>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Seguimiento de sesiones</p>
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
              </div>
            )}

            {/* ── Pestaña: Contacto de emergencia ──────────────────────────── */}
            {activeTab === 'emergencia' && (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {isEditMode ? 'Contacto de emergencia' : 'Contacto de emergencia (opcional)'}
                  </p>
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

                <div className="mt-6 border-t border-slate-100 pt-5">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-charcoal-900">
                    <input
                      type="checkbox"
                      checked={requiereRepresentanteLegal}
                      onChange={(e) => setRequiereRepresentanteLegal(e.target.checked)}
                      disabled={emergencyContactLocked}
                    />
                    El paciente requiere representante legal (ej. menor de edad)
                  </label>

                  {requiereRepresentanteLegal && (
                    <div className="mt-4 space-y-4 rounded-lg bg-slate-50 p-4">
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-500">
                        <input
                          type="checkbox"
                          checked={legalRepSameAsEmergency}
                          onChange={(e) => setLegalRepSameAsEmergency(e.target.checked)}
                          disabled={emergencyContactLocked}
                        />
                        Es la misma persona del contacto de emergencia
                      </label>

                      {!legalRepSameAsEmergency && (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div>
                            <label htmlFor="lr-nombres" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nombres</label>
                            <input
                              id="lr-nombres"
                              name="lr-nombres"
                              autoComplete="off"
                              value={legalRep1Nombres}
                              onChange={(e) => setLegalRep1Nombres(onlyLetters(e.target.value))}
                              placeholder="Ej. Carlos"
                              disabled={emergencyContactLocked}
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </div>
                          <div>
                            <label htmlFor="lr-apellidos" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Apellidos</label>
                            <input
                              id="lr-apellidos"
                              name="lr-apellidos"
                              autoComplete="off"
                              value={legalRep1Apellidos}
                              onChange={(e) => setLegalRep1Apellidos(onlyLetters(e.target.value))}
                              placeholder="Ej. Gómez"
                              disabled={emergencyContactLocked}
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </div>
                          <div>
                            <label htmlFor="lr-telefono" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Teléfono</label>
                            <input
                              id="lr-telefono"
                              name="lr-telefono"
                              autoComplete="off"
                              value={legalRep1Telefono}
                              onChange={(e) => setLegalRep1Telefono(onlyDigits(e.target.value, 10))}
                              placeholder="Ej. 3132220587"
                              inputMode="numeric"
                              maxLength={10}
                              disabled={emergencyContactLocked}
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </div>
                          <div>
                            <label htmlFor="lr-parentesco" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Parentesco</label>
                            <select
                              id="lr-parentesco"
                              name="lr-parentesco"
                              value={legalRep1Parentesco}
                              onChange={(e) => setLegalRep1Parentesco(e.target.value)}
                              disabled={emergencyContactLocked}
                              className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <option value="">Selecciona</option>
                              {PARENTESCO_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </div>
                        </div>
                      )}

                      <div>
                        <label htmlFor="lr-correo" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Correo del representante legal (opcional)</label>
                        <input
                          id="lr-correo"
                          name="lr-correo"
                          type="email"
                          autoComplete="off"
                          value={legalRep1Correo}
                          onChange={(e) => setLegalRep1Correo(e.target.value)}
                          placeholder="carlos@correo.com"
                          disabled={emergencyContactLocked}
                          className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {duplicatePatient && (
              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
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
              <p className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
            <div className="hidden items-center gap-1.5 text-[10.5px] text-slate-400 sm:flex">
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              Estos datos se precargan en la Valoración Individual del paciente.
            </div>
            <div className="flex items-center gap-3">
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
          </div>
        </form>
      </div>
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
