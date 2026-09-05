/**
 * BulkImportPatientsModal.tsx
 *
 * Carga masiva de pacientes desde una plantilla Excel. Todo o nada — si
 * cualquier fila falla cualquier validación (local o del backend), no se
 * importa NINGÚN paciente; se muestra la lista completa de errores para
 * corregir el archivo y reintentar.
 *
 * El convenio se elige UNA vez, antes de descargar la plantilla, y aplica a
 * todo el lote — por eso la plantilla no trae columna "Convenio".
 *
 * Nota técnica: xlsx-js-style (SheetJS Community Edition) no soporta escribir
 * validación de datos nativa de Excel (listas desplegables reales en la
 * celda) — por eso la plantilla usa una hoja "Instrucciones" con los valores
 * válidos exactos en vez de un <select> nativo del archivo. La validación
 * real ocurre igual, solo que al momento de importar, no al escribir la celda.
 *
 * Endpoints consumidos:
 *   GET  /api/users/specialists    → Psicólogos del tenant (para la hoja de instrucciones)
 *   POST /api/patients/bulk-import → Validación + creación atómica del lote
 */
import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import { X, Download, Upload, Loader2, AlertTriangle, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useCompanies } from '../../hooks/useCompanies';
import { PATIENT_STATUS_LABELS } from './CreatePatientModal';

interface SpecialistOption {
  id: string;
  name: string;
}

interface AgreementTypeOption {
  id: string;
  name: string;
}

interface RowError {
  row: number;
  field: string;
  message: string;
}

interface ParsedRow {
  firstName: string;
  lastName: string;
  documentType: string;
  documentId: string;
  birthDate: string;
  phone: string;
  estrato: string;
  status: string;
  email: string;
  emergencyContactNombres: string;
  emergencyContactApellidos: string;
  emergencyContactTelefono: string;
  emergencyContactParentesco: string;
  psychologistId: string | null;
  agreementType: string;
  relacion: string;
  tipoAtencion: string;
  fechaSolicitud: string;
  fechaAgendamiento: string;
  fechaFinalizacion: string;
  sessionsAuthorized: string;
}

interface BulkImportPatientsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (count: number) => void;
}

const SIN_ASIGNAR_LABEL = 'Sin asignar (se define después)';

// Mismo subconjunto que valida el backend (BULK_IMPORT_STATUS_VALUES) —
// "agendado"/"finalizado" quedan fuera a propósito, el sistema los asigna solo.
const BULK_STATUS_KEYS = ['notificado_1', 'notificado_2', 'notificado_3', 'notificado_4', 'anulado', 'activo', 'alta', 'pausa'];

const PARENTESCO_OPTIONS = ['Madre', 'Padre', 'Hermano/a', 'Cónyuge / Pareja', 'Hijo/a', 'Abuelo/a', 'Tutor legal', 'Otro'];
// Mismos catálogos fijos que CreatePatientModal — deben coincidir EXACTAMENTE
// con PATIENT_RELACION_VALUES/PATIENT_TIPO_ATENCION_VALUES en el backend.
const RELACION_OPTIONS = ['Estudiante', 'Colaborador', 'Familiar de colaborador', 'Familiar de estudiante', 'Consultante'];
const TIPO_ATENCION_LABEL_TO_VALUE: Record<string, string> = {
  'presencial': 'Presencial',
  'telepsicología': 'Telepsicologia',
  'telepsicologia': 'Telepsicologia',
};
const TIPO_ATENCION_LABELS = ['Presencial', 'Telepsicología'];
const LIBRES_LABEL = 'Libres';

const COL_NOMBRES = 'Nombres';
const COL_APELLIDOS = 'Apellidos';
const COL_TIPO_DOC = 'Tipo de documento (CC/TI/PEP/PA/CE)';
const COL_NUM_DOC = 'Número de documento';
const COL_FECHA_NAC = 'Fecha de nacimiento (dd/mm/aaaa)';
const COL_TEL = 'Teléfono (10 dígitos)';
const COL_ESTRATO = 'Estrato (1-6)';
const COL_ESTADO = 'Estado de contacto';
const COL_EMAIL = 'Correo electrónico';
const COL_EC_NOMBRES = 'Contacto de emergencia - Nombres';
const COL_EC_APELLIDOS = 'Contacto de emergencia - Apellidos';
const COL_EC_TEL = 'Contacto de emergencia - Teléfono';
const COL_EC_PARENTESCO = 'Contacto de emergencia - Parentesco';
const COL_PSICOLOGO = 'Psicólogo asignado';
const COL_TIPO_CONVENIO = 'Tipo de convenio';
const COL_RELACION = 'Relación';
const COL_TIPO_ATENCION = 'Tipo de atención';
const COL_FECHA_SOLICITUD = 'Fecha de solicitud (dd/mm/aaaa)';
const COL_FECHA_AGENDAMIENTO = 'Fecha de agendamiento (dd/mm/aaaa)';
const COL_FECHA_FINALIZACION = 'Fecha de finalización (dd/mm/aaaa)';
const COL_SESIONES_APROBADAS = 'Sesiones aprobadas (número o "Libres")';

const COLUMN_HEADERS = [
  COL_NOMBRES, COL_APELLIDOS, COL_TIPO_DOC, COL_NUM_DOC, COL_FECHA_NAC, COL_TEL, COL_ESTRATO,
  COL_ESTADO, COL_EMAIL, COL_EC_NOMBRES, COL_EC_APELLIDOS, COL_EC_TEL, COL_EC_PARENTESCO, COL_PSICOLOGO,
  COL_TIPO_CONVENIO, COL_RELACION, COL_TIPO_ATENCION,
  COL_FECHA_SOLICITUD, COL_FECHA_AGENDAMIENTO, COL_FECHA_FINALIZACION, COL_SESIONES_APROBADAS,
];

function statusLabelToKey(label: string): string | null {
  const normalized = label.trim().toLowerCase();
  const entry = Object.entries(PATIENT_STATUS_LABELS).find(
    ([key, value]) => BULK_STATUS_KEYS.includes(key) && value.toLowerCase() === normalized
  );
  return entry ? entry[0] : null;
}

export default function BulkImportPatientsModal({ isOpen, onClose, onImported }: BulkImportPatientsModalProps) {
  const { companies } = useCompanies();
  const [companyId, setCompanyId] = useState('');
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [agreementTypes, setAgreementTypes] = useState<AgreementTypeOption[]>([]);
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[] | null>(null);
  const [clientErrors, setClientErrors] = useState<RowError[]>([]);
  const [serverErrors, setServerErrors] = useState<RowError[]>([]);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    apiFetch('/api/users/specialists')
      .then(res => res.ok ? res.json() : [])
      .then(data => setSpecialists(Array.isArray(data?.specialists) ? data.specialists : Array.isArray(data) ? data : []))
      .catch(() => setSpecialists([]));
  }, [isOpen]);

  // Propio de CADA convenio (companyId) — no un catálogo compartido de todo
  // el tenant, ver comentario en schema.prisma. Se recarga cada vez que
  // cambia el convenio del lote elegido arriba; "Particular (sin convenio)"
  // (companyId vacío) no tiene catálogo propio que mostrar.
  useEffect(() => {
    if (!isOpen || !companyId) { setAgreementTypes([]); return; }
    apiFetch(`/api/agreement-types?companyId=${companyId}`)
      .then(res => res.ok ? res.json() : [])
      .then(data => setAgreementTypes(Array.isArray(data) ? data : []))
      .catch(() => setAgreementTypes([]));
  }, [isOpen, companyId]);

  function reset() {
    setCompanyId('');
    setFileName('');
    setParsedRows(null);
    setClientErrors([]);
    setServerErrors([]);
    setGeneralError(null);
    setSuccessCount(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleDownloadTemplate() {
    const selectedCompanyName = companyId ? (companies.find(c => c.id === companyId)?.name || 'Particular') : 'Particular (sin convenio)';

    const wb = XLSX.utils.book_new();

    const exampleRow = [
      'Juan', 'Pérez', 'CC', '1024556778', '15/03/1990', '3132220587', '3',
      'Notificado 1°vez', 'juan@correo.com', 'María', 'Pérez', '3132220587', 'Madre',
      SIN_ASIGNAR_LABEL,
      '', 'Estudiante', 'Presencial', '02/09/2026', '', '', '8',
    ];
    const ws = XLSX.utils.aoa_to_sheet([COLUMN_HEADERS, exampleRow]);
    ws['!cols'] = COLUMN_HEADERS.map(() => ({ wch: 28 }));
    COLUMN_HEADERS.forEach((_, i) => {
      const ref = XLSX.utils.encode_cell({ r: 0, c: i });
      if (ws[ref]) {
        ws[ref].s = {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '1C1917' } },
        };
      }
    });
    XLSX.utils.book_append_sheet(wb, ws, 'Pacientes');

    const statusValues = BULK_STATUS_KEYS.map(k => PATIENT_STATUS_LABELS[k]).join(' / ');
    const psicologoNames = [SIN_ASIGNAR_LABEL, ...specialists.map(s => s.name)];
    const tipoConvenioNames = agreementTypes.map(t => t.name);
    const instructions: (string | number)[][] = [
      ['Instrucciones para llenar la plantilla'],
      [''],
      [`Este archivo se importará bajo el convenio: ${selectedCompanyName}`],
      ['Escribe los valores EXACTAMENTE como aparecen aquí (respeta mayúsculas y tildes) — el importador los compara así.'],
      [''],
      ['Campo', 'Obligatorio', 'Valores válidos'],
      [COL_NOMBRES, 'Sí', 'Solo letras'],
      [COL_APELLIDOS, 'Sí', 'Solo letras'],
      [COL_TIPO_DOC, 'Sí', 'CC / TI / PEP / PA / CE'],
      [COL_NUM_DOC, 'Sí', 'Solo números, máximo 10 dígitos, sin duplicados'],
      [COL_FECHA_NAC, 'No', 'Formato dd/mm/aaaa'],
      [COL_TEL, 'No', 'Exactamente 10 dígitos si se llena'],
      [COL_ESTRATO, 'No', 'Número entero entre 1 y 6'],
      [COL_ESTADO, 'Sí', statusValues],
      [COL_EMAIL, 'No', 'Formato válido (ej. nombre@dominio.com)'],
      [COL_EC_NOMBRES, 'No', 'Solo letras'],
      [COL_EC_APELLIDOS, 'No', 'Solo letras'],
      [COL_EC_TEL, 'No', 'Exactamente 10 dígitos si se llena'],
      [COL_EC_PARENTESCO, 'No', PARENTESCO_OPTIONS.join(' / ')],
      [COL_PSICOLOGO, 'No', `Nombre exacto de la lista de abajo, o "${SIN_ASIGNAR_LABEL}"`],
      [COL_TIPO_CONVENIO, 'No', tipoConvenioNames.length > 0 ? 'Nombre exacto de la lista de abajo' : 'Este convenio todavía no tiene tipos configurados'],
      [COL_RELACION, 'No', RELACION_OPTIONS.join(' / ')],
      [COL_TIPO_ATENCION, 'No', TIPO_ATENCION_LABELS.join(' / ')],
      [COL_FECHA_SOLICITUD, 'No', 'Formato dd/mm/aaaa — si se deja vacía, se usa la fecha de hoy'],
      [COL_FECHA_AGENDAMIENTO, 'No', 'Formato dd/mm/aaaa — normalmente se deja vacía, la completa el sistema al agendar la primera cita'],
      [COL_FECHA_FINALIZACION, 'No', 'Formato dd/mm/aaaa — normalmente se deja vacía, la completa el sistema al cerrar el proceso'],
      [COL_SESIONES_APROBADAS, 'No', 'Un número entero mayor a 0, o "Libres" (sin tope) — abre el cupo inicial del paciente con el convenio del lote'],
      [''],
      ['Psicólogos disponibles en tu clínica:'],
      ...psicologoNames.map(n => [n]),
      [''],
      [`Tipos de convenio disponibles en ${selectedCompanyName}:`],
      ...(tipoConvenioNames.length > 0 ? tipoConvenioNames.map(n => [n]) : [['(ninguno configurado — deja la columna vacía)']]),
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
    wsInstr['!cols'] = [{ wch: 45 }, { wch: 14 }, { wch: 65 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');

    XLSX.writeFile(wb, `plantilla-pacientes-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // Misma lógica de parseo dd/mm/aaaa que ya usaba solo COL_FECHA_NAC — ahora
  // reutilizada para las tres fechas del proceso, que llegan en el mismo
  // formato de celda (texto "dd/mm/aaaa" o Date real si Excel lo autodetectó).
  function parseDateCell(raw: any, rowNumber: number, field: string, label: string, errors: RowError[]): string {
    if (raw instanceof Date) return raw.toISOString().slice(0, 10);
    if (typeof raw === 'string' && raw.trim()) {
      const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      errors.push({ row: rowNumber, field, message: `${label} debe tener formato dd/mm/aaaa.` });
    }
    return '';
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setGeneralError(null);
    setServerErrors([]);
    setSuccessCount(null);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets['Pacientes'] || wb.Sheets[wb.SheetNames[0]];
      const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (raw.length === 0) {
        setGeneralError('El archivo no tiene filas para importar.');
        setParsedRows(null);
        return;
      }

      const specialistByName = new Map(specialists.map(s => [s.name.trim().toLowerCase(), s.id]));
      const agreementTypeByName = new Map(agreementTypes.map(t => [t.name.trim().toLowerCase(), t.name]));
      const errors: RowError[] = [];

      const rows: ParsedRow[] = raw.map((r, idx) => {
        const rowNumber = idx + 2;

        const psicologoRaw = String(r[COL_PSICOLOGO] || '').trim();
        let psychologistId: string | null = null;
        if (psicologoRaw && psicologoRaw.toLowerCase() !== SIN_ASIGNAR_LABEL.toLowerCase()) {
          const match = specialistByName.get(psicologoRaw.toLowerCase());
          if (!match) {
            errors.push({ row: rowNumber, field: 'psychologistId', message: `Psicólogo "${psicologoRaw}" no reconocido — usa el nombre exacto de la hoja Instrucciones.` });
          } else {
            psychologistId = match;
          }
        }

        const estadoRaw = String(r[COL_ESTADO] || '').trim();
        let status = '';
        if (estadoRaw) {
          const key = statusLabelToKey(estadoRaw);
          if (!key) {
            errors.push({ row: rowNumber, field: 'status', message: `Estado "${estadoRaw}" no reconocido — usa uno de los valores exactos de la hoja Instrucciones.` });
          } else {
            status = key;
          }
        }

        const birthDate = parseDateCell(r[COL_FECHA_NAC], rowNumber, 'birthDate', 'Fecha de nacimiento', errors);

        const tipoConvenioRaw = String(r[COL_TIPO_CONVENIO] || '').trim();
        let agreementType = '';
        if (tipoConvenioRaw) {
          const match = agreementTypeByName.get(tipoConvenioRaw.toLowerCase());
          if (!match) {
            errors.push({ row: rowNumber, field: 'agreementType', message: `Tipo de convenio "${tipoConvenioRaw}" no reconocido — usa el nombre exacto de la hoja Instrucciones.` });
          } else {
            agreementType = match;
          }
        }

        const relacion = String(r[COL_RELACION] || '').trim();
        if (relacion && !RELACION_OPTIONS.includes(relacion)) {
          errors.push({ row: rowNumber, field: 'relacion', message: `Relación "${relacion}" no reconocida — usa uno de los valores exactos de la hoja Instrucciones.` });
        }

        const tipoAtencionRaw = String(r[COL_TIPO_ATENCION] || '').trim();
        let tipoAtencion = '';
        if (tipoAtencionRaw) {
          const match = TIPO_ATENCION_LABEL_TO_VALUE[tipoAtencionRaw.toLowerCase()];
          if (!match) {
            errors.push({ row: rowNumber, field: 'tipoAtencion', message: `Tipo de atención "${tipoAtencionRaw}" no reconocido — usa uno de los valores exactos de la hoja Instrucciones.` });
          } else {
            tipoAtencion = match;
          }
        }

        const fechaSolicitud = parseDateCell(r[COL_FECHA_SOLICITUD], rowNumber, 'fechaSolicitud', 'Fecha de solicitud', errors);
        const fechaAgendamiento = parseDateCell(r[COL_FECHA_AGENDAMIENTO], rowNumber, 'fechaAgendamiento', 'Fecha de agendamiento', errors);
        const fechaFinalizacion = parseDateCell(r[COL_FECHA_FINALIZACION], rowNumber, 'fechaFinalizacion', 'Fecha de finalización', errors);

        const sesionesRaw = String(r[COL_SESIONES_APROBADAS] || '').trim();
        let sessionsAuthorized = '';
        if (sesionesRaw) {
          if (sesionesRaw.toLowerCase() === LIBRES_LABEL.toLowerCase()) {
            sessionsAuthorized = LIBRES_LABEL;
          } else {
            const n = Number(sesionesRaw);
            if (!Number.isInteger(n) || n <= 0) {
              errors.push({ row: rowNumber, field: 'sessionsAuthorized', message: `Sesiones aprobadas debe ser un número entero mayor a 0, o "${LIBRES_LABEL}".` });
            } else {
              sessionsAuthorized = String(n);
            }
          }
        }

        return {
          firstName: String(r[COL_NOMBRES] || '').trim(),
          lastName: String(r[COL_APELLIDOS] || '').trim(),
          documentType: String(r[COL_TIPO_DOC] || '').trim().toUpperCase(),
          documentId: String(r[COL_NUM_DOC] || '').trim(),
          birthDate,
          phone: String(r[COL_TEL] || '').trim(),
          estrato: String(r[COL_ESTRATO] || '').trim(),
          status,
          email: String(r[COL_EMAIL] || '').trim(),
          emergencyContactNombres: String(r[COL_EC_NOMBRES] || '').trim(),
          emergencyContactApellidos: String(r[COL_EC_APELLIDOS] || '').trim(),
          emergencyContactTelefono: String(r[COL_EC_TEL] || '').trim(),
          emergencyContactParentesco: String(r[COL_EC_PARENTESCO] || '').trim(),
          psychologistId,
          agreementType,
          relacion,
          tipoAtencion,
          fechaSolicitud,
          fechaAgendamiento,
          fechaFinalizacion,
          sessionsAuthorized,
        };
      });

      setParsedRows(rows);
      setClientErrors(errors);
    } catch {
      setGeneralError('No se pudo leer el archivo. Verifica que sea un .xlsx generado con "Descargar plantilla".');
      setParsedRows(null);
    } finally {
      e.target.value = '';
    }
  }

  async function handleImport() {
    if (!parsedRows || parsedRows.length === 0) return;
    setSubmitting(true);
    setGeneralError(null);
    setServerErrors([]);
    try {
      const res = await apiFetch('/api/patients/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ companyId: companyId || undefined, rows: parsedRows }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.errors)) {
          setServerErrors(data.errors);
        } else {
          setGeneralError(data.error || `HTTP ${res.status}`);
        }
        return;
      }
      setSuccessCount(data.count);
      onImported(data.count);
    } catch {
      setGeneralError('No se pudo contactar el servidor.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  const allErrors = [...clientErrors, ...serverErrors].sort((a, b) => a.row - b.row);
  const canImport = !!parsedRows && parsedRows.length > 0 && allErrors.length === 0 && successCount === null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs sm:p-6">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-charcoal-900">Cargar pacientes masivamente</h2>
            <p className="mt-0.5 text-sm text-slate-500">Descarga la plantilla, complétala y súbela — se valida todo antes de importar.</p>
          </div>
          <button
            onClick={handleClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-charcoal-900 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          {/* Paso 1: convenio + plantilla */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              1. Convenio / Cliente corporativo del lote
            </label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none transition-colors focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
            >
              <option value="">Particular (sin convenio)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="mt-1 text-[10.5px] text-slate-400">Todo el lote se importa bajo este convenio — por eso la plantilla no trae una columna aparte para elegirlo fila por fila.</p>
          </div>

          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-charcoal-900 shadow-sm transition-colors hover:bg-toast-50 cursor-pointer"
          >
            <Download className="h-4 w-4 text-toast-500" />
            Descargar plantilla (.xlsx)
          </button>

          {/* Paso 2: subir archivo */}
          <div className="border-t border-slate-100 pt-4">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              2. Subir plantilla completa
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500 transition-colors hover:border-toast-400 hover:bg-toast-50/40">
              <Upload className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate">{fileName || 'Selecciona el archivo .xlsx completado...'}</span>
              <input type="file" accept=".xlsx,.xls" onChange={handleFileChange} className="hidden" />
            </label>
          </div>

          {generalError && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{generalError}</p>
          )}

          {parsedRows && allErrors.length === 0 && successCount === null && (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              <FileSpreadsheet className="h-4 w-4 shrink-0" />
              {parsedRows.length} fila(s) listas para importar.
            </p>
          )}

          {allErrors.length > 0 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {allErrors.length} error(es) encontrados — no se importó ningún paciente. Corrige el archivo y vuelve a subirlo.
              </p>
              <div className="max-h-52 overflow-y-auto rounded-md border border-rose-100 bg-white">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-rose-50 text-left text-rose-800">
                    <tr>
                      <th className="px-2 py-1.5 font-semibold">Fila</th>
                      <th className="px-2 py-1.5 font-semibold">Campo</th>
                      <th className="px-2 py-1.5 font-semibold">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rose-50">
                    {allErrors.map((err, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1.5 font-mono text-rose-700">{err.row}</td>
                        <td className="px-2 py-1.5 text-rose-700">{err.field}</td>
                        <td className="px-2 py-1.5 text-slate-600">{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {successCount !== null && (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {successCount} paciente(s) importado(s) correctamente.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-500 transition-colors hover:text-charcoal-900 cursor-pointer"
          >
            {successCount !== null ? 'Cerrar' : 'Cancelar'}
          </button>
          {successCount === null && (
            <button
              type="button"
              onClick={handleImport}
              disabled={!canImport || submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-charcoal-800 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {submitting ? 'Importando...' : 'Importar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
