/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Navbar — Mind_coreV5
 * Director de Arte: Dual Branding Magistral
 * Logos MindPsic (oscuro) × MindHealth (crema) integrados con
 * alineación óptica, espacio negativo generoso y comportamiento responsivo.
 */

import { User } from '../types';
import ContextSwitcher, { WorkspaceContext } from './ContextSwitcher';
import { ShieldCheck, LogOut, Sparkles, User as UserIcon } from 'lucide-react';

interface NavbarProps {
  user: User | null;
  onLogout: () => void;
  onOpenDrMind: () => void;
  currentContext: WorkspaceContext;
  onContextChange: (context: WorkspaceContext) => void;
}

export default function Navbar({ user, onLogout, onOpenDrMind, currentContext, onContextChange }: NavbarProps) {
  return (
    <nav className="bg-white border-b border-stone-100 sticky top-0 z-40 shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
      <div className="max-w-7xl mx-auto px-8 py-0 flex items-stretch justify-between min-h-[72px]">

        {/* ── LEFT: DUAL BRAND LOGOS ── */}
        <div className="flex items-center gap-8 py-4">

          {/* MindPsic Logo — isotipo oscuro sobre blanco */}
          <a href="#" className="flex items-center gap-3 group shrink-0" aria-label="MindPsic — Inicio">
            {/* Isotipo SVG (brain + psi) */}
            <div className="w-9 h-9 flex items-center justify-center shrink-0">
              <img
                src="/logos/mindpsic.png"
                alt="MindPsic"
                className="w-full h-full object-contain"
                onError={(e) => {
                  /* Fallback elegante si la imagen no carga: isotipo tipográfico */
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  const sibling = e.currentTarget.nextSibling as HTMLElement;
                  if (sibling) sibling.style.display = 'flex';
                }}
              />
              {/* Fallback: Ψ tipográfico */}
              <span
                className="hidden w-9 h-9 items-center justify-center rounded-lg bg-stone-950 text-white font-serif font-black text-lg select-none"
                aria-hidden="true"
              >
                Ψ
              </span>
            </div>
            {/* Wordmark — visible solo en desktop */}
            <span className="hidden lg:block font-serif font-black text-[17px] tracking-tight text-stone-950 leading-none select-none">
              MINDPSIC
            </span>
          </a>

          {/* Divisor óptico — reduce peso visual entre logos */}
          <div className="h-7 w-px bg-stone-200 shrink-0" aria-hidden="true" />

          {/* MindHealth Logo — isotipo cálido / crema */}
          <a href="#" className="flex items-center gap-3 group shrink-0" aria-label="MindHealth — Inicio">
            <div className="w-8 h-8 flex items-center justify-center shrink-0">
              <img
                src="/logos/mindhealth.png"
                alt="MindHealth"
                className="w-full h-full object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  const sibling = e.currentTarget.nextSibling as HTMLElement;
                  if (sibling) sibling.style.display = 'flex';
                }}
              />
              {/* Fallback: brain SVG inline */}
              <span
                className="hidden w-8 h-8 items-center justify-center rounded-lg bg-[#FAF6F3] border border-[#E8DDD5] text-[#C9A99A] font-serif font-black text-sm select-none"
                aria-hidden="true"
              >
                ♥
              </span>
            </div>
            <span className="hidden lg:block font-serif font-semibold text-[15px] tracking-wide text-stone-600 leading-none select-none">
              MINDHEALTH
            </span>
          </a>

          {/* Pill "CORE" — sistema de badge arquitectura */}
          <span className="hidden xl:inline-flex items-center px-2 py-0.5 rounded-md bg-stone-100 border border-stone-200 text-[9px] font-mono font-bold tracking-widest text-stone-500 uppercase select-none">
            CORE V5
          </span>

          {/* Context Switcher — Hybrid Workspace Toggle */}
          <div className="hidden lg:block ml-8">
            <ContextSwitcher currentContext={currentContext} onContextChange={onContextChange} />
          </div>
        </div>

        {/* ── RIGHT: USER ZONE ── */}
        <div className="flex items-center gap-3 py-4">
          {user && (
            <>
              {/* Dr.Mind AI CTA */}
              <button
                onClick={onOpenDrMind}
                id="btn-navbar-drmind"
                className="
                  hidden sm:inline-flex items-center gap-2
                  px-4 py-2 rounded-xl
                  bg-stone-950 hover:bg-stone-800
                  text-white text-[11px] font-bold tracking-wide
                  transition-all duration-200 cursor-pointer
                  border border-stone-900
                  shadow-[0_1px_3px_rgba(0,0,0,0.25)]
                  hover:shadow-[0_2px_8px_rgba(0,0,0,0.20)]
                  active:scale-[0.98]
                "
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse shrink-0" />
                <span>Dr.Mind AI</span>
              </button>

              {/* Divisor */}
              <div className="h-6 w-px bg-stone-200 hidden sm:block" aria-hidden="true" />

              {/* User identity card */}
              <div className="flex items-center gap-3">
                {/* Avatar */}
                <div className="relative shrink-0">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.name}
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded-full object-cover border border-stone-200 shadow-xs"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-[#FAF6F3] border border-[#E8DDD5] flex items-center justify-center">
                      <UserIcon className="w-4 h-4 text-stone-400" />
                    </div>
                  )}
                  {/* Online dot */}
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-white" />
                </div>

                {/* Name + role — desktop only */}
                <div className="hidden md:block text-right leading-tight">
                  <p className="text-xs font-bold text-stone-900 font-sans">{user.name}</p>
                  <p className="text-[10px] text-stone-400 font-mono uppercase tracking-wider flex items-center gap-1 justify-end">
                    <ShieldCheck className="w-3 h-3 text-emerald-500 shrink-0" />
                    {user.role === 'admin' ? 'Coordinador' : 'Psicólogo Clínico'}
                  </p>
                </div>

                {/* Role badge */}
                <span
                  className={`
                    hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-widest border select-none
                    ${user.role === 'admin'
                      ? 'bg-stone-950 text-white border-stone-900'
                      : 'bg-[#FAF6F3] text-[#A07060] border-[#E8DDD5]'}
                  `}
                >
                  {user.role === 'admin' ? 'Admin' : 'Clínico'}
                </span>
              </div>

              {/* Logout */}
              <button
                onClick={onLogout}
                id="btn-navbar-logout"
                title="Cerrar sesión"
                className="
                  p-2 rounded-lg
                  text-stone-400 hover:text-stone-900 hover:bg-stone-100
                  transition-colors duration-150 cursor-pointer
                  active:scale-95
                "
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

      </div>
    </nav>
  );
}