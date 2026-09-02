/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, FormEvent, useEffect, useRef } from 'react';
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
import { useCompanies, type CompanyRecord, type CompanyLocation } from '../hooks/useCompanies';
import ClinicalPatientChart from '../components/EHR/ClinicalPatientChart';
import ClinicalRecordsList from '../components/EHR/ClinicalRecordsList';
import InternalChat from '../components/InternalChat';
import VideollamadaVercel from '../components/VideollamadaVercel';
import DelegatedAppointmentModal, { prefetchSelectoresAgendamiento } from '../components/DelegatedAppointmentModal';
import PacientesPanel from '../components/EHR/PacientesPanel';
import AssessmentsPanel from '../components/EHR/AssessmentsPanel';
import CalendarPanel, {
  type CalendarAppointment,
  type ApptStatusKey,
  normalizeStatus,
  StatusFilterPills,
  CalendarFilterGroup,
  CalendarFilterSelect,
} from '../components/EHR/CalendarPanel';
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
  RefreshCw,
  MessageSquare,
  UserPlus,
  PlusCircle,
  CalendarPlus,
  ShieldAlert,
  Trash2,
  Building2,
  Pencil,
  X,
  Download,
  FileText,
  Eye,
  EyeOff,
  History,
  ClipboardX,
  ClipboardList,
  Bell,
  Clock,
  User2,
  ChevronDown,
  Check
} from 'lucide-react';

type AdminTab = 'metrics' | 'video_admin' | 'advanced_docs' | 'patients' | 'clinical_history' | 'evaluations' | 'equipo' | 'convenios' | 'billing_rips' | 'chat';

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
  const { appointments: realAppointments, loading: apptsLoading, refetch: refetchAppointments } = useAppointments(token);
  const { patients: realPatients, loading: patientsLoading } = usePatients(token);
  const { unreadCount: globalUnreadCount } = useGlobalChat();

  // ── Calendario general del tenant (Consola de Alertas) ─────────────────
  // Mismo transform que PsychologistPortal, pero con TODOS los agendamientos
  // que ya trae useAppointments para este rol (DIRECTIVO/CEO/OPERATIVO ven
  // todo el tenant, no solo "sus" pacientes — ver listAppointments en el
  // backend) — así el administrativo ve el agendamiento general de
  // pacientes, su propio tenant y convenios, no una vista personal.
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day'>('month');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarPsychologistFilter, setCalendarPsychologistFilter] = useState('todos');
  const [calendarStatusFilter, setCalendarStatusFilter] = useState<ApptStatusKey | 'todos'>('todos');

  const calendarAppointmentsAll = (realAppointments || []).map((appt: any) => {
    const appDate = new Date(appt?.date || appt?.dateTime || Date.now());
    return {
      id: appt?.id || 'unknown',
      patientName: `${appt?.patient?.firstName || ''} ${appt?.patient?.lastName || ''}`.trim() || 'Paciente Desconocido',
      patientId: appt?.patient?.id || 'unknown',
      appDate,
      dayIndex: appDate.getDay(),
      timeSlot: appt.timeSlot || `${appDate.getHours().toString().padStart(2, '0')}:${appDate.getMinutes().toString().padStart(2, '0')}`,
      atencionType: appt.specialty?.name || appt.type || 'psicología clínica',
      estatus: appt.status || 'Confirmada',
      modalidad: appt.type === 'Virtual' || appt.type === 'Presencial' ? appt.type : 'Virtual',
      psychologistName: appt?.psychologist?.name || 'Sin psicólogo asignado',
    };
  });

  const calendarPsychologistOptions = Array.from(
    new Set(calendarAppointmentsAll.map((a) => a.psychologistName))
  ).sort((a, b) => a.localeCompare(b));

  const calendarAppointments = calendarAppointmentsAll
    .filter((a) => calendarPsychologistFilter === 'todos' || a.psychologistName === calendarPsychologistFilter)
    .filter((a) => calendarStatusFilter === 'todos' || normalizeStatus(a.estatus) === calendarStatusFilter);

  // ── Equipo y Accesos: autoservicio de aprovisionamiento (POST /users/provision) ──
  // NOTA: no se usa apiFetch/apiPost aquí a propósito — ese wrapper trata CUALQUIER
  // 403 como "tenant suspendido" y dispara logout global. /users/provision responde
  // 403 también para límite de licencias alcanzado o rol insuficiente, que son
  // errores de negocio normales, no una suspensión — se maneja con fetch directo.
  const ACADEMIC_LEVEL_OPTIONS = ['Técnico', 'Tecnólogo', 'Pregrado', 'Especialización', 'Maestría', 'Doctorado'];

  const emptyStaffForm = {
    firstName: '', lastName: '', email: '',
    role: 'ESPECIALISTA_B2B' as 'ESPECIALISTA_B2B' | 'OPERATIVO',
    professionalCard: '', specialtyId: '', academicLevel: '', experienceYears: '', epsCode: '', epsLabel: '',
    dataConsentAccepted: false,
  };
  // El formulario de "Crear profesional" vive en un modal — si alguien lo
  // cierra sin querer a mitad de llenarlo (o navega y vuelve), no debería
  // perder lo que ya escribió. sessionStorage porque solo debe durar
  // mientras la pestaña siga abierta (mismo patrón que la búsqueda de
  // ClinicalRecordsList).
  const NEW_STAFF_DRAFT_KEY = 'mind_new_staff_draft';
  function readStaffDraft(): typeof emptyStaffForm {
    try {
      const raw = sessionStorage.getItem(NEW_STAFF_DRAFT_KEY);
      return raw ? { ...emptyStaffForm, ...JSON.parse(raw) } : emptyStaffForm;
    } catch {
      return emptyStaffForm;
    }
  }
  const [showCreateStaffModal, setShowCreateStaffModal] = useState(false);
  const [newStaffForm, setNewStaffForm] = useState(readStaffDraft);
  const [isCreatingStaff, setIsCreatingStaff] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffSuccess, setStaffSuccess] = useState<{ name: string; email: string; tempPassword: string } | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(NEW_STAFF_DRAFT_KEY, JSON.stringify(newStaffForm));
    } catch { /* silencioso — el cache es una comodidad, no algo crítico */ }
  }, [newStaffForm]);

  // ── Catálogos reales para los selectores de la ficha profesional ──
  // Especialidad y roles ya existen en el backend (mismos que usa el
  // agendamiento); EPS es un catálogo enorme (miles de filas) — se busca por
  // texto en vez de traerlo completo, igual patrón que ya usa
  // InitialAssessmentWizard para el mismo endpoint.
  interface SpecialtyOption { id: string; name: string }
  const [staffSpecialties, setStaffSpecialties] = useState<SpecialtyOption[]>([]);
  useEffect(() => {
    // Catálogo pequeño (~10 filas por tenant) — se trae una sola vez al
    // montar el portal, no hace falta condicionarlo a la pestaña activa.
    (async () => {
      try {
        const res = await apiFetch('/api/specialties/options');
        if (res.ok) setStaffSpecialties(await res.json());
      } catch { /* silencioso — el select simplemente queda vacío */ }
    })();
  }, []);

  interface EpsOption { code: string; nombre: string }
  function useEpsSearch() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<EpsOption[]>([]);
    useEffect(() => {
      if (query.trim().length < 2) { setResults([]); return; }
      const timer = setTimeout(async () => {
        try {
          const res = await apiFetch(`/api/eps?q=${encodeURIComponent(query.trim())}`);
          if (res.ok) setResults(await res.json());
        } catch { /* silencioso */ }
      }, 300);
      return () => clearTimeout(timer);
    }, [query]);
    return { query, setQuery, results, setResults };
  }
  const newStaffEpsSearch = useEpsSearch();

  const handleCreateStaff = async (e: FormEvent) => {
    e.preventDefault();
    const f = newStaffForm;
    if (!f.firstName.trim() || !f.lastName.trim() || !f.email.trim()) return;
    if (!f.dataConsentAccepted) {
      setStaffError('Debes marcar la autorización de tratamiento de datos personales.');
      return;
    }

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
          firstName: f.firstName.trim(),
          lastName: f.lastName.trim(),
          email: f.email.trim().toLowerCase(),
          role: f.role,
          professionalCard: f.professionalCard.trim() || undefined,
          specialtyId: f.specialtyId || undefined,
          academicLevel: f.academicLevel || undefined,
          experienceYears: f.experienceYears || undefined,
          epsCode: f.epsCode || undefined,
          dataConsentAccepted: f.dataConsentAccepted,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStaffError(data.error || data.detail || `Error HTTP ${res.status}`);
        return;
      }

      setStaffSuccess({
        name: `${f.firstName.trim()} ${f.lastName.trim()}`.trim(),
        email: f.email.trim().toLowerCase(),
        tempPassword: data.tempPassword,
      });
      setNewStaffForm(emptyStaffForm);
      try { sessionStorage.removeItem(NEW_STAFF_DRAFT_KEY); } catch { /* silencioso */ }
      newStaffEpsSearch.setQuery('');
      setShowCreateStaffModal(false);
      setStaffRecentFirst(true); // el recién creado debe verse sin buscarlo
      setStaffPage(1);
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
    firstName: string | null;
    lastName: string | null;
    email: string;
    role: string;
    status: 'active' | 'inactive';
    professionalCard: string | null;
    academicLevel: string | null;
    experienceYears: number | null;
    specialtyId: string | null;
    specialtyName: string | null;
    epsCode: string | null;
    epsName: string | null;
    /** "YYYY-MM-DD" — ya viene calculado del backend (users.routes.js GET /). */
    joinedDate: string;
  }

  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [teamUsersLoading, setTeamUsersLoading] = useState(false);
  const [teamUsersError, setTeamUsersError] = useState<string | null>(null);
  const [deletingStaffId, setDeletingStaffId] = useState<string | null>(null);
  // Enmascarado por defecto (principio de acceso mínimo) — correo y tarjeta
  // profesional se ocultan parcialmente hasta que el DIRECTIVO pulsa "Revelar
  // datos". Es un toggle de visualización: los datos ya llegaron completos
  // en la respuesta de /api/users, esto no hace una petición aparte.
  const [staffDataRevealed, setStaffDataRevealed] = useState(false);
  // Orden por defecto del backend es fecha de alta ascendente (el más
  // antiguo primero) — "Recientes" invierte para encontrar rápido a alguien
  // que se acaba de crear, sin tener que ir a la última página.
  const [staffRecentFirst, setStaffRecentFirst] = useState(false);
  const STAFF_PAGE_SIZE = 10;
  const [staffPage, setStaffPage] = useState(1);
  const sortedTeamUsers = staffRecentFirst
    ? [...teamUsers].sort((a, b) => b.joinedDate.localeCompare(a.joinedDate))
    : teamUsers;
  const staffTotalPages = Math.max(1, Math.ceil(sortedTeamUsers.length / STAFF_PAGE_SIZE));
  const staffRangeStart = sortedTeamUsers.length === 0 ? 0 : (staffPage - 1) * STAFF_PAGE_SIZE + 1;
  const staffRangeEnd = Math.min(staffPage * STAFF_PAGE_SIZE, sortedTeamUsers.length);
  const paginatedTeamUsers = sortedTeamUsers.slice((staffPage - 1) * STAFF_PAGE_SIZE, staffPage * STAFF_PAGE_SIZE);

  // Si se elimina el último colaborador de la página actual (o cambia el
  // orden), no debe quedar mostrando una página vacía que ya no existe.
  useEffect(() => {
    setStaffPage((p) => Math.min(p, staffTotalPages));
  }, [staffTotalPages]);

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

  const handleToggleStaffActive = async (member: TeamUser) => {
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/users/${member.id}/active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ active: member.status !== 'active' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Error al cambiar el estado del colaborador.');
        return;
      }
      await fetchTeamUsers();
    } catch (err: any) {
      toast.error('Error de red: ' + err.message);
    }
  };

  // ── Edición de colaborador (nombres/apellidos + ficha profesional) ──
  const emptyEditStaffForm = {
    firstName: '', lastName: '',
    professionalCard: '', specialtyId: '', academicLevel: '', experienceYears: '', epsCode: '', epsLabel: '',
  };
  const [showEditStaffModal, setShowEditStaffModal] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editStaffForm, setEditStaffForm] = useState(emptyEditStaffForm);
  const [savingStaff, setSavingStaff] = useState(false);
  const [editStaffError, setEditStaffError] = useState<string | null>(null);
  const editStaffEpsSearch = useEpsSearch();

  const openEditStaffModal = (member: TeamUser) => {
    // Colaboradores creados por vías que solo guardaron `name` completo
    // (SSO, autorregistro) nunca tuvieron firstName/lastName por separado —
    // sin este respaldo el modal se abría con Nombres/Apellidos en blanco
    // aunque la fila de la tabla sí mostraba el nombre completo.
    const [fallbackFirstName, ...fallbackLastNameParts] = (member.name || '').trim().split(/\s+/);
    setEditingStaffId(member.id);
    setEditStaffForm({
      firstName: member.firstName || fallbackFirstName || '',
      lastName: member.lastName || fallbackLastNameParts.join(' '),
      professionalCard: member.professionalCard || '',
      specialtyId: member.specialtyId || '',
      academicLevel: member.academicLevel || '',
      experienceYears: member.experienceYears?.toString() || '',
      epsCode: member.epsCode || '',
      epsLabel: member.epsName || '',
    });
    editStaffEpsSearch.setQuery('');
    editStaffEpsSearch.setResults([]);
    setEditStaffError(null);
    setShowEditStaffModal(true);
  };

  const handleSaveStaff = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingStaffId) return;
    const f = editStaffForm;
    if (!f.firstName.trim() || !f.lastName.trim()) return;

    setSavingStaff(true);
    setEditStaffError(null);
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/users/${editingStaffId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          firstName: f.firstName.trim(),
          lastName: f.lastName.trim(),
          professionalCard: f.professionalCard.trim() || null,
          specialtyId: f.specialtyId || null,
          academicLevel: f.academicLevel || null,
          experienceYears: f.experienceYears || null,
          epsCode: f.epsCode || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditStaffError(data.error || `Error HTTP ${res.status}`);
        return;
      }
      setShowEditStaffModal(false);
      await fetchTeamUsers();
    } catch (err: any) {
      setEditStaffError('Error de red: ' + err.message);
    } finally {
      setSavingStaff(false);
    }
  };

  // ── Historial de cambios de la ficha profesional ──
  interface StaffHistoryEntry {
    id: string;
    changes: Record<string, { from: any; to: any }>;
    changedByName: string;
    createdAt: string;
  }
  const [showStaffHistoryModal, setShowStaffHistoryModal] = useState(false);
  const [staffHistoryName, setStaffHistoryName] = useState('');
  const [staffHistory, setStaffHistory] = useState<StaffHistoryEntry[]>([]);
  const [staffHistoryLoading, setStaffHistoryLoading] = useState(false);

  const openStaffHistoryModal = async (member: TeamUser) => {
    setStaffHistoryName(member.name);
    setShowStaffHistoryModal(true);
    setStaffHistoryLoading(true);
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/users/${member.id}/professional-profile/history`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      setStaffHistory(res.ok && Array.isArray(data.history) ? data.history : []);
    } catch {
      setStaffHistory([]);
    } finally {
      setStaffHistoryLoading(false);
    }
  };

  const STAFF_HISTORY_FIELD_LABELS: Record<string, string> = {
    name: 'Nombre', professionalCard: 'Tarjeta profesional', specialtyId: 'Especialidad',
    academicLevel: 'Nivel académico', experienceYears: 'Experiencia (años)', epsCode: 'EPS/IPS', active: 'Estado',
  };

  function maskEmail(email: string): string {
    const [user, domain] = email.split('@');
    if (!domain) return email;
    const visible = user.slice(0, 2);
    return `${visible}${'•'.repeat(Math.max(user.length - 2, 3))}@${domain}`;
  }
  function maskCard(card: string): string {
    if (card.length <= 4) return '•'.repeat(card.length);
    return `••••${card.slice(-4)}`;
  }

  // ── Convenios / Clientes Corporativos: catálogo propio del tenant ──
  const emptyCompanyForm = {
    name: '', domain: '', taxId: '', clientType: 'EMPRESA' as 'EMPRESA' | 'PARTICULAR',
    agreementType: '', coveredSessions: '', validFrom: '', validUntil: '',
    contactName: '', contactPhone: '', contactEmail: '', notes: '',
  };

  // Caché compartida con PacientesPanel/CreatePatientModal/DelegatedAppointmentModal
  // (ver src/hooks/useCompanies.ts) — antes este panel tenía su propio fetch a
  // /api/companies, redundante con el de esos otros consumidores.
  const { companies, loading: companiesLoading, error: companiesError, refetch: fetchCompanies } = useCompanies();
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [savingCompany, setSavingCompany] = useState(false);
  const [companyFormError, setCompanyFormError] = useState<string | null>(null);

  const [editingLocations, setEditingLocations] = useState<CompanyLocation[]>([]);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationAddress, setNewLocationAddress] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);

  // Catálogo de "Tipo de convenio" — a diferencia de Ubicaciones (anidadas
  // bajo un companyId), este es un catálogo propio del tenant (como EPS,
  // pero por tenant en vez de global) — se puede gestionar y usar aunque
  // todavía se esté CREANDO el convenio, no hace falta guardarlo primero.
  const [agreementTypes, setAgreementTypes] = useState<{ id: string; name: string }[]>([]);
  const [newAgreementTypeName, setNewAgreementTypeName] = useState('');
  const [savingAgreementType, setSavingAgreementType] = useState(false);
  // Edición en línea (renombrar) — se creó mal un tipo, sin tener que
  // borrarlo y volver a crearlo perdiendo el orden/histórico.
  const [editingAgreementTypeId, setEditingAgreementTypeId] = useState<string | null>(null);
  const [editingAgreementTypeName, setEditingAgreementTypeName] = useState('');
  // Pestañas tipo píldora INLINE (Direcciones / Tipos de convenio) dentro
  // del propio formulario — nada de modal-sobre-modal. Y el desplegable con
  // estilo propio para "Tipo de convenio", reemplazando el <select> nativo.
  const [catalogTab, setCatalogTab] = useState<'locations' | 'types'>('locations');
  const [agreementTypeDropdownOpen, setAgreementTypeDropdownOpen] = useState(false);

  const fetchAgreementTypes = async () => {
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/agreement-types`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setAgreementTypes(await res.json());
    } catch {
      // Fallo silencioso — el <select> simplemente queda con la lista vacía/vieja
    }
  };

  useEffect(() => {
    fetchAgreementTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleAddAgreementType = async () => {
    if (!newAgreementTypeName.trim()) return;
    setSavingAgreementType(true);
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/agreement-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: newAgreementTypeName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Error al agregar el tipo de convenio.');
        return;
      }
      setAgreementTypes((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      // Deja el tipo recién creado ya seleccionado en el convenio que se está editando.
      setCompanyForm((prev) => ({ ...prev, agreementType: data.name }));
      setNewAgreementTypeName('');
    } catch (err: any) {
      toast.error('Error de red: ' + err.message);
    } finally {
      setSavingAgreementType(false);
    }
  };

  const handleRemoveAgreementType = async (id: string) => {
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/agreement-types/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      setAgreementTypes((prev) => prev.filter((t) => t.id !== id));
    } catch {
      toast.error('Error al eliminar el tipo de convenio.');
    }
  };

  const handleRenameAgreementType = async (id: string, newName: string) => {
    if (!newName.trim()) return;
    try {
      const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/api/agreement-types/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Error al renombrar el tipo de convenio.');
        return;
      }
      setAgreementTypes((prev) => prev.map((t) => (t.id === id ? data : t)).sort((a, b) => a.name.localeCompare(b.name)));
      // Si el tipo renombrado era el elegido para este convenio, actualiza el valor seleccionado también.
      setCompanyForm((prev) => (prev.agreementType && agreementTypes.find((t) => t.id === id)?.name === prev.agreementType
        ? { ...prev, agreementType: data.name }
        : prev));
      setEditingAgreementTypeId(null);
    } catch (err: any) {
      toast.error('Error de red: ' + err.message);
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



  // Recuerda la última tab visitada entre recargas — sin esto, cualquier
  // refresh de página remonta el componente y activeTab vuelve a su default
  // ('metrics' / "Tablero Gerencial"), sin importar dónde estaba el usuario.
  const ADMIN_TABS: AdminTab[] = ['metrics', 'video_admin', 'advanced_docs', 'patients', 'clinical_history', 'evaluations', 'equipo', 'convenios', 'billing_rips', 'chat'];
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    const saved = localStorage.getItem('mind_admin_active_tab');
    return (saved && (ADMIN_TABS as string[]).includes(saved)) ? (saved as AdminTab) : 'metrics';
  });
  useEffect(() => {
    localStorage.setItem('mind_admin_active_tab', activeTab);
  }, [activeTab]);

  // Igual que activeTab: sin esto, un refresh estando dentro de la ficha de
  // un paciente perdía selectedPatientId y volvía al listado de "Historias
  // Clínicas" en vez de quedarse donde estaba el usuario.
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(() => {
    return localStorage.getItem('mind_admin_selected_patient_id') || null;
  });
  useEffect(() => {
    if (selectedPatientId) {
      localStorage.setItem('mind_admin_selected_patient_id', selectedPatientId);
    } else {
      localStorage.removeItem('mind_admin_selected_patient_id');
    }
  }, [selectedPatientId]);
  // Recuerda desde qué tab se entró a la ficha de un paciente (p. ej. desde
  // "Pacientes") para que "Volver" regrese ahí — antes siempre volvía al
  // listado de "Historias Clínicas", sin importar de dónde venías.
  const [clinicalHistoryReturnTab, setClinicalHistoryReturnTab] = useState<AdminTab | null>(null);

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

  // Carga el equipo de mi organización al entrar al tab "Equipo y Accesos"
  useEffect(() => {
    if (activeTab !== 'equipo') return;
    fetchTeamUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Los convenios/clientes (usados en "Convenios", "Facturación y RIPS" y
  // "Tablero general") ya los trae useCompanies() al montar AdminPortal, con
  // su propia caché — no hace falta re-disparar la carga en cada cambio de tab.

  const [dashboardMetrics, setDashboardMetrics] = useState({
    pacientesAtendidosCount: 0,
    psicologosActivosCount: 0,
    evolucionesHistoricasCount: 0,
  });
  const [corporateDistribution, setCorporateDistribution] = useState<{ name: string; value: number }[]>([]);

  const fetchMetrics = async () => {
    try {
      const res = await apiFetch('/api/metrics/dashboard');
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = await res.json();
      const metrics = data.data || data || {};

      setDashboardMetrics({
        pacientesAtendidosCount: metrics.pacientesAtendidosCount || 0,
        psicologosActivosCount: metrics.psicologosActivosCount || 0,
        evolucionesHistoricasCount: metrics.evolucionesHistoricasCount || 0,
      });
      setCorporateDistribution(Array.isArray(metrics.corporateDistribution) ? metrics.corporateDistribution : []);
    } catch (err) {
      console.error('Error fetching dashboard metrics', err);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchMetrics();
    }
  }, [currentUser]);

  // ── Panel de Control por RIPS (Tablero general) ─────────────────────────
  // Mismo panel que ya existe en AdminCenter (ClinicalMetricsView), pero acá
  // sin selector de empresa/tenant: un administrativo del EHR solo opera
  // dentro de SU tenant — GET .../dashboard-summary ya lo resuelve así por
  // su cuenta cuando no se manda ?tenantId= (usa el tenant del token). El
  // filtro de convenio sí aplica, igual que en AdminCenter.
  interface DashRipsSummary {
    startDate: string;
    endDate: string;
    rows: { date: string; category: string; count: number }[];
    dates: string[];
    categories: string[];
    totalsByDate: Record<string, number>;
    totalsByCategory: Record<string, number>;
    grandTotal: number;
    codes: { code: string; label: string; category: string; count: number }[];
    latestDiagnosisDate: string | null;
  }
  const dashTodayISO = new Date().toISOString().slice(0, 10);
  const dashMonthStartISO = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [dashRipsStartDate, setDashRipsStartDate] = useState(dashMonthStartISO);
  const [dashRipsEndDate, setDashRipsEndDate] = useState(dashTodayISO);
  const [dashRipsCompanyId, setDashRipsCompanyId] = useState('all');
  const [dashRipsSummary, setDashRipsSummary] = useState<DashRipsSummary | null>(null);
  const [dashRipsLoading, setDashRipsLoading] = useState(false);
  const dashRipsAutoAdjustedRef = useRef(false);

  const fetchDashRipsSummary = async () => {
    setDashRipsLoading(true);
    try {
      const params = new URLSearchParams({ startDate: dashRipsStartDate, endDate: dashRipsEndDate });
      if (dashRipsCompanyId !== 'all') params.set('companyId', dashRipsCompanyId);
      const res = await apiFetch(`/api/rips-diagnosis/dashboard-summary?${params.toString()}`);
      if (!res.ok) {
        setDashRipsSummary(null);
        return;
      }
      const data: DashRipsSummary = await res.json();
      setDashRipsSummary(data);

      // Igual que en AdminCenter: si el rango actual quedó vacío pero SÍ hay
      // diagnósticos históricos, reencuadra el rango una sola vez alrededor
      // del más reciente en vez de dejar el panel viéndose "roto".
      if (data.grandTotal === 0 && data.latestDiagnosisDate && !dashRipsAutoAdjustedRef.current) {
        dashRipsAutoAdjustedRef.current = true;
        const latest = new Date(`${data.latestDiagnosisDate}T00:00:00.000Z`);
        const newStart = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), 1)).toISOString().slice(0, 10);
        if (newStart !== dashRipsStartDate || data.latestDiagnosisDate !== dashRipsEndDate) {
          setDashRipsStartDate(newStart);
          setDashRipsEndDate(data.latestDiagnosisDate);
        }
      }
    } catch (err) {
      console.error('Error fetching RIPS dashboard summary', err);
      setDashRipsSummary(null);
    } finally {
      setDashRipsLoading(false);
    }
  };

  useEffect(() => {
    if ((activeTab === 'metrics' || activeTab === 'billing_rips') && currentUser && (currentUser.role === 'CEO' || currentUser.role === 'DIRECTIVO')) {
      fetchDashRipsSummary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentUser, dashRipsStartDate, dashRipsEndDate, dashRipsCompanyId]);

  const dashRipsCellMap = new Map<string, number>();
  (dashRipsSummary?.rows || []).forEach((r) => dashRipsCellMap.set(`${r.date}|${r.category}`, r.count));

  const handleExportDashRipsExcel = () => {
    if (!dashRipsSummary || dashRipsSummary.grandTotal === 0) {
      toast.error('No hay datos de RIPS diagnosticados en el rango/filtro seleccionado.');
      return;
    }
    const { dates, categories, totalsByDate, totalsByCategory, grandTotal, startDate, endDate } = dashRipsSummary;
    const companyLabel = dashRipsCompanyId === 'all'
      ? 'Todos los convenios'
      : (companies.find((c) => c.id === dashRipsCompanyId)?.name || dashRipsCompanyId);

    const headerFill = { fill: { fgColor: { rgb: '111111' } }, font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: { bottom: { style: 'thin', color: { rgb: '000000' } } } };
    const totalFill = { fill: { fgColor: { rgb: 'EEEEEE' } }, font: { bold: true, sz: 10 }, alignment: { horizontal: 'center' } };
    const cellStyle = { alignment: { horizontal: 'center' }, font: { sz: 10 } };
    const dateCellStyle = { font: { bold: true, sz: 10 } };

    const aoa: any[][] = [];
    aoa.push([{ v: 'Reporte de Diagnósticos por RIPS — MindPsic', s: { font: { bold: true, sz: 13 } } }]);
    aoa.push([{ v: `Rango: ${startDate} a ${endDate}  ·  Convenio: ${companyLabel}  ·  Total diagnosticados: ${grandTotal}`, s: { font: { italic: true, sz: 9, color: { rgb: '555555' } } } }]);
    aoa.push([]);
    aoa.push([{ v: 'Fecha', s: headerFill }, ...categories.map((c) => ({ v: c, s: headerFill })), { v: 'Total', s: headerFill }]);
    dates.forEach((date) => {
      const row = [{ v: date, s: dateCellStyle }];
      categories.forEach((cat) => row.push({ v: dashRipsCellMap.get(`${date}|${cat}`) || 0, s: cellStyle } as any));
      row.push({ v: totalsByDate[date] || 0, s: totalFill } as any);
      aoa.push(row);
    });
    aoa.push([{ v: 'Total', s: totalFill }, ...categories.map((cat) => ({ v: totalsByCategory[cat] || 0, s: totalFill })), { v: grandTotal, s: totalFill }]);

    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    worksheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: categories.length + 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: categories.length + 1 } },
    ];
    worksheet['!cols'] = [{ wch: 14 }, ...categories.map(() => ({ wch: 22 })), { wch: 10 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Resumen RIPS');
    XLSX.writeFile(workbook, `panel-rips_${startDate}_a_${endDate}.xlsx`);
  };

  // ── Panel "Ver pacientes sin Diagnósticos RIPS" ─────────────────────────
  // Lista accionable (distinta del resumen agregado de ripsControlPanel):
  // pacientes atendidos en el periodo que TODAVÍA no tienen diagnóstico RIPS,
  // agrupables por psicólogo para poder notificarles el pendiente.
  interface PendingRipsPatient {
    id: string;
    firstName: string;
    lastName: string;
    documentId: string;
    recordNumber?: string | null;
    corporateClient?: string | null;
    psychologist: { id: string; name: string } | null;
  }
  const MONTH_LABELS = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  // Mismo tipo de filtro (Desde/Hasta) que ya usa "Generar Reporte de
  // Diagnósticos por RIPS" — antes eran selects de Año/Mes, sin forma de ver
  // un rango específico. El backend resuelve el rango mes por mes por su
  // cuenta (RipsDiagnosis está amarrado a un mes calendario exacto), así que
  // un rango que cruza meses funciona igual de bien que uno de un solo mes.
  const [pendingRipsStartDate, setPendingRipsStartDate] = useState(dashMonthStartISO);
  const [pendingRipsEndDate, setPendingRipsEndDate] = useState(dashTodayISO);
  const [pendingRipsCompanyId, setPendingRipsCompanyId] = useState('all');
  const [pendingRipsList, setPendingRipsList] = useState<PendingRipsPatient[]>([]);
  const [pendingRipsLoading, setPendingRipsLoading] = useState(false);
  const [pendingRipsNotifying, setPendingRipsNotifying] = useState(false);

  const fetchPendingRipsList = async () => {
    setPendingRipsLoading(true);
    try {
      const params = new URLSearchParams({ startDate: pendingRipsStartDate, endDate: pendingRipsEndDate });
      if (pendingRipsCompanyId !== 'all') params.set('companyId', pendingRipsCompanyId);
      const res = await apiFetch(`/api/rips-diagnosis/pending?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPendingRipsList(Array.isArray(data.pending) ? data.pending : []);
    } catch (err) {
      console.error('Error cargando pacientes sin diagnóstico RIPS', err);
      setPendingRipsList([]);
    } finally {
      setPendingRipsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'billing_rips' || !currentUser || (currentUser.role !== 'CEO' && currentUser.role !== 'DIRECTIVO')) return;
    fetchPendingRipsList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentUser, pendingRipsStartDate, pendingRipsEndDate, pendingRipsCompanyId]);

  // Agrupado por psicólogo — solo para mostrar en pantalla cuántos mensajes
  // saldrían al notificar (el backend recalcula y agrupa de nuevo por su cuenta).
  const pendingRipsByPsychologist = new Map<string, { name: string; count: number }>();
  let pendingRipsUnassignedCount = 0;
  pendingRipsList.forEach((p) => {
    if (!p.psychologist) { pendingRipsUnassignedCount += 1; return; }
    const entry = pendingRipsByPsychologist.get(p.psychologist.id) || { name: p.psychologist.name, count: 0 };
    entry.count += 1;
    pendingRipsByPsychologist.set(p.psychologist.id, entry);
  });

  // "28/08/2026" o, si Desde y Hasta caen en el mismo mes, "agosto de 2026" —
  // el rango casi siempre se usa dentro de un solo mes (así es como funciona
  // el reporte RIPS), así que vale la pena el caso corto y legible.
  const pendingRipsPeriodLabel = (() => {
    const start = new Date(`${pendingRipsStartDate}T00:00:00.000Z`);
    const end = new Date(`${pendingRipsEndDate}T00:00:00.000Z`);
    if (start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()) {
      return `${MONTH_LABELS[start.getUTCMonth() + 1]} ${start.getUTCFullYear()}`;
    }
    const fmt = (d: Date) => d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
    return `${fmt(start)} a ${fmt(end)}`;
  })();

  const handleNotifyPendingRips = async () => {
    if (pendingRipsList.length === 0) return;
    const psychCount = pendingRipsByPsychologist.size;
    if (!(await confirmToast(`¿Enviar recordatorio por Mensajería Clínica a ${psychCount} psicólogo(s) sobre sus pacientes sin diagnóstico RIPS de ${pendingRipsPeriodLabel}?`))) {
      return;
    }
    setPendingRipsNotifying(true);
    try {
      const res = await apiFetch('/api/rips-diagnosis/notify', {
        method: 'POST',
        body: JSON.stringify({ startDate: pendingRipsStartDate, endDate: pendingRipsEndDate, companyId: pendingRipsCompanyId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(`Recordatorio enviado a ${data.notified?.length || 0} psicólogo(s).`);
      if (data.failed?.length > 0) {
        toast.error(`No se pudo notificar a ${data.failed.length} psicólogo(s) — intenta de nuevo.`);
      }
      if (data.unassignedPatients?.length > 0) {
        toast(`${data.unassignedPatients.length} paciente(s) sin psicólogo asignado no recibieron recordatorio.`, { icon: '⚠️' });
      }
    } catch (err: any) {
      toast.error(err.message || 'Error al enviar los recordatorios.');
    } finally {
      setPendingRipsNotifying(false);
    }
  };

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
  const [appointmentSearchTerm, setAppointmentSearchTerm] = useState('');

  // Mapeo dinámico de citas reales consumidas desde el custom hook
  const appointmentsLog = (realAppointments || []).map((appt) => {
    const dateObj = new Date(appt?.dateTime || Date.now());
    const dayName = dateObj.toLocaleDateString('es-ES', { weekday: 'long' });
    const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    const monthName = dateObj.toLocaleDateString('es-ES', { month: 'long' });
    const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    return {
      id: appt?.id || 'unknown',
      patientName: `${appt?.patient?.firstName || ''} ${appt?.patient?.lastName || ''}`.trim() || 'Paciente Desconocido',
      professional: appt?.psychologist?.name || 'Clínico no asignado',
      // Especialidad REAL con la que se agendó la sesión (catálogo Specialty),
      // no el tipo/modalidad de la cita — antes se leía appt.type por error.
      specialty: appt.specialty?.name || 'Sin especialidad asignada',
      day: capitalizedDay,
      month: capitalizedMonth,
      status: appt.status || 'Atendido',
      modality: appt.type === 'Virtual' || appt.type === 'Presencial' ? appt.type : 'Virtual',
      // Convenio REAL del paciente — antes se sorteaba entre 4 aseguradoras
      // ficticias según un hash del id, sin relación con el dato real.
      agreement: appt.patient?.corporateClient || 'Particular',
      reason: appt.notes || null
    };
  });


  // Advanced Docs multi-upload states
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [isProcessingRAG, setIsProcessingRAG] = useState(false);
  const [ragStatusMessage, setRagStatusMessage] = useState<string | null>(null);

  const [ripsYear, setRipsYear] = useState('2026');
  const [ripsMonth, setRipsMonth] = useState('05');
  // Periodos (año/mes) para los que YA existe al menos un diagnóstico RIPS
  // asignado — reemplaza la lista fija hardcodeada de años/meses, que no
  // tenía ninguna relación con los datos reales del tenant.
  const [ripsPeriods, setRipsPeriods] = useState<{ year: number; month: number }[]>([]);
  const [ripsCompanyId, setRipsCompanyId] = useState('all');
  useEffect(() => {
    const fetchRipsPeriods = async () => {
      try {
        const apiUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
        const res = await fetch(`${apiUrl}/api/rips-diagnosis/periods`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const periods: { year: number; month: number }[] = data.periods || [];
        setRipsPeriods(periods);
        // El periodo más reciente con datos reales reemplaza el default
        // hardcodeado (mayo/2026) apenas se conoce el histórico real.
        if (periods.length > 0) {
          setRipsYear(String(periods[0].year));
          setRipsMonth(String(periods[0].month).padStart(2, '0'));
        }
      } catch {
        // Silencioso — los selects simplemente quedan vacíos
      }
    };
    fetchRipsPeriods();
  }, [token]);

  const ripsYearOptions = Array.from(new Set(ripsPeriods.map((p) => p.year))).sort((a, b) => b - a);
  const ripsMonthOptions = ripsPeriods
    .filter((p) => String(p.year) === ripsYear)
    .map((p) => p.month)
    .sort((a, b) => b - a);

  const [ripsFiles, setRipsFiles] = useState<{ US: string; AT: string; AC: string; CT: string } | null>(null);
  const [ripsWarnings, setRipsWarnings] = useState<string[]>([]);
  const [ripsPreviewTab, setRipsPreviewTab] = useState<'US' | 'AT' | 'AC' | 'CT'>('US');

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

  // Dynamic computation of clinical stats
  const totalPatientsCount = dashboardMetrics.pacientesAtendidosCount;
  const activePsychologistsCount = dashboardMetrics.psicologosActivosCount;
  const totalCompletedSessionsCount = dashboardMetrics.evolucionesHistoricasCount;

  // Opciones reales para los 5 selectores del filtro cruzado — todas
  // derivadas del propio log de citas, no de listas fijas ni de arrays vacíos.
  // Antes 4 de los 5 selectores estaban conectados a un array vacío
  // ({[]?.map(...)}) y nunca mostraban nada más que "Todos" — no había forma
  // real de acotar el filtro más allá del psicólogo.
  const professionalOptions = Array.from(
    new Set(appointmentsLog.map((app) => app.professional).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const agreementOptions = Array.from(
    new Set(appointmentsLog.map((app) => app.agreement).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const specialtyOptions = Array.from(
    new Set(appointmentsLog.map((app) => app.specialty).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const WEEKDAY_ORDER = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const dayOptions = Array.from(new Set(appointmentsLog.map((app) => app.day).filter(Boolean)))
    .sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b));

  const MONTH_ORDER = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const monthOptions = Array.from(new Set(appointmentsLog.map((app) => app.month).filter(Boolean)))
    .sort((a, b) => MONTH_ORDER.indexOf(a) - MONTH_ORDER.indexOf(b));

  // Dynamic cross-filtering for interactive clinical auditor dashboard
  const filteredAppointments = appointmentsLog.filter(app => {
    const matchesAgreement = selectedAgreement === 'todos' || app.agreement === selectedAgreement;
    const matchesProfessional = selectedProfessional === 'todos' || app.professional === selectedProfessional;
    const matchesSpecialty = selectedSpecialty === 'todos' || app.specialty === selectedSpecialty;
    const matchesDay = selectedDay === 'todos' || app.day === selectedDay;
    const matchesMonth = selectedMonth === 'todos' || app.month === selectedMonth;
    const matchesSearch = !appointmentSearchTerm.trim() ||
      app.patientName.toLowerCase().includes(appointmentSearchTerm.trim().toLowerCase());

    return matchesAgreement && matchesProfessional && matchesSpecialty && matchesDay && matchesMonth && matchesSearch;
  });

  const totalFilteredCount = filteredAppointments.length;
  const attendedCount = filteredAppointments.filter(app => ['Atendida', 'Atendido', 'ATENDIDO'].includes(app.status)).length;
  const unattendedOrReprogrammedCount = filteredAppointments.filter(app => app.status === 'No Atendido' || app.status === 'Reprogramada' || app.status === 'Pendiente').length;


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

  // PANEL DE DIAGNÓSTICOS POR RIPS — mismo panel de AdminCenter, acá acotado
  // al tenant propio (sin selector de empresa). Se muestra tanto en "Tablero
  // general" como en "Facturación y RIPS", de ahí que quede extraído en una
  // variable en vez de repetido inline en los dos tabs.
  const ripsControlPanel = (
    <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 md:p-6 space-y-4 text-left">
      <div className="border-b border-slate-100 pb-3">
        <h2 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center">
          <FileCode className="w-4 h-4 mr-1.5 text-toast-500" />
          Generar reporte de Diagnósticos por RIPS
        </h2>
        <p className="text-[11px] text-slate-400">Resumen de diagnósticos RIPS (CIE-10) asignados por fecha y categoría, filtrable por convenio.</p>
      </div>

      {currentUser.role !== 'CEO' && currentUser.role !== 'DIRECTIVO' ? (
        <div className="p-10 text-center text-slate-400 text-xs italic border border-dashed border-slate-200 rounded-xl">
          Tu rol no tiene permisos para ver el panel de diagnósticos por RIPS (solo CEO/DIRECTIVO).
        </div>
      ) : (
      <>
      <div className="flex flex-wrap items-end gap-3 bg-slate-50 p-4 rounded-xl border border-slate-150">
        <div className="space-y-1 text-xs">
          <label className="block text-[10px] uppercase font-bold text-slate-600">Desde</label>
          <input
            type="date"
            value={dashRipsStartDate}
            max={dashRipsEndDate}
            onChange={(e) => setDashRipsStartDate(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
          />
        </div>
        <div className="space-y-1 text-xs">
          <label className="block text-[10px] uppercase font-bold text-slate-600">Hasta</label>
          <input
            type="date"
            value={dashRipsEndDate}
            min={dashRipsStartDate}
            onChange={(e) => setDashRipsEndDate(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
          />
        </div>
        <div className="flex-1 min-w-[160px] space-y-1 text-xs">
          <label className="block text-[10px] uppercase font-bold text-slate-600">Convenio</label>
          <select
            value={dashRipsCompanyId}
            onChange={(e) => setDashRipsCompanyId(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
          >
            <option value="all">Todos los convenios</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={fetchDashRipsSummary}
          disabled={dashRipsLoading}
          className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${dashRipsLoading ? 'animate-spin' : ''}`} /> Actualizar
        </button>
        <button
          onClick={handleExportDashRipsExcel}
          disabled={dashRipsLoading || !dashRipsSummary || dashRipsSummary.grandTotal === 0}
          className="bg-charcoal-900 hover:bg-slate-950 text-white font-bold text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" /> Exportar Excel
        </button>
      </div>

      {dashRipsLoading ? (
        <div className="p-10 text-center text-slate-400 text-xs italic border border-dashed border-slate-200 rounded-xl">
          Cargando resumen de RIPS...
        </div>
      ) : !dashRipsSummary || dashRipsSummary.grandTotal === 0 ? (
        <div className="p-10 text-center text-slate-400 text-xs italic border border-dashed border-slate-200 rounded-xl">
          No se encontraron diagnósticos RIPS en el rango/filtro seleccionado.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="border border-slate-200 rounded-lg px-4 py-2">
              <span className="text-[9px] text-slate-400 font-mono font-bold uppercase block">Total Diagnosticados</span>
              <span className="text-xl font-black text-slate-900 font-mono">{dashRipsSummary.grandTotal}</span>
            </div>
            <div className="border border-slate-200 rounded-lg px-4 py-2">
              <span className="text-[9px] text-slate-400 font-mono font-bold uppercase block">Categorías CIE-10 distintas</span>
              <span className="text-xl font-black text-slate-900 font-mono">{dashRipsSummary.categories.length}</span>
            </div>
            <div className="border border-slate-200 rounded-lg px-4 py-2">
              <span className="text-[9px] text-slate-400 font-mono font-bold uppercase block">Días con registros</span>
              <span className="text-xl font-black text-slate-900 font-mono">{dashRipsSummary.dates.length}</span>
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-x-auto bg-white">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[9px] font-mono tracking-widest">
                  <th className="p-3 sticky left-0 bg-slate-50">Fecha</th>
                  {dashRipsSummary.categories.map((cat) => (
                    <th key={cat} className="p-3 text-center whitespace-nowrap">{cat}</th>
                  ))}
                  <th className="p-3 text-center bg-slate-100">Total</th>
                </tr>
              </thead>
              <tbody>
                {dashRipsSummary.dates.map((date) => (
                  <tr key={date} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-slate-800 sticky left-0 bg-white">{date}</td>
                    {dashRipsSummary.categories.map((cat) => (
                      <td key={cat} className="p-3 text-center font-mono text-slate-600">
                        {dashRipsCellMap.get(`${date}|${cat}`) || 0}
                      </td>
                    ))}
                    <td className="p-3 text-center font-mono font-bold text-slate-800 bg-slate-50">{dashRipsSummary.totalsByDate[date] || 0}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 font-mono font-black text-slate-900">
                  <td className="p-3 sticky left-0 bg-slate-100">Total</td>
                  {dashRipsSummary.categories.map((cat) => (
                    <td key={cat} className="p-3 text-center">{dashRipsSummary.totalsByCategory[cat] || 0}</td>
                  ))}
                  <td className="p-3 text-center">{dashRipsSummary.grandTotal}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      </>
      )}
    </div>
  );

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

          {/* Historias Clínicas — el administrador puede consultarlas */}
          <button
            onClick={() => { setSelectedPatientId(null); setActiveTab('clinical_history'); }}
            id="tab-adm-historias"
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'clinical_history'
                ? 'bg-charcoal-900 text-white font-semibold'
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <FileText className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Historias Clínicas</span>
            {activeTab === 'clinical_history' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
          </button>

          {/* Pruebas y Evaluaciones — el administrativo asigna y hace seguimiento;
              la lectura clínica del resultado sigue siendo del profesional. */}
          <button
            onClick={() => setActiveTab('evaluations')}
            id="tab-adm-evaluaciones"
            className={`w-full flex items-center p-3 px-4 transition-all duration-150 relative cursor-pointer ${
              activeTab === 'evaluations'
                ? 'bg-charcoal-900 text-white font-semibold'
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <ClipboardList className="w-5 h-5 shrink-0" />
            <span className="ml-3 text-xs hidden md:block">Pruebas y Evaluaciones</span>
            {activeTab === 'evaluations' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-toast-400" />}
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

            {/* CALENDARIO GENERAL DEL TENANT — agendamiento de pacientes y convenios */}
            <CalendarPanel
              appointments={calendarAppointments as CalendarAppointment[]}
              view={calendarView}
              setView={setCalendarView}
              currentDate={calendarDate}
              setCurrentDate={setCalendarDate}
              onSelectAppointment={(app) => {
                const realAppt = realAppointments?.find((r: any) => r.id === app.id);
                if (realAppt) {
                  setEditingAppointment(realAppt);
                  setShowDelegatedModal(true);
                }
              }}
              onNewAppointment={() => {
                setEditingAppointment(null);
                setShowDelegatedModal(true);
              }}
              filterSlot={
                <CalendarFilterGroup>
                  <CalendarFilterSelect
                    icon={User2}
                    label="Psicólogo"
                    value={calendarPsychologistFilter}
                    onChange={setCalendarPsychologistFilter}
                    options={calendarPsychologistOptions}
                    allLabel="Todos los psicólogos"
                  />
                  <div className="hidden h-6 w-px bg-slate-200 sm:block" />
                  <StatusFilterPills value={calendarStatusFilter} onChange={setCalendarStatusFilter} />
                </CalendarFilterGroup>
              }
            />

            {/* HIGH-LEVEL STATS COMPONENT GRID */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
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
            </div>

            {/* COMPLEJO PANEL DE FILTROS CRUZADOS (REQUERIMIENTO PRINCIPAL DE UX/UI) */}
            <div className="bg-white rounded-2xl border border-slate-150 p-5 shadow-2xs space-y-4 text-left">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-2.5 gap-2">
                <div>
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-2">
                    <Filter className="w-4 h-4 mr-1.5 text-toast-500 font-bold" />
                    Filtro de Consultas Programadas
                  </h3>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Reset button to default "todos" */}
                  {(selectedAgreement !== 'todos' || selectedProfessional !== 'todos' || selectedSpecialty !== 'todos' || selectedDay !== 'todos' || selectedMonth !== 'todos' || appointmentSearchTerm) && (
                    <button
                      onClick={() => {
                        setSelectedAgreement('todos');
                        setSelectedProfessional('todos');
                        setSelectedSpecialty('todos');
                        setSelectedDay('todos');
                        setSelectedMonth('todos');
                        setAppointmentSearchTerm('');
                      }}
                      className="text-[10px] font-bold text-toast-500 hover:text-toast-600 hover:underline px-2.5 py-1 bg-toast-50 rounded-lg border border-toast-200 transition-all cursor-pointer shadow-3xs"
                    >
                      Restablecer Filtros
                    </button>
                  )}
                </div>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={appointmentSearchTerm}
                  onChange={(e) => setAppointmentSearchTerm(e.target.value)}
                  placeholder="Buscar por nombre del paciente..."
                  className="w-full rounded-xl border border-slate-205 bg-slate-50 py-2 pl-10 pr-3 text-xs font-semibold text-slate-900 outline-none transition-colors focus:ring-2 focus:ring-toast-500"
                />
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
                    {agreementOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
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
                    {professionalOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
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
                    {specialtyOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
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
                    {dayOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
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
                    {monthOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
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
                          <div className="flex justify-between items-center gap-2">
                            <strong className="text-slate-900 truncate">{app.patientName}</strong>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => {
                                  const realAppt = realAppointments?.find((r: any) => r.id === app.id);
                                  if (realAppt) {
                                    setEditingAppointment(realAppt);
                                    setShowDelegatedModal(true);
                                  }
                                }}
                                title="Reprogramar / Editar"
                                className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 cursor-pointer"
                              >
                                <Pencil className="h-3.5 w-3.5" />
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
                                title="Eliminar cita"
                                className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                              <span className="ml-1 text-[9px] font-mono font-bold uppercase tracking-wider bg-charcoal-900 text-white px-1.5 py-0.5 rounded">
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
                    {totalFilteredCount > 0 ? Math.round((unattendedOrReprogrammedCount / totalFilteredCount) * 100) : 0}% sin completar
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
                          <div className="flex justify-between items-center gap-2">
                            <strong className="text-slate-900 truncate">{app.patientName}</strong>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => {
                                  const realAppt = realAppointments?.find((r: any) => r.id === app.id);
                                  if (realAppt) {
                                    setEditingAppointment(realAppt);
                                    setShowDelegatedModal(true);
                                  }
                                }}
                                title="Reprogramar / Editar"
                                className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 cursor-pointer"
                              >
                                <Pencil className="h-3.5 w-3.5" />
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
                                title="Eliminar cita"
                                className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                              <span className={`ml-1 text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
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

            {ripsControlPanel}

            {/* PERFORMANCE ANALYSIS: DESEMPEÑO CLÍNICO INDIVIDUAL — oculto a
                pedido del usuario hasta implementar la funcionalidad real
                (hoy "performances" nunca se puebla con datos reales). */}
            {false && (
            <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 space-y-4">
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
                      <th className="p-3 text-center pr-4">Sesiones Total</th>
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
                        <td className="p-3 text-center pr-4 text-slate-900 font-mono font-semibold">{perf.completedSessions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            )}
          </div>
        )}

        {/* VIEW: VIDEO-CALL QUALITY CONTROL & BITRATE HUD */}
        {activeTab === 'video_admin' && ['CEO', 'DIRECTIVO', 'SUPER ADMIN', 'C-LEVEL', 'ESPECIALISTA_B2B'].includes(currentUser.role) && (
          <div className="max-w-7xl mx-auto space-y-6 text-left">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5 md:p-6">
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
                  emailUsuario={currentUser?.email}
                />
              </div>

              <div className="border-t border-slate-100 mt-6 pt-6">
                <h2 className="text-sm font-extrabold text-slate-900 tracking-tight flex items-center">
                  <Video className="w-5 h-5 mr-1.5 text-toast-500" />
                  Consola de Vídeo Administrador (WebRTC Control Hub)
                </h2>
                <p className="text-xs text-slate-400">Inspecciona consumo de ancho de banda, pérdida de paquetes y estatus de servidores de señalización en tiempo real.</p>
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
          <PacientesPanel
            token={token}
            userRole={currentUser?.role}
            onSelectPatient={(id) => {
              window.history.pushState({ mindpsicPatientChart: true }, '', window.location.href);
              setSelectedPatientId(id);
              setClinicalHistoryReturnTab('patients');
              setActiveTab('clinical_history');
            }}
          />
        )}

        {/* VIEW: HISTORIAS CLÍNICAS — mismo componente que usa PsychologistPortal,
            el administrador puede consultarlas (solo lectura desde este portal). */}
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

        {/* VIEW: PRUEBAS Y EVALUACIONES */}
        {activeTab === 'evaluations' && <AssessmentsPanel />}

        {/* VIEW: EQUIPO Y ACCESOS — Aprovisionamiento RBAC de Usuarios (Migrado) */}
        {activeTab === 'equipo' && (
          <div className="max-w-5xl mx-auto space-y-6 text-left">
            <div className="border-b border-slate-200 pb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <span className="bg-toast-100 text-charcoal-900 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border border-toast-300 font-mono">
                  Gestión de Accesos Clínicos
                </span>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">
                  Equipo y Aprovisionamiento de Profesionales
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  Registra psicólogos y personal de soporte con su información profesional — quedan asociados automáticamente a tu propio tenant, dentro de las licencias contratadas.
                </p>
              </div>
              <button
                onClick={() => { setStaffError(null); setShowCreateStaffModal(true); }}
                className="flex items-center gap-1.5 bg-charcoal-900 hover:bg-charcoal-950 text-white font-bold text-sm px-4 py-2.5 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <UserPlus className="w-4 h-4" />
                Crear profesional
              </button>
            </div>

            {/* MODAL: Crear profesional — lo que se escriba queda en caché
                (sessionStorage) aunque se cierre sin enviar. */}
            {showCreateStaffModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden bg-white rounded-2xl shadow-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-slate-900">Crear profesional</h3>
                <button onClick={() => setShowCreateStaffModal(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-[10px] text-slate-400">Los campos marcados con * son obligatorios.</p>
              <form onSubmit={handleCreateStaff} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Nombres *</label>
                    <input
                      type="text" required
                      value={newStaffForm.firstName}
                      onChange={e => setNewStaffForm({ ...newStaffForm, firstName: e.target.value })}
                      placeholder="Ej. María Camila"
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Apellidos *</label>
                    <input
                      type="text" required
                      value={newStaffForm.lastName}
                      onChange={e => setNewStaffForm({ ...newStaffForm, lastName: e.target.value })}
                      placeholder="Ej. Torres Gómez"
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Correo electrónico *</label>
                    <input
                      type="email" required
                      value={newStaffForm.email}
                      onChange={e => setNewStaffForm({ ...newStaffForm, email: e.target.value })}
                      placeholder="correo@empresa.com"
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Rol en la plataforma *</label>
                    <select
                      value={newStaffForm.role}
                      onChange={e => setNewStaffForm({ ...newStaffForm, role: e.target.value as 'ESPECIALISTA_B2B' | 'OPERATIVO' })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    >
                      <option value="ESPECIALISTA_B2B">Psicólogo / Especialista Clínico</option>
                      <option value="OPERATIVO">Soporte Operativo / Auxiliar</option>
                    </select>
                  </div>
                </div>

                {newStaffForm.role === 'ESPECIALISTA_B2B' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">Número de tarjeta profesional</label>
                      <input
                        type="text"
                        value={newStaffForm.professionalCard}
                        onChange={e => setNewStaffForm({ ...newStaffForm, professionalCard: e.target.value })}
                        placeholder="Ej. PS-118432"
                        className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white font-mono"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">Debe ser único dentro de la organización.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">Especialidad</label>
                      <select
                        value={newStaffForm.specialtyId}
                        onChange={e => setNewStaffForm({ ...newStaffForm, specialtyId: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                      >
                        <option value="">Selecciona la especialidad</option>
                        {staffSpecialties.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Nivel académico</label>
                    <select
                      value={newStaffForm.academicLevel}
                      onChange={e => setNewStaffForm({ ...newStaffForm, academicLevel: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    >
                      <option value="">Selecciona el nivel</option>
                      {ACADEMIC_LEVEL_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Experiencia (años)</label>
                    <input
                      type="number" min={0}
                      value={newStaffForm.experienceYears}
                      onChange={e => setNewStaffForm({ ...newStaffForm, experienceYears: e.target.value })}
                      placeholder="0"
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                </div>

                <div className="relative">
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">EPS / IPS asociada</label>
                  <input
                    type="text"
                    value={newStaffForm.epsCode ? newStaffForm.epsLabel : newStaffEpsSearch.query}
                    onChange={e => {
                      setNewStaffForm({ ...newStaffForm, epsCode: '', epsLabel: '' });
                      newStaffEpsSearch.setQuery(e.target.value);
                    }}
                    placeholder="Opcional — busca por nombre, ej. Sura EPS"
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                  />
                  {newStaffEpsSearch.results.length > 0 && !newStaffForm.epsCode && (
                    <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                      {newStaffEpsSearch.results.map(eps => (
                        <li key={eps.code}>
                          <button
                            type="button"
                            onClick={() => { setNewStaffForm({ ...newStaffForm, epsCode: eps.code, epsLabel: eps.nombre }); newStaffEpsSearch.setResults([]); }}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-toast-50 cursor-pointer"
                          >
                            {eps.nombre}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <label className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-lg p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newStaffForm.dataConsentAccepted}
                    onChange={e => setNewStaffForm({ ...newStaffForm, dataConsentAccepted: e.target.checked })}
                    className="mt-0.5 accent-charcoal-900"
                  />
                  <span className="text-xs text-slate-600">
                    <span className="font-bold text-slate-800 inline-flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Autorización de tratamiento de datos personales *</span>
                    <br />
                    El titular autoriza el tratamiento de sus datos personales y sensibles conforme a la Ley 1581 de 2012 y el Decreto 1074 de 2015, con las finalidades descritas en la política de privacidad del responsable.
                  </span>
                </label>

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
                  {isCreatingStaff ? 'Creando...' : 'Crear profesional'}
                </button>
              </form>
            </div>
            </div>
            )}

            {staffSuccess && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 space-y-2">
                <p className="text-sm font-bold text-emerald-800">✅ {staffSuccess.name} fue creado exitosamente.</p>
                <p className="text-xs text-emerald-700">Sus credenciales ya fueron enviadas por correo, con aviso de que debe cambiar la contraseña en su primer ingreso. Referencia por si necesitas confirmarlas:</p>
                <div className="bg-white border border-emerald-200 rounded-lg p-3 font-mono text-xs space-y-1">
                  <p>Correo: <strong>{staffSuccess.email}</strong></p>
                  <p>Contraseña temporal: <strong>{staffSuccess.tempPassword}</strong></p>
                </div>
              </div>
            )}

            {/* Panel: Profesionales de mi organización */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-xs overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Profesionales de mi organización</h3>
                  <p className="text-[10.5px] text-slate-400 mt-0.5">Datos sensibles enmascarados por defecto (principio de acceso mínimo).</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => { setStaffRecentFirst(v => !v); setStaffPage(1); }}
                    className={`flex items-center gap-1.5 text-xs font-bold rounded-lg px-3 py-1.5 border cursor-pointer ${
                      staffRecentFirst
                        ? 'bg-toast-100 border-toast-300 text-charcoal-900'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                    title="Ordenar por fecha de alta, el más reciente primero"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    Recientes
                  </button>
                  <button
                    onClick={() => setStaffDataRevealed(v => !v)}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 cursor-pointer"
                  >
                    {staffDataRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {staffDataRevealed ? 'Ocultar datos' : 'Revelar datos'}
                  </button>
                  <button
                    onClick={() => fetchTeamUsers()}
                    className="text-xs text-slate-400 hover:text-slate-700 font-semibold"
                  >
                    Recargar
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold uppercase text-[10px]">
                      <th className="p-4">Profesional</th>
                      <th className="p-4">Tarjeta</th>
                      <th className="p-4">Perfil</th>
                      <th className="p-4 w-28">Estado</th>
                      <th className="p-4 text-right w-36">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {teamUsersLoading ? (
                      <tr><td colSpan={5} className="p-8 text-center text-slate-400">Cargando equipo...</td></tr>
                    ) : teamUsersError ? (
                      <tr><td colSpan={5} className="p-8 text-center text-red-600">⚠️ {teamUsersError}</td></tr>
                    ) : teamUsers.length === 0 ? (
                      <tr><td colSpan={5} className="p-8 text-center text-slate-400">Todavía no has creado colaboradores.</td></tr>
                    ) : (
                      paginatedTeamUsers.map((member) => (
                        <tr key={member.id} className="hover:bg-slate-50 align-top">
                          <td className="p-4">
                            <p className="font-bold text-slate-900">{member.name}</p>
                            <p className="font-mono text-[11px] text-slate-500">{staffDataRevealed ? member.email : maskEmail(member.email)}</p>
                          </td>
                          <td className="p-4 font-mono text-[11px] text-slate-600">
                            {member.professionalCard ? (staffDataRevealed ? member.professionalCard : maskCard(member.professionalCard)) : '—'}
                          </td>
                          <td className="p-4 text-slate-600">
                            {member.specialtyName && <p className="font-semibold text-slate-800">{member.specialtyName}</p>}
                            <p className="text-[10.5px] text-slate-400">
                              {[member.academicLevel, member.experienceYears != null ? `${member.experienceYears} años` : null].filter(Boolean).join(' · ')}
                            </p>
                            <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded font-mono font-bold text-[9px] bg-slate-100 border border-slate-200 text-slate-600 uppercase">
                              {member.role === 'ESPECIALISTA_B2B' ? 'Psicólogo / Especialista Clínico' : member.role === 'OPERATIVO' ? 'Soporte Operativo' : member.role}
                            </span>
                            {member.epsName && <p className="text-[10.5px] text-slate-400 mt-1">EPS/IPS: {member.epsName}</p>}
                          </td>
                          <td className="p-4">
                            <button
                              onClick={() => handleToggleStaffActive(member)}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${member.status === 'active' ? 'bg-charcoal-900' : 'bg-slate-300'}`}
                              title="Click para activar/desactivar el acceso"
                            >
                              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${member.status === 'active' ? 'translate-x-[18px]' : 'translate-x-1'}`} />
                            </button>
                            <p className="text-[10px] font-semibold mt-1 text-slate-500">{member.status === 'active' ? 'Activo' : 'Inactivo'}</p>
                          </td>
                          <td className="p-4 text-right whitespace-nowrap">
                            <button
                              onClick={() => openEditStaffModal(member)}
                              className="p-2 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                              title={`Editar a ${member.name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => openStaffHistoryModal(member)}
                              className="p-2 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                              title="Historial de cambios"
                            >
                              <History className="w-3.5 h-3.5" />
                            </button>
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
              {sortedTeamUsers.length > 0 && (
                <div className="flex flex-col items-center justify-between gap-2 border-t border-slate-100 p-4 sm:flex-row">
                  <span className="text-xs text-slate-400">
                    Mostrando {staffRangeStart}–{staffRangeEnd} de {sortedTeamUsers.length}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setStaffPage((p) => Math.max(1, p - 1))}
                      disabled={staffPage <= 1}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-charcoal-900 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                    >
                      Anterior
                    </button>
                    <span className="px-2 text-xs text-slate-400">Página {staffPage} de {staffTotalPages}</span>
                    <button
                      type="button"
                      onClick={() => setStaffPage((p) => Math.min(staffTotalPages, p + 1))}
                      disabled={staffPage >= staffTotalPages}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-charcoal-900 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-500 mt-0.5" />
              <p className="text-[10.5px] text-slate-500 leading-relaxed">
                <span className="font-bold text-slate-700">Protección de datos personales.</span> Los datos recolectados se tratan bajo la Ley Estatutaria 1581 de 2012 y el Decreto 1074 de 2015. El titular puede conocer, actualizar, rectificar o suprimir su información y revocar la autorización otorgada. La información profesional se considera dato sensible y se almacena con controles de acceso, enmascaramiento y trazabilidad de cambios.
              </p>
            </div>
          </div>
        )}

        {/* MODAL: Editar profesional */}
        {showEditStaffModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden bg-white rounded-2xl shadow-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-slate-900">Editar profesional</h3>
                <button onClick={() => setShowEditStaffModal(false)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveStaff} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Nombres *</label>
                    <input
                      type="text" required value={editStaffForm.firstName}
                      onChange={e => setEditStaffForm({ ...editStaffForm, firstName: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Apellidos *</label>
                    <input
                      type="text" required value={editStaffForm.lastName}
                      onChange={e => setEditStaffForm({ ...editStaffForm, lastName: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Número de tarjeta profesional</label>
                    <input
                      type="text" value={editStaffForm.professionalCard}
                      onChange={e => setEditStaffForm({ ...editStaffForm, professionalCard: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Especialidad</label>
                    <select
                      value={editStaffForm.specialtyId}
                      onChange={e => setEditStaffForm({ ...editStaffForm, specialtyId: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    >
                      <option value="">Sin especialidad</option>
                      {staffSpecialties.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Nivel académico</label>
                    <select
                      value={editStaffForm.academicLevel}
                      onChange={e => setEditStaffForm({ ...editStaffForm, academicLevel: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    >
                      <option value="">Selecciona el nivel</option>
                      {ACADEMIC_LEVEL_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Experiencia (años)</label>
                    <input
                      type="number" min={0} value={editStaffForm.experienceYears}
                      onChange={e => setEditStaffForm({ ...editStaffForm, experienceYears: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                    />
                  </div>
                </div>

                <div className="relative">
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">EPS / IPS asociada</label>
                  <input
                    type="text"
                    value={editStaffForm.epsCode ? editStaffForm.epsLabel : editStaffEpsSearch.query}
                    onChange={e => {
                      setEditStaffForm({ ...editStaffForm, epsCode: '', epsLabel: '' });
                      editStaffEpsSearch.setQuery(e.target.value);
                    }}
                    placeholder="Opcional — busca por nombre"
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                  />
                  {editStaffEpsSearch.results.length > 0 && !editStaffForm.epsCode && (
                    <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                      {editStaffEpsSearch.results.map(eps => (
                        <li key={eps.code}>
                          <button
                            type="button"
                            onClick={() => { setEditStaffForm({ ...editStaffForm, epsCode: eps.code, epsLabel: eps.nombre }); editStaffEpsSearch.setResults([]); }}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-toast-50 cursor-pointer"
                          >
                            {eps.nombre}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {editStaffError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">⚠️ {editStaffError}</div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowEditStaffModal(false)}
                    className="flex-1 border border-slate-200 text-slate-600 font-bold text-sm py-2.5 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingStaff}
                    className="flex-1 bg-charcoal-900 hover:bg-charcoal-950 text-white font-bold text-sm py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingStaff ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: Historial de cambios de ficha profesional */}
        {showStaffHistoryModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto bg-white rounded-2xl shadow-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-slate-900">Historial — {staffHistoryName}</h3>
                <button onClick={() => setShowStaffHistoryModal(false)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {staffHistoryLoading ? (
                <p className="text-center text-xs text-slate-400 py-8">Cargando historial...</p>
              ) : staffHistory.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-8">Sin cambios registrados todavía.</p>
              ) : (
                <ul className="space-y-3">
                  {staffHistory.map(entry => (
                    <li key={entry.id} className="border border-slate-200 rounded-lg p-3">
                      <p className="text-[10px] text-slate-400 mb-1.5">
                        {new Date(entry.createdAt).toLocaleString('es-CO')} · {entry.changedByName}
                      </p>
                      <ul className="space-y-1">
                        {Object.entries(entry.changes).map(([field, { from, to }]) => (
                          <li key={field} className="text-xs text-slate-700">
                            <span className="font-bold">{STAFF_HISTORY_FIELD_LABELS[field] || field}:</span>{' '}
                            <span className="text-slate-400 line-through">{from === null || from === undefined || from === '' ? '—' : String(from)}</span>{' → '}
                            <span className="font-semibold">{to === null || to === undefined || to === '' ? '—' : String(to)}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
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
                            <button
                              type="button"
                              onClick={() => openEditCompanyModal(c)}
                              className="font-bold text-slate-900 hover:text-indigo-600 hover:underline cursor-pointer text-left"
                            >
                              {c.name}
                            </button>
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

        {/* MODAL: Nuevo/Editar Convenio — encabezado fijo (no se va con el
            scroll) y solo el formulario scrollea; antes todo era un único
            bloque con scroll, así que el título y la "X" desaparecían apenas
            bajabas un poco. */}
        {showCompanyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg max-h-[90vh] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
                <h3 className="text-base font-black text-slate-900">
                  {editingCompanyId ? 'Editar convenio/cliente' : 'Nuevo convenio/cliente'}
                </h3>
                <button onClick={() => setShowCompanyModal(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveCompany} className="overflow-y-auto overflow-x-hidden px-6 py-4 space-y-4 flex-1">
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

                    {/* Desplegable con estilo propio — reemplaza el <select> nativo.
                        Para AGREGAR o BORRAR tipos, ver "Catálogos del convenio" más abajo. */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setAgreementTypeDropdownOpen((v) => !v)}
                        className="w-full flex items-center justify-between border border-slate-200 rounded-lg p-2.5 text-sm bg-white hover:border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                      >
                        <span className={companyForm.agreementType ? 'text-slate-900' : 'text-slate-400'}>
                          {companyForm.agreementType || 'Sin especificar'}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${agreementTypeDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {agreementTypeDropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setAgreementTypeDropdownOpen(false)} />
                          <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                            <button
                              type="button"
                              onClick={() => { setCompanyForm(prev => ({ ...prev, agreementType: '' })); setAgreementTypeDropdownOpen(false); }}
                              className="block w-full text-left px-3 py-2 text-sm text-slate-400 hover:bg-slate-50 cursor-pointer"
                            >
                              Sin especificar
                            </button>
                            {agreementTypes.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => { setCompanyForm(prev => ({ ...prev, agreementType: t.name })); setAgreementTypeDropdownOpen(false); }}
                                className={`block w-full text-left px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer ${companyForm.agreementType === t.name ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-700'}`}
                              >
                                {t.name}
                              </button>
                            ))}
                            {agreementTypes.length === 0 && (
                              <p className="px-3 py-4 text-xs text-slate-400 text-center">
                                Sin tipos registrados — créalos abajo en "Catálogos del convenio".
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
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

                {/* Catálogos del convenio — inline, sin modal encima del modal.
                    Pestañas tipo píldora para alternar entre Direcciones y
                    Tipos de convenio en el mismo espacio. */}
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Catálogos del convenio</p>
                  <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 mb-3 w-fit">
                    <button
                      type="button"
                      onClick={() => setCatalogTab('locations')}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                        catalogTab === 'locations' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Direcciones
                    </button>
                    <button
                      type="button"
                      onClick={() => setCatalogTab('types')}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                        catalogTab === 'types' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Tipos de convenio
                    </button>
                  </div>

                  {catalogTab === 'locations' ? (
                    !editingCompanyId ? (
                      <p className="text-xs text-slate-400">Guarda el convenio primero para poder agregar ubicaciones de atención.</p>
                    ) : (
                      <>
                        {editingLocations.length > 0 && (
                          <ul className="flex flex-col gap-1.5 mb-2">
                            {editingLocations.map((loc) => (
                              <li key={loc.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs">
                                <span className="text-slate-700">
                                  <span className="font-bold">{loc.name}</span>
                                  {loc.address && <span className="text-slate-400"> — {loc.address}</span>}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveLocation(loc.id)}
                                  className="text-slate-400 hover:text-red-600 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="grid grid-cols-2 gap-2 mb-2">
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
                          className="w-full inline-flex items-center justify-center gap-1.5 bg-charcoal-900 hover:bg-charcoal-950 text-white font-bold text-xs py-2.5 rounded-lg disabled:opacity-50 cursor-pointer"
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                          Añadir ubicación
                        </button>
                      </>
                    )
                  ) : (
                    <>
                      {agreementTypes.length > 0 && (
                        <ul className="flex flex-col gap-1.5 mb-2">
                          {agreementTypes.map((t) => (
                            <li key={t.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs">
                              {editingAgreementTypeId === t.id ? (
                                <>
                                  <input
                                    type="text"
                                    autoFocus
                                    value={editingAgreementTypeName}
                                    onChange={(e) => setEditingAgreementTypeName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') { e.preventDefault(); handleRenameAgreementType(t.id, editingAgreementTypeName); }
                                      if (e.key === 'Escape') { e.preventDefault(); setEditingAgreementTypeId(null); }
                                    }}
                                    className="min-w-0 flex-1 border border-indigo-300 rounded-md px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleRenameAgreementType(t.id, editingAgreementTypeName)}
                                    disabled={!editingAgreementTypeName.trim()}
                                    className="text-emerald-600 hover:text-emerald-800 disabled:opacity-40 cursor-pointer"
                                    title="Guardar"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingAgreementTypeId(null)}
                                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                                    title="Cancelar"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span className="text-slate-700">{t.name}</span>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => { setEditingAgreementTypeId(t.id); setEditingAgreementTypeName(t.name); }}
                                      className="text-slate-400 hover:text-indigo-600 cursor-pointer"
                                      title={`Renombrar "${t.name}"`}
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveAgreementType(t.id)}
                                      className="text-slate-400 hover:text-red-600 cursor-pointer"
                                      title={`Eliminar "${t.name}"`}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text" placeholder="Nuevo tipo de convenio..." value={newAgreementTypeName}
                          onChange={(e) => setNewAgreementTypeName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAgreementType(); } }}
                          className="min-w-0 flex-1 border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                        />
                        <button
                          type="button"
                          onClick={handleAddAgreementType}
                          disabled={savingAgreementType || !newAgreementTypeName.trim()}
                          className="shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold px-2.5 py-2 disabled:opacity-50 cursor-pointer"
                        >
                          {savingAgreementType ? '...' : 'Agregar'}
                        </button>
                      </div>
                    </>
                  )}
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
                    className="flex-1 border border-slate-200 text-slate-600 font-bold text-xs py-2 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit" disabled={savingCompany}
                    className="flex-1 bg-charcoal-900 hover:bg-charcoal-950 text-white font-bold text-xs py-2 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
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
                Gestión unificada de convenios con aseguradoras y generación asíncrona de archivos RIPS 4.0.
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-100 p-5 md:p-6 shadow-xs space-y-4">
                <div className="border-b border-slate-100 pb-2.5">
                  <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center">
                    <Receipt className="w-4.5 h-4.5 mr-1.5 text-toast-500 font-bold" />
                    Distribución de Pacientes por Convenio Clínico
                  </h3>
                </div>

                {(() => {
                  const externalCompanies = companies.filter((c) => !c.isDefault);
                  const countFor = (name: string) => corporateDistribution.find((d) => d.name === name)?.value ?? 0;
                  const particularCount = corporateDistribution.find((d) => d.name === 'Particular')?.value ?? 0;
                  return (
                    <>
                      {companiesLoading ? (
                        <p className="py-6 text-center text-xs text-slate-400">Cargando convenios...</p>
                      ) : externalCompanies.length === 0 ? (
                        <p className="py-6 text-center text-xs text-slate-400">Todavía no has registrado convenios/aseguradoras.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {externalCompanies.map((c, idx) => {
                            const isActive = c.status === 'activo';
                            const isFirst = idx === 0;
                            return (
                              <div
                                key={c.id}
                                className={`p-4 rounded-xl border flex items-center justify-between ${
                                  isFirst
                                    ? 'bg-charcoal-900 border-charcoal-950 text-white'
                                    : 'bg-toast-50/50 border-toast-200'
                                }`}
                              >
                                <div className="min-w-0">
                                  <span className={`text-[10px] uppercase font-mono block truncate ${isFirst ? 'text-toast-300' : 'text-charcoal-700'}`}>
                                    {c.name}
                                  </span>
                                  <span className={`font-extrabold text-lg font-mono ${isFirst ? 'text-white' : 'text-slate-900'}`}>
                                    {countFor(c.name).toLocaleString('es-CO')} Pacientes
                                  </span>
                                </div>
                                <span className={`text-[10px] font-bold p-1 px-2 rounded shrink-0 ml-2 ${
                                  isActive
                                    ? (isFirst ? 'bg-charcoal-950 text-toast-300' : 'bg-toast-100 text-toast-500')
                                    : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {isActive ? 'Activo' : 'Inactivo'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="p-4 bg-slate-50 border border-slate-150 rounded-xl flex items-center justify-between text-xs text-slate-600">
                        <div className="space-y-0.5">
                          <p className="font-bold text-slate-900">Particular (Directo Privado)</p>
                          <p className="text-[11px] text-slate-400">Pacientes sin convenio asociado.</p>
                        </div>
                        <strong className="text-slate-900 font-extrabold font-mono text-xs">{particularCount.toLocaleString('es-CO')} Pacientes</strong>
                      </div>
                    </>
                  );
                })()}
              </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 md:p-6 space-y-4">
              <div className="border-b border-slate-100 pb-2.5">
                <h3 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center">
                  <Users className="w-4.5 h-4.5 mr-1.5 text-toast-500" />
                  Generar reporte de Directorio Clínico de Pacientes
                </h3>
              </div>

              <div className="flex flex-wrap items-end gap-3 bg-slate-50 p-4 rounded-xl border border-slate-150">
                <div className="flex-1 min-w-[130px] space-y-1 text-xs">
                  <label className="block text-[10px] uppercase font-bold text-slate-600">Desde</label>
                  <input
                    type="date" value={reportDateFrom} onChange={(e) => setReportDateFrom(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
                  />
                </div>
                <div className="flex-1 min-w-[130px] space-y-1 text-xs">
                  <label className="block text-[10px] uppercase font-bold text-slate-600">Hasta</label>
                  <input
                    type="date" value={reportDateTo} onChange={(e) => setReportDateTo(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
                  />
                </div>
                <div className="flex-1 min-w-[150px] space-y-1 text-xs">
                  <label className="block text-[10px] uppercase font-bold text-slate-600">Convenio</label>
                  <select
                    value={reportCompanyId} onChange={(e) => setReportCompanyId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
                  >
                    <option value="all">Todos</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="flex-1 min-w-[150px] space-y-1 text-xs">
                  <label className="block text-[10px] uppercase font-bold text-slate-600">Estado de cita</label>
                  <select
                    value={reportStatus} onChange={(e) => setReportStatus(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
                  >
                    <option value="all">Todos</option>
                    {APPOINTMENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex-1 min-w-[150px] space-y-1 text-xs">
                  <label className="block text-[10px] uppercase font-bold text-slate-600">Psicólogo</label>
                  <select
                    value={reportPsychologistId} onChange={(e) => setReportPsychologistId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
                  >
                    <option value="all">Todos</option>
                    {teamUsers.filter((u) => u.role === 'ESPECIALISTA_B2B').map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleExportPatientsExcel}
                  disabled={isExportingReport}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs p-2.5 px-5 rounded-lg transition-all cursor-pointer shadow-xs self-stretch sm:self-auto flex items-center justify-center gap-1.5 border border-emerald-700 disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" /> {isExportingReport ? 'Generando...' : 'Descargar Excel'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 md:p-6 space-y-4">
              <div className="border-b border-slate-100 pb-2.5">
                <h2 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center">
                  <FileCode className="w-4.5 h-4.5 mr-1.5 text-toast-500" />
                  Módulo RIPS 4.0 (SGCCC - MinSalud) para Facturación
                </h2>
                <p className="text-[11px] text-slate-400">Genera los archivos RIPS oficiales de tus consultas, listos para soportar la facturación ante las EPS.</p>
              </div>

              <div className="flex flex-col sm:flex-row items-end gap-3 bg-slate-50 p-4 rounded-xl border border-slate-150">
                <div className="flex-1 space-y-1 text-xs">
                  <label className="block text-[10px] uppercase font-bold text-slate-600">Periodo Histórico de Citas</label>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={ripsYear}
                      onChange={(e) => setRipsYear(e.target.value)}
                      disabled={ripsYearOptions.length === 0}
                      className="bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500 disabled:opacity-50"
                    >
                      {ripsYearOptions.length === 0 ? (
                        <option value="">Sin diagnósticos RIPS aún</option>
                      ) : (
                        ripsYearOptions.map((y) => <option key={y} value={y}>Año {y}</option>)
                      )}
                    </select>

                    <select
                      value={ripsMonth}
                      onChange={(e) => setRipsMonth(e.target.value)}
                      disabled={ripsMonthOptions.length === 0}
                      className="bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500 disabled:opacity-50"
                    >
                      {ripsMonthOptions.length === 0 ? (
                        <option value="">—</option>
                      ) : (
                        ripsMonthOptions.map((m) => (
                          <option key={m} value={String(m).padStart(2, '0')}>
                            {MONTH_LABELS[m]} ({String(m).padStart(2, '0')})
                          </option>
                        ))
                      )}
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

            {ripsControlPanel}

            <div className="bg-white rounded-xl border border-slate-100 shadow-xs p-5 md:p-6 space-y-4 text-left">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center">
                  <ClipboardX className="w-4 h-4 mr-1.5 text-toast-500" />
                  Ver pacientes sin Diagnósticos RIPS
                </h2>
                <p className="text-[11px] text-slate-400">Pacientes atendidos en el periodo que todavía no tienen diagnóstico RIPS asignado — agrupados por psicólogo para poder recordárselo.</p>
              </div>

              {currentUser.role !== 'CEO' && currentUser.role !== 'DIRECTIVO' ? (
                <div className="p-10 text-center text-slate-400 text-xs italic border border-dashed border-slate-200 rounded-xl">
                  Tu rol no tiene permisos para ver este panel (solo CEO/DIRECTIVO).
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-3 bg-slate-50 p-4 rounded-xl border border-slate-150">
                    <div className="space-y-1 text-xs">
                      <label className="block text-[10px] uppercase font-bold text-slate-600">Desde</label>
                      <input
                        type="date"
                        value={pendingRipsStartDate}
                        max={pendingRipsEndDate}
                        onChange={(e) => setPendingRipsStartDate(e.target.value)}
                        className="bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
                      />
                    </div>
                    <div className="space-y-1 text-xs">
                      <label className="block text-[10px] uppercase font-bold text-slate-600">Hasta</label>
                      <input
                        type="date"
                        value={pendingRipsEndDate}
                        min={pendingRipsStartDate}
                        onChange={(e) => setPendingRipsEndDate(e.target.value)}
                        className="bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
                      />
                    </div>
                    <div className="flex-1 min-w-[160px] space-y-1 text-xs">
                      <label className="block text-[10px] uppercase font-bold text-slate-600">Convenio</label>
                      <select
                        value={pendingRipsCompanyId}
                        onChange={(e) => setPendingRipsCompanyId(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 font-semibold focus:ring-2 focus:ring-toast-500"
                      >
                        <option value="all">Todos los convenios</option>
                        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <button
                      onClick={fetchPendingRipsList}
                      disabled={pendingRipsLoading}
                      className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${pendingRipsLoading ? 'animate-spin' : ''}`} /> Actualizar
                    </button>
                    <button
                      onClick={handleNotifyPendingRips}
                      disabled={pendingRipsNotifying || pendingRipsLoading || pendingRipsList.length === 0}
                      className="bg-charcoal-900 hover:bg-slate-950 text-white font-bold text-xs px-4 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ml-auto"
                      title={pendingRipsList.length === 0 ? 'No hay pacientes pendientes en este periodo' : undefined}
                    >
                      <Bell className="w-3.5 h-3.5" />
                      {pendingRipsNotifying ? 'Enviando...' : `Notificar diagnóstico RIPS de ${pendingRipsPeriodLabel}`}
                    </button>
                  </div>

                  {pendingRipsLoading ? (
                    <div className="p-10 text-center text-slate-400 text-xs italic border border-dashed border-slate-200 rounded-xl">
                      Cargando pacientes...
                    </div>
                  ) : pendingRipsList.length === 0 ? (
                    <div className="p-10 text-center text-slate-400 text-xs italic border border-dashed border-slate-200 rounded-xl">
                      Ningún paciente pendiente — todos los atendidos en este periodo ya tienen diagnóstico RIPS.
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[9px] font-mono tracking-widest">
                            <th className="p-3">Paciente</th>
                            <th className="p-3">Convenio</th>
                            <th className="p-3">Psicólogo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {pendingRipsList.map((p) => (
                            <tr key={p.id} className="hover:bg-slate-50">
                              <td className="p-3 font-semibold text-slate-900">{p.firstName} {p.lastName}</td>
                              <td className="p-3 text-slate-600">{p.corporateClient || 'Particular'}</td>
                              <td className="p-3">
                                {p.psychologist ? (
                                  <span className="text-slate-700">{p.psychologist.name}</span>
                                ) : (
                                  <span className="text-amber-600 font-semibold">Sin asignar</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {pendingRipsUnassignedCount > 0 && (
                    <p className="text-[11px] text-amber-600">
                      ⚠️ {pendingRipsUnassignedCount} paciente(s) sin psicólogo asignado — no recibirán recordatorio.
                    </p>
                  )}
                </>
              )}
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
            refetchAppointments();
          }}
        />
      </main>
    </div>
  );
}
