import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { DIRECTIVO_SOCIOS_PRUEBAS, ESPECIALISTA_SOCIOS_PRUEBAS } from './helpers/testUsers';

test('DIRECTIVO entra a AdminPortal y ve el menú esperado', async ({ page }) => {
  await loginAs(page, DIRECTIVO_SOCIOS_PRUEBAS);

  await expect(page.getByText('Pacientes', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Historias Clínicas', { exact: true })).toBeVisible();
  await expect(page.getByText('Convenios', { exact: true })).toBeVisible();
  await expect(page.getByText('Equipo y Accesos', { exact: true })).toBeVisible();
  // "Mi Plan" — solo CEO/DIRECTIVO (construido esta sesión)
  await expect(page.getByText('Mi Plan', { exact: true })).toBeVisible();
});

test('ESPECIALISTA_B2B entra a PsychologistPortal y ve el menú esperado', async ({ page }) => {
  await loginAs(page, ESPECIALISTA_SOCIOS_PRUEBAS);

  await expect(page.getByText('Pacientes', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Historias Clínicas', { exact: true })).toBeVisible();
  // Un especialista no ve "Convenios" ni "Equipo y Accesos" — esos solo existen en AdminPortal.
  await expect(page.getByText('Convenios', { exact: true })).toHaveCount(0);
});
