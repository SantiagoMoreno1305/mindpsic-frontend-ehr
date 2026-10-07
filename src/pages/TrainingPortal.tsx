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
import { GraduationCap, Copy, Check, Plus, Loader2, CalendarClock, Users, ClipboardCheck, Pencil, X, SmartphoneNfc, Download } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { toast } from 'react-hot-toast';

interface Visit { id: string; order: number; opensAt: string; closesAt: string }
interface Schedule { id: string; name: string | null; facilitatorUrl: string; taskUrl: string; visits: Visit[] }
interface Program { id: string; name: string; clientName: string; schedules: Schedule[] }
interface TaskStat { code: string; title: string; visitOrder: number; started: number; completed: number }
interface Stats { participants: number; checklists: number; roster: { total: number; conPersonal: number; sinPersonal: number }; tasks: TaskStat[] }
interface RosterSection { name: string; total: number; conPersonal: number; sinPersonal: number }

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

// Descarga autenticada — el archivo llega como JSON con el contenido en base64
// (encoding=base64): un binario (xlsx) directo a través de API Gateway/Lambda
// se corrompe si el gateway no tiene tipos binarios configurados (mismo
// patrón que ExportButtons en ProgramsPortal.tsx).
function ExportButton({ scheduleId }: { scheduleId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [withId, setWithId] = useState(false);

  const download = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/training/schedules/${scheduleId}/export?encoding=base64${withId ? '&identified=1' : ''}`);
      let bytes: Uint8Array;
      let filename = 'capacitaciones.xlsx';
      let contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if ((res.headers.get('Content-Type') || '').includes('application/json')) {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
        if (typeof body.base64 !== 'string') throw new Error('La respuesta del servidor no trae el archivo.');
        const bin = atob(body.base64);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        filename = body.filename || filename;
        contentType = body.contentType || contentType;
      } else {
        if (!res.ok) throw new Error(`Error ${res.status}`);
        bytes = new Uint8Array(await res.arrayBuffer());
      }
      if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
        throw new Error('El archivo llegó dañado desde el servidor. Vuelve a intentarlo; si persiste, avisa a soporte.');
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button disabled={busy} onClick={() => void download()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Excel
      </button>
      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
        <input type="checkbox" checked={withId} onChange={(e) => setWithId(e.target.checked)} />
        Incluir número de cédula <span className="text-slate-400">(uso interno, no compartir con el cliente)</span>
      </label>
      {err && <span role="alert" className="text-xs text-red-700">{err}</span>}
    </div>
  );
}

// Sugerencia inicial de cierre: 8 días después de la apertura. Solo prellena el
// campo; el staff puede cambiarla y no vive en la lógica del servidor.
const SUGGESTED_WINDOW_DAYS = 5;
const bogotaDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function ScheduleCard({ schedule, onChanged }: { schedule: Schedule; onChanged: () => void }) {
  const sorted = [...schedule.visits].sort((a, b) => a.order - b.order);
  const [opens, setOpens] = useState<string[]>(() => {
    const arr = Array(5).fill('');
    sorted.forEach((v) => { arr[v.order - 1] = bogotaDay(v.opensAt); });
    return arr;
  });
  const [closes, setCloses] = useState<string[]>(() => {
    const arr = Array(5).fill('');
    sorted.forEach((v) => { arr[v.order - 1] = bogotaDay(v.closesAt); });
    return arr;
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [showWindows, setShowWindows] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [showRoster, setShowRoster] = useState(false);
  const [rosterFile, setRosterFile] = useState<string | null>(null);
  const [rosterSections, setRosterSections] = useState<RosterSection[] | null>(null);
  const [rosterChoice, setRosterChoice] = useState('');
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterSummary, setRosterSummary] = useState<{ total: number; conPersonal: number; sinPersonal: number } | null>(null);

  const readAsBase64 = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  };

  const onRosterFile = async (file: File | undefined) => {
    setRosterSections(null); setRosterChoice('');
    if (!file) return;
    setRosterBusy(true);
    try {
      const b64 = await readAsBase64(file);
      setRosterFile(b64);
      const r = await call<{ sections: RosterSection[] }>(`/schedules/${schedule.id}/roster/preview`, { method: 'POST', body: JSON.stringify({ file: b64 }) });
      setRosterSections(r.sections);
      if (r.sections.length === 1) setRosterChoice(r.sections[0].name);
    } catch (e) {
      setRosterFile(null);
      toast.error(`No se pudo leer el archivo: ${(e as Error).message}`);
    } finally { setRosterBusy(false); }
  };

  const importRoster = async () => {
    if (!rosterFile || !rosterChoice) return;
    setRosterBusy(true);
    try {
      const r = await call<{ roster: { total: number; conPersonal: number; sinPersonal: number } }>(`/schedules/${schedule.id}/roster`, { method: 'POST', body: JSON.stringify({ file: rosterFile, section: rosterChoice }) });
      setRosterSummary(r.roster);
      setRosterSections(null); setRosterFile(null); setRosterChoice('');
      toast.success(`Lista importada: ${r.roster.total} colaboradores (${r.roster.conPersonal} con personal a cargo).`);
    } catch (e) {
      toast.error(`No se importó la lista: ${(e as Error).message}`);
    } finally { setRosterBusy(false); }
  };
  const [releaseCedula, setReleaseCedula] = useState('');
  const [releasing, setReleasing] = useState(false);
  const [releaseMsg, setReleaseMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setOpenFor = (i: number, value: string) => {
    setOpens((o) => o.map((x, j) => (j === i ? value : x)));
    // Si el cierre está vacío, se sugiere 8 días después (editable).
    setCloses((c) => c.map((x, j) => (j === i && !x && value ? addDays(value, SUGGESTED_WINDOW_DAYS) : x)));
  };

  const save = async () => {
    const windows = opens.map((o, i) => ({ opensAt: o, closesAt: closes[i] })).filter((w) => w.opensAt);
    if (!windows.length) { setErr('Ingresa al menos la apertura de la Visita 1.'); return; }
    if (windows.some((w) => !w.closesAt)) { setErr('Cada visita con apertura necesita su fecha de cierre.'); return; }
    if (windows.some((w) => w.closesAt < w.opensAt)) { setErr('El cierre no puede ser anterior a la apertura.'); return; }
    setSaving(true); setErr(null); setSavedNote(null);
    try {
      await call(`/schedules/${schedule.id}/visits`, { method: 'PUT', body: JSON.stringify({ visits: windows }) });
      const note = `Ventanas guardadas (${windows.length} visita${windows.length === 1 ? '' : 's'}).`;
      toast.success(note);
      setSavedNote(note);
      onChanged();
    } catch (e) {
      const msg = (e as Error).message;
      toast.error(`No se guardaron las ventanas: ${msg}`);
      setErr(msg);
    } finally { setSaving(false); }
  };

  const loadStats = async () => {
    setShowStats((v) => !v);
    if (!stats) {
      try { const st = await call<Stats>(`/schedules/${schedule.id}/stats`); setStats(st); setRosterSummary(st.roster); } catch { /* silencioso */ }
    }
  };

  const releaseDevice = async () => {
    if (!/^\d{5,11}$/.test(releaseCedula)) { setReleaseMsg({ ok: false, text: 'Escribe un número de cédula válido.' }); return; }
    setReleasing(true); setReleaseMsg(null);
    try {
      await call(`/schedules/${schedule.id}/release-device`, { method: 'POST', body: JSON.stringify({ cedula: releaseCedula }) });
      setReleaseMsg({ ok: true, text: 'Listo — ya puede volver a registrarse desde cualquier dispositivo.' });
      setReleaseCedula('');
    } catch (e) { setReleaseMsg({ ok: false, text: (e as Error).message }); } finally { setReleasing(false); }
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
        <button
          type="button"
          onClick={() => setShowRoster((v) => !v)}
          aria-expanded={showRoster}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Users className="h-3.5 w-3.5" /> Lista de colaboradores
          </span>
          <span className="text-[11px] text-slate-400">
            {rosterSummary ? `${rosterSummary.total} colaboradores · ${rosterSummary.conPersonal} con personal a cargo` : 'Sin lista cargada'} · {showRoster ? 'Ocultar' : 'Editar'}
          </span>
        </button>
        {showRoster && (
          <div className="mt-3 space-y-3">
            <p className="text-[11px] text-slate-400">
              Sube el Excel de la obra. Quien aparece como NO tiene personal a cargo y solo ve el Bloque 1; quien no está en la lista ve ambos bloques.
            </p>
            <input
              type="file" accept=".xlsx"
              onChange={(e) => void onRosterFile(e.target.files?.[0])}
              disabled={rosterBusy}
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold"
            />
            {rosterSections && (
              <div className="space-y-2">
                <label className="block text-[11px] text-slate-500">
                  Obra a importar
                  <select value={rosterChoice} onChange={(e) => setRosterChoice(e.target.value)} className={`${inputCls} mt-1`}>
                    <option value="">Selecciona…</option>
                    {rosterSections.map((r) => (
                      <option key={r.name} value={r.name}>{r.name} — {r.total} colaboradores ({r.conPersonal} con personal a cargo)</option>
                    ))}
                  </select>
                </label>
                <button onClick={importRoster} disabled={!rosterChoice || rosterBusy} className="inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
                  {rosterBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Importar lista de esta obra
                </button>
              </div>
            )}
            {rosterBusy && !rosterSections && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            {rosterSummary && !rosterSections && (
              <p className="text-xs text-slate-600">
                Lista actual: {rosterSummary.total} colaboradores · {rosterSummary.conPersonal} con personal a cargo · {rosterSummary.sinPersonal} sin personal a cargo.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowWindows((v) => !v)}
          aria-expanded={showWindows}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <CalendarClock className="h-3.5 w-3.5" /> Ventanas de visita
          </span>
          <span className="text-[11px] text-slate-400">
            {opens.filter(Boolean).length} configurada{opens.filter(Boolean).length === 1 ? '' : 's'} · {showWindows ? 'Ocultar' : 'Editar'}
          </span>
        </button>

        {showWindows && (
          <div className="mt-3">
            <p className="mb-3 text-[11px] text-slate-400">
              Apertura: desde cuándo se pueden responder sus tareas. Cierre: hasta cuándo. Las ventanas pueden solaparse
              (por ejemplo, dar tiempo extra a la visita anterior mientras ya abrió la siguiente).
            </p>
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="grid grid-cols-[4.5rem_1fr_1fr] items-end gap-2">
                  <span className="pb-2 text-xs font-semibold text-slate-600">Visita {i + 1}</span>
                  <label className="text-[11px] text-slate-500">
                    Apertura
                    <input type="date" value={opens[i]} onChange={(e) => setOpenFor(i, e.target.value)} className={`${inputCls} mt-1`} />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Cierre
                    <input type="date" value={closes[i]} min={opens[i] || undefined} onChange={(e) => setCloses((c) => c.map((x, j) => (j === i ? e.target.value : x)))} className={`${inputCls} mt-1`} />
                  </label>
                </div>
              ))}
            </div>
            {err && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
            {savedNote && !err && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{savedNote}</p>}
            <button onClick={save} disabled={saving} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar ventanas
            </button>
          </div>
        )}
      </div>

      {showStats && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          {!stats ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-xs text-slate-500">{stats.participants} colaborador(es) registrados · {stats.checklists} checklist(s) de facilitadoras enviados</p>
                <ExportButton scheduleId={schedule.id} />
              </div>
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

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-charcoal-900">
              <SmartphoneNfc className="h-3.5 w-3.5" /> Reiniciar dispositivo
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Si un colaborador borró el caché del navegador, cambió de equipo o de navegador entre visitas, quedará bloqueado al intentar registrarse de nuevo con su misma cédula. Escríbela aquí para liberarlo — podrá entrar desde cualquier dispositivo la próxima vez.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                value={releaseCedula} onChange={(e) => setReleaseCedula(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="Número de cédula" inputMode="numeric" className={`${inputCls} flex-1`}
              />
              <button onClick={releaseDevice} disabled={releasing || !releaseCedula} className="shrink-0 rounded-lg bg-charcoal-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
                {releasing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Reiniciar'}
              </button>
            </div>
            {releaseMsg && <p className={`mt-2 text-xs ${releaseMsg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{releaseMsg.text}</p>}
          </div>
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
  const [editingProgram, setEditingProgram] = useState<string | null>(null);
  const [editProgramForm, setEditProgramForm] = useState({ name: '', clientName: '' });

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

  const startEditProgram = (p: Program) => {
    setEditingProgram(p.id); setEditProgramForm({ name: p.name, clientName: p.clientName }); setError(null);
  };

  const saveProgramEdit = async (programId: string) => {
    setBusy(true); setError(null);
    try {
      await call(`/programs/${programId}`, { method: 'PUT', body: JSON.stringify(editProgramForm) });
      setEditingProgram(null); await load();
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
                {editingProgram === p.id ? null : (
                  <div className="group flex items-baseline gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-charcoal-900">{p.name}</h2>
                      <p className="text-sm text-slate-500">{p.clientName}</p>
                    </div>
                    <button
                      onClick={() => startEditProgram(p)}
                      title="Editar nombre y empresa"
                      className="rounded-lg p-1.5 text-slate-400 opacity-0 hover:bg-slate-50 hover:text-charcoal-900 group-hover:opacity-100"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {editingProgram !== p.id && (
                  <button
                    onClick={() => setCreatingScheduleFor(creatingScheduleFor === p.id ? null : p.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" /> Nuevo cronograma
                  </button>
                )}
              </div>

              {editingProgram === p.id && (
                <div className="grid gap-3 rounded-xl border border-slate-200 bg-toast-50 p-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-slate-600">Nombre del programa
                    <input required value={editProgramForm.name} onChange={(e) => setEditProgramForm({ ...editProgramForm, name: e.target.value })} className={`${inputCls} mt-1`} />
                  </label>
                  <label className="text-xs font-medium text-slate-600">Empresa cliente
                    <input required value={editProgramForm.clientName} onChange={(e) => setEditProgramForm({ ...editProgramForm, clientName: e.target.value })} className={`${inputCls} mt-1`} />
                  </label>
                  <div className="sm:col-span-2 flex justify-end gap-2">
                    <button onClick={() => setEditingProgram(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">
                      <X className="h-3.5 w-3.5" /> Cancelar
                    </button>
                    <button onClick={() => saveProgramEdit(p.id)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
                      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
                    </button>
                  </div>
                </div>
              )}

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
