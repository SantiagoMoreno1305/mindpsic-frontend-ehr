/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { User, Patient, resolveRole } from './types';
import { WorkspaceContext } from './components/ContextSwitcher';
import Login from './pages/Login';
import PsychologistPortal from './pages/PsychologistPortal';
import AdminPortal from './pages/AdminPortal';
import ForcePasswordChange from './pages/ForcePasswordChange';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import DrMindChat from './components/DrMindChat';
import { Bot, ShieldAlert, AlertTriangle } from 'lucide-react';
import { FORBIDDEN_ACCESS_EVENT } from './lib/apiClient';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Workspace Context State — Hybrid Clinical + Research
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContext>('clinical');

  // AI Assistant Drawer management
  const [isDrMindOpen, setIsDrMindOpen] = useState(false);
  const [drMindContextPatient, setDrMindContextPatient] = useState<Patient | null>(null);

  // ============================================================================
  // INTERCEPTOR GLOBAL 403 — Tenant suspendido
  //
  // apiClient.ts despacha CustomEvent('forbidden-access') cuando el backend
  // responde 403 Forbidden (p.ej. tenant suspendido por falta de pago).
  // Aquí lo capturamos, limpiamos la sesión y mostramos el banner amigable.
  // ============================================================================
  const [isSuspended, setIsSuspended] = useState(false);

  // ============================================================================
  // CASETA DE PEAJE — Primer ingreso con contraseña temporal
  //
  // Cuando un usuario es aprovisionado por un DIRECTIVO/CEO, recibe una
  // contraseña temporal (patrón Mind_<hex>#). Login.tsx detecta esto y
  // escribe la flag 'mind_must_change_pwd' = 'true' en localStorage.
  //
  // renderPortal() comprueba esta flag ANTES del switch de roles y renderiza
  // ForcePasswordChange en lugar del portal clínico hasta que el usuario
  // completa el flujo (nueva contraseña + Habeas Data).
  // ============================================================================
  const [mustChangePassword, setMustChangePassword] = useState(
    () => localStorage.getItem('mind_must_change_pwd') === 'true'
  );

  // ============================================================================
  // SESSION SYNC — Fuente única de verdad: Prisma (no el JWT)
  //
  // Al montar la app:
  //  1. Restauramos el usuario desde localStorage para evitar pantalla de Login en refresh.
  //  2. Llamamos a GET /auth/sync con el mind_token para obtener el role y tenantId
  //     canónicos desde Prisma, ignorando cualquier valor desactualizado en el JWT.
  // ============================================================================
  useEffect(() => {
    const token = localStorage.getItem('mind_token');
    const userStr = localStorage.getItem('mind_user');

    // Paso 1: Restaurar usuario desde localStorage (evita parpadeo hacia Login)
    if (token && userStr) {
      try {
        const storedUser: User = JSON.parse(userStr);
        const canonicalRole = resolveRole(storedUser.role);
        setCurrentUser({ ...storedUser, role: canonicalRole });

        // Paso 2: Sincronizar con Prisma para obtener el rol canónico real
        const apiBase = (import.meta.env.VITE_API_URL as string) || 'http://localhost:9000';
        fetch(`${apiBase}/auth/sync`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        })
          .then(async (res) => {
            if (!res.ok) {
              // Token expirado o inválido → forzar logout
              if (res.status === 401 || res.status === 403) {
                console.warn('[App][sync] Token inválido detectado → cerrando sesión.');
                handleLogout();
              } else {
                console.warn('[App][sync] /auth/sync respondió', res.status, '— usando datos locales.');
              }
              return;
            }

            const syncData = await res.json();
            console.log('[App][sync] ✅ Datos canónicos de Prisma recibidos:', syncData);

            // Actualizamos el estado global con role y tenantId canónicos de Prisma.
            // IMPORTANTE: ignoramos el rol que pudiera venir en el JWT local.
            setCurrentUser((prev) => {
              if (!prev) return prev;
              const updatedUser: User = {
                ...prev,
                role: resolveRole(syncData.role),     // Fuente de verdad: Prisma
                tenantId: syncData.tenantId ?? prev.tenantId, // Fuente de verdad: Prisma
              };
              // Persistir el usuario actualizado en localStorage
              localStorage.setItem('mind_user', JSON.stringify(updatedUser));
              console.log('[App][sync] Estado global actualizado con datos de Prisma:', updatedUser.role, updatedUser.tenantId);
              return updatedUser;
            });
          })
          .catch((err) => {
            // No crítico — se usa el usuario local. El backend podría no estar disponible.
            console.warn('[App][sync] /auth/sync no disponible (red/backend). Usando datos locales.', err.message);
          });
      } catch {
        // Datos corruptos en localStorage → limpiar
        localStorage.removeItem('mind_token');
        localStorage.removeItem('mind_user');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoginSuccess = (rawUser: User) => {
    // Normalize the role to a canonical RBAC level before storing.
    // This bridges legacy JWT tokens ('psicologo', 'admin', 'director')
    // with the new 5-level system without requiring a forced re-login.
    const canonicalRole = resolveRole(rawUser.role);
    const user: User = { ...rawUser, role: canonicalRole };

    console.log('[App] ✅ handleLoginSuccess — rol raw:', rawUser.role, '→ canónico:', canonicalRole);
    setCurrentUser(user);

    // Auto-open Dr.Mind for clinicians on first login
    if (canonicalRole === 'ESPECIALISTA_B2B') {
      setIsDrMindOpen(true);
    }
  };

  const handleLogout = () => {
    console.log('[App] 🚪 Cerrando sesión — limpiando estado y localStorage.');
    localStorage.removeItem('mind_token');
    localStorage.removeItem('mind_user');
    localStorage.removeItem('mind_must_change_pwd');
    setCurrentUser(null);
    setIsDrMindOpen(false);
    setDrMindContextPatient(null);
    setIsSuspended(false);
    setMustChangePassword(false);
  };

  // ── Listener: forbidden-access (403) ──────────────────────────────────────
  useEffect(() => {
    const handleForbiddenAccess = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      console.warn('[App] 🔒 forbidden-access recibido — suspendiendo sesión.', detail);
      // Limpiar sesión pero mantener isSuspended=true para mostrar el banner
      localStorage.removeItem('mind_token');
      localStorage.removeItem('mind_user');
      setCurrentUser(null);
      setIsDrMindOpen(false);
      setDrMindContextPatient(null);
      setIsSuspended(true);
    };

    window.addEventListener(FORBIDDEN_ACCESS_EVENT, handleForbiddenAccess);
    return () => window.removeEventListener(FORBIDDEN_ACCESS_EVENT, handleForbiddenAccess);
  }, []);

  const handleOpenDrMindWithPatient = (patient: Patient) => {
    setDrMindContextPatient(patient);
    setIsDrMindOpen(true);
  };

  // ============================================================================
  // RBAC ROUTER — 5 niveles canónicos (Grupo Mind)
  //
  //  CEO            → AdminPortal  — acceso total al holding, bypass de tenantId
  //  DIRECTIVO      → AdminPortal  — métricas y auditoría de dominio asignado
  //  ESPECIALISTA_B2B → PsychologistPortal — espacio clínico / investigación
  //  OPERATIVO      → AdminPortal  — agenda y datos demográficos (sin clínico)
  //  USUARIO_B2C    → Pantalla bloqueada — pacientes usan portal externo
  // ============================================================================
  const renderPortal = () => {
    // ── Banner: Tenant suspendido (403 Forbidden recibido del backend) ────────
    if (isSuspended) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mb-6 shadow-sm">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
          </div>
          <span className="bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border border-amber-300 mb-4">
            Acceso Restringido
          </span>
          <h2
            className="text-slate-900 font-bold text-xl mb-2"
            style={{ fontFamily: 'Georgia, serif' }}
          >
            Organización temporalmente suspendida
          </h2>
          <p className="text-slate-500 text-sm max-w-sm leading-relaxed mb-8">
            El acceso para su organización se encuentra temporalmente suspendido.
            Contacte a su administrador.
          </p>
          <button
            onClick={() => setIsSuspended(false)}
            className="px-5 py-2.5 bg-slate-950 text-white text-xs font-bold rounded-xl hover:bg-slate-800 transition-all cursor-pointer"
          >
            Volver al inicio de sesión
          </button>
        </div>
      );
    }

    if (!currentUser) {
      return (
        <Login
          onLoginSuccess={(user, isTempPassword) => {
            handleLoginSuccess(user);
            if (isTempPassword) {
              localStorage.setItem('mind_must_change_pwd', 'true');
              setMustChangePassword(true);
            }
          }}
          onOpenDataPolicy={() => {
            const btn = document.getElementById('btn-footer-data-policy');
            if (btn) btn.click();
          }}
        />
      );
    }

    // ── Guardia: Primer ingreso — forzar cambio de contraseña ────────────────
    // Colocado DESPUÉS de verificar currentUser, ANTES del switch de roles.
    // Ningún rol puede saltarse este gate mientras la flag esté activa.
    if (mustChangePassword) {
      return (
        <ForcePasswordChange
          userEmail={currentUser.email ?? ''}
          userName={currentUser.name ?? ''}
          onCompleted={() => {
            console.log('[App] ✅ Primer ingreso completado — desbloqueando portal.');
            localStorage.removeItem('mind_must_change_pwd');
            setMustChangePassword(false);
          }}
          onLogout={handleLogout}
        />
      );
    }

    switch (currentUser.role) {

      // ── Nivel 1 ─────────────────────────────────────────────────────────────
      case 'CEO':
        return <AdminPortal />;

      // ── Nivel 2 ─────────────────────────────────────────────────────────────
      case 'DIRECTIVO':
        return <AdminPortal />;

      // ── Nivel 3 ─────────────────────────────────────────────────────────────
      case 'ESPECIALISTA_B2B':
        return (
          <PsychologistPortal
            onOpenDrMindWithPatient={handleOpenDrMindWithPatient}
            workspaceContext={workspaceContext}
            onContextChange={setWorkspaceContext}
          />
        );

      // ── Nivel 4 ─────────────────────────────────────────────────────────────
      case 'OPERATIVO':
        return <AdminPortal />;

      // ── Nivel 5: acceso DENEGADO al EHR interno ─────────────────────────────
      case 'USUARIO_B2C':
        return (
          <div className="flex flex-col items-center justify-center min-h-[80vh] px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center mb-6">
              <ShieldAlert className="w-8 h-8 text-stone-400" />
            </div>
            <h2
              className="text-stone-900 font-bold text-xl mb-2"
              style={{ fontFamily: 'Georgia, serif' }}
            >
              Acceso no disponible en este portal
            </h2>
            <p className="text-stone-500 text-sm max-w-sm leading-relaxed mb-6">
              Este es el entorno clínico interno de MindPsic. Como paciente o
              cliente, tu espacio de acceso es el portal de{' '}
              <strong>MindHealth</strong> o <strong>MyBuy</strong>.
            </p>
            <button
              onClick={handleLogout}
              className="px-5 py-2.5 bg-stone-950 text-white text-xs font-bold rounded-xl hover:bg-stone-800 transition-all cursor-pointer"
            >
              Cerrar sesión
            </button>
          </div>
        );

      // ── Fallback defensivo (rol desconocido → mínimo privilegio) ────────────
      default:
        console.warn('[App] ⚠️ Rol no reconocido — cerrando sesión:', currentUser.role);
        handleLogout();
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-800 antialiased selection:bg-toast-200 selection:text-charcoal-900">

      {/* 1. SECURE NAVBAR HEADER */}
      <Navbar
        user={currentUser}
        onLogout={handleLogout}
        onOpenDrMind={() => setIsDrMindOpen(true)}
        currentContext={workspaceContext}
        onContextChange={setWorkspaceContext}
      />

      {/* 2. RBAC ROLE GUARD ROUTER */}
      <div className="flex-1 relative">
        {renderPortal()}
      </div>

      {/* 3. DR.MIND BUBBLE — oculto para USUARIO_B2C */}
      {currentUser && currentUser.role !== 'USUARIO_B2C' && !isDrMindOpen && (
        <button
          onClick={() => setIsDrMindOpen(true)}
          id="btn-floating-drmind-bubble"
          className="fixed bottom-6 right-6 z-40 bg-gradient-to-r from-charcoal-900 to-charcoal-800 text-white p-4 rounded-2xl shadow-xl hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer flex items-center space-x-2 border border-toast-300 group font-semibold"
          title="Abrir Asistente Dr.Mind AI"
        >
          <div className="relative">
            <Bot className="w-5 h-5 text-toast-200 group-hover:animate-bounce" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-toast-400 animate-ping" />
          </div>
          <span className="text-xs tracking-wide">Dr.Mind AI</span>
        </button>
      )}

      {/* 4. DR.MIND CHAT DRAWER */}
      <DrMindChat
        isOpen={isDrMindOpen}
        onClose={() => setIsDrMindOpen(false)}
        selectedPatient={drMindContextPatient}
      />

      {/* 5. FOOTER */}
      <Footer />

    </div>
  );
}
