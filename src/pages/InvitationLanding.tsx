/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pantalla PÚBLICA de invitación a la app móvil — /invitacion/:code
 *
 * Misma superficie y mismo modelo de confianza que /firmar/ y /evaluacion/:
 * el paciente no tiene cuenta en esta plataforma y el código opaco de la URL
 * es la única credencial de entrada. Comparte dominio y marca por
 * conveniencia, igual que las otras dos.
 *
 * La diferencia con ellas: aquí la página no es el destino, es un puente. El
 * flujo termina dentro de la app, no en el navegador. Por eso lo primero que
 * intenta es abrirla, y todo lo demás son salidas para cuando eso no ocurre.
 *
 * El código se muestra siempre. Un enlace profundo falla en demasiadas
 * situaciones —app no instalada, navegador embebido del correo, escritorio—
 * como para ser el único camino.
 */

import { useEffect, useState } from 'react';
import { Smartphone, Loader2, AlertTriangle, Copy, Check, ShieldCheck } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:9000';

/** Esquema declarado en app.json de la app móvil. */
const APP_SCHEME = 'mindhealth';

/**
 * Enlaces de tienda. Vacíos mientras la app no esté publicada: un botón que
 * lleva a una página inexistente es peor que no ofrecerlo.
 */
const STORE_LINKS: { ios: string | null; android: string | null } = {
  ios: null,
  android: null,
};

interface InvitationContext {
  firstName: string;
  invitedBy: string | null;
  expiresAt: string;
}

type ViewState = 'loading' | 'error' | 'ready';

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'Este enlace no es válido. Verifica que lo copiaste completo, o pídele a tu especialista uno nuevo.',
  EXPIRED: 'Este enlace venció. Pídele a tu especialista que te envíe uno nuevo.',
  REVOKED: 'Este enlace ya no está activo — seguramente se generó uno más reciente. Revisa tu correo más nuevo.',
  ALREADY_REDEEMED: 'Esta invitación ya se usó. Si la cuenta es tuya, abre la app e inicia sesión.',
  LOCKED: 'Demasiados intentos. Espera unos minutos antes de volver a probar.',
};

function getCodeFromPath(): string {
  const marker = '/invitacion/';
  const path = window.location.pathname;
  const i = path.indexOf(marker);
  return i === -1 ? '' : path.slice(i + marker.length).split('/')[0];
}

export default function InvitationLanding() {
  const code = getCodeFromPath();

  const [state, setState] = useState<ViewState>('loading');
  const [context, setContext] = useState<InvitationContext | null>(null);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;

    if (!code) {
      setError(ERROR_MESSAGES.NOT_FOUND);
      setState('error');
      return;
    }

    fetch(`${API_BASE}/api/invitations/${encodeURIComponent(code)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setError(ERROR_MESSAGES[data?.code] || 'No pudimos abrir esta invitación.');
          setState('error');
          return;
        }
        setContext(data);
        setState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setError('No pudimos conectar. Revisa tu conexión e intenta de nuevo.');
        setState('error');
      });

    return () => {
      alive = false;
    };
  }, [code]);

  const openApp = () => {
    // Si la app está instalada, el sistema la abre y esta página queda atrás.
    // Si no, no pasa nada visible — por eso el código sigue a la vista.
    window.location.href = `${APP_SCHEME}://invitacion/${code}`;
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Sin portapapeles el código sigue seleccionable a mano. */
    }
  };

  if (state === 'loading') {
    return (
      <Shell>
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        <p className="text-sm text-slate-500">Comprobando tu invitación…</p>
      </Shell>
    );
  }

  if (state === 'error') {
    return (
      <Shell>
        <div className="rounded-full bg-amber-50 p-3 text-amber-600">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-bold text-slate-900">No pudimos abrir la invitación</h1>
        <p className="max-w-sm text-center text-sm text-slate-500">{error}</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="rounded-2xl bg-toast-100 p-4 text-toast-500">
        <Smartphone className="h-7 w-7" />
      </div>

      <div className="space-y-1 text-center">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Hola, {context?.firstName}
        </h1>
        <p className="max-w-sm text-sm text-slate-500">
          {context?.invitedBy
            ? `${context.invitedBy} te invitó a acompañar tu proceso desde la app de MindHealth.`
            : 'Te invitaron a acompañar tu proceso desde la app de MindHealth.'}
        </p>
      </div>

      <button
        onClick={openApp}
        className="w-full max-w-sm rounded-xl bg-toast-500 px-4 py-3 text-sm font-bold text-white hover:opacity-90"
      >
        Abrir la app
      </button>

      {/* El código, siempre visible: el enlace profundo falla en demasiadas
          situaciones como para ser el único camino. */}
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-xs text-slate-500">
          ¿No se abrió? Entra a la app, toca <strong>«Mi especialista me invitó»</strong> y escribe
          este código:
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 font-mono text-[11px] text-slate-700">
            {code}
          </code>
          <button
            onClick={copy}
            title="Copiar"
            className="shrink-0 rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {(STORE_LINKS.ios || STORE_LINKS.android) && (
        <div className="flex gap-2">
          {STORE_LINKS.ios && (
            <a
              href={STORE_LINKS.ios}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              App Store
            </a>
          )}
          {STORE_LINKS.android && (
            <a
              href={STORE_LINKS.android}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              Google Play
            </a>
          )}
        </div>
      )}

      <div className="flex max-w-sm items-start gap-2 text-xs text-slate-400">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Al activar tu cuenta te pediremos tu número de documento. Este enlace prueba que el
          correo llegó, no que seas tú — es lo que evita que otra persona acceda a tu historia
          clínica.
        </span>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 py-12 text-slate-800 antialiased">
      {children}
    </div>
  );
}
