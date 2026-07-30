import toast from 'react-hot-toast';

// Reemplazo estilizado de window.confirm() — usa el mismo <Toaster /> ya
// montado en App.tsx, así que no requiere ningún setup adicional. Devuelve
// una promesa que resuelve true/false según el botón que el usuario presione.
export function confirmToast(
  message: string,
  options?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean }
): Promise<boolean> {
  const confirmLabel = options?.confirmLabel || 'Confirmar';
  const cancelLabel = options?.cancelLabel || 'Cancelar';
  const danger = options?.danger ?? true;

  return new Promise((resolve) => {
    toast.custom(
      (t) => (
        <div
          className={`${t.visible ? 'animate-enter' : 'animate-leave'} w-full max-w-sm rounded-xl border border-charcoal-800 bg-charcoal-900 p-4 text-white shadow-xl pointer-events-auto`}
        >
          <p className="whitespace-pre-line text-sm leading-relaxed">{message}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { toast.dismiss(t.id); resolve(false); }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-charcoal-800"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={() => { toast.dismiss(t.id); resolve(true); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      ),
      { duration: Infinity }
    );
  });
}
