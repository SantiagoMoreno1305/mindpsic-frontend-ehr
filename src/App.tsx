/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { User, Patient, resolveRole } from './types';
import { WorkspaceContext } from './components/ContextSwitcher';
import Login from './pages/Login';
import PsychologistPortal from './pages/PsychologistPortal';
import AdminPortal from './pages/AdminPortal';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import DrMindChat from './components/DrMindChat';
import { Bot, ShieldAlert } from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Workspace Context State — Hybrid Clinical + Research
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContext>('clinical');

  // AI Assistant Drawer management
  const [isDrMindOpen, setIsDrMindOpen] = useState(false);
  const [drMindContextPatient, setDrMindContextPatient] = useState<Patient | null>(null);

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
    setCurrentUser(null);
    setIsDrMindOpen(false);
    setDrMindContextPatient(null);
  };

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
    if (!currentUser) {
      return (
        <Login
          onLoginSuccess={handleLoginSuccess}
          onOpenDataPolicy={() => {
            const btn = document.getElementById('btn-footer-data-policy');
            if (btn) btn.click();
          }}
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
