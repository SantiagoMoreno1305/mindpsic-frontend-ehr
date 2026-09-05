/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Navbar — Mind_coreV5
 * Director de Arte: Dual Branding Magistral
 * Logos MindPsic (oscuro) × MindHealth (crema) integrados con
 * alineación óptica, espacio negativo generoso y comportamiento responsivo.
 */

import { useState } from 'react';
import { User } from '../types';
import ContextSwitcher, { WorkspaceContext } from './ContextSwitcher';
import UserProfileModal from './UserProfileModal';
import { ShieldCheck, LogOut, User as UserIcon, Bell, CalendarDays, X } from 'lucide-react';
import { OPEN_APPOINTMENT_EVENT } from '../lib/apiClient';

interface StaffNotification {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  read: boolean;
  data?: {
    appointmentId?: string;
    date?: string;
    timeSlot?: string;
    modality?: string;
    roomUrl?: string | null;
    patientId?: string;
    patientName?: string;
  } | null;
}

interface NavbarProps {
  user: User | null;
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
  currentContext: WorkspaceContext;
  onContextChange: (context: WorkspaceContext) => void;
  notifications: StaffNotification[];
  onMarkNotificationsRead: (ids: string[]) => void;
  onDeleteNotification: (id: string) => void;
  onDeleteAllNotifications: () => void;
}

export default function Navbar({ user, onLogout, onUserUpdated, currentContext, onContextChange, notifications, onMarkNotificationsRead, onDeleteNotification, onDeleteAllNotifications }: NavbarProps) {
  const [showProfile, setShowProfile] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Se marcan como leídas al ABRIR la campana (no al recibirlas) — mismo
  // patrón que la campana de AdminCenter (src/App.tsx): quedan atenuadas
  // (no desaparecen) mientras siguen dentro de la ventana de 7 días.
  const handleToggleNotifications = () => {
    const willOpen = !notifOpen;
    setNotifOpen(willOpen);
    if (willOpen) {
      const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
      if (unreadIds.length > 0) onMarkNotificationsRead(unreadIds);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // no debe disparar la navegación a la cita (handleNotificationClick)
    onDeleteNotification(id);
  };

  // Notificaciones de cita traen appointmentId en `data` — al hacer clic,
  // avisa (evento global, ver OPEN_APPOINTMENT_EVENT) para que quien esté
  // montado (PsychologistPortal.tsx) abra el modal de esa cita directamente,
  // en vez de dejar al usuario "perdido" con solo el texto del mensaje.
  const handleNotificationClick = (n: StaffNotification) => {
    if (!n.data?.appointmentId) return;
    window.dispatchEvent(new CustomEvent(OPEN_APPOINTMENT_EVENT, { detail: n.data }));
    setNotifOpen(false);
  };
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

          {/* Context Switcher — Hybrid Workspace Toggle. Oculto a propósito:
              aún no es funcional, se habilita meses después. No se elimina
              para no perder la integración ya hecha (currentContext/onContextChange). */}
          {false && (
            <div className="hidden lg:block ml-8">
              <ContextSwitcher currentContext={currentContext} onContextChange={onContextChange} />
            </div>
          )}
        </div>

        {/* ── RIGHT: USER ZONE ── */}
        <div className="flex items-center gap-3 py-4">
          {user && (
            <>
              {/* Campana de notificaciones — conectada a /api/notifications/recent
                  vía el poll centralizado en App.tsx (últimos 7 días, leídas y
                  no leídas; con fan-out a CEO/DIRECTIVO en el backend). */}
              <div className="relative">
                <button
                  type="button"
                  onClick={handleToggleNotifications}
                  title="Notificaciones"
                  className="relative p-2 rounded-lg text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors duration-150 cursor-pointer"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full border border-white bg-toast-500 px-1 text-[9px] font-bold leading-none text-white">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-stone-200 rounded-xl shadow-lg z-50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
                        <p className="text-xs font-bold text-stone-900">Notificaciones</p>
                        {notifications.length > 0 && (
                          <button
                            type="button"
                            onClick={onDeleteAllNotifications}
                            className="text-[10px] font-semibold text-stone-400 hover:text-rose-600 cursor-pointer"
                          >
                            Eliminar todas
                          </button>
                        )}
                      </div>
                      <div className="max-h-96 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <p className="text-xs text-stone-400 text-center py-8">No hay notificaciones nuevas.</p>
                        ) : (
                          notifications.map((n) => {
                            const isAppointment = !!n.data?.appointmentId;
                            return (
                              <div
                                key={n.id}
                                onClick={isAppointment ? () => handleNotificationClick(n) : undefined}
                                className={`group px-4 py-3 border-b border-stone-100 last:border-b-0 flex items-start gap-2 ${isAppointment ? 'cursor-pointer hover:bg-stone-50' : ''} ${n.read ? 'opacity-50' : ''}`}
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-stone-700 leading-relaxed">{n.message}</p>
                                  <div className="flex items-center justify-between mt-1">
                                    <p className="text-[10px] text-stone-400">
                                      {new Date(n.createdAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
                                    </p>
                                    {isAppointment && (
                                      <span className="flex items-center gap-1 text-[10px] font-semibold text-toast-500">
                                        <CalendarDays className="w-3 h-3" /> Ver cita
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteClick(e, n.id)}
                                  title="Eliminar"
                                  className="shrink-0 p-1 rounded text-stone-300 opacity-0 group-hover:opacity-100 hover:text-rose-600 hover:bg-rose-50 transition-opacity cursor-pointer"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* User identity card — clic abre el perfil */}
              <button
                type="button"
                onClick={() => setShowProfile(true)}
                title="Ver perfil"
                className="flex items-center gap-3 rounded-lg p-1 -m-1 transition-colors hover:bg-stone-50 cursor-pointer"
              >
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
                    {user.role === 'DIRECTIVO' ? 'Coordinador' : 'Psicólogo Clínico'}
                  </p>
                </div>

                {/* Role badge */}
                <span
                  className={`
                    hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-widest border select-none
                    ${user.role === 'DIRECTIVO'
                      ? 'bg-stone-950 text-white border-stone-900'
                      : 'bg-[#FAF6F3] text-[#A07060] border-[#E8DDD5]'}
                  `}
                >
                  {user.role === 'DIRECTIVO' ? 'Directivo' : 'Clínico'}
                </span>
              </button>

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

      {user && (
        <UserProfileModal
          isOpen={showProfile}
          onClose={() => setShowProfile(false)}
          user={user}
          onUserUpdated={onUserUpdated}
        />
      )}
    </nav>
  );
}