/**
 * ApprovalsPanel.tsx
 *
 * Bandeja del "aprobador de cambios de cupo" (ver User.canApproveSessionChanges
 * en el backend) — solicitudes de agregar/restar sesiones (o cargas masivas
 * con cupo inicial) dirigidas a MÍ, pendientes + historial de las que ya
 * resolví.
 *
 * El código en sí NUNCA se muestra acá — llega por correo, y quien lo pide
 * te lo tiene que dictar de viva voz o por chat (mismo criterio que Clinical
 * Access). Esta bandeja es solo para RECHAZAR con motivo (si no estás de
 * acuerdo, mejor que el solicitante se entere ya que a que el código expire
 * solo) y para auditoría — ver qué se pidió y qué pasó con cada solicitud.
 *
 * Endpoints:
 *   GET  /api/session-changes/inbox
 *   POST /api/session-changes/:id/reject
 */
import { useEffect, useState } from 'react';
import { Inbox, Ban, Check, Clock, X, Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

interface ChangeRequest {
  id: string;
  kind: 'SINGLE' | 'BULK_IMPORT';
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'REVOKED';
  requestedSessionsAuthorized: number | null;
  requestedUnlimited: boolean;
  bulkPatientCount: number | null;
  bulkTotalSessions: number | null;
  rejectionReason: string | null;
  expiresAt: string;
  createdAt: string;
  requestedBy: { id: string; name: string; email: string };
  patient: { id: string; firstName: string; lastName: string } | null;
  company: { id: string; name: string } | null;
}

const STATUS_STYLES: Record<ChangeRequest['status'], { chip: string; label: string }> = {
  PENDING: { chip: 'border-amber-300 bg-amber-50 text-amber-700', label: 'Pendiente' },
  VERIFIED: { chip: 'border-emerald-300 bg-emerald-50 text-emerald-700', label: 'Verificada' },
  EXPIRED: { chip: 'border-slate-300 bg-slate-100 text-slate-500', label: 'Vencida' },
  REVOKED: { chip: 'border-rose-300 bg-rose-50 text-rose-700', label: 'Rechazada' },
};

function describeChange(r: ChangeRequest): string {
  if (r.kind === 'BULK_IMPORT') {
    return `Carga masiva — ${r.bulkPatientCount ?? '?'} paciente(s), ${r.bulkTotalSessions ?? '?'} sesiones en total`;
  }
  const patientName = r.patient ? `${r.patient.firstName} ${r.patient.lastName}` : 'paciente';
  const sessions = r.requestedUnlimited ? 'libres (sin tope)' : `${r.requestedSessionsAuthorized} sesión(es)`;
  return `${patientName} — ${sessions}${r.company ? ` con ${r.company.name}` : ''}`;
}

export default function ApprovalsPanel() {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const fetchInbox = () => {
    setLoading(true);
    apiFetch('/api/session-changes/inbox')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setRequests(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudo cargar la bandeja de aprobaciones.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchInbox();
  }, []);

  async function confirmReject(id: string) {
    setRejecting(true);
    try {
      const res = await apiFetch(`/api/session-changes/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setRejectingId(null);
      setRejectReason('');
      fetchInbox();
    } catch {
      setError('No se pudo contactar el servidor.');
    } finally {
      setRejecting(false);
    }
  }

  const pending = requests.filter((r) => r.status === 'PENDING');
  const resolved = requests.filter((r) => r.status !== 'PENDING');

  return (
    <div className="max-w-4xl mx-auto space-y-6 text-left">
      <div className="border-b border-slate-200 pb-4">
        <span className="bg-toast-100 text-charcoal-900 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border border-toast-300 font-mono">
          Aprobador de cambios de cupo
        </span>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">Aprobaciones</h1>
        <p className="text-xs text-slate-400 mt-1 max-w-2xl">
          El código para aprobar te llega por correo — acá solo puedes rechazar con motivo, o revisar el historial. Nunca ingreses el código tú mismo: quien lo pide te lo dicta.
        </p>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <>
          <div>
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-charcoal-900">
              <Inbox className="h-4 w-4 text-toast-500" />
              Pendientes {pending.length > 0 && `(${pending.length})`}
            </h2>
            {pending.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-10 text-center">
                <p className="text-sm text-slate-400">No tienes solicitudes pendientes.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pending.map((r) => (
                  <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-charcoal-900">{describeChange(r)}</p>
                        <p className="mt-0.5 text-xs text-slate-500">Pide {r.requestedBy.name} ({r.requestedBy.email})</p>
                        <p className="mt-1 flex items-center gap-1 text-[10.5px] text-slate-400">
                          <Clock className="h-3 w-3" /> Vence {new Date(r.expiresAt).toLocaleString('es-CO')}
                        </p>
                      </div>
                      {rejectingId === r.id ? null : (
                        <button
                          onClick={() => { setRejectingId(r.id); setRejectReason(''); }}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:border-rose-300 hover:text-rose-600 cursor-pointer"
                        >
                          <Ban className="h-3.5 w-3.5" /> Rechazar
                        </button>
                      )}
                    </div>
                    {rejectingId === r.id && (
                      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                        <input
                          type="text" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Motivo del rechazo (opcional, pero ayuda al solicitante)"
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setRejectingId(null)}
                            className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-charcoal-900 cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => confirmReject(r.id)}
                            disabled={rejecting}
                            className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
                          >
                            {rejecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                            Confirmar rechazo
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-charcoal-900">
              <Check className="h-4 w-4 text-toast-500" />
              Historial
            </h2>
            {resolved.length === 0 ? (
              <p className="text-sm text-slate-400">Todavía no has resuelto ninguna solicitud.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-3 font-semibold">Solicitud</th>
                      <th className="px-4 py-3 font-semibold">Quién pidió</th>
                      <th className="px-4 py-3 font-semibold">Estado</th>
                      <th className="px-4 py-3 font-semibold">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {resolved.map((r) => {
                      const s = STATUS_STYLES[r.status];
                      return (
                        <tr key={r.id}>
                          <td className="px-4 py-3 text-slate-700">
                            {describeChange(r)}
                            {r.rejectionReason && <p className="mt-0.5 text-[10.5px] text-rose-500">Motivo: {r.rejectionReason}</p>}
                          </td>
                          <td className="px-4 py-3 text-slate-500">{r.requestedBy.name}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${s.chip}`}>
                              {s.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">{new Date(r.createdAt).toLocaleDateString('es-CO')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
