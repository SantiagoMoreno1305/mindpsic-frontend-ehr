/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Capacitaciones (staff) — checklist de facilitadoras + tareas intersesión.
 *
 * Distinto de Programas de medición: no cruza datos con ese módulo a
 * propósito. Cada "cronograma" trae DOS enlaces reutilizables (uno para
 * facilitadoras, uno para colaboradores) y sus 5 fechas de visita, que el
 * staff arma aquí — nada se calcula ni se asume.
 */

import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Copy, Check, Plus, Loader2, CalendarClock, Users, ClipboardCheck } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

interface Visit { id: string; order: number; date: string }
interface Schedule { id: string; name: string | null; facilitatorUrl: string; taskUrl: string; visits: Visit[] }
interface Program { id: string; name: string; clientName: string; schedules: Schedule[] }
interface TaskStat { code: string; title: string; visitOrder: number; started: number; completed: number }
interface Stats { participants: number; checklists: number; tasks: TaskStat[] }

const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-toast-500 focus:outline-none focus:ring-2 focus:ring-toast-500/30';
const fmt = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/training${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
  return body as T;
}

function CopyButton({ url, label }: { url: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(url); setOk(true); setTimeout(() => setOk(false), 2000); } catch { window.prompt('Copia el enlace:', url); }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50"
    >
      {ok ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {ok ? 'Copiado' : label}
    </button>
  );
}

function ScheduleCard({ schedule, onChanged }: { schedule: Schedule; onChanged: () => void }) {
  const sorted = [...schedule.visits].sort((a, b) => a.order - b.order);
  const [dates, setDates] = useState<string[]>(() => {
    const arr = Array(5).fill('');
    sorted.forEach((v) => { arr[v.order - 1] = v.date.slice(0, 10); });
    return arr;
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showStats, setShowStats] = useState(false);

  const save = async () => {
    const filled = dates.filter(Boolean);
    if (!filled.length) { setErr('Ingresa al menos la fecha de la Visita 1.'); return; }
    setSaving(true); setErr(null);
    try {
      await call(`/schedules/${schedule.id}/visits`, { method: 'PUT', body: JSON.stringify({ dates: filled }) });
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const loadStats = async () => {
    setShowStats((v) => !v);
    if (!stats) {
      try { setStats(await call<Stats>(`/schedules/${schedule.id}/stats`)); } catch { /* silencioso */ }
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-charcoal-900">{schedule.name || 'Cronograma sin nombre'}</p>
        <button onClick={loadStats} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50">
          <ClipboardCheck className="h-3.5 w-3.5" /> {showStats ? 'Ocultar' : 'Ver'} avance
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded-lg bg-toast-50 px-3 py-2">
          <Users className="h-4 w-4 shrink-0 text-toast-500" />
          <input readOnly value={schedule.taskUrl} onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-0 bg-transparent font-mono text-[11px] text-charcoal-900 outline-none" />
          <CopyButton url={schedule.taskUrl} label="Colaboradores" />
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-toast-50 px-3 py-2">
          <GraduationCap className="h-4 w-4 shrink-0 text-toast-500" />
          <input readOnly value={schedule.facilitatorUrl} onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-0 bg-transparent font-mono text-[11px] text-charcoal-900 outline-none" />
          <CopyButton url={schedule.facilitatorUrl} label="Facilitadoras" />
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <CalendarClock className="h-3.5 w-3.5" /> Fechas de las 5 visitas
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <label key={i} className="text-[11px] text-slate-500">
              Visita {i + 1}
              <input type="date" value={dates[i]} onChange={(e) => setDates((d) => d.map((x, j) => (j === i ? e.target.value : x)))} className={`${inputCls} mt-1`} />
            </label>
          ))}
        </div>
        {err && <p role="alert" className="mt-2 text-xs text-red-700">{err}</p>}
        <button onClick={save} disabled={saving} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar fechas
        </button>
      </div>

      {showStats && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          {!stats ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
          ) : (
            <>
              <p className="text-xs text-slate-500">{stats.participants} colaborador(es) registrados · {stats.checklists} checklist(s) de facilitadoras enviados</p>
              <table className="mt-2 w-full text-left text-xs">
                <thead><tr className="text-slate-400"><th className="py-1 pr-2">Tarea</th><th className="py-1 pr-2">Visita</th><th className="py-1 pr-2">Empezaron</th><th className="py-1">Completaron</th></tr></thead>
                <tbody>
                  {stats.tasks.map((t) => (
                    <tr key={t.code} className="border-t border-slate-100">
                      <td className="py-1.5 pr-2">{t.title}</td>
                      <td className="py-1.5 pr-2">{t.visitOrder}</td>
                      <td className="py-1.5 pr-2">{t.started}</td>
                      <td className="py-1.5 font-semibold text-charcoal-900">{t.completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function TrainingPortal() {
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingProgram, setCreatingProgram] = useState(false);
  const [programForm, setProgramForm] = useState({ name: '', clientName: '' });
  const [busy, setBusy] = useState(false);
  const [creatingScheduleFor, setCreatingScheduleFor] = useState<string | null>(null);
  const [scheduleName, setScheduleName] = useState('');

  const load = useCallback(async () => {
    try { setPrograms((await call<{ programs: Program[] }>('/programs')).programs); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const createProgram = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await call('/programs', { method: 'POST', body: JSON.stringify(programForm) });
      setProgramForm({ name: '', clientName: '' }); setCreatingProgram(false); await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  const createSchedule = async (programId: string) => {
    setBusy(true); setError(null);
    try {
      await call(`/programs/${programId}/schedules`, { method: 'POST', body: JSON.stringify({ name: scheduleName || null }) });
      setScheduleName(''); setCreatingScheduleFor(null); await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="h-full overflow-y-auto bg-toast-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-toast-500 text-white"><GraduationCap className="h-5 w-5" /></span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-charcoal-900">Capacitaciones</h1>
              <p className="text-sm text-slate-500">Checklist de fidelidad de las facilitadoras y tareas intersesión de los colaboradores.</p>
            </div>
          </div>
          <button onClick={() => setCreatingProgram((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl bg-charcoal-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-charcoal-800">
            <Plus className="h-4 w-4" /> Nuevo programa
          </button>
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

        {creatingProgram && (
          <form onSubmit={createProgram} className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">Nombre del programa
              <input required value={programForm.name} onChange={(e) => setProgramForm({ ...programForm, name: e.target.value })} className={`${inputCls} mt-1`} placeholder="Capacitación factores de riesgo psicosocial" />
            </label>
            <label className="text-xs font-medium text-slate-600">Empresa cliente
              <input required value={programForm.clientName} onChange={(e) => setProgramForm({ ...programForm, clientName: e.target.value })} className={`${inputCls} mt-1`} placeholder="Constructora Obreval S.A." />
            </label>
            <div className="sm:col-span-2 flex justify-end">
              <button disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-toast-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Crear programa
              </button>
            </div>
          </form>
        )}

        {programs === null && !error && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-toast-500" /></div>}
        {programs?.length === 0 && !creatingProgram && (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">Aún no hay programas. Crea el primero con «Nuevo programa».</div>
        )}

        <div className="mt-6 space-y-6">
          {programs?.map((p) => (
            <section key={p.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-charcoal-900">{p.name}</h2>
                  <p className="text-sm text-slate-500">{p.clientName}</p>
                </div>
                <button
                  onClick={() => setCreatingScheduleFor(creatingScheduleFor === p.id ? null : p.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Nuevo cronograma
                </button>
              </div>

              {creatingScheduleFor === p.id && (
                <div className="mt-3 flex items-end gap-2 rounded-xl border border-slate-200 bg-toast-50 p-3">
                  <label className="flex-1 text-xs font-medium text-slate-600">Nombre del cronograma (opcional)
                    <input value={scheduleName} onChange={(e) => setScheduleName(e.target.value)} className={`${inputCls} mt-1`} placeholder="Ej. Cohorte Bogotá" />
                  </label>
                  <button onClick={() => createSchedule(p.id)} disabled={busy} className="rounded-lg bg-charcoal-900 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40">
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Crear'}
                  </button>
                </div>
              )}

              <div className="mt-4 space-y-3">
                {p.schedules.length === 0 ? (
                  <p className="text-sm text-slate-400">Sin cronogramas todavía.</p>
                ) : (
                  p.schedules.map((s) => <ScheduleCard key={s.id} schedule={s} onChanged={load} />)
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
