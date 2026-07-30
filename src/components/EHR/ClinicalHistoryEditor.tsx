import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { confirmToast } from '../../lib/confirmToast';
import {
  Save, FileText, Loader2, Lock, ShieldCheck,
  PlusCircle, Hash, CalendarDays, FilePlus2, PenLine, X, MessageSquarePlus,
} from 'lucide-react';

interface Addendum {
  id: string;
  content: string;
  createdById: string;
  createdByName?: string;
  integrityHash?: string;
  createdAt: string;
}

interface HistoryEntry {
  id: string;
  status: 'DRAFT' | 'SIGNED';
  date: string;
  signedAt?: string | null;
  signedById?: string | null;
  integrityHash?: string | null;
  sessionType?: string | null;
  datos?: string | null;
  analisis?: string | null;
  plan?: string | null;
  notes?: string | null; // legado — evoluciones previas al formato DAP
  addendums?: Addendum[];
}

interface ClinicalHistoryEditorProps {
  patientId: string;
}

const SESSION_TYPES = [
  'Sesión individual',
  'Sesión de pareja',
  'Sesión familiar',
  'Sesión de seguimiento',
  'Sesión de cierre',
];

function formatDateTime(iso?: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Una evolución es "legado" SOLO si tiene texto libre real de antes del
// formato DAP. Ojo: una evolución DAP recién creada también empieza con
// datos/analisis/plan en '' (string vacío) — verificar solo "sin DAP" la
// confundía con legado y la dejaba atascada en modo lectura para siempre.
function isLegacy(entry: Pick<HistoryEntry, 'datos' | 'analisis' | 'plan' | 'notes'>) {
  const hasDap = !!(entry.datos || entry.analisis || entry.plan);
  const hasLegacyNotes = !!(entry.notes && entry.notes.trim().length > 0);
  return !hasDap && hasLegacyNotes;
}

export default function ClinicalHistoryEditor({ patientId }: ClinicalHistoryEditorProps) {
  const [sessionType, setSessionType] = useState(SESSION_TYPES[0]);
  const [datos, setDatos] = useState('');
  const [analisis, setAnalisis] = useState('');
  const [plan, setPlan] = useState('');
  const [addendums, setAddendums] = useState<Addendum[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [addingAddendum, setAddingAddendum] = useState(false);
  const [newAddendumText, setNewAddendumText] = useState('');
  const [pastHistories, setPastHistories] = useState<HistoryEntry[]>([]);
  const [confirmSign, setConfirmSign] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Estado de auditoría ─────────────────────────────────────────────────
  const [historyStatus, setHistoryStatus] = useState<'DRAFT' | 'SIGNED'>('DRAFT');
  const [legacyNotes, setLegacyNotes] = useState<string | null>(null);
  const [noteDate, setNoteDate] = useState<string | null>(null);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [integrityHash, setIntegrityHash] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';
      const res = await fetch(`${apiBase}/api/clinical-history/${patientId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.history) {
          setSessionType(data.history.sessionType || SESSION_TYPES[0]);
          setDatos(data.history.datos || '');
          setAnalisis(data.history.analisis || '');
          setPlan(data.history.plan || '');
          setLegacyNotes(isLegacy(data.history) ? (data.history.notes || '') : null);
          setHistoryStatus(data.history.status || 'DRAFT');
          setNoteDate(data.history.date || null);
          setSignedAt(data.history.signedAt || null);
          setIntegrityHash(data.history.integrityHash || null);
          setAddendums(data.history.addendums || []);
        } else {
          setSessionType(SESSION_TYPES[0]);
          setDatos(''); setAnalisis(''); setPlan('');
          setLegacyNotes(null);
          setHistoryStatus('DRAFT');
          setNoteDate(null); setSignedAt(null); setIntegrityHash(null);
          setAddendums([]);
        }
        const histories: HistoryEntry[] = Array.isArray(data.histories) ? data.histories : [];
        setPastHistories(histories.slice(1));
      }
    } catch (error) {
      console.error('Error fetching history:', error);
      toast.error('Error al cargar la historia clínica');
    } finally {
      setLoading(false);
    }
  };

  const scheduleSave = (next: { sessionType?: string; datos?: string; analisis?: string; plan?: string }) => {
    if (historyStatus === 'SIGNED') return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveDraft(next), 2000);
  };

  const saveDraft = async (payload: { sessionType?: string; datos?: string; analisis?: string; plan?: string }) => {
    setSaving(true);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';
      const res = await fetch(`${apiBase}/api/clinical-history/${patientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        if (errBody.code === 'HISTORY_SIGNED_IMMUTABLE') {
          toast.error('Esta evolución ya fue firmada. No se puede editar.');
          setHistoryStatus('SIGNED');
          return;
        }
        throw new Error('Failed to save');
      }
      toast.success('Borrador guardado automáticamente', { position: 'bottom-right', duration: 2000 });
    } catch (error) {
      console.error('Error saving draft:', error);
      toast.error('Error al guardar el borrador');
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = (field: 'datos' | 'analisis' | 'plan', value: string) => {
    if (historyStatus === 'SIGNED') return;
    if (field === 'datos') setDatos(value);
    if (field === 'analisis') setAnalisis(value);
    if (field === 'plan') setPlan(value);
    scheduleSave({ [field]: value });
  };

  const handleSessionTypeChange = (value: string) => {
    if (historyStatus === 'SIGNED') return;
    setSessionType(value);
    scheduleSave({ sessionType: value });
  };

  const handleManualSave = () => {
    if (historyStatus === 'SIGNED') return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveDraft({ sessionType, datos, analisis, plan });
  };

  const isComplete = datos.trim() && analisis.trim() && plan.trim();

  // ── Firmar y Congelar (irreversible) ────────────────────────────────────
  const handleSign = async () => {
    setSigning(true);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';

      await fetch(`${apiBase}/api/clinical-history/${patientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ sessionType, datos, analisis, plan }),
      });

      const res = await fetch(`${apiBase}/api/clinical-history/${patientId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        toast.error(errBody.error || 'Error al firmar la evolución');
        return;
      }

      setConfirmSign(false);
      await fetchHistory();
      toast.success('✅ Evolución firmada y congelada exitosamente');
    } catch (error) {
      console.error('Error signing history:', error);
      toast.error('Error de red al firmar la evolución');
    } finally {
      setSigning(false);
    }
  };

  // ── Nueva Nota de Evolución ──────────────────────────────────────────────
  const handleCreateNewEvolution = async () => {
    if (!isSigned) {
      toast.error('Complete o firme la evolución actual antes de iniciar una nueva.');
      return;
    }
    const confirmed = await confirmToast('Se creará una nueva nota de evolución en borrador.\n\n¿Desea continuar?', { danger: false, confirmLabel: 'Continuar' });
    if (!confirmed) return;

    setCreatingNew(true);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';
      const res = await fetch(`${apiBase}/api/clinical-history/${patientId}/new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        toast.error(errBody.error || 'Error al crear la nueva nota de evolución');
        return;
      }
      await fetchHistory();
      toast.success('✅ Nueva nota de evolución iniciada');
    } catch (error) {
      console.error('Error creating new evolution:', error);
      toast.error('Error de red al crear la nueva nota de evolución');
    } finally {
      setCreatingNew(false);
    }
  };

  // ── Agregar Anexo ───────────────────────────────────────────────────────
  const handleAddAddendum = async () => {
    if (!newAddendumText.trim()) {
      toast.error('El anexo no puede estar vacío');
      return;
    }
    setAddingAddendum(true);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';
      const res = await fetch(`${apiBase}/api/clinical-history/${patientId}/addendum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ content: newAddendumText.trim() }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        toast.error(errBody.error || 'Error al crear el anexo');
        return;
      }
      const data = await res.json();
      setAddendums(prev => [...prev, data.addendum]);
      setNewAddendumText('');
      toast.success('✅ Anexo registrado y congelado');
    } catch (error) {
      console.error('Error adding addendum:', error);
      toast.error('Error de red al crear el anexo');
    } finally {
      setAddingAddendum(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-toast-500" />
      </div>
    );
  }

  const isSigned = historyStatus === 'SIGNED';
  const showLegacy = legacyNotes !== null;

  return (
    <div className="space-y-4">
      {/* ═══ BANNER DE AUDITORÍA (solo cuando está firmado) ═══ */}
      {isSigned && (
        <div className="flex items-start space-x-4 rounded-2xl border border-emerald-600/30 bg-emerald-50 p-4">
          <div className="shrink-0 rounded-xl bg-emerald-600 p-2.5">
            <Lock className="h-5 w-5 text-toast-50" />
          </div>
          <div className="flex-1 space-y-1.5 text-left">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <h3 className="text-sm font-black uppercase tracking-wide text-emerald-600">
                Evolución Firmada Digitalmente
              </h3>
            </div>
            <p className="text-xs font-semibold text-slate-900/80">
              Este documento fue congelado permanentemente y no puede ser modificado. Solo se pueden agregar anexos clínicos posteriores.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              {signedAt && (
                <span className="inline-flex items-center rounded-lg border border-emerald-600/30 bg-white px-2.5 py-1 font-mono text-[10px] font-bold text-emerald-600">
                  📅 Firmado: {formatDateTime(signedAt)}
                </span>
              )}
              {integrityHash && (
                <span className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-[10px] font-bold text-slate-400">
                  <Hash className="mr-1 h-3 w-3" />
                  Hash: {integrityHash.substring(0, 16)}...
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col space-y-4">
          <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4">
              <h3 className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                <span className="flex items-center">
                  <PenLine className="mr-2 h-4 w-4 text-toast-500" />
                  Nota de Evolución (DAP)
                </span>
                {isSigned ? (
                  <span className="rounded-full border border-emerald-600/30 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-600">
                    Firmada
                  </span>
                ) : (
                  <span className="rounded-full border border-amber-600/30 bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-600">
                    Borrador
                  </span>
                )}
                {noteDate && (
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-toast-50 px-2 py-0.5 font-mono text-[9px] font-bold text-slate-400">
                    <CalendarDays className="mr-1 h-3 w-3" />
                    {formatDateTime(noteDate)}
                  </span>
                )}
              </h3>
              <div className="flex items-center space-x-2">
                {!isSigned && (
                  <>
                    <button
                      onClick={handleManualSave}
                      disabled={saving}
                      className="flex items-center rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-900 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      {saving ? 'Guardando...' : 'Guardar Borrador'}
                    </button>
                    <button
                      onClick={() => setConfirmSign(true)}
                      disabled={signing || !isComplete}
                      className="flex items-center rounded-lg bg-toast-500 px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Firmar y Congelar
                    </button>
                  </>
                )}
                {isSigned && (
                  <button
                    onClick={handleCreateNewEvolution}
                    disabled={creatingNew}
                    className="flex items-center rounded-lg bg-toast-500 px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {creatingNew ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-2 h-4 w-4" />}
                    {creatingNew ? 'Creando...' : 'Nueva Nota de Evolución'}
                  </button>
                )}
              </div>
            </div>

            {showLegacy ? (
              /* ═══ EVOLUCIÓN LEGADO (previa al formato DAP) — solo lectura ═══ */
              <div className="max-h-[600px] overflow-y-auto border-l-4 border-emerald-600 bg-emerald-50 p-6">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Evolución en formato anterior (texto libre)
                </p>
                <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-900/90">
                  {legacyNotes}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4 p-5">
                {!isSigned && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tipo de sesión</label>
                    <select
                      value={sessionType}
                      onChange={(e) => handleSessionTypeChange(e.target.value)}
                      className="w-full max-w-xs rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-toast-500 focus:ring-2 focus:ring-toast-500/20"
                    >
                      {SESSION_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                )}

                <DapField
                  letter="D" title="Datos" hint="Reporte del paciente y observaciones objetivas de la sesión."
                  value={datos} readOnly={isSigned}
                  onChange={(v) => handleFieldChange('datos', v)}
                />
                <DapField
                  letter="A" title="Análisis" hint="Interpretación clínica, evolución y formulación."
                  value={analisis} readOnly={isSigned}
                  onChange={(v) => handleFieldChange('analisis', v)}
                />
                <DapField
                  letter="P" title="Plan" hint="Intervenciones, tareas, ajustes y próxima cita."
                  value={plan} readOnly={isSigned}
                  onChange={(v) => handleFieldChange('plan', v)}
                />
              </div>
            )}
          </div>

          {/* ═══ ANEXOS (solo cuando está firmado) ═══ */}
          {isSigned && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <h3 className="flex items-center font-semibold text-slate-900">
                  <PlusCircle className="mr-2 h-4 w-4 text-toast-500" />
                  Anexos Clínicos
                  <span className="ml-2 rounded-full border border-toast-500/30 bg-toast-100 px-2 py-0.5 text-[9px] font-bold text-toast-500">
                    {addendums.length} {addendums.length === 1 ? 'anexo' : 'anexos'}
                  </span>
                </h3>
              </div>

              {addendums.length > 0 && (
                <div className="max-h-[300px] space-y-3 overflow-y-auto border-b border-slate-200 p-4">
                  {addendums.map((addendum) => (
                    <div key={addendum.id} className="space-y-2 rounded-xl border border-toast-500/20 bg-toast-100 p-4 text-left">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Lock className="h-3 w-3 text-toast-500" />
                          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-toast-500">
                            Anexo Inmutable
                          </span>
                        </div>
                        <span className="font-mono text-[9px] text-slate-400">{formatDateTime(addendum.createdAt)}</span>
                      </div>
                      {addendum.createdByName && (
                        <p className="text-[10px] font-semibold text-toast-500">Por: {addendum.createdByName}</p>
                      )}
                      <p className="whitespace-pre-wrap border-l-2 border-toast-500/40 pl-3 text-xs leading-relaxed text-slate-900/90">
                        {addendum.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-3 p-4">
                <textarea
                  value={newAddendumText}
                  onChange={(e) => setNewAddendumText(e.target.value)}
                  placeholder="Redacte un nuevo anexo clínico. Una vez guardado, este texto se congelará permanentemente con su propio hash de integridad..."
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-900 outline-none focus:border-toast-500 focus:ring-2 focus:ring-toast-500/20"
                />
                <div className="flex items-center justify-between">
                  <p className="flex items-center font-mono text-[10px] text-slate-400">
                    <ShieldCheck className="mr-1 h-3 w-3" />
                    Los anexos son inmutables: una vez guardados no pueden editarse ni eliminarse.
                  </p>
                  <button
                    onClick={handleAddAddendum}
                    disabled={addingAddendum || !newAddendumText.trim()}
                    className="flex items-center gap-1.5 rounded-lg bg-toast-500 px-5 py-2.5 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {addingAddendum ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
                    {addingAddendum ? 'Guardando...' : 'Guardar Anexo'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ═══ EVOLUCIONES ANTERIORES ═══ */}
          {pastHistories.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <h3 className="flex items-center font-semibold text-slate-900">
                  <FileText className="mr-2 h-4 w-4 text-slate-400" />
                  Evoluciones Anteriores
                  <span className="ml-2 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-400">
                    {pastHistories.length}
                  </span>
                </h3>
              </div>

              <ol className="relative flex flex-col gap-4 border-l border-slate-200 p-4 pl-8">
                {pastHistories.map((entry) => (
                  <li key={entry.id} className="relative">
                    <span className="absolute -left-[27px] top-1.5 h-4 w-4 rounded-full border-2 border-white bg-toast-500" />
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${
                            entry.status === 'SIGNED'
                              ? 'border-emerald-600/30 bg-emerald-50 text-emerald-600'
                              : 'border-amber-600/30 bg-amber-50 text-amber-600'
                          }`}>
                            {entry.status === 'SIGNED' ? 'Firmada' : 'Borrador'}
                          </span>
                          {entry.sessionType && (
                            <span className="text-[10px] text-slate-400">· {entry.sessionType}</span>
                          )}
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[9px] font-bold text-slate-400">
                            <CalendarDays className="mr-1 h-3 w-3" />
                            {formatDateTime(entry.date)}
                          </span>
                        </div>
                        {entry.integrityHash && (
                          <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                            <Hash className="mr-0.5 h-2.5 w-2.5" />
                            {entry.integrityHash.substring(0, 10)}...
                          </span>
                        )}
                      </div>
                      <div className="p-4">
                        {isLegacy(entry) ? (
                          <p className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-900/90">
                            {entry.notes}
                          </p>
                        ) : (
                          <div className="flex flex-col gap-3">
                            <PastDapField letter="D" title="Datos" text={entry.datos} />
                            <PastDapField letter="A" title="Análisis" text={entry.analisis} />
                            <PastDapField letter="P" title="Plan" text={entry.plan} />
                          </div>
                        )}
                      </div>
                      {entry.addendums && entry.addendums.length > 0 && (
                        <div className="space-y-2 px-4 pb-4">
                          {entry.addendums.map((addendum) => (
                            <div key={addendum.id} className="space-y-1 rounded-lg border border-toast-500/20 bg-toast-100 p-3 text-left">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center font-mono text-[9px] font-bold uppercase tracking-wider text-toast-500">
                                  <Lock className="mr-1 h-2.5 w-2.5" />
                                  Anexo
                                </span>
                                <span className="font-mono text-[9px] text-slate-400">{formatDateTime(addendum.createdAt)}</span>
                              </div>
                              <p className="whitespace-pre-wrap border-l-2 border-toast-500/40 pl-2 text-[11px] leading-relaxed text-slate-900/90">
                                {addendum.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
      </div>

      {/* ═══ MODAL: Confirmar firma ═══ */}
      {confirmSign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-toast-500" />
                <h4 className="text-base font-semibold text-slate-900">Firmar digitalmente</h4>
              </div>
              <button onClick={() => setConfirmSign(false)} className="text-slate-400 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-slate-400">
              Al firmar, esta nota quedará bloqueada y no podrá editarse. Se registrará con su nombre y la fecha y hora actuales.
              Solo podrá agregar anexos posteriores.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmSign(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSign}
                disabled={signing}
                className="inline-flex items-center gap-2 rounded-lg bg-toast-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {signing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Confirmar firma
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DapField({
  letter, title, hint, value, readOnly, onChange,
}: {
  letter: string; title: string; hint: string; value: string; readOnly: boolean; onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-toast-100 text-xs font-bold text-toast-500">
          {letter}
        </span>
        <label className="text-sm font-semibold text-slate-900">{title}</label>
        <span className="text-xs text-slate-400">— {hint}</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        rows={4}
        placeholder={`Escriba el apartado de ${title.toLowerCase()}...`}
        className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 focus:border-toast-500 focus:ring-2 focus:ring-toast-500/20"
      />
    </div>
  );
}

function PastDapField({ letter, title, text }: { letter: string; title: string; text?: string | null }) {
  if (!text) return null;
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-toast-100 text-xs font-bold text-toast-500">
        {letter}
      </span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-900/90">{text}</p>
      </div>
    </div>
  );
}
