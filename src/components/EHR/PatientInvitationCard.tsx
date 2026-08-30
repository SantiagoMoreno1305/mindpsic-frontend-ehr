import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  Mail,
  MessageCircle,
  Send,
  Smartphone,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

/**
 * Invitación del paciente a la app móvil.
 *
 * Vive en la ficha del paciente porque quien invita es quien atiende, y la
 * invitación necesita la ficha: sin `documentId` no hay con qué verificar
 * identidad al canjear.
 *
 * El estado se muestra siempre, incluso cuando no hay nada que hacer. El
 * psicólogo necesita saber si su paciente ya tiene la app antes de asignarle
 * una tarea que no podría ver.
 *
 * Mismo patrón que el enlace de autoaplicación de pruebas: vencimiento que
 * elige el profesional, y reemitir anula el anterior.
 */

type EstadoInvitacion =
  | 'NONE'
  | 'PENDING'
  | 'REDEEMED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'LINKED';

type Estado = {
  state: EstadoInvitacion;
  expiresAt?: string;
  sentAt?: string;
};

type Resultado = {
  invitationUrl: string;
  sentTo: { email: string | null; phone: string | null };
  /** El paciente tiene correo o telefono registrados. */
  tieneContacto: boolean;
  /** Tenia contacto pero el envio fallo. Distinto de no tener datos. */
  envioFallido: boolean;
};

type Props = {
  patientId: string;
  patientName: string;
  /** Sin documento no se puede invitar; se avisa en vez de dejar fallar el botón. */
  tieneDocumento: boolean;
};

const VENCIMIENTO_POR_DEFECTO = 24 * 14;

function fecha(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function PatientInvitationCard({ patientId, patientName, tieneDocumento }: Props) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await apiFetch(`/api/patients/${patientId}/invitation`);
      const data = await res.json();
      if (res.ok) setEstado(data);
      else setEstado({ state: 'NONE' });
    } catch {
      setEstado({ state: 'NONE' });
    } finally {
      setCargando(false);
    }
  }, [patientId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const alInvitar = (r: Resultado) => {
    setResultado(r);
    setModalAbierto(false);
    cargar();
  };

  if (cargando) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Consultando estado de la app…
      </div>
    );
  }

  const s = estado?.state ?? 'NONE';
  const vinculado = s === 'LINKED' || s === 'REDEEMED';
  const pendiente = s === 'PENDING';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div
            className={`mt-0.5 rounded-lg p-1 ${
              vinculado ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
            }`}
          >
            <Smartphone className="h-3.5 w-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900">App móvil</h4>
            <p className="text-xs text-slate-500">
              {vinculado && 'El paciente ya tiene su cuenta activa.'}
              {pendiente &&
                `Invitación enviada. Vence el ${fecha(estado?.expiresAt)}.`}
              {s === 'EXPIRED' && 'La invitación venció sin usarse.'}
              {s === 'REVOKED' && 'La invitación fue reemplazada.'}
              {s === 'NONE' && 'Todavía no ha sido invitado.'}
            </p>
          </div>
        </div>

        {!vinculado && (
          <button
            onClick={() => setModalAbierto(true)}
            disabled={!tieneDocumento}
            title={
              tieneDocumento
                ? undefined
                : 'Registra el documento del paciente para poder verificar su identidad al canjear'
            }
            className="shrink-0 rounded-lg bg-toast-500 px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40"
          >
            {pendiente ? 'Reenviar' : 'Invitar'}
          </button>
        )}
      </div>

      {!tieneDocumento && !vinculado && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Este paciente no tiene documento registrado. Sin él no se puede verificar su identidad
            al canjear la invitación.
          </span>
        </div>
      )}

      {resultado && <ResultadoDelEnvio resultado={resultado} onCerrar={() => setResultado(null)} />}

      {modalAbierto && (
        <ModalInvitar
          patientId={patientId}
          patientName={patientName}
          yaInvitado={pendiente}
          onClose={() => setModalAbierto(false)}
          onInvitado={alInvitar}
        />
      )}
    </div>
  );
}

/**
 * Resultado del envio.
 *
 * Cuando hay correo o telefono, lo importante es a donde salio — el paciente
 * no tiene que copiar nada. El enlace queda disponible solo como respaldo
 * para quien no tiene ninguno de los dos registrados.
 */
function ResultadoDelEnvio({ resultado, onCerrar }: { resultado: Resultado; onCerrar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const { email, phone } = resultado.sentTo;
  const seEnvio = Boolean(email || phone);
  const { tieneContacto, envioFallido } = resultado;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(resultado.invitationUrl);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error('No se pudo copiar. Selecciona el enlace a mano.');
    }
  };

  return (
    <div
      className={`mt-3 rounded-lg border p-3 ${
        seEnvio ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`text-xs font-bold ${seEnvio ? 'text-emerald-800' : 'text-amber-800'}`}
        >
          {seEnvio
            ? 'Invitacion enviada'
            : envioFallido
              ? 'No se pudo enviar'
              : 'Invitacion generada'}
        </span>
        <button
          onClick={onCerrar}
          className={seEnvio ? 'text-emerald-600 hover:text-emerald-900' : 'text-amber-600 hover:text-amber-900'}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {seEnvio ? (
        <div className="space-y-1">
          {email && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-800">
              <Mail className="h-3.5 w-3.5 shrink-0" /> {email}
            </p>
          )}
          {phone && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-800">
              <MessageCircle className="h-3.5 w-3.5 shrink-0" /> WhatsApp a {phone}
            </p>
          )}
          <p className="pt-1 text-[11px] text-emerald-700">
            Al abrir el enlace se le pedira su numero de documento para confirmar que es el.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-amber-800">
            {envioFallido
              ? 'La invitacion se creo, pero no se pudo enviar. Reintenta o pasale este enlace directamente.'
              : tieneContacto
                ? 'La invitacion se creo. Pasale este enlace mientras se confirma el envio.'
                : 'El paciente no tiene correo ni telefono registrados. Pasale este enlace por otro medio.'}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded border border-amber-200 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-700">
              {resultado.invitationUrl}
            </code>
            <button
              onClick={copiar}
              className="shrink-0 rounded-lg border border-amber-300 bg-white p-1.5 text-amber-700 hover:bg-amber-100"
              title="Copiar"
            >
              {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ModalInvitar({
  patientId,
  patientName,
  yaInvitado,
  onClose,
  onInvitado,
}: {
  patientId: string;
  patientName: string;
  yaInvitado: boolean;
  onClose: () => void;
  onInvitado: (r: Resultado) => void;
}) {
  const [horas, setHoras] = useState(String(VENCIMIENTO_POR_DEFECTO));
  const [enviando, setEnviando] = useState(false);

  const invitar = async () => {
    setEnviando(true);
    try {
      const res = await apiFetch(`/api/patients/${patientId}/invitation`, {
        method: 'POST',
        body: JSON.stringify({ expiresInHours: Number(horas) }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data?.error || 'No se pudo generar la invitación.');
        return;
      }

      const destino = data.sentTo?.email || data.sentTo?.phone;
      toast.success(destino ? `Invitación enviada a ${destino}.` : 'Invitación generada.');
      onInvitado({
        invitationUrl: data.invitationUrl,
        sentTo: data.sentTo ?? { email: null, phone: null },
        tieneContacto: data.tieneContacto ?? false,
        envioFallido: data.envioFallido ?? false,
      });
    } catch {
      toast.error('No se pudo contactar el servidor.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">Invitar a la app móvil</h3>
            <p className="text-xs text-slate-500">{patientName}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="text-xs font-semibold text-slate-600">
          Vence en (horas) <span className="text-red-600">*</span>
          <input
            autoFocus
            type="number"
            min={1}
            max={1440}
            value={horas}
            onChange={(e) => setHoras(e.target.value)}
            className="mt-1 w-32 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-toast-500"
          />
        </label>

        <p className="mt-2 text-xs text-slate-400">
          Dos semanas por defecto: instalar una app lleva más tiempo que responder un
          cuestionario.
          {yaInvitado && ' La invitación anterior quedará anulada.'}
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={invitar}
            disabled={enviando || !Number(horas)}
            className="inline-flex items-center gap-2 rounded-lg bg-toast-500 px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40"
          >
            {enviando ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generando…
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" /> Generar invitación
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
