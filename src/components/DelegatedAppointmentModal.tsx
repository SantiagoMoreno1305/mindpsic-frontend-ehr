/**
 * DelegatedAppointmentModal.tsx
 * Modal para Agendamiento Delegado desde el Portal Administrativo del EHR.
 *
 * Permite a usuarios CEO / DIRECTIVO crear citas asignándolas a un
 * especialista y paciente específicos, seleccionando modalidad
 * (Virtual / Presencial) de forma visual.
 *
 * Endpoints consumidos:
 *   GET  /api/users/specialists      → Lista de psicólogos del tenant
 *   GET  /api/appointments/patients   → Lista de pacientes del tenant
 *   POST /api/appointments            → Creación de la cita delegada
 */

import { useState, useEffect, FormEvent } from 'react';

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
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Patient Provisioning State ──────────────────────────────────────────
  const [isCreatingPatient, setIsCreatingPatient] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientEmail, setNewPatientEmail] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [newPatientDocument, setNewPatientDocument] = useState('');

  // ── Form state ──────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    userId: initialData?.psychologist?.id || '',
    patientId: initialData?.patient?.id || '',
    dateTime: initialData?.date ? new Date(initialData.date).toISOString().slice(0, 16) : '',
    timeSlot: initialData?.timeSlot || '',
    appointmentType: initialData?.appointmentType || 'clinico',
    modality: initialData?.modality || ('Virtual' as 'Virtual' | 'Presencial'),
    location: initialData?.location || '',
    notes: initialData?.notes || '',
  });

  // Si initialData cambia, actualizar el form
  useEffect(() => {
    if (initialData) {
      setForm({
        userId: initialData.psychologist?.id || initialData.userId || '',
        patientId: initialData.patient?.id || initialData.patientId || '',
        dateTime: initialData.date ? new Date(initialData.date).toISOString().slice(0, 16) : '',
        timeSlot: initialData.timeSlot || '',
        appointmentType: initialData.appointmentType || 'clinico',
        modality: initialData.modality || ('Virtual' as 'Virtual' | 'Presencial'),
        location: initialData.location || '',
        notes: initialData.notes || '',
      });
    } else {
      setForm({
        userId: '',
        patientId: '',
        dateTime: '',
        timeSlot: '',
        appointmentType: 'clinico',
        modality: 'Virtual',
        location: '',
        notes: '',
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
    const token  = localStorage.getItem('mind_token');
    const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, ''); // sin slash final
    const headers: HeadersInit = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    try {
      const [specRes, patRes] = await Promise.all([
        fetch(`${apiUrl}/api/users/specialists`, { headers }),
        fetch(`${apiUrl}/api/appointments/patients`, { headers }),
      ]);

      if (specRes.ok) {
        const specData = await specRes.json();
        const list = Array.isArray(specData) ? specData : [];
        console.log(`[DelegatedModal] Especialistas recibidos: ${list.length}`, list);
        setSpecialists(list);
      } else {
        console.error(`[DelegatedModal] /specialists respondió HTTP ${specRes.status}`);
      }

      if (patRes.ok) {
        const patData = await patRes.json();
        setPatients(Array.isArray(patData) ? patData : []);
      } else {
        console.error(`[DelegatedModal] /patients respondió HTTP ${patRes.status}`);
      }
    } catch (err) {
      console.error('[DelegatedModal] Error cargando datos de selectores:', err);
    } finally {
      setIsLoadingData(false);
    }
  };

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const token  = localStorage.getItem('mind_token');
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const method = initialData?.id ? 'PUT' : 'POST';
      const endpoint = initialData?.id ? `/api/appointments/${initialData.id}` : '/api/appointments';

      const payload = {
          patientId:       form.patientId,
          userId:          form.userId,   // ID del psicólogo seleccionado (guardado en Prisma → PsychologistPortal lo carga)
          date:            form.dateTime,
          timeSlot:        form.timeSlot || form.dateTime?.split('T')[1]?.slice(0, 5) || '08:00',
          appointmentType: form.appointmentType,
          modality:        form.modality,
          // WebRTC Control Hub: roomUrl vacío para asignación dinámica
          roomUrl:         form.modality === 'Virtual' ? '' : null,
          notes:           form.notes || null,
          status:          'Confirmada',
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

      alert(`✅ Cita ${initialData ? 'actualizada' : 'creada'} exitosamente.`);
      onSuccess?.();
      resetAndClose();
    } catch (err: any) {
      alert(`❌ Error al agendar: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const provisionPatient = async () => {
    if (!newPatientName || !newPatientDocument) {
      alert('Por favor, ingresa al menos el nombre y el documento del paciente.');
      return;
    }
    
    setIsProvisioning(true);
    try {
      const token  = localStorage.getItem('mind_token');
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/users/provision`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newPatientName,
          email: newPatientEmail,
          phone: newPatientPhone,
          documentId: newPatientDocument,
          role: 'USUARIO_B2C'
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const newPatient = await res.json();
      
      const newOption: PatientOption = {
        id: newPatient.id || newPatient.userId, // Asegurarnos de mapear el ID correcto
        firstName: newPatientName.split(' ')[0],
        lastName: newPatientName.split(' ').slice(1).join(' ') || '',
        documentId: newPatientDocument,
        email: newPatientEmail,
      };

      setPatients(prev => [...prev, newOption]);
      setForm(prev => ({ ...prev, patientId: newOption.id }));
      setIsCreatingPatient(false);
      
      // Reset fields
      setNewPatientName('');
      setNewPatientEmail('');
      setNewPatientPhone('');
      setNewPatientDocument('');
      
      alert('✅ Paciente creado y seleccionado exitosamente.');
    } catch (err: any) {
      alert(`❌ Error al crear paciente: ${err.message}`);
    } finally {
      setIsProvisioning(false);
    }
  };

  const resetAndClose = () => {
    setForm({
      userId: '',
      patientId: '',
      dateTime: '',
      timeSlot: '',
      appointmentType: 'clinico',
      modality: 'Virtual',
      location: '',
      notes: '',
    });
    onClose();
  };

  // ── Render ──────────────────────────────────────────────────────────────
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
          <div>
            <h3 className="text-base font-bold text-slate-800">
              {initialData ? 'Editar Cita Delegada' : 'Agendamiento Delegado'}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Asignar cita a un especialista desde la torre de control
            </p>
          </div>
          <button
            onClick={resetAndClose}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        {isLoadingData ? (
          <div className="p-10 text-center text-slate-400 text-sm animate-pulse">
            Cargando especialistas y pacientes del tenant…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4 text-left">
            {/* ── Selector de Especialista ──────────────────────────────── */}
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
                <option value="" disabled>
                  — Seleccione un especialista —
                </option>
                {specialists.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.specialty ? ` – ${s.specialty}` : ''}
                    {s.level ? ` (Nivel ${s.level})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* ── Selector de Paciente ──────────────────────────────────── */}
            <div>
              <div className="flex justify-between items-end mb-1">
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                  Paciente
                </label>
                {!isCreatingPatient && (
                  <button
                    type="button"
                    onClick={() => setIsCreatingPatient(true)}
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                  >
                    ➕ Crear nuevo paciente
                  </button>
                )}
              </div>
              
              {isCreatingPatient ? (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-1">Nombre Completo *</label>
                      <input type="text" value={newPatientName} onChange={e => setNewPatientName(e.target.value)} className="w-full border border-slate-200 rounded-md p-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500 bg-white" placeholder="Ej. Juan Pérez" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-1">Documento *</label>
                      <input type="text" value={newPatientDocument} onChange={e => setNewPatientDocument(e.target.value)} className="w-full border border-slate-200 rounded-md p-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500 bg-white" placeholder="Ej. 12345678" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-1">Correo Electrónico</label>
                      <input type="email" value={newPatientEmail} onChange={e => setNewPatientEmail(e.target.value)} className="w-full border border-slate-200 rounded-md p-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500 bg-white" placeholder="juan@correo.com" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-1">Teléfono</label>
                      <input type="text" value={newPatientPhone} onChange={e => setNewPatientPhone(e.target.value)} className="w-full border border-slate-200 rounded-md p-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500 bg-white" placeholder="+57 300..." />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button type="button" onClick={() => setIsCreatingPatient(false)} className="px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 rounded-md transition-colors">
                      Cancelar
                    </button>
                    <button type="button" onClick={provisionPatient} disabled={isProvisioning} className="px-3 py-1.5 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors disabled:opacity-50">
                      {isProvisioning ? 'Guardando...' : 'Guardar Paciente'}
                    </button>
                  </div>
                </div>
              ) : (
                <select
                  required
                  value={form.patientId}
                  onChange={(e) =>
                    setForm({ ...form, patientId: e.target.value })
                  }
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
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
              )}
            </div>

            {/* ── Fecha y Hora ──────────────────────────────────────────── */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                Fecha y Hora
              </label>
              <input
                type="datetime-local"
                required
                value={form.dateTime}
                onChange={(e) =>
                  setForm({ ...form, dateTime: e.target.value })
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
                    setForm({ ...form, modality: 'Virtual', location: '' })
                  }
                  className={`p-2.5 rounded-lg text-sm font-medium border flex items-center justify-center gap-2 transition-all ${
                    form.modality === 'Virtual'
                      ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-sm'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  📹 Telepsicología
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
                  🏢 Presencial
                </button>
              </div>
            </div>

            {/* ── Campo condicional de modalidad ────────────────────────── */}
            {form.modality === 'Virtual' ? (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-indigo-50/50 border border-indigo-100">
                <span className="text-indigo-500 text-base">🔗</span>
                <span className="text-[11px] text-indigo-600 font-medium">
                  La sala virtual será asignada automáticamente por el
                  enrutador WebRTC al confirmar la cita.
                </span>
              </div>
            ) : (
              <div>
                <label className="block text-[11px] font-semibold text-emerald-700 mb-1">
                  Ubicación / Consultorio
                </label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) =>
                    setForm({ ...form, location: e.target.value })
                  }
                  className="w-full border border-emerald-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 bg-emerald-50/30 outline-none"
                  placeholder="Sede Central — Consultorio 4B"
                />
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
            <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={resetAndClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                onClick={handleSubmit}
                disabled={isSubmitting || isLoadingData}
                className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  isSubmitting
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                }`}
              >
                {isSubmitting ? 'Procesando...' : (initialData ? 'Guardar Cambios' : 'Agendar Cita')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
