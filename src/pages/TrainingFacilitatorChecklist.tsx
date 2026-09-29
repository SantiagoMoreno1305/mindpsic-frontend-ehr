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
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <ShieldCheck className="h-5 w-5 text-toast-500" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">MINDPSIC</span>
          <span className="text-sm text-charcoal-900/50">· Checklist de fidelidad</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:py-10">{children}</main>
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

// Tabla única, pregunta por fila y Bloque 1 / Bloque 2 en columnas lado a
// lado — misma distribución que el documento fuente ("CHECKLIST DE FIDELIDAD
// DE IMPLEMENTACIÓN"), en vez de repetir el formulario completo dos veces.
function SectionRow({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={3} className="bg-toast-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-charcoal-900/60">{label}</td>
    </tr>
  );
}

function ScoreCell({ value, onChange, options }: { value: any; onChange: (v: number) => void; options: { value: number; label: string }[] }) {
  return (
    <div className="flex justify-center gap-1">
      {options.map((o) => (
        <button key={o.value} type="button" title={o.label} onClick={() => onChange(o.value)}
          className={`h-8 w-8 rounded-lg border text-xs font-semibold transition ${value === o.value ? 'border-toast-500 bg-toast-500 text-white' : 'border-charcoal-900/15 bg-white hover:border-toast-300'}`}>
          {o.value}
        </button>
      ))}
    </div>
  );
}

function ChecklistTable({ catalog, block1, block2, setBlock1, setBlock2 }: {
  catalog: Catalog; block1: Record<string, any>; block2: Record<string, any>;
  setBlock1: (v: Record<string, any>) => void; setBlock2: (v: Record<string, any>) => void;
}) {
  const setters = { 1: (k: string, v: any) => setBlock1({ ...block1, [k]: v }), 2: (k: string, v: any) => setBlock2({ ...block2, [k]: v }) };
  const values = { 1: block1, 2: block2 };
  const cellCls = 'border-t border-charcoal-900/10 px-2 py-2.5 align-top';

  return (
    <div className="overflow-x-auto rounded-xl border border-charcoal-900/10">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-charcoal-900/50">
            <th className="px-3 py-2">Componente</th>
            <th className="w-40 px-2 py-2 text-center">Bloque 1</th>
            <th className="w-40 px-2 py-2 text-center">Bloque 2</th>
          </tr>
        </thead>
        <tbody>
          <SectionRow label="Parte A · Cobertura de contenidos (0 = no se desarrolló · 1 = parcial · 2 = completo)" />
          {catalog.blockA.map((f) => (
            <tr key={f.code}>
              <td className={cellCls}><span className="mr-1.5 font-mono text-[11px] text-charcoal-900/40">{f.code}</span>{f.label}</td>
              {([1, 2] as const).map((n) => (
                <td key={n} className={cellCls}><ScoreCell value={values[n][f.code]} onChange={(v) => setters[n](f.code, v)} options={catalog.blockAOptions} /></td>
              ))}
            </tr>
          ))}

          <SectionRow label="Parte B · Condiciones de los bloques" />
          {catalog.blockBNum.map((f) => (
            <tr key={f.code}>
              <td className={cellCls}><span className="mr-1.5 font-mono text-[11px] text-charcoal-900/40">{f.code}</span>{f.label}</td>
              {([1, 2] as const).map((n) => (
                <td key={n} className={cellCls}>
                  <input type="number" min={0} value={values[n][f.code]} onChange={(e) => setters[n](f.code, e.target.value)}
                    className="w-full rounded-lg border border-charcoal-900/15 px-2 py-1.5 text-center text-sm focus:border-toast-500 focus:outline-none" />
                </td>
              ))}
            </tr>
          ))}
          {catalog.blockBSelect.map((f) => (
            <tr key={f.code}>
              <td className={cellCls}><span className="mr-1.5 font-mono text-[11px] text-charcoal-900/40">{f.code}</span>{f.label}</td>
              {([1, 2] as const).map((n) => (
                <td key={n} className={cellCls}>
                  <select value={values[n][f.code]} onChange={(e) => setters[n](f.code, e.target.value)}
                    className="w-full rounded-lg border border-charcoal-900/15 px-2 py-1.5 text-sm focus:border-toast-500 focus:outline-none">
                    <option value="">Selecciona…</option>
                    {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
              ))}
            </tr>
          ))}
          {catalog.blockBText.map((f) => (
            <tr key={f.code}>
              <td className={cellCls}><span className="mr-1.5 font-mono text-[11px] text-charcoal-900/40">{f.code}</span>{f.label}</td>
              {([1, 2] as const).map((n) => (
                <td key={n} className={cellCls}>
                  <textarea rows={2} value={values[n][f.code]} onChange={(e) => setters[n](f.code, e.target.value)}
                    className="w-full rounded-lg border border-charcoal-900/15 px-2 py-1.5 text-xs focus:border-toast-500 focus:outline-none" />
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td className={cellCls}><span className="mr-1.5 font-mono text-[11px] text-charcoal-900/40">FI16</span>¿Se activó alguna derivación por la ruta de atención?</td>
            {([1, 2] as const).map((n) => (
              <td key={n} className={cellCls}>
                <div className="flex justify-center gap-1.5">
                  {[['Sí', true], ['No', false]].map(([lbl, val]) => (
                    <button key={String(val)} type="button" onClick={() => setters[n]('fi16', val)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${values[n].fi16 === val ? 'border-toast-500 bg-toast-500 text-white' : 'border-charcoal-900/15'}`}>
                      {lbl as string}
                    </button>
                  ))}
                </div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
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

        <div className="mt-5">
          <ChecklistTable catalog={ctx.catalog} block1={block1} block2={block2} setBlock1={setBlock1} setBlock2={setBlock2} />
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
