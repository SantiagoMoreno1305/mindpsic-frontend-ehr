/**
 * testUsers.ts
 *
 * Usuarios reales del tenant "socios_de_pruebas" (sandbox dedicado a
 * pruebas, 32 pacientes ya cargados) usados por las pruebas E2E. IDs
 * tomados directamente de la base local (misma data que production — ver
 * notas de la sesión 2026-10-27/28).
 *
 * No hay OPERATIVO en este tenant todavía — pendiente de decidir si se crea
 * uno de prueba o se cubre ese rol contra otro tenant.
 */
export interface TestUser {
  id: string;
  tenantId: string;
  role: 'CEO' | 'DIRECTIVO' | 'OPERATIVO' | 'ESPECIALISTA_B2B' | 'USUARIO_B2C';
  email: string;
  name: string;
}

export const SOCIOS_DE_PRUEBAS = 'socios_de_pruebas';

export const DIRECTIVO_SOCIOS_PRUEBAS: TestUser = {
  id: '62d5c854-e7ad-4293-907e-677c8bca2230',
  tenantId: SOCIOS_DE_PRUEBAS,
  role: 'DIRECTIVO',
  email: 'oscar.perdomo20@gmail.com',
  name: 'Oscar de Empresa de Pruebas',
};

export const ESPECIALISTA_SOCIOS_PRUEBAS: TestUser = {
  id: 'dd99bdce-3b81-4ae2-b556-cda1d762c714',
  tenantId: SOCIOS_DE_PRUEBAS,
  role: 'ESPECIALISTA_B2B',
  email: 'telefonosmindpsic.1@gmail.com',
  name: 'Psicologo de la Empresa Pruebas',
};

// CEO es un rol transversal de MindPsic (cruza tenants) — no hay uno propio
// del tenant socios_de_pruebas, se usa el del tenant interno para cubrir
// ese rol en las pruebas que lo requieran.
export const CEO_MINDGROUP: TestUser = {
  id: '19dbd480-b2d1-4bc2-8b40-ac3db64027c8',
  tenantId: 'mindgroup_hq',
  role: 'CEO',
  email: 'gerentegeneral@psicologosmindpsic.com',
  name: 'CEO MindPsic',
};
