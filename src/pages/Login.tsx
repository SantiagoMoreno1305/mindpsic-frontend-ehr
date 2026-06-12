/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Login — Mind_coreV5
 * Pantalla de autenticación real conectada al backend.
 * Fondo: #FAF6F3 (crema MindHealth). Logos reales integrados con
 * object-contain, máximas restricciones de contraste y espacio generoso.
 *
 * Endpoint: POST /auth/login
 * Base URL: REACT_APP_API_URL || http://localhost:9000
 */

import React, { useState } from 'react';
import { User } from '../types';
// NOTE: useNavigate removed — App.tsx uses state-based routing, not React Router routes.

import {
  ShieldCheck,
  Mail,
  Lock,
  Eye,
  EyeOff,
  LockKeyhole,
  FileText
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Configuración del backend
// ---------------------------------------------------------------------------
const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:9000';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface LoginProps {
  /** Callback para abrir la política de datos (conservado de la UI original) */
  onOpenDataPolicy: () => void;
  /** Callback invocado con el objeto User tras autenticación exitosa */
  onLoginSuccess?: (user: User) => void;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
export default function Login({ onOpenDataPolicy, onLoginSuccess }: LoginProps) {

  // ── Estados del formulario ──
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // ── Manejo del envío ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    // Validación básica
    if (!email || !password) {
      setErrorMessage('Por favor ingresa todos los campos solicitados.');
      return;
    }

    setIsLoading(true);

    try {
      console.log('[Login] 🚀 Iniciando petición a:', `${API_BASE_URL}/auth/login`);

      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      console.log('[Login] 📡 HTTP status recibido:', response.status);

      if (!response.ok) {
        let msg = 'Credenciales inválidas';
        try {
          const errData = await response.json();
          console.log('[Login] ❌ Error del servidor:', errData);
          msg = errData.message || msg;
        } catch {
          // Si el cuerpo no es JSON, usamos el mensaje genérico
        }
        throw new Error(msg);
      }

      const data = await response.json();
      console.log('[Login] ✅ Datos recibidos del backend:', data);

      // Verificamos que la respuesta contenga token y usuario
      if (!data.token || !data.user) {
        console.error('[Login] ⚠️ Respuesta incompleta — falta token o user:', data);
        throw new Error('Respuesta inesperada del servidor.');
      }

      // Persistencia en localStorage
      localStorage.setItem('mind_token', data.token);
      localStorage.setItem('mind_user', JSON.stringify(data.user));
      console.log('[Login] 💾 Token y usuario guardados en localStorage.');
      console.log('[Login] 👤 Rol del usuario:', data.user.role);

      // Notificamos al componente padre (App.tsx) para actualizar el estado global.
      // App.tsx usa renderizado condicional (no React Router <Routes>), así que
      // llamar a onLoginSuccess es suficiente para mostrar el portal correcto.
      if (onLoginSuccess) {
        console.log('[Login] 🎯 Llamando onLoginSuccess — el portal se renderizará según el rol.');
        onLoginSuccess(data.user as User);
      } else {
        console.warn('[Login] ⚠️ onLoginSuccess no fue provisto — revisa App.tsx.');
      }
    } catch (error: any) {
      console.error('[Login] 💥 Error en handleSubmit:', error);
      setErrorMessage(error.message || 'Error al iniciar sesión. Intenta nuevamente.');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Render ──
  return (
    /* ── PAGE SHELL: fondo crema MindHealth ── */
    <div
      className="min-h-[92vh] flex flex-col lg:flex-row font-sans antialiased"
      style={{ backgroundColor: '#FAF6F3' }}
    >
      {/* ══════════════════════════════════════════════
          COLUMNA IZQUIERDA — Brand hero (solo desktop)
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

        <div className="relative z-10 flex flex-col items-center gap-10 w-full">
          {/* Logo MindPsic */}
          <div className="flex flex-col items-center gap-5">
            <div className="w-24 h-24 flex items-center justify-center">
              <img
                src="/logos/mindpsic.png"
                alt="MindPsic"
                className="max-h-24 w-auto object-contain"
                style={{ filter: 'brightness(0) invert(1)' }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  const fb = document.getElementById('fb-mindpsic-hero');
                  if (fb) fb.style.display = 'flex';
                }}
              />
              <div
                id="fb-mindpsic-hero"
                className="hidden w-20 h-20 rounded-2xl border border-white/20 items-center justify-center"
                style={{
                  fontFamily: 'Georgia, serif',
                  fontSize: '42px',
                  color: 'white',
                  fontWeight: 900,
                }}
              >
                Ψ
              </div>
            </div>
            <div className="text-center">
              <p
                className="text-white tracking-[0.3em] font-semibold uppercase"
                style={{
                  fontFamily: 'Georgia, serif',
                  fontSize: '22px',
                  letterSpacing: '0.25em',
                }}
              >
                MINDPSIC
              </p>
              <div className="mt-2 h-px w-16 mx-auto bg-white/25" />
            </div>
          </div>

          {/* Separador */}
          <div className="flex items-center gap-5 w-full">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-white/30 text-xs font-mono tracking-widest">×</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Logo MindHealth */}
          <div className="flex flex-col items-center gap-5">
            <div className="w-20 h-20 flex items-center justify-center">
              <img
                src="/logos/mindhealth.png"
                alt="MindHealth"
                className="max-h-20 w-auto object-contain"
                style={{ filter: 'brightness(0) invert(1)' }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  const fb = document.getElementById('fb-mindhealth-hero');
                  if (fb) fb.style.display = 'flex';
                }}
              />
              <div
                id="fb-mindhealth-hero"
                className="hidden w-16 h-16 rounded-2xl border border-white/20 items-center justify-center"
                style={{ fontFamily: 'Georgia, serif', fontSize: '32px', color: 'white' }}
              >
                ♥
              </div>
            </div>
            <div className="text-center">
              <p
                className="text-white/70 tracking-[0.25em] font-light"
                style={{
                  fontFamily: 'Georgia, serif',
                  fontSize: '17px',
                  letterSpacing: '0.2em',
                }}
              >
                MINDHEALTH
              </p>
            </div>
          </div>

          {/* Tagline */}
          <div className="mt-6 text-center space-y-2 px-2">
            <p className="text-white/40 text-xs tracking-widest font-mono uppercase">
              Expediente Clínico Digital
            </p>
            <p className="text-white/25 text-[11px] leading-relaxed font-sans">
              Ecosistema integrado de salud mental · Colombia
            </p>
          </div>

          {/* Badges de certificación */}
          <div className="flex flex-col gap-2 w-full mt-4">
            {['HIPAA Telehealth Compliant', 'ISO 27001 Certified', 'Ley 1581 · Habeas Data'].map(
              (badge) => (
                <div
                  key={badge}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10"
                >
                  <ShieldCheck className="w-3 h-3 text-white/30 shrink-0" />
                  <span className="text-white/30 text-[10px] font-mono tracking-wide">
                    {badge}
                  </span>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          COLUMNA DERECHA — Formulario de acceso real
      ══════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 lg:py-16">
        {/* ── Header mobile ── */}
        <div className="flex lg:hidden items-center gap-6 mb-10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 flex items-center justify-center">
              <img
                src="/logos/mindpsic.png"
                alt="MindPsic"
                className="max-h-7 w-auto object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
            <span
              className="font-semibold text-stone-900"
              style={{ fontFamily: 'Georgia, serif', fontSize: '14px', letterSpacing: '0.1em' }}
            >
              MINDPSIC
            </span>
          </div>
          <span className="text-stone-300 text-xs font-mono">×</span>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 flex items-center justify-center">
              <img
                src="/logos/mindhealth.png"
                alt="MindHealth"
                className="max-h-6 w-auto object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
            <span
              className="font-light text-stone-600"
              style={{ fontFamily: 'Georgia, serif', fontSize: '13px', letterSpacing: '0.1em' }}
            >
              MINDHEALTH
            </span>
          </div>
        </div>

        {/* ── Card principal ── */}
        <div className="w-full max-w-[420px]">
          {/* Encabezado */}
          <div className="mb-8 text-left">
            <h1
              className="text-stone-900 font-bold mb-2"
              style={{ fontFamily: 'Georgia, serif', fontSize: '26px', lineHeight: '1.2' }}
            >
              Acceso Clínico
            </h1>
            <p className="text-stone-500 text-sm leading-relaxed">
              Portal de entrada seguro para profesionales autorizados del ecosistema.
            </p>
          </div>

          {/* Formulario */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
            {/* Banner HIPAA */}
            <div className="px-6 pt-5 pb-4 border-b border-stone-100 bg-stone-50 flex items-start gap-3">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-bold text-stone-800 mb-0.5">
                  Infraestructura segura · TLS 1.3 / AES-256
                </p>
                <p className="text-[10px] text-stone-400 leading-relaxed">
                  Encriptación de extremo a extremo certificada para registros médicos.
                </p>
              </div>
            </div>

            <div className="px-6 py-6 space-y-5">
              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-stone-700 mb-1.5">
                  Correo institucional
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nombre@mindhealth.com"
                    className="
                      w-full pl-10 pr-3 py-2.5
                      text-xs text-stone-900
                      bg-stone-50 border border-stone-200
                      rounded-xl
                      focus:outline-none focus:ring-2 focus:ring-stone-900 focus:border-stone-900
                      placeholder:text-stone-300
                      transition-all
                    "
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold text-stone-700 mb-1.5"
                >
                  Contraseña
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="
                      w-full pl-10 pr-10 py-2.5
                      text-xs text-stone-900 font-mono
                      bg-stone-50 border border-stone-200
                      rounded-xl
                      focus:outline-none focus:ring-2 focus:ring-stone-900 focus:border-stone-900
                      transition-all
                    "
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Error */}
              {errorMessage && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-stone-950 text-white text-xs">
                  <LockKeyhole className="w-4 h-4 shrink-0 mt-0.5 text-stone-400" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Política de datos */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={onOpenDataPolicy}
                  className="text-[11px] text-stone-500 hover:text-stone-800 flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <FileText className="w-3 h-3" />
                  Política de Datos
                </button>
                <span className="text-[11px] text-stone-400 font-mono">SSL Encriptado</span>
              </div>

              {/* Submit */}
              <button
                type="submit"
                onClick={handleSubmit}
                disabled={isLoading}
                className={`
                  w-full py-3 px-4
                  bg-stone-950 hover:bg-stone-800
                  text-white text-xs font-bold tracking-wide
                  rounded-xl
                  shadow-[0_1px_3px_rgba(0,0,0,0.3)]
                  hover:shadow-[0_2px_10px_rgba(0,0,0,0.2)]
                  transition-all duration-150 cursor-pointer
                  active:scale-[0.99]
                  ${isLoading ? 'opacity-60 pointer-events-none' : ''}
                `}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg
                      className="animate-spin h-4 w-4 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      />
                    </svg>
                    Iniciando sesión…
                  </span>
                ) : (
                  'Iniciar sesión en el Consorcio Clínico'
                )}
              </button>
            </div>
          </div>

          {/* Footer legal */}
          <p className="text-center text-[10px] text-stone-400 mt-8 leading-relaxed">
            © 2026 Ecosistema Clínico MindPsic &amp; MindHealth
          </p>
        </div>
      </div>
    </div>
  );
}