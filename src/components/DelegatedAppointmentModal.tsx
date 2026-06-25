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
}

export default function DelegatedAppointmentModal({
  isOpen,
  onClose,
  onSuccess,
}: DelegatedAppointmentModalProps) {
  // ── Data state ──────────────────────────────────────────────────────────
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Form state ──────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    userId: '',        // ID del especialista seleccionado
    patientId: '',     // ID del paciente seleccionado
    dateTime: '',
    timeSlot: '',
    appointmentType: 'clinico',
    modality: 'Virtual' as 'Virtual' | 'Presencial',
    location: '',
    notes: '',
  });

  // ── Fetch datos al abrir ──────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    fetchSelectorsData();
  }, [isOpen]);

  const fetchSelectorsData = async () => {
    setIsLoadingData(true);
    const token = localStorage.getItem('mind_token');
    const headers: HeadersInit = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    try {
      const [specRes, patRes] = await Promise.all([
        fetch('/api/users/specialists', { headers }),
        fetch('/api/appointments/patients', { headers }),
      ]);

      if (specRes.ok) {
        const specData = await specRes.json();
        setSpecialists(Array.isArray(specData) ? specData : []);
      }

      if (patRes.ok) {
        const patData = await patRes.json();
        setPatients(Array.isArray(patData) ? patData : []);
      }
    } catch (err) {
      console.error('[DelegatedModal] Error cargando datos:', err);
    } finally {
      setIsLoadingData(false);
    }
  };

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const token = localStorage.getItem('mind_token');
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          patientId: form.patientId,
          userId: form.userId,
          date: form.dateTime,
          timeSlot: form.timeSlot || form.dateTime?.split('T')[1]?.slice(0, 5) || '08:00',
          appointmentType: form.appointmentType,
          modality: form.modality,
          // WebRTC Control Hub: roomUrl vacío para asignación dinámica
          roomUrl: form.modality === 'Virtual' ? '' : null,
          notes: form.notes || null,
          status: 'Confirmada',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      alert('✅ Cita delegada creada exitosamente.');
      onSuccess?.();
      resetAndClose();
    } catch (err: any) {
      alert(`❌ Error al agendar: ${err.message}`);
    } finally {
      setIsSubmitting(false);
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
              Agendamiento Delegado
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
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                Paciente
              </label>
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
                disabled={isSubmitting}
                className="px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Agendando…' : '📅 Confirmar Cita Delegada'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
