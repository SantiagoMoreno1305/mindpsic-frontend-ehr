/**
 * SatisfactionResultsPanel.tsx
 *
 * Resultados de las encuestas de satisfacción del propio tenant (decisión
 * 2026-10-30) — mismo patrón "self-service" de MiPlanPanel.tsx: consume
 * GET /api/satisfaction-surveys/me/results, que SIEMPRE resuelve el tenant
 * del caller (nunca acepta un tenantId). La vista agregada cruzando
 * tenants, para MindPsic, queda para cuando retomen la visión de
 * marketplace en AdminCenter.
 *
 * Restringido a CEO/DIRECTIVO — el backend también lo exige (403 para
 * cualquier otro rol).
 */
import { useEffect, useState } from 'react';
import { Star, Users, MessageSquare, Clock } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

interface PorPsicologo {
  nombre: string;
  promedio: number;
  cantidad: number;
}

interface PorPregunta {
  id: string;
  texto: string;
  promedio: number | null;
}

interface RespuestaReciente {
  patientName: string;
  psychologistName: string | null;
  calificacion: number | null;
  comentarios: string | null;
  respondedAt: string;
}

interface ResultsResponse {
  resumen: {
    enviadas: number;
    respondidas: number;
    pendientes: number;
    vencidas: number;
    tasaRespuesta: number | null;
    calificacionPromedio: number | null;
  };
  porPsicologo: PorPsicologo[];
  porPregunta: PorPregunta[];
  resultados: RespuestaReciente[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-5 flex items-center gap-2 text-sm font-bold text-charcoal-900">
        <span className="text-toast-500">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-charcoal-900">{value}</p>
    </div>
  );
}

export default function SatisfactionResultsPanel() {
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/satisfaction-surveys/me/results');
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Error HTTP ${res.status}`);
        if (!cancelled) setData(body);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'No se pudieron cargar los resultados.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="mx-auto max-w-5xl p-10 text-center text-sm text-slate-400">Cargando resultados…</div>;
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-5xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        {error || 'No se pudieron cargar los resultados.'}
      </div>
    );
  }

  const { resumen, porPsicologo, porPregunta, resultados } = data;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Satisfacción</h1>
        <p className="mt-1 text-sm text-slate-500">Resultados de las encuestas enviadas a tus pacientes.</p>
      </div>

      {resumen.enviadas === 0 ? (
        <Card title="Sin encuestas todavía" icon={<Star className="h-4 w-4" />}>
          <p className="text-sm text-slate-600">
            Aún no has enviado ninguna encuesta de satisfacción. Envíala desde el menú de un paciente en Pacientes.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiCard label="Calificación promedio" value={resumen.calificacionPromedio != null ? `${resumen.calificacionPromedio} / 5` : 'Sin datos'} />
            <KpiCard label="Encuestas respondidas" value={`${resumen.respondidas} de ${resumen.enviadas}`} />
            <KpiCard label="Tasa de respuesta" value={resumen.tasaRespuesta != null ? `${resumen.tasaRespuesta}%` : 'Sin datos'} />
            <KpiCard label="Pendientes / vencidas" value={`${resumen.pendientes} / ${resumen.vencidas}`} />
          </div>

          <Card title="Por psicólogo" icon={<Users className="h-4 w-4" />}>
            {porPsicologo.length === 0 ? (
              <p className="text-sm text-slate-400">Todavía no hay encuestas respondidas.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="pb-2">Psicólogo</th>
                    <th className="pb-2 text-right">Promedio</th>
                    <th className="pb-2 text-right">Respuestas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {porPsicologo.map((p) => (
                    <tr key={p.nombre}>
                      <td className="py-2.5 font-semibold text-charcoal-900">{p.nombre}</td>
                      <td className="py-2.5 text-right">{p.promedio} / 5</td>
                      <td className="py-2.5 text-right text-slate-500">{p.cantidad}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Por pregunta" icon={<Star className="h-4 w-4" />}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="pb-2">Pregunta</th>
                  <th className="pb-2 text-right">Promedio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {porPregunta.map((q) => (
                  <tr key={q.id}>
                    <td className="py-2.5 text-charcoal-900">{q.texto}</td>
                    <td className="py-2.5 text-right font-semibold text-charcoal-900">
                      {q.promedio != null ? `${q.promedio} / 5` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Respuestas recientes" icon={<MessageSquare className="h-4 w-4" />}>
            {resultados.length === 0 ? (
              <p className="text-sm text-slate-400">Todavía no hay encuestas respondidas.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {resultados.map((r, i) => (
                  <li key={i} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-charcoal-900">{r.patientName}</p>
                      <span className="rounded-full bg-toast-50 px-2.5 py-1 text-[11px] font-bold text-toast-600">
                        {r.calificacion != null ? `${r.calificacion} / 5` : 'Sin calificación'}
                      </span>
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                      <Clock className="h-3 w-3" />
                      {formatDate(r.respondedAt)}
                      {r.psychologistName && <span>· {r.psychologistName}</span>}
                    </p>
                    {r.comentarios && (
                      <p className="mt-1.5 text-sm italic text-slate-600">"{r.comentarios}"</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
