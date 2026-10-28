import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { DIRECTIVO_SOCIOS_PRUEBAS } from './helpers/testUsers';

// Estado real de socios_de_pruebas (verificado 2026-10-28): allowAccessCodes
// = false, pero ya tiene 1 código emitido — por diseño, la pestaña debe
// seguir visible (para cerrar/recordar lo ya emitido) aunque la CREACIÓN
// esté bloqueada. Este spec cubre el bug corregido en AdminPortal.tsx: con
// /api/access-codes/capability artificialmente lento, la pestaña y el botón
// de crear NO deben aparecer habilitados en ningún momento antes de que la
// respuesta llegue (fail-closed) — antes se mostraban/habilitaban por
// defecto mientras cargaba.
test('Códigos de acceso: fail-closed mientras se confirma el permiso, con red lenta', async ({ page }) => {
  await page.route('**/api/access-codes/capability', async (route) => {
    await new Promise((r) => setTimeout(r, 2000)); // simula red lenta
    await route.continue();
  });

  await loginAs(page, DIRECTIVO_SOCIOS_PRUEBAS);

  // Durante la ventana lenta, la pestaña no debe estar en el DOM todavía.
  await expect(page.getByRole('button', { name: 'Códigos de acceso' })).toHaveCount(0);

  // Una vez resuelve (hasCodes=true aunque tenantEnabled=false), la pestaña
  // aparece — pero el botón de crear debe quedar deshabilitado.
  const tab = page.getByRole('button', { name: 'Códigos de acceso' });
  await expect(tab).toBeVisible({ timeout: 5000 });
  await tab.click();

  const nuevoCodigo = page.getByRole('button', { name: 'Nuevo código' });
  await expect(nuevoCodigo).toBeVisible();
  await expect(nuevoCodigo).toBeDisabled();
  await expect(page.getByText('Tu clínica no tiene habilitada la creación de códigos de acceso')).toBeVisible();
});
