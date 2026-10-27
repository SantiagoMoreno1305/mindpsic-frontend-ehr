/**
 * ClinicalRecordsPanel.tsx
 *
 * "Historias Clínicas" del menú lateral (decisión 2026-10-27, rediseño
 * completo) — antes abría directo la misma lista de pacientes a la que ya
 * se llega desde "Pacientes", repitiendo esa vista sin aportar nada propio.
 * Ahora es una bandeja con dos pestañas:
 *
 *   Pendientes  — documentación por registrar/completar/firmar (ver
 *                 PendingDocumentationTab.tsx). Pestaña por defecto: es el
 *                 contenido nuevo real.
 *   Expedientes — el índice de pacientes para localizar y abrir un
 *                 expediente (sigue siendo ClinicalRecordsList por ahora —
 *                 su rediseño según la especificación completa, con
 *                 columnas de profesional/estado del proceso/documentación
 *                 pendiente, queda para una siguiente tanda).
 *
 * Ambas pestañas llevan al mismo ClinicalPatientChart de siempre — este
 * componente no toca la ficha individual.
 */
import { useState } from 'react';
import ClinicalRecordsList from './ClinicalRecordsList';
import PendingDocumentationTab from './PendingDocumentationTab';

interface RealPatient {
  id: string;
  firstName: string;
  lastName: string;
  documentId: string;
  email?: string | null;
  phone?: string | null;
  recordNumber?: string | null;
}

type HistoriaTab = 'pendientes' | 'expedientes';

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative whitespace-nowrap px-1 pb-2.5 text-sm font-semibold transition-colors cursor-pointer border-b-2 ${
        active ? 'border-charcoal-900 text-charcoal-900' : 'border-transparent text-slate-400 hover:text-charcoal-900'
      }`}
    >
      {label}
    </button>
  );
}

export default function ClinicalRecordsPanel({ token, userRole, patients, onSelectPatient }: {
  token: string | null;
  userRole?: string;
  patients: RealPatient[];
  onSelectPatient: (patientId: string) => void;
}) {
  const [tab, setTab] = useState<HistoriaTab>('pendientes');
  // Alcance — una sola etiqueta, sin selector (decisión 2026-10-27): ningún
  // rol existente tiene hoy más de un alcance posible en esta sección (no
  // hay "equipo"/supervisor en el modelo), así que mostrar un control para
  // elegir entre opciones que no existen sería confuso.
  const scopeLabel = userRole === 'ESPECIALISTA_B2B' ? 'Mis pacientes' : 'Clínica';

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal-900">Historias Clínicas</h1>
        <p className="mt-1 text-sm text-slate-500">Gestiona la documentación de tus pacientes</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex items-center gap-5">
          <TabButton active={tab === 'pendientes'} label="Pendientes" onClick={() => setTab('pendientes')} />
          <TabButton active={tab === 'expedientes'} label="Expedientes" onClick={() => setTab('expedientes')} />
        </div>
        <span className="mb-2 inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
          {scopeLabel}
        </span>
      </div>

      {tab === 'pendientes' && (
        <PendingDocumentationTab token={token} userRole={userRole} onSelectPatient={onSelectPatient} />
      )}
      {tab === 'expedientes' && (
        <ClinicalRecordsList patients={patients} onSelect={onSelectPatient} />
      )}
    </div>
  );
}
