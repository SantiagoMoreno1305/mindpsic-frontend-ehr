/**
 * auth.ts — helper de login para las pruebas E2E
 *
 * En vez de llenar el formulario de login (no tenemos las contraseñas
 * reales de los usuarios de socios_de_pruebas), se inyecta un JWT válido
 * directamente en localStorage — mismo mecanismo de auth de desarrollo local
 * que se usó toda la sesión para probar el backend (JWT_SECRET local, ver
 * Mind/lambda-nodejs-backend/.env). App.tsx restaura currentUser de forma
 * síncrona desde localStorage.mind_user al montar (ver restoreUserFromStorage
 * en App.tsx) y luego GET /auth/sync lo refresca contra Prisma — por eso hay
 * que sembrar tanto mind_token como mind_user, no solo el token.
 */
import { Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import { TestUser } from './testUsers';

// Mismo secreto que Mind/lambda-nodejs-backend/.env (JWT_SECRET) — SOLO para
// desarrollo local, nunca usar en producción.
const LOCAL_JWT_SECRET = 'mindpsic_local_dev_secret_no_usar_en_prod';

export function signTestToken(user: TestUser): string {
  return jwt.sign(
    { sub: user.id, id: user.id, tenantId: user.tenantId, role: user.role, email: user.email, name: user.name },
    LOCAL_JWT_SECRET
  );
}

export async function loginAs(page: Page, user: TestUser): Promise<void> {
  const token = signTestToken(user);
  const storedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  };

  // Primero hay que estar en el origen correcto para poder escribir su
  // localStorage — una página en blanco no tiene origen navegable.
  await page.goto('/');
  await page.evaluate(
    ({ token, storedUser }) => {
      localStorage.setItem('mind_token', token);
      localStorage.setItem('mind_user', JSON.stringify(storedUser));
    },
    { token, storedUser }
  );
  await page.reload();
}
