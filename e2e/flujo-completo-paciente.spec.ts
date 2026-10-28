import { execSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { loginAs, signTestToken } from './helpers/auth';
import { CEO_MINDGROUP, DIRECTIVO_SOCIOS_PRUEBAS, ESPECIALISTA_SOCIOS_PRUEBAS, SOCIOS_DE_PRUEBAS } from './helpers/testUsers';

const BACKEND_REPO = 'C:\\Users\\osdo-\\Documents\\Git\\Mind\\lambda-nodejs-backend';
const CONVENIO_DE_PRUEBAS_ID = '970bff58-5e89-4aa0-955e-eb51bbf22326'; // "Convenio de pruebas" en socios_de_pruebas

const suffix = Date.now();
// Nombres/Apellidos filtran solo letras en el formulario (onlyLetters) —
// nada de dígitos acá, la unicidad real la da DOCUMENT_ID.
const FIRST_NAME = 'Flujo';
const LAST_NAME = 'PruebaEndToEnd';
const DOCUMENT_ID = String(9000000000 + (suffix % 1000000000)).slice(0, 10);
const FULL_NAME = `${FIRST_NAME} ${LAST_NAME}`;

/**
 * Corre un script Node en el repo del BACKEND (no el frontend) — necesita
 * su propio node_modules/@prisma/client, apuntado a la misma base local que
 * usa el backend. Se usa SOLO para el bypass del control de dos personas al
 * autorizar sesiones (ver más abajo) — no hay forma de automatizar ese paso
 * sin acceso a un correo real, y es una feature ya probada por separado
 * (decisión 2026-10-28, confirmada con el usuario).
 */
function runBackendScript(script: string): string {
  return execSync(`node -e "${script.replace(/"/g, '\\"')}"`, { cwd: BACKEND_REPO, encoding: 'utf-8' });
}

test('flujo completo: crear paciente, asignarle psicólogo y agendarle cita', async ({ page, request }) => {
  let patientId = '';

  await test.step('Login DIRECTIVO y abrir "Nuevo paciente"', async () => {
    await loginAs(page, DIRECTIVO_SOCIOS_PRUEBAS);
    await page.getByRole('button', { name: 'Pacientes', exact: true }).click();
    await page.getByRole('button', { name: 'Nuevo paciente' }).click();
    await expect(page.getByRole('heading', { name: 'Crear nuevo paciente' })).toBeVisible();
  });

  await test.step('Llenar "Datos personales"', async () => {
    await page.locator('#patient-firstName').fill(FIRST_NAME);
    await page.locator('#patient-lastName').fill(LAST_NAME);
    await page.getByPlaceholder('Ej. 1024556778').fill(DOCUMENT_ID);
    await page.locator('#patient-phone').fill('3101234567');
    // Fecha de nacimiento (adulto, evita la rama de representante legal para menores).
    await page.locator('label:has-text("Fecha de nacimiento") + div input[type="date"]').fill('1990-05-15');
    await page.locator('label:has-text("Correo electrónico") + input').fill(`e2e.${suffix}@example.test`);
  });

  await test.step('Llenar "Convenio y atención" — convenio existente + psicólogo asignado', async () => {
    await page.getByRole('button', { name: 'Convenio y atención' }).click();
    await page.locator('select').filter({ has: page.locator('option', { hasText: 'Selecciona un convenio' }) }).selectOption({ label: 'Convenio de pruebas' });
    await page.locator('select').filter({ has: page.locator('option', { hasText: 'Sin asignar' }) }).selectOption({ label: ESPECIALISTA_SOCIOS_PRUEBAS.name });
  });

  await test.step('Guardar y capturar el id del paciente creado', async () => {
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/patients') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Guardar paciente' }).click(),
    ]);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    patientId = body.id;
    expect(patientId).toBeTruthy();

    await expect(page.getByRole('heading', { name: 'Crear nuevo paciente' })).toHaveCount(0);
    // Un trigger de Postgres normaliza nombres a Title Case al guardar
    // ("PruebaEndToEnd" → "Pruebaendtoend") — se busca sin distinguir
    // mayúsculas en vez de asumir el casing exacto. .first() porque el
    // toast de éxito también contiene el nombre, además de la fila.
    await expect(page.getByText(new RegExp(FULL_NAME, 'i')).first()).toBeVisible({ timeout: 10000 });
  });

  await test.step('Bypass del control de dos personas — autorizar sesiones directo en BD (feature ya probada aparte)', async () => {
    runBackendScript(
      `const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{await p.sessionAuthorization.create({data:{tenantId:'${SOCIOS_DE_PRUEBAS}',patientId:'${patientId}',companyId:'${CONVENIO_DE_PRUEBAS_ID}',psychologistId:'${ESPECIALISTA_SOCIOS_PRUEBAS.id}',sessionsAuthorized:10,status:'activo',createdById:'${DIRECTIVO_SOCIOS_PRUEBAS.id}',createdByName:'${DIRECTIVO_SOCIOS_PRUEBAS.name}',source:'MANUAL'}});await p.$disconnect();})();`
    );
  });

  await test.step('Agendar la primera cita del paciente', async () => {
    await page.getByRole('button', { name: 'Agendar cita' }).click();
    await page.getByPlaceholder('Buscar paciente por nombre o documento…').fill(FIRST_NAME);
    // Mismo ajuste de casing que al confirmar la creación. El nombre del
    // paciente TAMBIÉN aparece en la fila de la tabla de "Pacientes" detrás
    // del modal (texto idéntico) — buscar por texto sin acotar encuentra
    // ESE botón en vez del resultado del dropdown, que es indistinguible
    // por nombre solo. El resultado del dropdown es el ÚNICO que trae el
    // sufijo " — CC <documento>", así que se usa ese para desambiguar.
    const resultText = `${FIRST_NAME} ${LAST_NAME} — CC ${DOCUMENT_ID}`;
    await expect(page.getByText(new RegExp(resultText, 'i'))).toBeVisible({ timeout: 5000 });
    const dispatched = await page.evaluate((text) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const target = buttons.find((b) => b.textContent?.toLowerCase().includes(text.toLowerCase()));
      if (!target) return false;
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      return true;
    }, resultText);
    expect(dispatched).toBe(true);
    await expect(page.getByText('Sin paciente seleccionado.')).toHaveCount(0);

    // Las etiquetas de este modal son <label> sueltos (sin htmlFor/id), así
    // que se ubica el <select> por el hermano adyacente en vez de getByLabel.
    await page.locator('label:has-text("Especialidad") + select').selectOption({ index: 1 });
    // selectOption({label}) exige string exacto, no regex — la opción del
    // especialista puede traer sufijo de especialidad/nivel
    // ("… – Neuropsicología (Nivel 2)"), así que se busca el <option> por
    // texto parcial y se selecciona por su value.
    const especialistaSelect = page.locator('label:has-text("Especialista (Psicólogo)") + select');
    const especialistaValue = await especialistaSelect
      .locator('option', { hasText: ESPECIALISTA_SOCIOS_PRUEBAS.name })
      .getAttribute('value');
    await especialistaSelect.selectOption(especialistaValue!);

    // Con 10 sesiones autorizadas (el bypass las creó así), el formulario
    // sugiere por defecto agendar las 10 de una vez ("¿Cuántas agendar
    // ahora?" = 10) — se ajusta a 1 para agendar solo la primera cita, que
    // es lo que se pidió.
    await page.locator('label:has-text("¿Cuántas agendar ahora?") + input').fill('1');

    // Fecha lejana en el futuro (90 días) a una hora poco común — minimiza
    // el riesgo de chocar con una cita ya existente de este especialista.
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    future.setHours(7, 0, 0, 0);
    const isoLocal = `${future.toISOString().slice(0, 10)}T07:00`;
    const dateInput = page.locator('input[type="datetime-local"]').first();
    await expect(dateInput).toBeVisible({ timeout: 5000 });
    await dateInput.fill(isoLocal);

    const confirmButton = page.getByRole('button', { name: 'Confirmar agendamiento' });
    await expect(confirmButton).toBeEnabled({ timeout: 5000 });
    await confirmButton.click();
    await expect(page.getByText('Cita creada exitosamente.')).toBeVisible({ timeout: 10000 });
  });

  await test.step('Limpieza — borra el paciente de prueba (cascada: cita + autorización de sesiones)', async () => {
    // El borrado físico es CEO-únicamente en el backend (ver deletePatient en
    // patient.controller.js) — un CEO cruza tenants, así que el del tenant
    // interno puede borrar en socios_de_pruebas. Exige el documento exacto
    // en el body como confirmación.
    const token = signTestToken(CEO_MINDGROUP);
    const res = await request.delete(`http://localhost:3001/api/patients/${patientId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { documentId: DOCUMENT_ID },
    });
    expect(res.ok()).toBeTruthy();
  });
});
