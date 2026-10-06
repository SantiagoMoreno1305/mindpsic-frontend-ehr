import React, { useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Upload, X } from 'lucide-react';

/**
 * "Definir lugar de aplicación" — el tipo (colegio, sede o institución) y la
 * lista de nombres que el chat de registro muestra para que la persona elija
 * UNA. Lo usan el atajo "Crear código" de cada oleada, el formulario completo
 * de Códigos de acceso y la edición de un código existente.
 *
 * Diseño: es opcional, así que arranca colapsado y solo se despliega si se
 * pide (o si ya tiene datos). Tipo con botones, lista como chips que se agregan
 * con Enter o pegando varias líneas. El backend valida la lista (ver
 * validarLugarAplicacion); aquí solo se limpia lo obvio.
 */

export type LugarTipo = 'COLEGIO' | 'SEDE' | 'INSTITUCION';

/** Desde aquí la lista se edita como texto (chips serían ilegibles). */
const UMBRAL_CHIPS = 30;
/** Mismo límite que el backend (validarLugarAplicacion). */
const MAX_NOMBRES = 500;

/**
 * Nombres de un CSV o TXT: primera columna de cada fila. Se salta la fila de
 * encabezado si se llama "nombre", "colegio", "sede" o "institución".
 */
export function nombresDeArchivo(contenido: string): string[] {
  const filas = contenido
    .split(/\r?\n/)
    .map((linea) => (linea.split(/[,;\t]/)[0] ?? '').trim().replace(/^"|"$/g, '').trim())
    .filter(Boolean);
  const encabezados = ['nombre', 'colegio', 'sede', 'institucion', 'institución'];
  return filas.length > 0 && encabezados.includes(filas[0].toLowerCase()) ? filas.slice(1) : filas;
}

export const LUGAR_TIPO_OPCIONES: { value: LugarTipo; label: string }[] = [
  { value: 'COLEGIO', label: 'Colegio' },
  { value: 'SEDE', label: 'Sede' },
  { value: 'INSTITUCION', label: 'Institución' },
];

/** Del texto (un nombre por línea) a la lista que espera el backend. */
export function lineasDeLugar(texto: string): string[] {
  return texto.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * Campos del cuerpo de la petición. Sin tipo ni nombres no manda nada, así el
 * código se crea como siempre. Si hay algo, manda los dos para que el backend
 * valide el par completo.
 */
export function camposDeLugar(tipo: LugarTipo | '', texto: string): { lugarTipo?: LugarTipo; lugarOpciones?: string[] } {
  const lista = lineasDeLugar(texto);
  if (!tipo && lista.length === 0) return {};
  return { lugarTipo: tipo || undefined, lugarOpciones: lista };
}

/** Texto del área a partir de la lista guardada en el código. */
export function textoDeLugar(opciones: string[] | null | undefined): string {
  return Array.isArray(opciones) ? opciones.join('\n') : '';
}

export function etiquetaDeLugar(tipo: string | null | undefined): string {
  return LUGAR_TIPO_OPCIONES.find((o) => o.value === tipo)?.label || '';
}

type Props = {
  tipo: LugarTipo | '';
  onTipoChange: (tipo: LugarTipo | '') => void;
  texto: string;
  onTextoChange: (texto: string) => void;
};

export function LugarAplicacionFields({ tipo, onTipoChange, texto, onTextoChange }: Props) {
  const lista = lineasDeLugar(texto);
  const tieneDatos = Boolean(tipo) || lista.length > 0;
  const [abierto, setAbierto] = useState(tieneDatos);
  const [nuevo, setNuevo] = useState('');
  const inputArchivo = useRef<HTMLInputElement>(null);

  const agregar = (valores: string[]) => {
    const limpios = valores.map((v) => v.trim().replace(/\s+/g, ' ')).filter(Boolean);
    if (limpios.length === 0) return;
    const existentes = new Set(lista.map((l) => l.toLowerCase()));
    const sinRepetir = limpios.filter((v) => {
      const clave = v.toLowerCase();
      if (existentes.has(clave)) return false;
      existentes.add(clave);
      return true;
    });
    if (sinRepetir.length) onTextoChange([...lista, ...sinRepetir].join('\n'));
    setNuevo('');
  };

  const quitar = (indice: number) => {
    onTextoChange(lista.filter((_, i) => i !== indice).join('\n'));
  };

  const alCargarArchivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    agregar(nombresDeArchivo(await archivo.text()));
  };

  const quitarTodo = () => {
    onTipoChange('');
    onTextoChange('');
    setAbierto(false);
  };

  if (!abierto && !tieneDatos) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-xs font-semibold text-slate-500 hover:text-slate-900 cursor-pointer"
      >
        <ChevronRight className="h-3.5 w-3.5" />
        Definir lugar de aplicación <span className="font-normal text-slate-400">(opcional)</span>
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => (tieneDatos ? undefined : setAbierto(false))}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer"
        >
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          Lugar de aplicación
        </button>
        {tieneDatos && (
          <button type="button" onClick={quitarTodo} className="text-[11px] font-semibold text-slate-400 hover:text-rose-600 cursor-pointer">
            Quitar lugar
          </button>
        )}
      </div>

      <div className="inline-flex w-full rounded-lg bg-slate-100 p-1">
        {LUGAR_TIPO_OPCIONES.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={tipo === o.value}
            onClick={() => onTipoChange(tipo === o.value ? '' : o.value)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              tipo === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Opciones</span>
          <span className={`text-[11px] ${lista.length > MAX_NOMBRES ? 'font-semibold text-rose-600' : 'text-slate-400'}`}>
            {lista.length} {lista.length === 1 ? 'opción' : 'opciones'}
            {lista.length > MAX_NOMBRES ? ` · máximo ${MAX_NOMBRES}` : ''}
          </span>
        </div>

        {lista.length > UMBRAL_CHIPS ? (
          <textarea
            value={texto}
            onChange={(e) => onTextoChange(e.target.value)}
            rows={8}
            placeholder="Un nombre por línea"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />
        ) : (
          <>
            {lista.length > 0 && (
              <div className="mb-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {lista.map((nombre, i) => (
                  <span key={`${nombre}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2.5 pr-1 text-xs text-slate-700">
                    {nombre}
                    <button type="button" onClick={() => quitar(i)} aria-label={`Quitar ${nombre}`} className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-900 cursor-pointer">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={nuevo}
                onChange={(e) => setNuevo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    agregar([nuevo]);
                  }
                }}
                onPaste={(e) => {
                  const pegado = e.clipboardData.getData('text');
                  if (pegado.includes('\n')) {
                    e.preventDefault();
                    agregar(pegado.split(/\r?\n/));
                  }
                }}
                placeholder="Escribe un nombre y pulsa Enter"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
              <button
                type="button"
                onClick={() => agregar([nuevo])}
                disabled={!nuevo.trim()}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                Agregar
              </button>
            </div>
          </>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[10.5px] text-slate-400">
            Pega varias líneas o carga un CSV/TXT con una columna. En el chat la persona elige una; no puede escribir otra.
          </p>
          <button
            type="button"
            onClick={() => inputArchivo.current?.click()}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Upload className="h-3 w-3" />
            Cargar archivo
          </button>
          <input ref={inputArchivo} type="file" accept=".csv,.txt" onChange={alCargarArchivo} className="hidden" />
        </div>
      </div>
    </div>
  );
}
