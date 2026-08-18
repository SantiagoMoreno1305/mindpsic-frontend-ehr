/**
 * EditPatientModal.tsx
 *
 * Edita los datos básicos de un paciente ya existente — los mismos campos
 * que se capturan al crearlo (ver CreatePatientModal), precargados con su
 * información actual.
 *
 * Endpoints consumidos:
 *   GET  /api/companies         → Convenios / clientes corporativos del tenant
 *   GET  /api/users/specialists → Psicólogos del tenant (para reasignar responsable)
 *   PUT  /api/patients/:id      → Actualización del paciente
 */
import { useState, useEffect } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useCompanies } from '../../hooks/useCompanies';
import type { BackendPatient } from '../../types';

interface SpecialistOption {
  id: string;
  name: string;
}

interface EditPatientModalProps {
  isOpen: boolean;
  patient: BackendPatient | null;
  onClose: () => void;
  onUpdated: (patient: BackendPatient) => void;
}

const DOCUMENT_TYPE_OPTIONS = ['CC', 'TI', 'PEP', 'PA', 'CE'];

// Filtrado en vivo — mismas reglas que valida el backend (validateName/
// validateDocumentId/validatePhone en patient.controller.js).
function onlyLetters(value: string): string {
  return value.replace(/[^a-zA-ZÁÉÍÓÚÜÑáéíóúüñ\s-]/g, '');
}
function onlyDigits(value: string, maxLen: number): string {
  return value.replace(/\D/g, '').slice(0, maxLen);
}

export default function EditPatientModal({ isOpen, patient, onClose, onUpdated }: EditPatientModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [documentType, setDocumentType] = useState('CC');
  const [documentId, setDocumentId] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [companyId, setCompanyId] = useState('');
  const { companies, loading: loadingCompanies } = useCompanies();
  const [psychologistId, setPsychologistId] = useState('');
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [loadingSpecialists, setLoadingSpecialists] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Precarga los campos cada vez que se abre el modal para un paciente distinto.
  useEffect(() => {
    if (!isOpen || !patient) return;
    setFirstName(patient.firstName || '');
    setLastName(patient.lastName || '');
    setDocumentType(patient.documentType || 'CC');
    setDocumentId(patient.documentId || '');
    setBirthDate(patient.birthDate ? patient.birthDate.slice(0, 10) : '');
    setEmail(patient.email || '');
    setPhone(patient.phone || '');
    setCompanyId(patient.companyId || '');
    setPsychologistId(patient.psychologist?.id || '');
    setError(null);
  }, [isOpen, patient]);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingSpecialists(true);
    apiFetch('/api/users/specialists')
      .then(res => res.ok ? res.json() : [])
      .then(data => setSpecialists(Array.isArray(data?.specialists) ? data.specialists : Array.isArray(data) ? data : []))
      .catch(() => setSpecialists([]))
      .finally(() => setLoadingSpecialists(false));
  }, [isOpen]);

  function handleClose() {
    setError(null);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!patient) return;
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

    setSubmitting(true);
    setError(null);
    try {
      const selectedCompany = companies.find(c => c.id === companyId);
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
          companyId: companyId || null,
          corporateClient: selectedCompany?.name || 'Particular',
          psychologistId: psychologistId || null,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const updated = await res.json();
      onUpdated(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al actualizar el paciente.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen || !patient) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-xs sm:p-6">
      <div className="relative my-8 w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-charcoal-900">Editar paciente</h2>
            <p className="mt-0.5 text-sm text-slate-500">Actualiza los datos básicos de {patient.firstName} {patient.lastName}.</p>
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
                  onChange={(e) => setDocumentId(onlyDigits(e.target.value, 10))}
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
                <option value="">Sin asignar</option>
                {specialists.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

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
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {submitting ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
