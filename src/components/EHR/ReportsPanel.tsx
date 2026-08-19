/**
 * ReportsPanel.tsx
 *
 * Tab "Reportes" — solo visible para el psicólogo (ESPECIALISTA_B2B) en EHR.
 * Fase 1 (acordada con el usuario): lo que un clínico revisa cada semana
 * sobre su propio caseload — sin seguimiento reciente y documentación
 * pendiente — usando datos que ya existen (Patient/Appointment/
 * ClinicalHistory/InitialAssessment/RipsDiagnosis), sin captura nueva.
 * Backend: GET /api/reports/caseload (scoped a psychologistId = caller).
 */
import { useEffect, useMemo, useState } from 'react';
// xlsx-js-style (no la 'xlsx' a secas) — es la única de las dos que sí escribe
// los estilos (fill/font/border) en el .xlsx final; con 'xlsx' plano el
// visualizador los ignora silenciosamente. Mismo paquete que ya usa
// AdminPortal.tsx para el Excel de RIPS — se replica ese mismo look acá.
import * as XLSX from 'xlsx-js-style';
import {
  Users, AlertTriangle, FileText, ClipboardList, ClipboardX,
  CalendarPlus, ChevronRight, RefreshCw, CheckCircle2, Filter, Download, CalendarRange,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import DelegatedAppointmentModal, { prefetchSelectoresAgendamiento } from '../DelegatedAppointmentModal';

interface CaseloadPatient {
  id: string;
  firstName: string;
  lastName: string;
  documentId: string;
  status: string;
  riskLevel: string;
  corporateClient?: string | null;
  lastAppointmentDate: string | null;
  nextAppointmentDate: string | null;
  daysSinceLastAppointment: number | null;
}
interface PendingDocItem {
  id: string;
  patientId: string;
  patientName: string;
  status: string;
  date?: string;
  createdAt?: string;
}
interface MissingRipsItem {
  patientId: string;
  patientName: string;
  status: string;
}
interface CaseloadReport {
  generatedAt: string;
  totals: { activo: number; pausa: number; alta: number };
  caseload: CaseloadPatient[];
  noFollowUp: CaseloadPatient[];
  pendingDocs: {
    unsignedNotes: PendingDocItem[];
    unsignedAssessments: PendingDocItem[];
    missingRipsThisMonth: MissingRipsItem[];
  };
}
interface AttendedSession {
  appointmentId: string;
  date: string;
  modality: string;
  patientId: string | null;
  patientName: string;
  documentId: string;
  corporateClient?: string | null;
}
interface AttendedReport {
  startDate: string;
  endDate: string;
  totalSessions: number;
  uniquePatients: number;
  sessions: AttendedSession[];
}

const RISK_STYLES: Record<string, string> = {
  alto: 'bg-rose-100 text-rose-700',
  medio: 'bg-amber-100 text-amber-700',
  bajo: 'bg-emerald-100 text-emerald-700',
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'activo', label: 'Activo' },
  { value: 'pausa', label: 'En pausa' },
  { value: 'alta', label: 'De alta' },
];
const STATUS_LABELS: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s.label]));

function fmtDate(value?: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Mismo look que el Excel de "Panel de Control por RIPS" en AdminPortal.tsx —
// título fusionado, subtítulo con el filtro aplicado, encabezado oscuro con
// texto blanco. Se reutiliza para los 2 reportes descargables de este panel.
const XLSX_STYLES = {
  title: { font: { bold: true, sz: 13 } },
  subtitle: { font: { italic: true, sz: 9, color: { rgb: '555555' } } },
  header: {
    fill: { fgColor: { rgb: '111111' } },
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { bottom: { style: 'thin', color: { rgb: '000000' } } },
  },
  cell: { font: { sz: 10 } },
};

function buildStyledSheet(title: string, subtitle: string, headers: string[], rows: (string | number)[][]) {
  const aoa: any[][] = [];
  aoa.push([{ v: title, s: XLSX_STYLES.title }]);
  aoa.push([{ v: subtitle, s: XLSX_STYLES.subtitle }]);
  aoa.push([]);
  aoa.push(headers.map((h) => ({ v: h, s: XLSX_STYLES.header })));
  rows.forEach((row) => aoa.push(row.map((cell) => ({ v: cell, s: XLSX_STYLES.cell }))));

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const lastCol = Math.max(headers.length - 1, 0);
  worksheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
  ];
  worksheet['!cols'] = headers.map(() => ({ wch: 22 }));
  return worksheet;
}

export default function ReportsPanel({
  token,
  onSelectPatient,
}: {
  token: string | null;
  onSelectPatient: (patientId: string) => void;
}) {
  const [report, setReport] = useState<CaseloadReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForPatient, setScheduleForPatient] = useState<CaseloadPatient | null>(null);
  // Filtro de estado — controla tanto lo que se ve en pantalla (caseload,
  // sin seguimiento, documentación pendiente) como lo que se incluye en la
  // descarga Excel, para que el archivo sea exactamente lo que el psicólogo
  // filtró y no un export "de todo" desconectado de la vista.
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(STATUS_OPTIONS.map((s) => s.value)));

  // Pacientes atendidos por rango de fecha — reporte aparte del caseload:
  // "en qué sesiones estuve" en un periodo puntual, en vez del estado actual.
  const todayISO = new Date().toISOString().slice(0, 10);
  const monthStartISO = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [attendedStartDate, setAttendedStartDate] = useState(monthStartISO);
  const [attendedEndDate, setAttendedEndDate] = useState(todayISO);
  const [attendedReport, setAttendedReport] = useState<AttendedReport | null>(null);
  const [attendedLoading, setAttendedLoading] = useState(true);

  useEffect(() => {
    prefetchSelectoresAgendamiento();
  }, []);

  const fetchReport = async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/reports/caseload');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport(await res.json());
    } catch (err) {
      console.error('[ReportsPanel] Error cargando reportes:', err);
      setError('No se pudo cargar el reporte. Intenta de nuevo.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchAttendedReport = async () => {
    if (!token) { setAttendedLoading(false); return; }
    setAttendedLoading(true);
    try {
      const params = new URLSearchParams({ startDate: attendedStartDate, endDate: attendedEndDate });
      const res = await apiFetch(`/api/reports/attended?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAttendedReport(await res.json());
    } catch (err) {
      console.error('[ReportsPanel] Error cargando pacientes atendidos:', err);
      setAttendedReport(null);
    } finally {
      setAttendedLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendedReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, attendedStartDate, attendedEndDate]);

  function downloadAttendedExcel() {
    if (!attendedReport || attendedReport.sessions.length === 0) return;
    const generatedLabel = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
    const headers = ['Fecha', 'Paciente', 'Documento', 'Convenio', 'Modalidad'];
    const rows = attendedReport.sessions.map((s) => [
      fmtDate(s.date) || '', s.patientName, s.documentId, s.corporateClient || 'Particular', s.modality || '',
    ]);
    const worksheet = buildStyledSheet(
      'Pacientes Atendidos — MindPsic',
      `Periodo: ${attendedReport.startDate} a ${attendedReport.endDate}  ·  Sesiones: ${attendedReport.totalSessions}  ·  Pacientes únicos: ${attendedReport.uniquePatients}  ·  Generado: ${generatedLabel}`,
      headers,
      rows
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Pacientes atendidos');
    XLSX.writeFile(workbook, `pacientes_atendidos_${attendedReport.startDate}_a_${attendedReport.endDate}.xlsx`);
  }

  function openScheduleFor(patient: CaseloadPatient) {
    setScheduleForPatient(patient);
    setScheduleOpen(true);
  }

  function toggleStatus(value: string) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const filteredCaseload = useMemo(
    () => (report ? report.caseload.filter((p) => statusFilter.has(p.status)) : []),
    [report, statusFilter]
  );
  const filteredNoFollowUp = useMemo(
    () => (report ? report.noFollowUp.filter((p) => statusFilter.has(p.status)) : []),
    [report, statusFilter]
  );
  const filteredPendingDocs = useMemo(() => ({
    unsignedNotes: report ? report.pendingDocs.unsignedNotes.filter((n) => statusFilter.has(n.status)) : [],
    unsignedAssessments: report ? report.pendingDocs.unsignedAssessments.filter((a) => statusFilter.has(a.status)) : [],
    missingRipsThisMonth: report ? report.pendingDocs.missingRipsThisMonth.filter((r) => statusFilter.has(r.status)) : [],
  }), [report, statusFilter]);

  const pendingDocsCount = filteredPendingDocs.unsignedNotes.length + filteredPendingDocs.unsignedAssessments.length + filteredPendingDocs.missingRipsThisMonth.length;
  const totalCaseload = report ? report.totals.activo + report.totals.pausa + report.totals.alta : 0;

  function downloadExcel() {
    if (!report) return;
    const statusLabel = STATUS_OPTIONS.filter((s) => statusFilter.has(s.value)).map((s) => s.label).join(', ') || 'ninguno';
    const generatedLabel = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
    const workbook = XLSX.utils.book_new();

    const caseloadHeaders = ['Paciente', 'Documento', 'Estado', 'Riesgo', 'Convenio', 'Última sesión', 'Próxima cita', 'Días sin sesión'];
    const caseloadRows = filteredCaseload.map((p) => [
      `${p.firstName} ${p.lastName}`, p.documentId, STATUS_LABELS[p.status] || p.status, p.riskLevel,
      p.corporateClient || 'Particular', fmtDate(p.lastAppointmentDate) || 'Nunca atendido',
      fmtDate(p.nextAppointmentDate) || 'Sin agendar', p.daysSinceLastAppointment ?? '',
    ]);
    XLSX.utils.book_append_sheet(workbook, buildStyledSheet(
      'Mi Caseload — MindPsic',
      `Filtro de estado: ${statusLabel}  ·  Total: ${filteredCaseload.length} pacientes  ·  Generado: ${generatedLabel}`,
      caseloadHeaders,
      caseloadRows.length ? caseloadRows : [['Sin pacientes para el filtro seleccionado', '', '', '', '', '', '', '']]
    ), 'Caseload');

    const noFollowUpHeaders = ['Paciente', 'Estado', 'Riesgo', 'Última sesión'];
    const noFollowUpRows = filteredNoFollowUp.map((p) => [
      `${p.firstName} ${p.lastName}`, STATUS_LABELS[p.status] || p.status, p.riskLevel,
      p.daysSinceLastAppointment === null ? 'Nunca atendido' : `Hace ${p.daysSinceLastAppointment} días (${fmtDate(p.lastAppointmentDate)})`,
    ]);
    XLSX.utils.book_append_sheet(workbook, buildStyledSheet(
      'Pacientes Sin Seguimiento Reciente — MindPsic',
      `Filtro de estado: ${statusLabel}  ·  Total: ${filteredNoFollowUp.length} pacientes  ·  Generado: ${generatedLabel}`,
      noFollowUpHeaders,
      noFollowUpRows.length ? noFollowUpRows : [['Ninguno', '', '', '']]
    ), 'Sin seguimiento');

    const pendingHeaders = ['Tipo', 'Paciente', 'Estado', 'Fecha'];
    const pendingRows = [
      ...filteredPendingDocs.unsignedNotes.map((n) => ['Nota de evolución sin firmar', n.patientName, STATUS_LABELS[n.status] || n.status, fmtDate(n.date) || '']),
      ...filteredPendingDocs.unsignedAssessments.map((a) => ['Valoración inicial sin firmar', a.patientName, STATUS_LABELS[a.status] || a.status, fmtDate(a.createdAt) || '']),
      ...filteredPendingDocs.missingRipsThisMonth.map((r) => ['Sin diagnóstico RIPS este mes', r.patientName, STATUS_LABELS[r.status] || r.status, '']),
    ];
    XLSX.utils.book_append_sheet(workbook, buildStyledSheet(
      'Documentación Clínica Pendiente — MindPsic',
      `Filtro de estado: ${statusLabel}  ·  Total: ${pendingRows.length} pendientes  ·  Generado: ${generatedLabel}`,
      pendingHeaders,
      pendingRows.length ? pendingRows : [['Ninguno', '', '', '']]
    ), 'Documentación pendiente');

    const statusSuffix = STATUS_OPTIONS.filter((s) => statusFilter.has(s.value)).map((s) => s.value).join('-') || 'ninguno';
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `reporte_caseload_${statusSuffix}_${dateStr}.xlsx`);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="text-left">
          <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Reportes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Estado de tu caseload: seguimiento de pacientes activos y documentación clínica pendiente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={fetchReport}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-charcoal-900 shadow-sm transition-colors hover:bg-toast-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 text-toast-500 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          <button
            onClick={downloadExcel}
            disabled={!report}
            className="inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-charcoal-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            <Download className="h-4 w-4" />
            Descargar Excel
          </button>
        </div>
      </div>

      {report && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
            <Filter className="h-3.5 w-3.5" />
            Filtrar por estado:
          </span>
          {STATUS_OPTIONS.map((s) => {
            const active = statusFilter.has(s.value);
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => toggleStatus(s.value)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'border-toast-400 bg-toast-100 text-toast-500'
                    : 'border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100'
                }`}
              >
                {s.label} ({report.totals[s.value as keyof typeof report.totals]})
              </button>
            );
          })}
        </div>
      )}

      {loading && !report && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400 shadow-sm">
          Cargando reporte...
        </div>
      )}

      {error && !loading && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      )}

      {report && (
        <>
          {/* KPIs */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ReportKpiCard icon={Users} label="Caseload total" value={totalCaseload} tone="charcoal" />
            <ReportKpiCard icon={CheckCircle2} label="Activos" value={report.totals.activo} tone="emerald" />
            <ReportKpiCard
              icon={AlertTriangle}
              label="Sin seguimiento"
              value={filteredNoFollowUp.length}
              tone={filteredNoFollowUp.length > 0 ? 'amber' : 'charcoal'}
            />
            <ReportKpiCard
              icon={ClipboardX}
              label="Documentación pendiente"
              value={pendingDocsCount}
              tone={pendingDocsCount > 0 ? 'amber' : 'charcoal'}
            />
          </div>

          {/* Sin seguimiento reciente */}
          <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-bold text-charcoal-900">Pacientes sin seguimiento reciente</h2>
              <span className="text-xs text-slate-400">(activos, sin cita futura y sin sesión atendida hace más de 30 días)</span>
            </div>
            {filteredNoFollowUp.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">
                {report.noFollowUp.length === 0 ? 'Todos tus pacientes activos tienen seguimiento al día.' : 'Ningún paciente en este estado tiene alertas de seguimiento.'}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100">
                {filteredNoFollowUp.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onSelectPatient(p.id)}
                        className="font-semibold text-charcoal-900 hover:underline cursor-pointer"
                      >
                        {p.firstName} {p.lastName}
                      </button>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${RISK_STYLES[p.riskLevel] || 'bg-slate-100 text-slate-500'}`}
                        >
                          Riesgo {p.riskLevel}
                        </span>
                        <span>
                          {p.daysSinceLastAppointment === null
                            ? 'Nunca atendido'
                            : `Última sesión hace ${p.daysSinceLastAppointment} días (${fmtDate(p.lastAppointmentDate)})`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => openScheduleFor(p)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-charcoal-900 transition-colors hover:bg-toast-50 cursor-pointer"
                      >
                        <CalendarPlus className="h-3.5 w-3.5 text-toast-500" />
                        Agendar
                      </button>
                      <button
                        onClick={() => onSelectPatient(p.id)}
                        title="Ver historia clínica"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-charcoal-900 cursor-pointer"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Documentación pendiente */}
          <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-3 flex items-center gap-2">
              <ClipboardX className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-bold text-charcoal-900">Documentación clínica pendiente</h2>
            </div>

            <PendingDocGroup
              icon={FileText}
              title="Notas de evolución sin firmar"
              emptyLabel="No tienes notas en borrador."
              items={filteredPendingDocs.unsignedNotes.map((n) => ({
                key: n.id,
                patientId: n.patientId,
                label: n.patientName,
                detail: fmtDate(n.date),
              }))}
              onSelect={onSelectPatient}
            />
            <PendingDocGroup
              icon={ClipboardList}
              title="Valoraciones iniciales sin firmar"
              emptyLabel="No tienes valoraciones en borrador."
              items={filteredPendingDocs.unsignedAssessments.map((a) => ({
                key: a.id,
                patientId: a.patientId,
                label: a.patientName,
                detail: fmtDate(a.createdAt),
              }))}
              onSelect={onSelectPatient}
            />
            <PendingDocGroup
              icon={ClipboardX}
              title="Sin diagnóstico RIPS este mes"
              emptyLabel="Todos tus pacientes atendidos este mes tienen diagnóstico RIPS."
              items={filteredPendingDocs.missingRipsThisMonth.map((r) => ({
                key: r.patientId,
                patientId: r.patientId,
                label: r.patientName,
              }))}
              onSelect={onSelectPatient}
              last
            />
          </div>

          {/* Caseload completo */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="mb-3 text-sm font-bold text-charcoal-900">Mi caseload</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2.5 font-semibold">Paciente</th>
                    <th className="px-3 py-2.5 font-semibold">Estado</th>
                    <th className="px-3 py-2.5 font-semibold">Última sesión</th>
                    <th className="px-3 py-2.5 font-semibold">Próxima cita</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCaseload.map((p) => (
                    <tr key={p.id} onClick={() => onSelectPatient(p.id)} className="cursor-pointer transition-colors hover:bg-toast-50/40">
                      <td className="px-3 py-3 font-semibold text-charcoal-900">{p.firstName} {p.lastName}</td>
                      <td className="px-3 py-3 text-slate-500 capitalize">{p.status}</td>
                      <td className="px-3 py-3 text-slate-500">{fmtDate(p.lastAppointmentDate) || '—'}</td>
                      <td className="px-3 py-3 text-slate-500">{fmtDate(p.nextAppointmentDate) || '—'}</td>
                    </tr>
                  ))}
                  {filteredCaseload.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-sm text-slate-400">
                        {report.caseload.length === 0 ? 'Aún no tienes pacientes asignados.' : 'Ningún paciente coincide con el filtro seleccionado.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Pacientes atendidos por rango de fecha */}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-toast-500" />
            <h2 className="text-sm font-bold text-charcoal-900">Pacientes atendidos</h2>
            <span className="text-xs text-slate-400">verifica tus sesiones atendidas en un mes o rango de fechas</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={attendedStartDate}
              max={attendedEndDate}
              onChange={(e) => setAttendedStartDate(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white"
            />
            <span className="text-xs text-slate-400">a</span>
            <input
              type="date"
              value={attendedEndDate}
              min={attendedStartDate}
              max={todayISO}
              onChange={(e) => setAttendedEndDate(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white"
            />
            <button
              onClick={fetchAttendedReport}
              disabled={attendedLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-charcoal-900 transition-colors hover:bg-toast-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-toast-500 ${attendedLoading ? 'animate-spin' : ''}`} />
              Buscar
            </button>
            <button
              onClick={downloadAttendedExcel}
              disabled={!attendedReport || attendedReport.sessions.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-charcoal-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-charcoal-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Descargar Excel
            </button>
          </div>
        </div>

        {attendedLoading ? (
          <p className="py-6 text-center text-sm text-slate-400">Cargando...</p>
        ) : !attendedReport || attendedReport.sessions.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No tuviste sesiones atendidas en este rango.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-500">
              <span><strong className="text-charcoal-900">{attendedReport.totalSessions}</strong> sesiones atendidas</span>
              <span><strong className="text-charcoal-900">{attendedReport.uniquePatients}</strong> pacientes únicos</span>
            </div>
            <div className="max-h-80 overflow-y-auto overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2.5 font-semibold">Fecha</th>
                    <th className="px-3 py-2.5 font-semibold">Paciente</th>
                    <th className="px-3 py-2.5 font-semibold">Documento</th>
                    <th className="px-3 py-2.5 font-semibold">Convenio</th>
                    <th className="px-3 py-2.5 font-semibold">Modalidad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attendedReport.sessions.map((s) => (
                    <tr
                      key={s.appointmentId}
                      onClick={s.patientId ? () => onSelectPatient(s.patientId as string) : undefined}
                      className={`transition-colors hover:bg-toast-50/40 ${s.patientId ? 'cursor-pointer' : ''}`}
                    >
                      <td className="px-3 py-3 text-slate-500">{fmtDate(s.date)}</td>
                      <td className="px-3 py-3 font-semibold text-charcoal-900">{s.patientName}</td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-500">{s.documentId}</td>
                      <td className="px-3 py-3 text-slate-500">{s.corporateClient || 'Particular'}</td>
                      <td className="px-3 py-3 text-slate-500 capitalize">{s.modality?.toLowerCase() || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <DelegatedAppointmentModal
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        initialData={scheduleForPatient ? { patient: scheduleForPatient, patientId: scheduleForPatient.id } : undefined}
        onSuccess={() => {
          setScheduleOpen(false);
          fetchReport();
        }}
      />
    </div>
  );
}

const KPI_TONES: Record<string, string> = {
  charcoal: 'bg-charcoal-100 text-charcoal-900',
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
};

function ReportKpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: keyof typeof KPI_TONES;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${KPI_TONES[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none text-charcoal-900">{value}</p>
        <p className="mt-1 text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function PendingDocGroup({
  icon: Icon,
  title,
  emptyLabel,
  items,
  onSelect,
  last,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  emptyLabel: string;
  items: { key: string; patientId: string; label: string; detail?: string | null }[];
  onSelect: (patientId: string) => void;
  last?: boolean;
}) {
  return (
    <div className={last ? '' : 'mb-4 border-b border-slate-100 pb-4'}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        {title}
        <span className="text-slate-400">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onSelect(item.patientId)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-charcoal-900 transition-colors hover:bg-slate-50 cursor-pointer"
              >
                <span>{item.label}</span>
                {item.detail && <span className="text-xs text-slate-400">{item.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
