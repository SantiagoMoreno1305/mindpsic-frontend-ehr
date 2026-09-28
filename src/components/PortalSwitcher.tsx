/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Selector de portal de la barra superior — Clínico ↔ Programas de medición.
 * Solo se pinta para cuentas con acceso a ambos (User.programsAccess = BOTH sobre
 * un socio con Programas habilitado); para el resto no existe en el DOM.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Stethoscope, ClipboardList, Check } from 'lucide-react';

export type PortalId = 'clinical' | 'programs';

interface PortalSwitcherProps {
  portal: PortalId | null;
  onChange: (portal: PortalId) => void;
}

const OPTIONS: { id: PortalId; label: string; short: string; description: string; icon: React.ReactNode }[] = [
  { id: 'clinical', label: 'Entorno clínico', short: 'Clínico', description: 'Pacientes, agenda, historias, evaluaciones y facturación', icon: <Stethoscope className="w-4 h-4" /> },
  { id: 'programs', label: 'Programas de medición', short: 'Programas', description: 'Encuestas de programa para empresas clientes', icon: <ClipboardList className="w-4 h-4" /> },
];

export default function PortalSwitcher({ portal, onChange }: PortalSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((o) => o.id === portal);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Cambiar de portal"
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all duration-150 cursor-pointer ${
          open ? 'bg-stone-100 border-stone-300 text-stone-900' : 'bg-white border-stone-200 text-stone-700 hover:border-stone-300 hover:bg-stone-50'
        }`}
      >
        {current?.icon ?? <Stethoscope className="w-4 h-4" />}
        <span className="hidden sm:inline whitespace-nowrap">{current?.label ?? 'Elegir portal'}</span>
        <span className="sm:hidden">{current?.short ?? 'Portal'}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="listbox" aria-label="Portal" className="absolute top-full left-0 mt-2 w-72 bg-white rounded-lg border border-stone-200 shadow-lg z-50 p-2">
          {OPTIONS.map((o) => {
            const active = o.id === portal;
            return (
              <button
                key={o.id}
                role="option"
                aria-selected={active}
                onClick={() => { setOpen(false); if (!active) onChange(o.id); }}
                className={`w-full flex flex-col items-start gap-1 px-3 py-2.5 rounded-md text-left transition-all duration-150 cursor-pointer ${
                  active ? 'bg-toast-50 border-l-2 border-l-toast-500' : 'hover:bg-stone-50'
                }`}
              >
                <span className="flex w-full items-center gap-2">
                  <span className={active ? 'text-toast-500' : 'text-stone-500'}>{o.icon}</span>
                  <span className="font-semibold text-sm text-stone-900">{o.label}</span>
                  {active && <Check className="ml-auto w-4 h-4 text-toast-500" aria-hidden />}
                </span>
                <span className="text-xs text-stone-500 pl-6">{o.description}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
