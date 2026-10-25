/**
 * normalizarBusqueda.ts
 *
 * Espejo en el frontend de utils/normalizar-busqueda.js (backend) — mismo
 * criterio: insensible a tildes, diacríticos, mayúsculas y espacios extra
 * ("  MARÍA   Fernanda " → "maria fernanda"). Se usa para filtros que buscan
 * sobre una lista YA cargada en el cliente (ej. ClinicalRecordsList), donde
 * no tiene sentido ir al backend por cada tecla — el buscador de GET
 * /api/patients ya normaliza del lado del servidor contra Patient.searchName.
 */
export function normalizarBusqueda(texto: string | null | undefined): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
