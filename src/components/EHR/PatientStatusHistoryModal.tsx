/**
 * PatientStatusHistoryModal.tsx
 *
 * Timeline de solo lectura de los cambios de Patient.status — ver
 * PatientStatusHistory en el backend (patient-status-history.js). Petición
 * del cliente: poder ver cuándo y por qué cambió el estado de un paciente,
 * para reportes posteriores. No permite editar nada, solo consultar; la
 * edición del estado sigue siendo el selector de la tabla o el modal de
 * edición del paciente.
 */
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { PATIENT_STATUS_LABELS } from './CreatePatientModal';

interface StatusHistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  changedById: string | null;
  changedByName: string | null;
  reason: string | null;
  createdAt: string;
}

interface PatientStatusHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string | null;
  patientName?: string;
}

export default function PatientStatusHistoryModal({ isOpen, onClose, patientId, patientName }: PatientStatusHistoryModalProps) {
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !patientId) return;
    setLoading(true);
    setError(null);
    apiFetch(`/api/patients/${patientId}/status-history`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => setHistory(Array.isArray(data?.history) ? data.history : []))
      .catch(() => setError('No se pudo cargar el historial de estados.'))
      .finally(() => setLoading(false));
  }, [isOpen, patientId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-charcoal-900">Historial de estados</h2>
            {patientName && <p className="mt-0.5 text-sm text-slate-500">{patientName}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-charcoal-900 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando historial...
            </div>
          )}
          {!loading && error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>
          )}
          {!loading && !error && history.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-400">Sin cambios de estado registrados.</p>
          )}
          {!loading && !error && history.length > 0 && (
            <ol className="relative space-y-5 border-l border-slate-200 pl-5">
              {history.map((entry) => (
                <li key={entry.id} className="relative">
                  <span className="absolute -left-[25px] top-1 h-3 w-3 rounded-full border-2 border-white bg-toast-400 ring-1 ring-toast-200" />
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    {entry.fromStatus && (
                      <>
                        <span className="text-slate-400">{PATIENT_STATUS_LABELS[entry.fromStatus] || entry.fromStatus}</span>
                        <span className="text-slate-300">→</span>
                      </>
                    )}
                    <span className="font-semibold text-charcoal-900">{PATIENT_STATUS_LABELS[entry.toStatus] || entry.toStatus}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {new Date(entry.createdAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
                    {' · '}
                    {entry.changedByName || 'Automático del sistema'}
                  </p>
                  {entry.reason && <p className="mt-1 text-xs italic text-slate-400">{entry.reason}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
