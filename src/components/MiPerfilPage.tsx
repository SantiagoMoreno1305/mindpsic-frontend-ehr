/**
 * MiPerfilPage.tsx
 *
 * Mi perfil como página propia (no modal). Cada quien completa y corrige sus
 * datos — identidad, documento, y si es profesional, tarjeta, especialidad,
 * nivel académico, experiencia y EPS — y cambia su contraseña. Correo, rol,
 * tenant y permisos por persona NO se editan desde acá (ver PATCH /api/users/me
 * en el backend, que tampoco acepta esos campos).
 *
 * Los campos vacíos llevan un borde ámbar y una etiqueta "Sin completar", y
 * arriba se cuenta cuántos datos faltan — un recordatorio discreto, no bloqueante.
 */
import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ArrowLeft, User as UserIcon, Camera, Loader2, ShieldCheck, Building2, KeyRound, Eye, EyeOff, Mail, IdCard } from 'lucide-react';
import { apiFetch, apiPost } from '../lib/apiClient';
import { useEpsSearch } from '../hooks/useEpsSearch';
import type { User } from '../types';

interface MiPerfilPageProps {
  user: User;
  onUserUpdated: (user: User) => void;
  onBack: () => void;
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
  `w-full rounded-lg border px-3 py-2.5 text-sm outline-none bg-white focus:ring-2 focus:ring-toast-400 ${
    empty ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'
  }`;

function Field({ label, empty, children, className = '' }: { label: string; empty?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-600">
        {label}
        {empty && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-700">Sin completar</span>}
      </span>
      {children}
    </label>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-5 flex items-center gap-2 text-sm font-bold text-charcoal-900">
        <span className="text-toast-500">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function MiPerfilPage({ user, onUserUpdated, onBack }: MiPerfilPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
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
  }, []);

  const isProfessional = user.role === 'ESPECIALISTA_B2B' || user.role === 'OPERATIVO' || !!profile?.documentId || !!profile?.professionalCard;

  const requiredMissing = [
    !form.firstName.trim(), !form.lastName.trim(), !form.phone.trim(), !form.documentId.trim(),
    ...(isProfessional ? [!form.professionalCard.trim(), !form.specialtyId, !form.academicLevel, form.experienceYears === '', !form.epsCode] : []),
  ];
  const missingCount = requiredMissing.filter(Boolean).length;

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
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
      const { url, s3Key } = await apiPost<{ url: string; s3Key: string }>(
        '/api/users/me/avatar/presign',
        { contentType: file.type }
      );
      const putRes = await fetch(url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!putRes.ok) throw new Error('No se pudo subir la imagen a almacenamiento.');

      const confirmRes = await apiFetch('/api/users/me/avatar/confirm', { method: 'POST', body: JSON.stringify({ s3Key }) });
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
      toast.success('Datos guardados.');
      onUserUpdated({ ...user, name: data.user.name, specialty: profile?.specialtyName ?? user.specialty });
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
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <button onClick={onBack} className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-charcoal-900 cursor-pointer">
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>

        <header className="mb-6 flex flex-wrap items-center gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="relative shrink-0">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name} referrerPolicy="no-referrer" className="h-20 w-20 rounded-full border border-slate-200 object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-toast-200 bg-toast-50">
                <UserIcon className="h-9 w-9 text-toast-400" />
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Cambiar foto (JPG o PNG, máx. 1MB)"
              className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-charcoal-900 text-white shadow-md hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleFileSelected} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-charcoal-900">{user.name}</h1>
            <p className="text-sm text-slate-500">{ROLE_LABELS[user.role] || user.role}</p>
          </div>
          <div className="text-right">
            {loadingProfile ? null : missingCount === 0 ? (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Perfil completo</span>
            ) : (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                {missingCount} dato{missingCount === 1 ? '' : 's'} por completar
              </span>
            )}
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Datos personales" icon={<IdCard className="h-4 w-4" />}>
            {loadingProfile ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
            ) : (
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
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
                  <div className="grid grid-cols-[6rem_1fr] gap-3">
                    <select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })} className={inputCls(false)}>
                      {DOCUMENT_TYPES.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                    <input
                      type="text" inputMode="numeric" value={form.documentId}
                      onChange={(e) => setForm({ ...form, documentId: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                      placeholder="Ej. 1024556778" className={inputCls(!form.documentId.trim())}
                    />
                  </div>
                </Field>

                {isProfessional && (
                  <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                    <Field label="Tarjeta profesional" empty={!form.professionalCard.trim()}>
                      <input value={form.professionalCard} onChange={(e) => setForm({ ...form, professionalCard: e.target.value })} className={`font-mono ${inputCls(!form.professionalCard.trim())}`} />
                    </Field>
                    <Field label="Especialidad" empty={!form.specialtyId}>
                      <select value={form.specialtyId} onChange={(e) => setForm({ ...form, specialtyId: e.target.value })} className={inputCls(!form.specialtyId)}>
                        <option value="">Sin especialidad</option>
                        {specialties.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Nivel académico" empty={!form.academicLevel}>
                      <select value={form.academicLevel} onChange={(e) => setForm({ ...form, academicLevel: e.target.value })} className={inputCls(!form.academicLevel)}>
                        <option value="">Selecciona el nivel</option>
                        {ACADEMIC_LEVEL_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </Field>
                    <Field label="Experiencia (años)" empty={form.experienceYears === ''}>
                      <input type="number" min={0} value={form.experienceYears} onChange={(e) => setForm({ ...form, experienceYears: e.target.value })} className={inputCls(form.experienceYears === '')} />
                    </Field>
                    <Field label="EPS / IPS asociada" empty={!form.epsCode} className="sm:col-span-2">
                      <div className="relative">
                        <input
                          type="text"
                          value={form.epsCode ? form.epsLabel : epsSearch.query}
                          onChange={(e) => { setForm({ ...form, epsCode: '', epsLabel: '' }); epsSearch.setQuery(e.target.value); }}
                          placeholder="Busca por nombre"
                          className={inputCls(!form.epsCode)}
                        />
                        {epsSearch.results.length > 0 && !form.epsCode && (
                          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
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
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-charcoal-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer"
                  >
                    {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
                    Guardar datos
                  </button>
                </div>
              </form>
            )}
          </Card>

          <div className="space-y-6">
            <Card title="Cuenta" icon={<ShieldCheck className="h-4 w-4" />}>
              <dl className="space-y-4 text-sm">
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Correo electrónico</dt>
                    <dd className="break-all text-charcoal-900">{user.email}</dd>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Rol</dt>
                    <dd className="text-charcoal-900">{ROLE_LABELS[user.role] || user.role}</dd>
                  </div>
                </div>
                {user.tenantId && (
                  <div className="flex items-start gap-3">
                    <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div>
                      <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Organización</dt>
                      <dd className="font-mono text-xs text-charcoal-900">{user.tenantId}</dd>
                    </div>
                  </div>
                )}
              </dl>
              <p className="mt-4 text-[11px] text-slate-400">Correo, rol y organización los administra MindPsic.</p>
            </Card>

            <Card title="Cambiar contraseña" icon={<KeyRound className="h-4 w-4" />}>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <Field label="Contraseña actual">
                  <input
                    type={showPw ? 'text' : 'password'} value={pw.currentPassword} autoComplete="current-password"
                    onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} className={inputCls(false)}
                  />
                </Field>
                <Field label="Nueva contraseña">
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'} value={pw.newPassword} autoComplete="new-password"
                      onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} className={`${inputCls(false)} pr-10`}
                    />
                    <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer" title={showPw ? 'Ocultar' : 'Mostrar'}>
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <span className="mt-1 block text-[11px] text-slate-400">Mínimo {SELF_PASSWORD_MIN_LENGTH} caracteres.</span>
                </Field>
                <Field label="Confirmar nueva contraseña">
                  <input
                    type={showPw ? 'text' : 'password'} value={pw.confirmPassword} autoComplete="new-password"
                    onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} className={inputCls(false)}
                  />
                </Field>
                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={savingPw || !pw.currentPassword || !pw.newPassword}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-charcoal-900 transition-colors hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                  >
                    {savingPw && <Loader2 className="h-4 w-4 animate-spin" />}
                    Actualizar contraseña
                  </button>
                </div>
              </form>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
