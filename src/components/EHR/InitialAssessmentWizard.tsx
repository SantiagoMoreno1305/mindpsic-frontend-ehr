import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Loader2, ShieldCheck, Plus, Trash2, ChevronLeft, ChevronRight, Upload, Send, CheckCircle2, RefreshCw } from 'lucide-react';
import { COLOMBIA_DEPARTAMENTOS, DEPARTAMENTOS_ORDENADOS } from '../../data/colombiaData';
import { confirmToast } from '../../lib/confirmToast';

interface HouseholdMember {
  id: string;
  fullName: string;
  relationship: string;
  age?: number | null;
}

interface AssessmentForm {
  nombresPaciente: string;
  apellidosPaciente: string;
  epsNombre: string;
  epsCodigo: string;
  regimenSalud: string;
  tipoDocumento: string;
  numeroDocumento: string;
  estadoCivil: string;
  sexoBiologico: string;
  genero: string;
  fechaNacimiento: string;
  lugarNacimiento: string;
  departamentoNacimiento: string;
  ciudadNacimiento: string;

  orientacionSexual: string;
  orientacionSexualOtro: string;
  escolaridad: string;
  poblacionDiferencial: string[];
  poblacionDiferencialOtro: string;
  estudiaActualmente: boolean | null;
  semestreGradoTrimestre: string;
  carrera: string;
  ocupacion: string;
  correoElectronico: string;
  direccionResidencia: string;
  departamentoResidencia: string;
  ciudadResidencia: string;
  barrio: string;
  estrato: string;
  telefono: string;

  requiereRepresentanteLegal: boolean;
  legalRep1Nombre: string;
  legalRep1Parentesco: string;
  legalRep1Telefono: string;
  legalRep1Correo: string;
  tieneSegundoRepresentante: boolean;
  legalRep2Nombre: string;
  legalRep2Parentesco: string;
  legalRep2Telefono: string;
  legalRep2Correo: string;

  personaReportaMotivo: string;
  motivoConsulta: string;
  conducta: string;
  duracion: string;
  intensidad: string;
  frecuencia: string;

  expectativas: string;
  contactoEmergenciaNombres: string;
  contactoEmergenciaApellidos: string;
  contactoEmergenciaTelefono: string;
  contactoEmergenciaParentesco: string;

  instrumentosAplicados: string[];
  anexoInstrumentosDocId: string;
  aspectosAPA: string;
  hipotesisPreliminares: string;
  tipoConsentimiento: string;
  anexoConsentimientoDocId: string;
}

const EMPTY_FORM: AssessmentForm = {
  nombresPaciente: '', apellidosPaciente: '', epsNombre: '', epsCodigo: '', regimenSalud: '', tipoDocumento: '', numeroDocumento: '',
  estadoCivil: '', sexoBiologico: '', genero: '', fechaNacimiento: '', lugarNacimiento: '',
  departamentoNacimiento: '', ciudadNacimiento: '',
  orientacionSexual: '', orientacionSexualOtro: '', escolaridad: '', poblacionDiferencial: [], poblacionDiferencialOtro: '',
  estudiaActualmente: null, semestreGradoTrimestre: '', carrera: '', ocupacion: '',
  correoElectronico: '', direccionResidencia: '', departamentoResidencia: '', ciudadResidencia: '',
  barrio: '', estrato: '', telefono: '',
  requiereRepresentanteLegal: false, legalRep1Nombre: '', legalRep1Parentesco: '', legalRep1Telefono: '', legalRep1Correo: '',
  tieneSegundoRepresentante: false, legalRep2Nombre: '', legalRep2Parentesco: '', legalRep2Telefono: '', legalRep2Correo: '',
  personaReportaMotivo: '', motivoConsulta: '', conducta: '', duracion: '', intensidad: '', frecuencia: '',
  expectativas: '',
  contactoEmergenciaNombres: '', contactoEmergenciaApellidos: '', contactoEmergenciaTelefono: '', contactoEmergenciaParentesco: '',
  instrumentosAplicados: [], anexoInstrumentosDocId: '', aspectosAPA: '', hipotesisPreliminares: '',
  tipoConsentimiento: '', anexoConsentimientoDocId: '',
};

const REGIMEN_OPTIONS = ['Contributivo', 'Subsidiado', 'Especial — Fuerzas Militares, Policía Nacional, entre otros', 'Excepcional — PPL, entre otros'];
const TIPO_DOC_OPTIONS = ['CC', 'TI', 'PEP', 'PA', 'CE'];
const ESTADO_CIVIL_OPTIONS = ['Soltero/a', 'Casado/a', 'Unión libre', 'Viudo/a', 'Divorciado/a'];
const SEXO_OPTIONS = ['Hombre', 'Mujer', 'Intersexual'];
const GENERO_OPTIONS = ['Masculino', 'Femenino', 'Intersexual'];
const ORIENTACION_OPTIONS = ['Heterosexual', 'Homosexual', 'Bisexual', 'Otro'];
const ESCOLARIDAD_OPTIONS = [
  'Primaria incompleta', 'Primaria completa', 'Bachillerato incompleto', 'Bachillerato completo',
  'Técnico / Tecnólogo incompleto', 'Técnico / Tecnólogo completo', 'Universitario incompleto',
  'Universitario completo', 'Posgrado',
];
const POBLACION_OPTIONS = ['No aplica', 'LGBTQ+', 'Persona con discapacidad', 'ROM / Gitanos', 'Mujer', 'Indígena', 'NARP — Negro, Afro, Raizal o Palenquero'];
const OCUPACION_OPTIONS = ['Empleado', 'Estudiante', 'Independiente', 'Pensionado', 'Desempleado', 'Hogar'];
const REPORTA_OPTIONS = ['Usuario', 'Representante legal'];
const INSTRUMENTOS_OPTIONS = ['SISEVECOS', 'VESPA', 'SIVIM', 'Plan de seguridad'];
const CONSENTIMIENTO_OPTIONS = ['Consentimiento informado', 'Asentimiento informado'];
const PARENTESCO_OPTIONS = ['Madre', 'Padre', 'Hermano/a', 'Cónyuge / Pareja', 'Hijo/a', 'Abuelo/a', 'Tutor legal', 'Otro'];

const STEPS = [
  'Datos personales',
  'Sociodemográfico',
  'Representante legal',
  'Motivo y conducta',
  'Contexto familiar',
  'Cierre profesional',
];

function apiBase() {
  return import.meta.env.VITE_API_URL || 'http://localhost:9000';
}
function authHeaders() {
  const token = localStorage.getItem('mind_token');
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}
function calcAge(birthDate: string) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

export default function InitialAssessmentWizard({
  patientId, patientFirstName, patientLastName, patientDocumentId, patientDocumentType,
  patientBirthDate, patientEmail, patientPhone, onComplete,
}: {
  patientId: string; patientFirstName?: string; patientLastName?: string; patientDocumentId?: string; patientDocumentType?: string | null;
  patientBirthDate?: string | null; patientEmail?: string | null; patientPhone?: string | null; onComplete: () => void;
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<AssessmentForm>(EMPTY_FORM);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRelationship, setNewMemberRelationship] = useState('');
  const [newMemberAge, setNewMemberAge] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [sendingConsentLink, setSendingConsentLink] = useState(false);
  const [consentLinkSentAt, setConsentLinkSentAt] = useState<Date | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchAssessment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const fetchAssessment = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase()}/api/initial-assessment/${patientId}`, { headers: authHeaders() });
      if (res.ok) {
        const { assessment } = await res.json();
        if (assessment) {
          setForm({
            ...EMPTY_FORM,
            ...assessment,
            // Si la valoración aún no tiene su propio dato editado, se
            // prellena con lo YA REGISTRADO al crear el paciente (antes solo
            // se hacía con nombre/documento — fecha de nacimiento, correo y
            // teléfono quedaban en blanco aunque ya existieran).
            nombresPaciente: assessment.nombresPaciente || patientFirstName || '',
            apellidosPaciente: assessment.apellidosPaciente || patientLastName || '',
            numeroDocumento: assessment.numeroDocumento || patientDocumentId || '',
            tipoDocumento: assessment.tipoDocumento || patientDocumentType || '',
            fechaNacimiento: assessment.fechaNacimiento
              ? assessment.fechaNacimiento.slice(0, 10)
              : (patientBirthDate ? patientBirthDate.slice(0, 10) : ''),
            correoElectronico: assessment.correoElectronico || patientEmail || '',
            telefono: assessment.telefono || patientPhone || '',
            estrato: assessment.estrato?.toString() || '',
            poblacionDiferencial: assessment.poblacionDiferencial || [],
            instrumentosAplicados: assessment.instrumentosAplicados || [],
          });
          setMembers(assessment.householdMembers || []);
        } else {
          setForm({
            ...EMPTY_FORM,
            nombresPaciente: patientFirstName || '',
            apellidosPaciente: patientLastName || '',
            numeroDocumento: patientDocumentId || '',
            tipoDocumento: patientDocumentType || '',
            fechaNacimiento: patientBirthDate ? patientBirthDate.slice(0, 10) : '',
            correoElectronico: patientEmail || '',
            telefono: patientPhone || '',
          });
        }
      }
    } catch {
      toast.error('Error al cargar la valoración individual');
    } finally {
      setLoading(false);
    }
  };

  const scheduleSave = (next: AssessmentForm) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveDraft(next), 1200);
  };

  const saveDraft = async (data: AssessmentForm) => {
    setSaving(true);
    try {
      const res = await fetch(`${apiBase()}/api/initial-assessment/${patientId}`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ ...data, estrato: data.estrato === '' ? null : Number(data.estrato) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Error al guardar');
      }
    } catch {
      toast.error('Error de red al guardar');
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<AssessmentForm>) => {
    const next = { ...form, ...patch };
    setForm(next);
    scheduleSave(next);
  };

  const toggleMulti = (field: 'poblacionDiferencial' | 'instrumentosAplicados', value: string) => {
    const current = form[field];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    update({ [field]: next } as Partial<AssessmentForm>);
  };

  const addMember = async () => {
    if (!newMemberName.trim() || !newMemberRelationship.trim()) return;
    try {
      const res = await fetch(`${apiBase()}/api/initial-assessment/${patientId}/household`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ fullName: newMemberName.trim(), relationship: newMemberRelationship.trim(), age: newMemberAge || null }),
      });
      if (!res.ok) throw new Error();
      const member = await res.json();
      setMembers((prev) => [...prev, member]);
      setNewMemberName(''); setNewMemberRelationship(''); setNewMemberAge('');
    } catch {
      toast.error('Error al agregar la persona');
    }
  };

  const removeMember = async (id: string) => {
    try {
      const res = await fetch(`${apiBase()}/api/initial-assessment/household/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error();
      setMembers((prev) => prev.filter((m) => m.id !== id));
    } catch {
      toast.error('Error al eliminar la persona');
    }
  };

  // Chequeo liviano de si el paciente ya firmó — a propósito NO reusa
  // fetchAssessment() (esa sobreescribe TODO el form con lo que haya en el
  // servidor, incluido lo que el psicólogo esté escribiendo ahora mismo y
  // que el autoguardado con debounce todavía no mandó). Aquí solo se toman
  // los 2 campos del consentimiento y se mezclan, el resto del form no se toca.
  const [checkingConsent, setCheckingConsent] = useState(false);
  const checkConsentStatus = async (opts: { silent?: boolean } = {}) => {
    setCheckingConsent(true);
    try {
      const res = await fetch(`${apiBase()}/api/initial-assessment/${patientId}`, { headers: authHeaders() });
      if (!res.ok) return;
      const { assessment } = await res.json();
      if (assessment?.anexoConsentimientoDocId && !form.anexoConsentimientoDocId) {
        update({ anexoConsentimientoDocId: assessment.anexoConsentimientoDocId, tipoConsentimiento: assessment.tipoConsentimiento || form.tipoConsentimiento });
        toast.success('✅ El paciente ya firmó su consentimiento');
      } else if (!opts.silent) {
        toast('Todavía no hay firma registrada', { icon: '⏳' });
      }
    } catch {
      if (!opts.silent) toast.error('No se pudo consultar el estado');
    } finally {
      setCheckingConsent(false);
    }
  };

  // Mientras haya un enlace enviado y sin firmar, revisa cada 20s — se
  // detiene solo (sin más peticiones) apenas llega el anexo.
  useEffect(() => {
    if (!consentLinkSentAt || form.anexoConsentimientoDocId) return;
    const id = setInterval(() => checkConsentStatus({ silent: true }), 20000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consentLinkSentAt, form.anexoConsentimientoDocId]);

  const handleSendConsentLink = async (force = false) => {
    if (!form.tipoConsentimiento) {
      toast.error('Selecciona primero el tipo de consentimiento o asentimiento');
      return;
    }
    setSendingConsentLink(true);
    try {
      // El enlace firma sobre el borrador ya guardado en el servidor (la
      // Valoración Individual se resuelve por patientId, igual que el resto
      // de este formulario) — se asegura de que exista antes de enviar.
      await saveDraft(form);
      const res = await fetch(`${apiBase()}/api/consent/tokens`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ patientId, consentType: form.tipoConsentimiento, force }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setSendingConsentLink(false);
        const confirmed = await confirmToast(
          `${data.error || 'Este paciente ya tiene un consentimiento firmado.'}\n\n¿Enviar de todas formas un enlace nuevo?`,
          { confirmLabel: 'Enviar de todas formas', cancelLabel: 'Cancelar' }
        );
        if (confirmed) await handleSendConsentLink(true);
        return;
      }
      if (!res.ok) {
        toast.error(data.error || 'No se pudo enviar el enlace de firma');
        return;
      }
      const sentTo = data.sentTo?.email || data.sentTo?.phone;
      toast.success(sentTo ? `Enlace enviado a ${sentTo}` : 'Enlace generado — el paciente no tiene correo ni celular registrado');
      setConsentLinkSentAt(new Date());
    } catch {
      toast.error('Error de red al enviar el enlace de firma');
    } finally {
      setSendingConsentLink(false);
    }
  };

  const handleSign = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSigning(true);
    try {
      await saveDraft(form);
      const res = await fetch(`${apiBase()}/api/initial-assessment/${patientId}/sign`, { method: 'POST', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Faltan campos obligatorios para firmar');
        return;
      }
      toast.success('✅ Valoración Individual completada');
      onComplete();
    } catch {
      toast.error('Error de red al firmar la valoración');
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-toast-500" />
      </div>
    );
  }

  const age = calcAge(form.fechaNacimiento);
  const isLastStep = step === STEPS.length - 1;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Valoración Individual (MINDPVAL-CLIN-03)</h1>
        <p className="mt-1 text-sm text-slate-400">
          Este formulario es obligatorio antes de acceder a la ficha clínica completa del paciente.
        </p>
      </div>

      {/* Indicador de pasos */}
      <div className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              i === step ? 'bg-charcoal-900 text-white' : i < step ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-white text-slate-400 border border-slate-200'
            }`}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombres *">
              <Input value={form.nombresPaciente} onChange={(v) => update({ nombresPaciente: v })} />
            </Field>
            <Field label="Apellidos *">
              <Input value={form.apellidosPaciente} onChange={(v) => update({ apellidosPaciente: v })} />
            </Field>
            <Field label="Entidad prestadora de servicios de salud (EPS) *">
              <EpsSelect
                codigo={form.epsCodigo}
                nombre={form.epsNombre}
                onChange={(codigo, nombre) => update({ epsCodigo: codigo, epsNombre: nombre })}
              />
            </Field>
            <Field label="Régimen de salud">
              <Select value={form.regimenSalud} options={REGIMEN_OPTIONS} onChange={(v) => update({ regimenSalud: v })} />
            </Field>
            <Field label="Tipo de documento *">
              <Select value={form.tipoDocumento} options={TIPO_DOC_OPTIONS} onChange={(v) => update({ tipoDocumento: v })} />
            </Field>
            <Field label="Número de documento *">
              <Input value={form.numeroDocumento} onChange={(v) => update({ numeroDocumento: v.trim() })} />
            </Field>
            <Field label="Estado civil">
              <Select value={form.estadoCivil} options={ESTADO_CIVIL_OPTIONS} onChange={(v) => update({ estadoCivil: v })} />
            </Field>
            <Field label="Sexo biológico *">
              <Select value={form.sexoBiologico} options={SEXO_OPTIONS} onChange={(v) => update({ sexoBiologico: v })} />
            </Field>
            <Field label="Género">
              <Select value={form.genero} options={GENERO_OPTIONS} onChange={(v) => update({ genero: v })} />
            </Field>
            <Field label="Fecha de nacimiento *">
              <input
                type="date" value={form.fechaNacimiento} max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => update({ fechaNacimiento: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </Field>
            <Field label="Edad actual (calculada)">
              <input disabled value={age !== null ? `${age} años` : '—'} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-500" />
            </Field>
            <Field label="Lugar de nacimiento — Departamento">
              <Select
                value={form.departamentoNacimiento}
                options={DEPARTAMENTOS_ORDENADOS}
                onChange={(v) => update({ departamentoNacimiento: v, ciudadNacimiento: '' })}
              />
            </Field>
            <Field label="Lugar de nacimiento — Ciudad / Municipio">
              <Select
                value={form.ciudadNacimiento}
                options={form.departamentoNacimiento ? (COLOMBIA_DEPARTAMENTOS[form.departamentoNacimiento] ?? []) : []}
                onChange={(v) => update({ ciudadNacimiento: v })}
                disabled={!form.departamentoNacimiento}
                placeholder={form.departamentoNacimiento ? undefined : 'Seleccione primero el departamento'}
              />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Orientación sexual">
              <Select value={form.orientacionSexual} options={ORIENTACION_OPTIONS} onChange={(v) => update({ orientacionSexual: v })} />
            </Field>
            {form.orientacionSexual === 'Otro' && (
              <Field label="¿Cuál?">
                <Input value={form.orientacionSexualOtro} onChange={(v) => update({ orientacionSexualOtro: v })} />
              </Field>
            )}
            <Field label="Nivel máximo de escolaridad" span2>
              <Select value={form.escolaridad} options={ESCOLARIDAD_OPTIONS} onChange={(v) => update({ escolaridad: v })} />
            </Field>
            <Field label="Población diferencial" span2>
              <div className="flex flex-wrap gap-2">
                {POBLACION_OPTIONS.map((opt) => (
                  <Chip key={opt} label={opt} active={form.poblacionDiferencial.includes(opt)} onClick={() => toggleMulti('poblacionDiferencial', opt)} />
                ))}
                <Chip label="Otro" active={form.poblacionDiferencial.includes('Otro')} onClick={() => toggleMulti('poblacionDiferencial', 'Otro')} />
              </div>
            </Field>
            {form.poblacionDiferencial.includes('Otro') && (
              <Field label="Población diferencial — ¿Cuál?" span2>
                <Input value={form.poblacionDiferencialOtro} onChange={(v) => update({ poblacionDiferencialOtro: v })} />
              </Field>
            )}
            <Field label="¿Estudia actualmente?">
              <YesNo value={form.estudiaActualmente} onChange={(v) => update({ estudiaActualmente: v })} />
            </Field>
            <Field label="Ocupación">
              <Select value={form.ocupacion} options={OCUPACION_OPTIONS} onChange={(v) => update({ ocupacion: v })} />
            </Field>
            {form.estudiaActualmente && (
              <>
                <Field label="Semestre / grado / trimestre">
                  <Input value={form.semestreGradoTrimestre} onChange={(v) => update({ semestreGradoTrimestre: v })} />
                </Field>
                <Field label="Carrera">
                  <Input value={form.carrera} onChange={(v) => update({ carrera: v })} />
                </Field>
              </>
            )}
            <Field label="Correo electrónico">
              <Input type="email" value={form.correoElectronico} onChange={(v) => update({ correoElectronico: v })} />
            </Field>
            <Field label="Teléfono celular o fijo">
              <Input value={form.telefono} onChange={(v) => update({ telefono: v })} />
            </Field>
            <Field label="Dirección de residencia">
              <Input value={form.direccionResidencia} onChange={(v) => update({ direccionResidencia: v })} />
            </Field>
            <Field label="Residencia — Departamento *">
              <Select
                value={form.departamentoResidencia}
                options={DEPARTAMENTOS_ORDENADOS}
                onChange={(v) => update({ departamentoResidencia: v, ciudadResidencia: '' })}
              />
            </Field>
            <Field label="Residencia — Ciudad / Municipio *">
              <Select
                value={form.ciudadResidencia}
                options={form.departamentoResidencia ? (COLOMBIA_DEPARTAMENTOS[form.departamentoResidencia] ?? []) : []}
                onChange={(v) => update({ ciudadResidencia: v })}
                disabled={!form.departamentoResidencia}
                placeholder={form.departamentoResidencia ? undefined : 'Seleccione primero el departamento'}
              />
            </Field>
            <Field label="Barrio">
              <Input value={form.barrio} onChange={(v) => update({ barrio: v })} />
            </Field>
            <Field label="Estrato">
              <input
                type="number" min={0} max={6} value={form.estrato}
                onChange={(e) => update({ estrato: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <Field label="¿El usuario es menor de edad o requiere representante legal?">
              <YesNo value={form.requiereRepresentanteLegal} onChange={(v) => update({ requiereRepresentanteLegal: !!v })} />
            </Field>

            {form.requiereRepresentanteLegal && (
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Representante legal 1</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nombre completo"><Input value={form.legalRep1Nombre} onChange={(v) => update({ legalRep1Nombre: v })} /></Field>
                  <Field label="Parentesco"><Input value={form.legalRep1Parentesco} onChange={(v) => update({ legalRep1Parentesco: v })} /></Field>
                  <Field label="Teléfono / celular"><Input value={form.legalRep1Telefono} onChange={(v) => update({ legalRep1Telefono: v })} /></Field>
                  <Field label="Correo electrónico"><Input type="email" value={form.legalRep1Correo} onChange={(v) => update({ legalRep1Correo: v })} /></Field>
                </div>

                <div className="mt-4">
                  <Field label="¿Existe un segundo representante legal?">
                    <YesNo value={form.tieneSegundoRepresentante} onChange={(v) => update({ tieneSegundoRepresentante: !!v })} />
                  </Field>
                </div>

                {form.tieneSegundoRepresentante && (
                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Representante legal 2</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Nombre completo"><Input value={form.legalRep2Nombre} onChange={(v) => update({ legalRep2Nombre: v })} /></Field>
                      <Field label="Parentesco"><Input value={form.legalRep2Parentesco} onChange={(v) => update({ legalRep2Parentesco: v })} /></Field>
                      <Field label="Teléfono / celular"><Input value={form.legalRep2Telefono} onChange={(v) => update({ legalRep2Telefono: v })} /></Field>
                      <Field label="Correo electrónico"><Input type="email" value={form.legalRep2Correo} onChange={(v) => update({ legalRep2Correo: v })} /></Field>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4">
            <Field label="¿Quién reporta el motivo de consulta?">
              <Select value={form.personaReportaMotivo} options={REPORTA_OPTIONS} onChange={(v) => update({ personaReportaMotivo: v })} />
            </Field>
            <Field label="Motivo de consulta *">
              <TextArea value={form.motivoConsulta} onChange={(v) => update({ motivoConsulta: v })} rows={3} />
            </Field>
            <Field label="Conducta objeto de valoración *">
              <TextArea value={form.conducta} onChange={(v) => update({ conducta: v })} rows={3} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Duración"><Input value={form.duracion} onChange={(v) => update({ duracion: v })} /></Field>
              <Field label="Intensidad"><Input value={form.intensidad} onChange={(v) => update({ intensidad: v })} placeholder="1 (muy baja) a 5 (muy alta)" /></Field>
              <Field label="Frecuencia"><Input value={form.frecuencia} onChange={(v) => update({ frecuencia: v })} /></Field>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Personas con quienes vive el usuario</p>
              {members.length > 0 && (
                <ul className="mb-3 flex flex-col gap-1.5">
                  {members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <span><span className="font-bold">{m.fullName}</span> — {m.relationship}{m.age ? ` · ${m.age} años` : ''}</span>
                      <button onClick={() => removeMember(m.id)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} placeholder="Nombres y apellidos" className="rounded-lg border border-slate-200 p-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
                <input value={newMemberRelationship} onChange={(e) => setNewMemberRelationship(e.target.value)} placeholder="Parentesco" className="rounded-lg border border-slate-200 p-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
                <input type="number" value={newMemberAge} onChange={(e) => setNewMemberAge(e.target.value)} placeholder="Edad" className="rounded-lg border border-slate-200 p-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <button type="button" onClick={addMember} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-charcoal-900 px-3 py-2 text-xs font-bold text-white hover:bg-charcoal-950">
                <Plus className="h-3.5 w-3.5" /> Agregar persona
              </button>
            </div>

            <Field label="Expectativas frente al proceso de atención">
              <TextArea value={form.expectativas} onChange={(v) => update({ expectativas: v })} rows={3} />
            </Field>

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Contacto de emergencia</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nombres">
                  <Input value={form.contactoEmergenciaNombres} onChange={(v) => update({ contactoEmergenciaNombres: v })} />
                </Field>
                <Field label="Apellidos">
                  <Input value={form.contactoEmergenciaApellidos} onChange={(v) => update({ contactoEmergenciaApellidos: v })} />
                </Field>
                <Field label="Teléfono">
                  <Input value={form.contactoEmergenciaTelefono} onChange={(v) => update({ contactoEmergenciaTelefono: v })} />
                </Field>
                <Field label="Parentesco">
                  <Select value={form.contactoEmergenciaParentesco} options={PARENTESCO_OPTIONS} onChange={(v) => update({ contactoEmergenciaParentesco: v })} />
                </Field>
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="grid gap-4">
            <Field label="Instrumentos o procedimientos diligenciados">
              <div className="flex flex-wrap gap-2">
                {INSTRUMENTOS_OPTIONS.map((opt) => (
                  <Chip key={opt} label={opt} active={form.instrumentosAplicados.includes(opt)} onClick={() => toggleMulti('instrumentosAplicados', opt)} />
                ))}
              </div>
              <div className="mt-2">
                <AnexoUpload
                  patientId={patientId}
                  docId={form.anexoInstrumentosDocId}
                  onUploaded={(id) => update({ anexoInstrumentosDocId: id })}
                  label="anexo de instrumentos"
                />
              </div>
            </Field>
            <Field label="Aspectos sobresalientes del APA">
              <TextArea value={form.aspectosAPA} onChange={(v) => update({ aspectosAPA: v })} rows={3} />
            </Field>
            <Field label="Hipótesis preliminares">
              <TextArea value={form.hipotesisPreliminares} onChange={(v) => update({ hipotesisPreliminares: v })} rows={3} />
            </Field>
            <Field label="Tratamiento de datos — Consentimiento o Asentimiento *">
              <Select
                value={form.tipoConsentimiento} options={CONSENTIMIENTO_OPTIONS}
                onChange={(v) => update({ tipoConsentimiento: v })}
                placeholder="Acepto el tratamiento de datos — seleccione el tipo"
              />
            </Field>
            <Field label="Anexo — Consentimiento/Asentimiento firmado">
              <div className="flex flex-col gap-2 rounded-lg border border-toast-200 bg-toast-50/60 p-3">
                {form.anexoConsentimientoDocId ? (
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Firmado — anexo cargado
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSendConsentLink()}
                    disabled={sendingConsentLink || !form.tipoConsentimiento}
                    className="inline-flex w-fit items-center gap-2 rounded-lg bg-charcoal-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-charcoal-800 disabled:opacity-40"
                  >
                    {sendingConsentLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Enviar enlace de firma al paciente
                  </button>
                )}
                {consentLinkSentAt && !form.anexoConsentimientoDocId && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-toast-500">
                      Enviado a las {consentLinkSentAt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} — se revisa solo cada 20s, o revisa ahora:
                    </span>
                    <button
                      type="button"
                      onClick={() => checkConsentStatus()}
                      disabled={checkingConsent}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-toast-300 px-2.5 py-1 text-[11px] font-bold text-toast-600 hover:bg-toast-100 disabled:opacity-40"
                    >
                      {checkingConsent ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Revisar estado
                    </button>
                  </div>
                )}
                {!form.anexoConsentimientoDocId && (
                  <span className="text-[11px] text-slate-400">o, si ya tienes el documento firmado por otro medio:</span>
                )}
                <AnexoUpload
                  patientId={patientId}
                  docId={form.anexoConsentimientoDocId}
                  onUploaded={(id) => update({ anexoConsentimientoDocId: id })}
                  label="anexo de consentimiento"
                />
              </div>
            </Field>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button" disabled={step === 0} onClick={() => setStep((s) => s - 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" /> Anterior
        </button>

        <span className="text-xs text-slate-400">{saving ? 'Guardando...' : 'Guardado automático activo'}</span>

        {!isLastStep ? (
          <button
            type="button" onClick={() => setStep((s) => s + 1)}
            className="inline-flex items-center gap-1 rounded-lg bg-charcoal-900 px-4 py-2 text-sm font-semibold text-white hover:bg-charcoal-950"
          >
            Siguiente <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button" onClick={handleSign} disabled={signing || !form.anexoInstrumentosDocId || !form.anexoConsentimientoDocId}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
            >
              {signing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Firmar y completar valoración
            </button>
            {(!form.anexoInstrumentosDocId || !form.anexoConsentimientoDocId) && (
              <span className="text-[11px] text-amber-600">Carga los 2 anexos (instrumentos y consentimiento/asentimiento) para poder firmar.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children, span2 }: { label: string; children: React.ReactNode; span2?: boolean }) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className="mb-1 block text-xs font-semibold text-slate-600">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder }: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <input
      type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
    />
  );
}

function TextArea({ value, onChange, rows }: { value: string; onChange: (v: string) => void; rows: number }) {
  return (
    <textarea
      value={value} rows={rows} onChange={(e) => onChange(e.target.value)}
      className="w-full resize-y rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
    />
  );
}

function Select({ value, options, onChange, disabled, placeholder }: { value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-400"
    >
      <option value="">{placeholder ?? '— Seleccione —'}</option>
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
        <button type="button" onClick={() => { setOpen(true); setQuery(''); }} className="text-xs font-semibold text-indigo-600 hover:underline">Cambiar</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text" value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        placeholder="Buscar por código o nombre de EPS…"
        className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
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
        <p className="mt-1 text-xs text-slate-400">Sin resultados — si tu EPS no está en el catálogo, pide a un CEO/DIRECTIVO que la agregue desde AdminCenter.</p>
      )}
    </div>
  );
}

function AnexoUpload({ patientId, docId, onUploaded, label }: { patientId: string; docId: string; onUploaded: (docId: string) => void; label: string }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const presignedRes = await fetch(`${apiBase()}/api/clinical-history/upload`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ patientId, fileName: file.name, fileType: file.type }),
      });
      const presignedData = await presignedRes.json().catch(() => ({}));
      if (!presignedRes.ok || !presignedData.url || !presignedData.document) {
        toast.error(presignedData.error || 'Error al generar la URL de subida');
        return;
      }

      await fetch(presignedData.url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });

      const confirmRes = await fetch(`${apiBase()}/api/clinical-history/confirm-upload`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ documentId: presignedData.document.id }),
      });
      if (!confirmRes.ok) {
        toast.error('Error al confirmar la subida del anexo');
        return;
      }

      onUploaded(presignedData.document.id);
      toast.success('Anexo cargado correctamente');
    } catch {
      toast.error('Error de red al subir el anexo');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-3">
      <input
        ref={inputRef} type="file" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
      />
      {docId ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-semibold text-emerald-700">✓ {label} cargado</span>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-50">
            {uploading ? 'Subiendo...' : 'Reemplazar'}
          </button>
        </div>
      ) : (
        <button
          type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="flex w-full items-center justify-center gap-2 text-xs font-semibold text-slate-500 hover:text-indigo-600 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" /> {uploading ? 'Subiendo...' : `Subir ${label}`}
        </button>
      )}
    </div>
  );
}

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={() => onChange(true)} className={`rounded-lg border p-2 text-sm font-semibold ${value === true ? 'border-charcoal-900 bg-charcoal-900 text-white' : 'border-slate-200 text-slate-600'}`}>Sí</button>
      <button type="button" onClick={() => onChange(false)} className={`rounded-lg border p-2 text-sm font-semibold ${value === false ? 'border-charcoal-900 bg-charcoal-900 text-white' : 'border-slate-200 text-slate-600'}`}>No</button>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? 'border-toast-300 bg-toast-100 text-charcoal-900' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
    >
      {label}
    </button>
  );
}
