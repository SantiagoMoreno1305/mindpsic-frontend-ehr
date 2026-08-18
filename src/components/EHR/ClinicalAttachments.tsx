import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { UploadCloud, FileText, Loader2, Eye, Download } from 'lucide-react';

interface ClinicalDocumentEntry {
  id: string;
  fileName: string;
  fileType?: string;
  downloadUrl?: string;
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
      // Este endpoint (a diferencia de GET /api/clinical-history/:patientId)
      // devuelve cada documento con una downloadUrl pre-firmada de S3 lista
      // para ver/descargar — sin ella los anexos quedaban listados pero inertes.
      const res = await fetch(`${apiBase}/api/documents/patient/${patientId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setDocuments(data);
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

  // "Ver" y "Descargar" traen el archivo como blob y trabajan sobre una URL
  // local (blob:) en vez de navegar directo a la URL firmada de S3 — así la
  // firma (X-Amz-Signature, vigente 5 min) nunca queda expuesta en la barra
  // de direcciones ni en el historial del navegador. El atributo `download`
  // de un <a> tampoco funciona en URLs cross-origin como S3, así que el blob
  // local es necesario de todas formas para forzar la descarga real.
  const handleView = async (doc: ClinicalDocumentEntry) => {
    if (!doc.downloadUrl) return;
    try {
      const res = await fetch(doc.downloadUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      // Ancla + clic programático en vez de window.open(): con `noopener` esta
      // API siempre devuelve null (perdiendo la referencia a la pestaña), y
      // una pestaña con el opener cortado a menudo no puede resolver un blob:
      // creado en el documento original — ambas cosas producían pestañas
      // "about:blank" vacías. El clic de ancla sí abre la pestaña ya apuntando
      // al blob real.
      const link = document.createElement('a');
      link.href = objectUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) {
      console.error('Error abriendo documento:', error);
      window.open(doc.downloadUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleDownload = async (doc: ClinicalDocumentEntry) => {
    if (!doc.downloadUrl) return;
    try {
      const res = await fetch(doc.downloadUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = doc.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error('Error descargando documento:', error);
      window.open(doc.downloadUrl, '_blank', 'noopener,noreferrer');
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
                {doc.downloadUrl && (
                  <div className="ml-3 flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleView(doc)}
                      title="Ver documento"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownload(doc)}
                      title="Descargar documento"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
