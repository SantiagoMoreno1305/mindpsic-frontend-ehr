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
 *   GET  /api/appointments/patients        → Lista de pacientes del tenant
 *   GET  /api/companies                    → Lista de Socios Corporativos reales
 *   GET  /api/specialties/options          → Catálogo de especialidades (sin costo)
 *   GET  /api/patients/:id/schedule-summary → Ficha del paciente (cupo + historial)
 *   POST /api/appointments                 → Creación de la cita delegada
 */

import { useState, useEffect, FormEvent } from 'react';
import { toast } from 'react-hot-toast';
import { X, Plus, Pencil, Trash2, Video, Building2, Link2, CalendarClock, User } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { confirmToast } from '../lib/confirmToast';

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
  sessionNumber: number;
}

interface ScheduleSummary {
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    documentId: string;
    phone: string | null;
    companyName: string | null;
    sessionsAuthorized: number | null;
  };
  sessionsTaken: number;
  sessionsRemaining: number | null;
  appointments: ScheduleSummaryAppointment[];
}

const PARENTESCO_OPTIONS = ['Madre', 'Padre', 'Hermano/a', 'Cónyuge / Pareja', 'Hijo/a', 'Abuelo/a', 'Tutor legal', 'Otro'];

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
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [specialties, setSpecialties] = useState<SpecialtyOption[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditingAppointment = !!initialData?.id;

  // ── Ficha del paciente (cupo de sesiones + historial) ──────────────────
  const [scheduleSummary, setScheduleSummary] = useState<ScheduleSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // ── Sesiones autorizadas (numérico libre + toggle "sesiones libres") ───
  const [sessionsInput, setSessionsInput] = useState('');
  const [sessionsLibres, setSessionsLibres] = useState(false);

  // ── Patient Provisioning State ──────────────────────────────────────────
  const [isCreatingPatient, setIsCreatingPatient] = useState(false);
  const [isEditingPatient, setIsEditingPatient] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientEmail, setNewPatientEmail] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [newPatientDocument, setNewPatientDocument] = useState('');
  const [newPatientCorporateClient, setNewPatientCorporateClient] = useState('');
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

  // Si initialData cambia, actualizar el form
  useEffect(() => {
    if (initialData) {
      setForm({
        userId: initialData.psychologist?.id || initialData.userId || '',
        patientId: initialData.patient?.id || initialData.patientId || '',
        specialtyId: initialData.specialtyId || '',
        dateTime: initialData.date ? (() => {
          const d = new Date(initialData.date);
          const pad = (n: number) => n.toString().padStart(2, '0');
          return !isNaN(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
        })() : '',
        timeSlot: initialData.timeSlot || '',
        appointmentType: initialData.appointmentType || 'clinico',
        modality: initialData.modality || ('Virtual' as 'Virtual' | 'Presencial'),
        location: initialData.location || '',
        notes: initialData.notes || '',
        corporateClient: initialData.corporateClient || '',
        locationId: initialData.locationId || '',
      });
    } else {
      setForm({
        userId: '', patientId: '', specialtyId: '', dateTime: '', timeSlot: '',
        appointmentType: 'clinico', modality: 'Virtual', location: '', notes: '',
        corporateClient: '', locationId: '',
      });
    }
  }, [initialData, isOpen]);

  // ── Fetch datos al abrir ──────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    fetchSelectorsData();
  }, [isOpen]);

  const fetchSelectorsData = async () => {
    setIsLoadingData(true);

    try {
      const [specRes, patRes, compRes, specialtyRes] = await Promise.all([
        apiFetch('/api/users/specialists'),
        apiFetch('/api/appointments/patients'),
        apiFetch('/api/companies'),
        apiFetch('/api/specialties/options'),
      ]);

      if (specRes.ok) {
        const specData = await specRes.json();
        setSpecialists(Array.isArray(specData) ? specData : []);
      }
      if (patRes.ok) {
        const patData = await patRes.json();
        setPatients(Array.isArray(patData) ? patData : []);
      }
      if (compRes.ok) {
        const compData = await compRes.json();
        setCompanies(Array.isArray(compData) ? compData : []);
      }
      if (specialtyRes.ok) {
        const specialtyData = await specialtyRes.json();
        setSpecialties(Array.isArray(specialtyData) ? specialtyData : []);
      }
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
        if (data.patient.sessionsAuthorized === null) {
          setSessionsLibres(true);
          setSessionsInput('');
        } else {
          setSessionsLibres(false);
          setSessionsInput(String(data.patient.sessionsAuthorized));
        }
      } catch {
        // silencioso — la ficha es informativa, no bloquea el agendamiento
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    })();
    return () => { cancelled = true; };
  }, [form.patientId, isCreatingPatient]);

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const token  = localStorage.getItem('mind_token');
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const method = isEditingAppointment ? 'PUT' : 'POST';
      const endpoint = isEditingAppointment ? `/api/appointments/${initialData.id}` : '/api/appointments';

      const selectedCompany = companies.find(c => c.name === form.corporateClient);

      const payload = isEditingAppointment
        ? {
            date:            form.dateTime,
            timeSlot:        form.timeSlot || form.dateTime?.split('T')[1]?.slice(0, 5) || '08:00',
            specialistId:    form.userId,
            userId:          form.userId,
            specialtyId:     form.specialtyId || null,
            status:          'Reprogramada'
          }
        : {
            patientId:       form.patientId,
            userId:          form.userId,
            specialtyId:     form.specialtyId || null,
            date:            form.dateTime,
            timeSlot:        form.timeSlot || form.dateTime?.split('T')[1]?.slice(0, 5) || '08:00',
            appointmentType: form.appointmentType,
            modality:        form.modality,
            roomUrl:         form.modality === 'Virtual' ? '' : null,
            notes:           form.notes || null,
            status:          'Confirmada',
            corporateClient: form.corporateClient,
            companyId:       selectedCompany?.id || null,
            locationId:      form.locationId || null,
          };

      const res = await fetch(`${apiUrl}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      // El cupo de sesiones se guarda junto con el agendamiento — siempre
      // manual, nunca autocompletado desde el convenio (decisión de producto).
      if (form.patientId) {
        await fetch(`${apiUrl}/api/patients/${form.patientId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionsAuthorized: sessionsLibres ? null : (sessionsInput ? Number(sessionsInput) : null) }),
        }).catch(() => {});
      }

      toast.success(`Cita ${initialData ? 'actualizada' : 'creada'} exitosamente.`);
      onSuccess?.();
      resetAndClose();
    } catch (err: any) {
      toast.error(`Error al agendar: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const provisionPatient = async () => {
    if (!newPatientName || !newPatientDocument) {
      toast.error('Por favor, ingresa al menos el nombre y el documento del paciente.');
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
          firstName: newPatientName.split(' ')[0],
          lastName: newPatientName.split(' ').slice(1).join(' ') || '.',
          email: newPatientEmail,
          phone: newPatientPhone,
          documentId: newPatientDocument,
          corporateClient: form.corporateClient,
          companyId: selectedCompany?.id || undefined,
          psychologistId: form.userId || undefined,
          sessionsAuthorized: sessionsLibres ? null : (sessionsInput ? Number(sessionsInput) : null),
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

      setPatients(prev => [...prev, newOption]);
      setForm(prev => ({ ...prev, patientId: newOption.id }));
      setIsCreatingPatient(false);

      // Reset fields
      setNewPatientName('');
      setNewPatientEmail('');
      setNewPatientPhone('');
      setNewPatientDocument('');
      setNewPatientCorporateClient('');
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
    setSessionsInput('');
    setSessionsLibres(false);
    onClose();
  };

  const selectedPatient = patients.find(p => p.id === form.patientId);

  const startEditPatient = () => {
    if (!selectedPatient) return;
    setNewPatientName(`${selectedPatient.firstName} ${selectedPatient.lastName}`.trim());
    setNewPatientDocument(selectedPatient.documentId);
    setNewPatientEmail(selectedPatient.email || '');
    // Fetch remaining fields or leave blank if not present
    setNewPatientPhone('');
    setNewPatientCorporateClient('');
    setIsEditingPatient(true);
  };

  const updatePatient = async () => {
    if (!newPatientName || !newPatientDocument) {
      toast.error('Por favor, ingresa al menos el nombre y el documento del paciente.');
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
          firstName: newPatientName.split(' ')[0],
          lastName: newPatientName.split(' ').slice(1).join(' ') || '.',
          email: newPatientEmail,
          phone: newPatientPhone,
          documentId: newPatientDocument,
          corporateClient: newPatientCorporateClient
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const updatedPatient = await res.json();

      setPatients(prev => prev.map(p => p.id === updatedPatient.id ? {
        ...p,
        firstName: updatedPatient.firstName,
        lastName: updatedPatient.lastName,
        documentId: updatedPatient.documentId,
        email: updatedPatient.email
      } : p));

      setIsEditingPatient(false);
      toast.success('Paciente actualizado exitosamente.');
    } catch (err: any) {
      toast.error(`Error al actualizar paciente: ${err.message}`);
    } finally {
      setIsProvisioning(false);
    }
  };

  const deletePatient = async () => {
    if (!(await confirmToast('¿Estás seguro de eliminar este paciente?'))) return;
    try {
      const token  = localStorage.getItem('mind_token');
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/patients/${form.patientId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      setPatients(prev => prev.filter(p => p.id !== form.patientId));
      setForm(prev => ({ ...prev, patientId: '' }));
      setIsEditingPatient(false);
      toast.success('Paciente eliminado exitosamente.');
    } catch (err: any) {
      toast.error(`Error al eliminar paciente: ${err.message}`);
    }
  };

  // ── Hint del footer: qué sesión se está registrando ────────────────────
  const footerHint = (() => {
    if (!form.patientId) return 'Sin paciente seleccionado.';
    if (sessionsLibres) return 'Se registrará como sesión libre.';
    if (scheduleSummary) return `Se registrará como sesión #${scheduleSummary.appointments.length + 1}.`;
    return 'Se registrará como sesión #1.';
  })();

  // ── Render ──────────────────────────────────────────────────────────────
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-6xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
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
          <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] overflow-hidden flex-1">
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
                    <option value="" disabled>— Seleccione una especialidad —</option>
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
                    <option value="" disabled>— Seleccione un especialista —</option>
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
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Nombre Completo *</label>
                        <input type="text" value={newPatientName} onChange={e => setNewPatientName(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. Juan Pérez" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Documento *</label>
                        <input type="text" value={newPatientDocument} onChange={e => setNewPatientDocument(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. 12345678" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Correo Electrónico</label>
                        <input type="email" value={newPatientEmail} onChange={e => setNewPatientEmail(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="juan@correo.com" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Teléfono</label>
                        <input type="text" value={newPatientPhone} onChange={e => setNewPatientPhone(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="+57 300..." />
                      </div>
                    </div>

                    <p className="pt-1 text-[11px] font-bold uppercase tracking-wider text-toast-600">Contacto de emergencia</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Nombres *</label>
                        <input type="text" value={emergencyNombres} onChange={e => setEmergencyNombres(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. María" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Apellidos *</label>
                        <input type="text" value={emergencyApellidos} onChange={e => setEmergencyApellidos(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. Gómez Ruiz" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Teléfono *</label>
                        <input type="text" value={emergencyTelefono} onChange={e => setEmergencyTelefono(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="+57 300..." />
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
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Nombre Completo *</label>
                        <input type="text" value={newPatientName} onChange={e => setNewPatientName(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. Juan Pérez" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Documento *</label>
                        <input type="text" value={newPatientDocument} onChange={e => setNewPatientDocument(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="Ej. 12345678" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Correo Electrónico</label>
                        <input type="email" value={newPatientEmail} onChange={e => setNewPatientEmail(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="juan@correo.com" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">Teléfono</label>
                        <input type="text" value={newPatientPhone} onChange={e => setNewPatientPhone(e.target.value)} className="w-full border border-slate-200 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" placeholder="+57 300..." />
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
                    <select
                      required
                      value={form.patientId}
                      onChange={(e) =>
                        setForm(prev => ({ ...prev, patientId: e.target.value }))
                      }
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white disabled:opacity-50 disabled:bg-slate-100"
                      disabled={isEditingAppointment}
                    >
                      <option value="" disabled>
                        — Seleccione un paciente —
                      </option>
                      {patients.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.firstName} {p.lastName} — Doc: {p.documentId}
                        </option>
                      ))}
                    </select>
                    {form.patientId && !isCreatingPatient && !isEditingPatient && (
                      <div className="flex gap-4 mt-1.5">
                        <button type="button" onClick={startEditPatient} className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline">
                          <Pencil className="w-3 h-3" /> Corregir datos de este paciente
                        </button>
                        <button type="button" onClick={deletePatient} className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:underline">
                          <Trash2 className="w-3 h-3" /> Eliminar
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Convenio / Cliente Corporativo + Sesiones ─────────────── */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                    Convenio / Cliente Corporativo
                  </label>
                  <select
                    required
                    value={form.corporateClient}
                    onChange={(e) => setForm({ ...form, corporateClient: e.target.value, locationId: '' })}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                  >
                    <option value="" disabled>— Seleccione un convenio —</option>
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
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                    Sesiones
                  </label>
                  {sessionsLibres ? (
                    <button
                      type="button"
                      onClick={() => setSessionsLibres(false)}
                      className="w-full rounded-lg border border-emerald-300 bg-emerald-50 p-2.5 text-left text-sm font-semibold text-emerald-700"
                    >
                      Sesiones libres
                    </button>
                  ) : (
                    <input
                      type="number" min={1} value={sessionsInput}
                      onChange={(e) => setSessionsInput(e.target.value)}
                      placeholder="Ej. 5"
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  )}
                  <label className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                    <input type="checkbox" checked={sessionsLibres} onChange={(e) => { setSessionsLibres(e.target.checked); if (e.target.checked) setSessionsInput(''); }} />
                    Sesiones libres (sin tope definido)
                  </label>
                </div>
              </div>

              {/* ── Fecha y Hora ──────────────────────────────────────────── */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                  Fecha y Hora
                </label>
                <input
                  type="datetime-local"
                  required
                  value={form.dateTime || ''}
                  onChange={(e) =>
                    setForm(prev => ({ ...prev, dateTime: e.target.value }))
                  }
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

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
                    disabled={isSubmitting || isLoadingData}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                      isSubmitting
                        ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                    }`}
                  >
                    <CalendarClock className="w-3.5 h-3.5" />
                    {isSubmitting ? 'Procesando...' : (initialData ? 'Guardar Cambios' : 'Confirmar agendamiento')}
                  </button>
                </div>
              </div>
            </form>

            {/* ── Ficha del paciente ───────────────────────────────────────── */}
            <div className="border-l border-slate-100 bg-slate-50/50 p-5 overflow-y-auto">
              {!form.patientId || isCreatingPatient ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
                  <CalendarClock className="mb-3 h-8 w-8 text-slate-300" />
                  <p className="text-xs">Seleccione un paciente para ver su historial de agendamientos y sus sesiones autorizadas.</p>
                </div>
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
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sesiones habilitadas</p>
                    {scheduleSummary.patient.sessionsAuthorized === null ? (
                      <>
                        <span className="mt-1 inline-block rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Sesiones libres</span>
                        <p className="mt-1 text-[11px] text-slate-500">Sin tope contractual. {scheduleSummary.sessionsTaken} sesiones tomadas.</p>
                      </>
                    ) : (
                      <>
                        <p className="mt-0.5 text-xl font-black text-slate-900">
                          {Math.max(scheduleSummary.sessionsRemaining ?? 0, 0)}{' '}
                          <span className="text-xs font-medium text-slate-400">disponibles de {scheduleSummary.patient.sessionsAuthorized}</span>
                        </p>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.min(100, (scheduleSummary.sessionsTaken / scheduleSummary.patient.sessionsAuthorized) * 100)}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Agendamientos previos</p>
                      <span className="text-[10px] text-slate-400">{scheduleSummary.appointments.length} registros</span>
                    </div>
                    {scheduleSummary.appointments.length === 0 ? (
                      <p className="mt-2 text-[11px] text-slate-400">Sin agendamientos previos.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {scheduleSummary.appointments.map((a) => {
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
