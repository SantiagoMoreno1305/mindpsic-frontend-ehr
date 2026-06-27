import React from 'react';

// Definimos las propiedades que recibirá el componente (TypeScript)
interface VideollamadaProps {
  pacienteId: string;
  salaId: string;
  tokenSesion?: string;
}

const VideollamadaVercel: React.FC<VideollamadaProps> = ({ pacienteId, salaId, tokenSesion }) => {
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