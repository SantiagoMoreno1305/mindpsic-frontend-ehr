/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Portal de Programas de medición (staff).
 *
 * Solo lo ven CEO/DIRECTIVO de un tenant con Tenant.allowMeasurementPrograms.
 * Aquí se crean los programas (p. ej. Obreval), se genera UN enlace general por
 * corte (T0/T1/T2) con fecha de vencimiento y se sigue el avance en conteos
 * operativos — nunca se ven respuestas ni cédulas.
 */

import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Copy, Check, Plus, Loader2, Link2, Lock, CalendarClock, Download } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

interface Wave {
  id: string;
  moment: 'T0' | 'T1' | 'T2';
  status: 'OPEN' | 'CLOSED' | 'EXPIRED' | 'NOT_OPEN';
  closesAt: string;
  url: string;
  counts?: { started: number; fichas: number; formaT: number; formaA: number };
}
interface Program { id: string; name: string; clientName: string; codePrefix: string; participants: number; waves: Wave[] }

const MOMENTS: { id: Wave['moment']; label: string; hint: string }[] = [
  { id: 'T0', label: 'T0 · Línea base', hint: 'Antes de empezar el programa' },
  { id: 'T1', label: 'T1 · Cierre', hint: 'Al terminar el programa' },
  { id: 'T2', label: 'T2 · Seguimiento', hint: 'Entre 10 y 20 días después' },
];

const STATUS: Record<Wave['status'], { label: string; cls: string }> = {
  OPEN: { label: 'Abierto', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  EXPIRED: { label: 'Vencido', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  CLOSED: { label: 'Cerrado', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  NOT_OPEN: { label: 'Aún no abre', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });
const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-toast-500 focus:outline-none focus:ring-2 focus:ring-toast-500/30';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/programs${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
  return body as T;
}

function CopyLink({ url }: { url: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(url); setOk(true); setTimeout(() => setOk(false), 2000); } catch { window.prompt('Copia el enlace:', url); }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50"
    >
      {ok ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {ok ? 'Copiado' : 'Copiar enlace'}
    </button>
  );
}

// Descarga autenticada. El archivo llega como JSON con el contenido en base64 (encoding=base64):
// un binario (xlsx) directo a través de API Gateway/Lambda se corrompe si el gateway no tiene
// tipos binarios configurados, y así no dependemos de eso.
function ExportButtons({ waveId }: { waveId: string }) {
  const [busy, setBusy] = useState<'xlsx' | 'csv' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [withId, setWithId] = useState(false);

  const download = async (format: 'xlsx' | 'csv') => {
    setBusy(format); setErr(null);
    try {
      const res = await apiFetch(`/api/programs/waves/${waveId}/export?format=${format}&encoding=base64${withId ? '&identified=1' : ''}`);
      let bytes: Uint8Array;
      let filename = `corte.${format}`;
      let contentType = format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv;charset=utf-8';
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
        // Servidor sin soporte de base64 (versión anterior): llega el binario directo.
        if (!res.ok) throw new Error(`Error ${res.status}`);
        bytes = new Uint8Array(await res.arrayBuffer());
      }
      // Un .xlsx es un ZIP: siempre empieza por 'PK'. Si no, el archivo llegó dañado y Excel
      // no lo abriría — se avisa en vez de descargar algo inservible.
      if (format === 'xlsx' && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
        throw new Error('El archivo llegó dañado desde el servidor. Vuelve a intentarlo; si persiste, avisa a soporte.');
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {(['xlsx', 'csv'] as const).map((f) => (
          <button key={f} disabled={busy !== null} onClick={() => void download(f)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50">
            {busy === f ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {f === 'xlsx' ? 'Excel' : 'CSV'}
          </button>
        ))}
      </div>
      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
        <input type="checkbox" checked={withId} onChange={(e) => setWithId(e.target.checked)} />
        Incluir número de cédula <span className="text-slate-400">(uso interno, no compartir con Obreval)</span>
      </label>
      {err && <span role="alert" className="text-xs text-red-700">{err}</span>}
    </div>
  );
}

function WaveRow({ moment, wave, programId, onChanged }: { moment: typeof MOMENTS[number]; wave?: Wave; programId: string; onChanged: () => void }) {
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [extending, setExtending] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); setExtending(false); setDate(''); onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const minDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{moment.label}</div>
          <div className="text-xs text-slate-500">{moment.hint}</div>
        </div>
        {wave && <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS[wave.status].cls}`}>{STATUS[wave.status].label}</span>}
      </div>

      {!wave ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            Vence el
            <input type="date" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} mt-1 w-44`} />
          </label>
          <button
            disabled={!date || busy}
            onClick={() => run(() => call(`/${programId}/waves`, { method: 'POST', body: JSON.stringify({ moment: moment.id, closesAt: date }) }))}
            className="inline-flex items-center gap-1.5 rounded-xl bg-toast-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-toast-500/90 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Generar enlace
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2">
            <input readOnly value={wave.url} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} font-mono text-xs`} />
            <CopyLink url={wave.url} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Vence el {fmt(wave.closesAt)}</span>
            {wave.counts && (
              <>
                <span>{wave.counts.fichas} fichas</span>
                <span>{wave.counts.formaT} Forma T</span>
                <span>{wave.counts.formaA} Forma A</span>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Exportar respuestas</span>
            <ExportButtons waveId={wave.id} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {extending ? (
              <>
                <input type="date" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} w-44`} />
                <button disabled={!date || busy} onClick={() => run(() => call(`/waves/${wave.id}`, { method: 'PATCH', body: JSON.stringify({ closesAt: date, status: 'OPEN' }) }))} className="rounded-lg bg-charcoal-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Guardar</button>
                <button onClick={() => setExtending(false)} className="text-xs text-slate-500">Cancelar</button>
              </>
            ) : (
              <>
                <button onClick={() => setExtending(true)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">Cambiar vencimiento</button>
                {wave.status === 'OPEN' && (
                  <button disabled={busy} onClick={() => run(() => call(`/waves/${wave.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'CLOSED' }) }))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"><Lock className="h-3.5 w-3.5" /> Cerrar ahora</button>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-xs text-red-700">{err}</p>}
    </div>
  );
}

export default function ProgramsPortal() {
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', clientName: '', codePrefix: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setPrograms((await call<{ programs: Program[] }>('/')).programs); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await call('/', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', clientName: '', codePrefix: '' }); setCreating(false); await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="h-full overflow-y-auto bg-toast-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-toast-500 text-white"><ClipboardList className="h-5 w-5" /></span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-charcoal-900">Programas de medición</h1>
              <p className="text-sm text-slate-500">Un enlace general por corte, con vencimiento. Los participantes se identifican con su cédula.</p>
            </div>
          </div>
          <button onClick={() => setCreating((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl bg-charcoal-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-charcoal-800">
            <Plus className="h-4 w-4" /> Nuevo programa
          </button>
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

        {creating && (
          <form onSubmit={create} className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
            <label className="text-xs font-medium text-slate-600 sm:col-span-1">Nombre del programa
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${inputCls} mt-1`} placeholder="Factores de riesgo psicosocial" />
            </label>
            <label className="text-xs font-medium text-slate-600">Empresa cliente
              <input required value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className={`${inputCls} mt-1`} placeholder="Constructora Obreval S.A.S." />
            </label>
            <label className="text-xs font-medium text-slate-600">Prefijo de códigos
              <input required maxLength={5} value={form.codePrefix} onChange={(e) => setForm({ ...form, codePrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} className={`${inputCls} mt-1 font-mono`} placeholder="OBR" />
            </label>
            <div className="sm:col-span-3 flex justify-end">
              <button disabled={busy || form.codePrefix.length < 2} className="inline-flex items-center gap-2 rounded-xl bg-toast-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Crear programa
              </button>
            </div>
          </form>
        )}

        {programs === null && !error && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-toast-500" /></div>}
        {programs?.length === 0 && !creating && (
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
                <div className="text-right text-xs text-slate-500">
                  <div className="font-mono">{p.codePrefix}-[SEDE]-[FORMA]-NNN</div>
                  <div>{p.participants} participante(s) registrados</div>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {MOMENTS.map((m) => (
                  <WaveRow key={m.id} moment={m} programId={p.id} wave={p.waves.find((w) => w.moment === m.id)} onChanged={load} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
