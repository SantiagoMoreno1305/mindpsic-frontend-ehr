/**
 * MiPlanPanel.tsx
 *
 * "Mi Plan" (decisión 2026-10-27) — vista de solo lectura de la suscripción
 * del propio tenant: licencias contratadas/usadas, quién las ocupa,
 * vencimiento, método de pago. Consume GET /api/tenants/me/subscription, que
 * SIEMPRE resuelve el tenant del caller (nunca acepta un tenantId) — este
 * panel nunca puede mostrar la suscripción de otro socio, eso sigue siendo
 * trabajo de AdminCenter (la herramienta interna de MindPsic para
 * GESTIONAR suscripciones, no solo verlas).
 *
 * Restringido a CEO/DIRECTIVO — el backend también lo exige (403 para
 * cualquier otro rol). OPERATIVO queda fuera a propósito: no es su función
 * ver precios ni método de pago del socio.
 *
 * La mayoría de los socios de hoy fueron dados de alta a mano (no vinieron
 * de una compra por el sitio público), así que no tienen un ConsumerPlan
 * vinculado — `plan` sale null y se muestra "Contratación directa con
 * MindPsic" en vez de inventar un nombre de plan.
 */
import { useEffect, useState } from 'react';
import { ShieldCheck, Users, UserCheck, Sparkles, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

interface SeatUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
}

interface SubscriptionResponse {
  tenant: { id: string; name: string; isInternal: boolean; isDemo: boolean; demoExpiresAt: string | null };
  subscription: {
    status: string;
    billingCycle: string;
    startDate: string;
    currentPeriodEnd: string;
    termMonths: number | null;
    autoRenew: boolean;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    paymentMethodLabel: string | null;
  } | null;
  plan: {
    code: string;
    name: string;
    tagline: string | null;
    priceMonthly: number;
    currency: string;
    features: string[];
  } | null;
  seats: { limit: number; used: number; users: SeatUser[] } | null;
  patients: { limit: number; used: number } | null;
}

const STATUS_INFO: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Activa', className: 'bg-emerald-100 text-emerald-700' },
  PAST_DUE: { label: 'Pago pendiente', className: 'bg-amber-100 text-amber-700' },
  SUSPENDED: { label: 'Suspendida', className: 'bg-rose-100 text-rose-700' },
  CANCELED: { label: 'Cancelada', className: 'bg-slate-200 text-slate-600' },
  EXPIRED: { label: 'Vencida', className: 'bg-rose-100 text-rose-700' },
};

const SEAT_ROLE_LABELS: Record<string, string> = {
  ESPECIALISTA_B2B: 'Psicólogo',
  OPERATIVO: 'Soporte operativo',
};

function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toLocaleString('es-CO')} ${currency}`;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
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

function ProgressBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const atLimit = used >= limit;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-600">
        <span>{used} de {limit} en uso</span>
        {atLimit && <span className="text-amber-600">Sin cupo disponible</span>}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all ${atLimit ? 'bg-amber-500' : 'bg-toast-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function MiPlanPanel() {
  const [data, setData] = useState<SubscriptionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/tenants/me/subscription');
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Error HTTP ${res.status}`);
        if (!cancelled) setData(body);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'No se pudo cargar tu plan.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="mx-auto max-w-3xl p-10 text-center text-sm text-slate-400">Cargando tu plan…</div>;
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        {error || 'No se pudo cargar tu plan.'}
      </div>
    );
  }

  if (data.tenant.isInternal) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Mi Plan</h1>
          <p className="mt-1 text-sm text-slate-500">Estado de tu suscripción con MindPsic.</p>
        </div>
        <Card title="Tenant interno" icon={<ShieldCheck className="h-4 w-4" />}>
          <p className="text-sm text-slate-600">
            {data.tenant.name} es el tenant interno de MindPsic — acceso gratuito e ilimitado, sin suscripción.
          </p>
        </Card>
      </div>
    );
  }

  if (!data.subscription) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Mi Plan</h1>
          <p className="mt-1 text-sm text-slate-500">Estado de tu suscripción con MindPsic.</p>
        </div>
        <Card title="Sin suscripción" icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}>
          <p className="text-sm text-slate-600">
            Este tenant todavía no tiene una suscripción activa. Contacta a MindPsic para activarla.
          </p>
        </Card>
      </div>
    );
  }

  const { subscription, plan, seats, patients } = data;
  const statusInfo = STATUS_INFO[subscription.status] || { label: subscription.status, className: 'bg-slate-200 text-slate-600' };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Mi Plan</h1>
        <p className="mt-1 text-sm text-slate-500">Estado de tu suscripción con MindPsic.</p>
      </div>

      {data.tenant.isDemo && data.tenant.demoExpiresAt && (() => {
        const daysLeft = Math.ceil((new Date(data.tenant.demoExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        return (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-xs font-semibold text-amber-800">
              {daysLeft <= 0
                ? 'Tu período de prueba vence hoy.'
                : `Te quedan ${daysLeft} día${daysLeft === 1 ? '' : 's'} de tu período de prueba.`}
              {' '}Contacta a MindPsic para pasarte a una cuenta real y no perder tus datos.
            </p>
          </div>
        );
      })()}

      <Card title="Resumen" icon={<ShieldCheck className="h-4 w-4" />}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {plan ? (
              <>
                <p className="text-lg font-bold text-charcoal-900">{plan.name}</p>
                {plan.tagline && <p className="text-sm text-slate-500">{plan.tagline}</p>}
              </>
            ) : (
              <p className="text-lg font-bold text-charcoal-900">Contratación directa con MindPsic</p>
            )}
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${statusInfo.className}`}>
            {statusInfo.label}
          </span>
        </div>

        {plan && (
          <p className="mt-3 text-2xl font-bold text-charcoal-900">
            {formatCurrency(plan.priceMonthly, plan.currency)}
            <span className="text-sm font-normal text-slate-400"> /mes</span>
          </p>
        )}

        {plan?.features && plan.features.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {plan.features.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-toast-400" />
                {f}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Inicio</p>
            <p className="mt-0.5 text-sm font-semibold text-charcoal-900">{formatDate(subscription.startDate)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Próximo vencimiento</p>
            <p className="mt-0.5 text-sm font-semibold text-charcoal-900">{formatDate(subscription.currentPeriodEnd)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Renovación automática</p>
            <p className="mt-0.5 text-sm font-semibold text-charcoal-900">{subscription.autoRenew ? 'Sí' : 'No'}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Método de pago</p>
            <p className="mt-0.5 text-sm font-semibold text-charcoal-900">{subscription.paymentMethodLabel || 'Pago manual'}</p>
          </div>
        </div>

        {subscription.cancelAtPeriodEnd && (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            Esta suscripción no se renovará — queda activa hasta el {formatDate(subscription.currentPeriodEnd)}.
          </p>
        )}
      </Card>

      {seats && (
        <Card title="Licencias" icon={<Users className="h-4 w-4" />}>
          <ProgressBar used={seats.used} limit={seats.limit} />
          <ul className="mt-4 divide-y divide-slate-100">
            {seats.users.map((u) => (
              <li key={u.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-charcoal-900">{u.name || u.email}</p>
                  <p className="truncate text-xs text-slate-400">{u.email}</p>
                </div>
                <span className="ml-3 shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                  {SEAT_ROLE_LABELS[u.role] || u.role}
                </span>
              </li>
            ))}
            {seats.users.length === 0 && (
              <li className="py-4 text-center text-sm text-slate-400">
                Aún no tienes especialistas ni personal operativo registrado.
              </li>
            )}
          </ul>
        </Card>
      )}

      {patients && (
        <Card title="Pacientes" icon={<UserCheck className="h-4 w-4" />}>
          <ProgressBar used={patients.used} limit={patients.limit} />
        </Card>
      )}

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center">
        <p className="text-sm font-medium text-slate-600">
          ¿Necesitas más licencias o cambiar de plan? Contacta a MindPsic.
        </p>
      </div>
    </div>
  );
}
