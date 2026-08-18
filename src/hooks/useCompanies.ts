/**
 * useCompanies.ts
 *
 * Catálogo de convenios/clientes corporativos (GET /api/companies) con caché
 * compartida a nivel de módulo — mismo patrón que ya usaba
 * DelegatedAppointmentModal para specialists/companies/specialties.
 *
 * Antes, cada consumidor (PacientesPanel, CreatePatientModal, el panel de
 * Convenios de AdminPortal, el modal de agendamiento delegado) pedía
 * /api/companies por su cuenta, así que era normal ver 3-4 peticiones
 * idénticas en la misma sesión aunque el catálogo no hubiera cambiado. Este
 * hook centraliza la carga: la primera vez que cualquier componente lo monta
 * dispara la petición real; el resto reutiliza el resultado en caché durante
 * CACHE_TTL_MS, y si dos componentes lo montan casi al mismo tiempo comparten
 * la misma petición en vuelo en vez de disparar dos.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';

export interface CompanyLocation {
  id: string;
  name: string;
  address?: string | null;
}

export interface CompanyRecord {
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
  locations: CompanyLocation[];
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos — catálogo que cambia poco

let cache: { data: CompanyRecord[]; ts: number } | null = null;
let inFlight: Promise<CompanyRecord[]> | null = null;

const isCacheValid = (): boolean => !!cache && Date.now() - cache.ts < CACHE_TTL_MS;

async function loadCompanies(): Promise<CompanyRecord[]> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const res = await apiFetch('/api/companies');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list: CompanyRecord[] = Array.isArray(data) ? data : [];
    cache = { data: list, ts: Date.now() };
    return list;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Fuerza una recarga real ignorando la caché — usar tras crear/editar/eliminar un convenio. */
export function invalidateCompaniesCache(): void {
  cache = null;
}

/** Acceso imperativo a la misma caché, para consumidores que no son componentes
 *  React (p. ej. la precarga de catálogos de DelegatedAppointmentModal). */
export function getCompaniesCached(): Promise<CompanyRecord[]> {
  if (isCacheValid()) return Promise.resolve(cache!.data);
  return loadCompanies();
}

export function useCompanies() {
  const [companies, setCompanies] = useState<CompanyRecord[]>(cache?.data ?? []);
  const [loading, setLoading] = useState(!isCacheValid());
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    invalidateCompaniesCache();
    setLoading(true);
    try {
      const data = await loadCompanies();
      setCompanies(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Error al cargar convenios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isCacheValid()) {
      setCompanies(cache!.data);
      setLoading(false);
      return;
    }
    setLoading(true);
    loadCompanies()
      .then((data) => {
        setCompanies(data);
        setError(null);
      })
      .catch((err) => setError(err?.message || 'Error al cargar convenios'))
      .finally(() => setLoading(false));
  }, []);

  return { companies, loading, error, refetch };
}
