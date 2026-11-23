import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, CircleAlert, Info, Loader2, LockKeyhole, X } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import type { CompanyRecord } from '../hooks/useCompanies';

interface SpecialistOption { id: string; name: string; specialty?: string | null }
interface AffectedAppointment { id: string; fecha: string; horaInicio: string; horaFin: string | null }
interface ExistingPatient { id: string; recordNumber: string | null }

interface ChangePreview {
  psychologistId: string;
  psychologistName: string;
  citas: (AffectedAppointment & { resultadoPrevisto: 'pasa_al_nuevo_tratante' | 'se_anulara' | 'por_reagendar'; motivo?: string })[];
  resumen: { pasanAlNuevo: number; seAnularan: number };
}

export interface ChangePsychologistResult {
  psychologistId: string;
  psychologistName: string;
  reasignadas: number;
  anuladasPasadas: number;
  porReagendar: { id: string; date: string; timeSlot: string }[];
}

interface NewAgreementPreview {
  recordNumber: string;
  recordNumberIsPreview: true;
  companyId: string;
  companyName: string;
  agreementType: string | null;
  isConsultaExterna: boolean;
  psychologistId: string | null;
  psychologistName: string | null;
  citasPendientes: AffectedAppointment[];
}

export interface NewAgreementResult {
  newPatientId: string;
  recordNumber: string;
  companyName: string;
  psychologistName: string | null;
  appointmentsResult: { conservadas?: number; anuladas?: number };
}

export interface NewAgreementSelection {
  companyId: string;
  agreementType: string;
  proposedPsychologistId: string;
  isConsultaExterna: boolean;
}

interface HistoryContext {
  patientId: string;
  patientName: string;
  recordNumber?: string | null;
  currentCompanyName: string;
  currentPsychologistName: string;
  specialists: SpecialistOption[];
  onClose: () => void;
}

function appointmentDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/\./g, '');
}

function appointmentTime(cita: AffectedAppointment): string {
  return `${cita.horaInicio}${cita.horaFin ? `–${cita.horaFin}` : ''}`;
}

function patientHeading(name: string, recordNumber?: string | null): string {
  return `${name}${recordNumber ? ` · ${recordNumber}` : ''}`;
}

function DrawerShell({ title, subtitle, onClose, children, footer }: {
  title: string; subtitle: string; onClose: () => void; children: ReactNode; footer: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/35" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }} className="absolute inset-y-0 right-0 flex w-full max-w-[610px] flex-col bg-white shadow-2xl sm:rounded-l-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div><h3 className="text-2xl font-bold text-slate-900">{title}</h3><p className="mt-1 text-sm text-slate-600">{subtitle}</p></div>
          <button type="button" onClick={onClose} aria-label={`Cerrar ${title.toLowerCase()}`} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6 text-sm text-slate-900">{children}</div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">{footer}</div>
      </aside>
    </div>
  );
}

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600';
const cancelClass = 'rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50';
const confirmClass = 'rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-400';

export function ChangePsychologistDrawer({ patientId, patientName, recordNumber, currentCompanyName, currentPsychologistName, currentPsychologistId, channel, specialists, onClose, onComplete }: HistoryContext & {
  currentPsychologistId?: string | null;
  channel: string;
  onComplete: (result: ChangePsychologistResult) => void | Promise<void>;
}) {
  const [psychologistId, setPsychologistId] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!psychologistId) { setPreview(null); return; }
    const controller = new AbortController();
    setPreview(null);
    setPreviewLoading(true);
    apiFetch(`/api/patients/${patientId}/change-psychologist/preview`, {
      method: 'POST', body: JSON.stringify({ psychologistId }), signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo revisar el impacto del cambio.');
      return data as ChangePreview;
    }).then((data) => { if (!controller.signal.aborted) setPreview(data); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message || 'No se pudo revisar el impacto del cambio.'); })
      .finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
    return () => controller.abort();
  }, [patientId, psychologistId, previewVersion]);

  const canConfirm = !!preview && preview.psychologistId === psychologistId && reason.trim().length >= 3 && !previewLoading && !submitting;
  const confirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await apiFetch(`/api/patients/${patientId}/change-psychologist`, {
        method: 'POST', body: JSON.stringify({ psychologistId, reason: reason.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409) {
        setPreview(null);
        setError(`${data.error || 'La historia cambió durante la confirmación.'} Se está actualizando el impacto; revísalo antes de reintentar.`);
        setPreviewVersion((current) => current + 1);
        return;
      }
      if (!response.ok) { setError(data.error || 'No se pudo cambiar el tratante.'); return; }
      await onComplete(data as ChangePsychologistResult);
    } catch {
      setError('Error de red al cambiar el tratante. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  return <DrawerShell title="Cambiar de tratante" subtitle={patientHeading(patientName, recordNumber)} onClose={onClose} footer={<>
    <span className="mr-auto text-xs font-semibold text-slate-700">{preview ? `${preview.resumen.pasanAlNuevo} pasan · ${preview.resumen.seAnularan} se anularán` : 'Revisa el impacto antes de confirmar'}</span>
    <button type="button" onClick={onClose} className={cancelClass}>Cancelar</button>
    <button type="button" onClick={confirm} disabled={!canConfirm} className={confirmClass}>{submitting ? 'Confirmando…' : 'Confirmar cambio de tratante'}</button>
  </>}>
    <div className="space-y-1 border-b border-slate-200 pb-4 text-slate-600"><p>Convenio: <b className="text-slate-900">{currentCompanyName}</b> · {channel}</p><p>Tratante actual: <b className="text-slate-900">{currentPsychologistName}</b></p></div>
    <div><label htmlFor="change-psychologist" className="mb-2 block font-semibold">Nuevo tratante <span className="text-red-600">*</span></label>
      <select id="change-psychologist" value={psychologistId} onChange={(event) => { setPsychologistId(event.target.value); setPreview(null); setError(''); }} className={inputClass}>
        <option value="">Selecciona un profesional</option>
        {specialists.map((specialist) => <option key={specialist.id} value={specialist.id} disabled={specialist.id === currentPsychologistId}>{specialist.name}{specialist.id === currentPsychologistId ? ' (tratante actual)' : ''}</option>)}
      </select>
    </div>
    <div><label htmlFor="change-reason" className="mb-2 block font-semibold">Motivo del cambio <span className="text-red-600">*</span></label>
      <textarea id="change-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} rows={3} placeholder="Explica por qué se cambia el tratante" className={inputClass} />
      <p className="mt-1 text-xs text-slate-500">Entre 3 y 300 caracteres.</p>
    </div>
    <section className="border-t border-slate-200 pt-5" aria-label="Revisa el impacto">
      <h4 className="mb-4 text-lg font-bold">Revisa el impacto</h4>
      {previewLoading && <p className="flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Calculando citas afectadas…</p>}
      {!previewLoading && !preview && !error && <p className="text-slate-600">Selecciona un nuevo tratante para ver las citas afectadas.</p>}
      {preview && <>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><b className="block text-lg">{preview.resumen.pasanAlNuevo} citas</b><span className="text-xs text-slate-600">Pasan a {preview.psychologistName}</span></div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><b className="block text-lg">{preview.resumen.seAnularan} citas</b><span className="text-xs text-slate-600">Se anularán</span></div>
        </div>
        {preview.citas.length === 0 ? <p className="mt-4 text-slate-600">No hay citas afectadas.</p> : <ul className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          {preview.citas.map((cita) => {
            const label = cita.resultadoPrevisto === 'se_anulara' ? 'Se anulará' : cita.resultadoPrevisto === 'por_reagendar' ? 'Por reagendar' : 'Pasa al nuevo tratante';
            return <li key={cita.id} className="flex flex-wrap items-start gap-3 border-b border-slate-200 px-3 py-3 last:border-b-0">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
              <div className="min-w-0 flex-1"><b>{appointmentDate(cita.fecha)} · {appointmentTime(cita)}</b>{cita.motivo && <p className="text-xs text-slate-600">{cita.motivo}</p>}</div>
              <span className={`rounded-md px-2 py-1 text-xs font-semibold ${cita.resultadoPrevisto === 'se_anulara' ? 'bg-slate-200 text-slate-800' : cita.resultadoPrevisto === 'por_reagendar' ? 'bg-amber-100 text-amber-900' : 'bg-indigo-100 text-indigo-800'}`}>{label}</span>
            </li>;
          })}
        </ul>}
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><Info className="h-4 w-4 shrink-0" /> Después de confirmar podrás elegir un nuevo horario para las citas anuladas.</p>
      </>}
    </section>
    {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>}
  </DrawerShell>;
}

export function NewAgreementDrawer({ patientId, patientName, recordNumber, currentCompanyName, currentCompanyId, specialists, companies, onClose, onComplete, onOpenExisting }: HistoryContext & {
  companies: CompanyRecord[];
  currentCompanyId?: string | null;
  onComplete: (result: NewAgreementResult, selection: NewAgreementSelection) => void | Promise<void>;
  onOpenExisting?: (id: string) => void;
}) {
  const [companyId, setCompanyId] = useState('');
  const [agreementType, setAgreementType] = useState('');
  const [proposedPsychologistId, setProposedPsychologistId] = useState('');
  const [agreementTypes, setAgreementTypes] = useState<{ id: string; name: string }[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [preview, setPreview] = useState<NewAgreementPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [pendingAction, setPendingAction] = useState<'conservar' | 'anular'>('conservar');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [existingPatient, setExistingPatient] = useState<ExistingPatient | null>(null);

  useEffect(() => {
    if (!companyId) { setAgreementTypes([]); return; }
    const controller = new AbortController();
    setAgreementTypes([]);
    setTypesLoading(true);
    apiFetch(`/api/agreement-types?companyId=${encodeURIComponent(companyId)}`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error('No se pudieron cargar los tipos de convenio.'); return response.json(); })
      .then((data) => { if (!controller.signal.aborted) setAgreementTypes(Array.isArray(data) ? data : []); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message || 'No se pudieron cargar los tipos de convenio.'); })
      .finally(() => { if (!controller.signal.aborted) setTypesLoading(false); });
    return () => controller.abort();
  }, [companyId]);

  useEffect(() => {
    if (!companyId) { setPreview(null); return; }
    const controller = new AbortController();
    setPreview(null);
    setPreviewLoading(true);
    const params = new URLSearchParams({ companyId });
    if (agreementType) params.set('agreementType', agreementType);
    if (proposedPsychologistId) params.set('proposedPsychologistId', proposedPsychologistId);
    apiFetch(`/api/patients/${patientId}/new-agreement/preview?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw { message: data.error || 'No se pudo revisar la nueva historia.', existingPatient: data.existingPatient as ExistingPatient | undefined };
        return data as NewAgreementPreview;
      }).then((data) => { if (!controller.signal.aborted) { setPreview(data); setExistingPatient(null); } })
      .catch((cause) => { if (!controller.signal.aborted) { setError(cause.message || 'No se pudo revisar la nueva historia.'); setExistingPatient(cause.existingPatient || null); } })
      .finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
    return () => controller.abort();
  }, [patientId, companyId, agreementType, proposedPsychologistId, previewVersion]);

  const previewMatches = !!preview && preview.companyId === companyId && (preview.agreementType || '') === agreementType && (preview.psychologistId || '') === proposedPsychologistId;
  const canConfirm = previewMatches && !previewLoading && !submitting && (pendingAction === 'conservar' || reason.trim().length >= 3);
  const confirm = async () => {
    if (!canConfirm || !preview) return;
    setSubmitting(true);
    setError('');
    const body = {
      companyId,
      ...(agreementType ? { agreementType } : {}),
      ...(proposedPsychologistId ? { proposedPsychologistId } : {}),
      pendingAppointmentsAction: pendingAction,
      ...(pendingAction === 'anular' ? { reason: reason.trim() } : {}),
    };
    try {
      const response = await apiFetch(`/api/patients/${patientId}/new-agreement/confirm`, { method: 'POST', body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || (response.status === 409 ? 'El convenio ya tiene una historia para este paciente.' : 'No se pudo crear la nueva historia. Revisa los datos e intenta de nuevo.'));
        setExistingPatient(data.existingPatient || null);
        if (response.status === 409) { setPreview(null); setPreviewVersion((current) => current + 1); }
        return;
      }
      await onComplete(data as NewAgreementResult, { companyId, agreementType, proposedPsychologistId, isConsultaExterna: preview.isConsultaExterna });
    } catch {
      setError('Error de red al crear la historia. Comprueba si ya se creó antes de reintentar.');
    } finally {
      setSubmitting(false);
    }
  };

  const count = preview?.citasPendientes.length || 0;
  return <DrawerShell title="Nuevo convenio" subtitle={patientHeading(patientName, recordNumber)} onClose={onClose} footer={<>
    <span className="mr-auto text-xs font-semibold text-slate-700">1 historia nueva · {count} citas {pendingAction === 'anular' ? 'se anularán' : 'se conservarán'}</span>
    <button type="button" onClick={onClose} className={cancelClass}>Cancelar</button>
    <button type="button" onClick={confirm} disabled={!canConfirm} className={confirmClass}>{submitting ? 'Creando…' : 'Crear nueva historia'}</button>
  </>}>
    <div className="space-y-2"><p className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-indigo-900"><Info className="h-4 w-4 shrink-0" /> Se creará una nueva historia clínica.</p><p className="text-slate-600">Historia actual: {recordNumber || 'Sin número'} · {currentCompanyName}</p></div>
    <div><label htmlFor="new-agreement-company" className="mb-2 block font-semibold">Nuevo convenio <span className="text-red-600">*</span></label>
      <select id="new-agreement-company" value={companyId} onChange={(event) => { setCompanyId(event.target.value); setAgreementType(''); setPreview(null); setError(''); setExistingPatient(null); }} className={inputClass}>
        <option value="">Selecciona un convenio</option>
        {companies.filter((company) => company.status === 'activo' && company.id !== currentCompanyId).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select>
    </div>
    <div><label htmlFor="new-agreement-type" className="mb-2 block font-semibold">Tipo de convenio</label>
      <select id="new-agreement-type" value={agreementType} disabled={!companyId || typesLoading} onChange={(event) => { setAgreementType(event.target.value); setPreview(null); setError(''); }} className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-500`}>
        <option value="">{typesLoading ? 'Cargando tipos…' : 'No aplica'}</option>
        {agreementTypes.map((type) => <option key={type.id} value={type.name}>{type.name}</option>)}
      </select>
    </div>
    <div><label htmlFor="new-agreement-psychologist" className="mb-2 block font-semibold">Profesional propuesto para la nueva historia</label>
      <select id="new-agreement-psychologist" value={proposedPsychologistId} onChange={(event) => { setProposedPsychologistId(event.target.value); setPreview(null); setError(''); }} className={inputClass}>
        <option value="">Sin propuesta de profesional</option>
        {specialists.map((specialist) => <option key={specialist.id} value={specialist.id}>{specialist.name}</option>)}
      </select>
      <p className="mt-2 flex items-start gap-2 text-xs text-slate-600"><Info className="h-4 w-4 shrink-0" /> Revisa esta asignación antes de continuar. Es una propuesta explícita, no automática.</p>
    </div>
    <section className="border-t border-slate-200 pt-5" aria-label="Citas pendientes de la historia actual">
      <h4 className="mb-3 text-lg font-bold">Citas pendientes de la historia actual</h4>
      {previewLoading && <p className="flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Consultando citas pendientes…</p>}
      {!previewLoading && !preview && !error && <p className="text-slate-600">Selecciona el nuevo convenio para revisar las citas.</p>}
      {preview && <>
        <p className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900"><Info className="h-4 w-4" /> Hay {count} {count === 1 ? 'cita pendiente' : 'citas pendientes'}.</p>
        {count > 0 && <ul className="overflow-hidden rounded-lg border border-slate-200">{preview.citasPendientes.map((cita) => <li key={cita.id} className="flex items-center gap-3 border-b border-slate-200 px-3 py-2 last:border-b-0"><CalendarDays className="h-4 w-4 shrink-0 text-slate-600" /><b>{appointmentDate(cita.fecha)} · {appointmentTime(cita)}</b></li>)}</ul>}
        <fieldset className="mt-4 space-y-2"><legend className="mb-2 font-semibold">¿Qué deseas hacer con estas citas?</legend>
          {(['conservar', 'anular'] as const).map((action) => <label key={action} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${pendingAction === action ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}><input type="radio" name="pending-appointments-action" checked={pendingAction === action} onChange={() => { setPendingAction(action); setError(''); }} className="accent-indigo-700" />{action === 'conservar' ? 'Conservar' : 'Anular'} las {count} citas pendientes</label>)}
        </fieldset>
        {pendingAction === 'anular' && <div className="mt-4"><label htmlFor="new-agreement-reason" className="mb-2 block font-semibold">Motivo de anulación <span className="text-red-600">*</span></label><textarea id="new-agreement-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} rows={3} placeholder="Explica por qué se anularán las citas" className={inputClass} /><p className="mt-2 flex items-start gap-2 text-xs text-slate-600"><LockKeyhole className="h-4 w-4 shrink-0" /> Las citas anuladas conservarán el motivo y serán de solo lectura.</p></div>}
        <p className="mt-3 text-xs text-slate-500">Número previsto: {preview.recordNumber} · Se confirmará al crear la historia.</p>
      </>}
    </section>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p className="flex items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>{existingPatient && <p className="mt-2 pl-6">Historia existente: {existingPatient.recordNumber || existingPatient.id}{onOpenExisting && <button type="button" onClick={() => onOpenExisting(existingPatient.id)} className="ml-2 font-semibold text-indigo-800 underline">Ver historia</button>}</p>}</div>}
  </DrawerShell>;
}
