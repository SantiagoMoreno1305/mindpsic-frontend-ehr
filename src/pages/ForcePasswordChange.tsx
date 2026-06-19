/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ForcePasswordChange.tsx — Caseta de Peaje: Primer Ingreso al EHR
 * ==================================================================
 *
 * SE MUESTRA CUANDO: El usuario recién aprovisionado entra al sistema
 * con su contraseña temporal (patrón `Mind_<hex>#`) y aún no la ha cambiado.
 *
 * FLUJO:
 *  1. Firma Habeas Data / Ley 1581 — checkbox obligatorio
 *  2. Formulario de nueva contraseña (min 8 chars, confirmación)
 *  3. Llama a supabase.auth.updateUser({ password }) — Supabase Auth
 *  4. Al éxito: borra la flag `mind_must_change_pwd` de localStorage
 *     y llama a onCompleted() para liberar el acceso al portal
 *
 * IMPORTANTE: No llama al backend Node.js (congelado). El cambio de
 * contraseña es una operación nativa de Supabase Auth SDK.
 */

import { useState, FormEvent } from 'react';
import {
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  FileText,
  CheckCircle,
  AlertTriangle,
  KeyRound,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

// ─── Constantes ─────────────────────────────────────────────────────────────
const MIN_PASSWORD_LENGTH = 8;

// ─── Props ───────────────────────────────────────────────────────────────────
interface ForcePasswordChangeProps {
  /** Email del usuario recién autenticado (para mostrar contexto) */
  userEmail: string;
  /** Nombre del usuario (o fallback a email) */
  userName?: string;
  /**
   * Callback invocado cuando el usuario completa EXITOSAMENTE el flujo.
   * App.tsx usa esto para limpiar la flag y desbloquear el portal.
   */
  onCompleted: () => void;
  /**
   * Callback de logout de emergencia — si el usuario no puede completar el
   * flujo, debe poder salir de forma segura.
   */
  onLogout: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getPasswordStrength(pwd: string): {
  score: number;
  label: string;
  color: string;
} {
  let score = 0;
  if (pwd.length >= 8)  score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  if (score <= 1) return { score, label: 'Muy débil',  color: 'bg-red-500'    };
  if (score === 2) return { score, label: 'Débil',      color: 'bg-orange-400' };
  if (score === 3) return { score, label: 'Aceptable',  color: 'bg-yellow-400' };
  if (score === 4) return { score, label: 'Fuerte',     color: 'bg-green-400'  };
  return { score, label: 'Muy fuerte', color: 'bg-emerald-500' };
}

// ─── Componente Principal ─────────────────────────────────────────────────────
export default function ForcePasswordChange({
  userEmail,
  userName,
  onCompleted,
  onLogout,
}: ForcePasswordChangeProps) {

  // ── Estados del formulario ──
  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew,         setShowNew]         = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);

  // ── Consentimiento Habeas Data ──
  const [habeasAccepted,  setHabeasAccepted]  = useState(false);
  const [showHabeasText,  setShowHabeasText]  = useState(false);

  // ── Estado de envío ──
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg,  setErrorMsg]  = useState('');
  const [success,   setSuccess]   = useState(false);

  // ── Fuerza de contraseña ──
  const strength = getPasswordStrength(newPassword);

  // ── Validaciones inline ──
  const passwordsMatch  = newPassword === confirmPassword;
  const passwordLongEnough = newPassword.length >= MIN_PASSWORD_LENGTH;
  const canSubmit = habeasAccepted && passwordLongEnough && passwordsMatch && newPassword.length > 0;

  // ── Manejador de envío ──
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!habeasAccepted) {
      setErrorMsg('Debes aceptar la política de tratamiento de datos (Habeas Data, Ley 1581) para continuar.');
      return;
    }

    if (!passwordLongEnough) {
      setErrorMsg(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    if (!passwordsMatch) {
      setErrorMsg('Las contraseñas no coinciden. Verifica e intenta de nuevo.');
      return;
    }

    setIsLoading(true);

    try {
      console.log('[ForcePasswordChange] 🔑 Actualizando contraseña via Supabase Auth SDK...');

      // ── Llamada a Supabase Auth — updateUser ──
      // Esta operación requiere que el usuario tenga una sesión activa en Supabase.
      // Si el frontend usa su propio JWT (Node.js), necesita que Supabase también
      // tenga sesión activa para este usuario. El usuario puede autenticarse con
      // la contraseña temporal antes de llamar este endpoint.
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        console.error('[ForcePasswordChange] ❌ supabase.auth.updateUser error:', error.message);

        // Manejar errores específicos de Supabase
        if (error.message?.toLowerCase().includes('session')) {
          setErrorMsg(
            'Tu sesión de Supabase no está activa. Por favor cierra sesión e inicia de nuevo para completar el cambio de contraseña.'
          );
        } else if (error.message?.toLowerCase().includes('weak')) {
          setErrorMsg('La contraseña es demasiado débil. Usa al menos 8 caracteres con letras y números.');
        } else {
          setErrorMsg(`Error al actualizar contraseña: ${error.message}`);
        }
        return;
      }

      // ── Éxito ──
      console.log('[ForcePasswordChange] ✅ Contraseña actualizada exitosamente.');
      setSuccess(true);

      // Esperar 2 segundos para que el usuario vea el mensaje de éxito
      await new Promise((r) => setTimeout(r, 2000));

      // Liberar el portal — App.tsx limpiará la flag mind_must_change_pwd
      onCompleted();

    } catch (err: any) {
      console.error('[ForcePasswordChange] 💥 Error inesperado:', err);
      setErrorMsg('Ocurrió un error inesperado. Por favor intenta de nuevo o contacta a tu administrador.');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Pantalla de éxito ──
  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-6 shadow-sm animate-bounce">
          <CheckCircle className="w-8 h-8 text-emerald-500" />
        </div>
        <h2 className="text-slate-900 font-bold text-xl mb-2" style={{ fontFamily: 'Georgia, serif' }}>
          ¡Contraseña actualizada!
        </h2>
        <p className="text-slate-500 text-sm max-w-sm leading-relaxed">
          Tu acceso clínico ha sido activado. Accediendo al portal…
        </p>
      </div>
    );
  }

  // ── Formulario principal ──
  return (
    <div
      className="min-h-[92vh] flex flex-col lg:flex-row font-sans antialiased"
      style={{ backgroundColor: '#FAF6F3' }}
    >
      {/* ══════════════════════════════════════════════
          COLUMNA IZQUIERDA — Contexto de seguridad
      ══════════════════════════════════════════════ */}
      <div
        className="hidden lg:flex flex-col items-center justify-center w-[420px] xl:w-[480px] shrink-0 px-12 py-16 relative overflow-hidden"
        style={{ backgroundColor: '#1A1A1A' }}
      >
        {/* Textura sutil */}
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        <div className="relative z-10 flex flex-col items-center gap-8 w-full">
          {/* Ícono principal */}
          <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
            <KeyRound className="w-9 h-9 text-amber-400" />
          </div>

          <div className="text-center">
            <p
              className="text-white tracking-[0.2em] font-semibold uppercase"
              style={{ fontFamily: 'Georgia, serif', fontSize: '18px' }}
            >
              Primer Acceso
            </p>
            <div className="mt-2 h-px w-16 mx-auto bg-white/25" />
            <p className="mt-3 text-white/40 text-xs leading-relaxed font-sans max-w-xs">
              Tu cuenta fue aprovisionada por un administrador de {' '}
              <span className="text-amber-400/70">MindPsic</span>.
              Para proteger tu información clínica, debes establecer una contraseña personal segura.
            </p>
          </div>

          {/* Lista de reglas */}
          <div className="w-full space-y-2 mt-2">
            {[
              { ok: newPassword.length >= 8,          label: 'Mínimo 8 caracteres'            },
              { ok: /[A-Z]/.test(newPassword),         label: 'Al menos una letra mayúscula'   },
              { ok: /[0-9]/.test(newPassword),         label: 'Al menos un número'             },
              { ok: /[^A-Za-z0-9]/.test(newPassword), label: 'Al menos un carácter especial'  },
              { ok: passwordsMatch && newPassword.length > 0, label: 'Las contraseñas coinciden' },
            ].map(({ ok, label }) => (
              <div key={label} className="flex items-center gap-2.5">
                <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 transition-all ${ok ? 'bg-emerald-500' : 'bg-white/10 border border-white/20'}`}>
                  {ok && (
                    <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className={`text-[11px] font-mono transition-colors ${ok ? 'text-emerald-400' : 'text-white/30'}`}>
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Badges */}
          <div className="flex flex-col gap-2 w-full mt-2">
            {['Cumple Ley 1581 · Habeas Data', 'Cifrado TLS 1.3 / AES-256', 'Sesión protegida por Supabase Auth'].map(
              (badge) => (
                <div key={badge} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10">
                  <ShieldCheck className="w-3 h-3 text-white/30 shrink-0" />
                  <span className="text-white/30 text-[10px] font-mono tracking-wide">{badge}</span>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          COLUMNA DERECHA — Formulario
      ══════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 lg:py-16">
        <div className="w-full max-w-[440px]">

          {/* Encabezado */}
          <div className="mb-7 text-left">
            <span className="inline-block bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full border border-amber-300 mb-3">
              Configuración de Cuenta · Paso Obligatorio
            </span>
            <h1
              className="text-stone-900 font-bold mb-2"
              style={{ fontFamily: 'Georgia, serif', fontSize: '24px', lineHeight: '1.2' }}
            >
              Establece tu contraseña personal
            </h1>
            <p className="text-stone-500 text-sm leading-relaxed">
              Hola{userName ? `, ${userName.split(' ')[0]}` : ''}. Antes de acceder al portal clínico, debes
              reemplazar tu contraseña temporal y aceptar la política de datos.
            </p>
            <p className="text-stone-400 text-xs font-mono mt-1">{userEmail}</p>
          </div>

          {/* Card del formulario */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">

            {/* Banner de seguridad */}
            <div className="px-6 pt-5 pb-4 border-b border-stone-100 bg-amber-50 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-bold text-stone-800 mb-0.5">
                  Primer ingreso detectado · Acción requerida
                </p>
                <p className="text-[10px] text-stone-500 leading-relaxed">
                  Tu cuenta fue creada con una contraseña provisional. No podrás acceder al EHR hasta completar este paso.
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-6 space-y-5">

              {/* ── Nueva contraseña ── */}
              <div>
                <label htmlFor="new-password" className="block text-xs font-semibold text-stone-700 mb-1.5">
                  Nueva contraseña
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                  <input
                    id="new-password"
                    type={showNew ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full pl-10 pr-10 py-2.5 text-xs text-stone-900 font-mono bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900 focus:border-stone-900 placeholder:text-stone-300 placeholder:font-sans transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer"
                  >
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Barra de fuerza */}
                {newPassword.length > 0 && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-all ${
                            i <= strength.score ? strength.color : 'bg-stone-100'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-[10px] text-stone-400 font-mono">
                      Seguridad: <span className="font-bold text-stone-600">{strength.label}</span>
                    </p>
                  </div>
                )}
              </div>

              {/* ── Confirmar contraseña ── */}
              <div>
                <label htmlFor="confirm-password" className="block text-xs font-semibold text-stone-700 mb-1.5">
                  Confirmar contraseña
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                  <input
                    id="confirm-password"
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repite la contraseña"
                    className={`w-full pl-10 pr-10 py-2.5 text-xs text-stone-900 font-mono bg-stone-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900 focus:border-stone-900 placeholder:text-stone-300 placeholder:font-sans transition-all ${
                      confirmPassword.length > 0 && !passwordsMatch
                        ? 'border-red-300 focus:ring-red-400'
                        : 'border-stone-200'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer"
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirmPassword.length > 0 && !passwordsMatch && (
                  <p className="text-[10px] text-red-500 font-mono mt-1">Las contraseñas no coinciden</p>
                )}
                {confirmPassword.length > 0 && passwordsMatch && (
                  <p className="text-[10px] text-emerald-500 font-mono mt-1 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Las contraseñas coinciden
                  </p>
                )}
              </div>

              {/* ── Consentimiento Habeas Data / Ley 1581 ── */}
              <div className="rounded-xl border border-stone-200 overflow-hidden">
                <div className="px-4 py-3 bg-stone-50 border-b border-stone-100 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-stone-500 shrink-0" />
                  <span className="text-[11px] font-bold text-stone-700 uppercase tracking-wider">
                    Habeas Data · Ley 1581 de 2012
                  </span>
                </div>

                <div className="px-4 py-3 space-y-3">
                  {/* Texto resumido */}
                  <p className="text-[11px] text-stone-500 leading-relaxed">
                    Al utilizar el EHR Clínico de MindPsic, autorizo el tratamiento de mis datos personales y de los
                    datos de los pacientes bajo mi cuidado, conforme a la política de privacidad del sistema y la
                    normativa colombiana de protección de datos personales.
                  </p>

                  {/* Texto completo expandible */}
                  {showHabeasText && (
                    <div
                      id="habeas-data-full-text"
                      className="text-[10px] text-stone-400 leading-relaxed bg-stone-50 rounded-lg p-3 border border-stone-100 max-h-40 overflow-y-auto"
                    >
                      <p className="font-bold text-stone-600 mb-1">Autorización de Tratamiento de Datos Personales</p>
                      <p>
                        De conformidad con la <strong>Ley 1581 de 2012</strong> (Estatuto de Protección de Datos
                        Personales) y el <strong>Decreto 1377 de 2013</strong>, y como profesional de la salud o
                        miembro del equipo clínico de MindPsic, declaro que:
                      </p>
                      <br />
                      <p>
                        (i) He leído y comprendo la Política de Tratamiento de Datos Personales de MindPsic y
                        MindHealth (en adelante "el Sistema").
                      </p>
                      <p>
                        (ii) El Sistema recolecta y almacena datos personales de pacientes (nombre, documento de
                        identidad, información clínica, diagnósticos, notas de evolución) con fines exclusivos de
                        prestación de servicios de salud mental.
                      </p>
                      <p>
                        (iii) Me comprometo a respetar la confidencialidad de los datos a los que tengo acceso y a
                        no divulgarlos a terceros no autorizados.
                      </p>
                      <p>
                        (iv) Entiendo que el incumplimiento de estas obligaciones puede acarrear responsabilidad
                        civil, disciplinaria y penal conforme a la legislación colombiana vigente.
                      </p>
                      <p>
                        (v) Los titulares de datos tienen derecho a conocer, actualizar, rectificar y suprimir su
                        información personal. Solicitudes: <strong>datos@mindpsic.com</strong>
                      </p>
                      <p>
                        (vi) El responsable del tratamiento es <strong>MindPsic S.A.S.</strong>, con domicilio en
                        la República de Colombia. NIT: [Número registrado en Cámara de Comercio].
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowHabeasText(!showHabeasText)}
                    className="text-[10px] text-stone-400 hover:text-stone-600 underline cursor-pointer transition-colors"
                  >
                    {showHabeasText ? 'Ocultar texto completo' : 'Leer autorización completa'}
                  </button>

                  {/* Checkbox obligatorio */}
                  <label
                    htmlFor="habeas-data-accept"
                    className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      habeasAccepted
                        ? 'border-emerald-400 bg-emerald-50'
                        : 'border-stone-200 bg-white hover:border-stone-300'
                    }`}
                  >
                    <input
                      id="habeas-data-accept"
                      type="checkbox"
                      checked={habeasAccepted}
                      onChange={(e) => setHabeasAccepted(e.target.checked)}
                      className="mt-0.5 accent-emerald-500 cursor-pointer"
                      required
                    />
                    <span className="text-[11px] text-stone-700 leading-relaxed font-medium">
                      He leído y acepto la política de tratamiento de datos personales conforme a la Ley 1581 de 2012
                      y me comprometo a resguardar la confidencialidad de la información clínica de los pacientes.
                    </span>
                  </label>
                </div>
              </div>

              {/* ── Error ── */}
              {errorMsg && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* ── Submit ── */}
              <button
                id="btn-force-password-submit"
                type="submit"
                disabled={!canSubmit || isLoading}
                className={`
                  w-full py-3 px-4
                  bg-stone-950 hover:bg-stone-800
                  text-white text-xs font-bold tracking-wide
                  rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.3)]
                  hover:shadow-[0_2px_10px_rgba(0,0,0,0.2)]
                  transition-all duration-150 cursor-pointer
                  active:scale-[0.99]
                  disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none
                `}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Activando acceso clínico…
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-stone-300" />
                    Establecer contraseña y acceder al EHR
                  </span>
                )}
              </button>

              {/* ── Salida de emergencia ── */}
              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={onLogout}
                  className="text-[11px] text-stone-400 hover:text-stone-600 cursor-pointer transition-colors underline"
                >
                  Cerrar sesión y volver al inicio
                </button>
              </div>

            </form>
          </div>

          {/* Footer legal */}
          <p className="text-center text-[10px] text-stone-400 mt-6 leading-relaxed">
            © 2026 Ecosistema Clínico MindPsic &amp; MindHealth · Datos protegidos bajo Ley 1581
          </p>
        </div>
      </div>
    </div>
  );
}
