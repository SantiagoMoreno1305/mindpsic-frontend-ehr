import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { DIRECTIVO_SOCIOS_PRUEBAS } from './helpers/testUsers';

// Regresión del ícono "Ver perfil del paciente" agregado a
// DelegatedAppointmentModal (decisión 2026-10-29) — no crea datos: solo
// selecciona un paciente YA existente en el agendamiento y confirma que el
// ícono navega a su ficha, cerrando el modal.
test('el ícono junto al paciente en el modal de cita abre su perfil', async ({ page }) => {
  await loginAs(page, DIRECTIVO_SOCIOS_PRUEBAS);
  await page.getByRole('button', { name: 'Pacientes', exact: true }).click();
  await page.getByRole('button', { name: 'Agendar cita' }).click();

  await page.getByPlaceholder('Buscar paciente por nombre o documento…').fill('Camila');
  // "Camila Andrea Peña" sola también matchea la fila de la tabla detrás
  // del modal (mismo problema resuelto antes en flujo-completo-paciente) —
  // el resultado del dropdown es el único con el sufijo " — CC <documento>".
  const resultText = 'Camila Andrea Peña — CC 4000000016';
  await expect(page.getByText(resultText, { exact: false })).toBeVisible({ timeout: 5000 });
  const dispatched = await page.evaluate((text) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find((b) => b.textContent?.toLowerCase().includes(text.toLowerCase()));
    if (!target) return false;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    return true;
  }, resultText);
  expect(dispatched).toBe(true);
  await expect(page.getByText('Sin paciente seleccionado.')).toHaveCount(0);

  const viewProfileButton = page.getByTitle('Ver perfil del paciente');
  await expect(viewProfileButton).toBeVisible();
  await viewProfileButton.click();

  // El modal se cierra y navega a la ficha de Camila dentro de "Pacientes"
  // — se verifica que se salió del listado hacia una vista propia del
  // paciente, sin asumir cuál (si la Valoración Individual de esta paciente
  // no está completa, cae primero en ese formulario obligatorio antes de la
  // ficha clínica — comportamiento correcto y preexistente, no lo que este
  // spec cubre; el nombre ahí vive en inputs, no en texto plano, por eso no
  // se verifica por nombre).
  await expect(page.getByRole('heading', { name: 'Agendamiento de paciente' })).toHaveCount(0);
  await expect(page.getByText('Volver a la bandeja de pacientes')).toBeVisible({ timeout: 10000 });
  await expect(page.getByPlaceholder('Buscar por nombre, documento o código...')).toHaveCount(0);
});
