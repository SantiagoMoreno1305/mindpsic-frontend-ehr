/**
 * UserProfileModal.tsx
 *
 * Perfil del usuario logueado — solo lectura por ahora (sin editar nombre,
 * correo, etc.), con una única acción interactiva: cambiar la foto de
 * perfil (JPG/PNG, máx. 1MB). Se abre desde el widget de usuario en Navbar.
 */
import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { X, User as UserIcon, Camera, Loader2, ShieldCheck, Building2 } from 'lucide-react';
import { apiFetch, apiPost } from '../lib/apiClient';
import type { User } from '../types';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onUserUpdated: (user: User) => void;
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png'];
const MAX_BYTES = 1 * 1024 * 1024; // 1MB

const ROLE_LABELS: Record<string, string> = {
  CEO: 'CEO / Dirección General',
  DIRECTIVO: 'Directivo / Coordinación',
  ESPECIALISTA_B2B: 'Psicólogo Clínico',
  OPERATIVO: 'Soporte Operativo',
  USUARIO_B2C: 'Usuario',
};

export default function UserProfileModal({ isOpen, onClose, user, onUserUpdated }: UserProfileModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  if (!isOpen) return null;

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo si falla
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Solo se aceptan imágenes JPG o PNG.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('La imagen no puede superar 1MB.');
      return;
    }

    setUploading(true);
    try {
      // 1. Pedir URL prefirmada de subida
      const { url, s3Key } = await apiPost<{ url: string; s3Key: string }>(
        '/api/users/me/avatar/presign',
        { contentType: file.type }
      );

      // 2. Subir el archivo directo a S3 (sin pasar por el backend)
      const putRes = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error('No se pudo subir la imagen a almacenamiento.');

      // 3. Confirmar — el backend verifica el tamaño/tipo REAL ya subido
      const confirmRes = await apiFetch('/api/users/me/avatar/confirm', {
        method: 'POST',
        body: JSON.stringify({ s3Key }),
      });
      if (!confirmRes.ok) {
        const errData = await confirmRes.json().catch(() => ({}));
        throw new Error(errData.error || 'No se pudo confirmar la foto de perfil.');
      }
      const { avatarUrl } = await confirmRes.json();

      onUserUpdated({ ...user, avatarUrl });
      toast.success('Foto de perfil actualizada.');
    } catch (err: any) {
      toast.error(err.message || 'Error al subir la foto de perfil.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-bold text-charcoal-900">Mi perfil</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-charcoal-900 cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3 px-6 pt-6">
          <div className="relative">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                referrerPolicy="no-referrer"
                className="h-24 w-24 rounded-full border border-slate-200 object-cover shadow-sm"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full border border-toast-200 bg-toast-50">
                <UserIcon className="h-10 w-10 text-toast-400" />
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Cambiar foto"
              className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-charcoal-900 text-white shadow-md transition-colors hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={handleFileSelected}
            />
          </div>
          <p className="text-[10.5px] text-slate-400">JPG o PNG, máx. 1MB</p>
        </div>

        <div className="space-y-3 px-6 py-5 text-left">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Nombre</p>
            <p className="text-sm font-semibold text-charcoal-900">{user.name}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Correo electrónico</p>
            <p className="text-sm text-charcoal-900">{user.email}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Rol</p>
              <p className="text-sm text-charcoal-900">{ROLE_LABELS[user.role] || user.role}</p>
            </div>
          </div>
          {user.tenantId && (
            <div className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tenant</p>
                <p className="font-mono text-xs text-charcoal-900">{user.tenantId}</p>
              </div>
            </div>
          )}
          {user.specialty && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Especialidad</p>
              <p className="text-sm text-charcoal-900">{user.specialty}</p>
            </div>
          )}
          {user.level && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Nivel</p>
              <p className="text-sm text-charcoal-900">{user.level}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
