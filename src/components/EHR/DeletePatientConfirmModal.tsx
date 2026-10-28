/**
 * DeletePatientConfirmModal.tsx
 *
 * Borrado FÍSICO REAL del paciente — decisión 2026-10-24. Solo CEO (el botón
 * que abre esto ya está oculto para cualquier otro rol en PacientesPanel,
 * pero el backend es quien de verdad lo exige — ver DELETE /api/patients/:id
 * en patient.controller.js). Irreversible: se lleva ~39 tablas relacionadas,
 * los archivos en S3 y, si era su única ficha en el sistema, la cuenta de
 * login. Por eso la confirmación no es un simple "¿Estás seguro?" — hay que
 * escribir el número de documento exacto del paciente, igual que al canjear
 * una invitación.
 *
 * El backend bloquea el borrado si el paciente tiene alguna historia clínica
 * FIRMADA (retención legal obligatoria) — ese caso se muestra aparte, sin
 * dejar reintentar desde acá: la salida correcta es cambiar el estado a
 * "alta", no forzar el borrado.
 */
import { useState } from 'react';
import { AlertTriangle, X, Loader2, Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import type { BackendPatient } from '../../types';

interface DeletePatientConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: BackendPatient | null;
  onDeleted: (summary: { rowCounts: Record<string, number>; s3ObjectsDeleted: number; accountDeleted: boolean }) => void;
}

export default function DeletePatientConfirmModal({ isOpen, onClose, patient, onDeleted }: DeletePatientConfirmModalProps) {
  const [typedDocument, setTypedDocument] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedBySignedHistory, setBlockedBySignedHistory] = useState<string | null>(null);

  if (!isOpen || !patient) return null;

  const matches = typedDocument.trim() === patient.documentId;

  function reset() {
    setTypedDocument('');
    setError(null);
    setBlockedBySignedHistory(null);
    setSubmitting(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleDelete() {
    if (!matches || submitting || !patient) return;
    setSubmitting(true);
    setError(null);
    setBlockedBySignedHistory(null);
    try {
      const res = await apiFetch(`/api/patients/${patient.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ documentId: typedDocument.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.code === 'HAS_SIGNED_HISTORIES') {
          setBlockedBySignedHistory(data.error);
        } else {
          setError(data?.error || 'No se pudo eliminar el paciente.');
        }
        return;
      }
      onDeleted({ rowCounts: data.rowCounts || {}, s3ObjectsDeleted: data.s3ObjectsDeleted || 0, accountDeleted: !!data.accountDeleted });
      reset();
      onClose();
    } catch {
      setError('No se pudo contactar el servidor.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) handleClose(); }}
    >
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle className="h-4.5 w-4.5" />
            </span>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-charcoal-900">Eliminar paciente permanentemente</h2>
              <p className="mt-0.5 text-sm text-slate-500">{patient.firstName} {patient.lastName} · CC {patient.documentId}</p>
            </div>
          </div>
          <button onClick={handleClose} className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-50 hover:text-charcoal-900 cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {blockedBySignedHistory ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {blockedBySignedHistory}
            </div>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-slate-600">
                Esto borra <strong className="text-charcoal-900">todo</strong> lo relacionado a este paciente — citas, historias clínicas, evaluaciones, documentos subidos, autorizaciones de sesión, consentimientos — de forma irreversible. No queda nada para recuperar.
              </p>
              <p className="mt-3 text-sm text-slate-600">
                Para confirmar, escribe el número de documento del paciente (<strong className="text-charcoal-900">{patient.documentId}</strong>):
              </p>
              <input
                autoFocus
                value={typedDocument}
                onChange={(e) => setTypedDocument(e.target.value)}
                placeholder={patient.documentId}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors placeholder:text-slate-300 focus:border-red-400 focus:bg-white focus:ring-2 focus:ring-red-500/20"
              />
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button onClick={handleClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 cursor-pointer">
            Cancelar
          </button>
          {!blockedBySignedHistory && (
            <button
              onClick={handleDelete}
              disabled={!matches || submitting}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Eliminar permanentemente
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
