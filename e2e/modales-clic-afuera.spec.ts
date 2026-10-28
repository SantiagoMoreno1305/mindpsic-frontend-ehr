import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { DIRECTIVO_SOCIOS_PRUEBAS } from './helpers/testUsers';

test.beforeEach(async ({ page }) => {
  await loginAs(page, DIRECTIVO_SOCIOS_PRUEBAS);
});

// Esquina inferior derecha del viewport — lejos tanto de la tarjeta
// centrada del modal como del navbar/logo superior izquierdo, que puede
// interceptar un clic en (5,5).
const BACKDROP_CORNER = { x: 1270, y: 700 } as const;

test('CreatePatientModal se cierra al hacer clic fuera', async ({ page }) => {
  await page.getByRole('button', { name: 'Pacientes', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo paciente' }).click();

  const modalTitle = page.getByRole('heading', { name: 'Crear nuevo paciente' });
  await expect(modalTitle).toBeVisible();

  await page.mouse.click(BACKDROP_CORNER.x, BACKDROP_CORNER.y);
  await expect(modalTitle).toHaveCount(0);
});

test('Modal "Nuevo convenio" se cierra al hacer clic fuera', async ({ page }) => {
  await page.getByRole('button', { name: 'Convenios', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo convenio/cliente' }).click();

  // El título del modal es el mismo texto que el botón que lo abre
  // ("Nuevo convenio/cliente") — hay que desambiguar por rol (heading vs.
  // button), getByText encuentra el botón de siempre y nunca llega a 0.
  const modalHeading = page.getByRole('heading', { name: /Nuevo convenio|Editar convenio/i });
  await expect(modalHeading).toBeVisible();

  await page.mouse.click(BACKDROP_CORNER.x, BACKDROP_CORNER.y);
  await expect(modalHeading).toHaveCount(0);
});
