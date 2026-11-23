/**
 * MiPerfilPage.tsx
 *
 * Mi perfil como página propia (no modal). Cada quien completa y corrige sus
 * datos — identidad, documento, y si es profesional, tarjeta, especialidad,
 * nivel académico, experiencia y EPS — y cambia su contraseña. Correo, rol,
 * tenant y permisos por persona NO se editan desde acá (ver PATCH /api/users/me
 * en el backend, que tampoco acepta esos campos).
 *
 * Organizado en pestañas (Datos personales / Información profesional / Perfil
 * público / Cuenta y seguridad) en vez de tarjetas sueltas — con más campos
 * por rol (ficha profesional + perfil público del psicólogo). Cada pestaña
 * organiza su contenido principal junto a un panel contextual; "Perfil público"
 * muestra una vista previa de cómo lo ve el paciente en la app.
 */
import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  ArrowLeft, ArrowRight, User as UserIcon, Upload, Loader2, ShieldCheck, Building2, KeyRound,
  Eye, EyeOff, Mail, Sparkles, Briefcase, Monitor, Search, ChevronDown,
  GraduationCap, Maximize2, Minimize2, LockKeyhole,
} from 'lucide-react';
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

// Perfil público del profesional — mismos catálogos fijos que "Equipo y
// Accesos" (ver AdminPortal.tsx) para que un psicólogo que completa su
// propio perfil desde acá vea exactamente las mismas opciones que vería un
// CEO/DIRECTIVO editándolo por él.
const LANGUAGE_OPTIONS = ['Español', 'Inglés', 'Francés', 'Portugués', 'Alemán'];
const AGE_GROUP_OPTIONS = [
  'Niños (6 a 12 años)',
  'Adolescentes (13 a 17 años)',
  'Adultos (18 a 64 años)',
  'Adultos mayores (65+ años)',
];
const MODALITY_OPTIONS = ['Presencial', 'Virtual'];

interface SpecialtyOption { id: string; name: string }
interface Certification { title: string; institution: string }
interface MeProfile {
  id: string; firstName: string | null; lastName: string | null; name: string;
  email: string; phone: string | null; gender: string | null; role: string; tenantId: string;
  documentType: string | null; documentId: string | null; professionalCard: string | null;
  specialtyId: string | null; specialtyName: string | null; academicLevel: string | null;
  experienceYears: number | null; epsCode: string | null; epsLabel: string | null;
  bio: string | null; languages: string[]; ageGroups: string[]; keywords: string[];
  certifications: Certification[]; therapeuticApproach: string | null;
  firstSessionInfo: string | null; modality: string[];
}

type TabId = 'personal' | 'profesional' | 'publico' | 'cuenta';

const inputCls = (_empty: boolean) =>
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-toast-400';

function Field({ label, empty, children, className = '' }: { label: string; empty?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-600">
        {label}
        {empty && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-700">Pendiente</span>}
      </span>
      {children}
    </label>
  );
}

const initialsOf = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

const describeMissingContact = (phoneMissing: boolean, documentMissing: boolean) => {
  const fields = [phoneMissing ? 'teléfono' : null, documentMissing ? 'documento de identidad' : null].filter((field): field is string => field !== null);
  if (fields.length === 0) return '';
  return fields.length === 1 ? `Falta el ${fields[0]}.` : `Faltan ${fields.join(' y ')}.`;
};

export default function MiPerfilPage({ user, onUserUpdated, onBack }: MiPerfilPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('personal');
  const [expandedTextareas, setExpandedTextareas] = useState<Record<string, boolean>>({});
  const [languageOpen, setLanguageOpen] = useState(false);

  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [specialties, setSpecialties] = useState<SpecialtyOption[]>([]);

  const emptyForm = {
    firstName: '', lastName: '', phone: '', gender: '', documentType: 'CC', documentId: '',
    professionalCard: '', specialtyId: '', academicLevel: '', experienceYears: '',
    epsCode: '', epsLabel: '',
    bio: '', languages: [] as string[], ageGroups: [] as string[], keywords: [] as string[],
    certifications: [] as Certification[], therapeuticApproach: '', firstSessionInfo: '',
    modality: [] as string[],
  };
  const [form, setForm] = useState(emptyForm);
  const [savingProfile, setSavingProfile] = useState(false);
  const [keywordInput, setKeywordInput] = useState('');
  const epsSearch = useEpsSearch();

  const formFromProfile = (me: MeProfile) => ({
    firstName: me.firstName || '', lastName: me.lastName || '', phone: me.phone || '', gender: me.gender || '',
    documentType: me.documentType || 'CC', documentId: me.documentId || '',
    professionalCard: me.professionalCard || '', specialtyId: me.specialtyId || '',
    academicLevel: me.academicLevel || '', experienceYears: me.experienceYears?.toString() || '',
    epsCode: me.epsCode || '', epsLabel: me.epsLabel || '',
    bio: me.bio || '', languages: me.languages || [], ageGroups: me.ageGroups || [],
    keywords: me.keywords || [],
    certifications: (me.certifications || []).map((c) => ({ title: c.title, institution: c.institution || '' })),
    therapeuticApproach: me.therapeuticApproach || '', firstSessionInfo: me.firstSessionInfo || '',
    modality: me.modality || [],
  });

  const toggleEnLista = (campo: 'languages' | 'ageGroups' | 'modality', valor: string) => {
    setForm((f) => ({ ...f, [campo]: f[campo].includes(valor) ? f[campo].filter((v) => v !== valor) : [...f[campo], valor] }));
  };
  const agregarKeyword = () => {
    const limpio = keywordInput.trim();
    if (!limpio || form.keywords.includes(limpio)) { setKeywordInput(''); return; }
    setForm((f) => ({ ...f, keywords: [...f.keywords, limpio] }));
    setKeywordInput('');
  };
  const quitarKeyword = (valor: string) => setForm((f) => ({ ...f, keywords: f.keywords.filter((k) => k !== valor) }));
  const agregarCertificacion = () => setForm((f) => ({ ...f, certifications: [...f.certifications, { title: '', institution: '' }] }));
  const actualizarCertificacion = (index: number, campo: 'title' | 'institution', valor: string) =>
    setForm((f) => ({ ...f, certifications: f.certifications.map((c, i) => (i === index ? { ...c, [campo]: valor } : c)) }));
  const quitarCertificacion = (index: number) => setForm((f) => ({ ...f, certifications: f.certifications.filter((_, i) => i !== index) }));

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const handleCancelPassword = () => setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });

  useEffect(() => {
    Promise.all([
      apiFetch('/api/users/me').then((r) => (r.ok ? r.json() : null)),
      apiFetch('/api/specialties/options').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ])
      .then(([me, specs]) => {
        if (specs) setSpecialties(specs);
        if (me) {
          setProfile(me);
          setForm(formFromProfile(me));
        }
      })
      .finally(() => setLoadingProfile(false));
  }, []);

  const isProfessional = user.role === 'ESPECIALISTA_B2B' || user.role === 'OPERATIVO' || !!profile?.documentId || !!profile?.professionalCard;
  const isPublicProfile = user.role === 'ESPECIALISTA_B2B';

  // Única fuente de verdad para el conteo del header y los datos pendientes.
  const missingFields: { label: string; tab: TabId; missing: boolean }[] = [
    { label: 'Nombres', tab: 'personal', missing: !form.firstName.trim() },
    { label: 'Apellidos', tab: 'personal', missing: !form.lastName.trim() },
    { label: 'Teléfono', tab: 'personal', missing: !form.phone.trim() },
    { label: 'Documento de identidad', tab: 'personal', missing: !form.documentId.trim() },
    ...(isProfessional ? [
      { label: 'Tarjeta profesional', tab: 'profesional' as TabId, missing: !form.professionalCard.trim() },
      { label: 'Especialidad', tab: 'profesional' as TabId, missing: !form.specialtyId },
      { label: 'Nivel académico', tab: 'profesional' as TabId, missing: !form.academicLevel },
      { label: 'Experiencia', tab: 'profesional' as TabId, missing: form.experienceYears === '' },
      { label: 'EPS / IPS asociada', tab: 'profesional' as TabId, missing: !form.epsCode },
    ] : []),
  ];
  const missingCount = missingFields.filter((f) => f.missing).length;
  const firstMissingTab = missingFields.find((f) => f.missing)?.tab ?? 'personal';

  const personalMissingCount = missingFields.filter((f) => f.tab === 'personal' && f.missing).length;
  const profesionalMissingCount = missingFields.filter((f) => f.tab === 'profesional' && f.missing).length;

  const TABS: { id: TabId; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'personal', label: 'Datos personales', icon: <UserIcon className="h-4 w-4" />, badge: personalMissingCount },
    ...(isProfessional ? [{ id: 'profesional' as TabId, label: 'Información profesional', icon: <Briefcase className="h-4 w-4" />, badge: profesionalMissingCount }] : []),
    ...(isPublicProfile ? [{ id: 'publico' as TabId, label: 'Perfil público', icon: <Sparkles className="h-4 w-4" /> }] : []),
    { id: 'cuenta', label: 'Cuenta y seguridad', icon: <ShieldCheck className="h-4 w-4" /> },
  ];

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

  const handleSaveProfile = async (e?: React.FormEvent) => {
    e?.preventDefault();
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
          gender: form.gender || null,
          documentType: form.documentId.trim() ? form.documentType : null,
          documentId: form.documentId.trim() || null,
          professionalCard: form.professionalCard.trim() || null,
          specialtyId: form.specialtyId || null,
          academicLevel: form.academicLevel || null,
          experienceYears: form.experienceYears !== '' ? form.experienceYears : null,
          epsCode: form.epsCode || null,
          bio: form.bio.trim() || null,
          languages: form.languages,
          ageGroups: form.ageGroups,
          keywords: form.keywords,
          certifications: form.certifications
            .filter((c) => c.title.trim())
            .map((c) => ({ title: c.title.trim(), institution: c.institution.trim() || null })),
          therapeuticApproach: form.therapeuticApproach.trim() || null,
          firstSessionInfo: form.firstSessionInfo.trim() || null,
          modality: form.modality,
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

  const handleDiscard = () => {
    if (profile) setForm(formFromProfile(profile));
    setKeywordInput('');
    toast('Cambios descartados.', { icon: 'ℹ️' });
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

  const displayName = `${form.firstName} ${form.lastName}`.trim() || user.name;
  const roleOrSpecialty = profile?.specialtyName || ROLE_LABELS[user.role] || user.role;
  const missingContactText = describeMissingContact(!form.phone.trim(), !form.documentId.trim());

  const profileFooter = (
    <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
      <p className="text-xs text-slate-500">Guarda los cambios antes de salir.</p>
      <div className="ml-auto flex gap-3">
        <button type="button" onClick={handleDiscard} className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-charcoal-900 hover:bg-slate-50 cursor-pointer">
          Descartar
        </button>
        <button type="button" onClick={() => handleSaveProfile()} disabled={savingProfile} className="inline-flex items-center justify-center gap-2 rounded-lg bg-charcoal-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer">
          {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar cambios
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-2">
        <header className="mb-3 flex items-center gap-3">
          <button onClick={onBack} aria-label="Volver" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-charcoal-900 cursor-pointer">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-charcoal-900">Mi perfil</h1>
            <p className="mt-1 text-sm text-slate-500">Tu información y tu presentación profesional.</p>
          </div>
        </header>
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleFileSelected} />

        <div className="mb-6 flex flex-wrap items-center gap-1 border-b border-slate-200">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex cursor-pointer items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                activeTab === tab.id ? 'border-toast-500 text-charcoal-900' : 'border-transparent text-slate-500 hover:text-charcoal-900'
              }`}
            >
              {tab.icon} {tab.label}
              {!!tab.badge && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{tab.badge}</span>
              )}
            </button>
          ))}
          {!loadingProfile && (
            <div className="ml-auto flex items-center gap-3 py-2">
              {missingCount === 0 ? (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Perfil completo</span>
              ) : (
                <>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                    {missingCount} dato{missingCount === 1 ? '' : 's'} por completar
                  </span>
                  <button type="button" onClick={() => setActiveTab(firstMissingTab)} className="inline-flex items-center gap-1 text-xs font-bold text-toast-600 hover:text-toast-700 cursor-pointer">
                    Ver pendientes <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {loadingProfile ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
        ) : (
          // Un solo <div>, no <form> — "Cuenta y seguridad" guarda la
          // contraseña por separado (otro endpoint), y un <form> nativo
          // envolviendo todo dispararía el guardado del perfil con Enter en
          // cualquier campo de esa pestaña en vez de cambiar la contraseña.
          <div>
            {activeTab === 'personal' && (
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div>
                    <h3 className="text-base font-bold text-charcoal-900">Datos personales</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Mantén actualizados tus datos de identificación y contacto.</p>
                  </div>

                  <section>
                    <h4 className="mb-3 text-sm font-bold text-charcoal-900">Nombre</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Nombres" empty={!form.firstName.trim()}>
                        <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={inputCls(!form.firstName.trim())} />
                      </Field>
                      <Field label="Apellidos" empty={!form.lastName.trim()}>
                        <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={inputCls(!form.lastName.trim())} />
                      </Field>
                    </div>
                  </section>

                  <section className="border-t border-slate-100 pt-5">
                    <h4 className="mb-3 text-sm font-bold text-charcoal-900">Contacto e identificación</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Field label="Teléfono" empty={!form.phone.trim()}>
                          <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Ej. 300 123 4567" className={inputCls(!form.phone.trim())} />
                        </Field>
                        <p className="mt-1.5 text-[11px] text-slate-500">Incluye un número donde puedan contactarte.</p>
                      </div>
                      <Field label="Género">
                        <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className={inputCls(false)}>
                          <option value="">Prefiere no decir</option>
                          <option value="M">Masculino</option>
                          <option value="F">Femenino</option>
                        </select>
                      </Field>
                      <Field label="Documento de identidad" empty={!form.documentId.trim()} className="sm:col-span-2">
                        <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
                          <select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })} className={inputCls(false)}>
                            {DOCUMENT_TYPES.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                          <input type="text" inputMode="numeric" value={form.documentId}
                            onChange={(e) => setForm({ ...form, documentId: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                            placeholder="Número de documento" className={inputCls(!form.documentId.trim())}
                          />
                        </div>
                      </Field>
                    </div>
                    {missingContactText && (
                      <p className="mt-4 flex items-center gap-2 text-xs text-slate-600">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />{missingContactText}
                      </p>
                    )}
                  </section>
                  {profileFooter}
                </div>

                <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <section>
                    <h4 className="text-sm font-bold text-charcoal-900">Foto de perfil</h4>
                    <div className="mt-4 flex items-center gap-4">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt={user.name} referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded-full border border-slate-200 object-cover" />
                      ) : (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-toast-200 bg-toast-50 text-lg font-bold text-toast-600">{initialsOf(user.name)}</div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-charcoal-900">{displayName}</p>
                        <p className="truncate text-xs text-slate-500">{roleOrSpecialty}</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-charcoal-900 hover:bg-slate-50 disabled:opacity-50 cursor-pointer">
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      Cambiar foto
                    </button>
                    <p className="mt-1.5 text-[11px] text-slate-500">JPG o PNG.</p>
                  </section>
                  <section className="mt-5 border-t border-slate-100 pt-5">
                    <h4 className="text-sm font-bold text-charcoal-900">Tu información</h4>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">Usa tus datos de identificación y contacto actualizados.</p>
                  </section>
                  {profesionalMissingCount > 0 && (
                    <section className="mt-5 border-t border-slate-100 pt-5">
                      <h4 className="mb-3 text-sm font-bold text-charcoal-900">También pendiente</h4>
                      <ul className="space-y-2">
                        {missingFields.filter((f) => f.tab === 'profesional' && f.missing).map((f) => (
                          <li key={f.label}>
                            <button type="button" onClick={() => setActiveTab('profesional')} className="flex w-full items-center justify-between gap-2 text-left text-xs text-slate-600 hover:text-toast-600 cursor-pointer">
                              {f.label}<ArrowRight className="h-3.5 w-3.5 shrink-0" />
                            </button>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-[11px] text-slate-500">Información profesional.</p>
                    </section>
                  )}
                </aside>
              </div>
            )}

            {activeTab === 'profesional' && isProfessional && (
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div>
                    <h3 className="text-base font-bold text-charcoal-900">Información profesional</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Credenciales, trayectoria y vinculación.</p>
                  </div>

                  <section>
                    <h4 className="mb-3 text-sm font-bold text-charcoal-900">Credenciales y experiencia</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Tarjeta profesional" empty={!form.professionalCard.trim()}>
                        <input value={form.professionalCard} onChange={(e) => setForm({ ...form, professionalCard: e.target.value })} placeholder="Número de tarjeta" className={`font-mono ${inputCls(!form.professionalCard.trim())}`} />
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
                    </div>
                  </section>

                  <section className="border-t border-slate-100 pt-5">
                    <h4 className="mb-3 text-sm font-bold text-charcoal-900">Vinculación</h4>
                    <Field label="EPS / IPS asociada" empty={!form.epsCode}>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                        <input type="text" value={form.epsCode ? form.epsLabel : epsSearch.query}
                          onChange={(e) => { setForm({ ...form, epsCode: '', epsLabel: '' }); epsSearch.setQuery(e.target.value); }}
                          placeholder="Busca una entidad por nombre" className={`${inputCls(!form.epsCode)} pl-9 pr-9`}
                        />
                        <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
                        {epsSearch.results.length > 0 && !form.epsCode && (
                          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                            {epsSearch.results.map((eps) => (
                              <li key={eps.code}>
                                <button type="button" onClick={() => { setForm((f) => ({ ...f, epsCode: eps.code, epsLabel: eps.nombre })); epsSearch.setQuery(''); epsSearch.setResults([]); }} className="w-full cursor-pointer px-3 py-2 text-left text-xs hover:bg-toast-50">
                                  {eps.nombre}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </Field>
                  </section>

                  <section className="border-t border-slate-100 pt-5">
                    <h4 className="mb-3 text-sm font-bold text-charcoal-900">Títulos y certificaciones</h4>
                    {form.certifications.length === 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="flex items-center gap-2 text-xs text-slate-500"><GraduationCap className="h-4 w-4 text-slate-400" />Aún no has agregado títulos o cursos.</p>
                        <button type="button" onClick={agregarCertificacion} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-charcoal-900 hover:bg-slate-50 cursor-pointer">+ Agregar título o curso</button>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          {form.certifications.map((c, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                                <input type="text" value={c.title} onChange={(e) => actualizarCertificacion(i, 'title', e.target.value)} placeholder="Título (ej. Maestría en Psicología Clínica)" className={inputCls(false)} />
                                <input type="text" value={c.institution} onChange={(e) => actualizarCertificacion(i, 'institution', e.target.value)} placeholder="Institución (opcional)" className={inputCls(false)} />
                              </div>
                              <button type="button" onClick={() => quitarCertificacion(i)} aria-label="Quitar" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500 cursor-pointer">×</button>
                            </div>
                          ))}
                        </div>
                        <button type="button" onClick={agregarCertificacion} className="mt-2 text-xs font-bold text-toast-600 hover:text-toast-700 cursor-pointer">+ Agregar título o curso</button>
                      </>
                    )}
                  </section>
                  {profileFooter}
                </div>

                {(profesionalMissingCount > 0 || isPublicProfile || personalMissingCount > 0) && <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  {profesionalMissingCount > 0 && (
                    <section>
                      <h4 className="mb-3 text-sm font-bold text-charcoal-900">Por completar</h4>
                      <ul className="space-y-2">
                        {missingFields.filter((f) => f.tab === 'profesional' && f.missing).map((f) => (
                          <li key={f.label} className="flex items-center justify-between gap-2 text-xs text-slate-600">
                            <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />{f.label}</span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Completa estos datos para mantener tu ficha actualizada.</p>
                    </section>
                  )}
                  {isPublicProfile && (
                    <section className={profesionalMissingCount > 0 ? 'mt-5 border-t border-slate-100 pt-5' : ''}>
                      <h4 className="text-sm font-bold text-charcoal-900">Tu perfil público</h4>
                      <p className="mt-2 text-xs leading-relaxed text-slate-600">La especialidad y la formación se utilizan en tu presentación profesional.</p>
                      <button type="button" onClick={() => setActiveTab('publico')} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-toast-600 hover:text-toast-700 cursor-pointer">Ir al perfil público <ArrowRight className="h-3.5 w-3.5" /></button>
                    </section>
                  )}
                  {personalMissingCount > 0 && (
                    <section className={profesionalMissingCount > 0 || isPublicProfile ? 'mt-5 border-t border-slate-100 pt-5' : ''}>
                      <h4 className="mb-3 text-sm font-bold text-charcoal-900">También pendiente</h4>
                      <ul className="space-y-2">
                        {missingFields.filter((f) => f.tab === 'personal' && f.missing).map((f) => (
                          <li key={f.label}>
                            <button type="button" onClick={() => setActiveTab('personal')} className="flex w-full items-center justify-between gap-2 text-left text-xs text-slate-600 hover:text-toast-600 cursor-pointer">{f.label}<ArrowRight className="h-3.5 w-3.5 shrink-0" /></button>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-[11px] text-slate-500">Datos personales.</p>
                    </section>
                  )}
                </aside>}
              </div>
            )}

            {activeTab === 'publico' && isPublicProfile && (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div>
                    <h3 className="text-base font-bold text-charcoal-900">Perfil público</h3>
                    <p className="mt-0.5 text-xs text-slate-400">Así te conocerán los pacientes en la app.</p>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-600">Sobre mí</label>
                      <span className="text-[10.5px] text-slate-400">{form.bio.length}/1000</span>
                    </div>
                    <div className="relative">
                      <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value.slice(0, 1000) })}
                        placeholder="Cuenta brevemente tu experiencia y cómo acompañas a tus pacientes."
                        rows={expandedTextareas.bio ? 8 : 3}
                        className="w-full resize-none rounded-lg border border-slate-200 bg-white p-2.5 pb-8 text-sm outline-none focus:ring-2 focus:ring-toast-400"
                      />
                      <button type="button" onClick={() => setExpandedTextareas((current) => ({ ...current, bio: !current.bio }))} aria-label={expandedTextareas.bio ? 'Contraer Sobre mí' : 'Expandir Sobre mí'} className="absolute bottom-2 right-2 rounded p-1 text-slate-400 hover:text-toast-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-toast-400 cursor-pointer">
                        {expandedTextareas.bio ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-600">Enfoque terapéutico</label>
                      <span className="text-[10.5px] text-slate-400">{form.therapeuticApproach.length}/1000</span>
                    </div>
                    <div className="relative">
                      <textarea value={form.therapeuticApproach} onChange={(e) => setForm({ ...form, therapeuticApproach: e.target.value.slice(0, 1000) })}
                        placeholder="Describe tu forma de trabajar y el enfoque de tus sesiones."
                        rows={expandedTextareas.therapeuticApproach ? 8 : 3}
                        className="w-full resize-none rounded-lg border border-slate-200 bg-white p-2.5 pb-8 text-sm outline-none focus:ring-2 focus:ring-toast-400"
                      />
                      <button type="button" onClick={() => setExpandedTextareas((current) => ({ ...current, therapeuticApproach: !current.therapeuticApproach }))} aria-label={expandedTextareas.therapeuticApproach ? 'Contraer Enfoque terapéutico' : 'Expandir Enfoque terapéutico'} className="absolute bottom-2 right-2 rounded p-1 text-slate-400 hover:text-toast-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-toast-400 cursor-pointer">
                        {expandedTextareas.therapeuticApproach ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-600">Qué esperar en la primera sesión</label>
                      <span className="text-[10.5px] text-slate-400">{form.firstSessionInfo.length}/1000</span>
                    </div>
                    <div className="relative">
                      <textarea value={form.firstSessionInfo} onChange={(e) => setForm({ ...form, firstSessionInfo: e.target.value.slice(0, 1000) })}
                        placeholder="Explica cómo comienza la consulta y qué puede esperar el paciente."
                        rows={expandedTextareas.firstSessionInfo ? 8 : 3}
                        className="w-full resize-none rounded-lg border border-slate-200 bg-white p-2.5 pb-8 text-sm outline-none focus:ring-2 focus:ring-toast-400"
                      />
                      <button type="button" onClick={() => setExpandedTextareas((current) => ({ ...current, firstSessionInfo: !current.firstSessionInfo }))} aria-label={expandedTextareas.firstSessionInfo ? 'Contraer Primera sesión' : 'Expandir Primera sesión'} className="absolute bottom-2 right-2 rounded p-1 text-slate-400 hover:text-toast-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-toast-400 cursor-pointer">
                        {expandedTextareas.firstSessionInfo ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <h4 className="mb-3 text-sm font-bold text-charcoal-900">Atención</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-bold text-slate-600">Modalidad</label>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {MODALITY_OPTIONS.map((m) => (
                            <label key={m} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                              <input type="checkbox" checked={form.modality.includes(m)} onChange={() => toggleEnLista('modality', m)} className="h-4 w-4 rounded accent-toast-500" />
                              {m}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-bold text-slate-600">Idiomas</label>
                        <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setLanguageOpen(false); }} onKeyDown={(e) => { if (e.key === 'Escape') setLanguageOpen(false); }}>
                          <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5">
                            {form.languages.map((lang) => (
                              <span key={lang} className="inline-flex items-center gap-1 rounded-full border border-toast-100 bg-toast-50 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-toast-700">
                                {lang}
                                <button type="button" onClick={() => toggleEnLista('languages', lang)} aria-label={`Quitar ${lang}`} className="rounded-full px-0.5 hover:bg-toast-200 cursor-pointer">×</button>
                              </span>
                            ))}
                            <button type="button" aria-expanded={languageOpen} aria-controls="language-options" onClick={() => setLanguageOpen((open) => !open)} className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-toast-600 hover:text-toast-700 cursor-pointer">
                              + Agregar idioma <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {languageOpen && (
                            <ul id="language-options" className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                              {LANGUAGE_OPTIONS.filter((lang) => !form.languages.includes(lang)).map((lang) => (
                                <li key={lang}><button type="button" onClick={() => toggleEnLista('languages', lang)} className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-toast-50 cursor-pointer">{lang}</button></li>
                              ))}
                              {LANGUAGE_OPTIONS.every((lang) => form.languages.includes(lang)) && <li className="px-3 py-2 text-xs text-slate-500">Todos los idiomas están seleccionados.</li>}
                            </ul>
                          )}
                        </div>
                        <p className="mt-1.5 text-[11px] text-slate-500">Selecciona uno o varios.</p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Poblaciones que atiendes</label>
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {AGE_GROUP_OPTIONS.map((grupo) => (
                          <label key={grupo} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                            <input type="checkbox" checked={form.ageGroups.includes(grupo)} onChange={() => toggleEnLista('ageGroups', grupo)} className="h-4 w-4 rounded accent-toast-500" />
                            {grupo}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <label className="mb-1.5 block text-xs font-bold text-slate-600">Palabras clave</label>
                    <div className="mb-2 flex flex-wrap gap-2">
                      {form.keywords.map((k) => (
                        <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-toast-100 bg-toast-50 py-1 pl-3 pr-1.5 text-xs font-semibold text-toast-700">
                          #{k}
                          <button type="button" onClick={() => quitarKeyword(k)} aria-label={`Quitar ${k}`} className="flex h-4 w-4 items-center justify-center rounded-full text-toast-500 hover:bg-toast-200">
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); agregarKeyword(); } }}
                        placeholder="Ej. Ansiedad, autoestima…"
                        className="flex-1 rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus:ring-2 focus:ring-toast-400"
                      />
                      <button type="button" onClick={agregarKeyword} className="rounded-lg bg-slate-100 px-4 text-sm font-bold text-slate-600 hover:bg-slate-200">
                        Agregar
                      </button>
                    </div>
                  </div>

                  {profileFooter}
                </div>

                <aside className="space-y-5">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h4 className="mb-3 text-sm font-bold text-charcoal-900">Vista previa en la app</h4>
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-toast-200 bg-toast-50 text-sm font-bold text-toast-600">
                          {initialsOf(displayName)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-charcoal-900">{displayName}</p>
                          <p className="truncate text-xs text-slate-500">{roleOrSpecialty}</p>
                          {form.experienceYears !== '' && (
                            <p className="text-xs text-slate-400">{form.experienceYears} años de experiencia</p>
                          )}
                        </div>
                      </div>
                      {(form.modality.length > 0 || form.languages.length > 0) && (
                        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                          <Monitor className="h-3.5 w-3.5 text-slate-400" />
                          {[...form.modality, ...form.languages].join(' · ')}
                        </p>
                      )}
                      <div className="mt-3 border-t border-slate-200 pt-3">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sobre mí</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">
                          {form.bio.trim() || 'Tu presentación aparecerá aquí.'}
                        </p>
                      </div>
                      <div className="mt-3 border-t border-slate-200 pt-3">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Enfoque terapéutico</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">{form.therapeuticApproach.trim() || 'Tu enfoque terapéutico aparecerá aquí.'}</p>
                      </div>
                      <div className="mt-3 border-t border-slate-200 pt-3">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Primera sesión</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">{form.firstSessionInfo.trim() || 'La información sobre la primera sesión aparecerá aquí.'}</p>
                      </div>
                    </div>
                    <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
                      <LockKeyhole className="h-3.5 w-3.5" /> La publicación la gestiona tu organización.
                    </p>
                    <div className="mt-5 border-t border-slate-100 pt-5">
                      <button type="button" onClick={() => setActiveTab('profesional')} className="inline-flex items-center gap-1 text-xs font-bold text-toast-600 hover:text-toast-700 cursor-pointer">Gestionar títulos y certificaciones <ArrowRight className="h-3.5 w-3.5" /></button>
                      <p className="mt-1 text-[11px] text-slate-500">Información profesional.</p>
                    </div>
                  </div>
                </aside>
              </div>
            )}

            {activeTab === 'cuenta' && (
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-toast-50 text-toast-600"><KeyRound className="h-4 w-4" /></span>
                    <div>
                      <h3 className="text-base font-bold text-charcoal-900">Cambiar contraseña</h3>
                      <p className="mt-0.5 text-xs text-slate-500">Actualiza la clave con la que accedes a tu cuenta.</p>
                    </div>
                  </div>
                  <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
                    <Field label="Contraseña actual">
                      <input
                        type={showPw ? 'text' : 'password'} value={pw.currentPassword} autoComplete="current-password"
                        onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} placeholder="Ingresa tu contraseña actual" className={inputCls(false)}
                      />
                    </Field>
                    <Field label="Nueva contraseña">
                      <div className="relative">
                        <input
                          type={showPw ? 'text' : 'password'} value={pw.newPassword} autoComplete="new-password"
                          onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} placeholder="Crea una nueva contraseña" className={`${inputCls(false)} pr-10`}
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
                        onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} placeholder="Repite la nueva contraseña" className={inputCls(false)}
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
                      {(!pw.currentPassword || !pw.newPassword || !pw.confirmPassword) && <p className="text-xs text-slate-500">Completa los tres campos para continuar.</p>}
                      <div className="ml-auto flex gap-3">
                        <button type="button" onClick={handleCancelPassword} className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-charcoal-900 hover:bg-slate-50 cursor-pointer">Cancelar</button>
                        <button
                          type="button"
                          onClick={handleChangePassword}
                          disabled={savingPw || !pw.currentPassword || !pw.newPassword || !pw.confirmPassword}
                          className="inline-flex items-center justify-center gap-2 rounded-lg bg-charcoal-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer"
                        >
                          {savingPw && <Loader2 className="h-4 w-4 animate-spin" />}
                          Actualizar contraseña
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-base font-bold text-charcoal-900">Datos de la cuenta</h3>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><LockKeyhole className="h-3.5 w-3.5" />Solo lectura.</p>
                  <dl className="mt-5 divide-y divide-slate-100 border-t border-slate-100 text-sm">
                    <div className="flex items-start gap-3 py-4">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-toast-50 text-toast-600"><Mail className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <dt className="text-xs font-bold text-slate-600">Correo electrónico</dt>
                        <dd className="mt-0.5 break-all font-medium text-charcoal-900">{user.email}</dd>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 py-4">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-toast-50 text-toast-600"><ShieldCheck className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <dt className="text-xs font-bold text-slate-600">Rol</dt>
                        <dd className="mt-0.5 font-medium text-charcoal-900">{ROLE_LABELS[user.role] || user.role}</dd>
                      </div>
                    </div>
                    {user.tenantId && (
                      <div className="flex items-start gap-3 py-4">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-toast-50 text-toast-600"><Building2 className="h-4 w-4" /></span>
                        <div className="min-w-0">
                          <dt className="text-xs font-bold text-slate-600">Organización</dt>
                          <dd className="mt-0.5 break-all font-mono text-xs text-charcoal-900">{user.tenantId}</dd>
                        </div>
                      </div>
                    )}
                  </dl>
                  <p className="border-t border-slate-100 pt-4 text-[11px] text-slate-500">Correo, rol y organización los administra MindPsic.</p>
                </aside>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
