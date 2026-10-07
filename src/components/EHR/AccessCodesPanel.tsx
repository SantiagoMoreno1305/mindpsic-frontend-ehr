/**
 * AccessCodesPanel.tsx
 *
 * Códigos de acceso auto-servibles, creados por el propio tenant para SUS
 * clientes — no confundir con las licencias del tenant (Subscription.
 * seatLimit/patientLimit, eso se gestiona desde AdminCenter). Dos usos:
 *
 *   - LINEA247: quien no sabe cómo se llama su convenio en el sistema (o no
 *     quiere buscarlo) escribe este código al autorregistrarse en línea24x7
 *     y el sistema resuelve el convenio solo (ver linea247-pre-register.
 *     controller.js).
 *   - EVALUATION_CAMPAIGN: además del convenio, precarga qué instrumento se
 *     le asigna automáticamente a quien se registre con este código — para
 *     campañas de evaluación masiva a varios clientes de una vez.
 *
 * El código es único en TODA la plataforma (no solo en este tenant) — quien
 * lo usa todavía no sabe a qué tenant pertenece, así que no hay forma de
 * acotar la búsqueda por tenant al momento de canjearlo.
 *
 * Endpoints consumidos:
 *   GET   /api/access-codes            → listado de códigos del tenant
 *   POST  /api/access-codes            → crear uno nuevo
 *   PATCH /api/access-codes/:id/close  → revocar uno antes de tiempo
 *   GET   /api/assessments/catalog     → catálogo de instrumentos (solo para EVALUATION_CAMPAIGN)
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, Plus, X, Copy, Check, Loader2, Ban, Building2, ClipboardList, BellRing, Pencil, MoreVertical, Users } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useCompanies } from '../../hooks/useCompanies';
import { LugarAplicacionFields, camposDeLugar, etiquetaDeLugar, lineasDeLugar, textoDeLugar, type LugarTipo } from './LugarAplicacionFields';

interface InstrumentOption {
  id: string;
  code: string;
  name: string;
  nameEs?: string | null;
  modality: string;
}

interface AccessCodeRecord {
  id: string;
  code: string;
  purpose: 'LINEA247' | 'EVALUATION_CAMPAIGN';
  name: string | null;
  status: 'activo' | 'cerrado';
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  createdByName: string | null;
  createdAt: string;
  company: { id: string; name: string };
  // Un código puede llevar varios instrumentos a la vez (decisión
  // 2026-10-07) — si viene de una oleada de investigación, son los de la
  // oleada; si es un código de campaña suelto, los suyos propios.
  instruments: Array<{ id: string; code: string; name: string; nameEs?: string | null }>;
  evaluationDeadline: string | null;
  lugarTipo: string | null;
  lugarOpciones: string[] | null;
  // Estado como CANAL DE ENTRADA (¿todavía se puede canjear?) — lo calcula el
  // backend. Independiente del avance de lo ya canjeado (progress).
  lifecycle: Lifecycle;
  progress: Progress;
}

type Lifecycle = 'ACTIVO' | 'AGOTADO' | 'VENCIDO' | 'CERRADO';

interface Progress {
  redeemed: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  overdue: number;
  invalid: number;
  pending: number;
}

type EvalState = 'SIN_INICIAR' | 'EN_PROGRESO' | 'COMPLETADA' | 'FUERA_DE_PLAZO' | 'INVALIDA';

interface RedemptionRecord {
  id: string;
  redeemedAt: string;
  patient: { id: string; firstName: string; lastName: string; documentId: string; email: string | null };
  // Varias si el código lleva varios instrumentos — una por cada evaluación
  // que se le creó a esta persona al canjear.
  evaluations: Array<{ state: EvalState; instrumentName: string; dueAt: string | null; startedAt: string | null; completedAt: string | null }>;
  lastRemindedAt: string | null;
  reminderCount: number;
  canRemind: boolean;
}

const LIFECYCLE_STYLES: Record<Lifecycle, { label: string; badge: string; hint: string }> = {
  ACTIVO: { label: 'Activo', badge: 'bg-emerald-100 text-emerald-700', hint: 'Se puede canjear' },
  AGOTADO: { label: 'Agotado', badge: 'bg-indigo-100 text-indigo-700', hint: 'Ya se usó todo su cupo' },
  VENCIDO: { label: 'Vencido', badge: 'bg-amber-100 text-amber-700', hint: 'Pasó su fecha de vencimiento' },
  CERRADO: { label: 'Cerrado', badge: 'bg-slate-200 text-slate-500', hint: 'Se cerró manualmente' },
};

const EVAL_STATE_STYLES: Record<EvalState, { label: string; badge: string }> = {
  SIN_INICIAR: { label: 'Sin iniciar', badge: 'bg-slate-100 text-slate-600' },
  EN_PROGRESO: { label: 'En progreso', badge: 'bg-sky-100 text-sky-700' },
  COMPLETADA: { label: 'Completada', badge: 'bg-emerald-100 text-emerald-700' },
  FUERA_DE_PLAZO: { label: 'Fuera de plazo', badge: 'bg-rose-100 text-rose-700' },
  INVALIDA: { label: 'Inválida', badge: 'bg-slate-200 text-slate-500' },
};

type Filter = 'TODOS' | Lifecycle | 'PENDIENTES';
type Purpose = AccessCodeRecord['purpose'];
type TypeFilter = 'ALL' | Purpose;

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const PURPOSE_LABELS: Record<string, string> = {
  LINEA247: 'Línea 24/7',
  EVALUATION_CAMPAIGN: 'Campaña de evaluación',
};

// Menú "⋮" por fila — antes había 0, 1 o 2 botones sueltos según el estado del
// código, lo que dejaba la columna "Acción" despeinada (cada fila con un ancho
// distinto). Un solo punto de entrada consistente, con las opciones que apliquen
// adentro, y "—" cuando no hay ninguna.
//
// Renderizado en un portal a document.body con posición `fixed` calculada
// desde el botón (NO `absolute` dentro de la fila): la tabla tiene scroll
// propio, y un menú `absolute` se corta contra su borde en las últimas filas
// (reportado 2026-10-07, mismo bug que WaveActionsMenu en ResearchProjectsPanel).
function RowActionsMenu({
  hasRedemptions, expanded, canClose, onToggleRedemptions, onClose,
}: {
  hasRedemptions: boolean;
  expanded: boolean;
  canClose: boolean;
  onToggleRedemptions: () => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<{ top: number; left: number; visibility: 'hidden' | 'visible' }>({ top: 0, left: 0, visibility: 'hidden' });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const MENU_WIDTH = 192; // w-48

  const close = () => setOpen(false);

  // Primero se posiciona "a ciegas" (debajo del botón, visibility: hidden)
  // para medir la altura real del menú ya renderizado, y recién con esa
  // medida se decide si voltearlo hacia arriba.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setStyle({ top: rect.bottom + 4, left: Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8), visibility: 'hidden' });
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !btnRef.current || style.visibility === 'visible') return;
    const btnRect = btnRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current.offsetHeight;
    const openUp = window.innerHeight - btnRect.bottom < menuHeight + 8 && btnRect.top > menuHeight + 8;
    setStyle({
      top: openUp ? btnRect.top - menuHeight - 4 : btnRect.bottom + 4,
      left: Math.min(btnRect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
      visibility: 'visible',
    });
  }, [open, style]);

  // Scroll/resize con el menú abierto invalida la posición calculada — más
  // simple y confiable cerrarlo que recalcular en cada evento de scroll.
  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => close();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  if (!hasRedemptions && !canClose) {
    return <span className="text-xs text-slate-300">—</span>;
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title="Acciones"
        className="inline-flex items-center justify-center rounded-md border border-slate-200 p-1.5 text-slate-500 hover:border-slate-300 hover:bg-slate-50 cursor-pointer"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: style.top, left: style.left, width: MENU_WIDTH, visibility: style.visibility }}
            className="z-50 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            {hasRedemptions && (
              <button
                onClick={() => { onToggleRedemptions(); close(); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Users className="h-3.5 w-3.5 text-slate-400" />
                {expanded ? 'Ocultar canjes' : 'Ver canjes'}
              </button>
            )}
            {canClose && (
              <button
                onClick={() => { onClose(); close(); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-rose-600 hover:bg-rose-50 cursor-pointer"
              >
                <Ban className="h-3.5 w-3.5" />
                Cerrar código
              </button>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

export default function AccessCodesPanel({ canCreate = true }: { canCreate?: boolean }) {
  const { companies } = useCompanies();
  const [codes, setCodes] = useState<AccessCodeRecord[]>([]);
  const [instruments, setInstruments] = useState<InstrumentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form state
  const [companyId, setCompanyId] = useState('');
  const [purpose, setPurpose] = useState<'LINEA247' | 'EVALUATION_CAMPAIGN'>('LINEA247');
  // Varios instrumentos por código (decisión 2026-10-07) — checklist, no un
  // solo select.
  const [instrumentIds, setInstrumentIds] = useState<string[]>([]);
  // Si se elige una oleada, sus instrumentos mandan y el selector de arriba
  // se oculta — ver modules/research-projects (el código canjea la oleada,
  // no instrumentos sueltos). Dos selects en cascada (proyecto → oleada) en
  // vez de una sola lista plana "Proyecto — Oleada (CÓDIGO)": con varios
  // proyectos activos esa lista se vuelve larga y difícil de escanear.
  const [researchProjectId, setResearchProjectId] = useState('');
  const [researchWaveId, setResearchWaveId] = useState('');
  interface ResearchWaveOption { id: string; name: string | null; order: number; instruments: Array<{ code: string }> }
  interface ResearchProjectOption { id: string; name: string; waves: ResearchWaveOption[] }
  const [researchProjects, setResearchProjects] = useState<ResearchProjectOption[]>([]);
  const [name, setName] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [lugarTipo, setLugarTipo] = useState<LugarTipo | ''>('');
  const [lugarTexto, setLugarTexto] = useState('');
  // Edición del lugar de un código ya creado (diálogo aparte).
  const [editLugarCode, setEditLugarCode] = useState<AccessCodeRecord | null>(null);
  const [editLugarTipo, setEditLugarTipo] = useState<LugarTipo | ''>('');
  const [editLugarTexto, setEditLugarTexto] = useState('');
  const [savingLugar, setSavingLugar] = useState(false);
  const [editLugarError, setEditLugarError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [evaluationDeadline, setEvaluationDeadline] = useState('');
  const [filter, setFilter] = useState<Filter>('TODOS');
  // Primer nivel de organización: el TIPO de código (para qué sirve). El
  // estado (activo/vencido/...) se combina con este, no lo reemplaza.
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingUsesId, setEditingUsesId] = useState<string | null>(null);
  const [editMaxUses, setEditMaxUses] = useState('');
  const [savingUses, setSavingUses] = useState(false);
  const [editUsesError, setEditUsesError] = useState<string | null>(null);

  const fetchCodes = () => {
    setLoading(true);
    apiFetch('/api/access-codes')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setCodes(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudieron cargar los códigos de acceso.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCodes();
    apiFetch('/api/assessments/catalog')
      .then((res) => (res.ok ? res.json() : { instruments: [] }))
      .then((data) => {
        const list = Array.isArray(data?.instruments) ? data.instruments : [];
        // Un instrumento heteroaplicado no se puede autoaplicar por código —
        // mismo criterio que ya rechaza el backend, se filtra acá para no
        // ofrecer una opción que de todas formas va a fallar al guardar.
        setInstruments(list.filter((i: any) => i.modality !== 'heteroaplicada'));
      })
      .catch(() => setInstruments([]));
    // Oleadas de proyectos de investigación (opcional, si el módulo está
    // habilitado) — un 403/404 aquí no es un error visible, simplemente no
    // hay nada que ofrecer en el selector.
    apiFetch('/api/research-projects')
      .then((res) => (res.ok ? res.json() : { projects: [] }))
      .then((data) => {
        const projects = Array.isArray(data?.projects) ? data.projects : [];
        setResearchProjects(projects.map((proj: any) => ({
          id: proj.id, name: proj.name,
          waves: (proj.waves || []).map((w: any) => ({ id: w.id, name: w.name, order: w.order, instruments: (w.instruments || []).map((i: any) => ({ code: i.code })) })),
        })));
      })
      .catch(() => setResearchProjects([]));
  }, []);

  function resetForm() {
    setCompanyId('');
    setPurpose('LINEA247');
    setInstrumentIds([]);
    setResearchProjectId('');
    setResearchWaveId('');
    setName('');
    setCustomCode('');
    setMaxUses('');
    setExpiresAt('');
    setEvaluationDeadline('');
    setLugarTipo('');
    setLugarTexto('');
    setFormError(null);
  }

  function openForm() {
    resetForm();
    // Si ya estás viendo un tipo, "Nuevo código" arranca con ese tipo elegido.
    if (typeFilter !== 'ALL') setPurpose(typeFilter);
    setShowForm(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId) {
      setFormError('Elige un convenio/cliente.');
      return;
    }
    if (purpose === 'EVALUATION_CAMPAIGN' && instrumentIds.length === 0 && !researchWaveId) {
      setFormError('Elige al menos un instrumento para asignar con este código, o una oleada de investigación.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await apiFetch('/api/access-codes', {
        method: 'POST',
        body: JSON.stringify({
          companyId,
          purpose,
          instrumentIds: purpose === 'EVALUATION_CAMPAIGN' && !researchWaveId ? instrumentIds : undefined,
          researchWaveId: purpose === 'EVALUATION_CAMPAIGN' ? researchWaveId || undefined : undefined,
          name: name.trim() || undefined,
          code: customCode.trim() || undefined,
          maxUses: maxUses.trim() || undefined,
          expiresAt: expiresAt || undefined,
          evaluationDeadline: purpose === 'EVALUATION_CAMPAIGN' ? evaluationDeadline || undefined : undefined,
          ...(purpose === 'EVALUATION_CAMPAIGN' ? camposDeLugar(lugarTipo, lugarTexto) : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || `HTTP ${res.status}`);
        return;
      }
      setShowForm(false);
      fetchCodes();
    } catch {
      setFormError('No se pudo contactar el servidor.');
    } finally {
      setSubmitting(false);
    }
  }

  function startEditLugar(c: AccessCodeRecord) {
    setEditLugarCode(c);
    setEditLugarTipo((c.lugarTipo as LugarTipo) || '');
    setEditLugarTexto(textoDeLugar(c.lugarOpciones));
    setEditLugarError(null);
  }

  async function saveLugar() {
    if (!editLugarCode) return;
    setSavingLugar(true);
    setEditLugarError(null);
    try {
      // Sin nada escrito se borra el lugar: el código deja de pedirlo.
      const campos = camposDeLugar(editLugarTipo, editLugarTexto);
      const body = Object.keys(campos).length ? campos : { lugarTipo: null, lugarOpciones: null };
      const res = await apiFetch(`/api/access-codes/${editLugarCode.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditLugarError(data.error || `HTTP ${res.status}`);
        return;
      }
      setEditLugarCode(null);
      fetchCodes();
    } catch {
      setEditLugarError('No se pudo contactar el servidor.');
    } finally {
      setSavingLugar(false);
    }
  }

  function startEditUses(c: AccessCodeRecord) {
    setEditingUsesId(c.id);
    setEditMaxUses(c.maxUses != null ? String(c.maxUses) : '');
    setEditUsesError(null);
  }

  async function saveMaxUses(id: string) {
    setSavingUses(true);
    setEditUsesError(null);
    try {
      const res = await apiFetch(`/api/access-codes/${id}`, { method: 'PATCH', body: JSON.stringify({ maxUses: editMaxUses.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditUsesError(data.error || `HTTP ${res.status}`);
        return;
      }
      setEditingUsesId(null);
      fetchCodes();
    } catch {
      setEditUsesError('No se pudo contactar el servidor.');
    } finally {
      setSavingUses(false);
    }
  }

  async function handleClose(id: string) {
    if (!confirm('¿Cerrar este código? Ya no se podrá usar para registrarse, pero los registros que ya lo usaron no se ven afectados.')) return;
    const res = await apiFetch(`/api/access-codes/${id}/close`, { method: 'PATCH' });
    if (res.ok) fetchCodes();
  }

  function copyCode(id: string, code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }

  const inType = (c: AccessCodeRecord) => typeFilter === 'ALL' || c.purpose === typeFilter;
  const matchesStatus = (c: AccessCodeRecord, f: Filter) =>
    f === 'TODOS' ? true : f === 'PENDIENTES' ? c.progress.pending > 0 : c.lifecycle === f;

  // "Con pendientes" solo existe para campañas (las de Línea 24/7 no tienen evaluación).
  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'TODOS', label: 'Todos' },
    { id: 'ACTIVO', label: 'Activos' },
    { id: 'AGOTADO', label: 'Agotados' },
    { id: 'VENCIDO', label: 'Vencidos' },
    { id: 'CERRADO', label: 'Cerrados' },
    ...(typeFilter === 'LINEA247' ? [] : [{ id: 'PENDIENTES' as Filter, label: 'Con pendientes' }]),
  ];
  const countFor = (f: Filter) => codes.filter((c) => inType(c) && matchesStatus(c, f)).length;
  const visibleCodes = codes.filter((c) => inType(c) && matchesStatus(c, filter));

  const TYPE_TABS: { id: TypeFilter; label: string; icon: typeof KeyRound }[] = [
    { id: 'ALL', label: 'Todos los tipos', icon: KeyRound },
    { id: 'LINEA247', label: PURPOSE_LABELS.LINEA247, icon: Building2 },
    { id: 'EVALUATION_CAMPAIGN', label: 'Campañas de evaluación', icon: ClipboardList },
  ];
  const typeCount = (t: TypeFilter) => codes.filter((c) => t === 'ALL' || c.purpose === t).length;
  const typeActiveCount = (t: TypeFilter) => codes.filter((c) => (t === 'ALL' || c.purpose === t) && c.lifecycle === 'ACTIVO').length;
  const selectType = (t: TypeFilter) => {
    setTypeFilter(t);
    if (t === 'LINEA247' && filter === 'PENDIENTES') setFilter('TODOS');
    setExpandedId(null);
  };

  // Columnas que aplican al tipo visible: Línea 24/7 no tiene evaluación, así
  // que ni "Avance" ni el instrumento tienen qué mostrar.
  const showPurposeCol = typeFilter !== 'LINEA247';
  const showAvanceCol = typeFilter !== 'LINEA247';
  const colCount = 6 + (showPurposeCol ? 1 : 0) + (showAvanceCol ? 1 : 0);

  return (
    <div className="max-w-6xl mx-auto space-y-6 text-left">
      <div className="border-b border-slate-200 pb-4 flex items-center justify-between gap-4">
        <div>
          <span className="bg-toast-100 text-charcoal-900 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border border-toast-300 font-mono">
            Autoservicio para tus clientes
          </span>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">Códigos de acceso</h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Un código que reparten a sus clientes — quien lo escribe al registrarse en línea24/7 o en la app queda vinculado automáticamente a su convenio (y, si es una campaña de evaluación, con su evaluación ya asignada).
          </p>
        </div>
        <button
          onClick={openForm}
          disabled={!canCreate}
          title={canCreate ? undefined : 'Tu clínica no tiene habilitada la creación de códigos'}
          className="inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-charcoal-800 cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-charcoal-900"
        >
          <Plus className="h-4 w-4" />
          Nuevo código
        </button>
      </div>

      {!canCreate && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          Tu clínica no tiene habilitada la creación de códigos de acceso — contacta a MindPsic para activarla.
          Los códigos que ya existen siguen funcionando y puedes cerrarlos o enviar recordatorios.
        </p>
      )}

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : codes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-14 text-center">
          <KeyRound className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">Todavía no has creado ningún código de acceso.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="tablist" aria-label="Tipo de código">
            {TYPE_TABS.map((t) => {
              const active = typeFilter === t.id;
              const Icon = t.icon;
              const activos = typeActiveCount(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => selectType(t.id)}
                  className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                    active
                      ? 'border-toast-400 bg-toast-50 ring-2 ring-toast-500/20'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-toast-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className="text-xl font-black leading-none text-slate-900">{typeCount(t.id)}</span>
                      <span className="truncate text-sm font-bold text-slate-900">{t.label}</span>
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">
                      {activos === 0 ? 'Ninguno activo' : `${activos} activo${activos === 1 ? '' : 's'}`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => {
              const count = countFor(f.id);
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                    active ? 'border-charcoal-900 bg-charcoal-900 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {f.label}
                  <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
                </button>
              );
            })}
          </div>

          {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-semibold">Código</th>
                  {showPurposeCol && (
                    <th className="px-4 py-3 font-semibold">{typeFilter === 'ALL' ? 'Propósito' : 'Evaluación'}</th>
                  )}
                  <th className="px-4 py-3 font-semibold">Convenio</th>
                  <th className="px-4 py-3 font-semibold">Canjes</th>
                  {showAvanceCol && <th className="px-4 py-3 font-semibold">Avance</th>}
                  <th className="px-4 py-3 font-semibold">Vence</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 text-right font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleCodes.length === 0 && (
                  <tr><td colSpan={colCount} className="px-4 py-10 text-center text-sm text-slate-400">
                    {typeCount(typeFilter) === 0 ? 'Aún no has creado códigos de este tipo.' : 'Ningún código en este filtro.'}
                  </td></tr>
                )}
                {visibleCodes.map((c) => {
                  const style = LIFECYCLE_STYLES[c.lifecycle];
                  const isCampaign = c.purpose === 'EVALUATION_CAMPAIGN';
                  const expanded = expandedId === c.id;
                  // Un código que ya no se puede canjear pero aún tiene evaluaciones
                  // sin resolver NO es "terminado": se resalta para no perderlo de vista.
                  const stalePending = c.lifecycle !== 'ACTIVO' && c.progress.pending > 0;
                  return (
                    <React.Fragment key={c.id}>
                      <tr className={c.lifecycle === 'CERRADO' ? 'opacity-60' : ''}>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => copyCode(c.id, c.code)}
                            title="Copiar código"
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs font-bold text-charcoal-900 hover:bg-toast-50 cursor-pointer"
                          >
                            {c.code}
                            {copiedId === c.id ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-slate-400" />}
                          </button>
                          {c.name && <span className="mt-1 block text-[10.5px] text-slate-400">{c.name}</span>}
                          {c.purpose === 'EVALUATION_CAMPAIGN' && (
                            <span className="mt-1 flex items-center gap-1 text-[10.5px] text-slate-500">
                              {c.lugarOpciones?.length
                                ? `${etiquetaDeLugar(c.lugarTipo)} · ${c.lugarOpciones.length} opciones`
                                : 'Sin lugar de aplicación'}
                              {c.lifecycle !== 'CERRADO' && (
                                <button onClick={() => startEditLugar(c)} title="Definir lugar de aplicación" className="rounded p-0.5 text-slate-300 hover:text-toast-500 cursor-pointer">
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                            </span>
                          )}
                        </td>
                        {showPurposeCol && (
                          <td className="px-4 py-3">
                            {typeFilter === 'ALL' ? (
                              <>
                                <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                                  {c.purpose === 'LINEA247' ? <Building2 className="h-3.5 w-3.5 text-toast-500" /> : <ClipboardList className="h-3.5 w-3.5 text-toast-500" />}
                                  {PURPOSE_LABELS[c.purpose] || c.purpose}
                                </span>
                                {c.instruments.length > 0 && <span className="mt-0.5 block text-[10.5px] text-slate-400">{c.instruments.map((i) => i.name).join(' + ')}</span>}
                              </>
                            ) : (
                              <span className="text-xs text-slate-600">{c.instruments.length ? c.instruments.map((i) => i.name).join(' + ') : '—'}</span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 text-slate-600">{c.company.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {editingUsesId === c.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number" min={c.usedCount || 1} autoFocus value={editMaxUses}
                                onChange={(e) => setEditMaxUses(e.target.value)}
                                placeholder="Sin límite"
                                className="w-20 rounded-md border border-slate-200 px-1.5 py-1 text-xs outline-none focus:border-toast-400 focus:ring-2 focus:ring-toast-500/20"
                              />
                              <button onClick={() => saveMaxUses(c.id)} disabled={savingUses} title="Guardar" className="rounded-md p-1 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40 cursor-pointer">
                                {savingUses ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              </button>
                              <button onClick={() => setEditingUsesId(null)} disabled={savingUses} title="Cancelar" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 cursor-pointer">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEditUses(c)}
                              disabled={c.lifecycle === 'CERRADO'}
                              title={c.lifecycle === 'CERRADO' ? 'Un código cerrado no se puede editar' : 'Editar el cupo máximo'}
                              className="group inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:hover:bg-transparent cursor-pointer"
                            >
                              {c.usedCount}{c.maxUses != null ? ` / ${c.maxUses}` : ' / ∞'}
                              {c.lifecycle !== 'CERRADO' && <Pencil className="h-3 w-3 text-slate-300 group-hover:text-toast-500" />}
                            </button>
                          )}
                          {editingUsesId === c.id && editUsesError && <span className="mt-1 block text-[10.5px] font-sans text-rose-600">{editUsesError}</span>}
                        </td>
                        {showAvanceCol && (
                        <td className="px-4 py-3 text-xs">
                          {isCampaign ? (
                            c.progress.redeemed === 0 ? (
                              <span className="text-slate-400">Sin canjes</span>
                            ) : (
                              <div className="space-y-0.5">
                                <span className="text-slate-600">
                                  {c.progress.completed}/{c.progress.redeemed} completadas
                                </span>
                                {c.progress.pending > 0 && (
                                  <span className={`block font-semibold ${stalePending || c.progress.overdue > 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                                    {c.progress.pending} pendiente{c.progress.pending === 1 ? '' : 's'}
                                    {c.progress.overdue > 0 ? ` · ${c.progress.overdue} fuera de plazo` : ''}
                                  </span>
                                )}
                              </div>
                            )
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                          {isCampaign && c.evaluationDeadline && (
                            <span className="mt-0.5 block text-[10.5px] text-slate-400">Plazo: {formatDate(c.evaluationDeadline)}</span>
                          )}
                        </td>
                        )}
                        <td className="px-4 py-3 text-xs text-slate-500">{formatDate(c.expiresAt)}</td>
                        <td className="px-4 py-3">
                          <span title={style.hint} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${style.badge}`}>
                            {style.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <RowActionsMenu
                            hasRedemptions={c.progress.redeemed > 0}
                            expanded={expanded}
                            canClose={c.lifecycle === 'ACTIVO'}
                            onToggleRedemptions={() => setExpandedId(expanded ? null : c.id)}
                            onClose={() => handleClose(c.id)}
                          />
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={colCount} className="px-4 py-4">
                            <RedemptionsPanel
                              code={c}
                              onChanged={(msg) => { if (msg) { setNotice(msg); setTimeout(() => setNotice(null), 4000); } fetchCodes(); }}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-bold text-charcoal-900">Nuevo código de acceso</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-charcoal-900 cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* La cantidad de campos crece con el tipo de código elegido (oleada de
                investigación, instrumento, fecha límite de evaluación...) y puede no
                caber entera en pantallas bajas; el encabezado y los botones de abajo
                quedan fijos, solo esta zona hace scroll. */}
            <form onSubmit={handleCreate} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-5">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Convenio / Cliente *</label>
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                >
                  <option value="">Selecciona...</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">¿Para qué sirve este código? *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPurpose('LINEA247')}
                    className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                      purpose === 'LINEA247' ? 'border-toast-400 bg-toast-50 text-charcoal-900' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    Línea 24/7
                    <span className="mt-0.5 block text-[10px] font-normal text-slate-400">Resuelve el convenio, sin buscarlo por nombre</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPurpose('EVALUATION_CAMPAIGN')}
                    className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                      purpose === 'EVALUATION_CAMPAIGN' ? 'border-toast-400 bg-toast-50 text-charcoal-900' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    Campaña de evaluación
                    <span className="mt-0.5 block text-[10px] font-normal text-slate-400">Además, precarga una evaluación</span>
                  </button>
                </div>
              </div>

              {purpose === 'EVALUATION_CAMPAIGN' && researchProjects.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500" title="Proyecto de investigación (opcional)">Proyecto (opcional)</label>
                    <select
                      value={researchProjectId}
                      onChange={(e) => { setResearchProjectId(e.target.value); setResearchWaveId(''); }}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                    >
                      <option value="">Ninguno — instrumento suelto</option>
                      {researchProjects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  {researchProjectId && (
                    <div>
                      <label className="mb-1.5 block truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">Oleada *</label>
                      <select
                        value={researchWaveId}
                        onChange={(e) => { setResearchWaveId(e.target.value); if (e.target.value) setInstrumentIds([]); }}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                      >
                        <option value="">Selecciona...</option>
                        {researchProjects.find((p) => p.id === researchProjectId)?.waves.map((w) => (
                          <option key={w.id} value={w.id}>{w.name || `Oleada ${w.order + 1}`} ({w.instruments.map((i) => i.code).join(' + ')})</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {researchProjectId && (
                    <p className="sm:col-span-2 text-[10.5px] text-slate-400">
                      Quien canjee este código queda enrolado en ese proyecto — la app le muestra solo sus evaluaciones.
                    </p>
                  )}
                </div>
              )}

              {purpose === 'EVALUATION_CAMPAIGN' && !researchWaveId && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Instrumentos a asignar * {instrumentIds.length > 0 && <span className="font-normal text-slate-400">({instrumentIds.length} elegido{instrumentIds.length > 1 ? 's' : ''})</span>}
                  </label>
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
                    {instruments.map((i) => {
                      const checked = instrumentIds.includes(i.id);
                      return (
                        <label key={i.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-charcoal-900 hover:bg-white">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setInstrumentIds((prev) => (checked ? prev.filter((id) => id !== i.id) : [...prev, i.id]))}
                            className="h-4 w-4 rounded border-slate-300 text-toast-500 focus:ring-toast-500/30"
                          />
                          <span>{i.nameEs || i.name} <span className="text-slate-400">({i.code})</span></span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-[10.5px] text-slate-400">Quien canjee el código recibe una evaluación por cada instrumento elegido.</p>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nombre interno (opcional)</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Bienestar funcionarios Alcaldía 2026"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                />
                <p className="mt-1 text-[10.5px] text-slate-400">Solo para que ustedes lo identifiquen — el cliente nunca lo ve.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Código (opcional)</label>
                  <input
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                    placeholder="Se genera solo"
                    maxLength={20}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-mono text-charcoal-900 outline-none placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cupo máximo</label>
                  <input
                    type="number"
                    min={1}
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                    placeholder="Sin límite"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none placeholder:text-slate-400 focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vigencia del código (opcional)</label>
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                />
                <p className="mt-1 text-[10.5px] text-slate-400">Hasta cuándo se puede CANJEAR (inclusive). Quien ya lo canjeó puede terminar su evaluación después.</p>
              </div>

              {purpose === 'EVALUATION_CAMPAIGN' && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha límite para completar la evaluación (opcional)</label>
                  <input
                    type="date"
                    value={evaluationDeadline}
                    onChange={(e) => setEvaluationDeadline(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                  />
                  <p className="mt-1 text-[10.5px] text-slate-400">Se le muestra al paciente y marca como "fuera de plazo" lo que siga pendiente. No le impide responder tarde.</p>
                </div>
              )}

              {purpose === 'EVALUATION_CAMPAIGN' && (
                <LugarAplicacionFields tipo={lugarTipo} onTipoChange={setLugarTipo} texto={lugarTexto} onTextoChange={setLugarTexto} />
              )}

              {formError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{formError}</p>}
            </div>

              <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-charcoal-900 cursor-pointer">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  {submitting ? 'Creando...' : 'Crear código'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editLugarCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="text-base font-bold text-charcoal-900">Lugar de aplicación</h2>
                <p className="font-mono text-xs text-slate-500">{editLugarCode.code}</p>
              </div>
              <button type="button" onClick={() => setEditLugarCode(null)} className="text-slate-400 hover:text-charcoal-900 cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 px-6 py-5">
              <LugarAplicacionFields tipo={editLugarTipo} onTipoChange={setEditLugarTipo} texto={editLugarTexto} onTextoChange={setEditLugarTexto} />
              <p className="text-[10.5px] text-slate-400">Afecta solo a los registros nuevos. Quien ya se registró conserva su lugar.</p>
              {editLugarError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{editLugarError}</p>}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={() => setEditLugarCode(null)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-charcoal-900 cursor-pointer">
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveLugar}
                disabled={savingLugar}
                className="inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer"
              >
                {savingLugar && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RedemptionsPanel({ code, onChanged }: { code: AccessCodeRecord; onChanged: (message?: string) => void }) {
  const [rows, setRows] = useState<RedemptionRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // id del canje, o 'ALL'
  const [actionError, setActionError] = useState<string | null>(null);
  // Aviso local, pegado a esta tabla — el de onChanged() sube hasta el panel
  // principal de códigos, que queda lejos (arriba del todo) de esta tabla
  // expandida, así que ahí no sirve de confirmación visible para quien acaba
  // de hacer clic en "Recordar" aquí abajo.
  const [localNotice, setLocalNotice] = useState<string | null>(null);

  const load = () => {
    apiFetch(`/api/access-codes/${code.id}/redemptions`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setRows(await res.json());
      })
      .catch(() => setLoadError('No se pudieron cargar los canjes.'));
  };

  useEffect(load, [code.id]);

  async function remind(redemptionId: string) {
    setBusy(redemptionId);
    setActionError(null);
    setLocalNotice(null);
    try {
      const res = await apiFetch(`/api/access-codes/${code.id}/redemptions/${redemptionId}/remind`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || `HTTP ${res.status}`);
      } else {
        const msg = 'Recordatorio enviado.';
        setLocalNotice(msg);
        setTimeout(() => setLocalNotice(null), 4000);
        onChanged(msg);
      }
      load();
    } catch {
      setActionError('No se pudo contactar el servidor.');
    } finally {
      setBusy(null);
    }
  }

  async function remindAll() {
    setBusy('ALL');
    setActionError(null);
    setLocalNotice(null);
    try {
      const res = await apiFetch(`/api/access-codes/${code.id}/remind-pending`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || `HTTP ${res.status}`);
      } else {
        const skipped = data.skippedRecently ? ` (${data.skippedRecently} ya recibieron uno en las últimas 24 h)` : '';
        const msg = `Recordatorios enviados: ${data.sent}${skipped}.`;
        setLocalNotice(msg);
        setTimeout(() => setLocalNotice(null), 4000);
        onChanged(msg);
      }
      load();
    } catch {
      setActionError('No se pudo contactar el servidor.');
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <p className="text-sm text-rose-600">{loadError}</p>;
  if (!rows) return <div className="flex justify-center py-4 text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /></div>;

  const remindable = rows.filter((r) => r.canRemind).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {rows.length} {rows.length === 1 ? 'persona canjeó' : 'personas canjearon'} este código. Solo se muestra el estado de la evaluación, no sus resultados.
        </p>
        {code.purpose === 'EVALUATION_CAMPAIGN' && (
          <button
            onClick={remindAll}
            disabled={busy !== null || remindable === 0}
            title={remindable === 0 ? 'No hay pendientes por recordar (o ya se les recordó hoy)' : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-charcoal-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-charcoal-800 disabled:opacity-40 cursor-pointer"
          >
            {busy === 'ALL' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
            Recordar a los pendientes ({remindable})
          </button>
        )}
      </div>

      {localNotice && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">{localNotice}</p>}
      {actionError && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700">{actionError}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[10.5px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2 font-semibold">Paciente</th>
              <th className="px-3 py-2 font-semibold">Canjeó</th>
              <th className="px-3 py-2 font-semibold">Evaluación(es)</th>
              <th className="px-3 py-2 font-semibold">Recordatorios</th>
              <th className="px-3 py-2 text-right font-semibold" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <span className="block font-semibold text-charcoal-900">{r.patient.firstName} {r.patient.lastName}</span>
                  <span className="block text-[10.5px] text-slate-400">{r.patient.documentId}{r.patient.email ? ` · ${r.patient.email}` : ''}</span>
                </td>
                <td className="px-3 py-2 text-slate-500">{formatDate(r.redeemedAt)}</td>
                <td className="px-3 py-2 space-y-1">
                  {r.evaluations.length > 0 ? (
                    r.evaluations.map((ev, idx) => (
                      <div key={idx}>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${EVAL_STATE_STYLES[ev.state].badge}`}>
                          {EVAL_STATE_STYLES[ev.state].label}
                        </span>
                        <span className="mt-0.5 block text-[10.5px] text-slate-400">
                          {ev.instrumentName}{ev.completedAt ? ` · Terminó ${formatDate(ev.completedAt)}` : ev.dueAt ? ` · Plazo ${formatDate(ev.dueAt)}` : ''}
                        </span>
                      </div>
                    ))
                  ) : (
                    <span className="text-slate-300">Sin evaluación</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {r.reminderCount > 0 ? `${r.reminderCount} · último ${formatDate(r.lastRemindedAt)}` : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.evaluations.some((ev) => ev.state !== 'COMPLETADA' && ev.state !== 'INVALIDA') && (
                    <button
                      onClick={() => remind(r.id)}
                      disabled={!r.canRemind || busy !== null}
                      title={r.canRemind ? 'Enviarle un recordatorio' : 'Ya se le recordó en las últimas 24 horas'}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-toast-300 disabled:opacity-40 cursor-pointer"
                    >
                      {busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <BellRing className="h-3 w-3" />}
                      Recordar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
