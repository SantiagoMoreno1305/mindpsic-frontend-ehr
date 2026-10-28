import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { DIRECTIVO_SOCIOS_PRUEBAS } from './helpers/testUsers';

test('DIRECTIVO ve "Mi Plan" en el pie del menú y carga el estado de la suscripción', async ({ page }) => {
  await loginAs(page, DIRECTIVO_SOCIOS_PRUEBAS);

  const miPlanButton = page.getByRole('button', { name: 'Mi Plan' });
  await expect(miPlanButton).toBeVisible({ timeout: 10000 });
  await miPlanButton.click();

  await expect(page.getByRole('heading', { name: 'Mi Plan' })).toBeVisible();
  // El estado real de socios_de_pruebas: status ACTIVE, sin ConsumerPlan
  // vinculado (dado de alta a mano, no por compra web) — ver "Resumen".
  await expect(page.getByText('Contratación directa con MindPsic')).toBeVisible();
  await expect(page.getByText('Activa', { exact: true })).toBeVisible();
  // Sección de licencias con el desglose de quién las ocupa.
  await expect(page.getByText('Licencias', { exact: true })).toBeVisible();
});
