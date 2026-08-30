import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { confirmToast } from '../../lib/confirmToast';
import {
  Save, FileText, Loader2, Lock, ShieldCheck,
  PlusCircle, Hash, CalendarDays, FilePlus2, PenLine, X, MessageSquarePlus,
  Paperclip, Eye, Download, ClipboardCheck, Trash2,
} from 'lucide-react';
import SesionesAccordion, { type SesionData, type SesionAnexo, type SesionEvaluacion } from './SesionesAccordion';

interface Addendum {
  id: string;
  content: string | null;
  fileName?: string | null;
  fileType?: string | null;
  fileSize?: number | null;
  downloadUrl?: string | null;
  createdById: string;
  createdByName?: string;
  integrityHash?: string;
  createdAt: string;
}

// Mismo límite y catálogo que valida el backend (ALLOWED_ATTACHMENT_MIME_TYPES
// en clinical-history.controller.js) — feedback inmediato, no reemplaza la
// validación del servidor. Compartido entre el adjunto de un anexo (post-
// firma) y el adjunto directo de la nota en borrador (pre-firma).
const MAX_CLINICAL_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_CLINICAL_FILE_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const CLINICAL_FILE_ACCEPT_ATTR = '.pdf,.doc,.docx,image/*,application/pdf';

function validateClinicalFile(file: File): string | null {
  if (!ALLOWED_CLINICAL_FILE_TYPES.has(file.type)) {
    return 'Solo se aceptan documentos Word (.doc/.docx), imágenes o PDF.';
  }
  if (file.size > MAX_CLINICAL_FILE_BYTES) {
    return 'El archivo supera el límite de 10MB.';
  }
  return null;
}

interface ClinicalDocumentEntry {
  id: string;
  fileName: string;
  fileType?: string;
  downloadUrl?: string | null;
  createdAt: string;
  clinicalHistoryId?: string | null;
}

interface ClinicalAssessmentEntry {
  id: string;
  name: string;
  score: string;
  interpretation?: string | null;
  date: string;
  clinicalHistoryId?: string | null;
}

interface HistoryEntry {
  id: string;
  status: 'DRAFT' | 'SIGNED';
  date: string;
  sessionDate?: string | null;
  signedAt?: string | null;
  signedById?: string | null;
  integrityHash?: string | null;
  sessionType?: string | null;
  datos?: string | null;
  analisis?: string | null;
  plan?: string | null;
  anexosNota?: string | null;
  sinAnexos?: boolean;
  notes?: string | null; // legado — evoluciones previas al formato DAP
  addendums?: Addendum[];
}

interface ClinicalHistoryEditorProps {
  patientId: string;
}

const SESSION_TYPES = [
  'Primera sesión (Evaluación inicial)',
  'Sesión de evaluación diagnóstica',
  'Sesión de intervención o tratamiento',
  'Sesiones de seguimiento',
  'Sesión de cierre o finalización',
];

function formatDateTime(iso?: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Para sessionDate ("YYYY-MM-DD", sin hora) — mostrarla con formatDateTime
// la corría un día atrás en husos horarios negativos (se interpreta como
// medianoche UTC). Se parsea como fecha local explícita en vez de dejar que
// el constructor de Date la lea como UTC.
function formatDateOnly(ymd?: string | null) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
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
  // Formato "YYYY-MM-DD" — lo que produce/consume <input type="date">.
  const [sessionDate, setSessionDate] = useState('');
  const [datos, setDatos] = useState('');
  const [analisis, setAnalisis] = useState('');
  const [plan, setPlan] = useState('');
  const [anexosNota, setAnexosNota] = useState('');
  const [sinAnexos, setSinAnexos] = useState(false);
  const [addendums, setAddendums] = useState<Addendum[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [addingAddendum, setAddingAddendum] = useState(false);
  const [newAddendumText, setNewAddendumText] = useState('');
  const [addendumFile, setAddendumFile] = useState<File | null>(null);
  const [showAddendumComposer, setShowAddendumComposer] = useState(false);
  const [pastHistories, setPastHistories] = useState<HistoryEntry[]>([]);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<ClinicalAssessmentEntry[]>([]);
  const [linkingAssessmentId, setLinkingAssessmentId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<ClinicalDocumentEntry[]>([]);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
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
          setCurrentHistoryId(data.history.id);
          setSessionType(data.history.sessionType || SESSION_TYPES[0]);
          // sessionDate es nueva — las evoluciones existentes no la tienen
          // todavía, así que se cae a `date` (fecha de creación) para no
          // mostrar el campo vacío en notas ya guardadas.
          setSessionDate((data.history.sessionDate || data.history.date || '').slice(0, 10));
          setDatos(data.history.datos || '');
          setAnalisis(data.history.analisis || '');
          setPlan(data.history.plan || '');
          setAnexosNota(data.history.anexosNota || '');
          setSinAnexos(!!data.history.sinAnexos);
          setLegacyNotes(isLegacy(data.history) ? (data.history.notes || '') : null);
          setHistoryStatus(data.history.status || 'DRAFT');
          setNoteDate(data.history.date || null);
          setSignedAt(data.history.signedAt || null);
          setIntegrityHash(data.history.integrityHash || null);
          setAddendums(data.history.addendums || []);
        } else {
          setCurrentHistoryId(null);
          setSessionType(SESSION_TYPES[0]);
          setSessionDate(new Date().toISOString().slice(0, 10));
          setDatos(''); setAnalisis(''); setPlan('');
          setAnexosNota(''); setSinAnexos(false);
          setLegacyNotes(null);
          setHistoryStatus('DRAFT');
          setNoteDate(null); setSignedAt(null); setIntegrityHash(null);
          setAddendums([]);
        }
        const histories: HistoryEntry[] = Array.isArray(data.histories) ? data.histories : [];
        setPastHistories(histories.slice(1));
        setAssessments(Array.isArray(data.assessments) ? data.assessments : []);
        setDocuments(Array.isArray(data.documents) ? data.documents : []);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
      toast.error('Error al cargar la historia clínica');
    } finally {
      setLoading(false);
    }
  };

  type DraftPayload = {
    sessionType?: string; sessionDate?: string; datos?: string; analisis?: string; plan?: string;
    anexosNota?: string; sinAnexos?: boolean;
  };

  const scheduleSave = (next: DraftPayload) => {
    if (historyStatus === 'SIGNED') return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveDraft(next), 2000);
  };

  const saveDraft = async (payload: DraftPayload) => {
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

  const handleSessionDateChange = (value: string) => {
    if (historyStatus === 'SIGNED') return;
    setSessionDate(value);
    scheduleSave({ sessionDate: value });
  };

  const handleAnexosNotaChange = (value: string) => {
    if (historyStatus === 'SIGNED') return;
    setAnexosNota(value);
    scheduleSave({ anexosNota: value });
  };

  const handleSinAnexosChange = (checked: boolean) => {
    if (historyStatus === 'SIGNED') return;
    setSinAnexos(checked);
    // Marcar "sin anexos" y tener texto escrito son mutuamente excluyentes —
    // al marcarlo se limpia la nota, para que no quede un texto contradictorio
    // guardado detrás del checkbox.
    if (checked) setAnexosNota('');
    scheduleSave({ sinAnexos: checked, anexosNota: checked ? '' : anexosNota });
  };

  // ── Seguimiento de Evaluaciones: marcar/desmarcar un resultado como
  // revisado en la nota actual (currentHistoryId) ─────────────────────────
  const handleToggleAssessmentLink = async (assessmentId: string, checked: boolean) => {
    if (!currentHistoryId) return;
    const previous = assessments;
    setAssessments(prev => prev.map(a => (
      a.id === assessmentId ? { ...a, clinicalHistoryId: checked ? currentHistoryId : null } : a
    )));
    setLinkingAssessmentId(assessmentId);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';
      const res = await fetch(`${apiBase}/api/patients/assessments/${assessmentId}/link`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ clinicalHistoryId: checked ? currentHistoryId : null }),
      });
      if (!res.ok) throw new Error('Failed to link assessment');
    } catch (error) {
      console.error('Error vinculando evaluación:', error);
      toast.error('Error al actualizar el seguimiento de la evaluación');
      setAssessments(previous);
    } finally {
      setLinkingAssessmentId(null);
    }
  };

  const handleManualSave = () => {
    if (historyStatus === 'SIGNED') return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveDraft({ sessionType, sessionDate, datos, analisis, plan, anexosNota, sinAnexos });
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
        body: JSON.stringify({ sessionType, sessionDate, datos, analisis, plan, anexosNota, sinAnexos }),
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
      setShowAddendumComposer(false);
      await fetchHistory();
      toast.success('✅ Nueva nota de evolución iniciada');
    } catch (error) {
      console.error('Error creating new evolution:', error);
      toast.error('Error de red al crear la nueva nota de evolución');
    } finally {
      setCreatingNew(false);
    }
  };

  // ── Agregar Anexo (texto y/o archivo adjunto) ───────────────────────────
  const handleAddendumFileSelect = (file: File | null) => {
    if (!file) { setAddendumFile(null); return; }
    const validationError = validateClinicalFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setAddendumFile(file);
  };

  const handleAddAddendum = async () => {
    if (!newAddendumText.trim() && !addendumFile) {
      toast.error('El anexo necesita texto, un archivo adjunto, o ambos');
      return;
    }
    setAddingAddendum(true);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';

      let fileFields: { fileS3Key?: string; fileName?: string; fileType?: string; fileSize?: number } = {};

      if (addendumFile) {
        const presignedRes = await fetch(`${apiBase}/api/clinical-history/${patientId}/addendum/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ fileName: addendumFile.name, fileType: addendumFile.type, fileSize: addendumFile.size }),
        });
        if (!presignedRes.ok) {
          const errBody = await presignedRes.json().catch(() => ({}));
          throw new Error(errBody.error || 'Error al preparar la subida del archivo');
        }
        const { url, s3Key } = await presignedRes.json();

        const uploadRes = await fetch(url, { method: 'PUT', headers: { 'Content-Type': addendumFile.type }, body: addendumFile });
        if (!uploadRes.ok) throw new Error('Error al subir el archivo');

        fileFields = { fileS3Key: s3Key, fileName: addendumFile.name, fileType: addendumFile.type, fileSize: addendumFile.size };
      }

      const res = await fetch(`${apiBase}/api/clinical-history/${patientId}/addendum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ content: newAddendumText.trim(), ...fileFields }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        toast.error(errBody.error || 'Error al crear el anexo');
        return;
      }
      const data = await res.json();
      setAddendums(prev => [...prev, data.addendum]);
      setNewAddendumText('');
      setAddendumFile(null);
      setShowAddendumComposer(false);
      toast.success('✅ Anexo registrado y congelado');
    } catch (error: any) {
      console.error('Error adding addendum:', error);
      toast.error(error?.message || 'Error de red al crear el anexo');
    } finally {
      setAddingAddendum(false);
    }
  };

  // Ver/descargar el archivo de un anexo, para SesionesAccordion — mismo
  // criterio de seguridad que AddendumFileChip: trae el blob en vez de
  // navegar directo a la URL firmada, para que la firma nunca quede expuesta
  // en la barra de direcciones ni en el historial del navegador.
  const openAnexoBlob = async (anexo: SesionAnexo, mode: 'view' | 'download') => {
    if (!anexo.archivoUrl) return;
    try {
      const res = await fetch(anexo.archivoUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      if (mode === 'download') {
        link.download = anexo.archivoNombre || 'archivo';
      } else {
        link.target = '_blank';
        link.rel = 'noreferrer';
      }
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) {
      console.error('Error abriendo el adjunto del anexo:', error);
      window.open(anexo.archivoUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // Mismo patrón que openAnexoBlob, para los archivos adjuntados directo a
  // la nota en borrador (ClinicalDocumentEntry, no ClinicalAddendum).
  const openDocumentBlob = async (doc: { fileName: string; downloadUrl?: string | null }, mode: 'view' | 'download') => {
    if (!doc.downloadUrl) return;
    try {
      const res = await fetch(doc.downloadUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      if (mode === 'download') {
        link.download = doc.fileName;
      } else {
        link.target = '_blank';
        link.rel = 'noreferrer';
      }
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) {
      console.error('Error abriendo el archivo adjunto:', error);
      window.open(doc.downloadUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // ── Adjuntar archivo directo a la nota en borrador (antes de firmar) ────
  // Mismo endpoint que usa la pestaña "Anexos" (ClinicalAttachments) — no
  // requiere firma, y el backend ya lo asocia solo a esta evolución (la más
  // reciente del paciente en este momento, ver clinicalHistoryId en
  // generateUploadUrl).
  const handleUploadDraftDocument = async (file: File) => {
    const validationError = validateClinicalFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setUploadingDocument(true);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';

      const presignedRes = await fetch(`${apiBase}/api/clinical-history/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ patientId, fileName: file.name, fileType: file.type, fileSize: file.size }),
      });
      if (!presignedRes.ok) {
        const errBody = await presignedRes.json().catch(() => ({}));
        throw new Error(errBody.error || 'Error al preparar la subida del archivo');
      }
      const { url, document: uploadedDoc } = await presignedRes.json();

      const uploadRes = await fetch(url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!uploadRes.ok) throw new Error('Error al subir el archivo');

      const confirmRes = await fetch(`${apiBase}/api/clinical-history/confirm-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ documentId: uploadedDoc.id }),
      });
      if (!confirmRes.ok) throw new Error('Error al confirmar la subida');

      toast.success('✅ Archivo adjuntado');
      await fetchHistory();
    } catch (error: any) {
      console.error('Error subiendo archivo:', error);
      toast.error(error?.message || 'Error al subir el archivo');
    } finally {
      setUploadingDocument(false);
    }
  };

  // ── Quitar un anexo subido por error, mientras la nota siga sin firmar ──
  // El backend re-valida que la evolución siga en DRAFT (nunca confía en el
  // isSigned del cliente) — post-firma esta misma llamada responde 409.
  const handleDeleteDraftDocument = async (doc: ClinicalDocumentEntry) => {
    const confirmed = await confirmToast(
      `¿Quitar "${doc.fileName}" de esta nota? Esta acción no se puede deshacer.`,
      { danger: true, confirmLabel: 'Quitar' }
    );
    if (!confirmed) return;

    setDeletingDocumentId(doc.id);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';
      const res = await fetch(`${apiBase}/api/clinical-history/documents/${doc.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'Error al quitar el archivo');
      }
      toast.success('Archivo quitado');
      await fetchHistory();
    } catch (error: any) {
      console.error('Error quitando archivo:', error);
      toast.error(error?.message || 'Error al quitar el archivo');
    } finally {
      setDeletingDocumentId(null);
    }
  };

  // Adapta HistoryEntry (forma interna de este editor) a SesionData (la
  // forma genérica que espera SesionesAccordion) — legado (texto libre) se
  // mapea a "datos" para no perder visibilidad, ya que el componente
  // genérico no conoce el concepto de evolución pre-formato-DAP.
  const sesionesAnteriores: SesionData[] = pastHistories.map((entry) => ({
    id: entry.id,
    tipoSesion: entry.sessionType || 'Individual',
    // entry.sessionDate viene del backend como ISO datetime completo (no
    // "YYYY-MM-DD" — ese formato recortado solo existe en el estado local del
    // <input type="date"> de la nota actual, ver fetchHistory), así que se
    // puede pasar tal cual sin ninguna conversión especial. Nula en
    // evoluciones previas a la existencia de este campo — entry.date (fecha
    // de creación/último autoguardado) siempre existe y se muestra aparte.
    fechaSesion: entry.sessionDate || null,
    fechaCreacion: entry.date,
    estado: entry.status === 'SIGNED' ? 'firmada' : 'pendiente',
    datos: isLegacy(entry) ? entry.notes : entry.datos,
    analisis: isLegacy(entry) ? null : entry.analisis,
    plan: isLegacy(entry) ? null : entry.plan,
    hash: entry.integrityHash,
    anexos: (entry.addendums || []).map((a) => ({
      id: a.id,
      contenido: a.content,
      archivoNombre: a.fileName,
      archivoUrl: a.downloadUrl,
      fecha: a.createdAt,
    })),
    evaluaciones: assessments
      .filter((a) => a.clinicalHistoryId === entry.id)
      .map((a) => ({ id: a.id, nombre: a.name, puntaje: a.score, interpretacion: a.interpretation })),
    notaAnexos: entry.sinAnexos ? 'Sin anexos clínicos en esta sesión.' : (entry.anexosNota || null),
    documentosAdjuntos: documents
      .filter((d) => d.clinicalHistoryId === entry.id)
      .map((d) => ({ id: d.id, fileName: d.fileName, downloadUrl: d.downloadUrl })),
  }));

  // Archivos adjuntados directo a ESTA nota (no a otras evoluciones del
  // mismo paciente) — es lo único relevante mientras se está redactando.
  const currentDraftDocuments = documents.filter((d) => d.clinicalHistoryId === currentHistoryId);

  // Evaluaciones marcadas como revisadas en ESTA nota — usado en la vista
  // firmada (de solo lectura, sin checkbox) para no repetir el listado
  // completo del paciente que sí se muestra mientras está en borrador.
  const linkedAssessments = assessments.filter((a) => a.clinicalHistoryId === currentHistoryId);

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
        {!isSigned ? (
          <>
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
                {(sessionDate || noteDate) && (
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-toast-50 px-2 py-0.5 font-mono text-[9px] font-bold text-slate-400">
                    <CalendarDays className="mr-1 h-3 w-3" />
                    {sessionDate ? formatDateOnly(sessionDate) : formatDateTime(noteDate)}
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
                  <div className="flex flex-wrap gap-4">
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
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Fecha de sesión</label>
                      <input
                        type="date"
                        value={sessionDate}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => handleSessionDateChange(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-toast-500 focus:ring-2 focus:ring-toast-500/20"
                      />
                    </div>
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

          {/* ═══ SEGUIMIENTO DE EVALUACIONES ═══ */}
          {assessments.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-4">
                <h3 className="flex items-center font-semibold text-slate-900">
                  <ClipboardCheck className="mr-2 h-4 w-4 text-toast-500" />
                  Seguimiento de Evaluaciones
                </h3>
                <p className="mt-1 text-[10px] text-slate-400">
                  {isSigned
                    ? 'Resultados de pruebas revisados durante esta sesión.'
                    : 'Marca los resultados que estás revisando con el paciente en esta sesión.'}
                </p>
              </div>
              <div className="max-h-[280px] space-y-2 overflow-y-auto p-4">
                {assessments.map((a) => {
                  const checked = a.clinicalHistoryId === currentHistoryId;
                  return (
                    <label
                      key={a.id}
                      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                        checked ? 'border-toast-500/40 bg-toast-100' : 'border-slate-200'
                      } ${isSigned ? 'cursor-default' : 'cursor-pointer hover:bg-slate-50'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isSigned || linkingAssessmentId === a.id}
                        onChange={(e) => handleToggleAssessmentLink(a.id, e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-toast-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-900">{a.name}</span>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-500">
                            {a.score}
                          </span>
                          <span className="font-mono text-[9px] text-slate-400">{formatDateTime(a.date)}</span>
                        </div>
                        {a.interpretation && (
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-900/70">{a.interpretation}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═══ ANEXOS CLÍNICOS — adjuntar mientras se redacta (pre-firma) o
               como anexo inmutable posterior (post-firma) ═══ */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <h3 className="flex items-center font-semibold text-slate-900">
                <PlusCircle className="mr-2 h-4 w-4 text-toast-500" />
                Anexos Clínicos
                {isSigned ? (
                  <span className="ml-2 rounded-full border border-toast-500/30 bg-toast-100 px-2 py-0.5 text-[9px] font-bold text-toast-500">
                    {addendums.length} {addendums.length === 1 ? 'anexo' : 'anexos'}
                  </span>
                ) : currentDraftDocuments.length > 0 && (
                  <span className="ml-2 rounded-full border border-toast-500/30 bg-toast-100 px-2 py-0.5 text-[9px] font-bold text-toast-500">
                    {currentDraftDocuments.length} {currentDraftDocuments.length === 1 ? 'archivo' : 'archivos'}
                  </span>
                )}
              </h3>
            </div>

            {!isSigned ? (
              <div className="space-y-3 p-4">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={sinAnexos}
                    onChange={(e) => handleSinAnexosChange(e.target.checked)}
                    className="h-4 w-4 accent-toast-500"
                  />
                  Sin anexos clínicos en esta sesión
                </label>

                {!sinAnexos && (
                  <>
                    <textarea
                      value={anexosNota}
                      onChange={(e) => handleAnexosNotaChange(e.target.value)}
                      placeholder="Nota sobre los anexos de esta sesión (opcional)..."
                      rows={2}
                      className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-900 outline-none focus:border-toast-500 focus:ring-2 focus:ring-toast-500/20"
                    />

                    {currentDraftDocuments.length > 0 && (
                      <div className="space-y-2">
                        {currentDraftDocuments.map((doc) => (
                          <div key={doc.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <Paperclip className="h-3.5 w-3.5 shrink-0 text-toast-500" />
                              <span className="truncate text-xs font-semibold text-slate-900" title={doc.fileName}>{doc.fileName}</span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {doc.downloadUrl && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openDocumentBlob(doc, 'view')}
                                    title="Ver archivo"
                                    className="rounded p-1 text-slate-400 hover:text-slate-900"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openDocumentBlob(doc, 'download')}
                                    title="Descargar archivo"
                                    className="rounded p-1 text-slate-400 hover:text-slate-900"
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteDraftDocument(doc)}
                                disabled={deletingDocumentId === doc.id}
                                title="Quitar archivo de esta nota"
                                className="rounded p-1 text-slate-400 hover:text-rose-600 disabled:opacity-40"
                              >
                                {deletingDocumentId === doc.id
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <Trash2 className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:border-toast-500/50 hover:bg-slate-50">
                      {uploadingDocument ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                      {uploadingDocument ? 'Subiendo...' : 'Adjuntar archivo (Word, imagen o PDF, máx. 10MB)'}
                      <input
                        type="file"
                        accept={CLINICAL_FILE_ACCEPT_ATTR}
                        className="hidden"
                        disabled={uploadingDocument}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadDraftDocument(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <p className="font-mono text-[10px] text-slate-400">
                      Los archivos que adjuntes acá quedan asociados a esta nota de evolución.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <>
              {(sinAnexos || anexosNota) && (
                <div className="border-b border-slate-200 p-4">
                  <p className="mb-1 font-mono text-[9px] font-bold uppercase tracking-wide text-slate-400">
                    Nota de anexos (escrita antes de firmar)
                  </p>
                  <p className="text-xs leading-relaxed text-slate-900/90">
                    {sinAnexos ? 'Sin anexos clínicos en esta sesión.' : anexosNota}
                  </p>
                </div>
              )}
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
                      {addendum.content && (
                        <p className="whitespace-pre-wrap border-l-2 border-toast-500/40 pl-3 text-xs leading-relaxed text-slate-900/90">
                          {addendum.content}
                        </p>
                      )}
                      {addendum.fileName && <AddendumFileChip addendum={addendum} />}
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

                {addendumFile ? (
                  <div className="flex items-center justify-between rounded-lg border border-toast-500/30 bg-toast-50 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-toast-500" />
                      <span className="truncate text-xs font-semibold text-slate-900" title={addendumFile.name}>{addendumFile.name}</span>
                      <span className="shrink-0 text-[10px] text-slate-400">({(addendumFile.size / 1024 / 1024).toFixed(1)}MB)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAddendumFile(null)}
                      className="shrink-0 text-slate-400 hover:text-slate-900"
                      title="Quitar archivo"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:border-toast-500/50 hover:bg-slate-50">
                    <Paperclip className="h-3.5 w-3.5" />
                    Adjuntar archivo (Word, imagen o PDF, máx. 10MB)
                    <input
                      type="file"
                      accept={CLINICAL_FILE_ACCEPT_ATTR}
                      className="hidden"
                      onChange={(e) => handleAddendumFileSelect(e.target.files?.[0] || null)}
                    />
                  </label>
                )}

                <div className="flex items-center justify-between">
                  <p className="flex items-center font-mono text-[10px] text-slate-400">
                    <ShieldCheck className="mr-1 h-3 w-3" />
                    Los anexos son inmutables: una vez guardados no pueden editarse ni eliminarse.
                  </p>
                  <button
                    onClick={handleAddAddendum}
                    disabled={addingAddendum || (!newAddendumText.trim() && !addendumFile)}
                    className="flex items-center gap-1.5 rounded-lg bg-toast-500 px-5 py-2.5 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {addingAddendum ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
                    {addingAddendum ? 'Guardando...' : 'Guardar Anexo'}
                  </button>
                </div>
              </div>
              </>
            )}
          </div>
          </>
        ) : (
          /* ═══ NOTA FIRMADA — todo consolidado en una sola tarjeta:
               DAP + Evaluaciones revisadas + Anexos, separados por líneas
               internas en vez de tarjetas independientes. ═══ */
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4">
              <h3 className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                <PenLine className="mr-2 h-4 w-4 text-toast-500" />
                Última Nota de Evolución (DAP)
                <span className="rounded-full border border-emerald-600/30 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-600">
                  Firmada
                </span>
                {sessionType && <span className="text-xs font-normal text-slate-400">· {sessionType}</span>}
              </h3>
              <button
                onClick={handleCreateNewEvolution}
                disabled={creatingNew}
                className="flex items-center rounded-lg bg-toast-500 px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {creatingNew ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-2 h-4 w-4" />}
                {creatingNew ? 'Creando...' : 'Nueva Nota de Evolución'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-4 py-2.5">
              {sessionDate && (
                <span className="inline-flex items-center rounded-full border border-toast-500/30 bg-toast-100 px-2.5 py-1 font-mono text-[10px] font-bold text-toast-500">
                  <CalendarDays className="mr-1 h-3 w-3" />
                  Sesión: {formatDateOnly(sessionDate)}
                </span>
              )}
              {noteDate && (
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-[10px] font-bold text-slate-400">
                  Creada: {formatDateTime(noteDate)}
                </span>
              )}
            </div>

            {showLegacy ? (
              <div className="max-h-[600px] overflow-y-auto border-b border-slate-200 border-l-4 border-emerald-600 bg-emerald-50 p-6">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Evolución en formato anterior (texto libre)
                </p>
                <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-900/90">
                  {legacyNotes}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4 border-b border-slate-200 p-5">
                <DapField letter="D" title="Datos" hint="Reporte del paciente y observaciones objetivas de la sesión." value={datos} readOnly onChange={() => {}} />
                <DapField letter="A" title="Análisis" hint="Interpretación clínica, evolución y formulación." value={analisis} readOnly onChange={() => {}} />
                <DapField letter="P" title="Plan" hint="Intervenciones, tareas, ajustes y próxima cita." value={plan} readOnly onChange={() => {}} />
              </div>
            )}

            {linkedAssessments.length > 0 && (
              <div className="border-b border-slate-200 p-4">
                <h4 className="mb-3 flex items-center text-xs font-bold uppercase tracking-wide text-slate-400">
                  <ClipboardCheck className="mr-1.5 h-3.5 w-3.5 text-toast-500" />
                  Evaluaciones revisadas
                </h4>
                <div className="space-y-2">
                  {linkedAssessments.map((a) => (
                    <div key={a.id} className="rounded-xl border border-toast-500/40 bg-toast-100 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-slate-900">{a.name}</span>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] font-bold text-slate-500">
                          {a.score}
                        </span>
                        <span className="font-mono text-[9px] text-slate-400">{formatDateTime(a.date)}</span>
                      </div>
                      {a.interpretation && (
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-900/70">{a.interpretation}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="p-4">
              <h4 className="mb-3 flex items-center text-xs font-bold uppercase tracking-wide text-slate-400">
                <PlusCircle className="mr-1.5 h-3.5 w-3.5 text-toast-500" />
                Anexos Clínicos
                {(addendums.length + currentDraftDocuments.length) > 0 && (
                  <span className="ml-2 rounded-full border border-toast-500/30 bg-toast-100 px-2 py-0.5 text-[9px] font-bold text-toast-500">
                    {addendums.length + currentDraftDocuments.length} {(addendums.length + currentDraftDocuments.length) === 1 ? 'anexo' : 'anexos'}
                  </span>
                )}
              </h4>

              {(sinAnexos || anexosNota) && (
                <p className="mb-3 text-xs leading-relaxed text-slate-900/80">
                  <span className="font-mono text-[9px] font-bold uppercase tracking-wide text-slate-400">Nota (pre-firma): </span>
                  {sinAnexos ? 'Sin anexos clínicos en esta sesión.' : anexosNota}
                </p>
              )}

              {currentDraftDocuments.length > 0 && (
                <div className="mb-3 space-y-2">
                  <p className="font-mono text-[9px] font-bold uppercase tracking-wide text-slate-400">
                    Archivo{currentDraftDocuments.length > 1 ? 's' : ''} adjuntado{currentDraftDocuments.length > 1 ? 's' : ''} antes de firmar
                  </p>
                  {currentDraftDocuments.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Paperclip className="h-3.5 w-3.5 shrink-0 text-toast-500" />
                        <span className="truncate text-xs font-semibold text-slate-900" title={doc.fileName}>{doc.fileName}</span>
                      </div>
                      {doc.downloadUrl && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openDocumentBlob(doc, 'view')}
                            title="Ver archivo"
                            className="rounded p-1 text-slate-400 hover:text-slate-900"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openDocumentBlob(doc, 'download')}
                            title="Descargar archivo"
                            className="rounded p-1 text-slate-400 hover:text-slate-900"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {addendums.length > 0 && (
                <div className="mb-3 max-h-[300px] space-y-3 overflow-y-auto">
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
                      {addendum.content && (
                        <p className="whitespace-pre-wrap border-l-2 border-toast-500/40 pl-3 text-xs leading-relaxed text-slate-900/90">
                          {addendum.content}
                        </p>
                      )}
                      {addendum.fileName && <AddendumFileChip addendum={addendum} />}
                    </div>
                  ))}
                </div>
              )}

              {showAddendumComposer ? (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <textarea
                    value={newAddendumText}
                    onChange={(e) => setNewAddendumText(e.target.value)}
                    placeholder="Redacte un nuevo anexo clínico. Una vez guardado, este texto se congelará permanentemente con su propio hash de integridad..."
                    rows={3}
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-900 outline-none focus:border-toast-500 focus:ring-2 focus:ring-toast-500/20"
                  />

                  {addendumFile ? (
                    <div className="flex items-center justify-between rounded-lg border border-toast-500/30 bg-toast-50 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Paperclip className="h-3.5 w-3.5 shrink-0 text-toast-500" />
                        <span className="truncate text-xs font-semibold text-slate-900" title={addendumFile.name}>{addendumFile.name}</span>
                        <span className="shrink-0 text-[10px] text-slate-400">({(addendumFile.size / 1024 / 1024).toFixed(1)}MB)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAddendumFile(null)}
                        className="shrink-0 text-slate-400 hover:text-slate-900"
                        title="Quitar archivo"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:border-toast-500/50 hover:bg-slate-50">
                      <Paperclip className="h-3.5 w-3.5" />
                      Adjuntar archivo (Word, imagen o PDF, máx. 10MB)
                      <input
                        type="file"
                        accept={CLINICAL_FILE_ACCEPT_ATTR}
                        className="hidden"
                        onChange={(e) => handleAddendumFileSelect(e.target.files?.[0] || null)}
                      />
                    </label>
                  )}

                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => { setShowAddendumComposer(false); setNewAddendumText(''); setAddendumFile(null); }}
                      className="text-[10px] font-semibold text-slate-400 hover:text-slate-600"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleAddAddendum}
                      disabled={addingAddendum || (!newAddendumText.trim() && !addendumFile)}
                      className="flex items-center gap-1.5 rounded-lg bg-toast-500 px-5 py-2.5 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {addingAddendum ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
                      {addingAddendum ? 'Guardando...' : 'Guardar Anexo'}
                    </button>
                  </div>
                  <p className="flex items-center font-mono text-[10px] text-slate-400">
                    <ShieldCheck className="mr-1 h-3 w-3" />
                    Los anexos son inmutables: una vez guardados no pueden editarse ni eliminarse.
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddendumComposer(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:border-toast-500/50 hover:bg-slate-50"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  Agregar anexo
                </button>
              )}
            </div>
          </div>
        )}

        {/* ═══ EVOLUCIONES ANTERIORES (acordeón, Material UI) ═══ */}
        <SesionesAccordion
            sesiones={sesionesAnteriores}
            onVerAnexo={(a) => openAnexoBlob(a, 'view')}
            onDescargarAnexo={(a) => openAnexoBlob(a, 'download')}
            onVerDocumento={(d) => openDocumentBlob(d, 'view')}
            onDescargarDocumento={(d) => openDocumentBlob(d, 'download')}
          />
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

// Archivo adjunto de un anexo — "Ver" y "Descargar" traen el archivo como
// blob en vez de navegar directo a la URL firmada de S3, mismo criterio de
// seguridad que ClinicalAttachments.tsx: la firma (X-Amz-Signature) nunca
// queda expuesta en la barra de direcciones ni en el historial del navegador.
function AddendumFileChip({ addendum, compact }: { addendum: Addendum; compact?: boolean }) {
  const openBlob = async (mode: 'view' | 'download') => {
    if (!addendum.downloadUrl) return;
    try {
      const res = await fetch(addendum.downloadUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      if (mode === 'download') {
        link.download = addendum.fileName || 'archivo';
      } else {
        link.target = '_blank';
        link.rel = 'noreferrer';
      }
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) {
      console.error('Error abriendo el adjunto del anexo:', error);
      window.open(addendum.downloadUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className={`flex items-center justify-between rounded-lg border border-toast-500/30 bg-white ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        <Paperclip className={`shrink-0 text-toast-500 ${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />
        <span className={`truncate font-semibold text-slate-900 ${compact ? 'text-[10px]' : 'text-xs'}`} title={addendum.fileName || ''}>
          {addendum.fileName}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => openBlob('view')} title="Ver archivo" className="p-1 text-slate-400 hover:text-slate-900">
          <Eye className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </button>
        <button type="button" onClick={() => openBlob('download')} title="Descargar archivo" className="p-1 text-slate-400 hover:text-slate-900">
          <Download className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </button>
      </div>
    </div>
  );
}
