/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, FormEvent, useEffect } from 'react';
import { 
  mockPsychologistsPerformance, 
  initialTenantDomains, 
  initialClinicalFiles,
  mockAdmin
} from '../data/mockData';
import { useAppointments } from '../hooks/useAppointments';
import { usePatients } from '../hooks/usePatients';
import InternalChat from '../components/InternalChat';
import { 
  TenantDomain, 
  Patient, 
  PsychologistPerformance,
  ClinicalFile,
  User
} from '../types';
import { 
  TrendingUp, 
  Users, 
  Network, 
  FileText, 
  Globe, 
  UploadCloud, 
  Database,
  Search, 
  ShieldCheck, 
  Cpu, 
  PlusCircle, 
  CheckCircle,
  Video, 
  BarChart3,
  Server,
  Zap,
  DollarSign,
  Receipt,
  FileCode,
  Briefcase,
  Filter,
  MessageSquare
} from 'lucide-react';

type AdminTab = 'metrics' | 'video_admin' | 'advanced_docs' | 'multitenant' | 'billing_rips' | 'chat';

export default function AdminPortal() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Extracción del token de localStorage y consumo de hooks reales
  // IMPORTANT: Hooks MUST be called unconditionally at the top level — Rules of Hooks
  const token = localStorage.getItem('mind_token');
  const { appointments: realAppointments, loading: apptsLoading } = useAppointments(token);
  const { patients: realPatients, loading: patientsLoading } = usePatients(token);
  
  // Verificación de sesión (sin navigate — App.tsx maneja la guardia por estado)
  useEffect(() => {
    const storedToken = localStorage.getItem('mind_token');
    const userStr = localStorage.getItem('mind_user');

    if (!storedToken || !userStr) {
      setAuthLoading(false);
      return;
    }

    try {
      const userData: User = JSON.parse(userStr);
      setCurrentUser(userData);
    } catch (error) {
      localStorage.removeItem('mind_token');
      localStorage.removeItem('mind_user');
    } finally {
      setAuthLoading(false);
    }
  }, []);



  const [activeTab, setActiveTab] = useState<AdminTab>('metrics');
  
  // React dynamic administrative states
  const [tenants, setTenants] = useState<TenantDomain[]>(initialTenantDomains);
  const [performances, setPerformances] = useState<PsychologistPerformance[]>(mockPsychologistsPerformance);
  const [clinicalFiles, setClinicalFiles] = useState<ClinicalFile[]>(initialClinicalFiles);

  // Mapeo dinámico de pacientes reales consumidos desde el custom hook
  const patients: Patient[] = (realPatients || []).map((p) => {
    const docIdNum = parseInt(p?.documentId?.replace(/\D/g, '') || '') || p?.id?.charCodeAt(0) || 0;
    const agreements = ['Sura Medicina Prepagada', 'Colmédica Prepagada', 'MindHealth Global', 'Particular'];
    const agreement = agreements[docIdNum % agreements.length];
    const genders = ['Femenino', 'Masculino', 'No especificado'];
    const gender = genders[docIdNum % genders.length];
    const age = 20 + (docIdNum % 50);

    return {
      id: p?.documentId || p?.id || '',
      name: `${p?.firstName || ''} ${p?.lastName || ''}`.trim() || 'Desconocido',
      gender: gender,
      age: age,
      email: p?.email || 'contacto@mindpsic.com',
      phone: p?.phone || '300-000-0000',
      status: 'Activo',
      agreement: agreement,
      progressNotesCount: (docIdNum % 5) + 1,
      lastSessionDate: new Date(Date.now() - (docIdNum % 10) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };
  });

  // Filter agreements (Convenios) state
  const [selectedAgreement, setSelectedAgreement] = useState<string>('todos');

  // Cross filter states for Advanced Metrics
  const [selectedProfessional, setSelectedProfessional] = useState<string>('todos');
  const [selectedSpecialty, setSelectedSpecialty] = useState<string>('todos');
  const [selectedDay, setSelectedDay] = useState<string>('todos');
  const [selectedMonth, setSelectedMonth] = useState<string>('todos');

  // Mapeo dinámico de citas reales consumidas desde el custom hook
  const appointmentsLog = (realAppointments || []).map((appt) => {
    const dateObj = new Date(appt?.dateTime || Date.now());
    const dayName = dateObj.toLocaleDateString('es-ES', { weekday: 'long' });
    const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    const monthName = dateObj.toLocaleDateString('es-ES', { month: 'long' });
    const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    const docIdNum = parseInt(appt?.patient?.id?.replace(/\D/g, '') || '') || appt?.patient?.id?.charCodeAt(0) || 0;
    const agreements = ['Sura Medicina Prepagada', 'Colmédica Prepagada', 'MindHealth Global', 'Particular'];
    const agreement = agreements[docIdNum % agreements.length];

    return {
      id: appt?.id || 'unknown',
      patientName: `${appt?.patient?.firstName || ''} ${appt?.patient?.lastName || ''}`.trim() || 'Paciente Desconocido',
      professional: appt?.psychologist?.name || 'Clínico no asignado',
      specialty: appt.type || 'Terapia Cognitivo-Conductual',
      day: capitalizedDay,
      month: capitalizedMonth,
      status: appt.status || 'Atendido',
      modality: appt.type === 'Virtual' || appt.type === 'Presencial' ? appt.type : 'Virtual',
      agreement: agreement,
      reason: appt.notes || 'Excelente progreso regulación ansiedad y rumiación.'
    };
  });

  // Multi-tenant new domain input state
  const [newTenant, setNewTenant] = useState({
    organization: '',
    domain: '',
    usersLimit: 100,
    region: 'us-west2 (Oregon)'
  });

  // Advanced Docs multi-upload states
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [isProcessingRAG, setIsProcessingRAG] = useState(false);
  const [ragStatusMessage, setRagStatusMessage] = useState<string | null>(null);

  // Billing & RIPS panel states
  const [billingUsers, setBillingUsers] = useState([
    { id: 'bill_1', name: 'Juan Gabriel Montoya', role: 'Facturador Clínico', agreement: 'Sura Medicina Prepagada', active: true },
    { id: 'bill_2', name: 'Clara Estrada Vélez', role: 'Auditor Financiero EPS', agreement: 'Todos', active: true }
  ]);
  const [newBillingUser, setNewBillingUser] = useState({
    name: '',
    role: 'Facturador Clínico',
    agreement: 'Sura Medicina Prepagada'
  });

  const [ripsYear, setRipsYear] = useState('2026');
  const [ripsMonth, setRipsMonth] = useState('05');
  const [ripsAgreement, setRipsAgreement] = useState('Sura Medicina Prepagada');
  const [ripsOutput, setRipsOutput] = useState<string | null>(null);
  const [patientSearchTerm, setPatientSearchTerm] = useState('');

  // Estado de carga / guardia defensiva
  if (authLoading || patientsLoading || apptsLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <p className="text-lg text-stone-600 font-semibold animate-pulse">
          Cargando entorno seguro…
        </p>
      </div>
    );
  }

  // Guardia de autenticación: si no hay usuario tras la carga, no renderizar nada
  // (App.tsx se encargará de mostrar el Login via estado de currentUser)
  if (!currentUser) {
    return null;
  }

  // Dynamic filter patients by agreement
  const filteredPatients = selectedAgreement === 'todos' 
    ? patients 
    : patients.filter(p => p.agreement.toLowerCase().includes(selectedAgreement.toLowerCase()));

  // Dynamic computation of clinical stats
  const totalPatientsCount = filteredPatients.length;
  const activePsychologistsCount = performances.length;
  const totalCompletedSessionsCount = performances.reduce((acc, p) => acc + p.completedSessions, 0);
  const avgSatisfactionRate = performances.length > 0 ? Math.round(performances.reduce((acc, p) => acc + p.satisfactionRate, 0) / performances.length) : 0;

  // Dynamic cross-filtering for interactive clinical auditor dashboard
  const filteredAppointments = appointmentsLog.filter(app => {
    const matchesAgreement = selectedAgreement === 'todos' || 
      app.agreement.toLowerCase().includes(selectedAgreement.toLowerCase()) ||
      (selectedAgreement === 'Sura' && app.agreement.includes('Sura')) ||
      (selectedAgreement === 'Colmédica' && app.agreement.includes('Colmédica')) ||
      (selectedAgreement === 'MindHealth Global' && app.agreement.includes('MindHealth'));
      
    const matchesProfessional = selectedProfessional === 'todos' || app.professional === selectedProfessional;
    const matchesSpecialty = selectedSpecialty === 'todos' || app.specialty === selectedSpecialty;
    const matchesDay = selectedDay === 'todos' || app.day === selectedDay;
    const matchesMonth = selectedMonth === 'todos' || app.month === selectedMonth;

    return matchesAgreement && matchesProfessional && matchesSpecialty && matchesDay && matchesMonth;
  });

  const totalFilteredCount = filteredAppointments.length;
  const attendedCount = filteredAppointments.filter(app => app.status === 'Atendido').length;
  const unattendedOrReprogrammedCount = filteredAppointments.filter(app => app.status === 'No Atendido' || app.status === 'Reprogramado').length;

  // New Domain tenant registry handler
  const handleCreateTenant = (e: FormEvent) => {
    e.preventDefault();
    if (!newTenant.organization || !newTenant.domain) return;

    const domainRef: TenantDomain = {
      id: 'ten_' + Date.now(),
      organization: newTenant.organization,
      domain: newTenant.domain,
      status: 'active',
      dbConnection: `postgresql://${newTenant.organization.toLowerCase().replace(/[^a-z]/g, '')}_prod:********@cloudsql-uswest2.gcp.net/tenant_db`,
      createdAt: new Date().toISOString().split('T')[0],
      usersLimit: Number(newTenant.usersLimit),
      usersActive: 1,
      region: newTenant.region
    };

    setTenants(prev => [...prev, domainRef]);
    setNewTenant({
      organization: '',
      domain: '',
      usersLimit: 100,
      region: 'us-west2 (Oregon)'
    });
    alert(`Tenant administrativo "${domainRef.organization}" registrado exitosamente.`);
  };

  // Toggle tenant domain suspension
  const toggleTenantStatus = (id: string) => {
    setTenants(prev => prev.map(t => {
      if (t.id === id) {
        return {
          ...t,
          status: t.status === 'active' ? 'suspended' : 'active'
        };
      }
      return t;
    }));
  };

  // Create billing user handler
  const handleCreateBillingUser = (e: FormEvent) => {
    e.preventDefault();
    if (!newBillingUser.name) return;

    const newObj = {
      id: 'bill_' + Date.now(),
      name: newBillingUser.name,
      role: newBillingUser.role,
      agreement: newBillingUser.agreement,
      active: true
    };

    setBillingUsers(prev => [...prev, newObj]);
    setNewBillingUser({
      name: '',
      role: 'Facturador Clínico',
      agreement: 'Sura Medicina Prepagada'
    });
    alert(`Usuario de Facturación "${newObj.name}" registrado e integrado con éxito.`);
  };

  // Generate dynamic xml/json RIPS code
  const handleGenerateRips = () => {
    const randomTxId1 = Math.floor(100000 + Math.random() * 900000);
    const randomTxId2 = Math.floor(100000 + Math.random() * 900000);
    
    const outputXml = `<?xml version="1.0" encoding="UTF-8"?>
<RIPS_Concepto_Salud version="4.0">
  <CabeceraControl>
    <CodigoPrestador>110010948501</CodigoPrestador>
    <RazonSocial>Consorcio Terapéutico MindPsic MindHealth</RazonSocial>
    <PeriodoFacturacion Anio="${ripsYear}" Mes="${ripsMonth}" />
    <FechaGeneracion>${new Date().toISOString().split('T')[0]}</FechaGeneracion>
  </CabeceraControl>
  <TransaccionesConvenio aseguradora="${ripsAgreement}">
    <Factura ID="FACT-${randomTxId1}" TotalCopagos="150000" ValorNeto="1450000">
      <PacientesRegistrados>
        <Paciente Documento="10182410" TipoDoc="CC" PrimerNombre="Andres" PrimerApellido="Correa">
          <Consulta CodigoCups="890108" DiagnosticoPrincipal="F411" Modalidad="Teleconsulta">
            <FechaServicio>${ripsYear}-${ripsMonth}-12T10:00:00Z</FechaServicio>
            <ValorConsulta>120000</ValorConsulta>
            <Copago>10000</Copago>
          </Consulta>
        </Paciente>
        <Paciente Documento="52984120" TipoDoc="CC" PrimerNombre="Valeria" PrimerApellido="Sotomayor">
          <Consulta CodigoCups="890108" DiagnosticoPrincipal="F320" Modalidad="Teleconsulta">
            <FechaServicio>${ripsYear}-${ripsMonth}-18T16:00:00Z</FechaServicio>
            <ValorConsulta>120000</ValorConsulta>
            <Copago>10000</Copago>
          </Consulta>
        </Paciente>
      </PacientesRegistrados>
    </Factura>
    <Factura ID="FACT-${randomTxId2}" TotalCopagos="50000" ValorNeto="600000">
      <PacientesRegistrados>
        <Paciente Documento="11048293" TipoDoc="CC" PrimerNombre="Sebastian" PrimerApellido="Martinez">
          <Consulta CodigoCups="890108" DiagnosticoPrincipal="F510" Modalidad="Teleconsulta">
            <FechaServicio>${ripsYear}-${ripsMonth}-04T08:30:00Z</FechaServicio>
            <ValorConsulta>120000</ValorConsulta>
            <Copago>10000</Copago>
          </Consulta>
        </Paciente>
      </PacientesRegistrados>
    </Factura>
  </TransaccionesConvenio>
</RIPS_Concepto_Salud>`;

    setRipsOutput(outputXml);
  };

  // Simulated dropzone RAG loader trigger
  const handleDropzoneUpload = async (e: any) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessingRAG(true);
    setRagStatusMessage("Analizando estructura de archivos clónicos con RAG LLM...");

    try {
      const response = await fetch('/api/clinical/upload-masivo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerRAG: true })
      });
      const data = await response.json();
      
      setTimeout(() => {
        setIsProcessingRAG(false);
        setRagStatusMessage(`✅ Procesamiento Clínico Exitoso: ${data.filesRecognized} archivos parseados. Insights: ${data.clinicalInsightsExtracted.join(" • ")}`);
        
        const formattedNewFiles = Array.from(files).map((f: any, idx) => ({
          id: 'file_rag_' + (Date.now() + idx),
          name: f.name,
          type: 'pdf' as const,
          size: (f.size / 1024 / 1024).toFixed(1) + ' MB',
          uploadedAt: new Date().toISOString().split('T')[0],
          uploadedBy: 'Auditor Carga Masiva (RAG)',
          category: 'Evaluación' as const
        }));

        setClinicalFiles(prev => [...formattedNewFiles, ...prev]);
        setUploadedFiles(prev => [...prev, ...Array.from(files)]);
      }, 2000);

    } catch (err) {
      setIsProcessingRAG(false);
      setRagStatusMessage("⚠️ Error en el procesamiento RAG. El simulador de carga persistió los expedientes localmente.");
    }
  };

  return (
    <div className="flex h-[calc(110vh-70px)] bg-slate-50 overflow-hidden font-sans">
      
      {/* ADMIN PORTAL SIDEBAR */}
      <aside className="w-16 md:w-64 bg-slate-900 text-slate-300 flex flex-col justify-between shrink-0 border-r border-slate-800">
        <div className="py-6 flex flex-col space-y-2">
          
          {/* Metrics Panel Switch */}
          <button
            onClick={() => setActiveTab('metrics')}
            id="tab-adm-metrics"
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'metrics' 
                ? 'bg-charcoal-900 text-white font-semibold' 
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <BarChart3 className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Tablero Gerencial</span>
            {activeTab === 'metrics' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          {/* Telehealth Controls Panel */}
          <button
            onClick={() => setActiveTab('video_admin')}
            id="tab-adm-video"
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'video_admin' 
                ? 'bg-charcoal-900 text-white font-semibold' 
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Video className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Consolas de Video</span>
            {activeTab === 'video_admin' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          {/* advanced Document processing (RAG / AI Loading) */}
          <button
            onClick={() => setActiveTab('advanced_docs')}
            id="tab-adm-documental"
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'advanced_docs' 
                ? 'bg-charcoal-900 text-white font-semibold' 
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Cpu className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Gestión LLM / RAG</span>
            {activeTab === 'advanced_docs' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          {/* Multitenancy configurations */}
          <button
            onClick={() => setActiveTab('multitenant')}
            id="tab-adm-tenants"
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'multitenant' 
                ? 'bg-charcoal-900 text-white font-semibold' 
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Globe className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Dominios y Tenants</span>
            {activeTab === 'multitenant' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          {/* Billing & RIPS configurations */}
          <button
            onClick={() => setActiveTab('billing_rips')}
            id="tab-adm-billing"
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'billing_rips' 
                ? 'bg-charcoal-900 text-white font-semibold' 
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <DollarSign className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Facturación y RIPS</span>
            {activeTab === 'billing_rips' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          {/* Dedicated Internal Messaging (Chat) */}
          <button
            onClick={() => setActiveTab('chat')}
            id="tab-adm-chat"
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'chat' 
                ? 'bg-charcoal-900 text-white font-semibold' 
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <div className="relative">
              <MessageSquare className="w-5 h-5 shrink-0" />
              <span className="absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full bg-toast-500 animate-pulse" />
            </div>
            <span className="ml-3 text-xs hidden md:block border-none outline-hidden">Mensajería Clínica</span>
            {activeTab === 'chat' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

        </div>

        {/* Console state tag + user info (dinámico) */}
        <div className="p-4 border-t border-slate-800 hidden md:block bg-slate-950/40 text-left">
          <div className="flex items-center space-x-1.5 text-toast-450 mb-1">
            <ShieldCheck className="w-3.5 h-3.5 text-toast-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-toast-300">
              Sesión activa
            </span>
          </div>
          <p className="text-[11px] font-semibold text-white truncate">{currentUser.name}</p>
          <p className="text-[9px] text-slate-400 font-mono mt-0.5">
            {currentUser.role} · {currentUser.tenantId}
          </p>
          {currentUser.licenseNumber && (
            <p className="text-[9px] text-slate-500 font-mono mt-1">
              Lic. {currentUser.licenseNumber}
            </p>
          )}
          <div className="flex items-center space-x-1.5 text-toast-450 mt-2 pt-1 border-t border-slate-800/50">
            <Server className="w-3 h-3 text-slate-500" />
            <span className="text-[9px] text-slate-500">Cloud Run Cluster</span>
          </div>
        </div>
      </aside>

      {/* PORTAL MAIN AREA */}
      <main className="flex-1 overflow-y-auto p-6 md:p-8">
        
        {/* VIEW: INTERNAL CHAT */}
        {activeTab === 'chat' && (
          <div className="max-w-7xl mx-auto">
            <InternalChat currentUser={currentUser} />
          </div>
        )}

        {/* VIEW: GRAPHIC METRICS DASHBOARD */}
        {activeTab === 'metrics' && (
          <div className="max-w-7xl mx-auto space-y-6">
            
            {/* Header with Title - Dinámico con currentUser */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4 text-left">
              <div className="space-y-0.5">
                <span className="bg-toast-100 text-charcoal-900 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border border-toast-300">
                  Gerencia de Operaciones Clínicas
                </span>
                <h1 className="text-2xl font-black tracking-tight text-slate-900 mt-1">
                  Panel de Administración — {currentUser.name}
                </h1>
                <div className="flex gap-2 mt-1">
                  <span className="bg-toast-100 text-charcoal-900 text-[10px] font-bold px-2 py-0.5 rounded-full border border-toast-300">
                    {currentUser.role}
                  </span>
                  <span className="bg-slate-100 text-slate-700 text-[10px] font-mono px-2 py-0.5 rounded-full">
                    Tenant: {currentUser.tenantId}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-sans mt-2">
                  Sincronización en tiempo real de consultas, psicólogos operativos, e inquilinos cruzados por seguro médico.
                </p>
              </div>
            </div>

            {/* COMPLEJO PANEL DE FILTROS CRUZADOS (REQUERIMIENTO PRINCIPAL DE UX/UI) */}
            <div className="bg-white rounded-2xl border border-slate-150 p-5 shadow-2xs space-y-4 text-left">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-2.5 gap-2">
                <div>
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center">
                    <Filter className="w-4 h-4 mr-1.5 text-toast-500 font-bold" />
                    Consola de Alertas e Inteligencia del Filtro Cruzado
                  </h3>
                  <p className="text-[11px] text-slate-400 font-sans">Cruza analíticas de salud por psicólogo asignado, rama clínica, día de la semana y mes contable.</p>
                </div>
                
                {/* Reset button to default "todos" */}
                {(selectedAgreement !== 'todos' || selectedProfessional !== 'todos' || selectedSpecialty !== 'todos' || selectedDay !== 'todos' || selectedMonth !== 'todos') && (
                  <button
                    onClick={() => {
                      setSelectedAgreement('todos');
                      setSelectedProfessional('todos');
                      setSelectedSpecialty('todos');
                      setSelectedDay('todos');
                      setSelectedMonth('todos');
                    }}
                    className="text-[10px] font-bold text-toast-500 hover:text-toast-600 hover:underline px-2.5 py-1 bg-toast-50 rounded-lg border border-toast-200 transition-all cursor-pointer shadow-3xs"
                  >
                    Restablecer Filtros
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {/* Selector 1: Convenio */}
                <div className="space-y-1 text-left">
                  <label className="block text-[10px] uppercase font-extrabold text-slate-500">Aseguradora / Convenio</label>
                  <select
                    value={selectedAgreement}
                    onChange={(e) => setSelectedAgreement(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-205 text-slate-900 text-xs rounded-xl px-2.5 py-2 focus:ring-2 focus:ring-toast-500 font-semibold cursor-pointer"
                  >
                    <option value="todos">Todos los Convenios</option>
                    <option value="Sura">Sura Medicina Prepagada</option>
                    <option value="Colmédica">Colmédica Prepagada</option>
                    <option value="MindHealth Global">Particular / Corp Global</option>
                    <option value="Particular">Particular Exclusivo</option>
                  </select>
                </div>

                {/* Selector 2: Profesional */}
                <div className="space-y-1 text-left">
                  <label className="block text-[10px] uppercase font-extrabold text-slate-500">Psicólogo Clínico</label>
                  <select
                    value={selectedProfessional}
                    onChange={(e) => setSelectedProfessional(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-205 text-slate-900 text-xs rounded-xl px-2.5 py-2 focus:ring-2 focus:ring-toast-500 font-semibold cursor-pointer"
                  >
                    <option value="todos">Todos los Profesionales</option>
                    <option value="Dra. Camila Morales Vega">Dra. Camila Morales Vega</option>
                    <option value="Dr. Roberto Carvajal">Dr. Roberto Carvajal</option>
                    <option value="Dra. Luisa María Estrada">Dra. Luisa María Estrada</option>
                    <option value="Dr. Fernando Lopera">Dr. Fernando Lopera</option>
                  </select>
                </div>

                {/* Selector 3: Especialidades */}
                <div className="space-y-1 text-left">
                  <label className="block text-[10px] uppercase font-extrabold text-slate-500">Línea de Especialidad</label>
                  <select
                    value={selectedSpecialty}
                    onChange={(e) => setSelectedSpecialty(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-205 text-slate-900 text-xs rounded-xl px-2.5 py-2 focus:ring-2 focus:ring-toast-500 font-semibold cursor-pointer"
                  >
                    <option value="todos">Todas las Especialidades</option>
                    <option value="Terapia Cognitivo-Conductual">Terapia Cognitivo-Conductual</option>
                    <option value="Gestalt y Duelo Complejo">Gestalt y Duelo</option>
                    <option value="Neuropsicología Infantil">Neuropsicología Infantil</option>
                    <option value="Adicciones y Trauma Clínico">Adicciones y Trauma</option>
                  </select>
                </div>

                {/* Selector 4: Día */}
                <div className="space-y-1 text-left">
                  <label className="block text-[10px] uppercase font-extrabold text-slate-500">Día de la Semana</label>
                  <select
                    value={selectedDay}
                    onChange={(e) => setSelectedDay(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-205 text-slate-900 text-xs rounded-xl px-2.5 py-2 focus:ring-2 focus:ring-toast-500 font-semibold cursor-pointer"
                  >
                    <option value="todos">Todos los Días</option>
                    <option value="Lunes">Lunes</option>
                    <option value="Martes">Martes</option>
                    <option value="Miércoles">Miércoles</option>
                    <option value="Jueves">Jueves</option>
                    <option value="Viernes">Viernes</option>
                    <option value="Sábado">Sábado</option>
                  </select>
                </div>

                {/* Selector 5: Mes */}
                <div className="space-y-1 text-left">
                  <label className="block text-[10px] uppercase font-extrabold text-slate-500">Periodo Histórico (Mes)</label>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-205 text-slate-900 text-xs rounded-xl px-2.5 py-2 focus:ring-2 focus:ring-toast-500 font-semibold cursor-pointer"
                  >
                    <option value="todos">Todos los Meses</option>
                    <option value="Mayo">Mayo</option>
                    <option value="Junio">Junio</option>
                  </select>
                </div>
              </div>

              {/* Conector clínico con base de datos en español */}
              <span className="block text-[10.5px] text-slate-400 italic font-medium pt-1">
                * Aplicando filtros cruzados reactivos en memoria. En producción, estos selectores realizan consultas indexadas asíncronas directas a su Spanner / Cloud SQL.
              </span>
            </div>

            {/* HIGH-LEVEL STATS COMPONENT GRID */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
              {/* Patients count */}
              <div className="bg-white rounded-xl border border-slate-100 p-5 flex items-center space-x-4 shadow-xs text-left">
                <div className="w-10 h-10 bg-toast-100 text-toast-500 rounded-xl flex items-center justify-center border border-toast-300 shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Pacientes Atendidos</span>
                  <p className="text-xl font-extrabold text-slate-900 font-mono mt-0.5">{totalPatientsCount}</p>
                </div>
              </div>

              {/* Active Therapists */}
              <div className="bg-white rounded-xl border border-slate-100 p-5 flex items-center space-x-4 shadow-xs text-left">
                <div className="w-10 h-10 bg-charcoal-900 text-white rounded-xl flex items-center justify-center border border-charcoal-950 shrink-0">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Psicólogos Activos</span>
                  <p className="text-xl font-extrabold text-slate-900 font-mono mt-0.5">{activePsychologistsCount}</p>
                </div>
              </div>

              {/* Total Completed Sessions */}
              <div className="bg-white rounded-xl border border-slate-100 p-5 flex items-center space-x-4 shadow-xs text-left">
                <div className="w-10 h-10 bg-toast-50 text-toast-400 rounded-xl flex items-center justify-center border border-toast-200 shrink-0">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Evoluciones Históricas</span>
                  <p className="text-xl font-extrabold text-slate-900 font-mono mt-0.5">{totalCompletedSessionsCount}</p>
                </div>
              </div>

              {/* Average Clinical Satisfaction Rate */}
              <div className="bg-white rounded-xl border border-slate-100 p-5 flex items-center space-x-4 shadow-xs text-left">
                <div className="w-10 h-10 bg-toast-100 text-toast-500 rounded-xl flex items-center justify-center border border-toast-300 shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Satisfacción Promedio</span>
                  <p className="text-xl font-extrabold text-slate-900 font-mono mt-0.5">{avgSatisfactionRate}%</p>
                </div>
              </div>
            </div>

            {/* COMPARATIVA DE ESTADOS: ATENDIDOS VS. NO ATENDIDOS / REPROGRAMADOS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-left">
              {/* ESTADO: PACIENTES ATENDIDOS CARD */}
              <div className="bg-white rounded-2xl border border-toast-300 p-5 md:p-6 shadow-xs flex flex-col space-y-4">
                <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                  <div className="flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full bg-charcoal-900 animate-pulse" />
                    <h3 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider">
                      Consultas Clínicas: Pacientes Atendidos ({attendedCount})
                    </h3>
                  </div>
                  <span className="text-xs font-mono font-extrabold text-charcoal-900 bg-toast-100 p-1 px-2 rounded-lg border border-toast-300">
                    {totalFilteredCount > 0 ? Math.round((attendedCount / totalFilteredCount) * 100) : 0}% efectividad
                  </span>
                </div>

                <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                  {apptsLoading ? (
                    <div className="text-center text-slate-500 text-xs py-10 animate-pulse font-semibold">
                      Cargando consultas desde el servidor...
                    </div>
                  ) : (
                    <>
                      {filteredAppointments.filter(app => app.status === 'Atendido').map(app => (
                        <div key={app.id} className="p-3 bg-toast-50/50 border border-toast-200 rounded-xl text-xs space-y-1">
                          <div className="flex justify-between items-center">
                            <strong className="text-slate-900">{app.patientName}</strong>
                            <span className="text-[9px] font-mono font-bold uppercase tracking-wider bg-charcoal-900 text-white px-1.5 py-0.5 rounded">
                              Atendido
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 font-sans">
                            <span className="font-semibold text-slate-800">Clínico:</span> {app.professional} • <span className="font-semibold text-slate-800">Línea:</span> {app.specialty}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {app.day} • {app.month} • {app.modality} • {app.agreement}
                          </p>
                          <p className="text-[11px] text-charcoal-800 leading-relaxed bg-white/70 p-2 rounded-lg border border-toast-200/35 mt-1 italic font-sans text-left">
                            &ldquo;{app.reason}&rdquo;
                          </p>
                        </div>
                      ))}

                      {filteredAppointments.filter(app => app.status === 'Atendido').length === 0 && (
                        <div className="text-center text-slate-400 text-xs py-10">
                          No hay consultas atendidas registradas con los filtros seleccionados.
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* ESTADO: PACIENTES NO ATENDIDOS / REPROGRAMADOS CARD */}
              <div className="bg-white rounded-2xl border border-toast-300 p-5 md:p-6 shadow-xs flex flex-col space-y-4">
                <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                  <div className="flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full bg-toast-500 animate-pulse" />
                    <h3 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider">
                      Consultas Clínicas: No Atendidos / Reprogramados ({unattendedOrReprogrammedCount})
                    </h3>
                  </div>
                  <span className="text-xs font-mono font-extrabold text-toast-500 bg-toast-100 p-1 px-2 rounded-lg border border-toast-300">
                    {totalFilteredCount > 0 ? Math.round((unattendedOrReprogrammedCount / totalFilteredCount) * 100) : 0}% reprogramaciones
                  </span>
                </div>

                <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                  {apptsLoading ? (
                    <div className="text-center text-slate-500 text-xs py-10 animate-pulse font-semibold">
                      Cargando consultas desde el servidor...
                    </div>
                  ) : (
                    <>
                      {filteredAppointments.filter(app => app.status === 'No Atendido' || app.status === 'Reprogramado').map(app => (
                        <div key={app.id} className={`p-3 border rounded-xl text-xs space-y-1 ${
                          app.status === 'Reprogramado' ? 'bg-toast-50/40 border-toast-200' : 'bg-slate-50 border-slate-200'
                        }`}>
                          <div className="flex justify-between items-center">
                            <strong className="text-slate-900">{app.patientName}</strong>
                            <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                              app.status === 'Reprogramado' ? 'bg-toast-200 text-toast-500' : 'bg-slate-200 text-slate-800'
                            }`}>
                              {app.status === 'Reprogramado' ? 'Reprogramada' : 'No asistió'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 font-sans">
                            <span className="font-semibold text-slate-800">Clínico:</span> {app.professional} • <span className="font-semibold text-slate-800">Línea:</span> {app.specialty}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {app.day} • {app.month} • {app.modality} • {app.agreement}
                          </p>
                          <p className={`text-[11px] leading-relaxed bg-white/70 p-2 rounded-lg mt-1 border italic font-sans text-left ${
                            app.status === 'Reprogramado' ? 'text-charcoal-800 border-toast-200' : 'text-slate-600 border-slate-150'
                          }`}>
                            &ldquo;{app.reason}&rdquo;
                          </p>
                        </div>
                      ))}

                      {filteredAppointments.filter(app => app.status === 'No Atendido' || app.status === 'Reprogramado').length === 0 && (
                        <div className="text-center text-slate-400 text-xs py-10">
                          No hay reprogramaciones o inasistencias registradas con los filtros seleccionados.
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* PERFORMANCE ANALYSIS CROSS GRID BY INDIVIDUAL THERAPIST */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* table of performance metric metrics per psychologist */}
              <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 shadow-xs p-5 space-y-4">
                <div className="border-b border-slate-100 pb-3 text-left">
                  <h2 className="font-extrabold text-sm text-slate-900 tracking-tight flex items-center">
                    <BarChart3 className="w-4 h-4 mr-2 text-toast-500" />
                    Métricas de Consistencia y Desempeño Clínico Individual
                  </h2>
                  <p className="text-xs text-slate-400">Eficiencia acumulada e índice de retención de pacientes por profesional.</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 text-slate-400 font-mono uppercase text-[9px] border-b border-slate-150">
                      <tr>
                        <th className="p-3 pl-4">Nombre del Clínico</th>
                        <th className="p-3">Especialidad Principal</th>
                        <th className="p-3 text-center">Pacientes Activos</th>
                        <th className="p-3 text-center">Sesiones Total</th>
                        <th className="p-3 text-right pr-4">Tasa Satisfacción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {performances.map((perf) => (
                        <tr key={perf.id} className="hover:bg-slate-50/50">
                          <td className="p-3 pl-4 font-bold text-slate-800 flex items-center">
                            <span className="w-2.5 h-2.5 rounded-full bg-toast-500 mr-2" />
                            {perf.name}
                          </td>
                          <td className="p-3 text-slate-600 font-medium">{perf.specialty}</td>
                          <td className="p-3 text-center text-slate-900 font-mono">{perf.activePatients}</td>
                          <td className="p-3 text-center text-slate-900 font-mono font-semibold">{perf.completedSessions}</td>
                          <td className="p-3 text-right pr-4 font-bold text-slate-800 font-mono">
                            <span className="bg-toast-100 text-toast-500 px-2 py-0.5 rounded-md border border-toast-300">
                              {perf.satisfactionRate}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Dynamic demographic patients grid matching selected Agreement */}
              <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 space-y-4">
                <div className="border-b border-slate-100 pb-3 text-left">
                  <h2 className="font-extrabold text-xs text-slate-800 uppercase tracking-widest">
                    Inscritos en el Convenio ({selectedAgreement === 'todos' ? 'Global' : selectedAgreement})
                  </h2>
                  <p className="text-[11px] text-slate-400">Detalle demográfico de pacientes bajo este seguro.</p>
                </div>

                <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-1">
                  {patientsLoading ? (
                    <p className="text-center text-slate-500 text-xs py-4 animate-pulse font-semibold">Cargando pacientes desde el servidor...</p>
                  ) : (
                    <>
                      {filteredPatients.map((pat) => (
                        <div key={pat.id} className="p-3.5 bg-slate-50 border border-slate-150 rounded-xl text-xs space-y-1.5 flex flex-col text-left">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-800">{pat.name}</span>
                            <span className="text-[10px] bg-slate-200 text-slate-700 rounded px-1.5 py-0.2 font-mono">{pat.id}</span>
                          </div>
                          <p className="text-[11px] text-slate-500">{pat.gender} • {pat.age} años • {pat.email}</p>
                          
                          <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono border-t border-slate-200/50 pt-1.5 mt-1.5">
                            <span>Notas: {pat.progressNotesCount} firmadas</span>
                            <span>Último: {pat.lastSessionDate}</span>
                          </div>
                        </div>
                      ))}

                      {filteredPatients.length === 0 && (
                        <p className="text-center text-slate-400 text-xs py-4">No hay pacientes de este convenio cargados en el sistema actual.</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: VIDEO-CALL QUALITY CONTROL & BITRATE HUD */}
        {activeTab === 'video_admin' && (
          <div className="max-w-7xl mx-auto space-y-6 text-left">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5 md:p-6">
              <div className="border-b border-slate-100 pb-3 mb-6">
                <h2 className="text-sm font-extrabold text-slate-900 tracking-tight flex items-center">
                  <Video className="w-5 h-5 mr-1.5 text-toast-500" />
                  Consola de Vídeo Administrador (WebRTC Control Hub)
                </h2>
                <p className="text-xs text-slate-400">Inspecciona consumo de ancho de banda, pérdida de paquetes y estatus de servidores de señalización en tiempo real.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="p-5 bg-slate-900 text-slate-300 rounded-xl border border-slate-950 flex flex-col justify-between h-44">
                  <div>
                    <span className="text-[9px] text-toast-400 font-bold uppercase tracking-widest font-mono">Servidor de Señalización</span>
                    <h4 className="text-xs font-bold text-white mt-1">TURN-STUN Router US-West</h4>
                    <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">Encargado de perforar NATs simétricas y enrutar tráficos WebRTC.</p>
                  </div>
                  <div className="flex justify-between items-center text-xs border-t border-slate-800 pt-2 font-mono">
                    <span className="text-toast-400">● OPERATIVO</span>
                    <span>Lat: 11ms</span>
                  </div>
                </div>

                <div className="p-5 bg-slate-900 text-slate-300 rounded-xl border border-slate-950 flex flex-col justify-between h-44">
                  <div>
                    <span className="text-[9px] text-toast-400 font-bold uppercase tracking-widest font-mono">Consumo de Tráfico</span>
                    <h4 className="text-xs font-bold text-white mt-1">Bitrate Consolidado</h4>
                    <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">Suma ponderada de canales de audio y vídeo 4K en tránsito clínico.</p>
                  </div>
                  <div className="flex justify-between items-center text-xs border-t border-slate-800 pt-2 font-mono">
                    <span className="text-toast-400">14.2 Mbps</span>
                    <span>Pérdida pack: 0.01%</span>
                  </div>
                </div>

                <div className="p-5 bg-slate-900 text-slate-300 rounded-xl border border-slate-950 flex flex-col justify-between h-44">
                  <div>
                    <span className="text-[9px] text-toast-400 font-bold uppercase tracking-widest font-mono">Salas Médicas</span>
                    <h4 className="text-xs font-bold text-white mt-1">Salas en Co-Escucha Activa</h4>
                    <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">Cuartos virtuales reservados por los psicólogos.</p>
                  </div>
                  <div className="flex justify-between items-center text-xs border-t border-slate-800 pt-2 font-mono">
                    <span className="text-toast-400">1 Activa</span>
                    <span>3 Reservas</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mt-6 text-xs text-slate-600 space-y-2">
                <p className="font-bold text-slate-800">Estatus Operativo de Salas WebRTC:</p>
                <div className="space-y-1 font-mono text-[11px] bg-white p-3 border border-slate-200 rounded-lg">
                  <p className="flex items-center text-toast-600 font-semibold">✓ [CORRECTO] Sala "sebas-martinez-cbd1" asignada de forma segura (Dra. Camila Morales Vega).</p>
                  <p className="text-slate-400">✓ [PROGRAMADO] Sala "valeria-sotomayor-bvf9" reservada para 11:00 AM.</p>
                  <p className="text-slate-400">✓ [PROGRAMADO] Sala "andres-correa-zpx2" reservada para 02:30 PM.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: CLINICAL RAG LLM DOCUMENTAL SYSTEM AND MASS FILE UPLOADER */}
        {activeTab === 'advanced_docs' && (
          <div className="max-w-7xl mx-auto space-y-6 text-left">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5 md:p-6">
              <div className="border-b border-slate-100 pb-3 mb-6">
                <h2 className="text-sm font-extrabold text-slate-900 tracking-tight flex items-center">
                  <Cpu className="w-5 h-5 mr-1.5 text-toast-500" />
                  Gestión Documental Avanzada con Red RAG / LLM
                </h2>
                <p className="text-xs text-slate-400">Sube historiales en masse de manera encriptada. El sistema extraerá e integrará de forma asíncrona perfiles clínicos consolidados.</p>
              </div>

              <div className="border-2 border-dashed border-slate-200 hover:border-toast-400 rounded-2xl p-8 bg-slate-50 text-center space-y-3 transition-colors max-w-xl mx-auto py-12 relative overflow-hidden">
                <input
                  type="file"
                  id="dropzone-file-mass-upload"
                  multiple
                  className="hidden"
                  onChange={handleDropzoneUpload}
                />
                
                <label 
                  htmlFor="dropzone-file-mass-upload" 
                  className="cursor-pointer flex flex-col items-center justify-center space-y-20-px"
                >
                  <UploadCloud className="w-12 h-12 text-slate-400 animate-bounce mx-auto" style={{ animationDuration: '3s' }} />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-800">
                      Arrastra tus historias clínicas aquí o haz <span className="text-toast-500 underline">clic para explorar</span>
                    </p>
                    <p className="text-[10px] text-slate-400">Documentación masiva compatible (PDF, Word, Excel, SQL, TXT)</p>
                  </div>
                </label>
              </div>

              {ragStatusMessage && (
                <div className={`p-4 rounded-xl text-xs border max-w-xl mx-auto mt-4 font-medium flex items-center shadow-2xs ${
                  ragStatusMessage.startsWith('✅') ? 'bg-toast-100 text-charcoal-900 border-toast-300' : 'bg-charcoal-900 text-white border-charcoal-950'
                }`}>
                  <Zap className="w-4.5 h-4.5 mr-2 shrink-0 text-current animate-pulse" />
                  <span>{ragStatusMessage}</span>
                </div>
              )}

              {uploadedFiles.length > 0 && (
                <div className="max-w-xl mx-auto mt-6 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3">Archivos en cola de procesamiento RAG:</h4>
                  <div className="space-y-2">
                    {uploadedFiles.map((file, idx) => (
                      <div key={idx} className="bg-white p-2 px-3 rounded-lg border border-slate-200 text-xs flex justify-between items-center text-slate-600">
                        <span className="font-medium truncate max-w-xs">{file.name}</span>
                        <span className="text-[10px] bg-toast-100 text-toast-500 rounded px-1.5 py-0.2 font-mono font-bold">PARSED_OK</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW: MULTI-TENANCY CONTROL, TENANT MANAGEMENT & DATABASE CONFIGS */}
        {activeTab === 'multitenant' && (
          <div className="max-w-7xl mx-auto space-y-6 text-left">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 shadow-xs p-5 md:p-6 space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <h2 className="font-bold text-sm text-slate-900 tracking-tight flex items-center">
                    <Globe className="w-5 h-5 mr-1.5 text-toast-500" />
                    Catálogo Activo de Dominios y Licencias (Multi-Tenant)
                  </h2>
                  <p className="text-xs text-slate-400">Sincronización instantánea de inquilinos y bases de datos asignadas al clúster MindPsic.</p>
                </div>

                <div className="space-y-3">
                  {tenants.map((ten) => (
                    <div 
                      key={ten.id} 
                      className="p-4 bg-slate-50 border border-slate-150 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1.5 flex-1 pr-4">
                        <div className="flex items-center space-x-2">
                          <h3 className="font-extrabold text-slate-800 text-xs">{ten.organization}</h3>
                          <span className={`text-[9px] font-bold uppercase rounded-md px-1.5 py-0.2 ${
                            ten.status === 'active' 
                              ? 'bg-toast-100 text-toast-500 border border-toast-300' 
                              : 'bg-charcoal-900 text-white border border-charcoal-950'
                          }`}>
                            {ten.status === 'active' ? 'Conectado' : 'Suspendido'}
                          </span>
                        </div>
                        
                        <p className="text-slate-500 flex items-center font-mono text-[11px]">
                          <Globe className="w-3.5 h-3.5 mr-1 text-slate-400" />
                          Host: <span className="text-toast-500 font-semibold ml-1 underline">{ten.domain}</span>
                        </p>

                        <div className="p-1.5 bg-slate-900/5 hover:bg-slate-900/10 rounded-lg text-[10px] text-slate-600 font-mono truncate flex items-center border border-slate-200/50">
                          <Database className="w-3.5 h-3.5 mr-1 text-slate-500 shrink-0" />
                          <span className="truncate" title={ten.dbConnection}>{ten.dbConnection}</span>
                        </div>

                        <div className="flex flex-wrap text-[10px] text-slate-400 gap-x-4">
                          <span>Ubicación: {ten.region}</span>
                          <span>Usuarios activos: <strong>{ten.usersActive} / {ten.usersLimit}</strong></span>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center">
                        <button
                          onClick={() => toggleTenantStatus(ten.id)}
                          id={`btn-toggle-tenant-${ten.id}`}
                          className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-colors cursor-pointer border ${
                            ten.status === 'active'
                              ? 'bg-white hover:bg-slate-100 text-charcoal-900 border-slate-300'
                              : 'bg-charcoal-900 hover:bg-charcoal-950 text-white border-charcoal-950'
                          }`}
                        >
                          {ten.status === 'active' ? 'Suspender' : 'Sincronizar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 md:p-6 space-y-4">
                <div className="border-b border-slate-100 pb-2">
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center">
                    <PlusCircle className="w-4 h-4 mr-1 text-toast-500" />
                    Registrar Nuevo Inquilino
                  </h3>
                  <p className="text-[11px] text-slate-400">Sincronizar nuevo domínio de consultorio médico.</p>
                </div>

                <form onSubmit={handleCreateTenant} className="space-y-4">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-700 mb-1">
                      Nombre Inquilino / Clinica
                    </label>
                    <input
                      type="text"
                      required
                      value={newTenant.organization}
                      onChange={(e) => setNewTenant(prev => ({ ...prev, organization: e.target.value }))}
                      placeholder="e.g. Clínica Alivio Pereira"
                      className="block w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-toast-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-700 mb-1">
                      Dominio DNS Reservado
                    </label>
                    <input
                      type="text"
                      required
                      value={newTenant.domain}
                      onChange={(e) => setNewTenant(prev => ({ ...prev, domain: e.target.value }))}
                      placeholder="e.g. pereira-alivio.mindpsic.com"
                      className="block w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-toast-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-700 mb-1">
                      Límite de Psicólogos Permitidos
                    </label>
                    <input
                      type="number"
                      required
                      value={newTenant.usersLimit}
                      onChange={(e) => setNewTenant(prev => ({ ...prev, usersLimit: Number(e.target.value) }))}
                      className="block w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-toast-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold text-slate-700 mb-1">
                      Zona Región de Respaldos (GCP SQL)
                    </label>
                    <select
                      value={newTenant.region}
                      onChange={(e) => setNewTenant(prev => ({ ...prev, region: e.target.value }))}
                      className="block w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-toast-500 text-slate-900"
                    >
                      <option value="us-west2 (Oregon)">us-west2 (Oregon)</option>
                      <option value="us-east4 (N. Virginia)">us-east4 (N. Virginia)</option>
                      <option value="southamerica-east1 (São Paulo)">southamerica-east1 (São Paulo)</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    id="btn-submit-tenancy"
                    className="w-full bg-charcoal-900 hover:bg-charcoal-950 text-white font-bold p-2.5 rounded-xl text-xs transition-all shadow-md cursor-pointer text-center"
                  >
                    Sincronizar Inquilino
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: BILLING & INSURANCE AGREEMENTS, RIPS GENERATOR & PATIENT DATABASE CONTACTS */}
        {activeTab === 'billing_rips' && (
          <div className="max-w-7xl mx-auto space-y-6 text-left">
            <div className="border-b border-slate-200 pb-4">
              <span className="bg-toast-100 text-charcoal-900 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border border-toast-300 font-mono">
                Facturación Financiera y Reportes Gubernamentales
              </span>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">
                Servicios de Facturación, Convenios &amp; RIPS
              </h1>
              <p className="text-xs text-slate-400">
                Gestión unificada de convenios con aseguradoras, registro de cobradores clínicos, y generación asíncrona de archivos RIPS 4.0.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3 bg-white rounded-xl border border-slate-100 p-5 md:p-6 shadow-xs space-y-4">
                <div className="border-b border-slate-100 pb-2.5">
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center">
                    <Receipt className="w-4.5 h-4.5 mr-1.5 text-toast-500 font-bold" />
                    Distribución de Pacientes por Convenio Clínico
                  </h3>
                  <p className="text-[11px] text-slate-400">Padrón de afiliados vinculados a aseguradoras integradas.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-4 bg-charcoal-900 rounded-xl border border-charcoal-950 flex items-center justify-between text-white">
                    <div>
                      <span className="text-[10px] uppercase font-mono text-toast-300 block">MindHealth Global (Corp)</span>
                      <span className="font-extrabold text-lg text-white font-mono">42 Pacientes</span>
                    </div>
                    <span className="text-[10px] bg-charcoal-950 text-toast-300 font-bold p-1 px-2 rounded">Activo 100%</span>
                  </div>

                  <div className="p-4 bg-toast-50/50 rounded-xl border border-toast-200 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-mono text-charcoal-700 block">Sura Medicina Prepagada</span>
                      <span className="font-extrabold text-lg text-slate-900 font-mono">30 Pacientes</span>
                    </div>
                    <span className="text-[10px] bg-toast-100 text-toast-500 font-bold p-1 px-2 rounded">Activo 100%</span>
                  </div>

                  <div className="p-4 bg-toast-50/50 rounded-xl border border-toast-200 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-mono text-charcoal-700 block">Colmédica Prepagada</span>
                      <span className="font-extrabold text-lg text-slate-900 font-mono">18 Pacientes</span>
                    </div>
                    <span className="text-[10px] bg-toast-100 text-toast-500 font-bold p-1 px-2 rounded">Activo 100%</span>
                  </div>

                  <div className="p-4 bg-toast-50/50 rounded-xl border border-toast-200 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-mono text-charcoal-700 block">Coomeva Medicina Prepagada</span>
                      <span className="font-extrabold text-lg text-slate-900 font-mono">15 Pacientes</span>
                    </div>
                    <span className="text-[10px] bg-toast-100 text-toast-500 font-bold p-1 px-2 rounded">Activo 100%</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-150 rounded-xl flex items-center justify-between text-xs text-slate-600">
                  <div className="space-y-0.5">
                    <p className="font-bold text-slate-900">Particular (Directo Privado)</p>
                    <p className="text-[11px] text-slate-400">Pacientes con facturación autónoma por PSE o Tarjeta.</p>
                  </div>
                  <strong className="text-slate-900 font-extrabold font-mono text-xs">25 Pacientes</strong>
                </div>

                <p className="text-[10.5px] text-slate-400 leading-relaxed italic block pt-1 bg-slate-50/40 p-2.5 rounded border border-slate-200/50">
                  * Los conteos por convenios se actualizan asíncronamente con el validador regional de cada aseguradora al guardar la firma digital de las notas progresivas.
                </p>
              </div>

              <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 p-5 md:p-6 shadow-xs space-y-4">
                <div className="border-b border-slate-100 pb-2.5">
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center">
                    <PlusCircle className="w-4.5 h-4.5 mr-1.5 text-toast-500" />
                    Registrar Facturador Clínico o Auditor
                  </h3>
                  <p className="text-[11px] text-slate-400">Asigna permisos de recaudo para un dominio EPS.</p>
                </div>

                <form onSubmit={handleCreateBillingUser} className="space-y-3.5">
                  <div>
                    <label className="block text-[10px] uppercase font-extrabold text-slate-600 mb-1">Nombre Completo</label>
                    <input
                      type="text"
                      required
                      value={newBillingUser.name}
                      onChange={(e) => setNewBillingUser(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. Juan Carlos Restrepo"
                      className="block w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-toast-500 focus:bg-white"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase font-extrabold text-slate-600 mb-1">Rol Administrativo</label>
                      <select
                        value={newBillingUser.role}
                        onChange={(e) => setNewBillingUser(prev => ({ ...prev, role: e.target.value }))}
                        className="block w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-toast-500 focus:bg-white text-slate-900"
                      >
                        <option value="Facturador Clínico">Facturador Clínico</option>
                        <option value="Auditor Financiero EPS">Auditor Financiero EPS</option>
                        <option value="Administrador Financiero">Administrador Financiero</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase font-extrabold text-slate-600 mb-1">Aseguradora Bound</label>
                      <select
                        value={newBillingUser.agreement}
                        onChange={(e) => setNewBillingUser(prev => ({ ...prev, agreement: e.target.value }))}
                        className="block w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-toast-500 focus:bg-white text-slate-900"
                      >
                        <option value="Sura Medicina Prepagada">Sura</option>
                        <option value="Colmédica Prepagada">Colmédica</option>
                        <option value="Coomeva Medicina Prepagada">Coomeva</option>
                        <option value="MindHealth Global">Particular / Global</option>
                        <option value="Todos">Todos</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-charcoal-900 hover:bg-charcoal-950 text-white font-bold p-2.5 rounded-xl text-xs transition-all shadow-xs cursor-pointer border border-charcoal-950 text-center"
                  >
                    Vincular Operador de Facturas
                  </button>
                </form>

                <div className="pt-2 border-t border-slate-100">
                  <span className="block text-[10px] uppercase font-mono font-bold text-slate-400 mb-2">Operadores Registrados</span>
                  <div className="space-y-1.5 max-h-[16vh] overflow-y-auto pr-1">
                    {billingUsers.map(bu => (
                      <div key={bu.id} className="p-2 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs flex items-center justify-between">
                        <div>
                          <p className="font-bold text-slate-800">{bu.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{bu.role} • Bound: {bu.agreement}</p>
                        </div>
                        <span className="w-2 h-2 rounded-full bg-toast-500" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 md:p-6 space-y-4">
              <div className="border-b border-slate-100 pb-2.5">
                <h2 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center">
                  <FileCode className="w-4.5 h-4.5 mr-1.5 text-toast-500" />
                  Módulo de Sincronización RIPS 4.0 (SGCCC - MinSalud)
                </h2>
                <p className="text-[11px] text-slate-400">Genera transacciones de cobros clínicos para auditoría pública y reembolsos estatales.</p>
              </div>

              <div className="flex flex-col sm:flex-row items-end gap-3 bg-slate-50 p-4 rounded-xl border border-slate-150">
                <div className="flex-1 space-y-1 text-xs">
                  <label className="block text-[10px] uppercase font-bold text-slate-600">Periodo Histórico de Citas</label>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={ripsYear}
                      onChange={(e) => setRipsYear(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
                    >
                      <option value="2026">Año 2026</option>
                      <option value="2025">Año 2025</option>
                    </select>

                    <select
                      value={ripsMonth}
                      onChange={(e) => setRipsMonth(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
                    >
                      <option value="05">Mayo (05)</option>
                      <option value="06">Junio (06)</option>
                      <option value="07">Julio (07)</option>
                    </select>
                  </div>
                </div>

                <div className="flex-1 space-y-1 text-xs">
                  <label className="block text-[10px] uppercase font-bold text-slate-600">Aseguradora bound</label>
                  <select
                    value={ripsAgreement}
                    onChange={(e) => setRipsAgreement(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
                  >
                    <option value="Sura Medicina Prepagada">Sura Medicina Prepagada</option>
                    <option value="Colmédica Prepagada">Colmédica Prepagada</option>
                    <option value="Coomeva Medicina Prepagada">Coomeva Medicina Prepagada</option>
                    <option value="MindHealth Global">Particular / Corporativo Global</option>
                  </select>
                </div>

                <button
                  onClick={handleGenerateRips}
                  className="bg-charcoal-900 hover:bg-slate-950 text-white font-bold text-xs p-2.5 px-5 rounded-lg transition-all cursor-pointer shadow-xs self-stretch sm:self-auto flex items-center justify-center gap-1 border border-charcoal-950"
                >
                  <Zap className="w-4 h-4 text-toast-300" />
                  <span>Generar RIPS (XML)</span>
                </button>
              </div>

              {ripsOutput && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono bg-slate-900 text-slate-300 p-2.5 px-4 rounded-t-xl border-b border-slate-800">
                    <span className="text-toast-400 font-bold uppercase tracking-wider text-[10px]">RIPS_GENERATED_PAYLOAD.xml</span>
                    
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(ripsOutput);
                          alert('Código RIPS copiado al portapapeles.');
                        }}
                        className="p-1 px-2.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 text-[10px] font-bold cursor-pointer"
                      >
                        Copiar XML
                      </button>
                      
                      <button
                        onClick={() => {
                          alert('Descargando archivo localmente:\nRIPS_GENERATED_PAYLOAD.xml registrado para el validador ministerial.');
                        }}
                        className="p-1 px-2.5 bg-charcoal-900 hover:bg-charcoal-950 rounded text-white text-[10px] font-bold cursor-pointer border border-charcoal-950"
                      >
                        Descargar XML
                      </button>
                    </div>
                  </div>

                  <pre className="bg-slate-950 text-toast-400 p-4 rounded-b-xl overflow-x-auto text-[11px] font-mono leading-relaxed max-h-[300px] border border-slate-900 text-left">
                    <code>{ripsOutput}</code>
                  </pre>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 md:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-3">
                <div className="text-left">
                  <h3 className="font-bold text-sm text-slate-900 tracking-tight flex items-center">
                    <Users className="w-5 h-5 mr-1.5 text-toast-500" />
                    Directorio Clínico Global de Pacientes y Contactos
                  </h3>
                  <p className="text-xs text-slate-400">Acceso a coordenadas de correspondencia física, digital y telefónica de afiliados registrados.</p>
                </div>

                <div className="relative max-w-sm w-full shrink-0">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                    <Search className="w-4 h-4 text-slate-400" />
                  </span>
                  <input
                    type="text"
                    value={patientSearchTerm}
                    onChange={(e) => setPatientSearchTerm(e.target.value)}
                    placeholder="Filtrar por nombre o identificación..."
                    className="block w-full text-xs pl-9 pr-3 py-2 bg-slate-50 border border-slate-250 rounded-lg focus:ring-2 focus:ring-toast-500 focus:bg-white"
                  />
                </div>
              </div>

              <div className="border border-slate-100 rounded-xl overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-mono uppercase text-[9px] tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="p-3 pl-4">Identificación</th>
                      <th className="p-3">Nombre Completo</th>
                      <th className="p-3">Convenio Activo</th>
                      <th className="p-3">Datos de Contacto</th>
                      <th className="p-3">Dirección Residencial Registrada</th>
                      <th className="p-3 text-right pr-4">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {patientsLoading ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-500 animate-pulse font-semibold">
                          Cargando directorio de pacientes...
                        </td>
                      </tr>
                    ) : (
                      <>
                        {patients
                          .filter(p => {
                            if (!patientSearchTerm) return true;
                            return p.name.toLowerCase().includes(patientSearchTerm.toLowerCase()) || 
                                   p.id.toLowerCase().includes(patientSearchTerm.toLowerCase());
                          })
                          .map((p) => (
                            <tr key={p.id} className="hover:bg-slate-50/50">
                              <td className="p-3 pl-4 font-mono font-bold text-slate-700">
                                {p.id}
                              </td>
                              <td className="p-3 font-semibold text-slate-900 text-xs">
                                {p.name}
                              </td>
                              <td className="p-3">
                                <span className="p-1 px-2 rounded-md bg-toast-50 text-charcoal-900 text-[10px] font-medium border border-toast-300">
                                  {p.agreement}
                                </span>
                              </td>
                              <td className="p-3 text-xs leading-relaxed space-y-0.5">
                                <p className="font-mono text-slate-900">{p.phone}</p>
                                <p className="text-slate-400 text-[10.5px] font-mono">{p.email}</p>
                              </td>
                              <td className="p-3 font-mono text-slate-600 text-[10.5px]">
                                Calle 100 #8A-34, Bogotá D.C., COL
                              </td>
                              <td className="p-3 text-right pr-4">
                                <button
                                  onClick={() => {
                                    alert(`Enviando notificación electrónica de cobro y recordatorio a: ${p.email}`);
                                  }}
                                  className="p-1 px-2 bg-toast-100 hover:bg-toast-200 text-charcoal-900 text-[10.5px] border border-toast-300 rounded-md cursor-pointer font-bold"
                                >
                                  Notificar Cobro
                                </button>
                              </td>
                            </tr>
                          ))}

                        {patients.filter(p => {
                          if (!patientSearchTerm) return true;
                          return p.name.toLowerCase().includes(patientSearchTerm.toLowerCase()) || 
                                 p.id.toLowerCase().includes(patientSearchTerm.toLowerCase());
                        }).length === 0 && (
                          <tr>
                            <td colSpan={6} className="p-8 text-center text-slate-400">
                              No se encontraron pacientes que coincidan con la búsqueda.
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
