/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pantalla PÚBLICA del checklist de fidelidad — /capacitacion/facilitadora/:token
 *
 * Un solo enlace reutilizable enviado directamente a las facilitadoras.
 * Identificación solo por nombre (sin doble captura, sin cédula: personal de
 * confianza, no público general). Sin candado de tiempo — se puede enviar
 * cuando sea, la hora queda registrada para el seguimiento de fidelidad.
 */

import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { getApiBase } from '../lib/apiClient';

const API = `${getApiBase()}/api/training/checklist`;

interface CatalogField { code: string; label: string; options?: string[] }
interface Catalog { sedes: string[]; blockA: CatalogField[]; blockAOptions: { value: number; label: string }[]; blockBNum: CatalogField[]; blockBSelect: CatalogField[]; blockBText: CatalogField[] }
interface Context { program: { name: string; clientName: string }; visit: { order: number; date: string } | null; catalog: Catalog }

function tokenFromPath(): string {
  const marker = '/capacitacion/facilitadora/';
  const idx = window.location.pathname.indexOf(marker);
  return idx === -1 ? '' : decodeURIComponent(window.location.pathname.slice(idx + marker.length)).replace(/\/+$/, '');
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-toast-50 text-charcoal-900 antialiased">
      <header className="border-b border-charcoal-900/10 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <ShieldCheck className="h-5 w-5 text-toast-500" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">MINDPSIC</span>
          <span className="text-sm text-charcoal-900/50">· Checklist de fidelidad</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">{children}</main>
    </div>
  );
}
const Card = ({ children }: { children: React.ReactNode }) => <section className="rounded-2xl border border-charcoal-900/10 bg-white p-5 shadow-sm sm:p-7">{children}</section>;

function emptyBlock(catalog: Catalog): Record<string, any> {
  const b: Record<string, any> = {};
  catalog.blockA.forEach((f) => { b[f.code] = null; });
  catalog.blockBNum.forEach((f) => { b[f.code] = ''; });
  catalog.blockBSelect.forEach((f) => { b[f.code] = ''; });
  catalog.blockBText.forEach((f) => { b[f.code] = ''; });
  b.fi16 = null;
  return b;
}
function blockComplete(catalog: Catalog, b: Record<string, any>): boolean {
  if (!catalog.blockA.every((f) => b[f.code] !== null && b[f.code] !== undefined)) return false;
  if (!catalog.blockBNum.every((f) => b[f.code] !== '' && Number.isFinite(Number(b[f.code])))) return false;
  if (!catalog.blockBSelect.every((f) => f.options?.includes(b[f.code]))) return false;
  if (b.fi16 !== true && b.fi16 !== false) return false;
  return true;
}
function cleanBlock(catalog: Catalog, b: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  catalog.blockA.forEach((f) => { out[f.code] = Number(b[f.code]); });
  catalog.blockBNum.forEach((f) => { out[f.code] = Number(b[f.code]); });
  catalog.blockBSelect.forEach((f) => { out[f.code] = b[f.code]; });
  catalog.blockBText.forEach((f) => { out[f.code] = b[f.code] || ''; });
  out.fi16 = b.fi16;
  return out;
}

function BlockForm({ title, catalog, value, onChange }: { title: string; catalog: Catalog; value: Record<string, any>; onChange: (v: Record<string, any>) => void }) {
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="rounded-xl border border-charcoal-900/10 p-4">
      <h3 className="mb-3 text-sm font-semibold text-charcoal-900">{title}</h3>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-900/50">Cobertura de contenidos</p>
      <div className="space-y-3">
        {catalog.blockA.map((f) => (
          <div key={f.code}>
            <p className="mb-1 text-sm">{f.label}</p>
            <div className="flex gap-1.5">
              {catalog.blockAOptions.map((o) => (
                <button key={o.value} type="button" title={o.label} onClick={() => set(f.code, o.value)}
                  className={`h-9 flex-1 rounded-lg border text-xs font-semibold ${value[f.code] === o.value ? 'border-toast-500 bg-toast-500 text-white' : 'border-charcoal-900/15 bg-white'}`}>
                  {o.value}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-charcoal-900/50">Condiciones del bloque</p>
      <div className="grid grid-cols-2 gap-3">
        {catalog.blockBNum.map((f) => (
          <label key={f.code} className="text-xs">
            {f.label}
            <input type="number" min={0} value={value[f.code]} onChange={(e) => set(f.code, e.target.value)} className="mt-1 w-full rounded-lg border border-charcoal-900/15 px-2.5 py-2 text-sm" />
          </label>
        ))}
        {catalog.blockBSelect.map((f) => (
          <label key={f.code} className="text-xs">
            {f.label}
            <select value={value[f.code]} onChange={(e) => set(f.code, e.target.value)} className="mt-1 w-full rounded-lg border border-charcoal-900/15 px-2.5 py-2 text-sm">
              <option value="">Selecciona…</option>
              {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
      </div>

      <div className="mt-3 space-y-3">
        {catalog.blockBText.map((f) => (
          <label key={f.code} className="block text-xs">
            {f.label}
            <textarea rows={2} value={value[f.code]} onChange={(e) => set(f.code, e.target.value)} className="mt-1 w-full rounded-lg border border-charcoal-900/15 px-2.5 py-2 text-sm" />
          </label>
        ))}
        <div>
          <p className="mb-1 text-xs">¿Se activó alguna derivación por la ruta de atención?</p>
          <div className="flex gap-2">
            {[['Sí', true], ['No', false]].map(([lbl, val]) => (
              <button key={String(val)} type="button" onClick={() => set('fi16', val)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${value.fi16 === val ? 'border-toast-500 bg-toast-500 text-white' : 'border-charcoal-900/15'}`}>{lbl as string}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TrainingFacilitatorChecklist() {
  const token = useMemo(tokenFromPath, []);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const [facilitatorName, setFacilitatorName] = useState('');
  const [sede, setSede] = useState('');
  const [block1, setBlock1] = useState<Record<string, any>>({});
  const [block2, setBlock2] = useState<Record<string, any>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/public/${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Este enlace no es válido.');
        setCtx(data);
        setBlock1(emptyBlock(data.catalog));
        setBlock2(emptyBlock(data.catalog));
      } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
    })();
  }, [token]);

  const submit = async () => {
    if (!ctx?.visit) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API}/public/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilitatorName, sede, visitOrder: ctx.visit.order, block1: cleanBlock(ctx.catalog, block1), block2: cleanBlock(ctx.catalog, block2) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setDone(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (loading) return <Shell><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-toast-500" /></div></Shell>;

  if (!ctx || !ctx.visit) {
    return (
      <Shell>
        <Card>
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-toast-500" aria-hidden />
          <p className="text-center text-sm text-charcoal-900/70">{error || 'Este cronograma todavía no tiene fechas de visita configuradas.'}</p>
        </Card>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <Card>
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-toast-500" aria-hidden />
          <h1 className="text-center text-xl font-semibold">Checklist enviado</h1>
          <p className="mt-2 text-center text-sm text-charcoal-900/70">Gracias, {facilitatorName}. Ya puedes cerrar esta página.</p>
        </Card>
      </Shell>
    );
  }

  const canSubmit = facilitatorName.trim().length > 1 && !!sede && blockComplete(ctx.catalog, block1) && blockComplete(ctx.catalog, block2);

  return (
    <Shell>
      <Card>
        <p className="text-xs font-semibold uppercase tracking-wider text-toast-500">{ctx.program.clientName}</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Checklist de fidelidad — Visita {ctx.visit.order}</h1>
        <p className="mt-2 text-sm text-charcoal-900/70">Se diligencia una vez por visita, con las columnas de los dos bloques. Sin candado de tiempo, pero la hora de envío queda registrada.</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Facilitador (nombre)
            <input value={facilitatorName} onChange={(e) => setFacilitatorName(e.target.value)} className="mt-1 w-full rounded-xl border border-charcoal-900/15 px-3 py-2.5 text-sm focus:border-toast-500 focus:outline-none focus:ring-2 focus:ring-toast-500/30" />
          </label>
          <label className="text-sm font-medium">
            Sede
            <select value={sede} onChange={(e) => setSede(e.target.value)} className="mt-1 w-full rounded-xl border border-charcoal-900/15 px-3 py-2.5 text-sm focus:border-toast-500 focus:outline-none focus:ring-2 focus:ring-toast-500/30">
              <option value="">Selecciona…</option>
              {ctx.catalog.sedes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-5 space-y-4">
          <BlockForm title="Bloque 1" catalog={ctx.catalog} value={block1} onChange={setBlock1} />
          <BlockForm title="Bloque 2" catalog={ctx.catalog} value={block2} onChange={setBlock2} />
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

        <div className="mt-6 flex justify-end">
          <button
            disabled={!canSubmit || busy} onClick={() => void submit()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-toast-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-toast-500/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Enviar checklist
          </button>
        </div>
        {!canSubmit && <p className="mt-2 text-right text-xs text-charcoal-900/50">Completa nombre, sede y los dos bloques para enviar.</p>}
      </Card>
    </Shell>
  );
}
