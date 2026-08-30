/**
 * CreatePatientModal.tsx
 *
 * Registro rápido de un nuevo paciente (sin agendar cita). Disponible tanto
 * para administradores/soporte operativo como para especialistas — cualquier
 * usuario autenticado del tenant puede crear pacientes (el backend no
 * restringe POST /api/patients por rol, solo exige tenant).
 *
 * Endpoints consumidos:
 *   GET  /api/companies         → Convenios / clientes corporativos del tenant
 *   GET  /api/users/specialists → Psicólogos del tenant (para asignar responsable)
 *   POST /api/patients          → Creación del paciente
 */
import { useState, useEffect } from 'react';
import { X, UserPlus, Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useCompanies } from '../../hooks/useCompanies';
import type { BackendPatient } from '../../types';

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
  onCreated: (patient: BackendPatient, wasReactivated?: boolean) => void;
}

const PATIENT_STATUS_LABELS: Record<string, string> = {
  activo: 'Activo',
  alta: 'De alta',
  pausa: 'En pausa',
};

const DOCUMENT_TYPE_OPTIONS = ['CC', 'TI', 'PEP', 'PA', 'CE'];
const ESTRATO_OPTIONS = [1, 2, 3, 4, 5, 6];
// Mismo catálogo que usa Valoración Individual (InitialAssessmentWizard) para
// el contacto de emergencia — se mantiene igual para no confundir con dos
// listas distintas de parentesco en la misma app.
const PARENTESCO_OPTIONS = ['Madre', 'Padre', 'Hermano/a', 'Cónyuge / Pareja', 'Hijo/a', 'Abuelo/a', 'Tutor legal', 'Otro'];

// Filtrado en vivo — mismas reglas que valida el backend (validateName/
// validateDocumentId/validatePhone en patient.controller.js), para que el
// error aparezca al escribir en vez de recién al enviar el formulario.
function onlyLetters(value: string): string {
  return value.replace(/[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ\s-]/g, '');
}
function onlyDigits(value: string, maxLen: number): string {
  return value.replace(/\D/g, '').slice(0, maxLen);
}

export default function CreatePatientModal({ isOpen, onClose, onCreated }: CreatePatientModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [documentType, setDocumentType] = useState('CC');
  const [documentId, setDocumentId] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [estrato, setEstrato] = useState('');
  const [emergencyContactNombres, setEmergencyContactNombres] = useState('');
  const [emergencyContactApellidos, setEmergencyContactApellidos] = useState('');
  const [emergencyContactTelefono, setEmergencyContactTelefono] = useState('');
  const [emergencyContactParentesco, setEmergencyContactParentesco] = useState('');
  const [companyId, setCompanyId] = useState('');
  const { companies, loading: loadingCompanies } = useCompanies();
  const [psychologistId, setPsychologistId] = useState('');
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [loadingSpecialists, setLoadingSpecialists] = useState(false);
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

  function reset() {
    setFirstName('');
    setLastName('');
    setDocumentType('CC');
    setDocumentId('');
    setBirthDate('');
    setEmail('');
    setPhone('');
    setEstrato('');
    setEmergencyContactNombres('');
    setEmergencyContactApellidos('');
    setEmergencyContactTelefono('');
    setEmergencyContactParentesco('');
    setCompanyId('');
    setPsychologistId('');
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

    setSubmitting(true);
    setError(null);
    setDuplicatePatient(null);
    try {
      const selectedCompany = companies.find(c => c.id === companyId);
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
          emergencyContactNombres: emergencyContactNombres.trim() || undefined,
          emergencyContactApellidos: emergencyContactApellidos.trim() || undefined,
          emergencyContactTelefono: emergencyContactTelefono.trim() || undefined,
          emergencyContactParentesco: emergencyContactParentesco || undefined,
          companyId: companyId || undefined,
          corporateClient: selectedCompany?.name || 'Particular',
          psychologistId: psychologistId || undefined,
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

      const patient = await res.json();
      onCreated(patient);
      reset();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al crear el paciente.');
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
      const patient = await res.json();
      onCreated(patient, true);
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-xs sm:p-6">
      <div className="relative my-8 w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-charcoal-900">Crear nuevo paciente</h2>
            <p className="mt-0.5 text-sm text-slate-500">Registre los datos básicos para abrir la ficha del paciente.</p>
          </div>
          <button
            onClick={handleClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-charcoal-900 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Nombres <span className="text-rose-500">*</span>
              </label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(onlyLetters(e.target.value))}
                placeholder="Ej. Juan"
                autoFocus
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Apellidos <span className="text-rose-500">*</span>
              </label>
              <input
                value={lastName}
                onChange={(e) => setLastName(onlyLetters(e.target.value))}
                placeholder="Ej. Pérez"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Documento <span className="text-rose-500">*</span>
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
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Teléfono</label>
              <input
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

          <div className="border-t border-slate-100 pt-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Contacto de emergencia (opcional)</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nombres</label>
                <input
                  value={emergencyContactNombres}
                  onChange={(e) => setEmergencyContactNombres(onlyLetters(e.target.value))}
                  placeholder="Ej. María"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Apellidos</label>
                <input
                  value={emergencyContactApellidos}
                  onChange={(e) => setEmergencyContactApellidos(onlyLetters(e.target.value))}
                  placeholder="Ej. Pérez"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Teléfono</label>
                <input
                  value={emergencyContactTelefono}
                  onChange={(e) => setEmergencyContactTelefono(onlyDigits(e.target.value, 10))}
                  placeholder="Ej. 3132220587"
                  inputMode="numeric"
                  maxLength={10}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Parentesco</label>
                <select
                  value={emergencyContactParentesco}
                  onChange={(e) => setEmergencyContactParentesco(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                >
                  <option value="">Selecciona</option>
                  {PARENTESCO_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </div>

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

          <div className="mt-1 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
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
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {submitting ? 'Guardando...' : 'Guardar paciente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
