import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { DIRECTIVO_SOCIOS_PRUEBAS, ESPECIALISTA_SOCIOS_PRUEBAS } from './helpers/testUsers';

// Regresión reportada en producción (commit e7ac780): un ESPECIALISTA_B2B
// entrando en "Pacientes" persiste viewTab='mine' en sessionStorage (clave
// fija, sin distinguir usuario/rol). Si DESPUÉS, en la MISMA pestaña del
// navegador, entra un CEO/DIRECTIVO/OPERATIVO, debía partir en "Todos" —
// antes heredaba "Mis Pacientes", que ni siquiera le corresponde (no es
// psicólogo tratante). `loginAs` no pasa por el logout/login reales (no
// limpia sessionStorage), así que este test aísla específicamente el fix
// de PacientesPanel (ignorar un viewTab='mine' restaurado si el usuario
// actual no es ESPECIALISTA_B2B) — no depende de la limpieza en App.tsx.
test('un DIRECTIVO no hereda "Mis Pacientes" de un ESPECIALISTA_B2B en la misma pestaña del navegador', async ({ page }) => {
  await loginAs(page, ESPECIALISTA_SOCIOS_PRUEBAS);
  await page.getByRole('button', { name: 'Pacientes', exact: true }).click();
  // "Mis Pacientes" es la pestaña activa por defecto para un especialista —
  // border-charcoal-900 es la clase que TabButton aplica solo a la activa.
  await expect(page.getByRole('button', { name: /Mis Pacientes/i })).toHaveClass(/border-charcoal-900/);

  // Mismo browser context/página — sessionStorage sobrevive, solo cambia
  // localStorage (mind_token/mind_user) vía loginAs, igual que si "otra
  // cuenta" entrara en la misma pestaña sin cerrar sesión explícitamente.
  await loginAs(page, DIRECTIVO_SOCIOS_PRUEBAS);
  await page.getByRole('button', { name: 'Pacientes', exact: true }).click();

  // "Mis Pacientes" no existe como pestaña para este rol (se oculta por
  // completo, no solo se desactiva) — y "Todos" debe ser la activa.
  await expect(page.getByRole('button', { name: /Mis Pacientes/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Todos/ })).toHaveClass(/border-charcoal-900/);
});
