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
 * Nota técnica sobre selects reales en las celdas: xlsx-js-style (SheetJS
 * Community Edition) NO soporta ESCRIBIR validación de datos de Excel — solo
 * sabe leerla de archivos ya existentes (confirmado inspeccionando su bundle:
 * el único código que toca "dataValidation" está en el parser del formato
 * XML legado, no en el escritor del .xlsx moderno). Por eso la plantilla se
 * genera con `exceljs` (sí soporta escribir listas desplegables reales),
 * mientras que la LECTURA del archivo subido sigue usando xlsx-js-style, que
 * ya funcionaba bien para eso.
 *
 * Los selects de catálogo (Departamento, Ciudad/Municipio, EPS, Estado civil,
 * etc.) viven en una hoja oculta "Listas" con rangos con nombre — Ciudad
 * depende de Departamento vía una fórmula INDIRECT(SUSTITUIR(...)), replicando
 * en Excel la misma cascada que ya hace el <select> del modal individual.
 *
 * Endpoints consumidos:
 *   GET  /api/users/specialists    → Psicólogos del tenant (para el select)
 *   GET  /api/eps?limit=100        → Catálogo de EPS completo (28 entradas, cabe entero)
 *   POST /api/patients/bulk-import → Validación + creación atómica del lote
 */
import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import ExcelJS from 'exceljs';
import { X, Download, Upload, Loader2, AlertTriangle, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useCompanies } from '../../hooks/useCompanies';
import { PATIENT_STATUS_LABELS } from './CreatePatientModal';
import { COLOMBIA_DEPARTAMENTOS, DEPARTAMENTOS_ORDENADOS } from '../../data/colombiaData';

interface SpecialistOption {
  id: string;
  name: string;
}

interface AgreementTypeOption {
  id: string;
  name: string;
}

interface EpsOption {
  code: string;
  nombre: string;
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
  sexoBiologico: string;
  genero: string;
  estadoCivil: string;
  departamentoNacimiento: string;
  ciudadNacimiento: string;
  phone: string;
  email: string;
  epsCodigo: string;
  regimenSalud: string;
  estrato: string;
  direccionResidencia: string;
  departamentoResidencia: string;
  ciudadResidencia: string;
  barrio: string;
  status: string;
  emergencyContactNombres: string;
  emergencyContactApellidos: string;
  emergencyContactTelefono: string;
  emergencyContactParentesco: string;
  requiereRepresentanteLegal: boolean;
  legalRep1Nombres: string;
  legalRep1Apellidos: string;
  legalRep1Telefono: string;
  legalRep1Parentesco: string;
  legalRep1Correo: string;
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

// Mismos catálogos fijos que CreatePatientModal — deben coincidir EXACTAMENTE
// con los que valida el backend (BULK_IMPORT_* en patient.controller.js).
const PARENTESCO_OPTIONS = ['Madre', 'Padre', 'Hermano/a', 'Cónyuge / Pareja', 'Hijo/a', 'Abuelo/a', 'Tutor legal', 'Otro'];
const RELACION_OPTIONS = ['Estudiante', 'Colaborador', 'Familiar de colaborador', 'Familiar de estudiante', 'Consultante'];
const TIPO_ATENCION_LABEL_TO_VALUE: Record<string, string> = {
  'presencial': 'Presencial',
  'telepsicología': 'Telepsicologia',
  'telepsicologia': 'Telepsicologia',
};
const TIPO_ATENCION_LABELS = ['Presencial', 'Telepsicología'];
const DOCUMENT_TYPE_OPTIONS = ['CC', 'TI', 'PEP', 'PA', 'CE'];
const SEXO_OPTIONS = ['Hombre', 'Mujer', 'Intersexual'];
const GENERO_OPTIONS = ['Masculino', 'Femenino', 'Intersexual'];
const ESTADO_CIVIL_OPTIONS = ['Soltero/a', 'Casado/a', 'Unión libre', 'Viudo/a', 'Divorciado/a'];
const REGIMEN_OPTIONS = ['Contributivo', 'Subsidiado', 'Especial — Fuerzas Militares, Policía Nacional, entre otros', 'Excepcional — PPL, entre otros'];
const SI_NO_OPTIONS = ['Sí', 'No'];
const LIBRES_LABEL = 'Libres';

const COL_NOMBRES = 'Nombres';
const COL_APELLIDOS = 'Apellidos';
const COL_TIPO_DOC = 'Tipo de documento';
const COL_NUM_DOC = 'Número de documento';
const COL_FECHA_NAC = 'Fecha de nacimiento (dd/mm/aaaa)';
const COL_SEXO_BIO = 'Sexo biológico';
const COL_GENERO = 'Género';
const COL_ESTADO_CIVIL = 'Estado civil';
const COL_DEP_NACIMIENTO = 'Lugar de nacimiento - Departamento';
const COL_CIUDAD_NACIMIENTO = 'Lugar de nacimiento - Ciudad/Municipio';
const COL_TEL = 'Teléfono (10 dígitos)';
const COL_EMAIL = 'Correo electrónico';
const COL_EPS = 'EPS';
const COL_REGIMEN = 'Régimen de salud';
const COL_ESTRATO = 'Estrato (1-6)';
const COL_DIRECCION_RESIDENCIA = 'Dirección de residencia';
const COL_DEP_RESIDENCIA = 'Residencia - Departamento';
const COL_CIUDAD_RESIDENCIA = 'Residencia - Ciudad/Municipio';
const COL_BARRIO = 'Barrio';
const COL_ESTADO = 'Estado de contacto';
const COL_EC_NOMBRES = 'Contacto de emergencia - Nombres';
const COL_EC_APELLIDOS = 'Contacto de emergencia - Apellidos';
const COL_EC_TEL = 'Contacto de emergencia - Teléfono';
const COL_EC_PARENTESCO = 'Contacto de emergencia - Parentesco';
const COL_REQUIERE_REP_LEGAL = '¿Requiere representante legal?';
const COL_REP_NOMBRES = 'Representante legal - Nombres';
const COL_REP_APELLIDOS = 'Representante legal - Apellidos';
const COL_REP_TEL = 'Representante legal - Teléfono';
const COL_REP_PARENTESCO = 'Representante legal - Parentesco';
const COL_REP_CORREO = 'Representante legal - Correo';
const COL_PSICOLOGO = 'Psicólogo asignado';
const COL_TIPO_CONVENIO = 'Tipo de convenio';
const COL_RELACION = 'Relación';
const COL_TIPO_ATENCION = 'Tipo de atención';
const COL_FECHA_SOLICITUD = 'Fecha de solicitud (dd/mm/aaaa)';
const COL_FECHA_AGENDAMIENTO = 'Fecha de agendamiento (dd/mm/aaaa)';
const COL_FECHA_FINALIZACION = 'Fecha de finalización (dd/mm/aaaa)';
const COL_SESIONES_APROBADAS = 'Sesiones aprobadas (número o "Libres")';

const COLUMN_HEADERS = [
  COL_NOMBRES, COL_APELLIDOS, COL_TIPO_DOC, COL_NUM_DOC, COL_FECHA_NAC,
  COL_SEXO_BIO, COL_GENERO, COL_ESTADO_CIVIL, COL_DEP_NACIMIENTO, COL_CIUDAD_NACIMIENTO,
  COL_TEL, COL_EMAIL,
  COL_EPS, COL_REGIMEN, COL_ESTRATO,
  COL_DIRECCION_RESIDENCIA, COL_DEP_RESIDENCIA, COL_CIUDAD_RESIDENCIA, COL_BARRIO,
  COL_ESTADO,
  COL_EC_NOMBRES, COL_EC_APELLIDOS, COL_EC_TEL, COL_EC_PARENTESCO,
  COL_REQUIERE_REP_LEGAL, COL_REP_NOMBRES, COL_REP_APELLIDOS, COL_REP_TEL, COL_REP_PARENTESCO, COL_REP_CORREO,
  COL_PSICOLOGO, COL_TIPO_CONVENIO, COL_RELACION, COL_TIPO_ATENCION,
  COL_FECHA_SOLICITUD, COL_FECHA_AGENDAMIENTO, COL_FECHA_FINALIZACION, COL_SESIONES_APROBADAS,
];

// Filas con select real que se preparan en la plantilla — más allá de esto,
// arrastrar la fórmula de validación hacia abajo sigue funcionando en Excel
// (el usuario extiende el rango con el "manejador de relleno"), pero no viene
// pre-armado para no generar un archivo innecesariamente pesado.
const TEMPLATE_VALIDATION_ROWS = 300;

// Excel: un rango con nombre no puede tener espacios — se reemplazan por "_".
// El dataset real de departamentos (colombiaData.ts) solo usa letras (con
// tildes/ñ), espacios y un punto ("Bogotá D.C.") — nada más — así que la
// fórmula INDIRECT(SUSTITUIR(celda," ","_")) en el Excel generado reconstruye
// EXACTAMENTE el mismo nombre que se crea aquí. Si algún día se agrega un
// departamento con otro tipo de carácter especial, hay que actualizar las dos
// partes a la vez.
function sanitizeDefinedName(name: string): string {
  const s = name.trim().replace(/\s+/g, '_');
  return /^[0-9]/.test(s) ? `_${s}` : s;
}

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
  const [epsCatalog, setEpsCatalog] = useState<EpsOption[]>([]);
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[] | null>(null);
  const [clientErrors, setClientErrors] = useState<RowError[]>([]);
  const [serverErrors, setServerErrors] = useState<RowError[]>([]);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generatingTemplate, setGeneratingTemplate] = useState(false);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  // ── Control de dos personas para el cupo inicial (ver session-change.
  // service.js) — si AL MENOS UNA fila trae "Sesiones autorizadas", todo el
  // archivo se procesa como UNA sola solicitud con un solo código, en vez de
  // uno por fila (impracticable en un archivo de 50 pacientes).
  const [approvers, setApprovers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [approverId, setApproverId] = useState('');
  const [pendingChangeRequestId, setPendingChangeRequestId] = useState<string | null>(null);
  const [pendingChangeExpiresInMinutes, setPendingChangeExpiresInMinutes] = useState<number | null>(null);
  const [pendingChangeSummary, setPendingChangeSummary] = useState<{ bulkPatientCount: number; bulkTotalSessions: number } | null>(null);
  const [verifyCodeInput, setVerifyCodeInput] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    apiFetch('/api/session-changes/approvers')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setApprovers(Array.isArray(data) ? data : []))
      .catch(() => setApprovers([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    apiFetch('/api/users/specialists')
      .then(res => res.ok ? res.json() : [])
      .then(data => setSpecialists(Array.isArray(data?.specialists) ? data.specialists : Array.isArray(data) ? data : []))
      .catch(() => setSpecialists([]));
    // El catálogo completo de EPS cabe entero (28 filas) — se trae una sola
    // vez al abrir el modal, igual que los psicólogos.
    apiFetch('/api/eps?limit=100')
      .then(res => res.ok ? res.json() : [])
      .then(data => setEpsCatalog(Array.isArray(data) ? data : []))
      .catch(() => setEpsCatalog([]));
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
    setApproverId('');
    setPendingChangeRequestId(null);
    setPendingChangeExpiresInMinutes(null);
    setPendingChangeSummary(null);
    setVerifyCodeInput('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  // Texto exacto que se muestra Y se guarda en la celda para EPS — mismo
  // formato "código — nombre" que ya usa el combobox del modal individual
  // (EpsPicker), para que se reconozca visualmente igual en los dos lugares.
  function epsCellLabel(eps: EpsOption): string {
    return `${eps.code} — ${eps.nombre}`;
  }

  async function handleDownloadTemplate() {
    setGeneratingTemplate(true);
    try {
      const selectedCompanyName = companyId ? (companies.find(c => c.id === companyId)?.name || 'Particular') : 'Particular (sin convenio)';

      const wb = new ExcelJS.Workbook();
      wb.creator = 'MindPsic';

      // ── Hoja "Listas" (oculta) — fuente de cada select real ────────────────
      const wsListas = wb.addWorksheet('Listas', { state: 'hidden' });

      function writeFlatList(colIndex: number, values: string[]): { colIndex: number; count: number } {
        values.forEach((v, i) => { wsListas.getCell(i + 1, colIndex).value = v; });
        return { colIndex, count: values.length };
      }
      function definedNameRef(colIndex: number, count: number): string {
        const col = wsListas.getColumn(colIndex).letter;
        return `'Listas'!$${col}$1:$${col}$${Math.max(count, 1)}`;
      }
      function addDefinedName(colIndex: number, count: number, name: string) {
        if (count === 0) return;
        wb.definedNames.add(definedNameRef(colIndex, count), name);
      }

      let col = 1;
      const listaTipoDoc = writeFlatList(col++, DOCUMENT_TYPE_OPTIONS);
      const listaSexo = writeFlatList(col++, SEXO_OPTIONS);
      const listaGenero = writeFlatList(col++, GENERO_OPTIONS);
      const listaEstadoCivil = writeFlatList(col++, ESTADO_CIVIL_OPTIONS);
      const listaRegimen = writeFlatList(col++, REGIMEN_OPTIONS);
      const listaEps = writeFlatList(col++, epsCatalog.map(epsCellLabel));
      const listaDepartamentos = writeFlatList(col++, DEPARTAMENTOS_ORDENADOS);
      const listaEstadoContacto = writeFlatList(col++, BULK_STATUS_KEYS.map(k => PATIENT_STATUS_LABELS[k]));
      const listaParentesco = writeFlatList(col++, PARENTESCO_OPTIONS);
      const listaRelacion = writeFlatList(col++, RELACION_OPTIONS);
      const listaTipoAtencion = writeFlatList(col++, TIPO_ATENCION_LABELS);
      const listaSiNo = writeFlatList(col++, SI_NO_OPTIONS);
      const psicologoNames = [SIN_ASIGNAR_LABEL, ...specialists.map(s => s.name)];
      const listaPsicologos = writeFlatList(col++, psicologoNames);
      const tipoConvenioNames = agreementTypes.map(t => t.name);
      const listaTiposConvenio = writeFlatList(col++, tipoConvenioNames);

      addDefinedName(listaTipoDoc.colIndex, listaTipoDoc.count, 'ListaTipoDoc');
      addDefinedName(listaSexo.colIndex, listaSexo.count, 'ListaSexo');
      addDefinedName(listaGenero.colIndex, listaGenero.count, 'ListaGenero');
      addDefinedName(listaEstadoCivil.colIndex, listaEstadoCivil.count, 'ListaEstadoCivil');
      addDefinedName(listaRegimen.colIndex, listaRegimen.count, 'ListaRegimen');
      addDefinedName(listaEps.colIndex, listaEps.count, 'ListaEps');
      addDefinedName(listaDepartamentos.colIndex, listaDepartamentos.count, 'ListaDepartamentos');
      addDefinedName(listaEstadoContacto.colIndex, listaEstadoContacto.count, 'ListaEstadoContacto');
      addDefinedName(listaParentesco.colIndex, listaParentesco.count, 'ListaParentesco');
      addDefinedName(listaRelacion.colIndex, listaRelacion.count, 'ListaRelacion');
      addDefinedName(listaTipoAtencion.colIndex, listaTipoAtencion.count, 'ListaTipoAtencion');
      addDefinedName(listaSiNo.colIndex, listaSiNo.count, 'ListaSiNo');
      addDefinedName(listaPsicologos.colIndex, listaPsicologos.count, 'ListaPsicologos');
      addDefinedName(listaTiposConvenio.colIndex, listaTiposConvenio.count, 'ListaTiposConvenio');

      // Una columna por departamento con sus ciudades — el nombre del rango es
      // el nombre del departamento saneado (ver sanitizeDefinedName). La
      // fórmula INDIRECT del select de ciudad en la hoja principal reconstruye
      // este mismo nombre a partir de lo que haya en la celda de departamento.
      DEPARTAMENTOS_ORDENADOS.forEach((dep) => {
        const ciudades = COLOMBIA_DEPARTAMENTOS[dep] || [];
        const { colIndex, count } = writeFlatList(col++, ciudades);
        addDefinedName(colIndex, count, sanitizeDefinedName(dep));
      });

      // ── Hoja "Pacientes" — la que llena el usuario ──────────────────────────
      const ws = wb.addWorksheet('Pacientes');
      ws.addRow(COLUMN_HEADERS);
      const headerRow = ws.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C1917' } };
      });
      COLUMN_HEADERS.forEach((_, i) => { ws.getColumn(i + 1).width = 30; });

      const firstEps = epsCatalog[0];
      const exampleRow = [
        'Juan', 'Pérez', 'CC', '1024556778', '15/03/1990',
        'Hombre', 'Masculino', 'Soltero/a', 'Antioquia', 'Medellín',
        '3132220587', 'juan@correo.com',
        firstEps ? epsCellLabel(firstEps) : '', 'Contributivo', '3',
        'Calle 10 # 5-23', 'Bogotá D.C.', 'Bogotá D.C.', 'Chapinero',
        'Notificado 1°vez',
        'María', 'Pérez', '3132220587', 'Madre',
        'No', '', '', '', '', '',
        SIN_ASIGNAR_LABEL,
        '', 'Estudiante', 'Presencial', '02/09/2026', '', '', '8',
      ];
      ws.addRow(exampleRow);

      // ── Selects reales — cada columna, filas 2..TEMPLATE_VALIDATION_ROWS+1 ──
      function colIndexOf(header: string): number {
        return COLUMN_HEADERS.indexOf(header) + 1;
      }
      function applyListValidation(header: string, definedName: string, count: number, style: 'stop' | 'warning' = 'stop') {
        if (count === 0) return; // catálogo dinámico vacío (ej. sin tipos de convenio configurados) — se deja como texto libre
        const c = colIndexOf(header);
        for (let r = 2; r <= TEMPLATE_VALIDATION_ROWS + 1; r++) {
          ws.getCell(r, c).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [definedName],
            showErrorMessage: true,
            errorStyle: style,
            errorTitle: 'Valor no válido',
            error: 'Selecciona uno de los valores de la lista desplegable.',
          };
        }
      }

      applyListValidation(COL_TIPO_DOC, 'ListaTipoDoc', listaTipoDoc.count);
      applyListValidation(COL_SEXO_BIO, 'ListaSexo', listaSexo.count);
      applyListValidation(COL_GENERO, 'ListaGenero', listaGenero.count);
      applyListValidation(COL_ESTADO_CIVIL, 'ListaEstadoCivil', listaEstadoCivil.count);
      applyListValidation(COL_DEP_NACIMIENTO, 'ListaDepartamentos', listaDepartamentos.count);
      applyListValidation(COL_DEP_RESIDENCIA, 'ListaDepartamentos', listaDepartamentos.count);
      applyListValidation(COL_EPS, 'ListaEps', listaEps.count);
      applyListValidation(COL_REGIMEN, 'ListaRegimen', listaRegimen.count);
      applyListValidation(COL_ESTADO, 'ListaEstadoContacto', listaEstadoContacto.count);
      applyListValidation(COL_EC_PARENTESCO, 'ListaParentesco', listaParentesco.count);
      applyListValidation(COL_REQUIERE_REP_LEGAL, 'ListaSiNo', listaSiNo.count);
      applyListValidation(COL_REP_PARENTESCO, 'ListaParentesco', listaParentesco.count);
      applyListValidation(COL_PSICOLOGO, 'ListaPsicologos', listaPsicologos.count);
      applyListValidation(COL_TIPO_CONVENIO, 'ListaTiposConvenio', listaTiposConvenio.count);
      applyListValidation(COL_RELACION, 'ListaRelacion', listaRelacion.count);
      applyListValidation(COL_TIPO_ATENCION, 'ListaTipoAtencion', listaTipoAtencion.count);

      // Ciudad depende de Departamento (misma fila) — cascada real vía
      // INDIRECT, igual que el <select> del modal individual. `errorStyle:
      // 'warning'` (no 'stop'): si Excel no encuentra el rango con nombre
      // (departamento vacío o distinto de la lista), deja escribir la ciudad
      // a mano en vez de bloquear la celda — el backend no exige que la
      // ciudad coincida exactamente con el departamento, solo lo sugiere.
      function applyCityCascadeValidation(cityHeader: string, deptHeader: string) {
        const cCity = colIndexOf(cityHeader);
        const cDept = colIndexOf(deptHeader);
        for (let r = 2; r <= TEMPLATE_VALIDATION_ROWS + 1; r++) {
          const deptAddress = ws.getCell(r, cDept).address;
          ws.getCell(r, cCity).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [`INDIRECT(SUBSTITUTE(${deptAddress},\" \",\"_\"))`],
            showErrorMessage: true,
            errorStyle: 'warning',
            errorTitle: 'Ciudad no reconocida',
            error: 'Elige primero un departamento válido en la columna correspondiente, o escribe el municipio manualmente si no aparece en la lista.',
          };
        }
      }
      applyCityCascadeValidation(COL_CIUDAD_NACIMIENTO, COL_DEP_NACIMIENTO);
      applyCityCascadeValidation(COL_CIUDAD_RESIDENCIA, COL_DEP_RESIDENCIA);

      // ── Hoja "Instrucciones" — documentación de respaldo (obligatoriedad,
      // formatos de texto libre) — los valores enumerados ya no dependen de
      // copiar el texto exacto de aquí porque ahora son selects reales, pero
      // se mantiene la lista como referencia rápida y por si se abre en un
      // programa que no respeta la validación de datos de Excel. ──────────────
      const statusValues = BULK_STATUS_KEYS.map(k => PATIENT_STATUS_LABELS[k]).join(' / ');
      const instructions: (string | number)[][] = [
        ['Instrucciones para llenar la plantilla'],
        [''],
        [`Este archivo se importará bajo el convenio: ${selectedCompanyName}`],
        ['Las columnas marcadas "Lista desplegable" ya traen el select armado en la celda — haz clic y elige un valor, no hace falta escribirlo a mano.'],
        [''],
        ['Campo', 'Obligatorio', 'Cómo se llena'],
        [COL_NOMBRES, 'Sí', 'Solo letras'],
        [COL_APELLIDOS, 'Sí', 'Solo letras'],
        [COL_TIPO_DOC, 'Sí', 'Lista desplegable'],
        [COL_NUM_DOC, 'Sí', 'Solo números, máximo 10 dígitos, sin duplicados'],
        [COL_FECHA_NAC, 'No', 'Formato dd/mm/aaaa'],
        [COL_SEXO_BIO, 'No', 'Lista desplegable'],
        [COL_GENERO, 'No', 'Lista desplegable'],
        [COL_ESTADO_CIVIL, 'No', 'Lista desplegable'],
        [COL_DEP_NACIMIENTO, 'No', 'Lista desplegable'],
        [COL_CIUDAD_NACIMIENTO, 'No', 'Lista desplegable (depende del departamento de la misma fila)'],
        [COL_TEL, 'No', 'Exactamente 10 dígitos si se llena'],
        [COL_EMAIL, 'No', 'Formato válido (ej. nombre@dominio.com)'],
        [COL_EPS, 'No', 'Lista desplegable'],
        [COL_REGIMEN, 'No', 'Lista desplegable'],
        [COL_ESTRATO, 'No', 'Número entero entre 1 y 6'],
        [COL_DIRECCION_RESIDENCIA, 'No', 'Texto libre'],
        [COL_DEP_RESIDENCIA, 'No', 'Lista desplegable'],
        [COL_CIUDAD_RESIDENCIA, 'No', 'Lista desplegable (depende del departamento de la misma fila)'],
        [COL_BARRIO, 'No', 'Texto libre'],
        [COL_ESTADO, 'Sí', 'Lista desplegable'],
        [COL_EC_NOMBRES, 'No', 'Solo letras'],
        [COL_EC_APELLIDOS, 'No', 'Solo letras'],
        [COL_EC_TEL, 'No', 'Exactamente 10 dígitos si se llena'],
        [COL_EC_PARENTESCO, 'No', 'Lista desplegable'],
        [COL_REQUIERE_REP_LEGAL, 'No', 'Lista desplegable — "Sí" o "No"'],
        [COL_REP_NOMBRES, 'No', 'Solo letras — obligatorio si "¿Requiere representante legal?" es "Sí"'],
        [COL_REP_APELLIDOS, 'No', 'Solo letras — obligatorio si "¿Requiere representante legal?" es "Sí"'],
        [COL_REP_TEL, 'No', 'Exactamente 10 dígitos si se llena'],
        [COL_REP_PARENTESCO, 'No', 'Lista desplegable'],
        [COL_REP_CORREO, 'No', 'Formato válido (ej. nombre@dominio.com)'],
        [COL_PSICOLOGO, 'No', 'Lista desplegable'],
        [COL_TIPO_CONVENIO, 'No', tipoConvenioNames.length > 0 ? 'Lista desplegable' : 'Este convenio todavía no tiene tipos configurados — deja la columna vacía'],
        [COL_RELACION, 'No', 'Lista desplegable'],
        [COL_TIPO_ATENCION, 'No', 'Lista desplegable'],
        [COL_FECHA_SOLICITUD, 'No', 'Formato dd/mm/aaaa — si se deja vacía, se usa la fecha de hoy'],
        [COL_FECHA_AGENDAMIENTO, 'No', 'Formato dd/mm/aaaa — normalmente se deja vacía, la completa el sistema al agendar la primera cita'],
        [COL_FECHA_FINALIZACION, 'No', 'Formato dd/mm/aaaa — normalmente se deja vacía, la completa el sistema al cerrar el proceso'],
        [COL_SESIONES_APROBADAS, 'No', 'Un número entero mayor a 0, o "Libres" (sin tope) — abre el cupo inicial del paciente con el convenio del lote. NO es una lista desplegable (acepta cualquier número).'],
        [''],
        ['Valores válidos de "Estado de contacto":', statusValues],
        ['Valores válidos de "Régimen de salud":', REGIMEN_OPTIONS.join(' / ')],
      ];
      const wsInstr = wb.addWorksheet('Instrucciones');
      instructions.forEach((row) => wsInstr.addRow(row));
      wsInstr.getColumn(1).width = 45;
      wsInstr.getColumn(2).width = 60;
      wsInstr.getColumn(3).width = 65;

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plantilla-pacientes-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setGeneratingTemplate(false);
    }
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
      const epsByLabel = new Map(epsCatalog.map(eps => [epsCellLabel(eps).toLowerCase(), eps.code]));
      const epsByCode = new Map(epsCatalog.map(eps => [eps.code.toLowerCase(), eps.code]));
      const departamentosSet = new Set(DEPARTAMENTOS_ORDENADOS.map(d => d.toLowerCase()));
      const errors: RowError[] = [];

      const rows: ParsedRow[] = raw.map((r, idx) => {
        const rowNumber = idx + 2;

        const psicologoRaw = String(r[COL_PSICOLOGO] || '').trim();
        let psychologistId: string | null = null;
        if (psicologoRaw && psicologoRaw.toLowerCase() !== SIN_ASIGNAR_LABEL.toLowerCase()) {
          const match = specialistByName.get(psicologoRaw.toLowerCase());
          if (!match) {
            errors.push({ row: rowNumber, field: 'psychologistId', message: `Psicólogo "${psicologoRaw}" no reconocido — usa el selector de la celda.` });
          } else {
            psychologistId = match;
          }
        }

        const estadoRaw = String(r[COL_ESTADO] || '').trim();
        let status = '';
        if (estadoRaw) {
          const key = statusLabelToKey(estadoRaw);
          if (!key) {
            errors.push({ row: rowNumber, field: 'status', message: `Estado "${estadoRaw}" no reconocido — usa el selector de la celda.` });
          } else {
            status = key;
          }
        }

        const birthDate = parseDateCell(r[COL_FECHA_NAC], rowNumber, 'birthDate', 'Fecha de nacimiento', errors);

        const sexoBiologico = String(r[COL_SEXO_BIO] || '').trim();
        if (sexoBiologico && !SEXO_OPTIONS.includes(sexoBiologico)) {
          errors.push({ row: rowNumber, field: 'sexoBiologico', message: `Sexo biológico "${sexoBiologico}" no reconocido — usa el selector de la celda.` });
        }
        const genero = String(r[COL_GENERO] || '').trim();
        if (genero && !GENERO_OPTIONS.includes(genero)) {
          errors.push({ row: rowNumber, field: 'genero', message: `Género "${genero}" no reconocido — usa el selector de la celda.` });
        }
        const estadoCivil = String(r[COL_ESTADO_CIVIL] || '').trim();
        if (estadoCivil && !ESTADO_CIVIL_OPTIONS.includes(estadoCivil)) {
          errors.push({ row: rowNumber, field: 'estadoCivil', message: `Estado civil "${estadoCivil}" no reconocido — usa el selector de la celda.` });
        }

        const departamentoNacimiento = String(r[COL_DEP_NACIMIENTO] || '').trim();
        if (departamentoNacimiento && !departamentosSet.has(departamentoNacimiento.toLowerCase())) {
          errors.push({ row: rowNumber, field: 'departamentoNacimiento', message: `Departamento "${departamentoNacimiento}" no reconocido — usa el selector de la celda.` });
        }
        const ciudadNacimiento = String(r[COL_CIUDAD_NACIMIENTO] || '').trim();

        const epsRaw = String(r[COL_EPS] || '').trim();
        let epsCodigo = '';
        if (epsRaw) {
          const match = epsByLabel.get(epsRaw.toLowerCase()) || epsByCode.get(epsRaw.toLowerCase());
          if (!match) {
            errors.push({ row: rowNumber, field: 'epsCodigo', message: `EPS "${epsRaw}" no reconocida — usa el selector de la celda.` });
          } else {
            epsCodigo = match;
          }
        }
        const regimenSalud = String(r[COL_REGIMEN] || '').trim();
        if (regimenSalud && !REGIMEN_OPTIONS.includes(regimenSalud)) {
          errors.push({ row: rowNumber, field: 'regimenSalud', message: `Régimen de salud "${regimenSalud}" no reconocido — usa el selector de la celda.` });
        }

        const direccionResidencia = String(r[COL_DIRECCION_RESIDENCIA] || '').trim();
        const departamentoResidencia = String(r[COL_DEP_RESIDENCIA] || '').trim();
        if (departamentoResidencia && !departamentosSet.has(departamentoResidencia.toLowerCase())) {
          errors.push({ row: rowNumber, field: 'departamentoResidencia', message: `Departamento "${departamentoResidencia}" no reconocido — usa el selector de la celda.` });
        }
        const ciudadResidencia = String(r[COL_CIUDAD_RESIDENCIA] || '').trim();
        const barrio = String(r[COL_BARRIO] || '').trim();

        const requiereRepRaw = String(r[COL_REQUIERE_REP_LEGAL] || '').trim();
        let requiereRepresentanteLegal = false;
        if (requiereRepRaw) {
          const normalized = requiereRepRaw.toLowerCase();
          if (normalized === 'sí' || normalized === 'si') requiereRepresentanteLegal = true;
          else if (normalized === 'no') requiereRepresentanteLegal = false;
          else errors.push({ row: rowNumber, field: 'requiereRepresentanteLegal', message: `"${COL_REQUIERE_REP_LEGAL}" debe ser "Sí" o "No" — usa el selector de la celda.` });
        }
        const legalRep1Parentesco = String(r[COL_REP_PARENTESCO] || '').trim();
        if (legalRep1Parentesco && !PARENTESCO_OPTIONS.includes(legalRep1Parentesco)) {
          errors.push({ row: rowNumber, field: 'legalRep1Parentesco', message: `Parentesco del representante legal "${legalRep1Parentesco}" no reconocido — usa el selector de la celda.` });
        }

        const tipoConvenioRaw = String(r[COL_TIPO_CONVENIO] || '').trim();
        let agreementType = '';
        if (tipoConvenioRaw) {
          const match = agreementTypeByName.get(tipoConvenioRaw.toLowerCase());
          if (!match) {
            errors.push({ row: rowNumber, field: 'agreementType', message: `Tipo de convenio "${tipoConvenioRaw}" no reconocido — usa el selector de la celda.` });
          } else {
            agreementType = match;
          }
        }

        const relacion = String(r[COL_RELACION] || '').trim();
        if (relacion && !RELACION_OPTIONS.includes(relacion)) {
          errors.push({ row: rowNumber, field: 'relacion', message: `Relación "${relacion}" no reconocida — usa el selector de la celda.` });
        }

        const tipoAtencionRaw = String(r[COL_TIPO_ATENCION] || '').trim();
        let tipoAtencion = '';
        if (tipoAtencionRaw) {
          const match = TIPO_ATENCION_LABEL_TO_VALUE[tipoAtencionRaw.toLowerCase()];
          if (!match) {
            errors.push({ row: rowNumber, field: 'tipoAtencion', message: `Tipo de atención "${tipoAtencionRaw}" no reconocido — usa el selector de la celda.` });
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
          sexoBiologico,
          genero,
          estadoCivil,
          departamentoNacimiento,
          ciudadNacimiento,
          phone: String(r[COL_TEL] || '').trim(),
          email: String(r[COL_EMAIL] || '').trim(),
          epsCodigo,
          regimenSalud,
          estrato: String(r[COL_ESTRATO] || '').trim(),
          direccionResidencia,
          departamentoResidencia,
          ciudadResidencia,
          barrio,
          status,
          emergencyContactNombres: String(r[COL_EC_NOMBRES] || '').trim(),
          emergencyContactApellidos: String(r[COL_EC_APELLIDOS] || '').trim(),
          emergencyContactTelefono: String(r[COL_EC_TEL] || '').trim(),
          emergencyContactParentesco: String(r[COL_EC_PARENTESCO] || '').trim(),
          requiereRepresentanteLegal,
          legalRep1Nombres: String(r[COL_REP_NOMBRES] || '').trim(),
          legalRep1Apellidos: String(r[COL_REP_APELLIDOS] || '').trim(),
          legalRep1Telefono: String(r[COL_REP_TEL] || '').trim(),
          legalRep1Parentesco,
          legalRep1Correo: String(r[COL_REP_CORREO] || '').trim(),
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

  // ¿Alguna fila pide cupo inicial? Mismo criterio que rowRequestsInitial
  // Sessions en el backend (bulkImportPatients) — si es así, TODO el archivo
  // pasa por el código de aprobación de un solo tirón.
  const hasInitialSessions = !!parsedRows && parsedRows.some((r) => String(r.sessionsAuthorized || '').trim() !== '');

  async function handleImport() {
    if (!parsedRows || parsedRows.length === 0) return;

    // Paso 2 (si ya se pidió el código): verificarlo — esto SÍ ejecuta la
    // carga real, con exactamente las filas que se validaron al pedirlo.
    if (hasInitialSessions && pendingChangeRequestId) {
      if (!verifyCodeInput.trim()) {
        setGeneralError('Ingresa el código que te dictaron.');
        return;
      }
      setSubmitting(true);
      setGeneralError(null);
      setServerErrors([]);
      try {
        const res = await apiFetch('/api/session-changes/verify', {
          method: 'POST',
          body: JSON.stringify({ requestId: pendingChangeRequestId, code: verifyCodeInput.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          setGeneralError(data.error || `HTTP ${res.status}`);
          return;
        }
        // El código pudo verificarse bien (200) aunque la carga interna haya
        // fallado por validación — el resultado real viene en data.result,
        // con la misma forma que ya devolvía /api/patients/bulk-import.
        const result = data.result;
        if (Array.isArray(result?.errors)) {
          setServerErrors(result.errors);
          return;
        }
        if (!result?.success) {
          setGeneralError(result?.error || 'No se pudo procesar la carga.');
          return;
        }
        setSuccessCount(result.count);
        onImported(result.count);
      } catch {
        setGeneralError('No se pudo contactar el servidor.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Paso 1 (cupo inicial, sin solicitud todavía): pedir el código — un
    // solo código para TODO el archivo, no uno por fila.
    if (hasInitialSessions) {
      if (!approverId) {
        setGeneralError('Elige a quién le va a llegar el código de confirmación.');
        return;
      }
      setSubmitting(true);
      setGeneralError(null);
      try {
        const res = await apiFetch('/api/session-changes/bulk-import/request', {
          method: 'POST',
          body: JSON.stringify({ companyId: companyId || undefined, rows: parsedRows, approverId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setGeneralError(data.error || `HTTP ${res.status}`);
          return;
        }
        setPendingChangeRequestId(data.requestId);
        setPendingChangeExpiresInMinutes(data.expiresInMinutes);
        setPendingChangeSummary({ bulkPatientCount: data.bulkPatientCount, bulkTotalSessions: data.bulkTotalSessions });
      } catch {
        setGeneralError('No se pudo contactar el servidor.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Sin cupo inicial en ninguna fila — se procesa directo, sin código.
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
  const canImport = !!parsedRows && parsedRows.length > 0 && allErrors.length === 0 && successCount === null
    && (!hasInitialSessions || !!pendingChangeRequestId || !!approverId);

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
            disabled={generatingTemplate}
            className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-charcoal-900 shadow-sm transition-colors hover:bg-toast-50 cursor-pointer disabled:opacity-50"
          >
            {generatingTemplate ? <Loader2 className="h-4 w-4 animate-spin text-toast-500" /> : <Download className="h-4 w-4 text-toast-500" />}
            {generatingTemplate ? 'Generando plantilla...' : 'Descargar plantilla (.xlsx)'}
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

          {hasInitialSessions && successCount === null && (
            pendingChangeRequestId ? (
              <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-xs font-semibold text-indigo-700">
                  Código enviado{pendingChangeExpiresInMinutes ? ` — vence en ${pendingChangeExpiresInMinutes} min` : ''}
                  {pendingChangeSummary ? ` — cubre ${pendingChangeSummary.bulkPatientCount} paciente(s), ${pendingChangeSummary.bulkTotalSessions} sesiones en total.` : '.'}
                  {' '}Pídele el código a quien lo recibió.
                </p>
                <input
                  type="text" inputMode="numeric" maxLength={6} value={verifyCodeInput}
                  onChange={(e) => setVerifyCodeInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="Código de 6 dígitos"
                  className="w-full max-w-xs rounded-lg border border-indigo-300 bg-white p-2.5 text-sm font-mono tracking-widest outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => { setPendingChangeRequestId(null); setPendingChangeExpiresInMinutes(null); setPendingChangeSummary(null); setVerifyCodeInput(''); }}
                  className="block text-[11px] font-semibold text-slate-500 hover:text-slate-700"
                >
                  Cancelar y pedir un código nuevo
                </button>
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  ¿A quién le llega el código de confirmación?
                </label>
                <select
                  value={approverId}
                  onChange={(e) => setApproverId(e.target.value)}
                  className="w-full max-w-xs rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-charcoal-900 outline-none focus:border-toast-400 focus:bg-white focus:ring-2 focus:ring-toast-500/20"
                >
                  <option value="">Selecciona un aprobador...</option>
                  {approvers.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10.5px] text-slate-400">
                  Este archivo asigna cupo inicial de sesiones — se envía un solo código para todo el lote (control de dos personas).
                </p>
                {approvers.length === 0 && (
                  <p className="mt-1 text-[10.5px] text-amber-600">
                    Nadie en tu equipo tiene el permiso de aprobador todavía — actívalo desde Equipo y Accesos.
                  </p>
                )}
              </div>
            )
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
              {submitting
                ? 'Procesando...'
                : hasInitialSessions
                  ? (pendingChangeRequestId ? 'Confirmar código' : 'Solicitar código')
                  : 'Importar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
