/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Context Switcher — Hybrid Clinical + Research Workspace Toggle
 * Permite al usuario alternar entre "Entorno Clínico" y "Entorno de Investigación"
 * Diseño premium, sin colores adicionales (paleta autorizada)
 */

import { useState } from 'react';
import { ChevronDown, Stethoscope, Beaker } from 'lucide-react';

export type WorkspaceContext = 'clinical' | 'research';

interface ContextSwitcherProps {
  currentContext: WorkspaceContext;
  onContextChange: (context: WorkspaceContext) => void;
}

export default function ContextSwitcher({ currentContext, onContextChange }: ContextSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);

  const contexts: Array<{
    id: WorkspaceContext;
    label: string;
    description: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'clinical',
      label: 'Entorno Clínico',
      description: 'Atención de pacientes, RIPS, historias clínicas',
      icon: <Stethoscope className="w-4 h-4" />
    },
    {
      id: 'research',
      label: 'Investigación Farmacéutica',
      description: 'Gestión de proyectos, tamizajes, recolección de datos',
      icon: <Beaker className="w-4 h-4" />
    }
  ];

  const currentContextData = contexts.find(c => c.id === currentContext);

  const handleSelect = (context: WorkspaceContext) => {
    onContextChange(context);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg
          border transition-all duration-150 cursor-pointer
          text-sm font-medium
          ${isOpen
            ? 'bg-stone-100 border-stone-300 text-stone-900'
            : 'bg-white border-stone-200 text-stone-700 hover:border-stone-300 hover:bg-stone-50'
          }
        `}
        title={`Contexto actual: ${currentContextData?.label}`}
      >
        {currentContextData?.icon}
        <span className="hidden sm:inline">{currentContextData?.label}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-lg border border-stone-200 shadow-lg z-50">
          <div className="p-2">
            {contexts.map((context) => (
              <button
                key={context.id}
                onClick={() => handleSelect(context.id)}
                className={`
                  w-full flex flex-col items-start gap-1 px-3 py-2.5 rounded-md
                  transition-all duration-150 text-left
                  ${currentContext === context.id
                    ? 'bg-charcoal-50 border-l-2 border-l-charcoal-950'
                    : 'hover:bg-stone-50'
                  }
                `}
              >
                <div className="flex items-center gap-2">
                  <span className={currentContext === context.id ? 'text-charcoal-950' : 'text-stone-600'}>
                    {context.icon}
                  </span>
                  <span className={`font-semibold text-sm ${currentContext === context.id ? 'text-charcoal-950' : 'text-stone-900'}`}>
                    {context.label}
                  </span>
                </div>
                <span className="text-xs text-stone-500 pl-6">
                  {context.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Backdrop para cerrar dropdown */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
