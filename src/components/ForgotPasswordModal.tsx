/**
 * ForgotPasswordModal.tsx
 *
 * "Olvidé mi contraseña" — flujo público sin sesión abierta, para la pantalla
 * de Login. Consume el módulo modules/auth/password-reset.* del backend:
 *   POST /api/password-reset         { email }                    → { resetId }
 *   POST /api/password-reset/verify  { resetId, code, newPassword } → { email }
 *
 * El backend responde SIEMPRE el mismo mensaje en el primer paso exista o no
 * el correo (para no dar pistas de qué cuentas son reales) — este componente
 * respeta eso: nunca distingue "correo no encontrado" de "código enviado".
 */
import { useState } from 'react';
import { Mail, KeyRound, Lock, Eye, EyeOff, ArrowLeft, CheckCircle2, X, LockKeyhole } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:9000';
const MIN_PASSWORD_LENGTH = 8;

type Step = 'email' | 'code' | 'success';

interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Se llama al terminar con éxito, para prellenar el correo en el login. */
  onSuccess?: (email: string) => void;
}

export default function ForgotPasswordModal({ isOpen, onClose, onSuccess }: ForgotPasswordModalProps) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [resetId, setResetId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  function resetAndClose() {
    setStep('email');
    setEmail('');
    setResetId(null);
    setCode('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setInfoMessage('');
    onClose();
  }

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError('');
    if (!email.trim() || !email.includes('@')) {
      setError('Escribe un correo válido.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.resetId) {
        setError(data.error || 'No pudimos procesar la solicitud. Intenta de nuevo.');
        return;
      }
      setResetId(data.resetId);
      setInfoMessage(data.message || 'Si ese correo tiene una cuenta con nosotros, te acabamos de enviar un código.');
      setCode('');
      setStep('code');
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code)) {
      setError('El código son 6 dígitos.');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/password-reset/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetId, code, newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'No pudimos verificar el código. Intenta de nuevo.');
        return;
      }
      setStep('success');
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-950/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-[420px] rounded-2xl border border-stone-200 bg-white shadow-[0_8px_40px_rgba(0,0,0,0.18)]">
        <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
          <h2
            className="text-stone-900 font-bold"
            style={{ fontFamily: 'Georgia, serif', fontSize: '18px' }}
          >
            {step === 'success' ? 'Contraseña actualizada' : 'Recuperar contraseña'}
          </h2>
          <button
            type="button"
            onClick={resetAndClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 cursor-pointer"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-6">
          {step === 'email' && (
            <form onSubmit={requestCode} className="space-y-5">
              <p className="text-xs leading-relaxed text-stone-500">
                Escribe tu correo institucional y te enviaremos un código de un solo uso para restablecer tu contraseña.
              </p>
              <div>
                <label htmlFor="fp-email" className="mb-1.5 block text-xs font-semibold text-stone-700">
                  Correo institucional
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    id="fp-email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nombre@mindhealth.com"
                    className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2.5 pl-10 pr-3 text-xs text-stone-900 outline-none transition-all focus:border-stone-900 focus:ring-2 focus:ring-stone-900"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-xl bg-stone-950 p-3 text-xs text-white">
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`w-full rounded-xl bg-stone-950 px-4 py-3 text-xs font-bold tracking-wide text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-all hover:bg-stone-800 cursor-pointer ${loading ? 'pointer-events-none opacity-60' : ''}`}
              >
                {loading ? 'Enviando...' : 'Enviar código'}
              </button>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={verifyCode} className="space-y-5">
              <p className="text-xs leading-relaxed text-stone-500">{infoMessage}</p>

              <div>
                <label htmlFor="fp-code" className="mb-1.5 block text-xs font-semibold text-stone-700">
                  Código de verificación
                </label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    id="fp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2.5 pl-10 pr-3 text-center font-mono text-lg tracking-[0.4em] text-stone-900 outline-none transition-all focus:border-stone-900 focus:ring-2 focus:ring-stone-900"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="fp-new-password" className="mb-1.5 block text-xs font-semibold text-stone-700">
                  Nueva contraseña
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    id="fp-new-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2.5 pl-10 pr-10 font-mono text-xs text-stone-900 outline-none transition-all focus:border-stone-900 focus:ring-2 focus:ring-stone-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="fp-confirm-password" className="mb-1.5 block text-xs font-semibold text-stone-700">
                  Confirmar contraseña
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    id="fp-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repite la contraseña"
                    className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2.5 pl-10 pr-3 font-mono text-xs text-stone-900 outline-none transition-all focus:border-stone-900 focus:ring-2 focus:ring-stone-900"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-xl bg-stone-950 p-3 text-xs text-white">
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`w-full rounded-xl bg-stone-950 px-4 py-3 text-xs font-bold tracking-wide text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-all hover:bg-stone-800 cursor-pointer ${loading ? 'pointer-events-none opacity-60' : ''}`}
              >
                {loading ? 'Verificando...' : 'Cambiar contraseña'}
              </button>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => { setStep('email'); setError(''); }}
                  className="inline-flex items-center gap-1 text-[11px] text-stone-500 transition-colors hover:text-stone-800 cursor-pointer"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Cambiar correo
                </button>
                <button
                  type="button"
                  onClick={() => requestCode()}
                  disabled={loading}
                  className="text-[11px] text-stone-500 underline transition-colors hover:text-stone-800 cursor-pointer disabled:opacity-50"
                >
                  Reenviar código
                </button>
              </div>
            </form>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              </div>
              <p className="text-xs leading-relaxed text-stone-500">
                Tu contraseña se actualizó correctamente. Ya puedes iniciar sesión con tu nueva contraseña.
              </p>
              <button
                type="button"
                onClick={() => {
                  onSuccess?.(email.trim());
                  resetAndClose();
                }}
                className="w-full rounded-xl bg-stone-950 px-4 py-3 text-xs font-bold tracking-wide text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-all hover:bg-stone-800 cursor-pointer"
              >
                Volver a iniciar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
