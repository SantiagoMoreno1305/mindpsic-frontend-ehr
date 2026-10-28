import { defineConfig, devices } from '@playwright/test';

/**
 * Suite E2E contra el entorno local (frontend :3002 + backend :3001 de
 * Mind/lambda-nodejs-backend) — decisión 2026-10-28: se prueba contra la
 * base local, no contra producción, porque algunos flujos crean/editan/
 * eliminan datos reales (pacientes, convenios, etc.) y la base local ya
 * tiene la misma data que producción (incluido el tenant socios_de_pruebas),
 * sin el riesgo de tocar un tenant real en vivo.
 *
 * Ambos servidores deben estar corriendo ANTES de ejecutar las pruebas — no
 * se gestionan automáticamente acá porque viven en repos separados
 * (mindpsic-frontend-ehr y Mind/lambda-nodejs-backend).
 */
export default defineConfig({
  testDir: './e2e',
  // fullyParallel:false solo serializa DENTRO de un archivo — Playwright
  // igual corría distintos specs en paralelo (6 workers) por defecto. Como
  // varios flujos comparten el tenant socios_de_pruebas contra la misma
  // base de datos (crean/editan/eliminan convenios, pacientes, etc.),
  // workers:1 fuerza serialización real entre archivos y evita una carrera
  // de datos silenciosa entre specs que hoy no chocan por suerte.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
