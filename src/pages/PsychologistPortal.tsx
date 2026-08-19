/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PsychologistPortal — Versión definitiva con pipeline RAG de documentos
 * Integra: flujo clínico completo + investigación farmacéutica + procesamiento de documentos con LLM
 *
 * Ruta protegida: requiere mind_token y mind_user en localStorage.
 */

import VideollamadaVercel from '../components/VideollamadaVercel';
import ClinicalPatientChart from '../components/EHR/ClinicalPatientChart';
import ClinicalRecordsList from '../components/EHR/ClinicalRecordsList';
import { useState, FormEvent, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppointments } from '../hooks/useAppointments';
import { usePatients } from '../hooks/usePatients';
import { useGlobalChat } from '../hooks/useGlobalChat';
import { toast } from 'react-hot-toast';
import { NEW_APPOINTMENT_EVENT } from '../lib/apiClient';
import {
  User,
  Patient,
  ProgressNote,
  ClinicalFile,
  PsychometricTest,
  PatientTestState,
  VideoSession,
  ResearchProject,
  ResearchSubject,
  ScreeningData,
  ResearchAppointment,
} from '../types';
import { WorkspaceContext } from '../components/ContextSwitcher';
import InternalChat from '../components/InternalChat';
import {
  initialPatients,
  initialProgressNotes,
  initialClinicalFiles,
  initialPatientTests,
  initialVideoSessions,
  researchProjects,
  researchSubjects,
  screeningDataCollection,
  researchAppointments,
} from '../data/mockData';
import {
  LayoutDashboard,
  Video,
  ClipboardList,
  FolderLock,
  PlusCircle,
  Search,
  FileText,
  Clock,
  User as UserIcon,
  BookOpen,
  Download,
  Share2,
  CheckCircle,
  AlertCircle,
  Folder,
  File,
  Sparkles,
  Key,
  Activity,
  Award,
  MessageSquare,
  Beaker,
  TrendingUp,
  CalendarDays,
  CircleDot,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Shield,
  ChevronDown,
  Scale,
  X,
  Users,
  Stethoscope,
  Filter,
  BarChart3,
} from 'lucide-react';
import CalendarPanel, { normalizeStatus, type CalendarAppointment } from '../components/EHR/CalendarPanel';
import { legalDisclosureSpanish } from '../data/mockData';
import DelegatedAppointmentModal, { prefetchSelectoresAgendamiento } from '../components/DelegatedAppointmentModal';
import PacientesPanel from '../components/EHR/PacientesPanel';
import AssessmentsPanel from '../components/EHR/AssessmentsPanel';
import ReportsPanel from '../components/EHR/ReportsPanel';

const CALENDAR_KPI_TONES: Record<string, string> = {
  charcoal: 'bg-charcoal-100 text-charcoal-900',
  toast: 'bg-toast-100 text-toast-500',
  emerald: 'bg-emerald-100 text-emerald-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  rose: 'bg-rose-100 text-rose-700',
};

function CalendarKpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone: keyof typeof CALENDAR_KPI_TONES;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg shrink-0 ${CALENDAR_KPI_TONES[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none text-charcoal-900">{value}</p>
        <p className="mt-1 text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

interface PsychologistPortalProps {
  onOpenDrMindWithPatient: (patient: Patient) => void;
  workspaceContext: WorkspaceContext;
  onContextChange: (context: WorkspaceContext) => void;
}

type ActiveTab = 'dashboard' | 'video' | 'evaluations' | 'patients' | 'clinical_history' | 'chat' | 'reports' | 'research' | 'screening' | 'drive';

export default function PsychologistPortal({
  onOpenDrMindWithPatient,
  workspaceContext,
  onContextChange,
}: PsychologistPortalProps) {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);

  const token = localStorage.getItem('mind_token');
  const { appointments: realAppointments, loading: apptsLoading, refetch: refetchAppointments } = useAppointments(token);
  const { patients: realPatients } = usePatients(token);
  const { unreadCount } = useGlobalChat();

  const getPatientName = (id: string | null): string => {
    if (!id) return '';
    // Fuente primaria: el paciente embebido en las citas reales (de ahí sale
    // selectedPatientId en la mayoría de los flujos, incluyendo el selector
    // de "Historias Clínicas").
    const fromAppointment = realAppointments.find(a => a.patient?.id === id)?.patient;
    if (fromAppointment) return `${fromAppointment.firstName || ''} ${fromAppointment.lastName || ''}`.trim();
    const real = realPatients.find(p => p.id === id);
    if (real) return `${real.firstName} ${real.lastName}`.trim();
    return patients.find(p => p.id === id)?.name || '';
  };

  // ---------------------------------------------------------------
  // RENDIMIENTO: precarga de los catálogos del agendamiento
  // El agendamiento es el flujo central y se usa a diario. Adelantar la carga
  // al montaje evita que el usuario pague el arranque en frío de Lambda justo
  // cuando pulsa "Agendar cita".
  // ---------------------------------------------------------------
  useEffect(() => {
    prefetchSelectoresAgendamiento();
  }, []);

  // ---------------------------------------------------------------
  // Notificaciones de Citas Delegadas
  //
  // El polling en sí (GET /api/notifications/unread cada 45s) se movió a
  // App.tsx — vivía solo aquí y por eso ningún rol de AdminPortal se
  // enteraba de nada (ver historial). Este componente solo escucha el
  // evento que App.tsx dispara cuando ve una NEW_APPOINTMENT, para refrescar
  // su propia lista de citas.
  // ---------------------------------------------------------------
  useEffect(() => {
    const handleNewAppointment = () => refetchAppointments();
    window.addEventListener(NEW_APPOINTMENT_EVENT, handleNewAppointment);
    return () => window.removeEventListener(NEW_APPOINTMENT_EVENT, handleNewAppointment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------
  // 1. Verificación de sesión al montar el componente
  // ---------------------------------------------------------------
  useEffect(() => {
    const token = localStorage.getItem('mind_token');
    const userStr = localStorage.getItem('mind_user');

    if (!token || !userStr) {
      navigate('/login');
      return;
    }

    try {
      const userData: User = JSON.parse(userStr);
      setCurrentUser(userData);
    } catch (error) {
      // Datos corruptos: limpiamos y redirigimos
      localStorage.removeItem('mind_token');
      localStorage.removeItem('mind_user');
      navigate('/login');
    } finally {
      setAuthLoading(false);
    }
  }, [navigate]);

  // ---------------------------------------------------------------
  // 2. Conexión WebSocket dinámica para chat/IA (corregida)
  // ---------------------------------------------------------------
  useEffect(() => {
    // Esperamos a que la autenticación esté completa y tengamos el token
    if (authLoading || !currentUser) return;

    const token = localStorage.getItem('mind_token');
    if (!token) return;

    // Determinar URL del WebSocket según el entorno
    const hostname = window.location.hostname;
    let wsUrl: string;

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      // Desarrollo local
      wsUrl = `ws://localhost:9000/ws?token=${token}`;
    } else {
      // Producción en la nube (reemplazar con la URL real de API Gateway)
      // TODO: Cambiar por la URL definitiva de WebSocket en AWS
      wsUrl = `wss://TU_ID_DE_API_GATEWAY.execute-api.us-east-1.amazonaws.com/prod?token=${token}`;
    }

    // Establecer conexión WebSocket
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WebSocket] Conectado al servidor de mensajería clínica');
    };

    ws.onerror = (error) => {
      console.error('[WebSocket] Error de conexión:', error);
    };

    ws.onclose = (event) => {
      console.log('[WebSocket] Conexión cerrada:', event.code, event.reason);
    };

    // Limpieza al desmontar el componente
    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [authLoading, currentUser]);



  // ---------------------------------------------------------------
  // Estados clínicos y de investigación
  // ---------------------------------------------------------------
  const [currentView, setCurrentView] = useState<'dashboard' | 'history'>('dashboard');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  // Recuerda desde qué tab se entró a la ficha de un paciente (p. ej. desde
  // "Pacientes") para que "Volver" regrese ahí — antes siempre volvía al
  // listado de "Historias Clínicas", sin importar de dónde venías.
  const [clinicalHistoryReturnTab, setClinicalHistoryReturnTab] = useState<ActiveTab | null>(null);

  // Soporte real para el botón "atrás" del navegador al entrar a la ficha de
  // un paciente: como esta SPA no usa una URL distinta por paciente, el back
  // nativo no tenía nada que deshacer. Al abrir la ficha empujamos una entrada
  // de historial (misma URL, solo como "punto de retorno"); si el usuario usa
  // el back del navegador, el evento popstate dispara la misma transición que
  // ya hace el botón "Volver a la bandeja de pacientes".
  const handleBackFromPatientChart = () => {
    if (clinicalHistoryReturnTab) {
      window.history.back();
    } else {
      setSelectedPatientId(null);
    }
  };
  useEffect(() => {
    const handlePopState = () => {
      if (selectedPatientId && clinicalHistoryReturnTab) {
        setSelectedPatientId(null);
        setActiveTab(clinicalHistoryReturnTab);
        setClinicalHistoryReturnTab(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [selectedPatientId, clinicalHistoryReturnTab]);

  const [selectedSessionForModal, setSelectedSessionForModal] = useState<any>(null);
  // Cupo/sesión real del lote activo del paciente — no viene en el objeto
  // liviano del calendario, se trae vía la misma ficha del paciente que ya
  // usa el modal de agendamiento (GET .../schedule-summary).
  const [sessionDetailInfo, setSessionDetailInfo] = useState<{
    sessionNumber: number | null;
    statusLabel: string;
    sessionsTaken: number;
    sessionsAuthorized: number | null;
    companyName: string | null;
  } | null>(null);
  const [loadingSessionDetail, setLoadingSessionDetail] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState<any>(null);

  useEffect(() => {
    if (!selectedSessionForModal?.patientId) { setSessionDetailInfo(null); return; }
    let cancelled = false;
    setLoadingSessionDetail(true);
    const token = localStorage.getItem('mind_token');
    const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
    fetch(`${apiUrl}/api/patients/${selectedSessionForModal.patientId}/schedule-summary`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const match = data.appointments?.find((a: any) => a.id === selectedSessionForModal.id);
        setSessionDetailInfo({
          sessionNumber: match?.sessionNumber ?? null,
          statusLabel: match?.statusLabel || selectedSessionForModal.estatus || 'Programada',
          sessionsTaken: data.sessionsTaken ?? 0,
          sessionsAuthorized: data.activeAuthorization?.sessionsAuthorized ?? null,
          companyName: data.activeAuthorization?.companyName || data.patient?.companyName || null,
        });
      })
      .catch(() => { if (!cancelled) setSessionDetailInfo(null); })
      .finally(() => { if (!cancelled) setLoadingSessionDetail(false); });
    return () => { cancelled = true; };
  }, [selectedSessionForModal?.id, selectedSessionForModal?.patientId]);

  const handleMarkAttendance = async (status: string) => {
    if (!selectedSessionForModal) return;
    try {
      const token = localStorage.getItem('mind_token');
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/appointments/${selectedSessionForModal.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        toast.success(`Cita marcada como ${status}`);
        refetchAppointments();
        setSelectedSessionForModal(null);
      } else {
        toast.error('Error al actualizar la cita');
      }
    } catch (e) {
      toast.error('Error al actualizar la cita');
    }
  };

  const handleCancelAppointment = async () => {
    if (!selectedSessionForModal) return;
    if (!window.confirm('¿Cancelar esta cita? Esta acción no se puede deshacer.')) return;
    try {
      const token = localStorage.getItem('mind_token');
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      // No existe DELETE /api/appointments/:id — cancelar es un cambio de
      // estado (igual que "No asistió"), no un borrado físico del registro.
      const res = await fetch(`${apiUrl}/api/appointments/${selectedSessionForModal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'Cancelada' }),
      });
      if (res.ok) {
        toast.success('Cita cancelada.');
        refetchAppointments();
        setSelectedSessionForModal(null);
      } else {
        toast.error('Error al cancelar la cita');
      }
    } catch {
      toast.error('Error al cancelar la cita');
    }
  };

  // Recuerda la última tab visitada entre recargas — mismo fix aplicado en
  // AdminPortal: sin esto, un refresh de página remonta el componente y
  // activeTab vuelve a 'dashboard' sin importar dónde estaba el usuario.
  const PSYCHOLOGIST_TABS: ActiveTab[] = ['dashboard', 'video', 'evaluations', 'patients', 'clinical_history', 'chat', 'reports', 'research', 'screening', 'drive'];
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const saved = localStorage.getItem('mind_psych_active_tab');
    return (saved && (PSYCHOLOGIST_TABS as string[]).includes(saved)) ? (saved as ActiveTab) : 'dashboard';
  });
  useEffect(() => {
    localStorage.setItem('mind_psych_active_tab', activeTab);
  }, [activeTab]);

  const [patients, setPatients] = useState<Patient[]>(initialPatients);
  const [progressNotes, setProgressNotes] = useState<ProgressNote[]>(initialProgressNotes);
  const [clinicalFiles, setClinicalFiles] = useState<ClinicalFile[]>(initialClinicalFiles);
  const [patientTests, setPatientTests] = useState<PatientTestState[]>(initialPatientTests);
  const [videoSessions, setVideoSessions] = useState<VideoSession[]>(initialVideoSessions);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(patients[0]);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(patients[0].id);
  const [activeVideoCall, setActiveVideoCall] = useState<VideoSession | null>(null);
  const [noteForm, setNoteForm] = useState({
    reason: '',
    mentalStatus: '',
    intervention: '',
    evolution: '',
    diagnosis: 'F41.1 Trastorno de Ansiedad Generalizada',
    recommendations: '',
  });
  const [isSigningNote, setIsSigningNote] = useState(false);
  const [noteAlert, setNoteAlert] = useState<string | null>(null);
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarPatientFilter, setCalendarPatientFilter] = useState('todos');

  useEffect(() => {
    refetchAppointments();
  }, [currentDate, view]);

  const weeklyAppointments = (realAppointments || []).map((appt) => {
    const appDate = new Date(appt?.date || appt?.dateTime || Date.now());
    return {
      id: appt?.id || 'unknown',
      patientName: `${appt?.patient?.firstName || ''} ${appt?.patient?.lastName || ''}`.trim() || 'Paciente Desconocido',
      patientId: appt?.patient?.id || 'unknown',
      documentId: appt?.patient?.documentId || '',
      phone: appt?.patient?.phone || '',
      corporateClient: appt?.patient?.corporateClient || '',
      notes: appt?.notes || '',
      appDate,
      dayIndex: appDate.getDay(),
      timeSlot: appt.timeSlot || `${appDate.getHours().toString().padStart(2, '0')}:${appDate.getMinutes().toString().padStart(2, '0')} - ${(appDate.getHours() + 1).toString().padStart(2, '0')}:${appDate.getMinutes().toString().padStart(2, '0')}`,
      atencionType: appt.specialty?.name || appt.type || 'psicología clínica',
      estatus: appt.status || 'Confirmada',
      modalidad: appt.type === 'Virtual' || appt.type === 'Presencial' ? appt.type : 'Virtual',
      roomUrl: appt.roomUrl || 'https://meet.jit.si/mind_psic_default',
      startHour: parseInt(appt.timeSlot ? appt.timeSlot.split(':')[0] : appDate.getHours().toString()),
      startMinute: parseInt(appt.timeSlot ? appt.timeSlot.split(':')[1] : appDate.getMinutes().toString())
    };
  });

  // Filtro por paciente en el calendario — mismo patrón que el filtro por
  // psicólogo del calendario general de AdminPortal.
  const calendarPatientOptions = Array.from(
    new Set(weeklyAppointments.map((a) => a.patientName))
  ).sort((a, b) => a.localeCompare(b));

  const filteredWeeklyAppointments = calendarPatientFilter === 'todos'
    ? weeklyAppointments
    : weeklyAppointments.filter((a) => a.patientName === calendarPatientFilter);

  const calendarKpis = (() => {
    const todayStr = new Date().toDateString();
    const counts = { pendiente: 0, atendida: 0, no_atendido: 0, reprogramada: 0 };
    let hoy = 0;
    weeklyAppointments.forEach(app => {
      counts[normalizeStatus(app.estatus)]++;
      if (app.appDate.toDateString() === todayStr) hoy++;
    });
    return { hoy, ...counts };
  })();

  const [showNewAppointmentModal, setShowNewAppointmentModal] = useState(false);
  const [showSecurityInfo, setShowSecurityInfo] = useState(false);
  const [showDataPolicyModal, setShowDataPolicyModal] = useState(false);

  const [reprogramaciones, setReprogramaciones] = useState([
    { id: 'rep_1', patientName: 'Valeria Sotomayor', originalTime: 'Mar 15:00', requestedTime: 'Mar 17:30', reason: 'Cruce imprevisto con horario laboral unificado' },
    { id: 'rep_2', patientName: 'Mauricio Gómez Ruiz', originalTime: 'Jue 09:00', requestedTime: 'Vier 11:30', reason: 'Incapacidad médica certificada por migraña' },
    { id: 'rep_3', patientName: 'Daniela Castro Pérez', originalTime: 'Sáb 08:30', requestedTime: 'Sáb 14:00', reason: 'Falla técnica de traslado / calamidad vial' },
  ]);
  const [showExportReportModal, setShowExportReportModal] = useState(false);
  const [selectedPdfPatient, setSelectedPdfPatient] = useState<Patient | null>(null);
  const [calendarSearchQuery, setCalendarSearchQuery] = useState('');
  const [calendarTypeFilter, setCalendarTypeFilter] = useState('todos');
  const [calendarStatusFilter, setCalendarStatusFilter] = useState('todos');

  // Research state
  const [researchData] = useState<ResearchProject[]>(researchProjects);
  const [subjects, setSubjects] = useState<ResearchSubject[]>(researchSubjects);
  const [screeningData] = useState<ScreeningData[]>(screeningDataCollection);
  const [appointments] = useState<ResearchAppointment[]>(researchAppointments);
  const [selectedProject, setSelectedProject] = useState<ResearchProject | null>(researchProjects[0]);
  const [selectedSubject, setSelectedSubject] = useState<ResearchSubject | null>(researchSubjects[0]);

  // Document pipeline state
  const [myDocuments, setMyDocuments] = useState<any[]>([]);

  const fetchDocuments = async (type: 'clinico' | 'investigacion' = 'clinico') => {
    try {
      const token = localStorage.getItem('mind_token');
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:9000'}/api/documents/list?type=${type}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMyDocuments(data.documents || []);
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
    }
  };

  const uploadDocument = async (file: File, type: 'clinico' | 'investigacion') => {
    const token = localStorage.getItem('mind_token');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    try {
      await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:9000'}/api/documents/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      await fetchDocuments(type);
      toast.success(`Documento "${file.name}" subido correctamente`);
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Error al subir el documento');
    }
  };

  const processDocument = async (documentId: string) => {
    const token = localStorage.getItem('mind_token');
    try {
      await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:9000'}/api/documents/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ documentId }),
      });
      toast.success('Procesamiento iniciado en segundo plano');
      setTimeout(() => fetchDocuments(), 2000);
    } catch (error) {
      console.error('Process error:', error);
      toast.error('Error al procesar el documento');
    }
  };

  useEffect(() => {
    if (activeTab === 'drive') {
      fetchDocuments('clinico');
    }
  }, [activeTab]);

  // Mientras se verifica la sesión o currentUser es null, mostramos carga
  if (authLoading || !currentUser || apptsLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <p className="text-lg text-stone-600 font-semibold animate-pulse">
          Cargando entorno seguro…
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Funciones clínicas (actualizadas con currentUser)
  // ---------------------------------------------------------------
  const handleSignNote = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;

    if (!noteForm.reason || !noteForm.mentalStatus || !noteForm.intervention || !noteForm.evolution) {
      setNoteAlert('⚠️ Completa los campos core obligatorios para poder estampar la firma de auditoría.');
      return;
    }

    setIsSigningNote(true);

    setTimeout(() => {
      const newNoteId = 'note_' + Date.now();
      const nextSessionNumber = (progressNotes.filter(n => n.patientId === selectedPatient.id).length || 0) + 1;

      const signedNote: ProgressNote = {
        id: newNoteId,
        patientId: selectedPatient.id,
        date: new Date().toISOString().split('T')[0],
        psychologistId: currentUser.id,
        psychologistName: currentUser.name,
        sessionNumber: nextSessionNumber,
        reason: noteForm.reason,
        mentalStatus: noteForm.mentalStatus,
        intervention: noteForm.intervention,
        evolution: noteForm.evolution,
        diagnosis: noteForm.diagnosis,
        recommendations: noteForm.recommendations,
      };

      setProgressNotes(prev => [signedNote, ...prev]);

      setPatients(prev => prev.map(p => {
        if (p.id === selectedPatient.id) {
          return {
            ...p,
            progressNotesCount: p.progressNotesCount + 1,
            lastSessionDate: signedNote.date,
          };
        }
        return p;
      }));

      const newFileDoc: ClinicalFile = {
        id: 'file_' + Date.now(),
        name: `Evolucion_Sesion_${nextSessionNumber}_${selectedPatient.name.replace(/\s+/g, '_')}_Firmado.pdf`,
        type: 'pdf',
        size: '1.2 MB',
        uploadedAt: signedNote.date,
        uploadedBy: currentUser.name,
        patientId: selectedPatient.id,
        category: 'Historia Clínica',
      };
      setClinicalFiles(prev => [newFileDoc, ...prev]);

      setNoteForm({
        reason: '',
        mentalStatus: '',
        intervention: '',
        evolution: '',
        diagnosis: 'F41.1 Trastorno de Ansiedad Generalizada',
        recommendations: '',
      });
      setIsSigningNote(false);
      setNoteAlert('✅ ¡Nota clínica firmada y estampada digitalmente con éxito!');

      setSelectedPatient(prev => prev ? {
        ...prev,
        progressNotesCount: prev.progressNotesCount + 1,
        lastSessionDate: signedNote.date,
      } : null);

      setTimeout(() => setNoteAlert(null), 5000);
    }, 1500);
  };

  const startVideoSession = (session: VideoSession) => {
    console.log('[TELEHEALTH HOOK] Inicializando videoconsulta con:', session.patientName);
    setActiveVideoCall(session);
    setActiveTab('video');
  };

  const handleRequestAISuggestion = () => {
    if (!selectedPatient) return;
    onOpenDrMindWithPatient(selectedPatient);

    setNoteForm(prev => ({
      ...prev,
      reason: `Paciente de ${selectedPatient.age} años en convenio ${selectedPatient.agreement}. Presenta insomnio recurrente y miedos asociados al bajo rendimiento.`,
      mentalStatus: 'Lúcido, cooperador, discurre de forma ordenada y consciente de sus gatillos de ansiedad. Afecto ansioso moderado.',
      intervention: 'Enfoque reflexivo, ejercicios cognitivo-conductuales, técnicas de respiración.',
      evolution: 'Evolución moderadamente favorable, ha logrado reducir sus autojuicios severos.',
    }));
  };

  // ---------------------------------------------------------------
  // Render principal con información dinámica del usuario
  // ---------------------------------------------------------------
  return (
    <div className="flex h-full bg-slate-50 overflow-hidden font-sans">

      {/* SIDEBAR NAVIGATION */}
      <aside className="w-16 md:w-64 bg-charcoal-950 text-slate-300 flex flex-col justify-between shrink-0 border-r border-charcoal-800 overflow-y-auto">
        <div className="py-6 flex flex-col space-y-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'dashboard' ? 'bg-charcoal-900 text-white font-semibold' : 'hover:bg-charcoal-900 hover:text-white'
            }`}
          >
            <LayoutDashboard className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Tablero de Gestión (EHR)</span>
            {activeTab === 'dashboard' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          <button
            onClick={() => setActiveTab('video')}
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'video' ? 'bg-charcoal-900 text-white font-semibold' : 'hover:bg-charcoal-900 hover:text-white'
            }`}
          >
            <div className="relative">
              <Video className="w-5 h-5 shrink-0" />
              {videoSessions.some(v => v.status === 'en_progreso') && (
                <span className="absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full bg-toast-500 animate-ping" />
              )}
            </div>
            <span className="ml-3 text-xs hidden md:block flex-1 text-left">Conectar con MindHealth</span>
            {videoSessions.some(v => v.status === 'en_progreso') && (
              <span className="hidden md:inline bg-toast-500 text-[9px] text-white px-1.5 py-0.2 rounded-full font-bold animate-pulse">LIVE</span>
            )}
            {activeTab === 'video' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          <button
            onClick={() => setActiveTab('evaluations')}
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'evaluations' ? 'bg-charcoal-900 text-white font-semibold' : 'hover:bg-charcoal-900 hover:text-white'
            }`}
          >
            <ClipboardList className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Pruebas y Evaluaciones</span>
            {activeTab === 'evaluations' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          <button
            onClick={() => setActiveTab('patients')}
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'patients' ? 'bg-charcoal-900 text-white font-semibold' : 'hover:bg-charcoal-900 hover:text-white'
            }`}
          >
            <Users className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Pacientes</span>
            {activeTab === 'patients' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          <button
            onClick={() => setActiveTab('clinical_history')}
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'clinical_history' ? 'bg-charcoal-900 text-white font-semibold' : 'hover:bg-charcoal-900 hover:text-white'
            }`}
          >
            <FileText className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Historias Clínicas</span>
            {activeTab === 'clinical_history' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          <button
            onClick={() => setActiveTab('chat')}
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'chat' ? 'bg-charcoal-900 text-white font-semibold' : 'hover:bg-charcoal-900 hover:text-white'
            }`}
          >
            <div className="relative">
              <MessageSquare className="w-5 h-5 shrink-0" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold h-4 w-4 flex items-center justify-center rounded-full animate-bounce">
                  {unreadCount}
                </span>
              )}
              {unreadCount === 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full bg-toast-500 animate-pulse" />
              )}
            </div>
            <span className="ml-3 text-xs hidden md:block">Mensajería Clínica</span>
            {activeTab === 'chat' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          <button
            onClick={() => setActiveTab('reports')}
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'reports' ? 'bg-charcoal-900 text-white font-semibold' : 'hover:bg-charcoal-900 hover:text-white'
            }`}
          >
            <BarChart3 className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Reportes</span>
            {activeTab === 'reports' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          {workspaceContext === 'research' && (
            <>
              <div className="my-2 mx-3 border-t border-charcoal-700" />
              <button
                onClick={() => setActiveTab('research')}
                className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
                  activeTab === 'research' ? 'bg-charcoal-900 text-white font-semibold' : 'hover:bg-charcoal-900 hover:text-white'
                }`}
              >
                <Beaker className="w-5 h-5 shrink-0" />
                <span className="ml-3 text-xs hidden md:block">Proyectos de Investigación</span>
                {activeTab === 'research' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
              </button>
              <button
                onClick={() => setActiveTab('screening')}
                className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
                  activeTab === 'screening' ? 'bg-charcoal-900 text-white font-semibold' : 'hover:bg-charcoal-900 hover:text-white'
                }`}
              >
                <TrendingUp className="w-5 h-5 shrink-0" />
                <span className="ml-3 text-xs hidden md:block">Tamizaje y Datos</span>
                {activeTab === 'screening' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
              </button>
            </>
          )}
        </div>

        {/* License + Compliance Signature Block – reemplaza al footer general de la app */}
        <div className="hidden md:flex flex-col border-t border-charcoal-800 bg-charcoal-950/40 text-left">
          <div className="p-4 pb-3">
            <div className="flex items-center space-x-2 text-toast-400 mb-1">
              <Award className="w-4 h-4" />
              <span className="text-[10px] font-bold font-mono uppercase tracking-wider">Licencia Verificada</span>
            </div>
            <p className="text-[11px] font-semibold text-white truncate">{currentUser.name}</p>
            <p className="text-[10px] text-slate-400 font-mono mt-0.5">
              {currentUser.role} · {currentUser.tenantId}
            </p>
            {currentUser.licenseNumber && (
              <p className="text-[9px] text-slate-500 font-mono mt-1">
                Lic. {currentUser.licenseNumber}
              </p>
            )}
          </div>

          {/* Infraestructura Segura (plegable) */}
          <div className="mx-3 mb-3 rounded-lg bg-charcoal-900/60">
            <button
              onClick={() => setShowSecurityInfo(v => !v)}
              aria-expanded={showSecurityInfo}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-charcoal-900 cursor-pointer"
            >
              <Shield className="w-4 h-4 shrink-0 text-emerald-400" />
              <span className="flex-1 text-[11px] font-semibold leading-tight text-white">Infraestructura Segura</span>
              <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-slate-500 transition-transform ${showSecurityInfo ? 'rotate-180' : ''}`} />
            </button>

            {showSecurityInfo && (
              <div className="flex flex-col gap-3 px-2.5 pb-3 pt-1">
                <p className="text-[11px] leading-relaxed text-slate-400">
                  Expedientes y notas clínicas encriptados con estándar médico (TLS 1.3 / AES-256). Cumple la Ley 1581 de 2012 (Habeas Data) y directrices de teleorientación en salud.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded border border-charcoal-700 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-slate-400">ISO 27001</span>
                  <span className="rounded border border-charcoal-700 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-slate-400">HIPAA</span>
                  <span className="flex items-center gap-1 rounded border border-emerald-500/40 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    TLS ACTIVE
                  </span>
                </div>
                <button
                  onClick={() => setShowDataPolicyModal(true)}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:text-white cursor-pointer"
                >
                  <Scale className="w-3.5 h-3.5" />
                  Tratamiento de Datos
                </button>
              </div>
            )}
          </div>

          <p className="px-4 pb-3 text-[9px] leading-tight text-slate-600">
            © 2026 MindPsic &amp; MindHealth
          </p>
        </div>
      </aside>

      {/* Modal: Política de Tratamiento de Datos Personales */}
      {showDataPolicyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl border border-slate-100">
            <div className="bg-gradient-to-r from-charcoal-900 to-charcoal-950 px-6 py-4 text-white flex items-center justify-between border-b border-toast-200">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-toast-400" />
                <h3 className="font-bold text-base tracking-tight">Política de Tratamiento de Datos Personales</h3>
              </div>
              <button
                onClick={() => setShowDataPolicyModal(false)}
                className="text-slate-300 hover:text-white rounded-lg p-1 hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto text-slate-600 space-y-4">
              <p className="font-semibold text-slate-900 text-sm">
                Compromiso de Confidencialidad y Cumplimiento Normativo (Ecosistema MindPsic - MindHealth)
              </p>
              <div className="bg-slate-50 p-4 rounded-xl text-xs font-mono border border-slate-200 text-slate-700 whitespace-pre-line leading-relaxed">
                {legalDisclosureSpanish}
              </div>
              <div className="space-y-2 text-xs leading-relaxed">
                <p className="font-semibold text-slate-800">Derechos de los Usuarios:</p>
                <ul className="list-disc list-inside space-y-1 text-slate-500">
                  <li>Consultar y actualizar en cualquier momento su información en las historias clínicas.</li>
                  <li>Solicitar la revocatoria de autorización de uso no clínico cuando lo considere pertinente.</li>
                  <li>Inamovilidad del registro evolutivo clínico firmado digitalmente por su correspondiente psicólogo de cabecera.</li>
                </ul>
              </div>
            </div>
            <div className="border-t border-slate-100 px-6 py-4 bg-slate-50 flex justify-end">
              <button
                onClick={() => setShowDataPolicyModal(false)}
                className="bg-slate-900 text-white rounded-xl px-4 py-2 text-xs font-semibold hover:bg-slate-800 transition-colors shadow-sm cursor-pointer"
              >
                Entendido y Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-y-auto p-6 md:p-8">
        
        {/* VIEW: INTERNAL CHAT */}
        {activeTab === 'chat' && (
          <div className="max-w-7xl mx-auto">
            <InternalChat currentUser={currentUser} />
          </div>
        )}

        {/* DASHBOARD HISTORY FALLBACK (Kept for backwards compatibility) */}
        {activeTab === 'dashboard' && currentView === 'history' && selectedPatientId && (
          <div className="max-w-7xl mx-auto">
            <ClinicalPatientChart
              patientId={selectedPatientId}
              onBack={() => setCurrentView('dashboard')}
            />
          </div>
        )}

        {activeTab === 'dashboard' && currentView === 'dashboard' && (
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Aquí iría el resto del dashboard (calendario, pacientes recientes, notas clínicas, etc.)
                Por razones de espacio no se replica todo, pero la estructura es idéntica a la original,
                usando currentUser en lugar de valores estáticos. */}
            {/* KPIs DE AGENDAMIENTO */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <CalendarKpiCard icon={CalendarDays} label="Citas hoy" value={calendarKpis.hoy} tone="charcoal" />
              <CalendarKpiCard icon={CircleDot} label="Pendientes" value={calendarKpis.pendiente} tone="toast" />
              <CalendarKpiCard icon={CheckCircle2} label="Atendidas" value={calendarKpis.atendida} tone="emerald" />
              <CalendarKpiCard icon={RotateCcw} label="Reprogramadas" value={calendarKpis.reprogramada} tone="indigo" />
              <CalendarKpiCard icon={XCircle} label="No Atendió" value={calendarKpis.no_atendido} tone="rose" />
            </div>

            {/* PANEL DE AGENDAMIENTO */}
            <CalendarPanel
              appointments={filteredWeeklyAppointments as CalendarAppointment[]}
              view={view}
              setView={setView}
              currentDate={currentDate}
              setCurrentDate={setCurrentDate}
              onSelectAppointment={(app) => setSelectedSessionForModal(app)}
              onNewAppointment={() => setShowNewAppointmentModal(true)}
              filterSlot={
                <div className="flex items-center gap-1.5">
                  <Filter className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <select
                    value={calendarPatientFilter}
                    onChange={(e) => setCalendarPatientFilter(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-toast-50 px-2.5 py-1.5 text-sm font-medium text-charcoal-900 focus:ring-2 focus:ring-toast-500 outline-none cursor-pointer"
                  >
                    <option value="todos">Todos los pacientes</option>
                    {calendarPatientOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              }
            />

            <DelegatedAppointmentModal
              isOpen={showNewAppointmentModal || !!rescheduleTarget}
              initialData={rescheduleTarget}
              onClose={() => {
                setShowNewAppointmentModal(false);
                setRescheduleTarget(null);
              }}
              onSuccess={() => {
                setShowNewAppointmentModal(false);
                setRescheduleTarget(null);
                refetchAppointments();
              }}
            />
          </div>
        )}

        {/* VIEW: VIDEO-CALL (usa activeVideoCall) */}
        {activeTab === 'video' && (
          <div className="max-w-7xl mx-auto space-y-6 text-left">
            <div className="relative">
              {activeVideoCall && (
                <button
                  onClick={() => setActiveVideoCall(null)}
                  className="absolute top-2 right-2 z-10 bg-stone-900 text-white text-xs px-3 py-1 rounded-lg hover:bg-stone-700 transition cursor-pointer"
                >
                  Cerrar sala
                </button>
              )}
              <VideollamadaVercel
                pacienteId={activeVideoCall?.patientId}
                salaId={activeVideoCall?.id}
                tokenSesion={localStorage.getItem('mind_token') || ''}
              />
            </div>
          </div>
        )}

        {/* VIEW: EVALUATIONS */}
        {activeTab === 'evaluations' && <AssessmentsPanel />}

        {/* VIEW: PATIENTS */}
        {activeTab === 'patients' && (
          <PacientesPanel
            token={token}
            onSelectPatient={(id) => {
              window.history.pushState({ mindpsicPatientChart: true }, '', window.location.href);
              setSelectedPatientId(id);
              setClinicalHistoryReturnTab('patients');
              setActiveTab('clinical_history');
            }}
          />
        )}

        {/* VIEW: CLINICAL HISTORY */}
        {activeTab === 'clinical_history' && (
          <div className="max-w-7xl mx-auto space-y-6">
            {!selectedPatientId ? (
              <ClinicalRecordsList
                patients={realPatients}
                onSelect={(id) => { setSelectedPatientId(id); setClinicalHistoryReturnTab(null); }}
              />
            ) : (
              <ClinicalPatientChart
                patientId={selectedPatientId}
                onBack={handleBackFromPatientChart}
              />
            )}
          </div>
        )}

        {/* VIEW: REPORTS */}
        {activeTab === 'reports' && (
          <ReportsPanel
            token={token}
            onSelectPatient={(id) => {
              window.history.pushState({ mindpsicPatientChart: true }, '', window.location.href);
              setSelectedPatientId(id);
              setClinicalHistoryReturnTab('reports');
              setActiveTab('clinical_history');
            }}
          />
        )}

        {/* VIEW: RESEARCH (solo si workspaceContext === 'research') */}
        {activeTab === 'research' && workspaceContext === 'research' && (
          <div className="max-w-7xl mx-auto space-y-6 text-left">
            <div className="bg-white rounded-xl border border-slate-100 p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-4">Proyectos de Investigación</h2>
              {/* Contenido de investigación */}
              <p className="text-slate-500">Módulo en desarrollo</p>
            </div>
          </div>
        )}

        {/* VIEW: SCREENING (solo si workspaceContext === 'research') */}
        {activeTab === 'screening' && workspaceContext === 'research' && (
          <div className="max-w-7xl mx-auto space-y-6 text-left">
            <div className="bg-white rounded-xl border border-slate-100 p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-4">Datos de Tamizaje</h2>
              <p className="text-slate-500">Módulo en desarrollo</p>
            </div>
          </div>
        )}
      </main>

      {/* MODAL DE DETALLES DE SESIÓN */}
      {selectedSessionForModal && (() => {
        const start: Date = selectedSessionForModal.appDate;
        const end = new Date(start.getTime() + 50 * 60000);
        const fmtTime = (d: Date) => d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true });
        const fmtDate = (d: Date) => {
          const s = d.toLocaleDateString('es-CO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
          return s.charAt(0).toUpperCase() + s.slice(1);
        };
        const isVirtual = selectedSessionForModal.modalidad !== 'Presencial';
        const statusLabel = sessionDetailInfo?.statusLabel || 'Programada';
        // Igual que en el modal de edición: una cita ya atendida/cancelada, o
        // cuya fecha ya pasó, no se puede reprogramar.
        const isLockedForReschedule = statusLabel === 'Atendida' || statusLabel === 'Cancelada' || start.getTime() < Date.now();
        const STATUS_TONE: Record<string, string> = {
          Programada: 'bg-toast-500/15 text-toast-300 border-toast-500/30',
          Atendida: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
          'No Atendido': 'bg-rose-500/15 text-rose-300 border-rose-500/30',
          Reprogramada: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
          Cancelada: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
        };

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden text-left">

              {/* Header oscuro institucional */}
              <div className="px-6 py-4 bg-charcoal-900 flex justify-between items-start">
                <div>
                  <h3 className="text-base font-bold text-white">Detalles de la Cita</h3>
                  <p className="text-[10.5px] font-semibold uppercase tracking-widest text-slate-400 mt-0.5">
                    Gestión de sesión clínica
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE[statusLabel] || STATUS_TONE.Programada}`}>
                    {statusLabel}
                  </span>
                  <button
                    onClick={() => setSelectedSessionForModal(null)}
                    className="text-slate-400 hover:text-white text-lg leading-none cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                {/* Paciente */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-toast-50 border border-toast-200">
                      <UserIcon className="h-5 w-5 text-toast-500" />
                    </div>
                    <div>
                      <p className="text-base font-bold text-slate-900">{selectedSessionForModal.patientName}</p>
                      <p className="text-xs text-slate-500">
                        {selectedSessionForModal.documentId ? `CC ${selectedSessionForModal.documentId}` : 'Sin documento'}
                        {selectedSessionForModal.phone ? ` • ${selectedSessionForModal.phone}` : ''}
                      </p>
                    </div>
                  </div>
                  {selectedSessionForModal.corporateClient && (
                    <span className="shrink-0 rounded-md bg-toast-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                      {selectedSessionForModal.corporateClient}
                    </span>
                  )}
                </div>

                {/* Grid de info */}
                <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start gap-2">
                    <Stethoscope className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Especialista</p>
                      <p className="text-sm font-bold text-slate-800">{currentUser.name}</p>
                      <p className="text-xs text-slate-500">{currentUser.specialty || selectedSessionForModal.atencionType}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CalendarDays className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Programación</p>
                      <p className="text-sm font-bold text-slate-800">{fmtDate(start)}</p>
                      <p className="text-xs text-slate-500">{fmtTime(start)} – {fmtTime(end)} (50 min)</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Video className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Modalidad</p>
                      <p className="text-sm font-bold text-slate-800">{isVirtual ? 'Telepsicología' : 'Presencial'}</p>
                      <p className="text-xs text-slate-500">{isVirtual ? 'Sala virtual asignada' : 'Atención en sede'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Clock className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Sesión</p>
                      <p className="text-sm font-bold text-slate-800">
                        {loadingSessionDetail ? 'Cargando…' : sessionDetailInfo?.sessionNumber ? `Sesión #${sessionDetailInfo.sessionNumber}` : 'Sin lote asociado'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {loadingSessionDetail
                          ? ''
                          : sessionDetailInfo?.sessionsAuthorized === null && sessionDetailInfo?.companyName
                            ? 'Sesiones libres'
                            : sessionDetailInfo?.sessionsAuthorized
                              ? `${sessionDetailInfo.sessionsTaken} usadas de ${sessionDetailInfo.sessionsAuthorized}`
                              : 'Sin cupo vigente'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Notas */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Notas / Observaciones</label>
                  <div className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
                    {selectedSessionForModal.notes || 'Sin observaciones previas para esta sesión.'}
                  </div>
                </div>

                {/* Acciones primarias */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    disabled={!isVirtual}
                    onClick={() => {
                      startVideoSession({
                        id: selectedSessionForModal.id,
                        patientId: selectedSessionForModal.patientId,
                        patientName: selectedSessionForModal.patientName,
                        time: fmtTime(start),
                        date: start.toISOString(),
                        status: 'programada',
                        roomUrl: selectedSessionForModal.roomUrl,
                      });
                      setSelectedSessionForModal(null);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-charcoal-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Video className="h-4 w-4" /> Unirse a videollamada
                  </button>
                  <button
                    onClick={() => handleMarkAttendance('Atendida')}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 cursor-pointer"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Marcar asistencia
                  </button>
                </div>
              </div>

              {/* Acciones secundarias */}
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setSelectedSessionForModal(null);
                      setSelectedPatientId(selectedSessionForModal.patientId);
                      setActiveTab('clinical_history');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    <FileText className="h-3.5 w-3.5" /> Historia clínica
                  </button>
                  <button
                    disabled={isLockedForReschedule}
                    title={isLockedForReschedule ? 'No se puede reprogramar: la cita ya fue atendida/cancelada o su fecha ya pasó.' : undefined}
                    onClick={() => {
                      const fullAppt = (realAppointments || []).find((a: any) => a.id === selectedSessionForModal.id);
                      setSelectedSessionForModal(null);
                      setRescheduleTarget(fullAppt || null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Re-programar
                  </button>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => handleMarkAttendance('No Atendido')}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-800 cursor-pointer"
                  >
                    <XCircle className="h-3.5 w-3.5" /> No asistió
                  </button>
                  <button
                    onClick={handleCancelAppointment}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-800 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" /> Cancelar cita
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}