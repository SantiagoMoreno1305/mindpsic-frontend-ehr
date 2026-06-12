/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  User, 
  Patient, 
  ProgressNote, 
  ClinicalFile, 
  PsychometricTest, 
  PatientTestState, 
  VideoSession, 
  TenantDomain, 
  PsychologistPerformance,
  ResearchProject,
  ResearchSubject,
  ScreeningData,
  ResearchAppointment
} from '../types';

export const mockPsychologist: User = {
  id: 'psy_01',
  name: 'Camila Morales Vega',
  email: 'c.morales@mindhealth.com',
  role: 'psicologo',
  avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=200',
  licenseNumber: 'TP-109489241-COL'
};

export const mockAdmin: User = {
  id: 'adm_01',
  name: 'Alejandro Restrepo',
  email: 'a.restrepo@mindpsic.com',
  role: 'admin',
  avatarUrl: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=200'
};

export const initialPatients: Patient[] = [
  {
    id: 'pat_01',
    name: 'Sebas Martínez Ocampo',
    gender: 'Masculino',
    age: 28,
    email: 'sebas.martinez@gmail.com',
    phone: '+57 312 456 7890',
    status: 'Activo',
    agreement: 'Sura Medicina Prepagada',
    progressNotesCount: 12,
    lastSessionDate: '2026-05-20'
  },
  {
    id: 'pat_02',
    name: 'Valeria Sotomayor',
    gender: 'Femenino',
    age: 34,
    email: 'v.sotomayor@outlook.com',
    phone: '+57 315 987 6543',
    status: 'Activo',
    agreement: 'Colmédica Prepagada',
    progressNotesCount: 8,
    lastSessionDate: '2026-05-18'
  },
  {
    id: 'pat_03',
    name: 'Andrés Felipe Correa',
    gender: 'Masculino',
    age: 42,
    email: 'afc.correa@gmail.com',
    phone: '+57 300 123 4567',
    status: 'Activo',
    agreement: 'MindHealth Global Employee',
    progressNotesCount: 15,
    lastSessionDate: '2026-05-21'
  },
  {
    id: 'pat_04',
    name: 'Daniela Castro Pérez',
    gender: 'Femenino',
    age: 22,
    email: 'daniela.castro@gmail.com',
    phone: '+57 320 888 1122',
    status: 'Activo',
    agreement: 'Particular',
    progressNotesCount: 4,
    lastSessionDate: '2026-05-12'
  },
  {
    id: 'pat_05',
    name: 'Mauricio Gómez Ruiz',
    gender: 'Masculino',
    age: 51,
    email: 'mauricio.g@yahoo.com',
    phone: '+57 311 999 4433',
    status: 'Inactivo',
    agreement: 'Coomeva MP',
    progressNotesCount: 20,
    lastSessionDate: '2026-04-05'
  }
];

export const initialProgressNotes: ProgressNote[] = [
  {
    id: 'note_01',
    patientId: 'pat_01',
    date: '2026-05-20',
    psychologistId: 'psy_01',
    psychologistName: 'Camila Morales Vega',
    sessionNumber: 12,
    reason: 'Trastorno de Ansiedad Generalizada y sobrecarga intelectual en entorno de desarrollo.',
    mentalStatus: 'Paciente orientado en las tres esferas. Discurso coherente y fluido, tono ansioso al reportar presiones laborales. Afecto modulado con tendencia a la ansiedad. Sin ideación delirante o autolítica.',
    intervention: 'Revisión y reestructuración cognitiva de los esquemas catastrofistas frente al rendimiento. Entrenamiento en respiración diafragmática pausada y fijación de límites laborales informáticos.',
    evolution: 'El paciente reporta mejoría del ciclo de sueño tras implementar el bloqueo de luz azul y las técnicas de relajación nocturna. Persiste rumiación matutina moderada.',
    diagnosis: 'F41.1 Trastorno de ansiedad generalizada',
    recommendations: 'Continuar con el registro de pensamientos automáticos disfuncionales. Mantener higiene de sueño estricta.'
  },
  {
    id: 'note_02',
    patientId: 'pat_02',
    date: '2026-05-18',
    psychologistId: 'psy_01',
    psychologistName: 'Camila Morales Vega',
    sessionNumber: 8,
    reason: 'Procesamiento de duelo complejo y sintomatología distímica.',
    mentalStatus: 'Afecto hipomínico, llanto intermitente durante el relato de memorias relacionales. Orientado, colaborador. Lenguaje pausado pero congruente. Percepción intacta.',
    intervention: 'Técnica de silla vacía adaptada para resolución simbólica del duelo. Análisis de la culpa internalizada.',
    evolution: 'Se evidencia un nivel de catarsis emocional profundo. El paciente expresa menor nivel de resistencia al proceso de aceptación de la pérdida.',
    diagnosis: 'F43.21 Trastorno de adaptación con estado de ánimo depresivo',
    recommendations: 'Fomentar redes de apoyo familiar y salidas recreativas sin sobreesfuerzo emocional.'
  },
  {
    id: 'note_03',
    patientId: 'pat_03',
    date: '2026-05-21',
    psychologistId: 'psy_01',
    psychologistName: 'Camila Morales Vega',
    sessionNumber: 15,
    reason: 'Manejo de ira recurrente e irritabilidad en el entorno de alta gerencia.',
    mentalStatus: 'Paciente hiperalerta, tono de voz asertivo con ligeras trazas de tensión muscular en mandíbula. Orientado. Atento. Pensamiento rígido, juicio conservado.',
    intervention: 'Asignación de "pausas lúdicas de de-escalamiento" en su jornada. Diálogo de auto-instrucciones calmantes reguladas.',
    evolution: 'Identifica los gatillos corporales del enojo de manera precoz. Logró detener 2 incidentes de confrontación hostil en su equipo.',
    diagnosis: 'F43.25 Trastorno de adaptación con alteración mixta de las emociones y la conducta',
    recommendations: 'Practicar meditación guiada de 5 minutos antes del comité directivo.'
  }
];

export const initialClinicalFiles: ClinicalFile[] = [
  // Patient folders emulation / patient files
  {
    id: 'file_01',
    name: 'Historia_Clinica_Sebastian_Martinez_Firmado.pdf',
    type: 'pdf',
    size: '1.8 MB',
    uploadedAt: '2026-05-19',
    uploadedBy: 'Dra. Camila Morales',
    patientId: 'pat_01',
    category: 'Historia Clínica'
  },
  {
    id: 'file_02',
    name: 'Consentimiento_Informado_S_Martinez.pdf',
    type: 'pdf',
    size: '720 KB',
    uploadedAt: '2025-11-10',
    uploadedBy: 'Dra. Camila Morales',
    patientId: 'pat_01',
    category: 'Consentimiento'
  },
  {
    id: 'file_03',
    name: 'Reporte_Beck_Ansiedad_SebasMA.pdf',
    type: 'pdf',
    size: '420 KB',
    uploadedAt: '2026-05-15',
    uploadedBy: 'Sistema Dr.Mind LLM',
    patientId: 'pat_01',
    category: 'Análisis IA'
  },
  {
    id: 'file_04',
    name: 'Evaluacion_Diagnostica_Completa_Valeria_S.docx',
    type: 'word',
    size: '2.4 MB',
    uploadedAt: '2026-04-12',
    uploadedBy: 'Dra. Camila Morales',
    patientId: 'pat_02',
    category: 'Historia Clínica'
  },
  {
    id: 'file_05',
    name: 'Consentimiento_ValeriaSotomayor_Digital.pdf',
    type: 'pdf',
    size: '800 KB',
    uploadedAt: '2026-04-10',
    uploadedBy: 'Soporte Administrativo',
    patientId: 'pat_02',
    category: 'Consentimiento'
  },
  {
    id: 'file_06',
    name: 'Base_De_Datos_Exportada_EHR_Seguridad.sql',
    type: 'sql',
    size: '14.5 MB',
    uploadedAt: '2026-05-22',
    uploadedBy: 'Administrador Alejandro R.',
    category: 'Copias de Seguridad'
  },
  {
    id: 'file_07',
    name: 'Convenios_Prevision_Social_2026.xlsx',
    type: 'excel',
    size: '4.2 MB',
    uploadedAt: '2026-01-15',
    uploadedBy: 'Auditoría Gerencial',
    category: 'Otros'
  },
  {
    id: 'file_08',
    name: 'Analisis_RAG_Contexto_Ansiedad_Sura.json',
    type: 'text',
    size: '340 KB',
    uploadedAt: '2026-05-20',
    uploadedBy: 'Procesamiento RAG Dr.Mind',
    patientId: 'pat_01',
    category: 'Análisis IA'
  }
];

export const psychometricTestsCatalogue: PsychometricTest[] = [
  {
    id: 'test_01',
    name: 'BAI (Beck Anxiety Inventory)',
    description: 'Inventario de 21 ítems que evalúa la severidad de los síntomas de ansiedad del paciente, discriminando afecciones somáticas y cognitivas.',
    category: 'Ansiedad y Depresión',
    duration: '10 min',
    difficulty: 'Baja'
  },
  {
    id: 'test_02',
    name: 'BDI-II (Beck Depression Inventory)',
    description: 'Herramienta de auto-reporte con 21 preguntas de opción múltiple para medir la gravedad de la depresión clínica en adolescentes y adultos.',
    category: 'Ansiedad y Depresión',
    duration: '15 min',
    difficulty: 'Baja'
  },
  {
    id: 'test_03',
    name: 'MMPI-2 (Inventario de Personalidad Multifásico de Minnesota)',
    description: 'Evaluación exhaustiva de la personalidad y psicopatología para identificar rasgos clínicos, escalas de validez y estructuración caracterológica.',
    category: 'Personalidad',
    duration: '90 min',
    difficulty: 'Alta'
  },
  {
    id: 'test_04',
    name: 'Test de Mini-Mental (MMSE)',
    description: 'Tamizaje rápido de estado cognitivo global explorando orientación, registro, memoria, atención y lenguaje.',
    category: 'Cognitivo',
    duration: '15 min',
    difficulty: 'Media'
  },
  {
    id: 'test_05',
    name: 'MCMI-IV (Inventario Clínico Multiaxial de Millon)',
    description: 'Evaluación avanzada del funcionamiento de personalidad y trastornos clínicos de las escalas del DSM-5.',
    category: 'Personalidad',
    duration: '50 min',
    difficulty: 'Alta'
  }
];

export const initialPatientTests: PatientTestState[] = [
  {
    id: 'pt_01',
    testId: 'test_01',
    testName: 'BAI (Beck Anxiety Inventory)',
    patientId: 'pat_01',
    patientName: 'Sebas Martínez Ocampo',
    status: 'completado',
    sentDate: '2026-05-14',
    completedDate: '2026-05-15',
    score: '24 (Ansiedad Moderada)'
  },
  {
    id: 'pt_02',
    testId: 'test_03',
    testName: 'MMPI-2 (Inventario Personalidad)',
    patientId: 'pat_01',
    patientName: 'Sebas Martínez Ocampo',
    status: 'enviado',
    sentDate: '2026-05-18'
  },
  {
    id: 'pt_03',
    testId: 'test_02',
    testName: 'BDI-II (Beck Depression Inventory)',
    patientId: 'pat_02',
    patientName: 'Valeria Sotomayor',
    status: 'completado',
    sentDate: '2026-05-10',
    completedDate: '2026-05-12',
    score: '18 (Depresión Leve a Moderada)'
  },
  {
    id: 'pt_04',
    testId: 'test_04',
    testName: 'Test de Mini-Mental (MMSE)',
    patientId: 'pat_03',
    patientName: 'Andrés Felipe Correa',
    status: 'pendiente',
    sentDate: '2026-05-20'
  }
];

export const initialVideoSessions: VideoSession[] = [
  {
    id: 'vid_01',
    patientId: 'pat_01',
    patientName: 'Sebas Martínez Ocampo',
    time: '08:30 - 09:30 AM',
    date: '2026-05-22',
    status: 'en_progreso',
    roomUrl: 'https://ais-dev-oh3v5rpfceidcvhibtqgjw.run.app/rooms/sebas-martinez-cbd1',
    notes: 'Sesión de seguimiento de ansiedad laboral.'
  },
  {
    id: 'vid_02',
    patientId: 'pat_02',
    patientName: 'Valeria Sotomayor',
    time: '11:00 - 12:00 PM',
    date: '2026-05-22',
    status: 'programada',
    roomUrl: 'https://ais-dev-oh3v5rpfceidcvhibtqgjw.run.app/rooms/valeria-sotomayor-bvf9'
  },
  {
    id: 'vid_03',
    patientId: 'pat_03',
    patientName: 'Andrés Felipe Correa',
    time: '02:30 - 03:30 PM',
    date: '2026-05-22',
    status: 'programada',
    roomUrl: 'https://ais-dev-oh3v5rpfceidcvhibtqgjw.run.app/rooms/andres-correa-zpx2'
  },
  {
    id: 'vid_04',
    patientId: 'pat_04',
    patientName: 'Daniela Castro Pérez',
    time: '04:00 - 05:00 PM',
    date: '2026-05-23',
    status: 'programada',
    roomUrl: 'https://ais-dev-oh3v5rpfceidcvhibtqgjw.run.app/rooms/daniela-castro-xmd8'
  }
];

export const initialTenantDomains: TenantDomain[] = [
  {
    id: 'ten_01',
    organization: 'MindPsic Colmédica Clínicas',
    domain: 'colmedica.mindpsic.com',
    status: 'active',
    dbConnection: 'postgresql://colmedica_prod:********@cloudsql-uswest2.gcp.net/clinics_db',
    createdAt: '2025-02-14',
    usersLimit: 150,
    usersActive: 112,
    region: 'us-west2 (Oregon)'
  },
  {
    id: 'ten_02',
    organization: 'MindHealth Sura Corporativo',
    domain: 'sura-corporate.mindhealth.co',
    status: 'active',
    dbConnection: 'postgresql://sura_corp:********@cloudsql-uswest2.gcp.net/sura_mind_db',
    createdAt: '2025-06-01',
    usersLimit: 500,
    usersActive: 384,
    region: 'us-west2 (Oregon)'
  },
  {
    id: 'ten_03',
    organization: 'Centro Psicológico Avanzado Bogotá',
    domain: 'bogota-alivio.mindhealth.co',
    status: 'active',
    dbConnection: 'postgresql://bogota_alivio_db:********@postgres-rds-gcp.net/alivio_db',
    createdAt: '2025-09-18',
    usersLimit: 40,
    usersActive: 31,
    region: 'us-east4 (N. Virginia)'
  },
  {
    id: 'ten_04',
    organization: 'Clínica Sanamente Medellín (Prueba)',
    domain: 'medellin-test.mindpsic.com',
    status: 'suspended',
    dbConnection: 'postgresql://medellin_test:********@postgres-rds-gcp.net/medellin_test_db',
    createdAt: '2026-03-01',
    usersLimit: 10,
    usersActive: 1,
    region: 'us-west2 (Oregon)'
  }
];

export const mockPsychologistsPerformance: PsychologistPerformance[] = [
  {
    id: 'psy_01',
    name: 'Dra. Camila Morales Vega',
    specialty: 'Terapia Cognitivo-Conductual',
    activePatients: 24,
    satisfactionRate: 98,
    completedSessions: 142,
    tenantId: 'ten_02'
  },
  {
    id: 'psy_02',
    name: 'Dr. Roberto Carvajal',
    specialty: 'Gestalt y Duelo Complejo',
    activePatients: 19,
    satisfactionRate: 95,
    completedSessions: 98,
    tenantId: 'ten_01'
  },
  {
    id: 'psy_03',
    name: 'Dra. Luisa María Estrada',
    specialty: 'Neuropsicología Infantil',
    activePatients: 29,
    satisfactionRate: 96,
    completedSessions: 210,
    tenantId: 'ten_02'
  },
  {
    id: 'psy_04',
    name: 'Dr. Fernando Lopera',
    specialty: 'Adicciones y Trauma Clínico',
    activePatients: 15,
    satisfactionRate: 91,
    completedSessions: 84,
    tenantId: 'ten_03'
  }
];

export const legalDisclosureSpanish = `Declaración de Consentimiento para el Tratamiento de Datos Personales y Datos de Salud según los estándares de la Ley 1581 de 2012 y el Reglamento de General de Protección de Datos (RGPD) en Telemedicina y Salud Mental.

MindPsic y MindHealth, en calidad de responsables de los datos clínicos y terapéuticos recogidos en este expediente digital, garantizan que toda la información consignada se almacena utilizando protocolos de encriptación TLS 1.3 en reposo y tránsito, de conformidad con la norma ISO 27001 y los requisitos normativos pertinentes en materia de Historias Clínicas Electrónicas.

Usted autoriza voluntariamente el tratamiento de sus datos sensibles de carácter médico, evoluciones psicológicas, reportes diagnósticos y resultados de pruebas psicométricas con el único fin de proveer acompañamiento clínico idóneo, generar reportes auxiliados por inteligencia artificial (asistente de soporte clínico Dr.Mind) de forma interna, y optimizar su proceso terapéutico. Sus datos nunca serán vendidos, transferidos o publicados bajo ningún concepto no clínico o ajeno a su expreso consentimiento.`;

// ============================================================================
// RESEARCH & PHARMACEUTICAL DATA — Mantiene arquitectura clínica intacta
// ============================================================================

export const researchProjects: ResearchProject[] = [
  {
    id: 'proj_01',
    code: 'FARMA-2026-ANSX-001',
    title: 'Evaluación de eficacia de NSP-4521 en trastornos de ansiedad generalizada',
    description: 'Estudio clínico aleatorizado, doble ciego, controlado con placebo para evaluar la eficacia y seguridad de NSP-4521 vs. placebo en pacientes con TAG. Enrolamiento de 200 sujetos en 6 centros de investigación.',
    principalInvestigator: 'Dr. Carlos Mendoza González',
    pharmaPartner: 'NeuroSynaptic Pharmaceuticals Inc.',
    startDate: '2026-01-15',
    endDate: '2026-12-30',
    targetSubjects: 200,
    enrolledSubjects: 87,
    status: 'reclutamiento',
    protocolFile: 'FARMA-2026-ANSX-001_Protocol_V2.3_Approved.pdf'
  },
  {
    id: 'proj_02',
    code: 'FARMA-2026-DEPR-002',
    title: 'Bioensayo de PharmaGEN-DS78 para depresión resistente al tratamiento',
    description: 'Estudio observacional prospectivo de 48 semanas evaluando marcadores biológicos y respuesta clínica en 150 pacientes con depresión refractaria tratados con PharmaGEN-DS78.',
    principalInvestigator: 'Dra. María Isabel Restrepo',
    pharmaPartner: 'GenesisMed Therapeutics',
    startDate: '2026-03-01',
    endDate: '2027-02-28',
    targetSubjects: 150,
    enrolledSubjects: 112,
    status: 'activo',
    protocolFile: 'FARMA-2026-DEPR-002_EOA_Signed.pdf'
  },
  {
    id: 'proj_03',
    code: 'FARMA-2025-SLEEP-003',
    title: 'Estudio cruzado de SLEEP-X en insomnio crónico',
    description: 'Crossover randomizado, doble ciego de 12 semanas evaluando SLEEP-X vs. zolpidem en insomnio de mantenimiento. N=120, 2 grupos paralelos.',
    principalInvestigator: 'Dr. Roberto Carvajal',
    pharmaPartner: 'SleepScience Pharma Ltd.',
    startDate: '2025-09-01',
    endDate: '2026-06-30',
    targetSubjects: 120,
    enrolledSubjects: 120,
    status: 'finalizado'
  }
];

export const researchSubjects: ResearchSubject[] = [
  {
    id: 'res_01',
    code: 'FARMA-2026-ANSX-0087',
    name: 'Juanita López Martínez',
    email: 'juanita.lopez@gmail.com',
    phone: '+57 321 654 3210',
    gender: 'Femenino',
    age: 36,
    recruitmentDate: '2026-04-10',
    enrollmentDate: '2026-04-15',
    projectId: 'proj_01',
    screeningStatus: 'enrolled',
    consentStatus: 'firmado',
    lastDataCollectionDate: '2026-05-20',
    screeningDataCount: 3,
    status: 'Activo'
  },
  {
    id: 'res_02',
    code: 'FARMA-2026-ANSX-0088',
    name: 'Fernando García Sánchez',
    email: 'fgarcia.pharma@outlook.com',
    phone: '+57 312 456 7890',
    gender: 'Masculino',
    age: 42,
    recruitmentDate: '2026-04-12',
    enrollmentDate: '2026-04-20',
    projectId: 'proj_01',
    screeningStatus: 'enrolled',
    consentStatus: 'firmado',
    lastDataCollectionDate: '2026-05-18',
    screeningDataCount: 3,
    status: 'Activo'
  },
  {
    id: 'res_03',
    code: 'FARMA-2026-DEPR-0115',
    name: 'Carmen Rosario Díaz',
    email: 'c.diaz.rosa@gmail.com',
    phone: '+57 314 789 2345',
    gender: 'Femenino',
    age: 55,
    recruitmentDate: '2026-02-28',
    enrollmentDate: '2026-03-10',
    projectId: 'proj_02',
    screeningStatus: 'enrolled',
    consentStatus: 'firmado',
    lastDataCollectionDate: '2026-05-21',
    screeningDataCount: 8,
    status: 'Activo'
  },
  {
    id: 'res_04',
    code: 'FARMA-2026-ANSX-0085',
    name: 'Andrés Quintero Ruiz',
    email: 'a.quintero@pharmastudies.com',
    phone: '+57 318 765 4321',
    gender: 'Masculino',
    age: 28,
    recruitmentDate: '2026-04-05',
    projectId: 'proj_01',
    screeningStatus: 'screened',
    consentStatus: 'pendiente',
    screeningDataCount: 1,
    status: 'Inactivo'
  }
];

export const screeningDataCollection: ScreeningData[] = [
  {
    id: 'screen_01',
    subjectId: 'res_01',
    projectId: 'proj_01',
    screeningDate: '2026-04-10',
    screener: 'Dra. Camila Morales',
    screeningStatus: 'screened',
    inclusionCriteria: {
      'edad_18_65': true,
      'diagnostico_confirmado_gad': true,
      'score_gad7_10_o_superior': true,
      'estable_medicacion': true
    },
    exclusionCriteria: {
      'embarazo': false,
      'ideacion_suicida_activa': false,
      'psicosis': false,
      'dependencia_sustancias': false
    },
    notes: 'Paciente cumple todos los criterios de inclusión. Disponibilidad horaria confirmada.',
    rawData: {
      'gad7_score': 18,
      'phq9_score': 11,
      'baseline_bp': '120/80',
      'baseline_hr': 78
    }
  },
  {
    id: 'screen_02',
    subjectId: 'res_01',
    projectId: 'proj_01',
    screeningDate: '2026-05-10',
    screener: 'Dra. Camila Morales',
    screeningStatus: 'enrolled',
    inclusionCriteria: {
      'edad_18_65': true,
      'diagnostico_confirmado_gad': true,
      'score_gad7_10_o_superior': true,
      'estable_medicacion': true
    },
    exclusionCriteria: {
      'embarazo': false,
      'ideacion_suicida_activa': false,
      'psicosis': false,
      'dependencia_sustancias': false
    },
    notes: 'Enrolada en el estudio. Primera dosis del medicamento administrada.',
    rawData: {
      'week_2_gad7': 16,
      'week_2_phq9': 10,
      'medication_adherence': 0.95,
      'adverse_events': 'leve cefalea - sin acción requerida'
    }
  },
  {
    id: 'screen_03',
    subjectId: 'res_03',
    projectId: 'proj_02',
    screeningDate: '2026-02-28',
    screener: 'Dr. Roberto Carvajal',
    screeningStatus: 'enrolled',
    inclusionCriteria: {
      'edad_30_70': true,
      'tdd_refractaria': true,
      'minimo_2_intentos_previos': true,
      'score_madrs_20_o_superior': true
    },
    exclusionCriteria: {
      'trastorno_bipolar': false,
      'historia_psicosis': false,
      'embarazo_lactancia': false,
      'enfermedad_hepatica_severa': false
    },
    notes: 'Paciente con depresión resistente de 15 años. Candidata ideal para el bioensayo.',
    rawData: {
      'madrs_baseline': 34,
      'cortisol_matinal_baseline': 18.5,
      'bdnf_baseline': 24.3,
      'mri_pending': true
    }
  }
];

export const researchAppointments: ResearchAppointment[] = [
  {
    id: 'res_apt_01',
    subjectId: 'res_01',
    subjectName: 'Juanita López Martínez',
    projectId: 'proj_01',
    dayIndex: 0,
    timeSlot: '09:00 - 10:00',
    appointmentType: 'toma de datos',
    estatus: 'Confirmada',
    modalidad: 'Presencial',
    notes: 'Recolección de vitales y saliva para cortisol matinal. Ayuno requerido.'
  },
  {
    id: 'res_apt_02',
    subjectId: 'res_02',
    subjectName: 'Fernando García Sánchez',
    projectId: 'proj_01',
    dayIndex: 1,
    timeSlot: '14:00 - 15:00',
    appointmentType: 'evaluación',
    estatus: 'Confirmada',
    modalidad: 'Virtual',
    roomUrl: 'https://meet.jit.si/pharma_study_fernando_garcia',
    notes: 'Evaluación clínica de eficacia y seguridad. Escala GAD-7, PHQ-9.'
  },
  {
    id: 'res_apt_03',
    subjectId: 'res_03',
    subjectName: 'Carmen Rosario Díaz',
    projectId: 'proj_02',
    dayIndex: 2,
    timeSlot: '10:30 - 11:30',
    appointmentType: 'toma de datos',
    estatus: 'Confirmada',
    modalidad: 'Presencial',
    notes: 'Extracción de sangre para análisis de BDNF, citocinas inflamatorias y metabolómica.'
  },
  {
    id: 'res_apt_04',
    subjectId: 'res_04',
    subjectName: 'Andrés Quintero Ruiz',
    projectId: 'proj_01',
    dayIndex: 3,
    timeSlot: '15:30 - 16:30',
    appointmentType: 'entrevista',
    estatus: 'Pendiente',
    modalidad: 'Virtual',
    roomUrl: 'https://meet.jit.si/pharma_screening_andres_q',
    notes: 'Entrevista de screening final y firma de consentimiento informado.'
  }
];
