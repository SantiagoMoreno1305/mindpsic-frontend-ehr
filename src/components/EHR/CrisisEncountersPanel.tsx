import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { AlertTriangle, ChevronDown, Eye, Loader2, Lock } from 'lucide-react';
import { getApiBase } from '../../lib/apiClient';

/**
 * Atenciones de crisis por línea 24/7 de UN paciente, en su ficha.
 *
 * Dos niveles de acceso (los decide el backend, esta pantalla solo muestra lo
 * que llega — ver modules/crisis-encounters/encounter.service.js):
 *   - Tratante: ve el resumen breve, de solo lectura. El CEO/DIRECTIVO del tenant
 *     también lo ve (en el listado, sin aviso pendiente: el "visto" es del tratante). Mientras no lo marque
 *     como visto, el aviso se queda arriba de la ficha, en cualquier pestaña.
 *   - Quien atendió: además ve su nota completa (Datos/Análisis/Plan), que el
 *     tratante nunca recibe.
 */

interface CrisisEncounter {
  id: string;
  attendedByName: string | null;
  status: 'OPEN' | 'CLOSED' | 'AUTO_CLOSED';
  riskLevel: 'bajo' | 'medio' | 'alto' | null;
  summary: string | null;
  requiresFollowUp: boolean;
  startedAt: string;
  closedAt: string | null;
  acknowledgedAt: string | null;
  viewerRole: 'TRATANTE' | 'ATTENDEE' | 'ADMIN';
  noteSignedAt?: string | null;
  datos?: string | null;
  analisis?: string | null;
  plan?: string | null;
}

const RISK_LABEL: Record<string, string> = { bajo: 'Riesgo bajo', medio: 'Riesgo medio', alto: 'Riesgo alto' };

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

function RiskBadge({ level }: { level: CrisisEncounter['riskLevel'] }) {
  const cls =
    level === 'alto' ? 'bg-red-600 text-white'
    : level === 'medio' ? 'bg-amber-500 text-white'
    : level === 'bajo' ? 'bg-emerald-600 text-white'
    : 'bg-slate-200 text-slate-700';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${cls}`}>
      {level ? RISK_LABEL[level] : 'Riesgo sin clasificar'}
    </span>
  );
}

function EncounterBody({ e }: { e: CrisisEncounter }) {
  return (
    <div className="space-y-2 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <RiskBadge level={e.riskLevel} />
        {e.requiresFollowUp && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-700">
            Requiere seguimiento pronto
          </span>
        )}
        {e.status === 'OPEN' && (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
            Atención sin cerrar
          </span>
        )}
        {e.status === 'AUTO_CLOSED' && (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
            Cerrada automáticamente, sin confirmar por el profesional
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm text-slate-900">
        {e.summary || 'El profesional que atendió aún no escribió el resumen.'}
      </p>
      <p className="text-xs text-slate-500">
        {formatWhen(e.startedAt)} · Atendió: {e.viewerRole === 'ATTENDEE' ? 'tú' : e.attendedByName || 'otro profesional'}
      </p>
    </div>
  );
}

function OwnNote({ e }: { e: CrisisEncounter }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-bold text-slate-700"
      >
        <span className="flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5" /> Tu nota completa — solo tú la ves
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-200 px-3 py-2 text-sm text-slate-900">
          {e.noteSignedAt ? (
            <>
              <p><span className="font-semibold">Datos: </span>{e.datos}</p>
              <p><span className="font-semibold">Análisis: </span>{e.analisis}</p>
              <p><span className="font-semibold">Plan: </span>{e.plan}</p>
              <p className="text-xs text-slate-500">Firmada el {formatWhen(e.noteSignedAt)}</p>
            </>
          ) : (
            <p className="text-slate-600">Aún no has firmado la nota completa de esta atención.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function CrisisEncountersPanel({ patientId }: { patientId: string }) {
  const [encounters, setEncounters] = useState<CrisisEncounter[]>([]);
  const [ackingId, setAckingId] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = localStorage.getItem('mind_token');
      const res = await fetch(`${getApiBase()}/api/crisis-encounters/patient/${patientId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return; // sin acceso o sin datos: el panel simplemente no aparece
      const data = await res.json();
      setEncounters(Array.isArray(data.encounters) ? data.encounters : []);
    } catch {
      // Un fallo de red aquí no debe afectar el resto de la ficha.
    }
  }, [patientId]);

  useEffect(() => {
    load();
  }, [load]);

  const acknowledge = async (id: string) => {
    setAckingId(id);
    try {
      const token = localStorage.getItem('mind_token');
      const res = await fetch(`${getApiBase()}/api/crisis-encounters/${id}/acknowledge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      toast.error('No se pudo marcar como visto. Inténtalo de nuevo.');
    } finally {
      setAckingId(null);
    }
  };

  if (encounters.length === 0) return null;

  // Pendientes = las que atendió otro profesional y aún no marcaste como vistas.
  const pending = encounters.filter((e) => e.viewerRole === 'TRATANTE' && !e.acknowledgedAt);
  const rest = encounters.filter((e) => !pending.includes(e));

  return (
    <div className="space-y-3">
      {pending.map((e) => (
        <div
          key={e.id}
          role="alert"
          className={`rounded-2xl border p-4 ${e.riskLevel === 'alto' || e.requiresFollowUp ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${e.riskLevel === 'alto' ? 'text-red-600' : 'text-amber-600'}`} />
            <div className="flex-1 space-y-2 text-left">
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-900">
                Este paciente tuvo una atención de crisis por línea 24/7
              </h3>
              <EncounterBody e={e} />
              <p className="text-[11px] text-slate-500">Resumen de solo lectura — la nota completa la conserva quien atendió.</p>
              <button
                type="button"
                onClick={() => acknowledge(e.id)}
                disabled={ackingId === e.id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
              >
                {ackingId === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                Marcar como visto
              </button>
            </div>
          </div>
        </div>
      ))}

      {rest.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-slate-600"
          >
            <span>Atenciones de crisis por línea 24/7 ({rest.length})</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${showPast ? 'rotate-180' : ''}`} />
          </button>
          {showPast && (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {rest.map((e) => (
                <div key={e.id} className="px-4 py-3">
                  <EncounterBody e={e} />
                  {e.viewerRole === 'ATTENDEE' && <OwnNote e={e} />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
