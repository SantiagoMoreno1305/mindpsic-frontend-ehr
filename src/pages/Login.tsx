/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Login — Mind_coreV5
 * Pantalla de autenticación premium con dual-branding magistral.
 * Fondo: #FAF6F3 (crema MindHealth). Logos reales integrados con
 * object-contain, máximas restricciones de contraste y espacio generoso.
 */

import React, { useState } from 'react';
import { User, UserRole } from '../types';
import { mockPsychologist, mockAdmin } from '../data/mockData';
import {
  ShieldCheck,
  Mail,
  Lock,
  Eye,
  EyeOff,
  LockKeyhole,
  FileText
} from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (user: User) => void;
  onOpenDataPolicy: () => void;
}

export default function Login({ onLoginSuccess, onOpenDataPolicy }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('psicologo');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    if (!email || !password) {
      setErrorMessage('Por favor ingresa todos los campos solicitados.');
      return;
    }
    if (role === 'psicologo') {
      if (email.toLowerCase() === mockPsychologist.email.toLowerCase() || email === 'demo') {
        onLoginSuccess(mockPsychologist);
      } else {
        setErrorMessage('Credenciales no reconocidas. Usa el acceso rápido para continuar.');
      }
    } else {
      if (email.toLowerCase() === mockAdmin.email.toLowerCase() || email === 'admin') {
        onLoginSuccess(mockAdmin);
      } else {
        setErrorMessage('Credenciales de coordinador administrativo incorrectas.');
      }
    }
  };

  const handleQuickLogin = (selectedRole: UserRole) => {
    if (selectedRole === 'psicologo') {
      onLoginSuccess(mockPsychologist);
    } else {
      onLoginSuccess(mockAdmin);
    }
  };

  return (
    /* ── PAGE SHELL: fondo crema MindHealth ── */
    <div className="min-h-[92vh] flex flex-col lg:flex-row font-sans antialiased" style={{ backgroundColor: '#FAF6F3' }}>

      {/* ══════════════════════════════════════════════
          COLUMNA IZQUIERDA — Brand hero (solo desktop)
      ══════════════════════════════════════════════ */}
      <div
        className="hidden lg:flex flex-col items-center justify-center w-[420px] xl:w-[480px] shrink-0 px-12 py-16 relative overflow-hidden"
        style={{ backgroundColor: '#1A1A1A' }}
      >
        {/* Textura sutil — puntos apenas perceptibles */}
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
            backgroundSize: '28px 28px'
          }}
        />

        {/* ── MindPsic logo — versión blanca sobre oscuro ── */}
        <div className="relative z-10 flex flex-col items-center gap-10 w-full">

          {/* Logo MindPsic */}
          <div className="flex flex-col items-center gap-5">
            <div className="w-24 h-24 flex items-center justify-center">
              <img
                src="/logos/mindpsic.png"
                alt="MindPsic"
                className="max-h-24 w-auto object-contain"
                style={{ filter: 'brightness(0) invert(1)' }} /* Fuerza versión blanca */
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  const fb = document.getElementById('fb-mindpsic-hero');
                  if (fb) fb.style.display = 'flex';
                }}
              />
              {/* Fallback isotipo elegante */}
              <div
                id="fb-mindpsic-hero"
                className="hidden w-20 h-20 rounded-2xl border border-white/20 items-center justify-center"
                style={{ fontFamily: 'Georgia, serif', fontSize: '42px', color: 'white', fontWeight: 900 }}
              >
                Ψ
              </div>
            </div>
            <div className="text-center">
              <p
                className="text-white tracking-[0.3em] font-semibold uppercase"
                style={{ fontFamily: 'Georgia, serif', fontSize: '22px', letterSpacing: '0.25em' }}
              >
                MINDPSIC
              </p>
              <div className="mt-2 h-px w-16 mx-auto bg-white/25" />
            </div>
          </div>

          {/* Separador × con peso óptico correcto */}
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
                style={{ fontFamily: 'Georgia, serif', fontSize: '17px', letterSpacing: '0.2em' }}
              >
                MINDHEALTH
              </p>
            </div>
          </div>

          {/* Tagline institucional */}
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
            {['HIPAA Telehealth Compliant', 'ISO 27001 Certified', 'Ley 1581 · Habeas Data'].map(badge => (
              <div
                key={badge}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10"
              >
                <ShieldCheck className="w-3 h-3 text-white/30 shrink-0" />
                <span className="text-white/30 text-[10px] font-mono tracking-wide">{badge}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          COLUMNA DERECHA — Formulario de acceso
      ══════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 lg:py-16">

        {/* ── Header mobile: logos compactos ── */}
        <div className="flex lg:hidden items-center gap-6 mb-10">
          {/* MindPsic mobile */}
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

          {/* MindHealth mobile */}
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

        {/* ── Card principal del formulario ── */}
        <div className="w-full max-w-[420px]">

          {/* Encabezado de sección */}
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
                <p className="text-[11px] font-bold text-stone-800 mb-0.5">Infraestructura segura · TLS 1.3 / AES-256</p>
                <p className="text-[10px] text-stone-400 leading-relaxed">
                  Encriptación de extremo a extremo certificada para registros médicos.
                </p>
              </div>
            </div>

            <div className="px-6 py-6 space-y-5">

              {/* Selector de rol */}
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">
                  Rol de acceso
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'psicologo' as UserRole, label: 'Psicólogo / Investigador' },
                    { value: 'admin' as UserRole, label: 'Administración' }
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRole(opt.value)}
                      className={`
                        py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all duration-150 cursor-pointer text-center
                        ${role === opt.value
                          ? 'bg-stone-950 text-white border-stone-950 shadow-sm'
                          : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400 hover:bg-stone-50'}
                      `}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* SSO Buttons - Microsoft & Google */}
              <div className="grid grid-cols-2 gap-3">
                {/* SSO Microsoft */}
                <button
                  type="button"
                  onClick={() => {
                    const u = role === 'psicologo' ? mockPsychologist : mockAdmin;
                    alert(`[SSO Corp Microsoft]\nIniciando autenticación para:\n${u.email}`);
                    onLoginSuccess(u);
                  }}
                  className="
                    py-3 px-3 rounded-xl
                    bg-[#2F2F2F] hover:bg-black
                    text-white text-xs font-semibold
                    flex items-center justify-center gap-2
                    border border-stone-800
                    transition-all duration-150 cursor-pointer
                    hover:shadow-md active:scale-[0.99]
                  "
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 23 23" fill="none">
                    <path d="M0 0H11V11H0V0Z" fill="#F25022"/>
                    <path d="M12 0H23V11H12V0Z" fill="#7FBA00"/>
                    <path d="M0 12H11V23H0V12Z" fill="#00A1F1"/>
                    <path d="M12 12H23V23H12V12Z" fill="#FFB900"/>
                  </svg>
                  <span>Microsoft</span>
                </button>

                {/* SSO Google */}
                <button
                  type="button"
                  onClick={() => {
                    const u = role === 'psicologo' ? mockPsychologist : mockAdmin;
                    alert(`[SSO Google]\nIniciando autenticación para:\n${u.email}`);
                    onLoginSuccess(u);
                  }}
                  className="
                    py-3 px-3 rounded-xl
                    bg-white hover:bg-stone-50
                    text-stone-700 text-xs font-semibold
                    flex items-center justify-center gap-2
                    border border-stone-200 hover:border-stone-400
                    transition-all duration-150 cursor-pointer
                    hover:shadow-md active:scale-[0.99]
                  "
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <span>Google</span>
                </button>
              </div>

              {/* Separador */}
              <div className="relative flex items-center">
                <div className="flex-1 h-px bg-stone-100" />
                <span className="mx-3 text-[10px] text-stone-400 font-mono uppercase tracking-widest">o continúa con email</span>
                <div className="flex-1 h-px bg-stone-100" />
              </div>

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
                <label htmlFor="password" className="block text-xs font-semibold text-stone-700 mb-1.5">
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
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
                className="
                  w-full py-3 px-4
                  bg-stone-950 hover:bg-stone-800
                  text-white text-xs font-bold tracking-wide
                  rounded-xl
                  shadow-[0_1px_3px_rgba(0,0,0,0.3)]
                  hover:shadow-[0_2px_10px_rgba(0,0,0,0.2)]
                  transition-all duration-150 cursor-pointer
                  active:scale-[0.99]
                "
              >
                Iniciar sesión en el Consorcio Clínico
              </button>
            </div>
          </div>

          {/* ── Acceso Rápido Demo ── */}
          <div className="mt-6">
            <p className="text-center text-[9px] font-mono uppercase tracking-widest text-stone-400 mb-3">
              Acceso Rápido · Entorno Demo
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleQuickLogin('psicologo')}
                className="
                  py-3 px-3 rounded-xl
                  bg-white border border-stone-200
                  hover:border-stone-400 hover:bg-stone-50
                  text-xs font-semibold text-stone-700
                  transition-all cursor-pointer
                  flex flex-col items-center gap-0.5
                "
              >
                <span>Acceso Clínico</span>
                <span className="text-[9px] font-normal text-stone-400">Dra. Camila Morales</span>
              </button>
              <button
                type="button"
                onClick={() => handleQuickLogin('admin')}
                className="
                  py-3 px-3 rounded-xl
                  bg-white border border-stone-200
                  hover:border-stone-400 hover:bg-stone-50
                  text-xs font-semibold text-stone-700
                  transition-all cursor-pointer
                  flex flex-col items-center gap-0.5
                "
              >
                <span>Acceso Coordinación</span>
                <span className="text-[9px] font-normal text-stone-400">Alejandro Restrepo</span>
              </button>
            </div>
          </div>

          {/* Footer legal mínimo */}
          <p className="text-center text-[10px] text-stone-400 mt-8 leading-relaxed">
            © 2026 Ecosistema Clínico MindPsic &amp; MindHealth
          </p>
        </div>
      </div>
    </div>
  );
}