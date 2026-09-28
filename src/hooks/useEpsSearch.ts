/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useEpsSearch — búsqueda de EPS/IPS por nombre, con espera de 300ms para no
 * disparar una petición por cada tecla. Extraído del mismo patrón que ya
 * usaba AdminPortal.tsx (formularios de "Nuevo colaborador" / "Editar
 * colaborador") para reusarlo también en "Mi perfil".
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';

export interface EpsOption { code: string; nombre: string }

export function useEpsSearch() {
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
