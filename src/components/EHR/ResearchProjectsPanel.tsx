/**
 * ResearchProjectsPanel.tsx
 *
 * Evaluar una cohorte propia, por oleadas, DENTRO de un tenant ya existente
 * (no un tenant nuevo dedicado — decisión explícita). El participante se
 * autorregistra en mindhealth-mobile con un código de acceso (ver
 * AccessCodesPanel, campo "Vincular a oleada de investigación"), y la app le
 * muestra solo sus evaluaciones ("modo evaluación" — ver
 * Patient.researchProjectId en el backend).
 *
 * Distinto de "Programas de medición" (modules/programs — web, sin cuenta,
 * identidad por cédula cifrada, para un cliente contratado puntual): aquí sí
 * hay cuenta real, pensada para poder volver a evaluar a la misma persona
 * más adelante (oleadas T0/T1/...).
 *
 * Endpoints consumidos (modules/research-projects):
 *   GET  /api/research-projects/capability
 *   GET  /api/research-projects
 *   POST /api/research-projects
 *   POST /api/research-projects/:projectId/waves
 *   POST /api/research-projects/waves/:waveId/assign
 *   GET  /api/research-projects/:projectId/stats
 *   GET  /api/research-projects/waves/:waveId/participants
 *   GET  /api/research-projects/waves/:waveId/export
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-hot-toast';
import { FlaskConical, Plus, Loader2, ChevronDown, ChevronRight, Send, BarChart3, Users, Download, KeyRound, X, MoreVertical, Pencil, UserCog, Trash2, FileText } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useCompanies } from '../../hooks/useCompanies';
import { LugarAplicacionFields, camposDeLugar, type LugarTipo } from './LugarAplicacionFields';

interface InstrumentOption {
  id: string;
  code: string;
  name: string;
  nameEs?: string | null;
  modality: string;
}

interface WaveAccessCode {
  id: string;
  code: string;
  usedCount: number;
  maxUses: number | null;
  lifecycle: 'ACTIVO' | 'AGOTADO' | 'VENCIDO' | 'CERRADO';
}

interface WaveRecord {
  id: string;
  name: string | null;
  order: number;
  startAt: string | null;
  dueAt: string | null;
  // Varios instrumentos por oleada (decisión 2026-10-07) — no uno solo.
  instruments: Array<{ id: string; code: string; name: string }>;
  assignedCount: number;
  completedCount: number;
  accessCodes: WaveAccessCode[];
}

interface ProjectRecord {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  company: { id: string; name: string } | null;
  participantsCount: number;
  waves: WaveRecord[];
}

interface ScaleStat {
  scaleId: string;
  scaleName: string;
  isPrimary: boolean;
  n: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  severityDistribution: { severity: string | null; count: number }[];
}

interface WaveStat {
  waveId: string;
  name: string | null;
  order: number;
  instruments: Array<{ id: string; code: string; name: string }>;
  assignedTotal: number;
  completedTotal: number;
  completionRate: number | null;
  scales: ScaleStat[];
}

interface ParticipantScale {
  scaleId: string;
  scaleName: string;
  // scaleId NO es único entre instrumentos (varias escalas "total" comparten
  // el mismo scaleId genérico "TOTAL") — hace falta para no confundir dos
  // escalas de instrumentos distintos que comparten scaleId (decisión
  // 2026-10-07, ver participantRows en el backend).
  instrumentId: string;
  instrumentCode: string;
  rawScore: number | null;
  severity: string | null;
}

interface ParticipantRow {
  administrationId: string;
  // Una fila es una PERSONA, no una administración — puede tener varias si
  // la oleada lleva varios instrumentos (decisión 2026-10-07).
  administrationIds: string[];
  instrumentCodes: string[];
  patientId: string;
  firstName: string;
  lastName: string;
  documentType: string | null;
  documentId: string;
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'INVALID';
  statusLabel: string;
  assignedAt: string;
  completedAt: string | null;
  scales: ParticipantScale[];
}

interface ParticipantsResponse {
  wave: { id: string; name: string | null; order: number; instruments: Array<{ id: string; code: string; name: string }> };
  scales: { scaleId: string; scaleName: string; instrumentId: string; instrumentCode: string }[];
  participants: ParticipantRow[];
}

interface SupervisorRecord {
  userId: string;
  name: string | null;
  email: string;
  assignedAt: string;
}

const CODE_LIFECYCLE_STYLES: Record<WaveAccessCode['lifecycle'], { label: string; cls: string }> = {
  ACTIVO: { label: 'activo', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  AGOTADO: { label: 'agotado', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  VENCIDO: { label: 'vencido', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  CERRADO: { label: 'cerrado', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

function formatPct(v: number | null) {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}
function formatNum(v: number | null) {
  return v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Menú "⋮" de una oleada — renderizado en un portal a document.body, NO como
 * `absolute` dentro de la fila. La fila vive en una lista con scroll propio:
 * un menú `absolute` anclado ahí se corta contra el borde del contenedor (o
 * del viewport) cuando la oleada es de las últimas de la lista (reportado
 * 2026-10-07). El portal + posición `fixed` calculada desde el botón evita
 * el recorte, y se voltea hacia arriba solo si de verdad no cabe abajo.
 */
function WaveActionsMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<{ top: number; left: number; visibility: 'hidden' | 'visible' }>({ top: 0, left: 0, visibility: 'hidden' });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const MENU_WIDTH = 208;

  const close = () => setOpen(false);

  // Primero se posiciona "a ciegas" (debajo del botón, visibility: hidden)
  // para poder MEDIR la altura real del menú ya renderizado, y recién con
  // esa medida se decide si voltearlo hacia arriba — así nunca hay que
  // adivinar cuántos ítems trae (varían según canManage, cupo, etc.).
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

  // Si se hace scroll o se cambia el tamaño de la ventana con el menú
  // abierto, la posición calculada queda vieja — más simple y confiable
  // cerrarlo que tratar de recalcular en cada evento de scroll.
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

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title="Más opciones"
        className="flex items-center justify-center rounded-lg border border-slate-300 p-1.5 text-slate-500 hover:bg-slate-50"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: style.top, left: style.left, width: MENU_WIDTH, visibility: style.visibility }}
            className="z-50 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            {children(close)}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

export default function ResearchProjectsPanel({ canManage }: { canManage: boolean }) {
  const { companies } = useCompanies();
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  // Distingue "tu clínica no tiene esto habilitado" de "sí lo tienes, pero
  // todavía no creaste ningún proyecto" — antes las dos se veían igual
  // (silenciosamente vacías), y una vez el permiso se apagó por error un
  // proyecto real pareció haber desaparecido.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [instruments, setInstruments] = useState<InstrumentOption[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statsByProject, setStatsByProject] = useState<Record<string, { project: ProjectRecord | { id: string; name: string; status: string }; waves: WaveStat[] } | undefined>>({});
  const [loadingStats, setLoadingStats] = useState<string | null>(null);

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectCompanyId, setNewProjectCompanyId] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  const [waveFormFor, setWaveFormFor] = useState<string | null>(null);
  // Varios instrumentos por oleada (decisión 2026-10-07) — checklist, no un
  // solo select.
  const [waveInstrumentIds, setWaveInstrumentIds] = useState<string[]>([]);
  const [waveName, setWaveName] = useState('');
  const [waveStartAt, setWaveStartAt] = useState('');
  const [waveDueAt, setWaveDueAt] = useState('');
  // Menú "⋮" por oleada — Participantes/Exportar/Crear código/Editar, para
  // no apilar cinco botones en la fila (ver discusión 2026-10-07). El propio
  // WaveActionsMenu lleva su estado "abierto/cerrado" (no hace falta uno acá).
  const [editDatesFor, setEditDatesFor] = useState<{ project: ProjectRecord; wave: WaveRecord } | null>(null);
  const [editWaveName, setEditWaveName] = useState('');
  const [editStartAt, setEditStartAt] = useState('');
  const [editDueAt, setEditDueAt] = useState('');
  const [savingDates, setSavingDates] = useState(false);
  const [editDatesError, setEditDatesError] = useState<string | null>(null);
  const [creatingWave, setCreatingWave] = useState(false);

  // Cuentas SUPERVISOR_INVESTIGACION (decisión 2026-10-07) — psicólogos de
  // MindPsic que ven el avance de ESTE proyecto desde la app, no el EHR.
  // Solo CEO/DIRECTIVO pueden gestionarlas (más estricto que `canManage`).
  const [supervisorsExpandedId, setSupervisorsExpandedId] = useState<string | null>(null);
  const [supervisorsByProject, setSupervisorsByProject] = useState<Record<string, SupervisorRecord[] | undefined>>({});
  const [loadingSupervisors, setLoadingSupervisors] = useState<string | null>(null);
  const [addSupName, setAddSupName] = useState('');
  const [addSupEmail, setAddSupEmail] = useState('');
  const [addSupPassword, setAddSupPassword] = useState('');
  const [addingSupervisor, setAddingSupervisor] = useState(false);
  const [addSupervisorError, setAddSupervisorError] = useState<string | null>(null);
  const [removingSupervisorId, setRemovingSupervisorId] = useState<string | null>(null);

  // Guion del facilitador (decisión 2026-10-07) — texto plano, uno por
  // proyecto. Es en lo único que se basa el asistente de IA que ve el
  // Supervisor en la app; sin guion cargado, ese chat no funciona.
  const [guionModalFor, setGuionModalFor] = useState<ProjectRecord | null>(null);
  const [guionTexto, setGuionTexto] = useState('');
  const [loadingGuion, setLoadingGuion] = useState(false);
  const [savingGuion, setSavingGuion] = useState(false);
  const [guionError, setGuionError] = useState<string | null>(null);

  const [assigningWaveId, setAssigningWaveId] = useState<string | null>(null);
  const [expandedWaveId, setExpandedWaveId] = useState<string | null>(null);
  const [participantsByWave, setParticipantsByWave] = useState<Record<string, ParticipantsResponse | undefined>>({});
  const [loadingParticipants, setLoadingParticipants] = useState<string | null>(null);
  const [exportingWaveId, setExportingWaveId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Atajo "Crear código" por oleada — mismo POST /api/access-codes que el
  // formulario de Códigos de acceso, pero sin los selects de convenio/
  // proyecto/oleada: ya sabemos los tres porque el botón vive en esta misma
  // fila. Si el proyecto no tiene convenio asociado, se pide acá.
  const [codeModalFor, setCodeModalFor] = useState<{ project: ProjectRecord; wave: WaveRecord } | null>(null);
  const [codeCompanyId, setCodeCompanyId] = useState('');
  const [codeName, setCodeName] = useState('');
  const [codeCustom, setCodeCustom] = useState('');
  const [codeMaxUses, setCodeMaxUses] = useState('');
  const [codeExpiresAt, setCodeExpiresAt] = useState('');
  const [codeDeadline, setCodeDeadline] = useState('');
  const [codeSubmitting, setCodeSubmitting] = useState(false);
  const [codeFormError, setCodeFormError] = useState<string | null>(null);
  const [codeLugarTipo, setCodeLugarTipo] = useState<LugarTipo | ''>('');
  const [codeLugarTexto, setCodeLugarTexto] = useState('');

  const load = () => {
    setLoading(true);
    setLoadError(null);
    apiFetch('/api/research-projects')
      .then(async (res) => {
        if (res.ok) return res.json();
        const body = await res.json().catch(() => ({}));
        throw new Error(body.code === 'NOT_ENABLED'
          ? 'Tu clínica no tiene habilitados los proyectos de investigación — contacta a MindPsic para activarlos.'
          : (body.error || 'No se pudieron cargar los proyectos.'));
      })
      .then((data) => setProjects(data.projects || []))
      .catch((e) => { setProjects([]); setLoadError((e as Error).message); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    apiFetch('/api/assessments/catalog')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.instruments) setInstruments(data.instruments.filter((i: any) => i.modality !== 'heteroaplicada')); })
      .catch(() => {});
  }, []);

  const createProject = async () => {
    if (!newProjectName.trim()) { toast.error('Ponle un nombre al proyecto.'); return; }
    setCreatingProject(true);
    try {
      const res = await apiFetch('/api/research-projects', {
        method: 'POST',
        body: JSON.stringify({ name: newProjectName.trim(), companyId: newProjectCompanyId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'No se pudo crear el proyecto.'); return; }
      toast.success('Proyecto creado.');
      setShowNewProject(false);
      setNewProjectName('');
      setNewProjectCompanyId('');
      load();
    } finally {
      setCreatingProject(false);
    }
  };

  const createWave = async (projectId: string) => {
    if (waveInstrumentIds.length === 0) { toast.error('Elige al menos un instrumento.'); return; }
    setCreatingWave(true);
    try {
      const res = await apiFetch(`/api/research-projects/${projectId}/waves`, {
        method: 'POST',
        body: JSON.stringify({
          instrumentIds: waveInstrumentIds, name: waveName.trim() || undefined,
          startAt: waveStartAt || undefined, dueAt: waveDueAt || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'No se pudo crear la oleada.'); return; }
      toast.success('Oleada creada. Ya puedes generar un código de acceso para ella, o lanzarla a la cohorte.');
      setWaveFormFor(null);
      setWaveInstrumentIds([]);
      setWaveName('');
      setWaveStartAt('');
      setWaveDueAt('');
      load();
    } finally {
      setCreatingWave(false);
    }
  };

  const openCodeModal = (project: ProjectRecord, wave: WaveRecord) => {
    setCodeModalFor({ project, wave });
    setCodeCompanyId(project.company?.id || '');
    setCodeName('');
    setCodeCustom('');
    setCodeMaxUses('');
    setCodeExpiresAt('');
    setCodeDeadline('');
    setCodeLugarTipo('');
    setCodeLugarTexto('');
    setCodeFormError(null);
  };

  const submitCode = async () => {
    if (!codeModalFor) return;
    if (!codeCompanyId) { setCodeFormError('Elige un convenio/cliente.'); return; }
    setCodeSubmitting(true);
    setCodeFormError(null);
    try {
      const res = await apiFetch('/api/access-codes', {
        method: 'POST',
        body: JSON.stringify({
          companyId: codeCompanyId,
          purpose: 'EVALUATION_CAMPAIGN',
          researchWaveId: codeModalFor.wave.id,
          name: codeName.trim() || undefined,
          code: codeCustom.trim() || undefined,
          maxUses: codeMaxUses.trim() || undefined,
          expiresAt: codeExpiresAt || undefined,
          evaluationDeadline: codeDeadline || undefined,
          ...camposDeLugar(codeLugarTipo, codeLugarTexto),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCodeFormError(data.error || `Error ${res.status}`); return; }
      toast.success(`Código "${data.code}" creado.`);
      setCodeModalFor(null);
      load();
    } catch {
      setCodeFormError('No se pudo contactar el servidor.');
    } finally {
      setCodeSubmitting(false);
    }
  };

  const assignWave = async (waveId: string) => {
    setAssigningWaveId(waveId);
    try {
      const res = await apiFetch(`/api/research-projects/waves/${waveId}/assign`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'No se pudo lanzar la oleada.'); return; }
      if (data.eligible === 0) {
        toast('Todos los participantes activos ya tenían esta oleada.', { icon: 'ℹ️' });
      } else {
        toast.success(`Oleada lanzada a ${data.assigned} de ${data.eligible} participantes.`);
      }
      load();
    } finally {
      setAssigningWaveId(null);
    }
  };

  // 'en-CA' da YYYY-MM-DD directo, lo que espera un <input type="date">.
  // Con timeZone fijo en Bogotá: si no, un dueAt guardado como "fin del día
  // en Colombia" (ver utils/fecha-colombia.js) podía mostrar el día siguiente
  // según la zona horaria del navegador.
  const fechaInputColombia = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : '';

  const startEditWave = (project: ProjectRecord, wave: WaveRecord) => {
    setEditDatesFor({ project, wave });
    setEditWaveName(wave.name || '');
    setEditStartAt(fechaInputColombia(wave.startAt));
    setEditDueAt(fechaInputColombia(wave.dueAt));
    setEditDatesError(null);
  };

  const saveWaveEdits = async () => {
    if (!editDatesFor) return;
    setSavingDates(true);
    setEditDatesError(null);
    try {
      const res = await apiFetch(`/api/research-projects/waves/${editDatesFor.wave.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editWaveName.trim() || null, startAt: editStartAt || null, dueAt: editDueAt || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setEditDatesError(data.error || `HTTP ${res.status}`); return; }
      setEditDatesFor(null);
      load();
    } catch {
      setEditDatesError('No se pudo contactar el servidor.');
    } finally {
      setSavingDates(false);
    }
  };

  const toggleParticipants = async (waveId: string) => {
    if (expandedWaveId === waveId) { setExpandedWaveId(null); return; }
    setExpandedWaveId(waveId);
    if (participantsByWave[waveId]) return;
    setLoadingParticipants(waveId);
    try {
      const res = await apiFetch(`/api/research-projects/waves/${waveId}/participants`);
      const data = await res.json();
      if (res.ok) setParticipantsByWave((prev) => ({ ...prev, [waveId]: data }));
      else toast.error(data.error || 'No se pudo cargar los participantes.');
    } finally {
      setLoadingParticipants(null);
    }
  };

  // Descarga autenticada — el archivo llega como JSON con el contenido en
  // base64 (mismo patrón que ProgramsPortal.tsx: un binario directo a través
  // de API Gateway/Lambda se corrompe si el gateway no tiene tipos binarios
  // configurados).
  const downloadWave = async (waveId: string) => {
    setExportingWaveId(waveId);
    setExportError(null);
    try {
      const res = await apiFetch(`/api/research-projects/waves/${waveId}/export?encoding=base64`);
      let bytes: Uint8Array;
      let filename = 'participantes.xlsx';
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
      // Un .xlsx es un ZIP: siempre empieza por 'PK'. Si no, llegó dañado.
      if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
        throw new Error('El archivo llegó dañado desde el servidor. Vuelve a intentarlo.');
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExportingWaveId(null);
    }
  };

  const loadSupervisors = async (projectId: string) => {
    setLoadingSupervisors(projectId);
    try {
      const res = await apiFetch(`/api/research-projects/${projectId}/supervisors`);
      const data = await res.json();
      if (res.ok) setSupervisorsByProject((prev) => ({ ...prev, [projectId]: data.supervisors }));
      else toast.error(data.error || 'No se pudo cargar los supervisores.');
    } finally {
      setLoadingSupervisors(null);
    }
  };

  const toggleSupervisors = (project: ProjectRecord) => {
    if (supervisorsExpandedId === project.id) { setSupervisorsExpandedId(null); return; }
    setSupervisorsExpandedId(project.id);
    setAddSupervisorError(null);
    if (!supervisorsByProject[project.id]) loadSupervisors(project.id);
  };

  const submitAddSupervisor = async (projectId: string) => {
    if (!addSupName.trim() || !addSupEmail.trim() || !addSupPassword.trim()) {
      setAddSupervisorError('Completa nombre, correo y clave temporal.');
      return;
    }
    setAddingSupervisor(true);
    setAddSupervisorError(null);
    try {
      const res = await apiFetch(`/api/research-projects/${projectId}/supervisors`, {
        method: 'POST',
        body: JSON.stringify({ name: addSupName.trim(), email: addSupEmail.trim().toLowerCase(), password: addSupPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setAddSupervisorError(data.error || `Error ${res.status}`); return; }
      toast.success(`${data.supervisor.name} ya puede entrar a la app y ver este proyecto.`);
      setAddSupName(''); setAddSupEmail(''); setAddSupPassword('');
      loadSupervisors(projectId);
    } catch {
      setAddSupervisorError('No se pudo contactar el servidor.');
    } finally {
      setAddingSupervisor(false);
    }
  };

  const removeSupervisor = async (projectId: string, userId: string) => {
    setRemovingSupervisorId(userId);
    try {
      const res = await apiFetch(`/api/research-projects/${projectId}/supervisors/${userId}`, { method: 'DELETE' });
      if (!res.ok) { const data = await res.json().catch(() => ({})); toast.error(data.error || 'No se pudo quitar.'); return; }
      toast.success('Supervisor quitado de este proyecto.');
      loadSupervisors(projectId);
    } finally {
      setRemovingSupervisorId(null);
    }
  };

  const openGuionModal = async (project: ProjectRecord) => {
    setGuionModalFor(project);
    setGuionTexto('');
    setGuionError(null);
    setLoadingGuion(true);
    try {
      const res = await apiFetch(`/api/research-projects/${project.id}/guion`);
      const data = await res.json();
      if (res.ok) setGuionTexto(data.guion || '');
      else setGuionError(data.error || 'No se pudo cargar el guion.');
    } catch {
      setGuionError('No se pudo contactar el servidor.');
    } finally {
      setLoadingGuion(false);
    }
  };

  const saveGuion = async () => {
    if (!guionModalFor) return;
    setSavingGuion(true);
    setGuionError(null);
    try {
      const res = await apiFetch(`/api/research-projects/${guionModalFor.id}/guion`, {
        method: 'PUT',
        body: JSON.stringify({ guion: guionTexto }),
      });
      const data = await res.json();
      if (!res.ok) { setGuionError(data.error || `HTTP ${res.status}`); return; }
      toast.success('Guion guardado.');
      setGuionModalFor(null);
    } catch {
      setGuionError('No se pudo contactar el servidor.');
    } finally {
      setSavingGuion(false);
    }
  };

  const toggleStats = async (project: ProjectRecord) => {
    if (expandedId === project.id) { setExpandedId(null); return; }
    setExpandedId(project.id);
    if (statsByProject[project.id]) return;
    setLoadingStats(project.id);
    try {
      const res = await apiFetch(`/api/research-projects/${project.id}/stats`);
      const data = await res.json();
      if (res.ok) setStatsByProject((prev) => ({ ...prev, [project.id]: data }));
    } finally {
      setLoadingStats(null);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-toast-500" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Proyectos de investigación</h2>
          <p className="text-sm text-slate-500">
            Evalúa a un grupo propio por oleadas y sigue sus resultados. Los participantes se registran en la app con un
            código — ver la pestaña "Códigos de acceso" para vincular uno a una oleada.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowNewProject((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Nuevo proyecto
          </button>
        )}
      </div>

      {showNewProject && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <input
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="Nombre del proyecto — ej. Bienestar funcionarios 2026"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={newProjectCompanyId}
            onChange={(e) => setNewProjectCompanyId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Sin convenio/cliente asociado</option>
            {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={createProject} disabled={creatingProject} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {creatingProject ? 'Creando…' : 'Crear proyecto'}
            </button>
            <button onClick={() => setShowNewProject(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Cancelar</button>
          </div>
        </div>
      )}

      {loadError && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          ⚠️ {loadError}
        </div>
      )}

      {!loadError && projects && projects.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          <FlaskConical className="mx-auto mb-2 h-6 w-6 text-slate-400" />
          Todavía no hay proyectos de investigación.
        </div>
      )}

      {projects?.map((p) => (
        <div key={p.id} className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between p-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900">{p.name}</h3>
                {p.status === 'CLOSED' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Cerrado</span>}
              </div>
              <p className="text-xs text-slate-500">
                {p.company ? `${p.company.name} · ` : ''}{p.participantsCount} participante{p.participantsCount === 1 ? '' : 's'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canManage && (
                <button onClick={() => setWaveFormFor(waveFormFor === p.id ? null : p.id)} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
                  <Plus className="h-3.5 w-3.5" /> Oleada
                </button>
              )}
              <button onClick={() => toggleStats(p)} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
                <BarChart3 className="h-3.5 w-3.5" /> Resultados
                {expandedId === p.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              {canManage && (
                <button
                  onClick={() => toggleSupervisors(p)}
                  title="Psicólogos de MindPsic que ven el avance de este proyecto desde la app"
                  className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                >
                  <UserCog className="h-3.5 w-3.5" /> Supervisores
                  {supervisorsExpandedId === p.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              )}
              {canManage && (
                <button
                  onClick={() => openGuionModal(p)}
                  title="Guion del taller — en lo que se basa el asistente de IA del Supervisor en la app"
                  className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                >
                  <FileText className="h-3.5 w-3.5" /> Guion
                </button>
              )}
            </div>
          </div>

          {supervisorsExpandedId === p.id && (
            <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-3">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Supervisores de este proyecto</p>
                {loadingSupervisors === p.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                ) : (supervisorsByProject[p.id]?.length ?? 0) === 0 ? (
                  <p className="text-xs text-slate-400">Ninguno todavía.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {supervisorsByProject[p.id]?.map((s) => (
                      <li key={s.userId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                        <span className="text-slate-700">
                          <span className="font-medium">{s.name || s.email}</span>
                          {s.name && <span className="text-slate-400"> · {s.email}</span>}
                        </span>
                        <button
                          onClick={() => removeSupervisor(p.id, s.userId)}
                          disabled={removingSupervisorId === s.userId}
                          title="Quitar de este proyecto (no borra la cuenta)"
                          className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                        >
                          {removingSupervisorId === s.userId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Agregar supervisor</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input value={addSupName} onChange={(e) => setAddSupName(e.target.value)} placeholder="Nombre completo" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <input value={addSupEmail} onChange={(e) => setAddSupEmail(e.target.value)} placeholder="correo@mindpsic.co" type="email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <input value={addSupPassword} onChange={(e) => setAddSupPassword(e.target.value)} placeholder="Clave temporal (8+)" type="text" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
                </div>
                <p className="text-[10.5px] text-slate-400">
                  Si el correo ya es de un supervisor en otro proyecto, solo se agrega aquí — no se crea una cuenta nueva ni se toca su clave.
                </p>
                {addSupervisorError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{addSupervisorError}</p>}
                <button
                  onClick={() => submitAddSupervisor(p.id)}
                  disabled={addingSupervisor}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {addingSupervisor ? 'Agregando…' : 'Agregar supervisor'}
                </button>
              </div>
            </div>
          )}

          {waveFormFor === p.id && (
            <div className="border-t border-slate-100 p-4 space-y-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Instrumentos a aplicar * {waveInstrumentIds.length > 0 && <span className="font-normal text-slate-400">({waveInstrumentIds.length} elegido{waveInstrumentIds.length > 1 ? 's' : ''})</span>}
                </label>
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-300 p-2">
                  {instruments.map((i) => {
                    const checked = waveInstrumentIds.includes(i.id);
                    return (
                      <label key={i.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setWaveInstrumentIds((prev) => (checked ? prev.filter((id) => id !== i.id) : [...prev, i.id]))}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span>{i.nameEs || i.name} <span className="text-slate-400">({i.code})</span></span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                <input value={waveName} onChange={(e) => setWaveName(e.target.value)} placeholder='Nombre — ej. "T0 — Basal"' className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input type="date" value={waveStartAt} onChange={(e) => setWaveStartAt(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" title="Fecha de inicio (opcional, solo informativa)" />
                <input type="date" value={waveDueAt} onChange={(e) => setWaveDueAt(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" title="Fecha límite (opcional)" />
              </div>
              <button onClick={() => createWave(p.id)} disabled={creatingWave} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {creatingWave ? 'Creando…' : 'Crear oleada'}
              </button>
            </div>
          )}

          {p.waves.length > 0 && (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {p.waves.map((w) => (
                <div key={w.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{w.name || `Oleada ${w.order + 1}`} — {w.instruments.map((i) => i.name).join(' + ')}</p>
                      <p className="text-xs text-slate-500">
                        {w.completedCount}/{w.assignedCount} completadas
                        {w.startAt ? ` · desde ${new Date(w.startAt).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}` : ''}
                        {w.dueAt ? ` · hasta ${new Date(w.dueAt).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}` : ''}
                      </p>
                      {w.accessCodes.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {w.accessCodes.map((c) => {
                            const st = CODE_LIFECYCLE_STYLES[c.lifecycle];
                            return (
                              <span
                                key={c.id}
                                title={`Código ${c.code} — ${c.usedCount} de ${c.maxUses ?? '∞'} canjes usados`}
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px] ${st.cls}`}
                              >
                                {c.code}: {c.usedCount}/{c.maxUses ?? '∞'} canjes ({st.label})
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {canManage && (
                        <button
                          onClick={() => assignWave(w.id)}
                          disabled={assigningWaveId === w.id}
                          title="Le crea esta evaluación a todo participante activo del proyecto que aún no la tenga"
                          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                        >
                          {assigningWaveId === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          Lanzar a la cohorte
                        </button>
                      )}
                      <WaveActionsMenu>
                        {(close) => (
                          <>
                            <button
                              onClick={() => { close(); toggleParticipants(w.id); }}
                              title="Quién respondió, su estado y su puntaje"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              <Users className="h-3.5 w-3.5" /> Participantes
                            </button>
                            <button
                              onClick={() => { close(); downloadWave(w.id); }}
                              disabled={exportingWaveId === w.id || w.assignedCount === 0}
                              title="Excel con dos hojas: puntajes por escala, y las respuestas completas ítem por ítem"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                            >
                              {exportingWaveId === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                              Exportar
                            </button>
                            {canManage && (
                              <button
                                onClick={() => { close(); startEditWave(p, w); }}
                                title="Cambiar el nombre de la oleada o sus fechas — las fechas son informativas"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                <Pencil className="h-3.5 w-3.5" /> Editar
                              </button>
                            )}
                            {canManage && (
                              <button
                                onClick={() => { close(); openCodeModal(p, w); }}
                                title="Crea un código de acceso ya vinculado a esta oleada, sin tener que elegir proyecto y oleada aparte"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                <KeyRound className="h-3.5 w-3.5" /> Crear código
                              </button>
                            )}
                          </>
                        )}
                      </WaveActionsMenu>
                    </div>
                  </div>

                  {expandedWaveId === w.id && (
                    <div className="bg-slate-50 px-4 py-3">
                      {loadingParticipants === w.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                      ) : (participantsByWave[w.id]?.participants.length ?? 0) === 0 ? (
                        <p className="text-xs text-slate-400">Todavía nadie tiene esta oleada asignada.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-slate-500">
                                <th className="pb-1 pr-3">Participante</th>
                                <th className="pb-1 pr-3">Documento</th>
                                {(participantsByWave[w.id]?.wave.instruments.length ?? 0) > 1 && <th className="pb-1 pr-3">Instrumentos</th>}
                                <th className="pb-1 pr-3">Estado</th>
                                <th className="pb-1 pr-3">Completada</th>
                                {participantsByWave[w.id]?.scales.map((sc) => (
                                  <th key={`${sc.instrumentId}-${sc.scaleId}`} className="pb-1 pr-3 text-right">{sc.scaleName}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {participantsByWave[w.id]?.participants.map((row) => (
                                <tr key={row.patientId} className="border-t border-slate-200">
                                  <td className="py-1 pr-3 font-medium text-slate-700">{row.firstName} {row.lastName}</td>
                                  <td className="py-1 pr-3 text-slate-600">{row.documentType ? `${row.documentType} ` : ''}{row.documentId}</td>
                                  {(participantsByWave[w.id]?.wave.instruments.length ?? 0) > 1 && (
                                    <td className="py-1 pr-3 text-slate-600">{row.instrumentCodes.join(', ')}</td>
                                  )}
                                  <td className="py-1 pr-3 text-slate-600">{row.statusLabel}</td>
                                  <td className="py-1 pr-3 text-slate-600">{row.completedAt ? new Date(row.completedAt).toLocaleDateString('es-CO') : '—'}</td>
                                  {row.scales.map((sc) => (
                                    <td key={`${sc.instrumentId}-${sc.scaleId}`} className="py-1 pr-3 text-right text-slate-600">
                                      {sc.rawScore == null ? '—' : sc.rawScore}
                                      {sc.severity ? <span className="text-slate-400"> ({sc.severity})</span> : null}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {exportError && <p className="border-t border-slate-100 px-4 py-2 text-xs text-red-700">⚠️ {exportError}</p>}

          {p.waves.length === 0 && (
            <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
              Sin oleadas todavía — crea la primera y vincúlala a un código de acceso (pestaña "Códigos de acceso") para
              que los participantes se registren directo en ella.
            </p>
          )}

          {expandedId === p.id && (
            <div className="border-t border-slate-100 bg-slate-50 p-4">
              {loadingStats === p.id ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              ) : (
                <div className="space-y-3">
                  {(statsByProject[p.id]?.waves || []).map((ws) => (
                    <div key={ws.waveId} className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-sm font-semibold text-slate-800">{ws.name || `Oleada ${ws.order + 1}`} <span className="font-normal text-slate-400">— {ws.instruments.map((i) => i.name).join(' + ')}</span></p>
                      <p className="text-xs text-slate-500 mb-2">
                        {ws.completedTotal}/{ws.assignedTotal} completadas · tasa de finalización {formatPct(ws.completionRate)}
                      </p>
                      {ws.scales.length === 0 ? (
                        <p className="text-xs text-slate-400">Todavía nadie ha completado esta oleada.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-slate-500">
                              <th className="pb-1">Escala</th>
                              <th className="pb-1 text-right">n</th>
                              <th className="pb-1 text-right">Promedio</th>
                              <th className="pb-1 text-right">Mín–Máx</th>
                              <th className="pb-1 text-left pl-3">Severidad</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ws.scales.map((s) => (
                              <tr key={`${s.scaleId}-${s.scaleName}`} className="border-t border-slate-100">
                                <td className="py-1 font-medium text-slate-700">{s.scaleName}{s.isPrimary ? ' ★' : ''}</td>
                                <td className="py-1 text-right">{s.n}</td>
                                <td className="py-1 text-right">{formatNum(s.avg)}</td>
                                <td className="py-1 text-right">{formatNum(s.min)}–{formatNum(s.max)}</td>
                                <td className="py-1 pl-3 text-slate-500">
                                  {s.severityDistribution.map((d) => `${d.severity || 'sin clasificar'}: ${d.count}`).join(' · ')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {codeModalFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Crear código de acceso</h2>
                <p className="text-xs text-slate-500">
                  {codeModalFor.project.name} — {codeModalFor.wave.name || `Oleada ${codeModalFor.wave.order + 1}`}
                </p>
              </div>
              <button onClick={() => setCodeModalFor(null)} className="text-slate-400 hover:text-slate-900 cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {!codeModalFor.project.company && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Convenio / Cliente *</label>
                  <select value={codeCompanyId} onChange={(e) => setCodeCompanyId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="">Selecciona...</option>
                    {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <p className="mt-1 text-[10.5px] text-slate-400">Este proyecto no quedó asociado a ningún convenio — elige uno para el código.</p>
                </div>
              )}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nombre interno (opcional)</label>
                <input value={codeName} onChange={(e) => setCodeName(e.target.value)} placeholder="Ej. Sede Medellín" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Código (opcional)</label>
                  <input value={codeCustom} onChange={(e) => setCodeCustom(e.target.value.toUpperCase())} placeholder="Se genera solo" maxLength={20} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cupo máximo</label>
                  <input type="number" min={1} value={codeMaxUses} onChange={(e) => setCodeMaxUses(e.target.value)} placeholder="Sin límite" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vigencia del código (opcional)</label>
                <input type="date" value={codeExpiresAt} onChange={(e) => setCodeExpiresAt(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha límite para completar (opcional)</label>
                <input type="date" value={codeDeadline} onChange={(e) => setCodeDeadline(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <LugarAplicacionFields
                tipo={codeLugarTipo}
                onTipoChange={setCodeLugarTipo}
                texto={codeLugarTexto}
                onTextoChange={setCodeLugarTexto}
              />
              {codeFormError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{codeFormError}</p>}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setCodeModalFor(null)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-900 cursor-pointer">Cancelar</button>
              <button
                onClick={submitCode}
                disabled={codeSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 cursor-pointer"
              >
                {codeSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Crear código
              </button>
            </div>
          </div>
        </div>
      )}

      {editDatesFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Editar oleada</h2>
                <p className="text-xs text-slate-500">
                  {editDatesFor.wave.instruments.map((i) => i.name).join(' + ')}
                </p>
              </div>
              <button onClick={() => setEditDatesFor(null)} className="text-slate-400 hover:text-slate-900 cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nombre</label>
                <input
                  value={editWaveName}
                  onChange={(e) => setEditWaveName(e.target.value)}
                  placeholder={`Oleada ${editDatesFor.wave.order + 1}`}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-[10.5px] text-slate-400">Solo la etiqueta — los instrumentos que aplica no se pueden cambiar aquí (créala de nuevo si necesitas otros).</p>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha de inicio</label>
                <input type="date" value={editStartAt} onChange={(e) => setEditStartAt(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha de cierre</label>
                <input type="date" value={editDueAt} onChange={(e) => setEditDueAt(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <p className="text-[10.5px] text-slate-400">
                Las fechas son informativas: no bloquean el código ni "Lanzar a la cohorte", ni impiden responder después de la fecha de cierre. Deja un campo vacío para quitar esa fecha.
              </p>
              {editDatesError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{editDatesError}</p>}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setEditDatesFor(null)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-900 cursor-pointer">Cancelar</button>
              <button
                onClick={saveWaveEdits}
                disabled={savingDates}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 cursor-pointer"
              >
                {savingDates && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {guionModalFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Guion del taller</h2>
                <p className="text-xs text-slate-500">{guionModalFor.name}</p>
              </div>
              <button onClick={() => setGuionModalFor(null)} className="text-slate-400 hover:text-slate-900 cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
              <p className="text-[11px] text-slate-500">
                Pega aquí el texto completo del guion del facilitador. Es la única fuente que usa el asistente de IA del
                Supervisor en la app — sin esto, ese chat no funciona para este proyecto.
              </p>
              {loadingGuion ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              ) : (
                <textarea
                  value={guionTexto}
                  onChange={(e) => setGuionTexto(e.target.value)}
                  rows={16}
                  placeholder="Pega el texto completo del guion…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
                />
              )}
              <p className="text-[10.5px] text-slate-400">{guionTexto.length.toLocaleString('es-CO')} caracteres. Déjalo vacío para quitar el guion.</p>
              {guionError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{guionError}</p>}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setGuionModalFor(null)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-900 cursor-pointer">Cancelar</button>
              <button
                onClick={saveGuion}
                disabled={savingGuion || loadingGuion}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 cursor-pointer"
              >
                {savingGuion && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
