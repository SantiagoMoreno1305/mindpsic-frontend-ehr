/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { User, Patient } from './types';
import { WorkspaceContext } from './components/ContextSwitcher';
import Login from './pages/Login';
import PsychologistPortal from './pages/PsychologistPortal';
import AdminPortal from './pages/AdminPortal';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import DrMindChat from './components/DrMindChat';
import { Sparkles, MessageSquare, Heart, ShieldAlert, Bot } from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  // Workspace Context State — Hybrid Clinical + Research
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContext>('clinical');
  
  // AI Assistant Drawer management
  const [isDrMindOpen, setIsDrMindOpen] = useState(false);
  const [drMindContextPatient, setDrMindContextPatient] = useState<Patient | null>(null);

  // Legal modal accessibility
  const [isDataPolicyOpenFromFooter, setIsDataPolicyOpenFromFooter] = useState(false);

  const handleLoginSuccess = (user: User) => {
    console.log('[App] ✅ handleLoginSuccess invocado — rol:', user.role);
    setCurrentUser(user);
    // Auto-open Dr.Mind on pristine psychologist login to greet the doctor
    if (user.role === 'psicologo') {
      setIsDrMindOpen(true);
    }
    // Roles 'admin' y 'director' van al AdminPortal (bloque else en el JSX).
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-800 antialiased selection:bg-toast-200 selection:text-charcoal-900">
      
      {/* 1. SECURE NAVBAR HEADER (Shown only when logged in) */}
      <Navbar 
        user={currentUser} 
        onLogout={handleLogout} 
        onOpenDrMind={() => setIsDrMindOpen(true)} 
        currentContext={workspaceContext}
        onContextChange={setWorkspaceContext}
      />

      {/* 2. CHOOSE CORRESPONDING CONTAINER WITH ROLE GUARD */}
      <div className="flex-1 relative">
        {!currentUser ? (
          <Login 
            onLoginSuccess={handleLoginSuccess}
            onOpenDataPolicy={() => {
              // Toggle data policy modal inside footer safely
              const btn = document.getElementById('btn-footer-data-policy');
              if (btn) btn.click();
            }}
          />
        ) : currentUser.role === 'psicologo' ? (
          <PsychologistPortal 
            user={currentUser} 
            onOpenDrMindWithPatient={handleOpenDrMindWithPatient}
            workspaceContext={workspaceContext}
            onContextChange={setWorkspaceContext}
          />
        ) : (
          <AdminPortal />
        )}
      </div>

      {/* 3. FLOATING DR.MIND CALL-TO-ACTION BUBBLE (Only when authenticated and drawer is closed) */}
      {currentUser && !isDrMindOpen && (
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

      {/* 4. DR.MIND FLOATING ACTIVE CHAT DRAWER */}
      <DrMindChat 
        isOpen={isDrMindOpen} 
        onClose={() => setIsDrMindOpen(false)} 
        selectedPatient={drMindContextPatient}
      />

      {/* 5. SECURE HEALTH ARCHITECTURE FOOTER */}
      <Footer />

    </div>
  );
}
