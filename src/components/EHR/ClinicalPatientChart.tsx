import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  ArrowLeft, Phone, Mail, CalendarClock, ClipboardList,
  Plus, Trash2, Loader2, Pencil, X, AlertTriangle,
  TrendingUp, TrendingDown, Minus, ChevronDown, Lock, KeyRound,
} from 'lucide-react';
import ClinicalHistoryEditor from './ClinicalHistoryEditor';
import ClinicalAttachments from './ClinicalAttachments';
import InitialAssessmentWizard from './InitialAssessmentWizard';
import PatientInvitationCard from './PatientInvitationCard';
import AssessmentRunner from './AssessmentRunner';

interface RipsDiagnosis {
  id: string;
  cie10Code: string;
  cie10Label: string;
  year: number;
  month: number;
  assignedByName?: string | null;
}
interface Cie10Option { code: string; descripcion: string; }
interface Assessment { id: string; name: string; date: string; score: string; interpretation?: string | null; }

interface PatientChart {
  id: string;
  firstName: string;
  lastName: string;
  documentId: string;
  documentType?: string | null;
  email?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  recordNumber?: string | null;
  status: string;
  riskLevel: string;
  // ── Datos de contacto/sociodemográficos ACTUALES — editables aunque la
  // Valoración Individual ya esté firmada (ver PUT /:id/chart). El backend ya
  // resuelve el respaldo al snapshot de la valoración firmada cuando el
  // paciente todavía no tiene su propio valor — acá siempre viene el valor
  // vigente a mostrar, sin necesidad de mirar initialAssessment aparte.
  epsCodigo?: string | null;
  epsNombre?: string | null;
  regimenSalud?: string | null;
  estadoCivil?: string | null;
  orientacionSexual?: string | null;
  orientacionSexualOtro?: string | null;
  escolaridad?: string | null;
  estudiaActualmente?: boolean | null;
  semestreGradoTrimestre?: string | null;
  carrera?: string | null;
  ocupacion?: string | null;
  direccionResidencia?: string | null;
  departamentoResidencia?: string | null;
  ciudadResidencia?: string | null;
  barrio?: string | null;
  estrato?: number | null;
}

interface InitialAssessmentGate {
  required: boolean;
  satisfied: boolean;
  assessmentId: string | null;
  status: string | null;
}

interface HouseholdMember {
  id: string;
  fullName: string;
  relationship: string;
  age?: number | null;
}

interface InitialAssessmentData {
  id: string;
  signedAt?: string | null;
  signedByName?: string | null;
  nombresApellidos?: string | null;
  epsNombre?: string | null;
  regimenSalud?: string | null;
  tipoDocumento?: string | null;
  numeroDocumento?: string | null;
  estadoCivil?: string | null;
  sexoBiologico?: string | null;
  genero?: string | null;
  fechaNacimiento?: string | null;
  lugarNacimiento?: string | null;
  orientacionSexual?: string | null;
  orientacionSexualOtro?: string | null;
  escolaridad?: string | null;
  poblacionDiferencial: string[];
  estudiaActualmente?: boolean | null;
  semestreGradoTrimestre?: string | null;
  carrera?: string | null;
  ocupacion?: string | null;
  correoElectronico?: string | null;
  direccionResidencia?: string | null;
  barrio?: string | null;
  estrato?: number | null;
  telefono?: string | null;
  telefonoEmergencia?: string | null;
  requiereRepresentanteLegal: boolean;
  legalRep1Nombres?: string | null;
  legalRep1Apellidos?: string | null;
  legalRep1Parentesco?: string | null;
  legalRep1Telefono?: string | null;
  legalRep1Correo?: string | null;
  tieneSegundoRepresentante: boolean;
  legalRep2Nombres?: string | null;
  legalRep2Apellidos?: string | null;
  legalRep2Parentesco?: string | null;
  legalRep2Telefono?: string | null;
  legalRep2Correo?: string | null;
  personaReportaMotivo?: string | null;
  motivoConsulta?: string | null;
  conducta?: string | null;
  duracion?: string | null;
  intensidad?: string | null;
  frecuencia?: string | null;
  expectativas?: string | null;
  instrumentosAplicados: string[];
  aspectosAPA?: string | null;
  hipotesisPreliminares?: string | null;
  householdMembers: HouseholdMember[];
}

interface PendingAdministration {
  id: string;
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'INVALID';
  assignedAt: string;
  instrument: { code: string; name: string; nameEs?: string | null; modality: string };
}

interface RiskEvent {
  id: string;
  previousLevel: string;
  newLevel: string;
  severity: string;
  instrumentCode: string | null;
  alertIds: string[];
  reason: string;
  acknowledgedAt: string | null;
  createdAt: string;
}

interface ChartResponse {
  patient: PatientChart;
  ripsDiagnosis: RipsDiagnosis | null;
  assessments: Assessment[];
  riskEvents: RiskEvent[];
  firstSession: string | null;
  lastSession: string | null;
  nextAppointment: string | null;
  initialAssessment: InitialAssessmentData | null;
  initialAssessmentGate: InitialAssessmentGate;
}

type Tab = 'resumen' | 'historia' | 'evoluciones' | 'evaluaciones' | 'anexos';

const TABS: { key: Tab; label: string }[] = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'historia', label: 'Anamnesis / Historia' },
  { key: 'evoluciones', label: 'Evoluciones' },
  { key: 'evaluaciones', label: 'Evaluaciones' },
  { key: 'anexos', label: 'Anexos' },
];

function apiBase() {
  return import.meta.env.VITE_API_URL || 'http://localhost:9000';
}

function authHeaders() {
  const token = localStorage.getItem('mind_token');
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Extrae el puntaje bruto de un score tipo "43 / 63" — null si es texto libre
// no numérico (una evaluación cargada a mano puede traer cualquier cosa),
// para que el seguimiento de tendencia simplemente se omita en ese caso en
// vez de romper.
function parseScoreValue(score: string): number | null {
  const match = score.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  return parseFloat(match[0].replace(',', '.'));
}

function calcAge(birthDate?: string | null) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

const TAB_KEYS: Tab[] = TABS.map((t) => t.key);

export default function ClinicalPatientChart({ patientId, onBack }: { patientId: string; onBack: () => void }) {
  // Recuerda la pestaña activa (Resumen/Evoluciones/...) entre recargas —
  // junto con selectedPatientId persistido en AdminPortal, un refresh estando
  // en "Evoluciones" ya no manda de vuelta al listado ni resetea a "Resumen".
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem('mind_clinical_chart_tab');
    return (saved && TAB_KEYS.includes(saved as Tab)) ? (saved as Tab) : 'resumen';
  });
  useEffect(() => {
    localStorage.setItem('mind_clinical_chart_tab', tab);
  }, [tab]);
  const [data, setData] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // Historia asignada a otro profesional, sin acceso todavía — se muestra el
  // gate (botón "Solicitar acceso" + verificación de código) en vez de la
  // ficha. `readOnlyAccess` distingue acceso propio de un acceso prestado ya
  // vigente (para el banner de solo lectura una vez adentro).
  const [accessDenied, setAccessDenied] = useState(false);
  const [readOnlyAccess, setReadOnlyAccess] = useState(false);

  useEffect(() => {
    fetchChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const fetchChart = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase()}/api/patients/${patientId}/chart`, { headers: authHeaders() });
      if (res.ok) {
        setAccessDenied(false);
        setData(await res.json());
        // No bloquea el render de la ficha: solo determina si se muestra el
        // banner de solo lectura (acceso prestado) una vez cargada.
        fetch(`${apiBase()}/api/patients/${patientId}/clinical-access/status`, { headers: authHeaders() })
          .then((r) => (r.ok ? r.json() : null))
          .then((s) => setReadOnlyAccess(Boolean(s && s.hasAccess && !s.isOwner)))
          .catch(() => {});
      } else {
        const errBody = await res.json().catch(() => ({}));
        if (res.status === 403 && errBody.code === 'CLINICAL_ACCESS_REQUIRED') {
          setAccessDenied(true);
        } else {
          toast.error(errBody.error || 'Error al cargar la ficha clínica');
        }
      }
    } catch {
      toast.error('Error de red al cargar la ficha clínica');
    } finally {
      setLoading(false);
    }
  };

  const patchChart = async (payload: Record<string, unknown>) => {
    try {
      const res = await fetch(`${apiBase()}/api/patients/${patientId}/chart`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'failed');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error al guardar los cambios');
    }
  };

  const updateLocalPatient = (patch: Partial<PatientChart>) => {
    setData((prev) => (prev ? { ...prev, patient: { ...prev.patient, ...patch } } : prev));
  };

  const handleStatusChange = (status: string) => {
    updateLocalPatient({ status });
    patchChart({ status });
  };

  const handleRiskChange = (riskLevel: string) => {
    updateLocalPatient({ riskLevel });
    patchChart({ riskLevel });
  };

  // A diferencia de patchChart (fire-and-forget, usado para status/riskLevel),
  // esto sí propaga el éxito/fallo al modal — para que EditContactModal pueda
  // mostrar su propio toast y no cerrar si el guardado falló.
  const handleSaveContact = async (payload: Record<string, unknown>) => {
    const res = await fetch(`${apiBase()}/api/patients/${patientId}/chart`, {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || 'failed');
    }
    const { patient: updated } = await res.json();
    updateLocalPatient(updated);
  };

  if (accessDenied) {
    return (
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="flex items-center text-sm font-semibold text-slate-400 transition-colors hover:text-slate-900"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a la bandeja de pacientes
        </button>
        <ClinicalAccessGate patientId={patientId} onGranted={fetchChart} />
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-toast-500" />
      </div>
    );
  }

  const { patient, ripsDiagnosis, assessments, riskEvents, firstSession, lastSession, nextAppointment, initialAssessment, initialAssessmentGate } = data;
  const age = calcAge(patient.birthDate);
  const initials = `${patient.firstName?.[0] ?? ''}${patient.lastName?.[0] ?? ''}`.toUpperCase();

  if (initialAssessmentGate.required && !initialAssessmentGate.satisfied) {
    return (
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="flex items-center text-sm font-semibold text-slate-400 transition-colors hover:text-slate-900"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a la bandeja de pacientes
        </button>
        <InitialAssessmentWizard
          patientId={patientId}
          patientFirstName={patient.firstName}
          patientLastName={patient.lastName}
          patientDocumentId={patient.documentId}
          patientDocumentType={patient.documentType}
          patientBirthDate={patient.birthDate}
          patientEmail={patient.email}
          patientPhone={patient.phone}
          onComplete={fetchChart}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <button
        onClick={onBack}
        className="flex items-center text-sm font-semibold text-slate-400 transition-colors hover:text-slate-900"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Volver a la bandeja de pacientes
      </button>

      {readOnlyAccess && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-600/30 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Estás viendo esta historia con un acceso temporal de solo lectura — no puedes editarla, firmar evoluciones, asignar pruebas ni subir anexos.
        </div>
      )}

      {/* ═══ Encabezado persistente del paciente ═══ */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-toast-100 text-lg font-bold text-toast-500">
              {initials}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  {patient.firstName} {patient.lastName}
                </h1>
                <StatusSelect value={patient.status} onChange={handleStatusChange} />
                <RiskSelect value={patient.riskLevel} onChange={handleRiskChange} />
              </div>
              <p className="mt-1 text-sm text-slate-400">
                {patient.recordNumber ? `${patient.recordNumber} · ` : ''}
                {patient.documentId}
                {age !== null ? ` · ${age} años` : ''}
                {patient.gender ? ` · ${patient.gender}` : ''}
              </p>
              {ripsDiagnosis && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-900">
                    <span className="font-mono font-semibold text-toast-500">{ripsDiagnosis.cie10Code}</span>
                    {ripsDiagnosis.cie10Label}
                    <span className="text-slate-400">· RIPS {String(ripsDiagnosis.month).padStart(2, '0')}/{ripsDiagnosis.year}</span>
                  </span>
                </div>
              )}
            </div>
          </div>
          {/* Próxima cita + App móvil apiladas y alineadas a la derecha —
              ambas viven acá, dentro del encabezado, y no como su propia
              sección aparte: saber si el paciente tiene la app condiciona lo
              que el especialista puede pedirle desde cualquier pestaña, igual
              que la próxima cita, así que comparten el mismo lugar fijo. */}
          <div className="flex w-full flex-col items-stretch gap-2 sm:w-80 sm:shrink-0">
            {nextAppointment && (
              <div className="flex w-full items-center gap-2 rounded-lg bg-toast-100 px-3 py-2.5 text-xs font-semibold text-toast-500">
                <CalendarClock className="h-4 w-4 shrink-0" />
                <span>Próxima cita: {formatDateTime(nextAppointment)}</span>
              </div>
            )}
            <PatientInvitationCard
              patientId={patient.id}
              patientName={`${patient.firstName} ${patient.lastName}`}
              tieneDocumento={Boolean(patient.documentId)}
            />
          </div>
        </div>
      </div>

      {/* ═══ Tabs ═══ */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              tab === t.key
                ? 'relative whitespace-nowrap px-4 py-3 text-sm font-semibold text-toast-500'
                : 'relative whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-400 hover:text-slate-900'
            }
          >
            {t.label}
            {tab === t.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-toast-500" />}
          </button>
        ))}
      </div>

      <div>
        {tab === 'resumen' && (
          <ResumenTab
            patient={patient}
            ripsDiagnosis={ripsDiagnosis}
            firstSession={firstSession}
            lastSession={lastSession}
            initialAssessment={initialAssessment}
            onRipsDiagnosisChange={(next) => setData((prev) => (prev ? { ...prev, ripsDiagnosis: next } : prev))}
            patientId={patientId}
          />
        )}
        {tab === 'historia' && <HistoriaTab initialAssessment={initialAssessment} patient={patient} onSaveContact={handleSaveContact} />}
        {tab === 'evoluciones' && <ClinicalHistoryEditor patientId={patientId} />}
        {tab === 'evaluaciones' && (
          <EvaluacionesTab
            patientId={patientId}
            riskEvents={riskEvents || []}
            assessments={assessments}
            onChange={(next) => setData((prev) => (prev ? { ...prev, assessments: next } : prev))}
          />
        )}
        {tab === 'anexos' && <ClinicalAttachments patientId={patientId} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ClinicalAccessGate — se muestra en vez de la ficha cuando el paciente está
// asignado a otro profesional. El código lo dicta el dueño de la historia por
// fuera de la app (no hay botón de "aprobar" acá); esta pantalla solo pide el
// acceso y, una vez hay una solicitud pendiente, deja el formulario de código
// listo — se recupera del backend en cada montaje (GET .../status), así que
// sigue ahí aunque se recargue la página mientras el colega dicta el código.
// ═══════════════════════════════════════════════════════════════════════════
function ClinicalAccessGate({ patientId, onGranted }: { patientId: string; onGranted: () => void }) {
  const [checking, setChecking] = useState(true);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [pendingExpiresAt, setPendingExpiresAt] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const loadStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(`${apiBase()}/api/patients/${patientId}/clinical-access/status`, { headers: authHeaders() });
      if (res.ok) {
        const s = await res.json();
        setPendingRequestId(s.pendingRequestId || null);
        setPendingExpiresAt(s.pendingExpiresAt || null);
      }
    } catch {
      // silencioso — el botón de "Solicitar acceso" sigue disponible igual
    } finally {
      setChecking(false);
    }
  }, [patientId]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const requestAccess = async () => {
    setRequesting(true);
    try {
      const res = await fetch(`${apiBase()}/api/patients/${patientId}/clinical-access/request`, {
        method: 'POST', headers: authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || 'Error al solicitar el acceso');
        return;
      }
      toast.success('Código enviado al correo del profesional a cargo. Pídeselo y escríbelo abajo.');
      setPendingRequestId(body.requestId);
      setPendingExpiresAt(null);
    } catch {
      toast.error('Error de red al solicitar el acceso');
    } finally {
      setRequesting(false);
    }
  };

  const verify = async () => {
    if (!pendingRequestId || code.trim().length !== 6) return;
    setVerifying(true);
    try {
      const res = await fetch(`${apiBase()}/api/patients/${patientId}/clinical-access/verify`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ requestId: pendingRequestId, code: code.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || 'Código incorrecto');
        return;
      }
      toast.success('Acceso concedido por 2 horas, en modo solo lectura.');
      onGranted();
    } catch {
      toast.error('Error de red al verificar el código');
    } finally {
      setVerifying(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-toast-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-toast-100">
        <Lock className="h-6 w-6 text-toast-500" />
      </div>
      <h2 className="text-lg font-bold text-slate-900">Historia clínica de otro profesional</h2>
      <p className="mt-1 text-sm text-slate-400">
        Este paciente está asignado a otro especialista. Para verla necesitas un código de acceso temporal.
      </p>

      {!pendingRequestId ? (
        <button
          onClick={requestAccess}
          disabled={requesting}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-toast-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-toast-600 disabled:opacity-60"
        >
          {requesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Solicitar acceso a historia clínica
        </button>
      ) : (
        <div className="mt-5 space-y-3 text-left">
          <p className="text-center text-xs font-medium text-slate-400">
            Le llegó un código de 6 dígitos al correo del profesional a cargo{pendingExpiresAt ? ` (vence ${new Date(pendingExpiresAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })})` : ''}. Pídeselo y escríbelo aquí.
          </p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => e.key === 'Enter' && verify()}
            placeholder="000000"
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-center text-2xl font-bold tracking-[0.5em] outline-none focus:border-toast-500"
            autoFocus
          />
          <button
            onClick={verify}
            disabled={verifying || code.length !== 6}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-toast-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-toast-600 disabled:opacity-60"
          >
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Verificar código
          </button>
          <button
            onClick={requestAccess}
            disabled={requesting}
            className="w-full text-center text-xs font-semibold text-slate-400 hover:text-toast-500"
          >
            Pedir un código nuevo
          </button>
        </div>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">{children}</h2>;
}

const STATUS_OPTIONS = [
  { value: 'activo', label: 'Atendida', className: 'border-emerald-600/30 bg-emerald-50 text-emerald-600' },
  { value: 'pausa', label: 'En pausa', className: 'border-amber-600/30 bg-amber-50 text-amber-600' },
  { value: 'alta', label: 'Alta', className: 'border-slate-200 bg-slate-100 text-slate-400' },
];

function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = STATUS_OPTIONS.find((o) => o.value === value) || STATUS_OPTIONS[0];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-full border px-2 py-0.5 text-xs font-bold uppercase outline-none ${current.className}`}
    >
      {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

const RISK_OPTIONS = [
  { value: 'bajo', label: 'Riesgo bajo', className: 'border-emerald-600/30 bg-emerald-50 text-emerald-600' },
  { value: 'medio', label: 'Riesgo medio', className: 'border-amber-600/30 bg-amber-50 text-amber-600' },
  { value: 'alto', label: 'Riesgo alto', className: 'border-red-600/30 bg-red-50 text-red-600' },
];

function RiskSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = RISK_OPTIONS.find((o) => o.value === value) || RISK_OPTIONS[0];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-full border px-2 py-0.5 text-xs font-bold uppercase outline-none ${current.className}`}
    >
      {RISK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function ResumenTab({
  patient, ripsDiagnosis, firstSession, lastSession, initialAssessment, onRipsDiagnosisChange, patientId,
}: {
  patient: PatientChart; ripsDiagnosis: RipsDiagnosis | null; firstSession: string | null; lastSession: string | null;
  initialAssessment: InitialAssessmentData | null;
  onRipsDiagnosisChange: (next: RipsDiagnosis | null) => void;
  patientId: string;
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Cie10Option[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) { setOptions([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`${apiBase()}/api/cie10?q=${encodeURIComponent(query.trim())}`, { headers: authHeaders() });
        if (res.ok) setOptions(await res.json());
      } catch {
        // silencioso — el usuario simplemente no ve resultados
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const assign = async (option: Cie10Option) => {
    setSaving(true);
    try {
      const res = await fetch(`${apiBase()}/api/rips-diagnosis/${patientId}`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify({ cie10Code: option.code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Error al asignar el diagnóstico RIPS');
        return;
      }
      onRipsDiagnosisChange(data.diagnosis);
      setQuery(''); setOptions([]);
      toast.success('Diagnóstico RIPS asignado');
    } catch {
      toast.error('Error de red al asignar el diagnóstico RIPS');
    } finally {
      setSaving(false);
    }
  };

  const now = new Date();
  const currentPeriodLabel = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <SectionTitle>Motivo de consulta</SectionTitle>
        <p className="text-sm leading-relaxed text-slate-900">
          {initialAssessment?.motivoConsulta || 'No se registró un motivo de consulta en la Valoración Individual.'}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-200 pt-4">
          <div>
            <p className="text-xs text-slate-400">Primera sesión</p>
            <p className="text-sm font-medium text-slate-900">{formatDate(firstSession)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Última sesión</p>
            <p className="text-sm font-medium text-slate-900">{formatDate(lastSession)}</p>
          </div>
        </div>
      </Card>
      <Card>
        <SectionTitle>Contacto</SectionTitle>
        <div className="flex flex-col gap-2 text-sm text-slate-900">
          <span className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-slate-400" />
            {patient.phone || '—'}
          </span>
          <span className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-slate-400" />
            {patient.email || '—'}
          </span>
        </div>
        <div className="mt-4 border-t border-slate-200 pt-4">
          <SectionTitle>Diagnóstico RIPS (CIE-10) · {currentPeriodLabel}</SectionTitle>
          <p className="mb-2 text-[11px] text-slate-400">
            Código oficial que se reporta al RIPS de este mes — obligatorio al cierre.
          </p>
          {ripsDiagnosis ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
              <span><span className="font-mono font-semibold text-emerald-700">{ripsDiagnosis.cie10Code}</span> — {ripsDiagnosis.cie10Label}</span>
            </div>
          ) : (
            <p className="mb-2 text-sm text-amber-600">⚠️ Sin diagnóstico RIPS asignado para este mes.</p>
          )}
          <div className="relative mt-2">
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por código o nombre (ej. F41.1, ansiedad)..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-toast-500"
            />
            {searching && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-slate-400" />}
            {options.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {options.map((opt) => (
                  <li key={opt.code}>
                    <button
                      type="button" disabled={saving} onClick={() => assign(opt)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50 disabled:opacity-50"
                    >
                      <span className="font-mono font-semibold text-toast-500">{opt.code}</span>
                      <span className="text-slate-700">{opt.descripcion}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

// Anamnesis / Historia se alimenta por completo de la Valoración Individual
// firmada — ya no existen los 3 campos de texto libre por separado.
//
// Los campos de contacto/sociodemográficos (EPS, régimen, estado civil,
// orientación, escolaridad, ocupación, correo, teléfono, dirección, estrato)
// SÍ se pueden editar aunque la valoración ya esté firmada — vienen de
// `patient` (estado actual, con respaldo automático al snapshot firmado si
// el paciente aún no tiene su propio valor), no de `initialAssessment` (que
// queda congelado para siempre). El resto de la valoración (motivo, conducta,
// contexto familiar, cierre profesional) sigue viniendo de `a` y no se toca.
function HistoriaTab({ initialAssessment, patient, onSaveContact }: {
  initialAssessment: InitialAssessmentData | null;
  patient: PatientChart;
  onSaveContact: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [editingContact, setEditingContact] = useState(false);

  if (!initialAssessment) {
    return (
      <Card>
        <p className="py-6 text-center text-sm text-slate-400">
          Este paciente no tiene una Valoración Individual registrada.
        </p>
      </Card>
    );
  }

  const a = initialAssessment;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle>Datos personales</SectionTitle>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <InfoRow label="Nombres y apellidos" value={a.nombresApellidos} />
          <InfoRow label="Tipo y número de documento" value={a.tipoDocumento ? `${a.tipoDocumento} ${a.numeroDocumento}` : a.numeroDocumento} />
          <InfoRow label="EPS" value={patient.epsNombre} />
          <InfoRow label="Régimen de salud" value={patient.regimenSalud} />
          <InfoRow label="Estado civil" value={patient.estadoCivil} />
          <InfoRow label="Sexo biológico / Género" value={[a.sexoBiologico, a.genero].filter(Boolean).join(' / ')} />
          <InfoRow label="Fecha de nacimiento" value={formatDate(a.fechaNacimiento)} />
          <InfoRow label="Lugar de nacimiento" value={a.lugarNacimiento} />
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle>Información sociodemográfica</SectionTitle>
          <button
            type="button" onClick={() => setEditingContact(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-toast-500 hover:text-toast-500"
          >
            <Pencil className="h-3.5 w-3.5" /> Editar
          </button>
        </div>
        <p className="mb-3 -mt-1 text-xs text-slate-400">Estos datos reflejan la situación actual del paciente — se pueden actualizar en cualquier momento, a diferencia del resto de la valoración, que queda fija tras la firma.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <InfoRow label="Orientación sexual" value={patient.orientacionSexual === 'Otro' ? patient.orientacionSexualOtro : patient.orientacionSexual} />
          <InfoRow label="Escolaridad" value={patient.escolaridad} />
          <InfoRow label="Ocupación" value={patient.ocupacion} />
          <InfoRow label="Estudia actualmente" value={patient.estudiaActualmente ? `Sí — ${[patient.semestreGradoTrimestre, patient.carrera].filter(Boolean).join(', ')}` : 'No'} />
          <InfoRow label="Correo electrónico" value={patient.email} />
          <InfoRow label="Teléfono" value={patient.phone} />
          <InfoRow label="Contacto de emergencia" value={a.telefonoEmergencia} />
          <InfoRow label="Dirección" value={[patient.direccionResidencia, patient.barrio].filter(Boolean).join(', ')} />
          <InfoRow label="Estrato" value={patient.estrato} />
        </div>
        {a.poblacionDiferencial?.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="mb-1.5 text-xs text-slate-400">Población diferencial</p>
            <div className="flex flex-wrap gap-1.5">
              {a.poblacionDiferencial.map((p) => (
                <span key={p} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{p}</span>
              ))}
            </div>
          </div>
        )}
      </Card>

      {editingContact && (
        <EditContactModal
          patient={patient}
          onClose={() => setEditingContact(false)}
          onSave={async (payload) => { await onSaveContact(payload); setEditingContact(false); }}
        />
      )}

      {a.requiereRepresentanteLegal && (
        <Card>
          <SectionTitle>Representante legal</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-100 p-3">
              <p className="mb-2 text-xs font-bold uppercase text-slate-400">Representante 1</p>
              <InfoRow label="Nombre" value={[a.legalRep1Nombres, a.legalRep1Apellidos].filter(Boolean).join(' ')} />
              <InfoRow label="Parentesco" value={a.legalRep1Parentesco} />
              <InfoRow label="Teléfono" value={a.legalRep1Telefono} />
              <InfoRow label="Correo" value={a.legalRep1Correo} />
            </div>
            {a.tieneSegundoRepresentante && (
              <div className="rounded-lg border border-slate-100 p-3">
                <p className="mb-2 text-xs font-bold uppercase text-slate-400">Representante 2</p>
                <InfoRow label="Nombre" value={[a.legalRep2Nombres, a.legalRep2Apellidos].filter(Boolean).join(' ')} />
                <InfoRow label="Parentesco" value={a.legalRep2Parentesco} />
                <InfoRow label="Teléfono" value={a.legalRep2Telefono} />
                <InfoRow label="Correo" value={a.legalRep2Correo} />
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle>Motivo y valoración conductual</SectionTitle>
        <div className="flex flex-col gap-3">
          <InfoRow label="Quién reporta el motivo" value={a.personaReportaMotivo} />
          <InfoRow label="Motivo de consulta" value={a.motivoConsulta} />
          <InfoRow label="Conducta objeto de valoración" value={a.conducta} />
          <div className="grid gap-4 sm:grid-cols-3">
            <InfoRow label="Duración" value={a.duracion} />
            <InfoRow label="Intensidad" value={a.intensidad} />
            <InfoRow label="Frecuencia" value={a.frecuencia} />
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>Contexto familiar y expectativas</SectionTitle>
        {a.householdMembers?.length > 0 && (
          <div className="mb-3">
            <p className="mb-1.5 text-xs text-slate-400">Personas con quienes vive</p>
            <ul className="flex flex-col gap-1">
              {a.householdMembers.map((m) => (
                <li key={m.id} className="text-sm text-slate-900">
                  {m.fullName} — {m.relationship}{m.age ? ` · ${m.age} años` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        <InfoRow label="Expectativas frente al proceso" value={a.expectativas} />
      </Card>

      <Card>
        <SectionTitle>Cierre profesional de la valoración</SectionTitle>
        {a.instrumentosAplicados?.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {a.instrumentosAplicados.map((i) => (
              <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{i}</span>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-3">
          <InfoRow label="Aspectos sobresalientes del APA" value={a.aspectosAPA} />
          <InfoRow label="Hipótesis preliminares" value={a.hipotesisPreliminares} />
        </div>
        {a.signedAt && (
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
            Valoración firmada por {a.signedByName} el {formatDateTime(a.signedAt)}.
          </p>
        )}
      </Card>
    </div>
  );
}

// ── Catálogos — mismas opciones que usa InitialAssessmentWizard, para que un
// valor editado aquí sea idéntico (no un texto libre parecido pero distinto)
// al que ya existe en valoraciones firmadas anteriores. ──
const REGIMEN_OPTIONS = ['Contributivo', 'Subsidiado', 'Especial — Fuerzas Militares, Policía Nacional, entre otros', 'Excepcional — PPL, entre otros'];
const ESTADO_CIVIL_OPTIONS = ['Soltero/a', 'Casado/a', 'Unión libre', 'Viudo/a', 'Divorciado/a'];
const ORIENTACION_OPTIONS = ['Heterosexual', 'Homosexual', 'Bisexual', 'Otro'];
const ESCOLARIDAD_OPTIONS = [
  'Primaria incompleta', 'Primaria completa', 'Bachillerato incompleto', 'Bachillerato completo',
  'Técnico / Tecnólogo incompleto', 'Técnico / Tecnólogo completo', 'Universitario incompleto',
  'Universitario completo', 'Posgrado',
];
const OCUPACION_OPTIONS = ['Empleado', 'Estudiante', 'Independiente', 'Pensionado', 'Desempleado', 'Hogar'];

function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select
      value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus:ring-2 focus:ring-toast-500"
    >
      <option value="">Seleccionar…</option>
      {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  );
}

interface EpsOption { code: string; nombre: string }

function EpsSelect({ codigo, nombre, onChange }: { codigo: string; nombre: string; onChange: (codigo: string, nombre: string) => void }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<EpsOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBase()}/api/eps?q=${encodeURIComponent(query.trim())}`, { headers: authHeaders() });
        if (res.ok) setOptions(await res.json());
      } catch {
        // silencioso — el usuario simplemente no ve resultados
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  if (codigo && nombre && !open) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm">
        <span><span className="font-mono font-semibold text-slate-700">{codigo}</span> — {nombre}</span>
        <button type="button" onClick={() => { setOpen(true); setQuery(''); }} className="text-xs font-semibold text-toast-500 hover:underline">Cambiar</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text" value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        placeholder="Buscar por código o nombre de EPS…"
        className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus:ring-2 focus:ring-toast-500"
      />
      {open && options.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.code} type="button"
              onClick={() => { onChange(opt.code, opt.nombre); setOpen(false); setQuery(''); }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
            >
              <span className="font-mono font-semibold text-slate-700">{opt.code}</span> — {opt.nombre}
            </button>
          ))}
        </div>
      )}
      {open && query.trim().length >= 2 && options.length === 0 && (
        <p className="mt-1 text-xs text-slate-400">Sin resultados — si la EPS no está en el catálogo, pide a un CEO/DIRECTIVO que la agregue desde AdminCenter.</p>
      )}
    </div>
  );
}

// Modal de edición de datos de contacto/sociodemográficos ACTUALES — la única
// parte de la ficha que se puede corregir después de firmada la Valoración
// Individual, ya que refleja la vida real del paciente (cambia de EPS, se
// muda, cambia de ocupación) y no un juicio clínico congelado en el tiempo.
function EditContactModal({ patient, onClose, onSave }: {
  patient: PatientChart;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    epsCodigo: patient.epsCodigo || '',
    epsNombre: patient.epsNombre || '',
    regimenSalud: patient.regimenSalud || '',
    estadoCivil: patient.estadoCivil || '',
    orientacionSexual: patient.orientacionSexual || '',
    orientacionSexualOtro: patient.orientacionSexualOtro || '',
    escolaridad: patient.escolaridad || '',
    ocupacion: patient.ocupacion || '',
    estudiaActualmente: patient.estudiaActualmente ?? false,
    semestreGradoTrimestre: patient.semestreGradoTrimestre || '',
    carrera: patient.carrera || '',
    email: patient.email || '',
    phone: patient.phone || '',
    direccionResidencia: patient.direccionResidencia || '',
    barrio: patient.barrio || '',
    estrato: patient.estrato != null ? String(patient.estrato) : '',
  });
  const [saving, setSaving] = useState(false);
  const update = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await onSave({
        ...form,
        estrato: form.estrato === '' ? null : Number(form.estrato),
      });
      toast.success('Datos actualizados.');
    } catch {
      toast.error('Error al guardar los cambios.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Editar datos actuales del paciente</h3>
            <p className="text-xs text-slate-400">No modifica la Valoración Individual firmada — solo el estado vigente del paciente.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-500">EPS</label>
              <EpsSelect codigo={form.epsCodigo} nombre={form.epsNombre} onChange={(codigo, nombre) => update({ epsCodigo: codigo, epsNombre: nombre })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Régimen de salud</label>
              <Select value={form.regimenSalud} options={REGIMEN_OPTIONS} onChange={(v) => update({ regimenSalud: v })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Estado civil</label>
              <Select value={form.estadoCivil} options={ESTADO_CIVIL_OPTIONS} onChange={(v) => update({ estadoCivil: v })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Orientación sexual</label>
              <Select value={form.orientacionSexual} options={ORIENTACION_OPTIONS} onChange={(v) => update({ orientacionSexual: v })} />
            </div>
            {form.orientacionSexual === 'Otro' && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">¿Cuál?</label>
                <input type="text" value={form.orientacionSexualOtro} onChange={(e) => update({ orientacionSexualOtro: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-toast-500" />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Escolaridad</label>
              <Select value={form.escolaridad} options={ESCOLARIDAD_OPTIONS} onChange={(v) => update({ escolaridad: v })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Ocupación</label>
              <Select value={form.ocupacion} options={OCUPACION_OPTIONS} onChange={(v) => update({ ocupacion: v })} />
            </div>

            <div className="flex items-center gap-2 pt-6">
              <input
                type="checkbox" id="estudia-actualmente" checked={form.estudiaActualmente}
                onChange={(e) => update({ estudiaActualmente: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-toast-500 focus:ring-toast-500"
              />
              <label htmlFor="estudia-actualmente" className="text-sm text-slate-700">Estudia actualmente</label>
            </div>
            {form.estudiaActualmente && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Semestre / Grado / Trimestre</label>
                  <input type="text" value={form.semestreGradoTrimestre} onChange={(e) => update({ semestreGradoTrimestre: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-toast-500" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Carrera / Programa</label>
                  <input type="text" value={form.carrera} onChange={(e) => update({ carrera: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-toast-500" />
                </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Correo electrónico</label>
              <input type="email" value={form.email} onChange={(e) => update({ email: e.target.value })}
                className="w-full rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-toast-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Teléfono</label>
              <input type="tel" value={form.phone} onChange={(e) => update({ phone: e.target.value })}
                className="w-full rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-toast-500" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-500">Dirección</label>
              <input type="text" value={form.direccionResidencia} onChange={(e) => update({ direccionResidencia: e.target.value })}
                className="w-full rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-toast-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Barrio</label>
              <input type="text" value={form.barrio} onChange={(e) => update({ barrio: e.target.value })}
                className="w-full rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-toast-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Estrato</label>
              <input type="number" min="1" max="6" value={form.estrato} onChange={(e) => update({ estrato: e.target.value })}
                className="w-full rounded-lg border border-slate-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-toast-500" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="button" onClick={handleSubmit} disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-toast-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-toast-600 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar cambios
          </button>
        </div>
      </div>
    </div>
  );
}

function EvaluacionesTab({ patientId, assessments, riskEvents, onChange }: {
  patientId: string;
  assessments: Assessment[];
  riskEvents: RiskEvent[];
  onChange: (next: Assessment[]) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [score, setScore] = useState('');
  const [interpretation, setInterpretation] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // ── Aplicar una prueba desde la ficha ────────────────────────────────────
  // Es el punto de entrada natural para las escalas heteroaplicadas: el
  // profesional está aquí durante la sesión, con el paciente delante. Ir al
  // catálogo a buscarla rompe el flujo de la consulta.
  const [pendientes, setPendientes] = useState<PendingAdministration[]>([]);
  const [runnerId, setRunnerId] = useState<string | null>(null);

  const cargarPendientes = useCallback(async () => {
    try {
      const res = await fetch(
        `${apiBase()}/api/assessments/administrations?patientId=${patientId}`,
        { headers: authHeaders() }
      );
      if (!res.ok) return;
      const data = await res.json();
      setPendientes(
        (data.administrations || []).filter((a: PendingAdministration) => a.status !== 'COMPLETED')
      );
    } catch (err) {
      console.error('[EvaluacionesTab] Error cargando pendientes:', err);
    }
  }, [patientId]);

  useEffect(() => { cargarPendientes(); }, [cargarPendientes]);

  const addAssessment = async () => {
    if (!name.trim() || !score.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBase()}/api/patients/${patientId}/assessments`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ name: name.trim(), date, score: score.trim(), interpretation: interpretation.trim() }),
      });
      if (!res.ok) throw new Error('failed');
      const { assessment } = await res.json();
      onChange([assessment, ...assessments]);
      setName(''); setScore(''); setInterpretation(''); setShowForm(false);
    } catch {
      toast.error('Error al agregar la evaluación');
    } finally {
      setSaving(false);
    }
  };

  const removeAssessment = async (id: string) => {
    try {
      const res = await fetch(`${apiBase()}/api/patients/assessments/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error('failed');
      onChange(assessments.filter((a) => a.id !== id));
    } catch {
      toast.error('Error al eliminar la evaluación');
    }
  };

  // Seguimiento de progreso: para cada evaluación, compara contra la
  // aplicación INMEDIATAMENTE ANTERIOR del mismo instrumento (mismo `name`).
  // `assessments` ya viene ordenado por fecha desc, así que la anterior es la
  // siguiente coincidencia en el array. Convención de color: en los
  // instrumentos de severidad ya usados en la app (BDI-II, GAD-7...) un
  // puntaje más alto es peor — igual criterio que la escalada de riesgo de
  // arriba (bajo→alto = subida de puntaje).
  const trendByAssessmentId = useMemo(() => {
    const map = new Map<string, { delta: number; previousDate: string }>();
    assessments.forEach((a, i) => {
      const current = parseScoreValue(a.score);
      if (current === null) return;
      const previous = assessments.slice(i + 1).find((p) => p.name === a.name);
      if (!previous) return;
      const previousValue = parseScoreValue(previous.score);
      if (previousValue === null) return;
      map.set(a.id, { delta: current - previousValue, previousDate: previous.date });
    });
    return map;
  }, [assessments]);

  // Un mismo instrumento aplicado varias veces (ej. 3 BDI-II en un mes) queda
  // disperso si se lista todo junto por fecha global, mezclado con las demás
  // pruebas — se agrupa por `name` para que cada instrumento tenga su propia
  // línea de tiempo. `assessments` ya viene ordenado desc, así que dentro de
  // cada grupo también queda desc (más reciente primero).
  const groups = useMemo(() => {
    const map = new Map<string, Assessment[]>();
    assessments.forEach((a) => {
      const list = map.get(a.name) || [];
      list.push(a);
      map.set(a.name, list);
    });
    return Array.from(map.values())
      .map((items) => ({ name: items[0].name, items }))
      .sort((a, b) => new Date(b.items[0].date).getTime() - new Date(a.items[0].date).getTime());
  }, [assessments]);

  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  if (runnerId) {
    return (
      <AssessmentRunner
        administrationId={runnerId}
        onBack={() => { setRunnerId(null); cargarPendientes(); }}
        onCompleted={() => { cargarPendientes(); }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Pruebas pendientes de aplicar a ESTE paciente. Para una escala
          heteroaplicada esto es la puerta principal: se aplica en la sesión. */}
      {pendientes.length > 0 && (
        <div className="rounded-xl border border-toast-200 bg-toast-50/50 p-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-toast-500">
            Pruebas pendientes de aplicar ({pendientes.length})
          </p>
          <div className="space-y-2">
            {pendientes.map((a) => {
              const hetero = a.instrument.modality === 'heteroaplicada';
              return (
                <button
                  key={a.id}
                  onClick={() => setRunnerId(a.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-toast-500"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {a.instrument.nameEs || a.instrument.name}
                    </span>
                    <span className="text-xs text-slate-500">
                      {a.instrument.code} · asignada {formatDate(a.assignedAt)}
                      {a.status === 'IN_PROGRESS' && ' · en progreso'}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-md bg-toast-500 px-3 py-1.5 text-[10px] font-bold uppercase text-white">
                    {hetero ? 'Aplicar en consulta' : 'Aplicar'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Escaladas automáticas de riesgo. Van primero y con peso visual: el
          badge de la cabecera cambió solo, y esto explica por qué. */}
      {riskEvents.map((ev) => (
        <div
          key={ev.id}
          className={`rounded-xl border-2 p-4 ${
            ev.newLevel === 'alto'
              ? 'border-red-300 bg-red-50'
              : 'border-amber-200 bg-amber-50'
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${
              ev.newLevel === 'alto' ? 'text-red-600' : 'text-amber-600'
            }`} />
            <div className="flex-1">
              <p className={`text-xs font-bold uppercase tracking-wide ${
                ev.newLevel === 'alto' ? 'text-red-700' : 'text-amber-700'
              }`}>
                Riesgo {ev.previousLevel} → {ev.newLevel}
                {ev.instrumentCode && ` · ${ev.instrumentCode}`}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-800">{ev.reason}</p>
              <p className="mt-1.5 text-xs text-slate-500">{formatDate(ev.createdAt)}</p>
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={() => setShowForm((v) => !v)}
        className="inline-flex w-fit items-center gap-2 rounded-lg bg-toast-500 px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        <Plus className="h-4 w-4" /> Registrar evaluación
      </button>

      {showForm && (
        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la prueba (ej. GAD-7)"
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-toast-500" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-toast-500" />
            <input value={score} onChange={(e) => setScore(e.target.value)} placeholder="Puntaje (ej. 11 / 21)"
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-toast-500" />
            <input value={interpretation} onChange={(e) => setInterpretation(e.target.value)} placeholder="Interpretación breve"
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-toast-500" />
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={addAssessment} disabled={saving}
              className="rounded-lg bg-toast-500 px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar evaluación'}
            </button>
          </div>
        </Card>
      )}

      {assessments.length === 0 && !showForm && (
        <Card>
          <p className="py-6 text-center text-sm text-slate-400">
            No hay evaluaciones registradas. Aplique una prueba desde el módulo "Pruebas y Evaluaciones".
          </p>
        </Card>
      )}

      {groups.map((group) => {
        const latest = group.items[0];
        const latestTrend = trendByAssessmentId.get(latest.id);
        const hasHistory = group.items.length > 1;
        const expanded = hasHistory && expandedGroups.has(group.name);
        return (
          <Card key={group.name}>
            <div className="flex items-start justify-between gap-3">
              <div
                className={`flex items-center gap-2 ${hasHistory ? 'cursor-pointer' : ''}`}
                onClick={() => hasHistory && toggleGroup(group.name)}
              >
                <ClipboardList className="h-5 w-5 text-toast-500" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">{group.name}</p>
                    {hasHistory && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                        {group.items.length} aplicaciones
                      </span>
                    )}
                    {hasHistory && (
                      <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    )}
                  </div>
                  <p className="text-xs text-slate-400">Última: {formatDate(latest.date)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-toast-100 px-3 py-1 text-sm font-bold text-toast-500">{latest.score}</span>
                <button onClick={() => removeAssessment(latest.id)} className="text-slate-400 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            {latestTrend && <TrendBadge trend={latestTrend} />}
            {latest.interpretation && <p className="mt-3 text-sm leading-relaxed text-slate-900">{latest.interpretation}</p>}

            {expanded && (
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                {group.items.slice(1).map((ev) => {
                  const trend = trendByAssessmentId.get(ev.id);
                  return (
                    <div key={ev.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs font-semibold text-slate-500">{formatDate(ev.date)}</p>
                        <div className="flex items-center gap-2">
                          <span className="rounded-lg border border-toast-200 bg-white px-2.5 py-0.5 text-xs font-bold text-toast-500">
                            {ev.score}
                          </span>
                          <button onClick={() => removeAssessment(ev.id)} className="text-slate-400 hover:text-red-600">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {trend && <TrendBadge trend={trend} compact />}
                      {ev.interpretation && <p className="mt-1.5 text-xs leading-relaxed text-slate-700">{ev.interpretation}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function TrendBadge({ trend, compact }: { trend: { delta: number; previousDate: string }; compact?: boolean }) {
  const colorClass = trend.delta > 0
    ? 'bg-red-50 text-red-600'
    : trend.delta < 0
    ? 'bg-emerald-50 text-emerald-600'
    : 'bg-slate-100 text-slate-500';
  return (
    <div className={`mt-2.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-semibold ${colorClass} ${compact ? 'text-[11px]' : 'text-xs'}`}>
      {trend.delta > 0 ? (
        <TrendingUp className="h-3.5 w-3.5" />
      ) : trend.delta < 0 ? (
        <TrendingDown className="h-3.5 w-3.5" />
      ) : (
        <Minus className="h-3.5 w-3.5" />
      )}
      {trend.delta === 0 ? 'Sin cambio' : `${trend.delta > 0 ? '+' : ''}${trend.delta} pts`} desde el {formatDate(trend.previousDate)}
    </div>
  );
}

