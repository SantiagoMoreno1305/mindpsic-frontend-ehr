/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * apiClient.ts — Cliente HTTP centralizado del EHR Clínico
 * ============================================================
 * Responsabilidades:
 *  1. Adjunta automáticamente el Bearer token (mind_token) a cada petición.
 *  2. Detecta respuestas 403 Forbidden del backend (tenant suspendido).
 *  3. Dispara un CustomEvent global 'forbidden-access' para que App.tsx
 *     limpie la sesión y muestre el mensaje de suspensión sin acoplamiento.
 *
 * USO:
 *   import { apiFetch } from '../lib/apiClient';
 *   const data = await apiFetch('/patients');
 */

const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:9000';

// ────────────────────────────────────────────────────────────────────────────
// EVENTO GLOBAL — 403 Forbidden
// App.tsx escucha este evento para limpiar sesión y mostrar el banner de
// suspensión sin necesidad de pasar callbacks o contextos.
// ────────────────────────────────────────────────────────────────────────────
export const FORBIDDEN_ACCESS_EVENT = 'forbidden-access';

function dispatchForbiddenAccess(): void {
  const event = new CustomEvent(FORBIDDEN_ACCESS_EVENT, {
    bubbles: true,
    detail: {
      message:
        'El acceso para su organización se encuentra temporalmente suspendido. Contacte a su administrador.',
      timestamp: new Date().toISOString(),
    },
  });
  window.dispatchEvent(event);
}

// ────────────────────────────────────────────────────────────────────────────
// CLIENTE PRINCIPAL
// Wrapper sobre fetch nativo con adjunción automática de token y guardia 403.
// ────────────────────────────────────────────────────────────────────────────
export interface ApiClientOptions extends RequestInit {
  /** Si es true, no se adjunta el header Authorization (ej. endpoints públicos). */
  skipAuth?: boolean;
}

/**
 * Realiza una petición HTTP al backend del EHR.
 *
 * @param path    Ruta relativa al API_BASE (ej. '/patients', '/auth/sync')
 * @param options Opciones estándar de fetch + `skipAuth`
 * @returns       Response de fetch, ya verificada de errores 403.
 * @throws        Error en caso de 403 (después de despachar el evento global)
 *                o cualquier error de red.
 */
export async function apiFetch(
  path: string,
  options: ApiClientOptions = {}
): Promise<Response> {
  const { skipAuth = false, ...fetchOptions } = options;

  // Construir headers, adjuntando Bearer token si existe y no se omite auth
  const headers = new Headers(fetchOptions.headers);

  if (!skipAuth) {
    const token = localStorage.getItem('mind_token');
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  // Establecer Content-Type por defecto solo si no se establece ya
  if (!headers.has('Content-Type') && !(fetchOptions.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;

  let response: Response;

  try {
    response = await fetch(url, {
      ...fetchOptions,
      headers,
    });
  } catch (networkError: any) {
    // Error de red (sin conectividad, CORS, etc.) — propagar sin despachar evento
    console.error('[apiClient] ❌ Error de red:', networkError.message);
    throw networkError;
  }

  // ── Interceptor 403: Tenant suspendido ──────────────────────────────────
  if (response.status === 403) {
    console.warn(
      '[apiClient] 🔒 403 Forbidden recibido — dispatching forbidden-access event.',
      { url, status: response.status }
    );
    dispatchForbiddenAccess();
    throw new Error('FORBIDDEN_ACCESS: Tenant suspendido o acceso denegado.');
  }

  return response;
}

/**
 * Conveniencia: realiza una petición GET y devuelve el JSON parseado.
 */
export async function apiGet<T = unknown>(
  path: string,
  options: ApiClientOptions = {}
): Promise<T> {
  const res = await apiFetch(path, { method: 'GET', ...options });
  return res.json() as Promise<T>;
}

/**
 * Conveniencia: realiza una petición POST con body JSON y devuelve el JSON.
 */
export async function apiPost<T = unknown>(
  path: string,
  body: unknown,
  options: ApiClientOptions = {}
): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
    ...options,
  });
  return res.json() as Promise<T>;
}
