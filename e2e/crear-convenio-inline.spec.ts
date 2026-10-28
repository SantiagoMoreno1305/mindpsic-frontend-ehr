import { test, expect } from '@playwright/test';
import { loginAs, signTestToken } from './helpers/auth';
import { DIRECTIVO_SOCIOS_PRUEBAS } from './helpers/testUsers';

const TEST_COMPANY_NAME = `Convenio E2E ${Date.now()}`;

test('crear un convenio nuevo sin salir del modal de "Crear paciente"', async ({ page, request }) => {
  await loginAs(page, DIRECTIVO_SOCIOS_PRUEBAS);
  await page.getByRole('button', { name: 'Pacientes', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo paciente' }).click();
  await expect(page.getByRole('heading', { name: 'Crear nuevo paciente' })).toBeVisible();

  await page.getByRole('button', { name: 'Convenio y atención' }).click();
  await page.getByRole('button', { name: 'Crear nuevo convenio' }).click();

  const nameInput = page.getByPlaceholder('Nombre del convenio / cliente corporativo...');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(TEST_COMPANY_NAME);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();

  // Tras guardar, vuelve al <select> normal con el convenio recién creado
  // ya autoseleccionado.
  const companySelect = page.locator('select').filter({ hasText: TEST_COMPANY_NAME });
  await expect(companySelect).toBeVisible({ timeout: 5000 });

  // Limpieza — borra el convenio de prueba vía la API, con el mismo token
  // de sesión que usa la página (no se deja basura en socios_de_pruebas).
  const companyId = await companySelect.inputValue();
  const token = signTestToken(DIRECTIVO_SOCIOS_PRUEBAS);
  const deleteRes = await request.delete(`http://localhost:3001/api/companies/${companyId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(deleteRes.ok()).toBeTruthy();
});
