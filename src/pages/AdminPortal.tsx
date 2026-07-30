/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, FormEvent, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import * as XLSX from 'xlsx-js-style';
import { confirmToast } from '../lib/confirmToast';
import { 
  mockPsychologistsPerformance, 
  initialClinicalFiles
} from '../data/mockData';
import { useAppointments } from '../hooks/useAppointments';
import { usePatients } from '../hooks/usePatients';
import { useGlobalChat } from '../hooks/useGlobalChat';
import InternalChat from '../components/InternalChat';
import VideollamadaVercel from '../components/VideollamadaVercel';
import DelegatedAppointmentModal, { prefetchSelectoresAgendamiento } from '../components/DelegatedAppointmentModal';
import PacientesPanel from '../components/EHR/PacientesPanel';
import { apiFetch } from '../lib/apiClient';
import { 
  Patient, 
  PsychologistPerformance,
  ClinicalFile,
  User
} from '../types';
import { 
  TrendingUp, 
  Users, 
  UploadCloud, 
  Search, 
  ShieldCheck, 
  Cpu,
  CheckCircle,
  Video, 
  BarChart3,
  Server,
  Zap,
  DollarSign,
  Receipt,
  FileCode,
  Filter,
  MessageSquare,
  UserPlus,
  PlusCircle,
  CalendarPlus,
  ShieldAlert,
  Trash2,
  Building2,
  Pencil,
  X,
  Download
} from 'lucide-react';

type AdminTab = 'metrics' | 'video_admin' | 'advanced_docs' | 'patients' | 'equipo' | 'convenios' | 'billing_rips' | 'chat';

export default function AdminPortal() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [showDelegatedModal, setShowDelegatedModal] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<any>(null);
  const [isGeneratingRips, setIsGeneratingRips] = useState(false);

  // Extracción del token de localStorage y consumo de hooks reales
  // IMPORTANT: Hooks MUST be called unconditionally at the top level — Rules of Hooks
  const token = localStorage.getItem('mind_token');
  const { appointments: realAppointments, loading: apptsLoading } = useAppointments(token);
  const { patients: realPatients, loading: patientsLoading } = usePatients(token);
  const { unreadCount: globalUnreadCount } = useGlobalChat();

  // ── Equipo y Accesos: autoservicio de aprovisionamiento (POST /users/provision) ──
  // NOTA: no se usa apiFetch/apiPost aquí a propósito — ese wrapper trata CUALQUIER
  // 403 como "tenant suspendido" y dispara logout global. /users/provision responde
  // 403 también para límite de licencias alcanzado o rol insuficiente, que son
  // errores de negocio normales, no una suspensión — se maneja con fetch directo.
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<'ESPECIALISTA_B2B' | 'OPERATIVO'>('ESPECIALISTA_B2B');
  const [isCreatingStaff, setIsCreatingStaff] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffSuccess, setStaffSuccess] = useState<{ name: string; email: string; tempPassword: string } | null>(null);

  const handleCreateStaff = async (e: FormEvent) => {
    e.preventDefault();
    if (!newStaffName.trim() || !newStaffEmail.trim()) return;

    setIsCreatingStaff(true);
    setStaffError(null);
    setStaffSuccess(null);

    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/users/provision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        // tenantId NUNCA se envía — el backend lo resuelve desde el usuario
        // real (DIRECTIVO queda bloqueado a su propio tenant automáticamente).
        body: JSON.stringify({
          name: newStaffName.trim(),
          email: newStaffEmail.trim().toLowerCase(),
          role: newStaffRole,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStaffError(data.error || data.detail || `Error HTTP ${res.status}`);
        return;
      }

      setStaffSuccess({
        name: newStaffName.trim(),
        email: newStaffEmail.trim().toLowerCase(),
        tempPassword: data.tempPassword,
      });
      setNewStaffName('');
      setNewStaffEmail('');
      setNewStaffRole('ESPECIALISTA_B2B');
      await fetchTeamUsers(); // refresca la lista de abajo con el nuevo colaborador
    } catch (err: any) {
      setStaffError('Error de red o comunicación con el servidor: ' + err.message);
    } finally {
      setIsCreatingStaff(false);
    }
  };

  // ── Panel: Usuarios de mi organización (mismo tenant del DIRECTIVO/CEO logueado) ──
  // GET /api/users sin query param → el backend resuelve el tenant automáticamente
  // desde el usuario real (Prisma), nunca hay que pasarlo a mano.
  interface TeamUser {
    id: string;
    name: string;
    email: string;
    role: string;
  }

  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [teamUsersLoading, setTeamUsersLoading] = useState(false);
  const [teamUsersError, setTeamUsersError] = useState<string | null>(null);
  const [deletingStaffId, setDeletingStaffId] = useState<string | null>(null);

  const fetchTeamUsers = async () => {
    setTeamUsersLoading(true);
    setTeamUsersError(null);
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const list = Array.isArray(data) ? data : (Array.isArray(data?.users) ? data.users : []);
      setTeamUsers(list);
    } catch (err: any) {
      setTeamUsersError(err.message || 'Error al cargar tu equipo.');
    } finally {
      setTeamUsersLoading(false);
    }
  };

  const handleDeleteTeamUser = async (member: TeamUser) => {
    if (!(await confirmToast(`¿Eliminar a "${member.name}" (${member.email})? Esta acción borra su cuenta por completo y no se puede deshacer.`))) {
      return;
    }
    setDeletingStaffId(member.id);
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/users/${member.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error('Error del servidor: ' + (data.error || `HTTP ${res.status}`));
        return;
      }
      await fetchTeamUsers();
    } catch (err: any) {
      toast.error('Error de red o comunicación con el servidor: ' + err.message);
    } finally {
      setDeletingStaffId(null);
    }
  };

  // ── Convenios / Clientes Corporativos: catálogo propio del tenant ──
  // Igual que Equipo y Accesos: fetch directo (no apiFetch) para no disparar
  // el logout global ante un 403 de negocio (ej. nombre duplicado en el tenant).
  interface ServiceLocationRecord {
    id: string;
    name: string;
    address?: string | null;
  }

  interface CompanyRecord {
    id: string;
    name: string;
    domain?: string | null;
    taxId?: string | null;
    clientType: 'EMPRESA' | 'PARTICULAR';
    agreementType?: string | null;
    coveredSessions?: number | null;
    validFrom?: string | null;
    validUntil?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    status: string;
    notes?: string | null;
    isDefault: boolean;
    locations: ServiceLocationRecord[];
  }

  const emptyCompanyForm = {
    name: '', domain: '', taxId: '', clientType: 'EMPRESA' as 'EMPRESA' | 'PARTICULAR',
    agreementType: '', coveredSessions: '', validFrom: '', validUntil: '',
    contactName: '', contactPhone: '', contactEmail: '', notes: '',
  };

  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [savingCompany, setSavingCompany] = useState(false);
  const [companyFormError, setCompanyFormError] = useState<string | null>(null);

  const [editingLocations, setEditingLocations] = useState<ServiceLocationRecord[]>([]);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationAddress, setNewLocationAddress] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);

  const fetchCompanies = async () => {
    setCompaniesLoading(true);
    setCompaniesError(null);
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/companies`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ([]));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCompanies(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setCompaniesError(err.message || 'Error al cargar los convenios.');
    } finally {
      setCompaniesLoading(false);
    }
  };

  const openCreateCompanyModal = () => {
    setEditingCompanyId(null);
    setCompanyForm(emptyCompanyForm);
    setCompanyFormError(null);
    setEditingLocations([]);
    setNewLocationName('');
    setNewLocationAddress('');
    setShowCompanyModal(true);
  };

  const openEditCompanyModal = (c: CompanyRecord) => {
    setEditingCompanyId(c.id);
    setCompanyForm({
      name: c.name,
      domain: c.domain || '',
      taxId: c.taxId || '',
      clientType: c.clientType,
      agreementType: c.agreementType || '',
      coveredSessions: c.coveredSessions?.toString() || '',
      validFrom: c.validFrom ? c.validFrom.slice(0, 10) : '',
      validUntil: c.validUntil ? c.validUntil.slice(0, 10) : '',
      contactName: c.contactName || '',
      contactPhone: c.contactPhone || '',
      contactEmail: c.contactEmail || '',
      notes: c.notes || '',
    });
    setCompanyFormError(null);
    setEditingLocations(c.locations || []);
    setNewLocationName('');
    setNewLocationAddress('');
    setShowCompanyModal(true);
  };

  const handleAddLocation = async () => {
    if (!editingCompanyId || !newLocationName.trim()) return;
    setSavingLocation(true);
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/companies/${editingCompanyId}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: newLocationName.trim(), address: newLocationAddress.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Error al agregar la ubicación de atención.');
        return;
      }
      setEditingLocations((prev) => [...prev, data]);
      setNewLocationName('');
      setNewLocationAddress('');
      await fetchCompanies();
    } catch (err: any) {
      toast.error('Error de red: ' + err.message);
    } finally {
      setSavingLocation(false);
    }
  };

  const handleRemoveLocation = async (locationId: string) => {
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/companies/locations/${locationId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      setEditingLocations((prev) => prev.filter((l) => l.id !== locationId));
      await fetchCompanies();
    } catch {
      toast.error('Error al eliminar la ubicación de atención.');
    }
  };

  const handleSaveCompany = async (e: FormEvent) => {
    e.preventDefault();
    if (!companyForm.name.trim()) return;
    setSavingCompany(true);
    setCompanyFormError(null);
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const isEditing = !!editingCompanyId;
      const res = await fetch(`${apiUrl}/api/companies${isEditing ? `/${editingCompanyId}` : ''}`, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          name: companyForm.name.trim(),
          domain: companyForm.domain.trim() || null,
          taxId: companyForm.taxId.trim() || null,
          clientType: companyForm.clientType,
          agreementType: companyForm.agreementType.trim() || null,
          coveredSessions: companyForm.coveredSessions ? Number(companyForm.coveredSessions) : null,
          validFrom: companyForm.validFrom || null,
          validUntil: companyForm.validUntil || null,
          contactName: companyForm.contactName.trim() || null,
          contactPhone: companyForm.contactPhone.trim() || null,
          contactEmail: companyForm.contactEmail.trim() || null,
          notes: companyForm.notes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCompanyFormError(data.error || `Error HTTP ${res.status}`);
        return;
      }
      setShowCompanyModal(false);
      await fetchCompanies();
    } catch (err: any) {
      setCompanyFormError('Error de red: ' + err.message);
    } finally {
      setSavingCompany(false);
    }
  };

  const handleToggleCompanyStatus = async (c: CompanyRecord) => {
    const nextStatus = c.status === 'activo' ? 'inactivo' : 'activo';
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/companies/${c.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error();
      await fetchCompanies();
    } catch {
      toast.error('Error al cambiar el estado del convenio.');
    }
  };

  const handleDeleteCompany = async (c: CompanyRecord) => {
    if (!(await confirmToast(`¿Eliminar el convenio/cliente "${c.name}"? Esta acción no se puede deshacer.`))) return;
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/companies/${c.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Error al eliminar el convenio.');
        return;
      }
      await fetchCompanies();
    } catch (err: any) {
      toast.error('Error de red: ' + err.message);
    }
  };

  // RENDIMIENTO: precargar los catálogos del agendamiento en cuanto monta la
  // página. El agendamiento es el flujo central y se usa a diario; adelantar la
  // carga aquí hace que el modal abra de inmediato en vez de cobrarle al
  // usuario el arranque en frío de Lambda justo cuando pulsa "Agendar cita".
  useEffect(() => {
    prefetchSelectoresAgendamiento();
  }, []);

  // Verificación de sesión + RBAC (sin navigate — App.tsx maneja la guardia por estado)
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

      // ── RBAC Guard: Solo CEO y DIRECTIVO pueden acceder al AdminPortal ──
      const ADMIN_ROLES = ['CEO', 'DIRECTIVO'];
      if (!ADMIN_ROLES.includes(userData.role)) {
        setAccessDenied(true);
      }
    } catch (error) {
      localStorage.removeItem('mind_token');
      localStorage.removeItem('mind_user');
    } finally {
      setAuthLoading(false);
    }
  }, []);



  const [activeTab, setActiveTab] = useState<AdminTab>('metrics');

  // Carga el equipo de mi organización al entrar al tab "Equipo y Accesos"
  useEffect(() => {
    if (activeTab !== 'equipo') return;
    fetchTeamUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Carga los convenios/clientes al entrar al tab "Convenios" o "Facturación y RIPS"
  // (este último los necesita para el selector de Contrato del generador RIPS)
  useEffect(() => {
    if (activeTab !== 'convenios' && activeTab !== 'billing_rips') return;
    fetchCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const [dashboardMetrics, setDashboardMetrics] = useState({
    pacientesAtendidosCount: 0,
    psicologosActivosCount: 0,
    evolucionesHistoricasCount: 0,
    satisfaccionPromedio: 0
  });

  const fetchMetrics = async () => {
    try {
      const storedToken = localStorage.getItem('mind_token');
      const userStr = localStorage.getItem('mind_user');
      const tenantId = userStr ? JSON.parse(userStr).tenantId : '';
      const res = await apiFetch('/api/metrics/dashboard');
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = await res.json();
      console.log('RAW METRICS RESPONSE:', data);
      const metrics = data.data || data || {};
      
      setDashboardMetrics({
        pacientesAtendidosCount: metrics.pacientesAtendidosCount || 0,
        psicologosActivosCount: metrics.psicologosActivosCount || 0,
        evolucionesHistoricasCount: metrics.evolucionesHistoricasCount || 0,
        satisfaccionPromedio: metrics.satisfaccionPromedio || 0
      });
    } catch (err) {
      console.error('Error fetching dashboard metrics', err);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchMetrics();
    }
  }, [currentUser]);
  
  // React dynamic administrative states
  const [performances, setPerformances] = useState<PsychologistPerformance[]>([]);
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
      reason: appt.notes || null
    };
  });


  // Advanced Docs multi-upload states
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [isProcessingRAG, setIsProcessingRAG] = useState(false);
  const [ragStatusMessage, setRagStatusMessage] = useState<string | null>(null);

  // Billing & RIPS panel states
  const [billingUsers, setBillingUsers] = useState([]);
  const [newBillingUser, setNewBillingUser] = useState({
    name: '',
    role: 'Facturador Clínico',
    agreement: 'Sura Medicina Prepagada'
  });

  const [ripsYear, setRipsYear] = useState('2026');
  const [ripsMonth, setRipsMonth] = useState('05');
  const [ripsCompanyId, setRipsCompanyId] = useState('all');
  const [ripsFiles, setRipsFiles] = useState<{ US: string; AT: string; AC: string; CT: string } | null>(null);
  const [ripsWarnings, setRipsWarnings] = useState<string[]>([]);
  const [ripsPreviewTab, setRipsPreviewTab] = useState<'US' | 'AT' | 'AC' | 'CT'>('US');
  const [patientSearchTerm, setPatientSearchTerm] = useState('');

  // ── Filtros de exportación del Directorio Clínico (Facturación y RIPS) ──
  const [reportDateFrom, setReportDateFrom] = useState('');
  const [reportDateTo, setReportDateTo] = useState('');
  const [reportCompanyId, setReportCompanyId] = useState('all');
  const [reportStatus, setReportStatus] = useState('all');
  const [reportPsychologistId, setReportPsychologistId] = useState('all');
  const [isExportingReport, setIsExportingReport] = useState(false);

  const APPOINTMENT_STATUS_OPTIONS = ['Pendiente', 'Atendida', 'No Atendido', 'Reprogramada'];

  const handleExportPatientsExcel = async () => {
    setIsExportingReport(true);
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const params = new URLSearchParams();
      if (reportDateFrom) params.set('dateFrom', reportDateFrom);
      if (reportDateTo) params.set('dateTo', reportDateTo);
      if (reportCompanyId !== 'all') params.set('companyId', reportCompanyId);
      if (reportStatus !== 'all') params.set('status', reportStatus);
      if (reportPsychologistId !== 'all') params.set('psychologistId', reportPsychologistId);

      const res = await fetch(`${apiUrl}/api/patients/export-report?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error('Error al generar el reporte: ' + (data.error || `HTTP ${res.status}`));
        return;
      }

      const rows: Array<{
        documentId: string; firstName: string; lastName: string; phone: string; email: string;
        convenio: string; psicologoAsignado: string; totalCitas: number; fechas: string; estados: string;
        psicologosEnCitas: string; totalReprogramaciones: number; quienReprogramo: string;
      }> = data.rows || [];

      if (rows.length === 0) {
        toast.error('No hay pacientes que coincidan con los filtros seleccionados.');
        return;
      }

      const columns = [
        { header: 'Identificación', key: 'documentId', width: 16 },
        { header: 'Nombres', key: 'firstName', width: 16 },
        { header: 'Apellidos', key: 'lastName', width: 18 },
        { header: 'Teléfono', key: 'phone', width: 15 },
        { header: 'Correo', key: 'email', width: 26 },
        { header: 'Convenio', key: 'convenio', width: 20 },
        { header: 'Psicólogo Asignado', key: 'psicologoAsignado', width: 22 },
        { header: 'Total de Citas', key: 'totalCitas', width: 13 },
        { header: 'Fechas de Citas', key: 'fechas', width: 28 },
        { header: 'Estados de Citas', key: 'estados', width: 24 },
        { header: 'Psicólogo(s) en Citas', key: 'psicologosEnCitas', width: 22 },
        { header: 'Total Reprogramaciones', key: 'totalReprogramaciones', width: 14 },
        { header: 'Quién Reprogramó', key: 'quienReprogramo', width: 20 },
      ] as const;

      const filterLabels: string[] = [];
      if (reportDateFrom) filterLabels.push(`Desde ${reportDateFrom}`);
      if (reportDateTo) filterLabels.push(`Hasta ${reportDateTo}`);
      if (reportCompanyId !== 'all') filterLabels.push(`Convenio: ${companies.find((c) => c.id === reportCompanyId)?.name || reportCompanyId}`);
      if (reportStatus !== 'all') filterLabels.push(`Estado: ${reportStatus}`);
      if (reportPsychologistId !== 'all') filterLabels.push(`Psicólogo: ${teamUsers.find((u) => u.id === reportPsychologistId)?.name || reportPsychologistId}`);

      const TITLE_ROW = 0;
      const SUBTITLE_ROW = 1;
      const HEADER_ROW = 3;
      const FIRST_DATA_ROW = 4;
      const lastCol = columns.length - 1;

      const aoa: any[][] = [
        ['Directorio Clínico Global de Pacientes y Contactos'],
        [`Generado el ${new Date().toLocaleString('es-CO')}${filterLabels.length ? ' — Filtros: ' + filterLabels.join(' | ') : ' — Sin filtros aplicados'}`],
        [],
        columns.map((c) => c.header),
        ...rows.map((r) => columns.map((c) => (r as any)[c.key])),
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = columns.map((c) => ({ wch: c.width }));
      ws['!merges'] = [
        { s: { r: TITLE_ROW, c: 0 }, e: { r: TITLE_ROW, c: lastCol } },
        { s: { r: SUBTITLE_ROW, c: 0 }, e: { r: SUBTITLE_ROW, c: lastCol } },
      ];
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: HEADER_ROW, c: 0 }, e: { r: HEADER_ROW, c: lastCol } }) };

      const BRAND_DARK = '111827';
      const BRAND_ACCENT = 'F5A623';
      const BORDER_COLOR = 'D1D5DB';
      const thinBorder = { style: 'thin', color: { rgb: BORDER_COLOR } };
      const allBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

      const titleCell = ws[XLSX.utils.encode_cell({ r: TITLE_ROW, c: 0 })];
      if (titleCell) titleCell.s = {
        font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: BRAND_DARK } },
        alignment: { horizontal: 'left', vertical: 'center' },
      };
      const subtitleCell = ws[XLSX.utils.encode_cell({ r: SUBTITLE_ROW, c: 0 })];
      if (subtitleCell) subtitleCell.s = {
        font: { italic: true, sz: 9, color: { rgb: BRAND_ACCENT } },
        fill: { fgColor: { rgb: BRAND_DARK } },
        alignment: { horizontal: 'left', vertical: 'center' },
      };

      columns.forEach((_, colIdx) => {
        const headerCell = ws[XLSX.utils.encode_cell({ r: HEADER_ROW, c: colIdx })];
        if (headerCell) headerCell.s = {
          font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: BRAND_DARK } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: allBorders,
        };
      });

      rows.forEach((r, rowIdx) => {
        const isEven = rowIdx % 2 === 0;
        columns.forEach((c, colIdx) => {
          const cellRef = XLSX.utils.encode_cell({ r: FIRST_DATA_ROW + rowIdx, c: colIdx });
          const cell = ws[cellRef];
          if (!cell) return;
          const isNumericCol = c.key === 'totalCitas' || c.key === 'totalReprogramaciones';
          const highlightReprog = c.key === 'totalReprogramaciones' && r.totalReprogramaciones > 0;
          cell.s = {
            font: { sz: 10, bold: highlightReprog, color: { rgb: highlightReprog ? 'B45309' : '111827' } },
            fill: { fgColor: { rgb: highlightReprog ? 'FEF3C7' : (isEven ? 'F9FAFB' : 'FFFFFF') } },
            alignment: { horizontal: isNumericCol ? 'center' : 'left', vertical: 'center', wrapText: c.key === 'fechas' || c.key === 'estados' },
            border: allBorders,
          };
        });
      });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Directorio Pacientes');
      XLSX.writeFile(wb, `directorio_pacientes_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`Excel generado con ${rows.length} paciente(s).`);
    } catch (err: any) {
      toast.error('Error de red al generar el reporte: ' + err.message);
    } finally {
      setIsExportingReport(false);
    }
  };


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

  // ── RBAC: Pantalla de acceso denegado para roles no autorizados ─────────
  if (accessDenied) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="bg-white border border-red-200 rounded-2xl shadow-lg max-w-md w-full p-8 text-center space-y-4">
          <div className="w-14 h-14 mx-auto bg-red-50 rounded-full flex items-center justify-center">
            <ShieldAlert className="w-7 h-7 text-red-500" />
          </div>
          <h2 className="text-lg font-bold text-slate-800">Acceso Restringido</h2>
          <p className="text-sm text-slate-500">
            Tu rol actual (<strong className="text-slate-700">{currentUser.role}</strong>) no tiene permisos para
            acceder al Portal Administrativo. Solo los roles <strong>CEO</strong> y <strong>DIRECTIVO</strong> pueden
            operar esta vista.
          </p>
          <p className="text-xs text-slate-400">
            Si crees que esto es un error, contacta al administrador de tu clínica.
          </p>
        </div>
      </div>
    );
  }

  // Dynamic filter patients by agreement
  const filteredPatients = selectedAgreement === 'todos' 
    ? patients 
    : patients.filter(p => p.agreement.toLowerCase().includes(selectedAgreement.toLowerCase()));

  // Dynamic computation of clinical stats
  const totalPatientsCount = dashboardMetrics.pacientesAtendidosCount;
  const activePsychologistsCount = dashboardMetrics.psicologosActivosCount;
  const totalCompletedSessionsCount = dashboardMetrics.evolucionesHistoricasCount;
  const avgSatisfactionRate = dashboardMetrics.satisfaccionPromedio;

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
  const attendedCount = filteredAppointments.filter(app => ['Atendida', 'Atendido', 'ATENDIDO'].includes(app.status)).length;
  const unattendedOrReprogrammedCount = filteredAppointments.filter(app => app.status === 'No Atendido' || app.status === 'Reprogramada' || app.status === 'Pendiente').length;


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
    toast.success(`Usuario de Facturación "${newObj.name}" registrado e integrado con éxito.`);
  };

  // Genera los 4 archivos planos oficiales del RIPS (US/AT/AC/CT.txt) con
  // datos reales: pacientes/consultas/diagnósticos vienen de Appointment +
  // RipsDiagnosis del periodo seleccionado — solo entran pacientes que YA
  // tienen diagnóstico RIPS asignado ese mes (ver "Sin diagnóstico RIPS" en
  // Historias Clínicas para resolver los que falten). Se agrupa por Contrato
  // (Convenio real) — una factura consecutiva y persistente por convenio; si
  // se elige "Todos", trae una factura por cada convenio con pacientes ese
  // mes. El backend arma el contenido de los 4 archivos directamente (misma
  // lógica regulatoria en un solo lugar, no duplicada aquí).
  const handleGenerateRips = async () => {
    setIsGeneratingRips(true);
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/rips-diagnosis/export?year=${ripsYear}&month=${ripsMonth}&companyId=${ripsCompanyId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error('Error al generar el RIPS: ' + (data.error || `HTTP ${res.status}`));
        return;
      }

      const convenios: unknown[] = data.convenios || [];
      if (convenios.length === 0) {
        toast.error('No hay pacientes con diagnóstico RIPS asignado para este contrato/periodo. Asigna los diagnósticos pendientes desde Historias Clínicas antes de generar el archivo.');
        return;
      }

      setRipsFiles(data.files || { US: '', AT: '', AC: '', CT: '' });
      setRipsWarnings(data.warnings || []);
    } catch (err: any) {
      toast.error('Error de red al generar el RIPS: ' + err.message);
    } finally {
      setIsGeneratingRips(false);
    }
  };

  const downloadRipsFile = (name: 'US' | 'AT' | 'AC' | 'CT') => {
    if (!ripsFiles) return;
    const blob = new Blob([ripsFiles[name]], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Simulated dropzone RAG loader trigger
  const handleDropzoneUpload = async (e: any) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessingRAG(true);
    setRagStatusMessage("Analizando estructura de archivos clónicos con RAG LLM...");

    try {
      // SEGURIDAD (A-07): el endpoint ahora exige sesión clínica válida. Ruta
      // same-origin (servidor del EHR), así que no aplica apiFetch().
      const token = localStorage.getItem('mind_token');

      const response = await fetch('/api/clinical/upload-masivo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
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
    <div className="flex h-full bg-slate-50 overflow-hidden font-sans">

      {/* ADMIN PORTAL SIDEBAR */}
      <aside className="w-16 md:w-64 bg-slate-900 text-slate-300 flex flex-col justify-between shrink-0 border-r border-slate-800 overflow-y-auto">
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
          {['CEO', 'DIRECTIVO', 'SUPER ADMIN', 'C-LEVEL', 'ESPECIALISTA_B2B'].includes(currentUser.role) && (
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
          )}

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

          {/* Pacientes */}
          <button
            onClick={() => setActiveTab('patients')}
            id="tab-adm-pacientes"
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'patients'
                ? 'bg-charcoal-900 text-white font-semibold'
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Users className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Pacientes</span>
            {activeTab === 'patients' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          {/* Equipo / Aprovisionamiento RBAC */}
          <button
            onClick={() => setActiveTab('equipo')}
            id="tab-adm-equipo"
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'equipo' 
                ? 'bg-charcoal-900 text-white font-semibold' 
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <UserPlus className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Equipo y Accesos</span>
            {activeTab === 'equipo' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          {/* Convenios / Clientes Corporativos */}
          <button
            onClick={() => setActiveTab('convenios')}
            id="tab-adm-convenios"
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'convenios'
                ? 'bg-charcoal-900 text-white font-semibold'
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Building2 className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Convenios</span>
            {activeTab === 'convenios' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
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
              {globalUnreadCount > 0 ? (
                <span className="absolute -top-1.5 -right-2 bg-emerald-500 text-white text-[10px] font-bold h-5 min-w-[20px] px-1 flex items-center justify-center rounded-full shadow-md animate-bounce">
                  {globalUnreadCount}
                </span>
              ) : (
                <span className="absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full bg-toast-500 animate-pulse" />
              )}
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

              <button
                onClick={() => {
                  setEditingAppointment(null);
                  setShowDelegatedModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-md transition-colors shrink-0 cursor-pointer"
              >
                <CalendarPlus className="w-4 h-4" />
                Agendar Cita Delegada
              </button>
            </div>

            {/* COMPLEJO PANEL DE FILTROS CRUZADOS (REQUERIMIENTO PRINCIPAL DE UX/UI) */}
            <div className="bg-white rounded-2xl border border-slate-150 p-5 shadow-2xs space-y-4 text-left">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-2.5 gap-2">
                <div>
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-2">
                    <Filter className="w-4 h-4 mr-1.5 text-toast-500 font-bold" />
                    Consola de Alertas e Inteligencia del Filtro Cruzado
                    <button
                      onClick={fetchMetrics}
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-200 transition-all cursor-pointer ml-2"
                    >
                      🔄 Refrescar Métricas
                    </button>
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
                    {[]?.map((opt: any, idx) => (
                      <option key={idx} value={opt.value}>{opt.label}</option>
                    ))}
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
                    {[]?.map((opt: any, idx) => (
                      <option key={idx} value={opt.value}>{opt.label}</option>
                    ))}
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
                    {[]?.map((opt: any, idx) => (
                      <option key={idx} value={opt.value}>{opt.label}</option>
                    ))}
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
                    {[]?.map((opt: any, idx) => (
                      <option key={idx} value={opt.value}>{opt.label}</option>
                    ))}
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
                    {[]?.map((opt: any, idx) => (
                      <option key={idx} value={opt.value}>{opt.label}</option>
                    ))}
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
                      {filteredAppointments.filter(app => ['Atendida', 'Atendido', 'ATENDIDO'].includes(app.status)).map(app => (
                        <div key={app.id} className="p-3 bg-toast-50/50 border border-toast-200 rounded-xl text-xs space-y-1">
                          <div className="flex justify-between items-center">
                            <strong className="text-slate-900">{app.patientName}</strong>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  const realAppt = realAppointments?.find((r: any) => r.id === app.id);
                                  if (realAppt) {
                                    setEditingAppointment(realAppt);
                                    setShowDelegatedModal(true);
                                  }
                                }}
                                className="text-indigo-600 hover:text-indigo-800 text-[10px] font-bold underline cursor-pointer"
                              >
                                ✏️ Reprogramar / Editar
                              </button>
                              <button
                                onClick={async () => {
                                  if (await confirmToast('¿Estás seguro de eliminar esta cita?')) {
                                    try {
                                      const t = localStorage.getItem('mind_token');
                                      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
                                      await fetch(`${apiUrl}/api/appointments/${app.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
                                      toast.success('Cita eliminada');
                                    } catch(e: any) { toast.error(e.message); }
                                  }
                                }}
                                className="text-red-500 hover:text-red-700 text-[10px] font-bold underline cursor-pointer"
                              >
                                🗑️ Eliminar
                              </button>
                              <span className="text-[9px] font-mono font-bold uppercase tracking-wider bg-charcoal-900 text-white px-1.5 py-0.5 rounded">
                                {app.status}
                              </span>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-600 font-sans">
                            <span className="font-semibold text-slate-800">Clínico:</span> {app.professional} • <span className="font-semibold text-slate-800">Línea:</span> {app.specialty}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {app.day} • {app.month} • {app.modality} • {app.agreement}
                          </p>
                          {app.reason && (
                            <p className="text-[11px] text-charcoal-800 leading-relaxed bg-white/70 p-2 rounded-lg border border-toast-200/35 mt-1 italic font-sans text-left">
                              &ldquo;{app.reason}&rdquo;
                            </p>
                          )}
                        </div>
                      ))}

                      {filteredAppointments.filter(app => ['Atendida', 'Atendido', 'ATENDIDO'].includes(app.status)).length === 0 && (
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
                      Consultas Clínicas: No Atendidos / Reprogramados / Pendientes ({unattendedOrReprogrammedCount})
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
                      {filteredAppointments.filter(app => app.status === 'No Atendido' || app.status === 'Reprogramada' || app.status === 'Pendiente').map(app => (
                        <div key={app.id} className={`p-3 border rounded-xl text-xs space-y-1 ${
                          app.status === 'Reprogramada' ? 'bg-toast-50/40 border-toast-200' : app.status === 'Pendiente' ? 'bg-indigo-50/40 border-indigo-200' : 'bg-slate-50 border-slate-200'
                        }`}>
                          <div className="flex justify-between items-center">
                            <strong className="text-slate-900">{app.patientName}</strong>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  const realAppt = realAppointments?.find((r: any) => r.id === app.id);
                                  if (realAppt) {
                                    setEditingAppointment(realAppt);
                                    setShowDelegatedModal(true);
                                  }
                                }}
                                className="text-indigo-600 hover:text-indigo-800 text-[10px] font-bold underline cursor-pointer"
                              >
                                ✏️ Reprogramar / Editar
                              </button>
                              <button
                                onClick={async () => {
                                  if (await confirmToast('¿Estás seguro de eliminar esta cita?')) {
                                    try {
                                      const t = localStorage.getItem('mind_token');
                                      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
                                      await fetch(`${apiUrl}/api/appointments/${app.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
                                      toast.success('Cita eliminada');
                                    } catch(e: any) { toast.error(e.message); }
                                  }
                                }}
                                className="text-red-500 hover:text-red-700 text-[10px] font-bold underline cursor-pointer"
                              >
                                🗑️ Eliminar
                              </button>
                              <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                app.status === 'Reprogramada' ? 'bg-toast-200 text-toast-500' : app.status === 'Pendiente' ? 'bg-indigo-200 text-indigo-700' : 'bg-slate-200 text-slate-800'
                              }`}>
                                {app.status === 'Reprogramada' ? 'Reprogramada' : app.status === 'Pendiente' ? 'Pendiente' : 'No asistió'}
                              </span>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-600 font-sans">
                            <span className="font-semibold text-slate-800">Clínico:</span> {app.professional} • <span className="font-semibold text-slate-800">Línea:</span> {app.specialty}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {app.day} • {app.month} • {app.modality} • {app.agreement}
                          </p>
                          {app.reason && (
                            <p className={`text-[11px] leading-relaxed bg-white/70 p-2 rounded-lg mt-1 border italic font-sans text-left ${
                              app.status === 'Reprogramada' ? 'text-charcoal-800 border-toast-200' : 'text-slate-600 border-slate-150'
                            }`}>
                              &ldquo;{app.reason}&rdquo;
                            </p>
                          )}
                        </div>
                      ))}

                      {filteredAppointments.filter(app => app.status === 'No Atendido' || app.status === 'Reprogramada' || app.status === 'Pendiente').length === 0 && (
                        <div className="text-center text-slate-400 text-xs py-10">
                          No hay reprogramaciones, inasistencias o citas pendientes registradas con los filtros seleccionados.
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
        {activeTab === 'video_admin' && ['CEO', 'DIRECTIVO', 'SUPER ADMIN', 'C-LEVEL', 'ESPECIALISTA_B2B'].includes(currentUser.role) && (
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
                  <p className="text-slate-400 italic">No hay salas activas en este momento.</p>
                </div>
              </div>

              {/* INTEGRACIÓN DEL COMPONENTE DE VIDEO PARA C-LEVEL */}
              <div className="mt-8 border-t border-slate-100 pt-6">
                <div className="mb-4">
                  <h3 className="text-sm font-extrabold text-slate-900 tracking-tight flex items-center">
                    <Video className="w-4 h-4 mr-1.5 text-toast-500" />
                    Espejo Clínico (Monitoreo C-Level)
                  </h3>
                  <p className="text-xs text-slate-400">Transmisión en vivo de la sala médica principal. La cámara se inicializa automáticamente para auditoría de calidad.</p>
                </div>
                <div className="relative rounded-xl overflow-hidden shadow-xs border border-slate-200 bg-black min-h-[400px]">
                  <VideollamadaVercel
                    pacienteId="monitoreo_directivo"
                    salaId="sala_admin_principal"
                    tokenSesion={localStorage.getItem('mind_token') || ''}
                  />
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


        {/* VIEW: PACIENTES */}
        {activeTab === 'patients' && (
          <PacientesPanel token={token} />
        )}

        {/* VIEW: EQUIPO Y ACCESOS — Aprovisionamiento RBAC de Usuarios (Migrado) */}
        {activeTab === 'equipo' && (
          <div className="max-w-3xl mx-auto space-y-6 text-left">
            <div className="border-b border-slate-200 pb-4">
              <span className="bg-toast-100 text-charcoal-900 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border border-toast-300 font-mono">
                Gestión de Accesos Clínicos
              </span>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">
                Equipo y Aprovisionamiento de Usuarios
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Crea psicólogos y personal de soporte para tu organización — quedan asociados automáticamente a tu propio tenant, dentro de las licencias contratadas.
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-6 space-y-5">
              <form onSubmit={handleCreateStaff} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Nombre completo</label>
                  <input
                    type="text"
                    value={newStaffName}
                    onChange={e => setNewStaffName(e.target.value)}
                    placeholder="Ej. María Camila Torres"
                    required
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Correo electrónico</label>
                  <input
                    type="email"
                    value={newStaffEmail}
                    onChange={e => setNewStaffEmail(e.target.value)}
                    placeholder="correo@empresa.com"
                    required
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Rol</label>
                  <select
                    value={newStaffRole}
                    onChange={e => setNewStaffRole(e.target.value as 'ESPECIALISTA_B2B' | 'OPERATIVO')}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                  >
                    <option value="ESPECIALISTA_B2B">Psicólogo / Especialista Clínico</option>
                    <option value="OPERATIVO">Soporte Operativo / Auxiliar</option>
                  </select>
                </div>

                {staffError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                    ⚠️ {staffError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isCreatingStaff}
                  className="w-full bg-charcoal-900 hover:bg-charcoal-950 text-white font-bold text-sm py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreatingStaff ? 'Creando...' : 'Crear Colaborador'}
                </button>
              </form>
            </div>

            {staffSuccess && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 space-y-2">
                <p className="text-sm font-bold text-emerald-800">✅ {staffSuccess.name} fue creado exitosamente.</p>
                <p className="text-xs text-emerald-700">Comunícale estas credenciales temporales de forma segura (deberá cambiarla en su primer ingreso):</p>
                <div className="bg-white border border-emerald-200 rounded-lg p-3 font-mono text-xs space-y-1">
                  <p>Correo: <strong>{staffSuccess.email}</strong></p>
                  <p>Contraseña temporal: <strong>{staffSuccess.tempPassword}</strong></p>
                </div>
              </div>
            )}

            {/* Panel: Usuarios de mi organización */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-xs overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-sm text-slate-900">Usuarios de mi Organización</h3>
                <button
                  onClick={() => fetchTeamUsers()}
                  className="text-xs text-slate-400 hover:text-slate-700 font-semibold"
                >
                  Recargar
                </button>
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold uppercase text-[10px]">
                    <th className="p-4">Nombre</th>
                    <th className="p-4">Correo</th>
                    <th className="p-4 w-32">Rol</th>
                    <th className="p-4 text-right w-24">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teamUsersLoading ? (
                    <tr><td colSpan={4} className="p-8 text-center text-slate-400">Cargando equipo...</td></tr>
                  ) : teamUsersError ? (
                    <tr><td colSpan={4} className="p-8 text-center text-red-600">⚠️ {teamUsersError}</td></tr>
                  ) : teamUsers.length === 0 ? (
                    <tr><td colSpan={4} className="p-8 text-center text-slate-400">Todavía no has creado colaboradores.</td></tr>
                  ) : (
                    teamUsers.map((member) => (
                      <tr key={member.id} className="hover:bg-slate-50">
                        <td className="p-4 font-bold text-slate-900">{member.name}</td>
                        <td className="p-4 font-mono text-[11px] text-slate-500">{member.email}</td>
                        <td className="p-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded font-mono font-bold text-[9px] bg-slate-100 border border-slate-200 text-slate-600 uppercase">
                            {member.role}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => handleDeleteTeamUser(member)}
                            disabled={deletingStaffId === member.id}
                            className="p-2 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            title={`Eliminar a ${member.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}


        {/* VIEW: CONVENIOS / CLIENTES CORPORATIVOS */}
        {activeTab === 'convenios' && (
          <div className="max-w-5xl mx-auto space-y-6 text-left">
            <div className="border-b border-slate-200 pb-4 flex items-center justify-between gap-4">
              <div>
                <span className="bg-toast-100 text-charcoal-900 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border border-toast-300 font-mono">
                  Catálogo de mi organización
                </span>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">
                  Convenios / Clientes Corporativos
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  Empresas o personas particulares con convenio de bienestar/paquete de sesiones. Se usan al agendar citas para saber quién factura la sesión.
                </p>
              </div>
              <button
                onClick={openCreateCompanyModal}
                className="shrink-0 inline-flex items-center gap-2 bg-charcoal-900 hover:bg-charcoal-950 text-white font-bold text-xs px-4 py-2.5 rounded-lg transition-colors"
              >
                <PlusCircle className="w-4 h-4" />
                Nuevo convenio/cliente
              </button>
            </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-xs overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold uppercase text-[10px]">
                    <th className="p-4">Nombre</th>
                    <th className="p-4">Tipo</th>
                    <th className="p-4">Convenio</th>
                    <th className="p-4">Vigencia</th>
                    <th className="p-4">Estado</th>
                    <th className="p-4 text-right w-28">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {companiesLoading ? (
                    <tr><td colSpan={6} className="p-8 text-center text-slate-400">Cargando convenios...</td></tr>
                  ) : companiesError ? (
                    <tr><td colSpan={6} className="p-8 text-center text-red-600">⚠️ {companiesError}</td></tr>
                  ) : companies.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-slate-400">Todavía no has registrado convenios o clientes.</td></tr>
                  ) : (
                    companies.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50 align-top">
                        <td className="p-4">
                          <div className="flex items-center gap-1.5">
                            <p className="font-bold text-slate-900">{c.name}</p>
                            {c.isDefault && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded font-bold text-[8px] bg-toast-100 border border-toast-300 text-charcoal-900 uppercase">
                                Por defecto
                              </span>
                            )}
                          </div>
                          {c.taxId && <p className="text-[10px] text-slate-400 font-mono">{c.taxId}</p>}
                          {c.contactEmail && <p className="text-[10px] text-slate-400">{c.contactEmail}</p>}
                          {c.locations?.length > 0 && (
                            <p className="text-[10px] text-slate-400 mt-0.5">📍 {c.locations.map((l) => l.name).join(', ')}</p>
                          )}
                        </td>
                        <td className="p-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded font-mono font-bold text-[9px] bg-slate-100 border border-slate-200 text-slate-600 uppercase">
                            {c.clientType === 'EMPRESA' ? 'Empresa' : 'Particular'}
                          </span>
                        </td>
                        <td className="p-4 text-slate-600">
                          {c.agreementType || '—'}
                          {c.coveredSessions ? <span className="block text-[10px] text-slate-400">{c.coveredSessions} sesiones cubiertas</span> : null}
                        </td>
                        <td className="p-4 text-slate-600">
                          {c.validFrom || c.validUntil
                            ? `${c.validFrom ? new Date(c.validFrom).toLocaleDateString('es-CO') : '—'} → ${c.validUntil ? new Date(c.validUntil).toLocaleDateString('es-CO') : '—'}`
                            : '—'}
                        </td>
                        <td className="p-4">
                          <button
                            onClick={() => !c.isDefault && handleToggleCompanyStatus(c)}
                            disabled={c.isDefault}
                            className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold text-[9px] uppercase border ${
                              c.status === 'activo'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                : 'bg-slate-100 border-slate-200 text-slate-500'
                            } ${c.isDefault ? 'cursor-default opacity-70' : 'cursor-pointer'}`}
                            title={c.isDefault ? 'El convenio por defecto siempre está activo' : 'Click para cambiar el estado'}
                          >
                            {c.status === 'activo' ? 'Activo' : 'Inactivo'}
                          </button>
                        </td>
                        <td className="p-4 text-right whitespace-nowrap">
                          <button
                            onClick={() => openEditCompanyModal(c)}
                            className="p-2 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                            title={`Editar ${c.name}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => !c.isDefault && handleDeleteCompany(c)}
                            disabled={c.isDefault}
                            className="p-2 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400"
                            title={c.isDefault ? 'El convenio por defecto no puede eliminarse' : `Eliminar ${c.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MODAL: Nuevo/Editar Convenio */}
        {showCompanyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden bg-white rounded-2xl shadow-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-slate-900">
                  {editingCompanyId ? 'Editar convenio/cliente' : 'Nuevo convenio/cliente'}
                </h3>
                <button onClick={() => setShowCompanyModal(false)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveCompany} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Tipo de cliente</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setCompanyForm({ ...companyForm, clientType: 'EMPRESA' })}
                      className={`rounded-lg border p-2.5 text-xs font-bold ${companyForm.clientType === 'EMPRESA' ? 'border-charcoal-900 bg-charcoal-900 text-white' : 'border-slate-200 text-slate-600'}`}
                    >
                      Empresa
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompanyForm({ ...companyForm, clientType: 'PARTICULAR' })}
                      className={`rounded-lg border p-2.5 text-xs font-bold ${companyForm.clientType === 'PARTICULAR' ? 'border-charcoal-900 bg-charcoal-900 text-white' : 'border-slate-200 text-slate-600'}`}
                    >
                      Persona particular
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">
                    {companyForm.clientType === 'EMPRESA' ? 'Nombre de la empresa' : 'Nombre de la persona'} *
                  </label>
                  <input
                    type="text" required value={companyForm.name}
                    onChange={e => setCompanyForm({ ...companyForm, name: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">
                      {companyForm.clientType === 'EMPRESA' ? 'NIT' : 'Documento de identidad'}
                    </label>
                    <input
                      type="text" value={companyForm.taxId}
                      onChange={e => setCompanyForm({ ...companyForm, taxId: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                  {companyForm.clientType === 'EMPRESA' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">Dominio de correo</label>
                      <input
                        type="text" placeholder="@empresa.com" value={companyForm.domain}
                        onChange={e => setCompanyForm({ ...companyForm, domain: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Tipo de convenio</label>
                    <input
                      type="text" placeholder="Ej. Bienestar corporativo, Póliza..." value={companyForm.agreementType}
                      onChange={e => setCompanyForm({ ...companyForm, agreementType: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Sesiones cubiertas</label>
                    <input
                      type="number" min={0} value={companyForm.coveredSessions}
                      onChange={e => setCompanyForm({ ...companyForm, coveredSessions: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Vigencia desde</label>
                    <input
                      type="date" value={companyForm.validFrom}
                      onChange={e => setCompanyForm({ ...companyForm, validFrom: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Vigencia hasta</label>
                    <input
                      type="date" value={companyForm.validUntil}
                      onChange={e => setCompanyForm({ ...companyForm, validUntil: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Contacto (opcional)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text" placeholder="Persona de contacto" value={companyForm.contactName}
                      onChange={e => setCompanyForm({ ...companyForm, contactName: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                    <input
                      type="text" placeholder="Teléfono" value={companyForm.contactPhone}
                      onChange={e => setCompanyForm({ ...companyForm, contactPhone: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                    <input
                      type="email" placeholder="Correo de contacto" value={companyForm.contactEmail}
                      onChange={e => setCompanyForm({ ...companyForm, contactEmail: e.target.value })}
                      className="col-span-2 w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Ubicaciones de atención</p>
                  {!editingCompanyId ? (
                    <p className="text-xs text-slate-400">Guarda el convenio primero para poder agregar ubicaciones de atención.</p>
                  ) : (
                    <>
                      {editingLocations.length > 0 && (
                        <ul className="flex flex-col gap-1.5 mb-3">
                          {editingLocations.map((loc) => (
                            <li key={loc.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs">
                              <span className="text-slate-700">
                                <span className="font-bold">{loc.name}</span>
                                {loc.address && <span className="text-slate-400"> — {loc.address}</span>}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveLocation(loc.id)}
                                className="text-slate-400 hover:text-red-600"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="grid grid-cols-2 gap-3 mb-2">
                        <input
                          type="text" placeholder="Ej. Salón B1" value={newLocationName}
                          onChange={e => setNewLocationName(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                        />
                        <input
                          type="text" placeholder="Dirección (opcional)" value={newLocationAddress}
                          onChange={e => setNewLocationAddress(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleAddLocation}
                        disabled={savingLocation || !newLocationName.trim()}
                        className="w-full inline-flex items-center justify-center gap-1.5 bg-charcoal-900 hover:bg-charcoal-950 text-white font-bold text-xs py-2.5 rounded-lg disabled:opacity-50"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        Añadir ubicación
                      </button>
                    </>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Notas</label>
                  <textarea
                    rows={2} value={companyForm.notes}
                    onChange={e => setCompanyForm({ ...companyForm, notes: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                  />
                </div>

                {companyFormError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                    ⚠️ {companyFormError}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button" onClick={() => setShowCompanyModal(false)}
                    className="flex-1 border border-slate-200 text-slate-600 font-bold text-sm py-2.5 rounded-lg hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit" disabled={savingCompany}
                    className="flex-1 bg-charcoal-900 hover:bg-charcoal-950 text-white font-bold text-sm py-2.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {savingCompany ? 'Guardando...' : editingCompanyId ? 'Guardar cambios' : 'Crear convenio/cliente'}
                  </button>
                </div>
              </form>
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
                      <span className="font-extrabold text-lg text-white font-mono">0 Pacientes</span>
                    </div>
                    <span className="text-[10px] bg-charcoal-950 text-toast-300 font-bold p-1 px-2 rounded">Activo 100%</span>
                  </div>

                  <div className="p-4 bg-toast-50/50 rounded-xl border border-toast-200 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-mono text-charcoal-700 block">Sura Medicina Prepagada</span>
                      <span className="font-extrabold text-lg text-slate-900 font-mono">0 Pacientes</span>
                    </div>
                    <span className="text-[10px] bg-toast-100 text-toast-500 font-bold p-1 px-2 rounded">Activo 100%</span>
                  </div>

                  <div className="p-4 bg-toast-50/50 rounded-xl border border-toast-200 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-mono text-charcoal-700 block">Colmédica Prepagada</span>
                      <span className="font-extrabold text-lg text-slate-900 font-mono">0 Pacientes</span>
                    </div>
                    <span className="text-[10px] bg-toast-100 text-toast-500 font-bold p-1 px-2 rounded">Activo 100%</span>
                  </div>

                  <div className="p-4 bg-toast-50/50 rounded-xl border border-toast-200 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-mono text-charcoal-700 block">Coomeva Medicina Prepagada</span>
                      <span className="font-extrabold text-lg text-slate-900 font-mono">0 Pacientes</span>
                    </div>
                    <span className="text-[10px] bg-toast-100 text-toast-500 font-bold p-1 px-2 rounded">Activo 100%</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-150 rounded-xl flex items-center justify-between text-xs text-slate-600">
                  <div className="space-y-0.5">
                    <p className="font-bold text-slate-900">Particular (Directo Privado)</p>
                    <p className="text-[11px] text-slate-400">Pacientes con facturación autónoma por PSE o Tarjeta.</p>
                  </div>
                  <strong className="text-slate-900 font-extrabold font-mono text-xs">0 Pacientes</strong>
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
                  <label className="block text-[10px] uppercase font-bold text-slate-600">Contrato</label>
                  <select
                    value={ripsCompanyId}
                    onChange={(e) => setRipsCompanyId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
                  >
                    <option value="all">Todos los convenios</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={handleGenerateRips}
                  disabled={isGeneratingRips}
                  className="bg-charcoal-900 hover:bg-slate-950 text-white font-bold text-xs p-2.5 px-5 rounded-lg transition-all cursor-pointer shadow-xs self-stretch sm:self-auto flex items-center justify-center gap-1 border border-charcoal-950 disabled:opacity-50"
                >
                  <Zap className="w-4 h-4 text-toast-300" />
                  <span>{isGeneratingRips ? 'Generando...' : 'Generar RIPS (XML)'}</span>
                </button>
              </div>

              {ripsFiles && (
                <div className="space-y-3">
                  {ripsWarnings.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                      <p className="font-bold uppercase tracking-wider text-[10px]">⚠️ Revisar antes de enviar</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {ripsWarnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs font-mono bg-slate-900 text-slate-300 p-2.5 px-4 rounded-t-xl border-b border-slate-800">
                    <div className="flex items-center gap-1">
                      {(['US', 'AT', 'AC', 'CT'] as const).map((name) => (
                        <button
                          key={name}
                          onClick={() => setRipsPreviewTab(name)}
                          className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase cursor-pointer ${ripsPreviewTab === name ? 'bg-toast-500 text-charcoal-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                        >
                          {name}.txt
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(ripsFiles[ripsPreviewTab]);
                          toast.success(`Contenido de ${ripsPreviewTab}.txt copiado al portapapeles.`);
                        }}
                        className="p-1 px-2.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 text-[10px] font-bold cursor-pointer"
                      >
                        Copiar
                      </button>

                      <button
                        onClick={() => downloadRipsFile(ripsPreviewTab)}
                        className="p-1 px-2.5 bg-charcoal-900 hover:bg-charcoal-950 rounded text-white text-[10px] font-bold cursor-pointer border border-charcoal-950"
                      >
                        Descargar {ripsPreviewTab}.txt
                      </button>

                      <button
                        onClick={() => { (['US', 'AT', 'AC', 'CT'] as const).forEach(downloadRipsFile); }}
                        className="p-1 px-2.5 bg-toast-500 hover:bg-toast-600 rounded text-charcoal-950 text-[10px] font-bold cursor-pointer"
                      >
                        Descargar los 4
                      </button>
                    </div>
                  </div>

                  <pre className="bg-slate-950 text-toast-400 p-4 rounded-b-xl overflow-x-auto text-[11px] font-mono leading-relaxed max-h-[300px] border border-slate-900 text-left">
                    <code>{ripsFiles[ripsPreviewTab] || '(sin registros)'}</code>
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

              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Desde</label>
                  <input
                    type="date" value={reportDateFrom} onChange={(e) => setReportDateFrom(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs outline-none focus:ring-2 focus:ring-toast-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Hasta</label>
                  <input
                    type="date" value={reportDateTo} onChange={(e) => setReportDateTo(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs outline-none focus:ring-2 focus:ring-toast-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Convenio</label>
                  <select
                    value={reportCompanyId} onChange={(e) => setReportCompanyId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs outline-none focus:ring-2 focus:ring-toast-500"
                  >
                    <option value="all">Todos</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Estado de cita</label>
                  <select
                    value={reportStatus} onChange={(e) => setReportStatus(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs outline-none focus:ring-2 focus:ring-toast-500"
                  >
                    <option value="all">Todos</option>
                    {APPOINTMENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Psicólogo</label>
                  <select
                    value={reportPsychologistId} onChange={(e) => setReportPsychologistId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs outline-none focus:ring-2 focus:ring-toast-500"
                  >
                    <option value="all">Todos</option>
                    {teamUsers.filter((u) => u.role === 'ESPECIALISTA_B2B').map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleExportPatientsExcel}
                    disabled={isExportingReport}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" /> {isExportingReport ? 'Generando...' : 'Descargar Excel'}
                  </button>
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
                                    toast.success(`Enviando notificación electrónica de cobro y recordatorio a: ${p.email}`);
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

        {/* ── Modal de Agendamiento Delegado ──────────────────────────── */}
        <DelegatedAppointmentModal
          isOpen={showDelegatedModal}
          onClose={() => {
            setShowDelegatedModal(false);
            setEditingAppointment(null);
          }}
          initialData={editingAppointment}
          onSuccess={() => {
            window.location.reload(); 
          }}
        />
      </main>
    </div>
  );
}
