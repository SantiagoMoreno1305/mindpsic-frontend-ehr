import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { UploadCloud, FileText, Loader2 } from 'lucide-react';

interface ClinicalDocumentEntry {
  id: string;
  fileName: string;
  createdAt: string;
}

export default function ClinicalAttachments({ patientId }: { patientId: string }) {
  const [documents, setDocuments] = useState<ClinicalDocumentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';
      const res = await fetch(`${apiBase}/api/clinical-history/${patientId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.documents)) setDocuments(data.documents);
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const token = localStorage.getItem('mind_token');
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';

      const presignedRes = await fetch(`${apiBase}/api/clinical-history/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ patientId, fileName: file.name, fileType: file.type }),
      });
      if (!presignedRes.ok) throw new Error('Error getting presigned URL');
      const { url, document } = await presignedRes.json();

      const uploadRes = await fetch(url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!uploadRes.ok) throw new Error('Error uploading to S3');

      const confirmRes = await fetch(`${apiBase}/api/clinical-history/confirm-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ documentId: document.id }),
      });
      if (!confirmRes.ok) throw new Error('Error confirming upload');

      toast.success('Archivo subido exitosamente');
      fetchDocuments();
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Error al subir el archivo');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files && files.length > 0) handleFileUpload(files[0]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) handleFileUpload(e.target.files[0]);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center transition-colors hover:border-toast-500/50 hover:bg-slate-50"
      >
        <UploadCloud className="mb-4 h-10 w-10 text-slate-400" />
        <p className="mb-1 text-sm font-semibold text-slate-900">Arrastra archivos aquí</p>
        <p className="mb-4 text-xs text-slate-400">o haz clic para seleccionar</p>
        <label className="cursor-pointer">
          <span className="rounded-xl bg-slate-100 px-5 py-2.5 text-xs font-bold text-slate-900 transition-colors hover:bg-slate-50">
            Examinar Archivos
          </span>
          <input type="file" className="hidden" onChange={handleFileInput} disabled={uploading} />
        </label>
        {uploading && (
          <p className="mt-4 flex items-center text-xs font-semibold text-toast-500">
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            Subiendo a la bóveda segura...
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Archivos Adjuntos</h3>
        </div>
        <div className="space-y-3 p-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-toast-500" />
            </div>
          ) : documents.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No hay documentos subidos aún.</p>
          ) : (
            documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3 transition-colors hover:bg-slate-50">
                <div className="flex items-center overflow-hidden">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                    <FileText className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="ml-3 overflow-hidden">
                    <p className="truncate text-xs font-semibold text-slate-900" title={doc.fileName}>{doc.fileName}</p>
                    <p className="text-[10px] text-slate-400">{new Date(doc.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
