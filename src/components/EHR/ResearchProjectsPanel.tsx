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
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { FlaskConical, Plus, Loader2, ChevronDown, ChevronRight, Send, BarChart3, Users, Download, KeyRound, X } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useCompanies } from '../../hooks/useCompanies';

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
  dueAt: string | null;
  instrument: { code: string; name: string };
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
  instrument: { code: string; name: string };
  assignedTotal: number;
  completedTotal: number;
  completionRate: number | null;
  scales: ScaleStat[];
}

interface ParticipantScale {
  scaleId: string;
  scaleName: string;
  rawScore: number | null;
  severity: string | null;
}

interface ParticipantRow {
  administrationId: string;
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
  wave: { id: string; name: string | null; order: number; instrument: { code: string; name: string } };
  scales: { scaleId: string; scaleName: string }[];
  participants: ParticipantRow[];
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
  const [waveInstrumentId, setWaveInstrumentId] = useState('');
  const [waveName, setWaveName] = useState('');
  const [waveDueAt, setWaveDueAt] = useState('');
  const [creatingWave, setCreatingWave] = useState(false);

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
    if (!waveInstrumentId) { toast.error('Elige un instrumento.'); return; }
    setCreatingWave(true);
    try {
      const res = await apiFetch(`/api/research-projects/${projectId}/waves`, {
        method: 'POST',
        body: JSON.stringify({ instrumentId: waveInstrumentId, name: waveName.trim() || undefined, dueAt: waveDueAt || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'No se pudo crear la oleada.'); return; }
      toast.success('Oleada creada. Ya puedes generar un código de acceso para ella, o lanzarla a la cohorte.');
      setWaveFormFor(null);
      setWaveInstrumentId('');
      setWaveName('');
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
            </div>
          </div>

          {waveFormFor === p.id && (
            <div className="border-t border-slate-100 p-4 space-y-2">
              <select value={waveInstrumentId} onChange={(e) => setWaveInstrumentId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Elige el instrumento…</option>
                {instruments.map((i) => <option key={i.id} value={i.id}>{i.nameEs || i.name} ({i.code})</option>)}
              </select>
              <div className="flex gap-2">
                <input value={waveName} onChange={(e) => setWaveName(e.target.value)} placeholder='Nombre — ej. "T0 — Basal"' className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
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
                      <p className="text-sm font-medium text-slate-800">{w.name || `Oleada ${w.order + 1}`} — {w.instrument.name}</p>
                      <p className="text-xs text-slate-500">
                        {w.completedCount}/{w.assignedCount} completadas
                        {w.dueAt ? ` · hasta ${new Date(w.dueAt).toLocaleDateString('es-CO')}` : ''}
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
                      <button
                        onClick={() => toggleParticipants(w.id)}
                        title="Quién respondió, su estado y su puntaje"
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        <Users className="h-3.5 w-3.5" /> Participantes
                        {expandedWaveId === w.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => downloadWave(w.id)}
                        disabled={exportingWaveId === w.id || w.assignedCount === 0}
                        title="Excel con dos hojas: puntajes por escala, y las respuestas completas ítem por ítem"
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                      >
                        {exportingWaveId === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        Exportar
                      </button>
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
                      {canManage && (
                        <button
                          onClick={() => openCodeModal(p, w)}
                          title="Crea un código de acceso ya vinculado a esta oleada, sin tener que elegir proyecto y oleada aparte"
                          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          Crear código
                        </button>
                      )}
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
                                <th className="pb-1 pr-3">Estado</th>
                                <th className="pb-1 pr-3">Completada</th>
                                {participantsByWave[w.id]?.scales.map((sc) => (
                                  <th key={sc.scaleId} className="pb-1 pr-3 text-right">{sc.scaleName}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {participantsByWave[w.id]?.participants.map((row) => (
                                <tr key={row.administrationId} className="border-t border-slate-200">
                                  <td className="py-1 pr-3 font-medium text-slate-700">{row.firstName} {row.lastName}</td>
                                  <td className="py-1 pr-3 text-slate-600">{row.documentType ? `${row.documentType} ` : ''}{row.documentId}</td>
                                  <td className="py-1 pr-3 text-slate-600">{row.statusLabel}</td>
                                  <td className="py-1 pr-3 text-slate-600">{row.completedAt ? new Date(row.completedAt).toLocaleDateString('es-CO') : '—'}</td>
                                  {row.scales.map((sc) => (
                                    <td key={sc.scaleId} className="py-1 pr-3 text-right text-slate-600">
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
                      <p className="text-sm font-semibold text-slate-800">{ws.name || `Oleada ${ws.order + 1}`}</p>
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
                              <tr key={s.scaleId} className="border-t border-slate-100">
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
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
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
            <div className="space-y-3 px-5 py-4">
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
              {codeFormError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{codeFormError}</p>}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-5 py-4">
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
    </div>
  );
}
