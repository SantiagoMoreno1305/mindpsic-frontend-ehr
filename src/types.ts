// ============================================================================
// RBAC — 5 NIVELES CANÓNICOS (Grupo Mind)
// Estos son los únicos valores válidos para el campo `role` en el sistema.
// ============================================================================

/**
 * Roles canónicos del sistema RBAC de 5 niveles del Grupo Mind.
 *
 * Jerarquía (de mayor a menor privilegio):
 *  1. CEO            → Root / C-Level. Acceso total al holding. Bypass de tenantId.
 *  2. DIRECTIVO      → Auditoría, liderazgo y métricas por dominio. Sin acceso al código fuente.
 *  3. ESPECIALISTA_B2B → Psicólogos, Investigadores, Clientes Corporativos.
 *  4. OPERATIVO      → Soporte auxiliar y RRHH. Sin acceso a datos clínicos sensibles.
 *  5. USUARIO_B2C    → Pacientes y clientes finales. Solo acceso a su propia sesión.
 */
export type UserRole =
  | 'CEO'
  | 'DIRECTIVO'
  | 'ESPECIALISTA_B2B'
  | 'OPERATIVO'
  | 'USUARIO_B2C';

/**
 * Alias legacy → nuevo rol canónico.
 * Usar para migrar tokens JWT emitidos antes del RBAC v2.
 * El backend debe leer este mapa en el middleware de auth para
 * normalizar roles antes de emitirlos al frontend.
 */
export const LEGACY_ROLE_MAP: Record<string, UserRole> = {
  // Roles legacy del EHR anterior
  'psicologo':  'ESPECIALISTA_B2B',
  'admin':      'DIRECTIVO',
  'director':   'DIRECTIVO',
  // Aliases cortos reconocidos por el gateway
  'b2b':        'ESPECIALISTA_B2B',
  'b2c':        'USUARIO_B2C',
  'soporte':    'OPERATIVO',
  'rrhh':       'OPERATIVO',
  'root':       'CEO',
};

/** Etiquetas de presentación (UI) para cada rol canónico. */
export const ROLE_LABELS: Record<UserRole, string> = {
  CEO:               'CEO / Dirección General',
  DIRECTIVO:         'Directivo / Auditoría',
  ESPECIALISTA_B2B:  'Especialista B2B',
  OPERATIVO:         'Operativo / RRHH',
  USUARIO_B2C:       'Usuario / Paciente',
};

/**
 * Resuelve un rol (canónico o legacy) al UserRole canónico.
 * Devuelve 'USUARIO_B2C' como fallback seguro (mínimo privilegio).
 */
export function resolveRole(raw: string | undefined | null): UserRole {
  if (!raw) return 'USUARIO_B2C';
  const normalized = raw.trim().toLowerCase();
  // Ya es canónico (comparación case-insensitive)
  const canonical: UserRole[] = ['CEO','DIRECTIVO','ESPECIALISTA_B2B','OPERATIVO','USUARIO_B2C'];
  const upperRaw = raw.trim().toUpperCase() as UserRole;
  if (canonical.includes(upperRaw)) return upperRaw;
  // Alias legacy
  return LEGACY_ROLE_MAP[normalized] ?? 'USUARIO_B2C';
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  licenseNumber?: string;
  tenantId?: string; // Identificador del tenant/clínica al que pertenece el usuario
  specialty?: string; // Especialidad clínica (ej. 'Psicología Clínica')
  level?: string;     // Nivel del especialista (ej. 'Nivel 2')
}

export interface Patient {
  id: string;
  name: string;
  gender: string;
  age: number;
  email: string;
  phone: string;
  status: 'Activo' | 'Inactivo';
  agreement: string; // "Convenio" (e.g., Colmédica, Sura, MindHealth Global, Particular)
  progressNotesCount: number;
  lastSessionDate: string;
}

export interface ProgressNote {
  id: string;
  patientId: string;
  date: string;
  psychologistId: string;
  psychologistName: string;
  sessionNumber: number;
  reason: string;
  mentalStatus: string;
  intervention: string;
  evolution: string;
  diagnosis: string;
  recommendations: string;
}

export type ClinicalFileType = 'pdf' | 'word' | 'excel' | 'sql' | 'image' | 'brain' | 'text';

export interface ClinicalFile {
  id: string;
  name: string;
  type: ClinicalFileType;
  size: string;
  uploadedAt: string;
  uploadedBy: string;
  patientId?: string; // Links to a specific patient file drawer
  category: 'Historia Clínica' | 'Evaluación' | 'Consentimiento' | 'Análisis IA' | 'Copias de Seguridad' | 'Otros';
}

export interface DriveFolder {
  id: string;
  name: string;
  patientId?: string;
  filesCount: number;
}

export interface PsychometricTest {
  id: string;
  name: string;
  description: string;
  category: 'Ansiedad y Depresión' | 'Personalidad' | 'Cognitivo' | 'Neuropsicología' | 'Infantil';
  duration: string;
  difficulty: 'Baja' | 'Media' | 'Alta';
}

export interface PatientTestState {
  id: string;
  testId: string;
  testName: string;
  patientId: string;
  patientName: string;
  status: 'enviado' | 'completado' | 'pendiente';
  sentDate: string;
  completedDate?: string;
  score?: string;
}

export interface VideoSession {
  id: string;
  patientId: string;
  patientName: string;
  time: string;
  date: string;
  status: 'programada' | 'en_progreso' | 'finalizada' | 'cancelada';
  roomUrl: string;
  notes?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isClinicalInsight?: boolean; // Highlight clinical suggestions
}

export interface TenantDomain {
  id: string;
  organization: string;
  domain: string;
  status: 'active' | 'suspended';
  dbConnection: string;
  createdAt: string;
  usersLimit: number;
  usersActive: number;
  region: string;
}

export interface PsychologistPerformance {
  id: string;
  name: string;
  specialty: string;
  activePatients: number;
  satisfactionRate: number; // Percentage
  completedSessions: number;
  tenantId: string;
}

// ============================================================================
// NEW TYPES: RESEARCH & PHARMACEUTICAL WORKFLOW (Mantiene intacto lo clínico)
// ============================================================================

export interface ResearchProject {
  id: string;
  code: string;
  title: string;
  description: string;
  principalInvestigator: string;
  pharmaPartner: string;
  startDate: string;
  endDate: string;
  targetSubjects: number;
  enrolledSubjects: number;
  status: 'planeación' | 'reclutamiento' | 'activo' | 'finalizado';
  protocolFile?: string;
}

export interface ScreeningData {
  id: string;
  subjectId: string;
  projectId: string;
  screeningDate: string;
  screener: string;
  screeningStatus: 'pre-screening' | 'screened' | 'enrolled' | 'excluded' | 'withdrawn';
  inclusionCriteria: Record<string, boolean>;
  exclusionCriteria: Record<string, boolean>;
  notes?: string;
  rawData?: Record<string, any>; // JSON field para datos de tamizaje masivo
}

export interface ResearchSubject {
  id: string;
  code: string; // ID único del estudio
  name: string;
  email: string;
  phone: string;
  gender: string;
  age: number;
  recruitmentDate: string;
  enrollmentDate?: string;
  projectId: string;
  screeningStatus: 'pre-screening' | 'screened' | 'enrolled' | 'excluded' | 'withdrawn' | 'completed';
  consentStatus: 'pendiente' | 'firmado' | 'rechazado';
  lastDataCollectionDate?: string;
  screeningDataCount: number;
  status: 'Activo' | 'Inactivo';
}

export interface ResearchAppointment {
  id: string;
  subjectId: string;
  subjectName: string;
  projectId: string;
  dayIndex: number;
  timeSlot: string;
  appointmentType: 'toma de datos' | 'entrevista' | 'evaluación' | 'seguimiento';
  estatus: 'Confirmada' | 'Pendiente' | 'Cancelada';
  modalidad: 'Virtual' | 'Presencial';
  roomUrl?: string;
  notes?: string;
}

// Unifying type that can represent both contexts
export type SubjectContext = 'clinical' | 'research';

export interface ClinicalAppointment {
  id: string;
  patientId: string;
  patientName: string;
  dayIndex: number;
  timeSlot: string;
  atencionType: string; // e.g., "psicología clínica", "psicología del sueño", etc.
  estatus: 'Confirmada' | 'Pendiente' | 'Cancelada';
  modalidad: 'Virtual' | 'Presencial';
  roomUrl: string;
}

// Extended VideoSession to support both contexts
export interface VideoSessionExtended extends VideoSession {
  context: 'clinical' | 'research';
  subjectType: 'patient' | 'research_subject';
}

// ============================================================================
// REAL CONNECTION TYPES (Agendamiento y Pacientes backend)
// ============================================================================

export interface BackendPatient {
  id: string;
  firstName: string;
  lastName: string;
  documentId: string;
  email?: string;
  phone?: string;
}

export interface BackendAppointment {
  id: string;
  patient: { id: string; firstName: string; lastName: string };
  psychologist: { id: string; name: string };
  dateTime: string;
  type: string;
  status: string;
  notes?: string;
  modality?: 'VIRTUAL' | 'PRESENCIAL';
  roomUrl?: string;
}
