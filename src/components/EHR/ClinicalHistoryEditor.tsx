import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { Save, UploadCloud, FileText, ArrowLeft, Loader2 } from 'lucide-react';

interface ClinicalHistoryEditorProps {
  patientId: string;
  onBack: () => void;
}

export default function ClinicalHistoryEditor({ patientId, onBack }: ClinicalHistoryEditorProps) {
  const [notes, setNotes] = useState('');
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
        if (data.history) setNotes(data.history.notes || '');
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
      if (!res.ok) throw new Error('Failed to save');
      toast.success('Borrador guardado automáticamente', { position: 'bottom-right', duration: 2000 });
    } catch (error) {
      console.error('Error saving notes:', error);
      toast.error('Error al guardar el borrador');
    } finally {
      setSaving(false);
    }
  };

  const handleManualSave = () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveNotes(notes);
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lado Izquierdo: Editor de Notas */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px]">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
            <h3 className="font-semibold text-charcoal-800 flex items-center">
              <FileText className="w-4 h-4 mr-2 text-charcoal-500" />
              Notas de Evolución
            </h3>
            <button
              onClick={handleManualSave}
              disabled={saving}
              className="flex items-center px-4 py-2 bg-charcoal-900 text-white text-xs font-bold rounded-lg hover:bg-charcoal-800 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {saving ? 'Guardando...' : 'Guardar Borrador'}
            </button>
          </div>
          <textarea
            value={notes}
            onChange={handleNotesChange}
            placeholder="Escribe las notas clínicas de la sesión aquí..."
            className="flex-1 p-6 w-full resize-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-charcoal-200 text-slate-700 leading-relaxed"
          />
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
