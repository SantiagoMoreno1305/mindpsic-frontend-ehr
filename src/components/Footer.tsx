/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Shield, Eye, Scale, FileText, ChevronRight, X } from 'lucide-react';
import { legalDisclosureSpanish } from '../data/mockData';

export default function Footer() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <footer className="bg-charcoal-900 text-toast-100 py-8 px-6 mt-12 border-t border-charcoal-800">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        {/* Licensing and Identity */}
        <div>
          <div className="flex items-center space-x-2 text-white font-semibold text-sm mb-1">
            <Shield className="w-4 h-4 text-toast-400" />
            <span>Infraestructura Segura MindPsic &amp; MindHealth</span>
          </div>
          <p className="text-xs text-slate-500 max-w-md">
            Todos los expedientes y notas clínicas están encriptados utilizando algoritmos certificados de estándar médico (TLS 1.3 / AES-256). Cumple con la Ley 1581 de 2012 de Habeas Data y directrices de teleorientación en salud.
          </p>
        </div>

        {/* Regulatory links and legal actions */}
        <div className="flex flex-wrap gap-4 text-xs font-medium">
          <button
            onClick={() => setIsOpen(true)}
            id="btn-footer-data-policy"
            className="flex items-center space-x-1 hover:text-white transition-colors cursor-pointer text-slate-400"
          >
            <Scale className="w-3.5 h-3.5 text-slate-500" />
            <span>Tratamiento de Datos</span>
            <ChevronRight className="w-3 h-3" />
          </button>
          
          <div className="h-4 w-[1px] bg-slate-800 hidden sm:block" />

          <span className="text-slate-600 flex items-center space-x-1 font-mono">
            <span>ISO 27001 Certified</span>
          </span>
          <span className="text-slate-600 flex items-center space-x-1 font-mono">
            <span>HIPAA Telehealth Compliant</span>
          </span>
        </div>

        {/* Timestamp of access */}
        <div className="text-right text-slate-600 text-[10px] font-mono">
          <span>SERVER STATE: ACTIVE (PORT 3000)</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto text-center mt-6 pt-4 border-t border-slate-800/50 text-[11px] text-slate-600">
        © 2026 Ecosistema Clínico MindPsic &amp; MindHealth. Todos los derechos reservados. El procesamiento de resúmenes clínicos está respaldado por el motor híbrido Dr.Mind LLM.
      </div>

      {/* Elegant Modal Dialog for Habeas Data Disclosure */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-charcoal-900 to-charcoal-950 px-6 py-4 text-white flex items-center justify-between border-b border-toast-200">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-toast-400" />
                <h3 className="font-bold text-base tracking-tight">Política de Tratamiento de Datos Personales</h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-300 hover:text-white rounded-lg p-1 hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 max-h-[60vh] overflow-y-auto text-slate-600 space-y-4">
              <p className="font-semibold text-slate-900 text-sm">
                Compromiso de Confidencialidad y Cumplimiento Normativo (Ecosistema MindPsic - MindHealth)
              </p>
              
              <div className="bg-slate-50 p-4 rounded-xl text-xs font-mono border border-slate-200 text-slate-700 whitespace-pre-line leading-relaxed">
                {legalDisclosureSpanish}
              </div>

              <div className="space-y-2 text-xs leading-relaxed">
                <p className="font-semibold text-slate-800">Derechos de los Usuarios:</p>
                <ul className="list-disc list-inside space-y-1 text-slate-500">
                  <li>Consultar y actualizar en cualquier momento su información en las historias clínicas.</li>
                  <li>Solicitar la revocatoria de autorización de uso no clínico cuando lo considere pertinente.</li>
                  <li>Inamovilidad del registro evolutivo clínico firmado digitalmente por su correspondiente psicólogo de cabecera.</li>
                </ul>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-slate-100 px-6 py-4 bg-slate-50 flex justify-end">
              <button
                onClick={() => setIsOpen(false)}
                className="bg-slate-900 text-white rounded-xl px-4 py-2 text-xs font-semibold hover:bg-slate-800 transition-colors shadow-sm cursor-pointer"
              >
                Entendido y Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}
