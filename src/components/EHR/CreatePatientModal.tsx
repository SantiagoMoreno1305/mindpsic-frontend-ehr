/**
 * CreatePatientModal.tsx
 *
 * Registro rápido de un nuevo paciente (sin agendar cita). Disponible tanto
 * para administradores/soporte operativo como para especialistas — cualquier
 * usuario autenticado del tenant puede crear pacientes (el backend no
 * restringe POST /api/patients por rol, solo exige tenant).
 *
 * Endpoints consumidos:
 *   GET  /api/companies   → Convenios / clientes corporativos del tenant
 *   POST /api/patients    → Creación del paciente
 */
import { useState, useEffect } from 'react';
import { X, UserPlus, Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import type { BackendPatient } from '../../types';

interface CompanyOption {
  id: string;
  name: string;
  clientType: 'EMPRESA' | 'PARTICULAR';
}

interface CreatePatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (patient: BackendPatient) => void;
}

export default function CreatePatientModal({ isOpen, onClose, onCreated }: CreatePatientModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingCompanies(true);
    apiFetch('/api/companies')
      .then(res => res.ok ? res.json() : [])
      .then(data => setCompanies(Array.isArray(data) ? data : []))
      .catch(() => setCompanies([]))
      .finally(() => setLoadingCompanies(false));
  }, [isOpen]);

  function reset() {
    setFirstName('');
    setLastName('');
    setDocumentId('');
    setEmail('');
    setPhone('');
    setCompanyId('');
    setError(null);
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

    setSubmitting(true);
    setError(null);
    try {
      const selectedCompany = companies.find(c => c.id === companyId);
      const res = await apiFetch('/api/patients', {
        method: 'POST',
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          documentId: documentId.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          companyId: companyId || undefined,
          corporateClient: selectedCompany?.name || 'Particular',
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
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
                onChange={(e) => setFirstName(e.target.value)}
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
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Ej. Pérez"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Documento <span className="text-rose-500">*</span>
              </label>
              <input
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                placeholder="Ej. 1024556778"
                inputMode="numeric"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Teléfono</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+57 300..."
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
