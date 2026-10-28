import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { DIRECTIVO_SOCIOS_PRUEBAS } from './helpers/testUsers';

// Regresión del parpadeo "Cargando…" reportado en producción al volver a
// "Historias Clínicas" — ver commit 435cce7 (sembrar el estado inicial
// desde el caché en vez de esperar al setTimeout del efecto de fetch).
test('Historias Clínicas no parpadea "Cargando…" al volver dentro del TTL del caché', async ({ page }) => {
  await loginAs(page, DIRECTIVO_SOCIOS_PRUEBAS);

  await page.getByRole('button', { name: 'Historias Clínicas', exact: true }).click();
  // Primera visita: caché frío, puede mostrar "Cargando…" — no se afirma
  // nada sobre eso, solo que termina con la tabla de "Pendientes" lista.
  // El encabezado real es "Paciente" (el CSS lo muestra en mayúsculas vía
  // text-transform, pero el texto del DOM no cambia).
  await expect(page.getByText('Paciente', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Cargando…')).toHaveCount(0, { timeout: 10000 });

  // Navega a otra pestaña (desmonta el panel) y vuelve dentro del TTL de 30s.
  await page.getByRole('button', { name: 'Tablero Gerencial', exact: true }).click();
  await page.getByRole('button', { name: 'Historias Clínicas', exact: true }).click();

  // Con caché tibio, la tabla ya debe tener filas CASI de inmediato — y en
  // ningún momento debe pasar por "Cargando…" (antes del fix, el primer
  // render siempre lo mostraba aunque hubiera caché).
  await expect(page.getByText('Cargando…')).toHaveCount(0);
  await expect(page.getByText('Paciente', { exact: true })).toBeVisible({ timeout: 1500 });
});
