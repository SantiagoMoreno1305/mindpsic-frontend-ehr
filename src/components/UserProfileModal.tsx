/**
 * UserProfileModal.tsx
 *
 * Perfil del usuario logueado. Además de la foto (ya funcionaba), ahora
 * cada quien puede completar y corregir sus propios datos — teléfono,
 * documento, tarjeta profesional, especialidad, nivel académico,
 * experiencia y EPS — y cambiar su contraseña. Antes esto SOLO lo podía
 * tocar un CEO/DIRECTIVO editando a otro colaborador desde Equipo y
 * Accesos; un psicólogo u operativo no podía corregir ni un dato propio.
 *
 * Correo, rol, tenant y los permisos por persona (aprobador de cambios de
 * cupo, proyectos de investigación, Programas de medición) siguen sin poder
 * tocarse desde acá a propósito — ver PATCH /api/users/me en el backend,
 * que ni siquiera acepta esos campos.
 *
 * Los campos vacíos se resaltan con un borde ámbar suave — un recordatorio
 * discreto de "esto te falta", no un aviso bloqueante ni insistente.
 */
import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { X, User as UserIcon, Camera, Loader2, ShieldCheck, Building2, KeyRound, Eye, EyeOff } from 'lucide-react';
import { apiFetch, apiPost } from '../lib/apiClient';
import { useEpsSearch } from '../hooks/useEpsSearch';
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

const DOCUMENT_TYPES = ['CC', 'TI', 'PEP', 'PA', 'CE'];
const ACADEMIC_LEVEL_OPTIONS = ['Técnico', 'Tecnólogo', 'Pregrado', 'Especialización', 'Maestría', 'Doctorado'];
const SELF_PASSWORD_MIN_LENGTH = 12;

interface SpecialtyOption { id: string; name: string }
interface MeProfile {
  id: string; firstName: string | null; lastName: string | null; name: string;
  email: string; phone: string | null; role: string; tenantId: string;
  documentType: string | null; documentId: string | null; professionalCard: string | null;
  specialtyId: string | null; specialtyName: string | null; academicLevel: string | null;
  experienceYears: number | null; epsCode: string | null; epsLabel: string | null;
}

const inputCls = (empty: boolean) =>
  `w-full rounded-lg border p-2.5 text-sm outline-none bg-white focus:ring-2 focus:ring-toast-400 ${
    empty ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'
  }`;

function Field({ label, empty, children }: { label: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-600">
        {label}
        {empty && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-700">Sin completar</span>}
      </span>
      {children}
    </label>
  );
}

export default function UserProfileModal({ isOpen, onClose, user, onUserUpdated }: UserProfileModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [specialties, setSpecialties] = useState<SpecialtyOption[]>([]);

  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', documentType: 'CC', documentId: '',
    professionalCard: '', specialtyId: '', academicLevel: '', experienceYears: '',
    epsCode: '', epsLabel: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const epsSearch = useEpsSearch();

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingProfile(true);
    Promise.all([
      apiFetch('/api/users/me').then((r) => (r.ok ? r.json() : null)),
      apiFetch('/api/specialties/options').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ])
      .then(([me, specs]) => {
        if (specs) setSpecialties(specs);
        if (me) {
          setProfile(me);
          setForm({
            firstName: me.firstName || '', lastName: me.lastName || '', phone: me.phone || '',
            documentType: me.documentType || 'CC', documentId: me.documentId || '',
            professionalCard: me.professionalCard || '', specialtyId: me.specialtyId || '',
            academicLevel: me.academicLevel || '', experienceYears: me.experienceYears?.toString() || '',
            epsCode: me.epsCode || '', epsLabel: me.epsLabel || '',
          });
        }
      })
      .finally(() => setLoadingProfile(false));
    // Formulario de contraseña siempre arranca en blanco — no precargar nada sensible.
    setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setShowPw(false);
  }, [isOpen]);

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

  const isProfessional = user.role === 'ESPECIALISTA_B2B' || user.role === 'OPERATIVO' || !!profile?.documentId || !!profile?.professionalCard;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('Nombre y apellido no pueden quedar vacíos.');
      return;
    }
    setSavingProfile(true);
    try {
      const res = await apiFetch('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim() || null,
          documentType: form.documentId.trim() ? form.documentType : null,
          documentId: form.documentId.trim() || null,
          professionalCard: form.professionalCard.trim() || null,
          specialtyId: form.specialtyId || null,
          academicLevel: form.academicLevel || null,
          experienceYears: form.experienceYears !== '' ? form.experienceYears : null,
          epsCode: form.epsCode || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Error HTTP ${res.status}`);
        return;
      }
      toast.success('Perfil actualizado.');
      onUserUpdated({ ...user, name: data.user.name, specialty: profile?.specialtyName ?? user.specialty });
      // Refresca el resaltado de "sin completar" con lo que quedó guardado.
      setProfile((prev) => (prev ? { ...prev, ...data.user, specialtyName: specialties.find((s) => s.id === form.specialtyId)?.name ?? null } : prev));
    } catch (err: any) {
      toast.error('Error de red: ' + err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.newPassword.length < SELF_PASSWORD_MIN_LENGTH) {
      toast.error(`La nueva contraseña debe tener al menos ${SELF_PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    if (pw.newPassword !== pw.confirmPassword) {
      toast.error('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    setSavingPw(true);
    try {
      const res = await apiFetch('/api/users/me/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword: pw.currentPassword, newPassword: pw.newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Error HTTP ${res.status}`);
        return;
      }
      toast.success('Contraseña actualizada.');
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      toast.error('Error de red: ' + err.message);
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-bold text-charcoal-900">Mi perfil</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-charcoal-900 cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto">
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

          {/* Solo lectura: correo, rol, tenant — identidad y permisos no se autoeditan. */}
          <div className="space-y-3 px-6 pb-5 pt-5 text-left">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Correo electrónico</p>
              <p className="break-all text-sm text-charcoal-900">{user.email}</p>
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
          </div>

          {/* Editable: mis datos. */}
          <form onSubmit={handleSaveProfile} className="space-y-3 border-t border-slate-100 px-6 py-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Mis datos</p>
            {loadingProfile ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nombres" empty={!form.firstName.trim()}>
                    <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={inputCls(!form.firstName.trim())} />
                  </Field>
                  <Field label="Apellidos" empty={!form.lastName.trim()}>
                    <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={inputCls(!form.lastName.trim())} />
                  </Field>
                </div>

                <Field label="Teléfono" empty={!form.phone.trim()}>
                  <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="3001234567" className={inputCls(!form.phone.trim())} />
                </Field>

                <Field label="Documento de identidad" empty={!form.documentId.trim()}>
                  <div className="flex gap-2">
                    <select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })} className={`w-20 shrink-0 ${inputCls(false)}`}>
                      {DOCUMENT_TYPES.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                    <input
                      type="text" inputMode="numeric" value={form.documentId}
                      onChange={(e) => setForm({ ...form, documentId: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                      placeholder="Ej. 1024556778" className={`min-w-0 ${inputCls(!form.documentId.trim())}`}
                    />
                  </div>
                </Field>

                {isProfessional && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Tarjeta profesional" empty={!form.professionalCard.trim()}>
                        <input value={form.professionalCard} onChange={(e) => setForm({ ...form, professionalCard: e.target.value })} className={`font-mono ${inputCls(!form.professionalCard.trim())}`} />
                      </Field>
                      <Field label="Especialidad" empty={!form.specialtyId}>
                        <select value={form.specialtyId} onChange={(e) => setForm({ ...form, specialtyId: e.target.value })} className={inputCls(!form.specialtyId)}>
                          <option value="">Sin especialidad</option>
                          {specialties.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Nivel académico" empty={!form.academicLevel}>
                        <select value={form.academicLevel} onChange={(e) => setForm({ ...form, academicLevel: e.target.value })} className={inputCls(!form.academicLevel)}>
                          <option value="">Selecciona el nivel</option>
                          {ACADEMIC_LEVEL_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </Field>
                      <Field label="Experiencia (años)" empty={form.experienceYears === ''}>
                        <input type="number" min={0} value={form.experienceYears} onChange={(e) => setForm({ ...form, experienceYears: e.target.value })} className={inputCls(form.experienceYears === '')} />
                      </Field>
                    </div>

                    <Field label="EPS / IPS asociada" empty={!form.epsCode}>
                      <div className="relative">
                        <input
                          type="text"
                          value={form.epsCode ? form.epsLabel : epsSearch.query}
                          onChange={(e) => { setForm({ ...form, epsCode: '', epsLabel: '' }); epsSearch.setQuery(e.target.value); }}
                          placeholder="Busca por nombre"
                          className={inputCls(!form.epsCode)}
                        />
                        {epsSearch.results.length > 0 && !form.epsCode && (
                          <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                            {epsSearch.results.map((eps) => (
                              <li key={eps.code}>
                                <button
                                  type="button"
                                  onClick={() => { setForm((f) => ({ ...f, epsCode: eps.code, epsLabel: eps.nombre })); epsSearch.setQuery(''); epsSearch.setResults([]); }}
                                  className="w-full cursor-pointer px-3 py-2 text-left text-xs hover:bg-toast-50"
                                >
                                  {eps.nombre}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </Field>
                  </>
                )}

                <button
                  type="submit"
                  disabled={savingProfile}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer"
                >
                  {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
                  Guardar cambios
                </button>
              </>
            )}
          </form>

          {/* Cambiar contraseña. */}
          <form onSubmit={handleChangePassword} className="space-y-3 border-t border-slate-100 px-6 py-5">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <KeyRound className="h-3.5 w-3.5" /> Cambiar contraseña
            </p>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">Contraseña actual</span>
              <input
                type={showPw ? 'text' : 'password'} value={pw.currentPassword} autoComplete="current-password"
                onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} className={inputCls(false)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">Nueva contraseña</span>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'} value={pw.newPassword} autoComplete="new-password"
                  onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} className={`${inputCls(false)} pr-9`}
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer" title={showPw ? 'Ocultar' : 'Mostrar'}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <span className="mt-1 block text-[10.5px] text-slate-400">Mínimo {SELF_PASSWORD_MIN_LENGTH} caracteres.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">Confirmar nueva contraseña</span>
              <input
                type={showPw ? 'text' : 'password'} value={pw.confirmPassword} autoComplete="new-password"
                onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} className={inputCls(false)}
              />
            </label>
            <button
              type="submit"
              disabled={savingPw || !pw.currentPassword || !pw.newPassword}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-charcoal-900 transition-colors hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
            >
              {savingPw && <Loader2 className="h-4 w-4 animate-spin" />}
              Actualizar contraseña
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
