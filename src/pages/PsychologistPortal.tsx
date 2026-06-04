/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PsychologistPortal — Versión definitiva con pipeline RAG de documentos
 * Integra: flujo clínico completo + investigación farmacéutica + procesamiento de documentos con LLM
 */

import VideollamadaVercel from '../components/VideollamadaVercel';
import { useState, FormEvent, useEffect } from 'react';
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
  ResearchAppointment
} from '../types';
import { WorkspaceContext } from '../components/ContextSwitcher';
import InternalChat from '../components/InternalChat';
import {
  initialPatients,
  initialProgressNotes,
  initialClinicalFiles,
  psychometricTestsCatalogue,
  initialPatientTests,
  initialVideoSessions,
  researchProjects,
  researchSubjects,
  screeningDataCollection,
  researchAppointments
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
  CloudLightning,
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
  TrendingUp
} from 'lucide-react';

interface PsychologistPortalProps {
  user: User;
  onOpenDrMindWithPatient: (patient: Patient) => void;
  workspaceContext: WorkspaceContext;
  onContextChange: (context: WorkspaceContext) => void;
}

type ActiveTab = 'dashboard' | 'video' | 'evaluations' | 'drive' | 'chat' | 'research' | 'screening';

export default function PsychologistPortal({
  user,
  onOpenDrMindWithPatient,
  workspaceContext,
  onContextChange
}: PsychologistPortalProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');

  // ============================================================================
  // CLINICAL STATE (Mantiene intacto el flujo clínico existente)
  // ============================================================================
  const [patients, setPatients] = useState<Patient[]>(initialPatients);
  const [progressNotes, setProgressNotes] = useState<ProgressNote[]>(initialProgressNotes);
  const [clinicalFiles, setClinicalFiles] = useState<ClinicalFile[]>(initialClinicalFiles);
  const [patientTests, setPatientTests] = useState<PatientTestState[]>(initialPatientTests);
  const [videoSessions, setVideoSessions] = useState<VideoSession[]>(initialVideoSessions);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(patients[0]);

  // Support Searchers State
  const [testSearchQuery, setTestSearchQuery] = useState('');
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(patients[0].id);

  // Active Session State
  const [activeVideoCall, setActiveVideoCall] = useState<VideoSession | null>(null);

  // Clinical progress note creator form fields
  const [noteForm, setNoteForm] = useState({
    reason: '',
    mentalStatus: '',
    intervention: '',
    evolution: '',
    diagnosis: 'F41.1 Trastorno de Ansiedad Generalizada',
    recommendations: ''
  });
  const [isSigningNote, setIsSigningNote] = useState(false);
  const [noteAlert, setNoteAlert] = useState<string | null>(null);

  // Custom interactive weekly/day calendar state
  const [calendarViewMode, setCalendarViewMode] = useState<'semana' | 'dia'>('semana');
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<number>(0);
  const [weeklyAppointments, setWeeklyAppointments] = useState([
    { id: 'ap_1', patientName: 'Sebas Martínez Ocampo', patientId: 'pat_01', dayIndex: 0, timeSlot: '08:00 - 09:00', atencionType: 'psicología clínica', estatus: 'Confirmada', modalidad: 'Virtual', roomUrl: 'https://meet.jit.si/mind_sebas_martinez' },
    { id: 'ap_2', patientName: 'Valeria Sotomayor', patientId: 'pat_02', dayIndex: 0, timeSlot: '10:00 - 11:00', atencionType: 'psicología del sueño', estatus: 'Confirmada', modalidad: 'Virtual', roomUrl: 'https://meet.jit.si/mind_valeria_sotomayor' },
    { id: 'ap_3', patientName: 'Andrés Felipe Correa', patientId: 'pat_03', dayIndex: 1, timeSlot: '09:00 - 10:00', atencionType: 'neuropsicología', estatus: 'Pendiente', modalidad: 'Presencial', roomUrl: '' },
    { id: 'ap_4', patientName: 'Daniela Castro Pérez', patientId: 'pat_04', dayIndex: 2, timeSlot: '11:00 - 12:00', atencionType: 'psicología de la sexualidad', estatus: 'Confirmada', modalidad: 'Virtual', roomUrl: 'https://meet.jit.si/mind_daniela_castro' },
    { id: 'ap_5', patientName: 'Mauricio Gómez Ruiz', patientId: 'pat_05', dayIndex: 3, timeSlot: '14:30 - 15:30', atencionType: 'psicooncología', estatus: 'Confirmada', modalidad: 'Presencial', roomUrl: '' },
    { id: 'ap_6', patientName: 'Sebas Martínez Ocampo', patientId: 'pat_01', dayIndex: 4, timeSlot: '16:00 - 17:00', atencionType: 'psicología clínica', estatus: 'Pendiente', modalidad: 'Virtual', roomUrl: 'https://meet.jit.si/mind_sebas_martinez_2' },
    { id: 'ap_7', patientName: 'Andrés Felipe Correa', patientId: 'pat_03', dayIndex: 5, timeSlot: '10:00 - 11:00', atencionType: 'otro', estatus: 'Confirmada', modalidad: 'Presencial', roomUrl: '' },
    { id: 'ap_8', patientName: 'Dr. Roberto Carvajal (Sujeto A)', patientId: 'pat_02', dayIndex: 0, timeSlot: '15:00 - 16:00', atencionType: 'toma de datos/investigación', estatus: 'Confirmada', modalidad: 'Virtual', roomUrl: 'https://meet.jit.si/mind_research_session_8' }
  ]);

  const [reprogramaciones, setReprogramaciones] = useState([
    { id: 'rep_1', patientName: 'Valeria Sotomayor', originalTime: 'Mar 15:00', requestedTime: 'Mar 17:30', reason: 'Cruce imprevisto con horario laboral unificado' },
    { id: 'rep_2', patientName: 'Mauricio Gómez Ruiz', originalTime: 'Jue 09:00', requestedTime: 'Vier 11:30', reason: 'Incapacidad médica certificada por migraña' },
    { id: 'rep_3', patientName: 'Daniela Castro Pérez', originalTime: 'Sáb 08:30', requestedTime: 'Sáb 14:00', reason: 'Falla técnica de traslado / calamidad vial' },
  ]);

  const [showExportReportModal, setShowExportReportModal] = useState(false);
  const [selectedPdfPatient, setSelectedPdfPatient] = useState<Patient | null>(null);

  // Search filter query inside the calendar list
  const [calendarSearchQuery, setCalendarSearchQuery] = useState('');
  const [calendarTypeFilter, setCalendarTypeFilter] = useState('todos');
  const [calendarStatusFilter, setCalendarStatusFilter] = useState('todos');

  // ============================================================================
  // RESEARCH STATE (Nuevos estados para flujo de investigación)
  // ============================================================================
  const [researchData] = useState<ResearchProject[]>(researchProjects);
  const [subjects, setSubjects] = useState<ResearchSubject[]>(researchSubjects);
  const [screeningData] = useState<ScreeningData[]>(screeningDataCollection);
  const [appointments] = useState<ResearchAppointment[]>(researchAppointments);
  const [selectedProject, setSelectedProject] = useState<ResearchProject | null>(researchProjects[0]);
  const [selectedSubject, setSelectedSubject] = useState<ResearchSubject | null>(researchSubjects[0]);

  // ============================================================================
  // DOCUMENT PIPELINE (Backend RAG) - NUEVO
  // ============================================================================
  const [myDocuments, setMyDocuments] = useState<any[]>([]);

  const fetchDocuments = async (type: 'clinico' | 'investigacion' = 'clinico') => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:9000/api/documents/list?type=${type}`, {
        headers: { 'Authorization': `Bearer ${token}` }
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
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    try {
      await fetch('http://localhost:9000/api/documents/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      await fetchDocuments(type);
      alert(`Documento "${file.name}" subido correctamente`);
    } catch (error) {
      console.error('Upload error:', error);
      alert('Error al subir el documento');
    }
  };

  const processDocument = async (documentId: string) => {
    const token = localStorage.getItem('token');
    try {
      await fetch('http://localhost:9000/api/documents/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ documentId })
      });
      alert('Procesamiento iniciado en segundo plano');
      setTimeout(() => fetchDocuments(), 2000);
    } catch (error) {
      console.error('Process error:', error);
      alert('Error al procesar el documento');
    }
  };

  // Cargar documentos cuando se activa la pestaña Drive
  useEffect(() => {
    if (activeTab === 'drive') {
      fetchDocuments('clinico');
    }
  }, [activeTab]);

  // ============================================================================
  // FUNCIONES CLÍNICAS (Intactas)
  // ============================================================================

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
        psychologistId: user.id,
        psychologistName: user.name,
        sessionNumber: nextSessionNumber,
        reason: noteForm.reason,
        mentalStatus: noteForm.mentalStatus,
        intervention: noteForm.intervention,
        evolution: noteForm.evolution,
        diagnosis: noteForm.diagnosis,
        recommendations: noteForm.recommendations
      };

      setProgressNotes(prev => [signedNote, ...prev]);

      setPatients(prev => prev.map(p => {
        if (p.id === selectedPatient.id) {
          return {
            ...p,
            progressNotesCount: p.progressNotesCount + 1,
            lastSessionDate: signedNote.date
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
        uploadedBy: user.name,
        patientId: selectedPatient.id,
        category: 'Historia Clínica'
      };
      setClinicalFiles(prev => [newFileDoc, ...prev]);

      setNoteForm({
        reason: '',
        mentalStatus: '',
        intervention: '',
        evolution: '',
        diagnosis: 'F41.1 Trastorno de Ansiedad Generalizada',
        recommendations: ''
      });
      setIsSigningNote(false);
      setNoteAlert('✅ ¡Nota clínica firmada y estampada digitalmente con éxito! Expediente actualizado en el Drive Clínico.');

      setSelectedPatient(prev => prev ? {
        ...prev,
        progressNotesCount: prev.progressNotesCount + 1,
        lastSessionDate: signedNote.date
      } : null);

      setTimeout(() => setNoteAlert(null), 5000);
    }, 1500);
  };

  const startVideoSession = (session: VideoSession) => {
    console.log("[TELEHEALTH HOOK] Inicializando videoconsulta con:", session.patientName);
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
      evolution: 'Evolución moderadamente favorable, ha logrado reducir sus autojuicios severos.'
    }));
  };

  const filteredTests = psychometricTestsCatalogue.filter(t =>
    t.name.toLowerCase().includes(testSearchQuery.toLowerCase()) ||
    t.category.toLowerCase().includes(testSearchQuery.toLowerCase())
  );

  return (
    <div className="flex h-[calc(110vh-70px)] bg-slate-50 overflow-hidden font-sans">

      {/* SIDEBAR NAVIGATION */}
      <aside className="w-16 md:w-64 bg-charcoal-950 text-slate-300 flex flex-col justify-between shrink-0 border-r border-charcoal-800">
        <div className="py-6 flex flex-col space-y-2">

          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${activeTab === 'dashboard'
              ? 'bg-charcoal-900 text-white font-semibold'
              : 'hover:bg-charcoal-900 hover:text-white'
              }`}
          >
            <LayoutDashboard className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Tablero de Gestión (EHR)</span>
            {activeTab === 'dashboard' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          <button
            onClick={() => setActiveTab('video')}
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${activeTab === 'video'
              ? 'bg-charcoal-900 text-white font-semibold'
              : 'hover:bg-charcoal-900 hover:text-white'
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
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${activeTab === 'evaluations'
              ? 'bg-charcoal-900 text-white font-semibold'
              : 'hover:bg-charcoal-900 hover:text-white'
              }`}
          >
            <ClipboardList className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Pruebas y Evaluaciones</span>
            {activeTab === 'evaluations' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          <button
            onClick={() => setActiveTab('drive')}
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${activeTab === 'drive'
              ? 'bg-charcoal-900 text-white font-semibold'
              : 'hover:bg-charcoal-900 hover:text-white'
              }`}
          >
            <FolderLock className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Pipeline de Documentos RAG</span>
            {activeTab === 'drive' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          <button
            onClick={() => setActiveTab('chat')}
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${activeTab === 'chat'
              ? 'bg-charcoal-900 text-white font-semibold'
              : 'hover:bg-charcoal-900 hover:text-white'
              }`}
          >
            <div className="relative">
              <MessageSquare className="w-5 h-5 shrink-0" />
              <span className="absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full bg-toast-500 animate-pulse" />
            </div>
            <span className="ml-3 text-xs hidden md:block">Mensajería Clínica</span>
            {activeTab === 'chat' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          {/* RESEARCH WORKFLOW TABS (Mostradas solo en contexto de investigación) */}
          {workspaceContext === 'research' && (
            <>
              <div className="my-2 mx-3 border-t border-charcoal-700" />
              <button
                onClick={() => setActiveTab('research')}
                className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${activeTab === 'research'
                  ? 'bg-charcoal-900 text-white font-semibold'
                  : 'hover:bg-charcoal-900 hover:text-white'
                  }`}
              >
                <Beaker className="w-5 h-5 shrink-0" />
                <span className="ml-3 text-xs hidden md:block">Proyectos de Investigación</span>
                {activeTab === 'research' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
              </button>
              <button
                onClick={() => setActiveTab('screening')}
                className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${activeTab === 'screening'
                  ? 'bg-charcoal-900 text-white font-semibold'
                  : 'hover:bg-charcoal-900 hover:text-white'
                  }`}
              >
                <TrendingUp className="w-5 h-5 shrink-0" />
                <span className="ml-3 text-xs hidden md:block">Tamizaje y Datos</span>
                {activeTab === 'screening' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
              </button>
            </>
          )}
        </div>

        {/* License Signature Block */}
        <div className="p-4 border-t border-charcoal-800 hidden md:block bg-charcoal-950/40 text-left">
          <div className="flex items-center space-x-2 text-toast-400 mb-1">
            <Award className="w-4 h-4" />
            <span className="text-[10px] font-bold font-mono uppercase tracking-wider">Licencia Verificada</span>
          </div>
          <p className="text-[10px] text-slate-500 font-mono truncate">{user.licenseNumber}</p>
        </div>
      </aside>

      {/* PORTAL MAIN AREA */}
      <main className="flex-1 overflow-y-auto p-6 md:p-8">

        {/* VIEW: INTERNAL CHAT */}
        {activeTab === 'chat' && (
          <div className="max-w-7xl mx-auto">
            <InternalChat currentUser={user} />
          </div>
        )}

        {/* VIEW: DASHBOARD / GENERAL OVERVIEW (COMPLETO) */}
        {activeTab === 'dashboard' && (
          <div className="max-w-7xl mx-auto space-y-6">

            {/* MindPsic Welcome & Active Profile Information Banner */}
            <div className="bg-gradient-to-r from-charcoal-900 to-charcoal-950 border border-toast-300 rounded-2xl p-6 md:p-8 text-white shadow-xl relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="absolute top-0 right-0 w-64 h-64 bg-toast-400/10 rounded-full blur-2xl transform translate-x-12 -translate-y-12" />
              <div className="space-y-2 z-10 text-left">
                <div className="flex items-center space-x-1">
                  <span className="bg-toast-500/30 text-toast-300 text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full border border-toast-500/20">
                    Área Médica Activa
                  </span>
                </div>
                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                  Hola, Dra. {user.name} <span className="text-toast-300 font-sans font-normal text-sm block sm:inline sm:ml-2">— Psicólogo / Investigador</span>
                </h1>
                <p className="text-toast-100 text-xs max-w-lg leading-relaxed font-sans">
                  Bienvenido al panel consultor unificado de historias clínicas electrónicas de MindPsic. Dr.Mind está disponible a la derecha para asistir tu jornada terapéutica actual.
                </p>
              </div>

              <div className="bg-charcoal-900/65 p-4 rounded-xl border border-charcoal-800 flex flex-col shrink-0 text-left min-w-48 z-10">
                <span className="text-[9px] text-toast-400 font-bold uppercase font-mono tracking-widest">Sincronización Clínica</span>
                <span className="text-xs text-slate-300 font-medium font-mono mt-1 flex items-center">
                  <CloudLightning className="w-3.5 h-3.5 mr-1 text-toast-400" />
                  Conectado • Secure TLS
                </span>
                <span className="text-[10px] text-slate-500 font-mono mt-0.5">ESTADO: 2026-05-30 UTC</span>
              </div>
            </div>

            {/* EHR CLINICAL PERFORMANCE SUMMARY & ACTIVITY REPORT */}
            <div className="bg-white rounded-2xl border border-toast-200 p-5 md:p-6 shadow-xs text-left">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-toast-200 pb-4 mb-5 gap-3">
                <div className="space-y-0.5">
                  <h2 className="font-serif font-black text-lg text-charcoal-900 tracking-tight flex items-center">
                    <Activity className="w-5 h-5 mr-1.5 text-toast-500" />
                    Métricas de Productividad & Cumplimiento Clínico
                  </h2>
                  <p className="text-xs text-toast-400">Coordinación de atenciones prestadas e indicadores de reprogramación de citas.</p>
                </div>

                <button
                  onClick={() => setShowExportReportModal(true)}
                  className="bg-charcoal-900 hover:bg-charcoal-950 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center cursor-pointer gap-1.5 self-start"
                >
                  <Download className="w-4 h-4" />
                  <span>Exportar Reportes de Actividad</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-toast-50 p-4 rounded-xl border border-toast-200 flex flex-col justify-between">
                  <span className="text-[10px] uppercase font-mono font-extrabold text-toast-500 tracking-wider">Atenciones Hoy</span>
                  <div>
                    <span className="text-2xl font-serif font-black text-charcoal-900 block mt-2">5 Consultas</span>
                    <span className="text-[10px] text-toast-500 font-semibold flex items-center mt-1">
                      ● 100% Cobertura de Agenda
                    </span>
                  </div>
                </div>

                <div className="bg-toast-50 p-4 rounded-xl border border-toast-200 flex flex-col justify-between">
                  <span className="text-[10px] uppercase font-mono font-extrabold text-toast-500 tracking-wider">Atenciones Mes</span>
                  <div>
                    <span className="text-2xl font-serif font-black text-charcoal-900 block mt-2">84 Completadas</span>
                    <span className="text-[10px] text-toast-400 mt-1 block">Sincronizado con RIPS de Cobro</span>
                  </div>
                </div>

                <div className="bg-toast-50 p-4 rounded-xl border border-toast-200 flex flex-col justify-between">
                  <span className="text-[10px] uppercase font-mono font-extrabold text-toast-500 tracking-wider">Psicólogos Activos</span>
                  <div>
                    <span className="text-2xl font-serif font-black text-charcoal-900 block mt-2">14 en Turno</span>
                    <span className="text-[10px] text-toast-400 mt-1 block">Consorcio Clínico MindPsic</span>
                  </div>
                </div>

                <div className="bg-toast-100/60 p-4 rounded-xl border border-toast-200 text-xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] uppercase font-mono font-extrabold text-toast-500 tracking-widest">Reprogramaciones</span>
                    <span className="bg-toast-300 text-toast-600 px-1.5 py-0.2 rounded-md font-mono text-[9px] font-extrabold">
                      {reprogramaciones.length} Alertas
                    </span>
                  </div>
                  <div className="space-y-1.5 text-[10px] leading-tight text-charcoal-700">
                    {reprogramaciones.map(rep => (
                      <div key={rep.id} className="border-l-2 border-toast-400 pl-1.5 py-0.5">
                        <span className="font-bold block text-charcoal-900">{rep.patientName}</span>
                        <span className="text-toast-500 mt-0.5 block">{rep.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* QUICK SUMMARY PATIENTS GRID FOR TODAY */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Daily Schedule Row */}
              <div className="lg:col-span-2 bg-white rounded-2xl border border-toast-200 shadow-xs p-5 space-y-5 text-left flex flex-col justify-between">
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-toast-200 pb-3 gap-3">
                    <div className="space-y-0.5">
                      <h2 className="font-serif font-black text-base text-charcoal-900 tracking-tight flex items-center">
                        <Clock className="w-5 h-5 mr-1.5 text-toast-500" />
                        Agenda Médica &amp; Control de Turno
                      </h2>
                      <p className="text-xs text-toast-400">Organice y valide sus consultas asignadas en el ecosistema.</p>
                    </div>

                    <div className="inline-flex rounded-xl bg-toast-100 p-1 self-start">
                      <button
                        type="button"
                        onClick={() => setCalendarViewMode('semana')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${calendarViewMode === 'semana'
                            ? 'bg-charcoal-900 text-white shadow-xs'
                            : 'text-charcoal-600 hover:text-charcoal-900'
                          }`}
                      >
                        Vista Semana
                      </button>
                      <button
                        type="button"
                        onClick={() => setCalendarViewMode('dia')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${calendarViewMode === 'dia'
                            ? 'bg-charcoal-900 text-white shadow-xs'
                            : 'text-charcoal-600 hover:text-charcoal-900'
                          }`}
                      >
                        Vista Global Día
                      </button>
                    </div>
                  </div>

                  <div className="bg-toast-50 p-3.5 rounded-xl border border-toast-200 grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 text-xs">
                    <div>
                      <label className="block text-[10px] uppercase font-mono font-extrabold text-toast-500 mb-1">Buscar Paciente</label>
                      <input
                        type="text"
                        value={calendarSearchQuery}
                        onChange={(e) => setCalendarSearchQuery(e.target.value)}
                        placeholder="Escriba nombre..."
                        className="w-full text-xs p-2 bg-white border border-toast-200 rounded-lg text-charcoal-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-mono font-extrabold text-toast-500 mb-1">Tipo de Atención</label>
                      <select
                        value={calendarTypeFilter}
                        onChange={(e) => setCalendarTypeFilter(e.target.value)}
                        className="w-full text-xs p-2 bg-white border border-toast-200 rounded-lg text-charcoal-900"
                      >
                        <option value="todos">Todos los Tipos</option>
                        <option value="psicología de la sexualidad">Psicología de la Sexualidad</option>
                        <option value="psicooncología">Psicooncología</option>
                        <option value="psicología clínica">Psicología Clínica</option>
                        <option value="neuropsicología">Neuropsicología</option>
                        <option value="psicología del sueño">Psicología del Sueño</option>
                        <option value="toma de datos/investigación">Toma de Datos / Investigación</option>
                        <option value="otro">Otro</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-mono font-extrabold text-toast-500 mb-1">Estado de Cita</label>
                      <select
                        value={calendarStatusFilter}
                        onChange={(e) => setCalendarStatusFilter(e.target.value)}
                        className="w-full text-xs p-2 bg-white border border-toast-200 rounded-lg text-charcoal-900"
                      >
                        <option value="todos">Todos los Estados</option>
                        <option value="Confirmada">Confirmada</option>
                        <option value="Pendiente">Pendiente</option>
                      </select>
                    </div>
                  </div>

                  {calendarViewMode === 'semana' && (
                    <div className="grid grid-cols-6 gap-1 mt-4">
                      {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((dayName, idx) => (
                        <button
                          key={dayName}
                          onClick={() => setSelectedCalendarDay(idx)}
                          className={`py-2 text-center rounded-xl font-bold text-xs cursor-pointer transition-all border ${selectedCalendarDay === idx
                              ? 'bg-toast-500 text-white border-toast-500 shadow-xs'
                              : 'bg-toast-50/50 hover:bg-toast-100/50 text-charcoal-600 border-toast-200'
                            }`}
                        >
                          <span className="block text-[8px] opacity-75 uppercase font-mono tracking-widest">Día</span>
                          {dayName}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="space-y-3 mt-5">
                    {weeklyAppointments
                      .filter((app) => {
                        if (calendarViewMode === 'semana' && app.dayIndex !== selectedCalendarDay) return false;
                        if (calendarSearchQuery && !app.patientName.toLowerCase().includes(calendarSearchQuery.toLowerCase())) return false;
                        if (calendarTypeFilter !== 'todos' && app.atencionType !== calendarTypeFilter) return false;
                        if (calendarStatusFilter !== 'todos' && app.estatus !== calendarStatusFilter) return false;
                        return true;
                      })
                      .map((app) => {
                        const patObj = patients.find(p => p.id === app.patientId);
                        const isVirtual = app.modalidad === 'Virtual';

                        return (
                          <div
                            key={app.id}
                            className={`p-4 rounded-xl border flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 transition-all ${app.estatus === 'Confirmada'
                                ? 'bg-toast-50/40 border-toast-200'
                                : 'bg-toast-50/25 border-toast-200'
                              }`}
                          >
                            <div className="flex items-start space-x-3.5">
                              <div className={`w-2.5 h-12 rounded-full shrink-0 ${app.estatus === 'Confirmada' ? 'bg-charcoal-900' : 'bg-toast-400'
                                }`} />
                              <div className="space-y-1">
                                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                                  <h4 className="text-xs font-bold text-charcoal-950">{app.patientName}</h4>
                                  <span className={`text-[9px] font-extrabold px-2 py-0.2 rounded-full uppercase ${app.estatus === 'Confirmada'
                                      ? 'bg-charcoal-900 text-white'
                                      : 'bg-toast-200 text-charcoal-700'
                                    }`}>
                                    {app.estatus}
                                  </span>
                                  <span className="bg-toast-200 text-charcoal-700 text-[8px] font-mono font-bold px-1.5 py-0.2 rounded-md uppercase">
                                    {app.modalidad}
                                  </span>
                                </div>
                                <p className="text-[10px] text-toast-500 font-mono capitalize">
                                  Servicio: <strong className="text-charcoal-800">{app.atencionType}</strong> — Hora: <span className="font-bold underline text-charcoal-700">{app.timeSlot}</span>
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center space-x-1.5 self-end sm:self-auto">
                              <button
                                onClick={() => {
                                  setWeeklyAppointments(prev => prev.map(item => {
                                    if (item.id === app.id) {
                                      return { ...item, estatus: item.estatus === 'Confirmada' ? 'Pendiente' : 'Confirmada' };
                                    }
                                    return item;
                                  }));
                                }}
                                className="text-[10px] bg-white hover:bg-toast-100 border border-toast-200 p-1.5 rounded-lg text-charcoal-700 font-semibold cursor-pointer"
                              >
                                {app.estatus === 'Confirmada' ? 'Marcar Pendiente' : 'Confirmar Cita'}
                              </button>

                              {isVirtual && app.estatus === 'Confirmada' && (
                                <button
                                  onClick={() => {
                                    const matchingSession = videoSessions.find(vs => vs.patientName === app.patientName);
                                    if (matchingSession) {
                                      startVideoSession(matchingSession);
                                    } else {
                                      const mockSess: VideoSession = {
                                        id: 'v_slot_' + Date.now(),
                                        patientId: app.patientId,
                                        patientName: app.patientName,
                                        time: app.timeSlot,
                                        date: 'Hoy',
                                        status: 'en_progreso',
                                        roomUrl: app.roomUrl
                                      };
                                      startVideoSession(mockSess);
                                    }
                                  }}
                                  className="text-[10px] bg-toast-500 hover:bg-toast-600 text-white font-bold px-3 py-1.5 rounded-lg flex items-center cursor-pointer shadow-xs whitespace-nowrap"
                                >
                                  <Video className="w-3.5 h-3.5 mr-1 text-white shrink-0" />
                                  Unirse a Sesión
                                </button>
                              )}

                              <button
                                onClick={() => {
                                  if (patObj) {
                                    setSelectedPatient(patObj);
                                    setSelectedFolderId(patObj.id);
                                  }
                                }}
                                className="p-1.5 bg-white hover:bg-toast-100 border border-toast-200 rounded-lg text-charcoal-700"
                              >
                                <FileText className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}

                    {weeklyAppointments.filter((app) => {
                      if (calendarViewMode === 'semana' && app.dayIndex !== selectedCalendarDay) return false;
                      if (calendarSearchQuery && !app.patientName.toLowerCase().includes(calendarSearchQuery.toLowerCase())) return false;
                      if (calendarTypeFilter !== 'todos' && app.atencionType !== calendarTypeFilter) return false;
                      if (calendarStatusFilter !== 'todos' && app.estatus !== calendarStatusFilter) return false;
                      return true;
                    }).length === 0 && (
                        <div className="py-8 bg-toast-50 rounded-xl border border-dashed border-toast-300 text-center text-xs text-toast-400 font-sans">
                          No hay citas clínicas agendadas que coincidan con los filtros seleccionados.
                        </div>
                      )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-toast-200 text-[10px] text-toast-400 flex items-center justify-between">
                  <span>Modo visualizado: Agenda del Consorcio</span>
                  <span className="font-mono">Frecuencia de Sincronización: Activa (10s)</span>
                </div>
              </div>

              {/* Primary Active Patient Profile Card */}
              <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 text-left flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                    <h2 className="font-bold text-sm text-slate-800 tracking-tight">Expediente Clínico Activo</h2>
                    <span className="text-[9px] bg-toast-100 text-toast-500 font-bold px-2 py-0.5 rounded-full uppercase border border-toast-300">
                      Sincronizado
                    </span>
                  </div>

                  {selectedPatient ? (
                    <div className="space-y-3.5">
                      <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 rounded-xl bg-toast-100 border border-toast-300 text-toast-500 flex items-center justify-center font-bold text-lg shadow-2xs">
                          {selectedPatient.name.charAt(0)}
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">{selectedPatient.name}</h3>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">{selectedPatient.email}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-100 text-xs text-slate-600 gap-y-2.5">
                        <div>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Identificación</p>
                          <p className="font-medium text-slate-800 font-mono">{selectedPatient.id}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Edad / Género</p>
                          <p className="font-medium text-slate-800">{selectedPatient.age} años • {selectedPatient.gender}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Teléfono de Contacto</p>
                          <p className="font-medium text-slate-800 font-mono">{selectedPatient.phone}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Convenio Activo</p>
                          <p className="font-semibold text-toast-500">{selectedPatient.agreement}</p>
                        </div>
                        <div className="col-span-2 border-t border-slate-200/50 pt-2">
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Dirección Local Registrada</p>
                          <p className="font-medium text-slate-800 font-mono text-[11px]">Calle 100 #8A-34, Cantón Regional Bogotá, COL</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-100 mt-2">
                        <span className="text-slate-400">Sesiones Registradas:</span>
                        <strong className="text-slate-800 font-bold font-mono">{selectedPatient.progressNotesCount} notas</strong>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Última Sesión:</span>
                        <strong className="text-slate-800 font-bold font-mono">{selectedPatient.lastSessionDate || 'Ninguna'}</strong>
                      </div>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-slate-400 text-xs">
                      Selecciona un paciente para ver su perfil consolidado.
                    </div>
                  )}
                </div>

                {selectedPatient && (
                  <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col gap-2">
                    <button
                      onClick={() => {
                        setSelectedFolderId(selectedPatient.id);
                        setActiveTab('drive');
                      }}
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2.5 rounded-xl transition-colors cursor-pointer text-center flex items-center justify-center shadow-xs"
                    >
                      <FolderLock className="w-3.5 h-3.5 mr-1" />
                      Revisar notas históricas
                    </button>

                    <button
                      onClick={() => setSelectedPdfPatient(selectedPatient)}
                      className="w-full bg-charcoal-900 hover:bg-charcoal-950 text-white text-xs font-bold py-2.5 rounded-xl transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 shadow-xs"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Generar Historia Clínica (PDF)</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* EXPEDIENTE CLINICO LIVE NOTEBOOK WRITER */}
            {selectedPatient && (
              <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 md:p-6 text-left">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 mb-4 gap-3">
                  <div className="space-y-0.5">
                    <h2 className="font-extrabold text-sm text-slate-900 tracking-tight flex items-center">
                      <PlusCircle className="w-5 h-5 mr-1.5 text-toast-500" />
                      Redacción de Nota de Evolución Clínica
                    </h2>
                    <p className="text-xs text-slate-400">
                      Crea evoluciones firmadas bajo firma digital TP del profesional titular, con guardado directo al Drive Clínico.
                    </p>
                  </div>

                  <button
                    onClick={handleRequestAISuggestion}
                    className="bg-toast-100 hover:bg-toast-200 text-charcoal-900 px-3.5 py-2 rounded-xl text-xs font-bold border border-toast-300 transition-all flex items-center gap-1.5 self-start cursor-pointer group"
                  >
                    <Sparkles className="w-4 h-4 text-toast-500 animate-spin" style={{ animationDuration: '4s' }} />
                    <span>Auxilio Clínico Dr.Mind AI</span>
                  </button>
                </div>

                {noteAlert && (
                  <div className={`p-4 rounded-xl text-xs border mb-4 font-medium flex items-center ${noteAlert.startsWith('✅') ? 'bg-toast-100 text-charcoal-900 border-toast-300' : 'bg-charcoal-900 text-white border-charcoal-950'
                    }`}>
                    <AlertCircle className="w-4.5 h-4.5 mr-2 shrink-0 text-current" />
                    <span>{noteAlert}</span>
                  </div>
                )}

                <form onSubmit={handleSignNote} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        1. Motivo de Consulta o Seguimiento *
                      </label>
                      <textarea
                        rows={3}
                        required
                        value={noteForm.reason}
                        onChange={(e) => setNoteForm(prev => ({ ...prev, reason: e.target.value }))}
                        placeholder="Describa el foco de la sesión actual y rumiaciones tratadas externamente..."
                        className="block w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 focus:ring-2 focus:ring-charcoal-900 focus:outline-hidden text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        2. Examen del Estado Mental Sugerido *
                      </label>
                      <textarea
                        rows={3}
                        required
                        value={noteForm.mentalStatus}
                        onChange={(e) => setNoteForm(prev => ({ ...prev, mentalStatus: e.target.value }))}
                        placeholder="Orientación, afecto, discurso, ideaciones autolíticas o delirios..."
                        className="block w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 focus:ring-2 focus:ring-charcoal-900 focus:outline-hidden text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        3. Intervención Clínica Realizada *
                      </label>
                      <textarea
                        rows={3}
                        required
                        value={noteForm.intervention}
                        onChange={(e) => setNoteForm(prev => ({ ...prev, intervention: e.target.value }))}
                        placeholder="Reestructuración cognitiva cognitiva, técnicas dialécticas aplicadas, confrontaciones..."
                        className="block w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 focus:ring-2 focus:ring-charcoal-900 focus:outline-hidden text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        4. Evolución y Respuesta Psicológica *
                      </label>
                      <textarea
                        rows={3}
                        required
                        value={noteForm.evolution}
                        onChange={(e) => setNoteForm(prev => ({ ...prev, evolution: e.target.value }))}
                        placeholder="Nivel de asimilación del insight, resistencia al cambio observada..."
                        className="block w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 focus:ring-2 focus:ring-charcoal-900 focus:outline-hidden text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Diagnóstico CIE-10 Relacionado
                      </label>
                      <select
                        value={noteForm.diagnosis}
                        onChange={(e) => setNoteForm(prev => ({ ...prev, diagnosis: e.target.value }))}
                        className="block w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 focus:ring-2 focus:ring-charcoal-900 focus:outline-hidden text-slate-905"
                      >
                        <option value="F41.1 Trastorno de Ansiedad Generalizada">F41.1 Trastorno de Ansiedad Generalizada</option>
                        <option value="F43.2 Trastornos de Adaptación Temprana">F43.2 Trastornos de Adaptación Temprana</option>
                        <option value="F32.9 Episodio Depresivo No Especificado">F32.9 Episodio Depresivo No Especificado</option>
                        <option value="F43.21 Reacción Depresiva Prolongada">F43.21 Reacción Depresiva Prolongada</option>
                        <option value="Z73.0 Agotamiento Físico o Mental Extremo (Burnout)">Z73.0 Agotamiento Físico o Mental Extremo (Burnout)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Tareas y Recomendaciones para Casa
                      </label>
                      <input
                        type="text"
                        value={noteForm.recommendations}
                        onChange={(e) => setNoteForm(prev => ({ ...prev, recommendations: e.target.value }))}
                        placeholder="Registros diarios de rumiación nocturna, bloqueo luz azul corporativo..."
                        className="block w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 focus:ring-2 focus:ring-charcoal-900 focus:outline-hidden text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4 flex gap-3 justify-end items-center">
                    <span className="text-[10px] text-slate-400 font-mono">
                      Nota se firmará como Profesional: Dra. {user.name} ({user.licenseNumber})
                    </span>
                    <button
                      type="submit"
                      disabled={isSigningNote}
                      className="bg-charcoal-900 hover:bg-charcoal-950 disabled:bg-slate-300 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all shadow-md flex items-center cursor-pointer border border-charcoal-950"
                    >
                      {isSigningNote ? (
                        <>
                          <CloudLightning className="w-4 h-4 mr-1.5 animate-spin text-toast-300" />
                          Firmando digitalmente...
                        </>
                      ) : (
                        <>
                          <Key className="w-3.5 h-3.5 mr-1.5" />
                          Firmar Nota Clínica
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}

        {/* VIEW: VIDEO-CALL / TELEHEALTH INTERFACES */}
        {activeTab === 'video' && (
          <div className="max-w-7xl mx-auto space-y-6 text-left">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5 md:p-6">
              <div className="border-b border-toast-200 pb-3 mb-6">
                <h2 className="text-sm font-extrabold text-slate-900 tracking-tight flex items-center">
                  <Video className="w-5 h-5 mr-1.5 text-toast-500" />
                  Conectar con plataforma MindHealth
                </h2>
                <p className="text-xs text-slate-400">Canal cifrado de alta definición con paciente habilitado.</p>
              </div>

              {activeVideoCall ? (
                <div className="bg-white rounded-xl border border-slate-100 shadow-xs flex flex-col h-[75vh]">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4 p-5">
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 rounded-full bg-toast-100 flex items-center justify-center text-toast-800 font-bold text-lg">
                        {activeVideoCall.patientName.charAt(0)}
                      </div>
                      <div>
                        <h2 className="font-bold text-lg text-slate-800 tracking-tight leading-none mb-1">
                          {activeVideoCall.patientName}
                        </h2>
                        <span className="text-xs font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full uppercase">
                          {activeVideoCall.status === 'en_progreso' ? 'Sesión en curso' : activeVideoCall.status}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => setActiveVideoCall(null)}
                      className="bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs px-4 py-2 rounded-xl transition-all cursor-pointer"
                    >
                      Finalizar Sesión
                    </button>
                  </div>

                  <div className="flex-1 w-full bg-charcoal-950 rounded-b-xl overflow-hidden relative">
                    <VideollamadaVercel
                      pacienteId={activeVideoCall.patientId}
                      salaId={activeVideoCall.id}
                    />
                  </div>
                </div>
              ) : (
                <div className="py-12 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-center p-6 space-y-4 max-w-lg mx-auto">
                  <div className="w-12 h-12 bg-toast-100 text-toast-500 rounded-full flex items-center justify-center border border-toast-300 shadow-2xs">
                    <Video className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-bold text-slate-800 text-sm">No hay consultas de video activas</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Selecciona una llamada programada de la pestaña principal o del listado diario para asignar la cámara y activar la telepresencia.
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveVideoCall(videoSessions[0])}
                    className="bg-charcoal-900 hover:bg-charcoal-950 text-white font-semibold text-xs px-4 py-2.5 rounded-xl transition-all cursor-pointer shadow-sm"
                  >
                    Iniciar Sesión Demo de Prueba
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW: PSYCHOMETRIC EVALUATIONS CATALOGUE & RESEARCH */}
        {activeTab === 'evaluations' && (
          <div className="max-w-7xl mx-auto space-y-6 text-left">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 shadow-xs p-5 md:p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="space-y-0.5">
                    <h2 className="font-bold text-sm text-slate-900 tracking-tight flex items-center">
                      <ClipboardList className="w-5 h-5 mr-1.5 text-toast-500" />
                      Catálogo Avanzado de Pruebas Psicométricas y Escalas
                    </h2>
                    <p className="text-xs text-slate-400">Encuentra y envía tests clínicos validados científicos directos al correo del paciente.</p>
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="w-4 h-4 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    value={testSearchQuery}
                    onChange={(e) => setTestSearchQuery(e.target.value)}
                    placeholder="Escribe para buscar (ej: Beck, MMPI, Mini-Mental, Personalidad...)"
                    className="block w-full text-xs pl-9 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-charcoal-900 focus:outline-hidden"
                  />
                </div>

                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {filteredTests.map((test) => (
                    <div
                      key={test.id}
                      className="p-4 bg-slate-50 hover:bg-slate-50/50 rounded-xl border border-slate-100 transition-all flex flex-col md:flex-row md:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 select-none flex-1">
                        <div className="flex items-center space-x-2">
                          <h3 className="text-xs font-bold text-slate-800">{test.name}</h3>
                          <span className="bg-toast-100 text-toast-500 text-[9px] font-bold px-2 rounded-md uppercase border border-toast-200">
                            {test.category}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed font-sans">{test.description}</p>
                        <div className="flex items-center space-x-4 text-[10px] text-slate-400 font-medium">
                          <span>⏱️ {test.duration}</span>
                          <span className={`font-mono flex items-center ${test.difficulty === 'Alta' ? 'text-toast-500 font-bold' : 'text-slate-500'
                            }`}>Dificultad de Aplicación: {test.difficulty}</span>
                        </div>
                      </div>

                      <div className="shrink-0">
                        <button
                          onClick={() => {
                            if (!selectedPatient) return;
                            const newTestState: PatientTestState = {
                              id: 'pt_' + Date.now(),
                              testId: test.id,
                              testName: test.name,
                              patientId: selectedPatient.id,
                              patientName: selectedPatient.name,
                              status: 'enviado',
                              sentDate: new Date().toISOString().split('T')[0]
                            };
                            setPatientTests(prev => [newTestState, ...prev]);
                            alert(`Enviado test "${test.name}" al paciente "${selectedPatient.name}" vía correo de consentimiento.`);
                          }}
                          className="bg-white hover:bg-charcoal-900 hover:text-white text-charcoal-900 border border-toast-300 hover:border-charcoal-900 text-xs font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                        >
                          Asignar Test
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 md:p-6 space-y-4">
                <div className="border-b border-slate-100 pb-2">
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider">Historial de Pruebas Dictadas</h3>
                  <p className="text-[11px] text-slate-400">Estatus y puntaje de escalas enviadas.</p>
                </div>

                <div className="space-y-3">
                  {patientTests.map((pt) => (
                    <div key={pt.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-slate-800 truncate block max-w-[150px]">{pt.testName}</span>
                        <span className={`text-[9px] font-bold uppercase rounded-md px-1.5 py-0.2 ${pt.status === 'completado'
                            ? 'bg-toast-100 text-toast-500'
                            : pt.status === 'enviado'
                              ? 'bg-charcoal-900 text-white animate-pulse'
                              : 'bg-toast-200 text-charcoal-700'
                          }`}>
                          {pt.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">Paciente: <strong className="text-slate-700 font-semibold">{pt.patientName}</strong></p>
                      {pt.score && (
                        <div className="mt-2 p-1.5 px-2 bg-toast-100/40 border border-toast-300 rounded-lg text-[11px] text-charcoal-900 font-medium font-sans">
                          Puntuación: <span className="font-mono font-bold text-toast-500">{pt.score}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1.5 pt-1.5 border-t border-slate-200/50">
                        <span>Enviado: {pt.sentDate}</span>
                        {pt.completedDate && <span>Terminado: {pt.completedDate}</span>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-slate-900 text-slate-300 p-4 rounded-xl border border-slate-800 mt-4 text-left">
                  <div className="flex items-center space-x-2 text-white mb-1.5">
                    <BookOpen className="w-4 h-4 text-toast-400" />
                    <h4 className="text-xs font-bold font-mono uppercase tracking-wider">Ayuda Clínica RAG</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Usa Dr.Mind para buscar guías rápidas de de-escalamiento diagnóstico para trastornos del sueño en adultos trabajadores de forma instantánea.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================== */}
        {/* VIEW: DRIVE - NUEVO PIPELINE DE DOCUMENTOS RAG */}
        {/* ========================================================== */}
        {activeTab === 'drive' && (
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Área de subida de documentos */}
            <div className="border-2 border-dashed border-slate-300 bg-white rounded-2xl p-6 text-center transition-all hover:border-toast-400">
              <input
                type="file"
                id="fileInput"
                className="hidden"
                accept=".pdf,.xlsx,.xls"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    const docType = window.confirm('¿Es un documento clínico? (Aceptar = clínico, Cancelar = investigación)')
                      ? 'clinico'
                      : 'investigacion';
                    uploadDocument(file, docType);
                    e.target.value = '';
                  }
                }}
              />
              <label htmlFor="fileInput" className="cursor-pointer inline-flex flex-col items-center gap-2">
                <div className="w-14 h-14 rounded-full bg-toast-100 flex items-center justify-center text-toast-500 border border-toast-200">
                  <PlusCircle className="w-7 h-7" />
                </div>
                <span className="text-sm font-bold text-charcoal-900">Subir nuevo documento clínico o de investigación</span>
                <span className="text-[10px] text-slate-400">PDF o Excel (máx. 50 MB)</span>
              </label>
            </div>

            {/* Lista de documentos del backend */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <h2 className="text-sm font-extrabold text-charcoal-900 flex items-center gap-2">
                  <FolderLock className="w-5 h-5 text-toast-500" />
                  Documentos del Pipeline RAG
                </h2>
                <button
                  onClick={() => fetchDocuments('clinico')}
                  className="text-[10px] bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded-full"
                >
                  ↻ Refrescar
                </button>
              </div>

              <div className="grid gap-3">
                {myDocuments.length === 0 ? (
                  <div className="text-center text-slate-400 text-xs py-10 bg-slate-50 rounded-xl border border-dashed">
                    No hay documentos subidos. Usa el área superior para cargar tu primer PDF o Excel.
                  </div>
                ) : (
                  myDocuments.map((doc) => (
                    <div key={doc.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl">
                      <div className="flex-1 mb-2 sm:mb-0">
                        <div className="flex items-center gap-2">
                          <File className="w-4 h-4 text-slate-400" />
                          <p className="font-bold text-sm text-charcoal-900 truncate max-w-md" title={doc.filename}>
                            {doc.filename}
                          </p>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${doc.type === 'clinico' ? 'bg-toast-100 text-toast-600' : 'bg-slate-200 text-slate-700'
                            }`}>
                            {doc.type === 'clinico' ? 'Clínico' : 'Investigación'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                          <span>ID: {doc.id.slice(0, 8)}</span>
                          <span>Subido: {new Date(doc.created_at).toLocaleDateString()}</span>
                          <span className={`font-mono font-bold ${doc.status === 'procesado' ? 'text-emerald-600' : doc.status === 'error' ? 'text-red-500' : 'text-amber-500'
                            }`}>
                            Estado: {doc.status}
                          </span>
                        </div>
                      </div>

                      <div>
                        {doc.status === 'pendiente' && (
                          <button
                            onClick={() => processDocument(doc.id)}
                            className="bg-charcoal-900 hover:bg-charcoal-950 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5"
                          >
                            <CloudLightning className="w-3.5 h-3.5" />
                            Analizar con Mind_coreV5
                          </button>
                        )}
                        {doc.status === 'procesado' && (
                          <span className="text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full inline-flex items-center gap-1">
                            <CheckCircle className="w-3.5 h-3.5" />
                            Vectorizado
                          </span>
                        )}
                        {doc.status === 'error' && (
                          <span className="text-xs text-red-500 bg-red-50 px-3 py-1.5 rounded-full cursor-help" title={doc.error_message}>
                            ⚠️ Error
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================== */}
        {/* VIEW: RESEARCH PROJECTS MANAGEMENT (RESEARCH MODE ONLY) */}
        {activeTab === 'research' && workspaceContext === 'research' && (
          <div className="max-w-7xl mx-auto space-y-6 text-left">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 space-y-4 h-fit">
                <h3 className="text-sm font-extrabold text-charcoal-900 flex items-center">
                  <Beaker className="w-5 h-5 mr-2 text-toast-500" />
                  Proyectos Farmacéuticos Activos
                </h3>
                <div className="space-y-2">
                  {researchData.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => setSelectedProject(project)}
                      className={`w-full text-left p-3 rounded-xl transition-all text-xs border cursor-pointer ${selectedProject?.id === project.id
                          ? 'bg-charcoal-900 text-white border-charcoal-950'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                    >
                      <div className="font-bold truncate">{project.code}</div>
                      <div className={`text-[10px] mt-1 ${selectedProject?.id === project.id ? 'text-toast-300' : 'text-slate-500'}`}>
                        {project.enrolledSubjects}/{project.targetSubjects} Sujetos
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {selectedProject && (
                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 shadow-xs p-5 space-y-5">
                  <div className="border-b border-slate-100 pb-4">
                    <h2 className="font-bold text-slate-900 mb-1">{selectedProject.title}</h2>
                    <p className="text-xs text-slate-500">{selectedProject.description}</p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <div className="text-[10px] text-slate-400 uppercase font-mono mb-1">Estado</div>
                      <div className="text-sm font-bold text-charcoal-900 capitalize">{selectedProject.status}</div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <div className="text-[10px] text-slate-400 uppercase font-mono mb-1">PI</div>
                      <div className="text-xs font-semibold text-charcoal-900">{selectedProject.principalInvestigator}</div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <div className="text-[10px] text-slate-400 uppercase font-mono mb-1">Farmacéutica</div>
                      <div className="text-xs font-semibold text-toast-600">{selectedProject.pharmaPartner}</div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <div className="text-[10px] text-slate-400 uppercase font-mono mb-1">Reclutamiento</div>
                      <div className="text-sm font-bold text-charcoal-900">{Math.round((selectedProject.enrolledSubjects / selectedProject.targetSubjects) * 100)}%</div>
                    </div>
                  </div>
                  <div className="p-4 bg-toast-50 rounded-lg border border-toast-200">
                    <h3 className="text-xs font-bold text-charcoal-900 mb-3">Sujetos de Estudio Reclutados</h3>
                    <div className="space-y-2">
                      {subjects.filter(s => s.projectId === selectedProject.id).map((subject) => (
                        <div key={subject.id} className="p-3 bg-white rounded-lg border border-slate-100 text-xs flex items-center justify-between">
                          <div className="flex-1">
                            <div className="font-semibold text-charcoal-900">{subject.code}</div>
                            <div className="text-slate-500">{subject.name}</div>
                          </div>
                          <span className={`text-[9px] font-bold px-2 py-1 rounded-full ${subject.screeningStatus === 'enrolled'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-200 text-slate-700'
                            }`}>
                            {subject.screeningStatus}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================== */}
        {/* VIEW: SCREENING & DATA COLLECTION (RESEARCH MODE ONLY) */}
        {activeTab === 'screening' && workspaceContext === 'research' && (
          <div className="max-w-7xl mx-auto space-y-6 text-left">
            <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 md:p-6">
              <div className="border-b border-slate-100 pb-4 mb-4">
                <h2 className="text-sm font-extrabold text-charcoal-900 flex items-center">
                  <TrendingUp className="w-5 h-5 mr-2 text-toast-500" />
                  Módulo de Tamizaje y Recolección de Datos Farmacéuticos
                </h2>
                <p className="text-xs text-slate-400 mt-1">Gestión integrada de screening, criterios de inclusión/exclusión y bases de datos de investigación.</p>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {subjects.slice(0, 4).map((subject) => (
                    <button
                      key={subject.id}
                      onClick={() => setSelectedSubject(subject)}
                      className={`p-4 rounded-xl border transition-all text-xs cursor-pointer text-left ${selectedSubject?.id === subject.id
                          ? 'bg-charcoal-900 text-white border-charcoal-950'
                          : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                        }`}
                    >
                      <div className="font-bold">{subject.code}</div>
                      <div className="text-[11px] mt-1 opacity-75">{subject.name.split(' ')[0]}</div>
                    </button>
                  ))}
                </div>

                {selectedSubject && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                    <div className="bg-toast-50 p-4 rounded-lg border border-toast-200">
                      <h3 className="font-bold text-charcoal-900 mb-3 text-sm">Perfil del Sujeto</h3>
                      <div className="space-y-2 text-xs text-charcoal-700">
                        <p><strong>Código:</strong> {selectedSubject.code}</p>
                        <p><strong>Nombre:</strong> {selectedSubject.name}</p>
                        <p><strong>Edad:</strong> {selectedSubject.age} años</p>
                        <p><strong>Género:</strong> {selectedSubject.gender}</p>
                        <p><strong>Estatus:</strong> <span className="font-bold text-toast-600">{selectedSubject.screeningStatus}</span></p>
                        <p><strong>Consentimiento:</strong> <span className="font-bold">{selectedSubject.consentStatus}</span></p>
                      </div>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 overflow-y-auto max-h-64">
                      <h3 className="font-bold text-charcoal-900 mb-3 text-sm">Datos de Tamizaje</h3>
                      {screeningData.filter(s => s.subjectId === selectedSubject.id).map((data, idx) => (
                        <div key={data.id} className="text-xs mb-3 pb-3 border-b border-slate-200 last:border-b-0">
                          <div className="font-semibold text-charcoal-800 mb-1">Tamizaje #{idx + 1}</div>
                          <div className="text-slate-600 space-y-1">
                            <p>Fecha: <span className="font-mono">{data.screeningDate}</span></p>
                            <p>Screener: {data.screener}</p>
                            <p>Estatus: <span className="capitalize font-bold text-toast-500">{data.screeningStatus}</span></p>
                            {data.notes && <p className="italic text-slate-500 mt-1">{data.notes}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-6 pt-6 border-t border-slate-100">
                  <h3 className="font-bold text-charcoal-900 mb-3 text-sm">Citas de Recolección de Datos</h3>
                  <div className="space-y-2">
                    {appointments.slice(0, 3).map((apt) => (
                      <div key={apt.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-semibold text-charcoal-900">{apt.subjectName}</div>
                          <div className="text-slate-500">{apt.appointmentType} — {apt.timeSlot}</div>
                        </div>
                        <span className={`text-[9px] font-bold px-2 py-1 rounded-full ${apt.estatus === 'Confirmada' ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                          {apt.estatus}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* ========================================================== */}
      {/* MODAL: HISTORIA CLÍNICA UNIFICADA (PDF SIMULATION) */}
      {selectedPdfPatient && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-toast-300 flex flex-col text-left">
            <div className="bg-toast-50 p-4 px-6 border-b border-toast-200 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2 text-charcoal-800">
                <FileText className="w-5 h-5 text-toast-600 animate-pulse" />
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-toast-500">
                  Previsualización del Expediente de Historia Clínica Unificada Digital
                </span>
              </div>
              <button
                onClick={() => setSelectedPdfPatient(null)}
                className="text-toast-500 hover:text-charcoal-900 bg-white hover:bg-toast-100 p-2 rounded-xl border border-toast-200 cursor-pointer text-xs font-bold"
              >
                ✕ Cerrar Vista
              </button>
            </div>

            <div className="p-6 md:p-8 space-y-8 font-sans" id="clinical-history-print-section">
              <div className="flex flex-col sm:flex-row items-center justify-between border-b-2 border-charcoal-900 pb-5 gap-4">
                <div className="flex items-center space-x-3">
                  <div className="flex flex-col">
                    <span className="font-serif font-black text-xl tracking-tight text-charcoal-900 leading-none">
                      Mind<span className="text-toast-600">Psic</span>
                    </span>
                    <span className="font-mono text-[8px] tracking-widest text-toast-500 uppercase">Clínica &amp; Bienestar</span>
                  </div>
                  <div className="h-6 w-[2px] bg-toast-300 hidden sm:block" />
                  <div className="flex flex-col">
                    <span className="font-serif font-black text-lg text-toast-500 tracking-tight leading-none">
                      Mind<span className="text-slate-700">Health</span>
                    </span>
                    <span className="font-mono text-[8px] tracking-widest text-slate-500 uppercase">Salud Corporativa</span>
                  </div>
                </div>
                <div className="text-center sm:text-right">
                  <span className="text-[10px] bg-toast-100 text-toast-500 px-2 py-0.5 rounded-full uppercase font-mono font-extrabold border border-toast-300">
                    Registro Médico Original
                  </span>
                  <p className="text-[9px] text-toast-400 mt-1.5 font-mono">
                    CÓDIGO SHA-256 SINC: <span className="text-charcoal-900 font-bold">SHA-8ac29b19df3eac</span>
                  </p>
                  <p className="text-[10px] text-toast-400 font-mono">Impreso: 2026-05-30 UTC</p>
                </div>
              </div>

              <div className="text-center space-y-1">
                <h1 className="text-2xl font-serif font-black tracking-tight text-charcoal-900 uppercase">
                  Historia Clínica Terapéutica General
                </h1>
                <p className="text-xs text-toast-500 max-w-lg mx-auto leading-relaxed">
                  Soporte oficial de interacciones clínicas del ecosistema sanitario, emitido según las directivas de seguridad de datos de salud global.
                </p>
              </div>

              <div className="bg-toast-50 p-5 rounded-2xl border border-toast-200">
                <h3 className="text-xs font-serif font-black uppercase text-toast-600 tracking-wider mb-3.5 border-b border-toast-200 pb-1 flex items-center">
                  <UserIcon className="w-4 h-4 mr-1 text-toast-500" />
                  1. Información Personal e Datos de Contacto del Paciente
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-y-4 gap-x-6 text-xs text-charcoal-700">
                  <div>
                    <span className="text-[10px] uppercase font-mono text-toast-400 block mb-0.5">Nombre Completo</span>
                    <span className="font-bold text-charcoal-900 text-sm">{selectedPdfPatient.name}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-mono text-toast-400 block mb-0.5">Número de ID Clínico</span>
                    <span className="font-semibold text-charcoal-900 font-mono">{selectedPdfPatient.id}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-mono text-toast-400 block mb-0.5">Edad / Género</span>
                    <span className="font-semibold text-charcoal-900">{selectedPdfPatient.age} años • {selectedPdfPatient.gender}</span>
                  </div>
                  <div className="border-t border-toast-200/60 pt-3">
                    <span className="text-[10px] uppercase font-mono text-toast-400 block mb-0.5">Teléfono Celular</span>
                    <span className="font-semibold text-charcoal-900 font-mono">{selectedPdfPatient.phone}</span>
                  </div>
                  <div className="border-t border-toast-200/60 pt-3">
                    <span className="text-[10px] uppercase font-mono text-toast-400 block mb-0.5">Correo Electrónico</span>
                    <span className="font-semibold text-charcoal-900 font-mono">{selectedPdfPatient.email}</span>
                  </div>
                  <div className="border-t border-toast-200/60 pt-3">
                    <span className="text-[10px] uppercase font-mono text-toast-400 block mb-0.5">Convenio de Salud</span>
                    <span className="font-bold text-toast-500">{selectedPdfPatient.agreement}</span>
                  </div>
                  <div className="col-span-1 md:col-span-3 border-t border-toast-200/60 pt-3">
                    <span className="text-[10px] uppercase font-mono text-toast-400 block mb-0.5">Dirección de Residencia Unificada</span>
                    <span className="font-semibold text-charcoal-900">Calle 100 #8A-34, Altos de Chapinero, Bogotá D.C., Colombia</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4 text-xs">
                <h3 className="text-xs font-serif font-black uppercase text-toast-600 tracking-wider border-b border-toast-200 pb-1 flex items-center">
                  <FileText className="w-4 h-4 mr-1 text-toast-500" />
                  2. Registro Cronológico de Evoluciones Clínicas Firmadas
                </h3>
                <div className="space-y-4">
                  {progressNotes.filter(note => note.patientId === selectedPdfPatient.id).map((note, index) => (
                    <div key={note.id} className="p-5 rounded-2xl border border-toast-200 bg-white space-y-3.5 relative overflow-hidden">
                      <div className="absolute top-0 right-0 py-1 px-3 bg-toast-100 text-charcoal-700 text-[9px] font-mono font-bold border-l border-b border-toast-200">
                        REGISTRO #{index + 1}
                      </div>
                      <div className="flex items-center space-x-2 text-charcoal-800 border-b border-toast-100 pb-2">
                        <span className="font-serif font-black text-charcoal-900">Fecha de Registro:</span>
                        <span className="font-mono text-toast-500 underline font-semibold">{note.date}</span>
                        <span className="text-toast-300">•</span>
                        <span className="text-[10px] text-toast-400">Atendido por: Dra. {note.psychologistName}</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-1 gap-3 leading-relaxed text-charcoal-700">
                        <p><strong className="text-charcoal-950 block text-[10px] uppercase font-mono tracking-wider mb-0.5">Motivo de Consulta y Status Actual:</strong> {note.reason}</p>
                        <p><strong className="text-charcoal-950 block text-[10px] uppercase font-mono tracking-wider mb-0.5">Evaluación Mental / Conductual:</strong> {note.mentalStatus}</p>
                        <p><strong className="text-charcoal-950 block text-[10px] uppercase font-mono tracking-wider mb-0.5">Intervención Terapéutica Empleada:</strong> {note.intervention}</p>
                        <p><strong className="text-charcoal-950 block text-[10px] uppercase font-mono tracking-wider mb-0.5">Evolución Clínica y Observación de Progreso:</strong> {note.evolution}</p>
                        <div className="pt-2 border-t border-dashed border-toast-200 grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                          <p><strong className="text-charcoal-950 block text-[10px] uppercase font-mono mb-0.5">Código Diagnóstico (DSM-5 / CIE-10):</strong>
                            <span className="bg-toast-100 px-2 py-0.5 rounded-md font-mono font-bold text-charcoal-800 border border-toast-200 inline-block mt-0.5">{note.diagnosis}</span>
                          </p>
                          <p><strong className="text-charcoal-950 block text-[10px] uppercase font-mono mb-0.5">Recomendaciones y Plan de Trabajo Continuo:</strong>
                            <span className="italic text-charcoal-800 block mt-0.5">{note.recommendations}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {progressNotes.filter(note => note.patientId === selectedPdfPatient.id).length === 0 && (
                    <div className="p-8 text-center bg-toast-50 rounded-2xl border border-dashed border-toast-300 text-toast-400 italic">
                      No se registran notas de evolución firmadas anteriores para este paciente.
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-charcoal-900">
                <div className="text-xs text-toast-400 space-y-1 mt-3">
                  <p className="font-bold text-charcoal-900">CONSENTIMIENTO INFORMADO DE DATOS MÉDICOS</p>
                  <p className="leading-relaxed">La información consignada en esta historia clínica es confidencial y se regula estrictamente bajo parámetros éticos de la salud y normativas colombianas e internacionales. Solo puede ser accedida por personal médico idóneo capacitado.</p>
                </div>
                <div className="flex flex-col items-center justify-center p-4 bg-toast-50 rounded-2xl border border-toast-200 text-center max-w-sm mx-auto md:ml-auto md:mr-0">
                  <div className="w-12 h-12 rounded-full border-2 border-dashed border-toast-500 flex items-center justify-center text-toast-500 font-mono text-[9px] font-extrabold rotate-12 mb-2">MIND_CERT</div>
                  <span className="font-mono text-xs font-bold text-charcoal-900 border-b border-charcoal-400 pb-0.5 block px-6">Dra. Camila Morales Vega</span>
                  <span className="text-[10px] text-toast-500 font-mono mt-1">Psicóloga Consultora Titular • Lic: TP-109489241-COL</span>
                </div>
              </div>
            </div>

            <div className="bg-toast-50 p-4 px-6 border-t border-toast-200 shrink-0 flex items-center justify-between">
              <span className="text-[10px] text-toast-400 font-mono">Soporte oficial digital Mind_core v3.5</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    alert(`Exportador Clínico:\nIniciando impresión del expediente de ${selectedPdfPatient.name}.`);
                    window.print();
                  }}
                  className="bg-charcoal-900 hover:bg-charcoal-950 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Imprimir / Descargar PDF</span>
                </button>
                <button onClick={() => setSelectedPdfPatient(null)} className="bg-white hover:bg-toast-100 border border-toast-200 text-charcoal-800 font-bold text-xs px-4 py-2 rounded-xl cursor-pointer">Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/* MODAL: EXPORTAR REPORTES DE ACTIVIDAD */}
      {showExportReportModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 text-left shadow-2xl border border-toast-300 space-y-5">
            <div className="flex items-start justify-between border-b border-toast-200 pb-3">
              <div className="space-y-0.5">
                <h3 className="font-serif font-black text-lg text-charcoal-900 flex items-center">
                  <Activity className="w-5 h-5 mr-1.5 text-toast-500" />
                  Exportar Reportes Consolidados de Actividad
                </h3>
                <p className="text-xs text-toast-400">Seleccione el formato estructurado para descarga segura.</p>
              </div>
              <button onClick={() => setShowExportReportModal(false)} className="text-toast-400 hover:text-charcoal-800 text-lg cursor-pointer">✕</button>
            </div>
            <div className="bg-toast-50 p-4 rounded-xl border border-toast-200 space-y-3 text-xs text-charcoal-700">
              <p className="font-bold text-charcoal-900">Resumen del Lote de Actividad ({new Date().toISOString().split('T')[0]})</p>
              <ul className="space-y-1.5 font-mono text-[11px] list-disc list-inside text-charcoal-600">
                <li>Consultas Atendidas en Lote: 5 Consultas Activas</li>
                <li>Evoluciones Médicas Registradas: 2 Notas nuevas de evolución</li>
                <li>Escalas Psicométricas Dictadas: 2 Pruebas en lote</li>
                <li>Sincronización Regional EPS/Estatales: Activa (100% Ok)</li>
              </ul>
            </div>
            <div className="space-y-2">
              <label className="block text-[10px] uppercase font-mono font-extrabold text-toast-500">Seleccionar Formato Clínico</label>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => alert('Preparando formato CSV Clínico.')} className="p-3 text-center rounded-xl border border-toast-200 hover:border-toast-400 bg-white hover:bg-toast-50 text-xs font-bold text-charcoal-800 font-mono">CSV Clínico</button>
                <button onClick={() => alert('Generando archivo RIPS XML compatible.')} className="p-3 text-center rounded-xl border border-toast-200 hover:border-toast-400 bg-white hover:bg-toast-50 text-xs font-bold text-charcoal-800 font-mono">RIPS (XML)</button>
                <button onClick={() => alert('Empaquetando reporte JSON de Auditoría.')} className="p-3 text-center rounded-xl border border-toast-200 hover:border-toast-400 bg-white hover:bg-toast-50 text-xs font-bold text-charcoal-800 font-mono">JSON Auditor</button>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-toast-200">
              <button onClick={() => { alert('Lote Exportado de Forma Exitosa.'); setShowExportReportModal(false); }} className="bg-charcoal-900 hover:bg-charcoal-950 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-xs cursor-pointer">Confirmar Descarga de Reporte</button>
              <button onClick={() => setShowExportReportModal(false)} className="bg-white hover:bg-toast-100 border border-toast-200 text-charcoal-800 font-bold text-xs px-4 py-2 rounded-xl cursor-pointer">Cancelar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}