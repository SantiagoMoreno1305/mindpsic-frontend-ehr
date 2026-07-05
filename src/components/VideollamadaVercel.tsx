import React from 'react';
import { Video } from 'lucide-react';

// Definimos las propiedades que recibirá el componente (TypeScript)
interface VideollamadaProps {
  pacienteId?: string;
  salaId?: string;
  tokenSesion?: string;
}

const VideollamadaVercel: React.FC<VideollamadaProps> = ({ pacienteId, salaId, tokenSesion }) => {
  if (!pacienteId || !salaId) {
    return (
      <div className="w-full h-[600px] rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-500">
        <Video className="w-12 h-12 mb-4 text-slate-300" />
        <h3 className="text-lg font-medium text-slate-700">Consola lista</h3>
        <p className="mt-2 text-sm">Esperando conexión con el paciente. Selecciona una cita para iniciar.</p>
      </div>
    );
  }

  // Construimos la URL dinámica hacia tu Vercel
  const urlVercel = `https://mindhealthips.com/?paciente=${pacienteId}&room=${salaId}&token=${tokenSesion || ''}`;

  return (
    <div className="w-full h-[600px] rounded-xl overflow-hidden border border-gray-800 bg-[#FAF6F3]">
      <iframe
        src={urlVercel}
        width="100%"
        height="100%"
        allow="camera; microphone; fullscreen; display-capture"
        className="border-none"
        title="Conectar con plataforma MindHealth"
      />
    </div>
  );
};

export default VideollamadaVercel;