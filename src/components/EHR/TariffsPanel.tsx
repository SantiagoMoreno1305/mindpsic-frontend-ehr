/**
 * TariffsPanel.tsx
 *
 * Cuánto vale una sesión — dos tarifas independientes, según cómo llega el
 * paciente:
 *
 *   - Por convenio (CompanyTariff): cada convenio (Company, isDefault=false)
 *     paga un valor fijo por categoría de atención. Ej. Sura paga distinto a
 *     Constructora Las Galias por la misma Terapia individual.
 *   - Particular / directo (EstratoTariff): cuando el paciente llega sin
 *     convenio (atendido bajo el Company.isDefault del tenant), se cobra
 *     según su estrato — con paquetes opcionales de descuento por volumen
 *     (EstratoTariffPackage) para cantidades puntuales de sesiones.
 *
 * La categoría de atención (Individual / Con especialista) NO es la
 * especialidad clínica del psicólogo (Psicología infantil, Neuropsicología...
 * esas son varias y no cambian el precio) — son solo estas 2, y no se eligen
 * a mano: el backend las deriva del nivel académico del psicólogo que
 * atendió la cita (ver deriveAttentionTier en tariff.service.js). Por eso acá
 * no hay ningún selector de "a qué le pongo esta tarifa" más allá de estas 2
 * filas fijas — es la lectura del Excel de tarifas de la empresa.
 *
 * El costo real de CADA cita se congela solo (Appointment.appliedCost) al
 * marcarla "Atendida" — este panel solo edita el catálogo, no las citas.
 *
 * Si un paciente que venía de un convenio pasa a particular, el sistema
 * congela sola su tarifa heredada (Patient.overrideCostPerSession) — no se
 * gestiona desde acá, es automático (ver authorizeSessions en el backend).
 *
 * Restringido a CEO/DIRECTIVO — mismo criterio que antes aplicaba Specialty.
 * costPerSession: ni ESPECIALISTA_B2B ni OPERATIVO deben ver ni tocar costos.
 *
 * Endpoints:
 *   GET/POST/DELETE /api/company-tariffs
 *   GET/POST/DELETE /api/estrato-tariffs
 *   POST/DELETE     /api/estrato-tariffs/:id/packages, /api/estrato-tariff-packages/:id
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Trash2, Plus, Package, X } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useCompanies } from '../../hooks/useCompanies';

type AttentionTier = 'INDIVIDUAL' | 'ESPECIALISTA';

const ATTENTION_TIERS: { value: AttentionTier; label: string; hint: string }[] = [
  { value: 'INDIVIDUAL', label: 'Terapia individual', hint: 'Psicólogo general (Técnico/Tecnólogo/Pregrado)' },
  { value: 'ESPECIALISTA', label: 'Terapia con especialista', hint: 'Psicólogo con Especialización/Maestría/Doctorado' },
];

interface CompanyTariffRow {
  id: string;
  attentionTier: AttentionTier;
  costPerSession: number;
}

interface EstratoTariffPackageRow {
  id: string;
  sessionsCount: number;
  discountPercent: number;
  costPerSession: number;
}

interface EstratoTariffRow {
  id: string;
  estrato: number;
  attentionTier: AttentionTier;
  costPerSession: number;
  packages: EstratoTariffPackageRow[];
}

const ESTRATOS = [1, 2, 3, 4, 5, 6];

function formatCOP(value: number) {
  return `$${Math.round(value).toLocaleString('es-CO')}`;
}

export default function TariffsPanel() {
  const { companies } = useCompanies();
  const conveniosSoloReales = useMemo(() => companies.filter((c) => !c.isDefault), [companies]);

  const [tab, setTab] = useState<'convenio' | 'particular'>('convenio');

  return (
    <div className="max-w-4xl mx-auto space-y-6 text-left">
      <div className="border-b border-slate-200 pb-4">
        <span className="bg-toast-100 text-charcoal-900 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border border-toast-300 font-mono">
          Solo CEO / Directivo
        </span>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">Tarifas por sesión</h1>
        <p className="text-xs text-slate-400 mt-1 max-w-2xl">
          Cuánto se cobra por convenio (valor fijo negociado) o, si el paciente llega particular, según su estrato. La categoría (individual / con especialista) se calcula sola según el nivel académico del psicólogo que atendió — no es la especialidad clínica.
        </p>
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        <button
          onClick={() => setTab('convenio')}
          className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
            tab === 'convenio' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Por convenio
        </button>
        <button
          onClick={() => setTab('particular')}
          className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
            tab === 'particular' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Particular (por estrato)
        </button>
      </div>

      {tab === 'convenio' ? <CompanyTariffsTab companies={conveniosSoloReales} /> : <EstratoTariffsTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Tarifas por convenio
// ─────────────────────────────────────────────────────────────────────────
function CompanyTariffsTab({ companies }: { companies: { id: string; name: string }[] }) {
  const [companyId, setCompanyId] = useState('');
  const [tariffs, setTariffs] = useState<CompanyTariffRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState<Record<AttentionTier, string>>({ INDIVIDUAL: '', ESPECIALISTA: '' });
  const [savingTier, setSavingTier] = useState<AttentionTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTariffs = (cid: string) => {
    if (!cid) { setTariffs([]); return; }
    setLoading(true);
    apiFetch(`/api/company-tariffs?companyId=${cid}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CompanyTariffRow[]) => {
        const list = Array.isArray(data) ? data : [];
        setTariffs(list);
        const next: Record<AttentionTier, string> = { INDIVIDUAL: '', ESPECIALISTA: '' };
        list.forEach((t) => { next[t.attentionTier] = String(t.costPerSession); });
        setInputs(next);
      })
      .catch(() => setError('No se pudieron cargar las tarifas de este convenio.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTariffs(companyId); }, [companyId]);

  const tariffByTier = useMemo(() => {
    const map: Partial<Record<AttentionTier, CompanyTariffRow>> = {};
    tariffs.forEach((t) => { map[t.attentionTier] = t; });
    return map;
  }, [tariffs]);

  async function handleSave(attentionTier: AttentionTier) {
    const raw = inputs[attentionTier];
    const cost = Number(raw);
    if (raw === '' || Number.isNaN(cost) || cost < 0) {
      setError('El costo debe ser un número mayor o igual a 0.');
      return;
    }
    setSavingTier(attentionTier);
    setError(null);
    try {
      const res = await apiFetch('/api/company-tariffs', {
        method: 'POST',
        body: JSON.stringify({ companyId, attentionTier, costPerSession: cost }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      fetchTariffs(companyId);
    } finally {
      setSavingTier(null);
    }
  }

  async function handleClear(attentionTier: AttentionTier) {
    const existing = tariffByTier[attentionTier];
    if (!existing) return;
    if (!confirm('¿Quitar esta tarifa para este convenio?')) return;
    const res = await apiFetch(`/api/company-tariffs/${existing.id}`, { method: 'DELETE' });
    if (res.ok) {
      setInputs((prev) => ({ ...prev, [attentionTier]: '' }));
      fetchTariffs(companyId);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Convenio</label>
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
        >
          <option value="">Selecciona un convenio...</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}

      {!companyId ? (
        <p className="text-sm text-slate-400 py-6">Elige un convenio para ver y editar sus tarifas por sesión.</p>
      ) : loading ? (
        <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-semibold">Categoría</th>
                <th className="px-4 py-3 font-semibold">Costo por sesión</th>
                <th className="px-4 py-3 text-right font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ATTENTION_TIERS.map((tier) => (
                <tr key={tier.value}>
                  <td className="px-4 py-3">
                    <p className="text-slate-700 font-medium">{tier.label}</p>
                    <p className="text-[10.5px] text-slate-400">{tier.hint}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400 text-xs">$</span>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={inputs[tier.value]}
                        onChange={(e) => setInputs((prev) => ({ ...prev, [tier.value]: e.target.value }))}
                        placeholder="Sin tarifa"
                        className="w-32 rounded-md border border-slate-200 px-2 py-1.5 text-sm font-mono text-charcoal-900 outline-none focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20"
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        onClick={() => handleSave(tier.value)}
                        disabled={savingTier === tier.value}
                        className="rounded-md bg-charcoal-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer"
                      >
                        {savingTier === tier.value ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar'}
                      </button>
                      {tariffByTier[tier.value] && (
                        <button
                          onClick={() => handleClear(tier.value)}
                          title="Quitar tarifa"
                          className="text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Tarifas particulares (por estrato) + paquetes de descuento
// ─────────────────────────────────────────────────────────────────────────
function EstratoTariffsTab() {
  const [attentionTier, setAttentionTier] = useState<AttentionTier>('INDIVIDUAL');
  const [allTariffs, setAllTariffs] = useState<EstratoTariffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [savingEstrato, setSavingEstrato] = useState<number | null>(null);
  const [expandedEstrato, setExpandedEstrato] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = () => {
    setLoading(true);
    apiFetch('/api/estrato-tariffs')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setAllTariffs(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudieron cargar las tarifas particulares.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAll(); }, []);

  const rowsForTier = useMemo(() => {
    const map: Record<number, EstratoTariffRow> = {};
    allTariffs.filter((t) => t.attentionTier === attentionTier).forEach((t) => { map[t.estrato] = t; });
    return map;
  }, [allTariffs, attentionTier]);

  useEffect(() => {
    const next: Record<number, string> = {};
    ESTRATOS.forEach((e) => { next[e] = rowsForTier[e] ? String(rowsForTier[e].costPerSession) : ''; });
    setInputs(next);
  }, [attentionTier, allTariffs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(estrato: number) {
    const raw = inputs[estrato];
    const cost = Number(raw);
    if (raw === undefined || raw === '' || Number.isNaN(cost) || cost < 0) {
      setError('El costo debe ser un número mayor o igual a 0.');
      return;
    }
    setSavingEstrato(estrato);
    setError(null);
    try {
      const res = await apiFetch('/api/estrato-tariffs', {
        method: 'POST',
        body: JSON.stringify({ estrato, attentionTier, costPerSession: cost }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      fetchAll();
    } finally {
      setSavingEstrato(null);
    }
  }

  async function handleClear(estrato: number) {
    const existing = rowsForTier[estrato];
    if (!existing) return;
    if (!confirm('¿Quitar esta tarifa? También se eliminan sus paquetes de descuento.')) return;
    const res = await apiFetch(`/api/estrato-tariffs/${existing.id}`, { method: 'DELETE' });
    if (res.ok) fetchAll();
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Categoría</label>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
          {ATTENTION_TIERS.map((tier) => (
            <button
              key={tier.value}
              onClick={() => { setAttentionTier(tier.value); setExpandedEstrato(null); }}
              className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                attentionTier === tier.value ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tier.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {ESTRATOS.map((estrato) => {
            const row = rowsForTier[estrato];
            const isExpanded = expandedEstrato === estrato;
            return (
              <div key={estrato} className="rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="w-20 shrink-0 text-xs font-bold text-slate-500">Estrato {estrato}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 text-xs">$</span>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={inputs[estrato] ?? ''}
                      onChange={(e) => setInputs((prev) => ({ ...prev, [estrato]: e.target.value }))}
                      placeholder="Sin tarifa"
                      className="w-32 rounded-md border border-slate-200 px-2 py-1.5 text-sm font-mono text-charcoal-900 outline-none focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20"
                    />
                  </div>
                  <button
                    onClick={() => handleSave(estrato)}
                    disabled={savingEstrato === estrato}
                    className="rounded-md bg-charcoal-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer"
                  >
                    {savingEstrato === estrato ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar'}
                  </button>
                  {row && (
                    <>
                      <button
                        onClick={() => handleClear(estrato)}
                        title="Quitar tarifa"
                        className="text-slate-400 hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setExpandedEstrato(isExpanded ? null : estrato)}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-toast-300 cursor-pointer"
                      >
                        <Package className="h-3.5 w-3.5" />
                        Paquetes {row.packages.length > 0 && `(${row.packages.length})`}
                      </button>
                    </>
                  )}
                </div>
                {isExpanded && row && <PackagesEditor estratoTariff={row} onChange={fetchAll} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PackagesEditor({ estratoTariff, onChange }: { estratoTariff: EstratoTariffRow; onChange: () => void }) {
  const [sessionsCount, setSessionsCount] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    const sessions = Number(sessionsCount);
    const discount = Number(discountPercent);
    if (!Number.isInteger(sessions) || sessions <= 0) {
      setError('La cantidad de sesiones debe ser un entero mayor a 0.');
      return;
    }
    if (Number.isNaN(discount) || discount < 0 || discount > 100) {
      setError('El descuento debe ser un número entre 0 y 100.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/estrato-tariffs/${estratoTariff.id}/packages`, {
        method: 'POST',
        body: JSON.stringify({ sessionsCount: sessions, discountPercent: discount }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setSessionsCount('');
      setDiscountPercent('');
      onChange();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    const res = await apiFetch(`/api/estrato-tariff-packages/${id}`, { method: 'DELETE' });
    if (res.ok) onChange();
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-3">
      {estratoTariff.packages.length > 0 && (
        <ul className="space-y-1.5">
          {estratoTariff.packages.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
              <span className="text-slate-600">
                <span className="font-bold text-charcoal-900">{p.sessionsCount} sesiones</span>
                {' '}— {p.discountPercent}% desc. → <span className="font-mono font-bold text-emerald-700">{formatCOP(p.costPerSession)}</span> c/u
              </span>
              <button onClick={() => handleDelete(p.id)} className="text-slate-400 hover:text-rose-600 cursor-pointer">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-[11px] font-medium text-rose-600">{error}</p>}

      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          placeholder="Sesiones (ej. 10)"
          value={sessionsCount}
          onChange={(e) => setSessionsCount(e.target.value)}
          className="w-32 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-mono outline-none focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20"
        />
        <input
          type="number"
          min={0}
          max={100}
          placeholder="% descuento"
          value={discountPercent}
          onChange={(e) => setDiscountPercent(e.target.value)}
          className="w-28 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-mono outline-none focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20"
        />
        <button
          onClick={handleAdd}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-md bg-charcoal-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Agregar
        </button>
      </div>
      <p className="text-[10.5px] text-slate-400">
        La cantidad debe calzar exacto con las sesiones autorizadas del lote (ej. un paquete de 10 solo aplica si se autorizaron exactamente 10).
      </p>
    </div>
  );
}
