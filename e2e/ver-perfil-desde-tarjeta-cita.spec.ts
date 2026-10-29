import { execSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { DIRECTIVO_SOCIOS_PRUEBAS, ESPECIALISTA_SOCIOS_PRUEBAS, SOCIOS_DE_PRUEBAS } from './helpers/testUsers';

const BACKEND_REPO = 'C:\\Users\\osdo-\\Documents\\Git\\Mind\\lambda-nodejs-backend';
// "Camila Andrea Peña" en socios_de_pruebas — paciente real ya existente,
// no se crea ni se borra acá (solo la cita, que sí es del test).
const CAMILA_PATIENT_ID = '78c59cb7-869e-4b8b-a4c3-249679656786';

function runBackendScript(script: string): string {
  return execSync(`node -e "${script.replace(/"/g, '\\"')}"`, { cwd: BACKEND_REPO, encoding: 'utf-8' });
}

// Regresión del ícono en la TARJETA de la cita del Tablero Gerencial
// (decisión 2026-10-29) — pedido explícito: ir al perfil del paciente
// "afuera, sin tener que entrar a la tarjeta de la cita".
//
// Crea una cita de HOY directo en la base (bypass de la UI de
// agendamiento, ya cubierta aparte en flujo-completo-paciente.spec.ts —
// acá solo hace falta que exista UNA cita hoy para tener una tarjeta que
// probar) y la borra al terminar.
test('el ícono en la tarjeta de la cita (Tablero Gerencial) va al perfil sin abrir el modal de edición', async ({ page }) => {
  const appointmentId = runBackendScript(
    `const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const date=new Date();date.setHours(15,0,0,0);const apt=await p.appointment.create({data:{tenantId:'${SOCIOS_DE_PRUEBAS}',patientId:'${CAMILA_PATIENT_ID}',userId:'${ESPECIALISTA_SOCIOS_PRUEBAS.id}',date,timeSlot:'15:00',status:'Agendado',modality:'VIRTUAL'}});console.log(apt.id);await p.$disconnect();})();`
  ).trim();

  try {
    await loginAs(page, DIRECTIVO_SOCIOS_PRUEBAS);

    // El tablero abre en vista "Mes" por defecto — esa vista no usa
    // tarjetas de cita (solo un contador por día), así que no tiene el
    // ícono. Hay que cambiar a "Día" primero, igual que en la captura
    // original del pedido.
    await page.getByRole('button', { name: 'Día', exact: true }).click();

    // "Camila Andrea Peña" aparece en varios lugares de este tablero (otro
    // historial/paneles) — el título del ícono es más específico y debería
    // existir una sola vez (una cita hoy = una tarjeta).
    const viewProfileButton = page.getByTitle('Ver perfil del paciente');
    await expect(viewProfileButton).toBeVisible({ timeout: 10000 });
    await viewProfileButton.click();

    // No debe abrirse el modal de agendamiento/edición — el clic en el
    // ícono no debió burbujear al onClick de la tarjeta.
    await expect(page.getByRole('heading', { name: 'Agendamiento de paciente' })).toHaveCount(0);
    // Navega fuera del Tablero Gerencial hacia la ficha del paciente dentro
    // de "Pacientes".
    await expect(page.getByText('Volver a la bandeja de pacientes')).toBeVisible({ timeout: 10000 });
  } finally {
    runBackendScript(
      `const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{await p.appointment.delete({where:{id:'${appointmentId}'}});await p.$disconnect();})();`
    );
  }
});
