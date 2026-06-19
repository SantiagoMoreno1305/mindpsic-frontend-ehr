/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * supabaseClient.ts — Singleton del cliente Supabase para el EHR Clínico
 * =========================================================================
 * IMPORTANTE SOBRE CLAVES:
 *   - VITE_SUPABASE_ANON_KEY → clave PÚBLICA (anon key). Es segura en el frontend.
 *   - NUNCA exponer SUPABASE_SERVICE_ROLE_KEY aquí (solo backend/Lambda).
 *
 * USO:
 *   import { supabase } from '../lib/supabaseClient';
 *   await supabase.auth.updateUser({ password: newPassword });
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = (import.meta.env.VITE_SUPABASE_URL  as string) || '';
const SUPABASE_ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn(
    '[supabaseClient] ⚠️ VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY no están configuradas. ' +
    'El cambio de contraseña de primer ingreso no funcionará. ' +
    'Añade estas variables al .env del EHR.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    // Desactivamos la persistencia automática de sesión de Supabase porque
    // el EHR usa su propio sistema de sesión basado en JWT firmado por Node.js.
    // Supabase solo se usa aquí para la operación puntual de cambio de contraseña.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
