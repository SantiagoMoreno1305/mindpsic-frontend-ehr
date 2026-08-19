import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  ArrowLeft, Phone, Mail, CalendarClock, ClipboardList,
  Plus, Trash2, Loader2, Pencil, X,
} from 'lucide-react';
import ClinicalHistoryEditor from './ClinicalHistoryEditor';
import ClinicalAttachments from './ClinicalAttachments';
import InitialAssessmentWizard from './InitialAssessmentWizard';

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
  legalRep1Nombre?: string | null;
  legalRep1Parentesco?: string | null;
  legalRep1Telefono?: string | null;
  legalRep1Correo?: string | null;
  tieneSegundoRepresentante: boolean;
  legalRep2Nombre?: string | null;
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

interface ChartResponse {
  patient: PatientChart;
  ripsDiagnosis: RipsDiagnosis | null;
  assessments: Assessment[];
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

function calcAge(birthDate?: string | null) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

export default function ClinicalPatientChart({ patientId, onBack }: { patientId: string; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('resumen');
  const [data, setData] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const fetchChart = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase()}/api/patients/${patientId}/chart`, { headers: authHeaders() });
      if (res.ok) setData(await res.json());
      else toast.error('Error al cargar la ficha clínica');
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
      if (!res.ok) throw new Error('failed');
    } catch {
      toast.error('Error al guardar los cambios');
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
    if (!res.ok) throw new Error('failed');
    const { patient: updated } = await res.json();
    updateLocalPatient(updated);
  };

  if (loading || !data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-toast-500" />
      </div>
    );
  }

  const { patient, ripsDiagnosis, assessments, firstSession, lastSession, nextAppointment, initialAssessment, initialAssessmentGate } = data;
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
          {nextAppointment && (
            <div className="flex items-center gap-2 rounded-lg bg-toast-100 px-3 py-2 text-sm text-toast-500">
              <CalendarClock className="h-4 w-4" />
              <span className="font-medium">Próxima cita: {formatDateTime(nextAppointment)}</span>
            </div>
          )}
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
            assessments={assessments}
            onChange={(next) => setData((prev) => (prev ? { ...prev, assessments: next } : prev))}
          />
        )}
        {tab === 'anexos' && <ClinicalAttachments patientId={patientId} />}
      </div>
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
  { value: 'activo', label: 'Activo', className: 'border-emerald-600/30 bg-emerald-50 text-emerald-600' },
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
              <InfoRow label="Nombre" value={a.legalRep1Nombre} />
              <InfoRow label="Parentesco" value={a.legalRep1Parentesco} />
              <InfoRow label="Teléfono" value={a.legalRep1Telefono} />
              <InfoRow label="Correo" value={a.legalRep1Correo} />
            </div>
            {a.tieneSegundoRepresentante && (
              <div className="rounded-lg border border-slate-100 p-3">
                <p className="mb-2 text-xs font-bold uppercase text-slate-400">Representante 2</p>
                <InfoRow label="Nombre" value={a.legalRep2Nombre} />
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

function EvaluacionesTab({ patientId, assessments, onChange }: { patientId: string; assessments: Assessment[]; onChange: (next: Assessment[]) => void }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [score, setScore] = useState('');
  const [interpretation, setInterpretation] = useState('');
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="flex flex-col gap-3">
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

      {assessments.map((ev) => (
        <Card key={ev.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-toast-500" />
              <div>
                <p className="font-semibold text-slate-900">{ev.name}</p>
                <p className="text-xs text-slate-400">{formatDate(ev.date)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-toast-100 px-3 py-1 text-sm font-bold text-toast-500">{ev.score}</span>
              <button onClick={() => removeAssessment(ev.id)} className="text-slate-400 hover:text-red-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          {ev.interpretation && <p className="mt-3 text-sm leading-relaxed text-slate-900">{ev.interpretation}</p>}
        </Card>
      ))}
    </div>
  );
}

