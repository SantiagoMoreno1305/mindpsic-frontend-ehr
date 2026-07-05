import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { Save, UploadCloud, FileText, ArrowLeft, Loader2, Lock, ShieldCheck, PlusCircle, Hash } from 'lucide-react';

interface Addendum {
  id: string;
  content: string;
  createdById: string;
  createdByName?: string;
  integrityHash?: string;
  createdAt: string;
}

interface ClinicalHistoryEditorProps {
  patientId: string;
  onBack: () => void;
}

export default function ClinicalHistoryEditor({ patientId, onBack }: ClinicalHistoryEditorProps) {
  const [notes, setNotes] = useState('');
  const [documents, setDocuments] = useState<any[]>([]);
  const [addendums, setAddendums] = useState<Addendum[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [signing, setSigning] = useState(false);
  const [addingAddendum, setAddingAddendum] = useState(false);
  const [newAddendumText, setNewAddendumText] = useState('');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ── Estado de auditoría ─────────────────────────────────────────────────
  const [historyStatus, setHistoryStatus] = useState<'DRAFT' | 'SIGNED'>('DRAFT');
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [signedById, setSignedById] = useState<string | null>(null);
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
          setNotes(data.history.notes || '');
          setHistoryStatus(data.history.status || 'DRAFT');
          setSignedAt(data.history.signedAt || null);
          setSignedById(data.history.signedById || null);
          setIntegrityHash(data.history.integrityHash || null);
          setAddendums(data.history.addendums || []);
        }
        if (data.documents) setDocuments(data.documents);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
      toast.error('Error al cargar la historia clínica');
    } finally {
      setLoading(false);
    }
  };

  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (historyStatus === 'SIGNED') return; // Guarda extra en frontend
    const newNotes = e.target.value;
    setNotes(newNotes);

    // Debounce save
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveNotes(newNotes);
    }, 2000);
  };

  const saveNotes = async (text: string) => {
    setSaving(true);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';
      const res = await fetch(`${apiBase}/api/clinical-history/${patientId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ notes: text })
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
      console.error('Error saving notes:', error);
      toast.error('Error al guardar el borrador');
    } finally {
      setSaving(false);
    }
  };

  const handleManualSave = () => {
    if (historyStatus === 'SIGNED') return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveNotes(notes);
  };

  // ── Firmar y Congelar (irreversible) ────────────────────────────────────
  const handleSign = async () => {
    const confirmed = confirm(
      '⚠️ ACCIÓN IRREVERSIBLE\n\n' +
      'Al firmar esta evolución clínica:\n' +
      '• El texto quedará congelado permanentemente\n' +
      '• Se generará un hash SHA-256 de auditoría\n' +
      '• Solo podrá agregar anexos posteriores\n\n' +
      '¿Desea continuar con la firma digital?'
    );
    if (!confirmed) return;

    setSigning(true);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';

      // Primero guardar el borrador actual
      await fetch(`${apiBase}/api/clinical-history/${patientId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ notes })
      });

      // Luego firmar
      const res = await fetch(`${apiBase}/api/clinical-history/${patientId}/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        toast.error(errBody.error || 'Error al firmar la evolución');
        console.error('[signHistory] Error:', errBody);
        return;
      }

      const data = await res.json();
      setHistoryStatus('SIGNED');
      setSignedAt(data.signedAt);
      setSignedById(data.signedById);
      setIntegrityHash(data.integrityHash);
      toast.success('✅ Evolución firmada y congelada exitosamente');
    } catch (error) {
      console.error('Error signing history:', error);
      toast.error('Error de red al firmar la evolución');
    } finally {
      setSigning(false);
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content: newAddendumText.trim() })
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        toast.error(errBody.error || 'Error al crear el anexo');
        console.error('[addAddendum] Error:', errBody);
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

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';

      // 1. Get Presigned URL
      const presignedRes = await fetch(`${apiBase}/api/clinical-history/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          patientId,
          fileName: file.name,
          fileType: file.type
        })
      });

      if (!presignedRes.ok) throw new Error('Error getting presigned URL');
      const { url, document } = await presignedRes.json();

      // 2. Upload directly to S3
      const uploadRes = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type
        },
        body: file
      });

      if (!uploadRes.ok) throw new Error('Error uploading to S3');

      // 3. Confirm upload with Backend
      const confirmRes = await fetch(`${apiBase}/api/clinical-history/confirm-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ documentId: document.id })
      });

      if (!confirmRes.ok) throw new Error('Error confirming upload');

      toast.success('Archivo subido exitosamente');
      fetchHistory(); // Refresh list
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Error al subir el archivo');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-charcoal-500" />
      </div>
    );
  }

  const isSigned = historyStatus === 'SIGNED';

  return (
    <div className="bg-slate-50 min-h-[calc(100vh-200px)] p-6 space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center text-sm font-semibold text-slate-600 hover:text-charcoal-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver al Tablero
        </button>
        <h2 className="text-xl font-bold text-charcoal-900 tracking-tight">Historia Clínica</h2>
      </div>

      {/* ═══ BANNER DE AUDITORÍA (solo cuando está firmado) ═══ */}
      {isSigned && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-300 rounded-2xl p-4 flex items-start space-x-4 shadow-sm">
          <div className="bg-emerald-600 p-2.5 rounded-xl shadow-md shrink-0">
            <Lock className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 text-left space-y-1.5">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700" />
              <h3 className="text-sm font-black text-emerald-900 uppercase tracking-wide">
                Evolución Firmada Digitalmente
              </h3>
            </div>
            <p className="text-xs text-emerald-800 font-semibold">
              Este documento fue congelado permanentemente y no puede ser modificado.
              Solo se pueden agregar anexos clínicos posteriores.
            </p>
            <div className="flex flex-wrap gap-3 mt-2">
              {signedAt && (
                <span className="inline-flex items-center bg-emerald-100 border border-emerald-300 text-emerald-800 text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg">
                  📅 Firmado: {new Date(signedAt).toLocaleString('es-CO', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                  })}
                </span>
              )}
              {integrityHash && (
                <span className="inline-flex items-center bg-slate-100 border border-slate-300 text-slate-700 text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg">
                  <Hash className="w-3 h-3 mr-1 text-slate-500" />
                  Hash: {integrityHash.substring(0, 16)}...
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lado Izquierdo: Editor de Notas */}
        <div className="lg:col-span-2 flex flex-col space-y-4">
          {/* ═══ BLOQUE DE EVOLUCIÓN ═══ */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[500px]">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="font-semibold text-charcoal-800 flex items-center">
                <FileText className="w-4 h-4 mr-2 text-charcoal-500" />
                Notas de Evolución
                {isSigned && (
                  <span className="ml-2 bg-emerald-100 text-emerald-700 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border border-emerald-300">
                    🔒 Firmada
                  </span>
                )}
                {!isSigned && (
                  <span className="ml-2 bg-amber-100 text-amber-700 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border border-amber-300">
                    ✏️ Borrador
                  </span>
                )}
              </h3>
              <div className="flex items-center space-x-2">
                {!isSigned && (
                  <>
                    <button
                      onClick={handleManualSave}
                      disabled={saving}
                      className="flex items-center px-4 py-2 bg-charcoal-900 text-white text-xs font-bold rounded-lg hover:bg-charcoal-800 transition-colors disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                      {saving ? 'Guardando...' : 'Guardar Borrador'}
                    </button>
                    <button
                      onClick={handleSign}
                      disabled={signing || !notes.trim()}
                      className="flex items-center px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-md"
                    >
                      {signing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}
                      {signing ? 'Firmando...' : '🔒 Firmar y Congelar'}
                    </button>
                  </>
                )}
              </div>
            </div>
            {isSigned ? (
              /* ═══ MODO SOLO LECTURA ═══ */
              <div className="flex-1 p-6 overflow-y-auto bg-emerald-50/30 border-l-4 border-emerald-400">
                <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed whitespace-pre-wrap font-sans">
                  {notes}
                </div>
              </div>
            ) : (
              /* ═══ MODO EDITABLE ═══ */
              <textarea
                value={notes}
                onChange={handleNotesChange}
                placeholder="Escribe las notas clínicas de la sesión aquí..."
                className="flex-1 p-6 w-full resize-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-charcoal-200 text-slate-700 leading-relaxed"
              />
            )}
          </div>

          {/* ═══ SECCIÓN DE ANEXOS (solo cuando está firmado) ═══ */}
          {isSigned && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h3 className="font-semibold text-charcoal-800 flex items-center">
                  <PlusCircle className="w-4 h-4 mr-2 text-indigo-500" />
                  Anexos Clínicos
                  <span className="ml-2 bg-indigo-100 text-indigo-700 text-[9px] font-bold px-2 py-0.5 rounded-full border border-indigo-200">
                    {addendums.length} {addendums.length === 1 ? 'anexo' : 'anexos'}
                  </span>
                </h3>
              </div>

              {/* Lista de Anexos Existentes */}
              {addendums.length > 0 && (
                <div className="p-4 space-y-3 max-h-[300px] overflow-y-auto border-b border-slate-100">
                  {addendums.map((addendum) => (
                    <div key={addendum.id} className="bg-indigo-50/50 border border-indigo-200 rounded-xl p-4 text-left space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Lock className="w-3 h-3 text-indigo-500" />
                          <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider font-mono">
                            Anexo Inmutable
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-slate-500 font-mono">
                            {new Date(addendum.createdAt).toLocaleString('es-CO', {
                              year: 'numeric', month: '2-digit', day: '2-digit',
                              hour: '2-digit', minute: '2-digit'
                            })}
                          </span>
                          {addendum.integrityHash && (
                            <span className="inline-flex items-center bg-slate-100 border border-slate-200 text-slate-600 text-[9px] font-mono px-1.5 py-0.5 rounded">
                              <Hash className="w-2.5 h-2.5 mr-0.5" />
                              {addendum.integrityHash.substring(0, 10)}...
                            </span>
                          )}
                        </div>
                      </div>
                      {addendum.createdByName && (
                        <p className="text-[10px] text-indigo-600 font-semibold">
                          Por: {addendum.createdByName}
                        </p>
                      )}
                      <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap border-l-2 border-indigo-300 pl-3">
                        {addendum.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Formulario para Nuevo Anexo */}
              <div className="p-4 space-y-3">
                <textarea
                  value={newAddendumText}
                  onChange={(e) => setNewAddendumText(e.target.value)}
                  placeholder="Redacte un nuevo anexo clínico. Una vez guardado, este texto se congelará permanentemente con su propio hash de integridad..."
                  rows={3}
                  className="w-full p-4 border border-slate-200 rounded-xl text-xs text-slate-700 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 bg-slate-50"
                />
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-slate-400 font-mono flex items-center">
                    <ShieldCheck className="w-3 h-3 mr-1" />
                    Los anexos son inmutables: una vez guardados no pueden ser editados ni eliminados.
                  </p>
                  <button
                    onClick={handleAddAddendum}
                    disabled={addingAddendum || !newAddendumText.trim()}
                    className="flex items-center px-5 py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-md"
                  >
                    {addingAddendum ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlusCircle className="w-4 h-4 mr-2" />}
                    {addingAddendum ? 'Guardando...' : 'Guardar Anexo'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Lado Derecho: Zona de Archivos */}
        <div className="flex flex-col space-y-6 h-[600px]">
          {/* Dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="bg-white rounded-2xl border-2 border-dashed border-slate-300 p-8 flex flex-col items-center justify-center text-center hover:border-charcoal-400 hover:bg-slate-50 transition-colors"
          >
            <UploadCloud className="w-10 h-10 text-charcoal-400 mb-4" />
            <p className="text-sm font-semibold text-charcoal-800 mb-1">Arrastra archivos aquí</p>
            <p className="text-xs text-slate-500 mb-4">o haz clic para seleccionar</p>
            <label className="cursor-pointer">
              <span className="px-5 py-2.5 bg-slate-100 text-charcoal-800 text-xs font-bold rounded-xl hover:bg-slate-200 transition-colors">
                Examinar Archivos
              </span>
              <input
                type="file"
                className="hidden"
                onChange={handleFileInput}
                disabled={uploading}
              />
            </label>
            {uploading && (
              <p className="mt-4 text-xs font-semibold text-charcoal-600 flex items-center">
                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                Subiendo a la bóveda segura...
              </p>
            )}
          </div>

          {/* Listado de Adjuntos */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex-1 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-semibold text-charcoal-800 text-sm">Archivos Adjuntos</h3>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-3">
              {documents.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No hay documentos subidos aún.</p>
              ) : (
                documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center overflow-hidden">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4 text-slate-500" />
                      </div>
                      <div className="ml-3 overflow-hidden">
                        <p className="text-xs font-semibold text-charcoal-800 truncate" title={doc.fileName}>{doc.fileName}</p>
                        <p className="text-[10px] text-slate-500">{new Date(doc.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
