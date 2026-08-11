/**
 * PsychologistAvailabilityGrid.tsx
 *
 * Mini-calendario semanal de disponibilidad de un psicólogo, embebido en el
 * modal de agendamiento delegado. Permite ver de un vistazo qué horas ya
 * tiene ocupadas antes de escoger fecha/hora, y hace clic-para-rellenar
 * sobre un espacio libre.
 *
 * Consume GET /api/appointments?psychologistId=&from=&to= (filtros
 * opcionales/aditivos — no afecta a quienes listan la agenda completa).
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

interface AvailabilityAppointment {
  id: string;
  date: string;
  status: string;
  patient?: { firstName: string; lastName: string } | null;
}

interface PsychologistAvailabilityGridProps {
  psychologistId: string;
  psychologistName?: string;
  onSlotPick: (dateTimeLocal: string) => void;
  // Fechas ya elegidas en el formulario (aún sin guardar) — se resaltan en
  // el grid en tiempo real para que quede claro qué día quedó seleccionado,
  // incluso antes de confirmar el agendamiento.
  pendingDateTimes: string[];
  // Clic sobre una celda ya resaltada como pendiente → la limpia, para
  // corregir un día mal seleccionado sin tener que borrar el campo a mano.
  onSlotClear: (dateTimeLocal: string) => void;
  // Semana con la que abre el calendario — por defecto la semana actual,
  // pero al reprogramar una cita existente debe abrir en la semana de ESA
  // cita, no en la de hoy (si no, toca navegar a ciegas para encontrarla).
  initialWeekDate?: Date;
  // Al reprogramar, la cita que se está editando NO debe contar como
  // "ocupada" contra sí misma — si no, su propia celda queda bloqueada
  // (no clicable) en vez de mostrarse como la selección pendiente.
  excludeAppointmentId?: string;
}

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
// Rango por defecto: jornada clínica típica (6:00 a.m. – 11:00 p.m.). Si
// alguna cita cae fuera de este rango, se amplía dinámicamente más abajo
// para que nunca queden citas reales sin fila visible.
const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 23;

const STATUS_DOT_STYLES: Record<string, string> = {
  Pendiente: 'bg-orange-400',
  Atendida: 'bg-emerald-500',
  'No Atendido': 'bg-red-400',
  Reprogramada: 'bg-indigo-400',
  Cancelada: 'bg-slate-300',
};

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0=Dom … 6=Sáb
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function toDateTimeLocal(d: Date, hour: number): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
}

export default function PsychologistAvailabilityGrid({
  psychologistId,
  psychologistName,
  onSlotPick,
  pendingDateTimes,
  onSlotClear,
  initialWeekDate,
  excludeAppointmentId,
}: PsychologistAvailabilityGridProps) {
  const [weekStart, setWeekStart] = useState(() => getMonday(initialWeekDate || new Date()));
  const [appointments, setAppointments] = useState<AvailabilityAppointment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!psychologistId) return;
    let cancelled = false;
    setLoading(true);
    const from = weekStart.toISOString();
    const to = addDays(weekStart, 6).toISOString();
    apiFetch(`/api/appointments?psychologistId=${psychologistId}&from=${from}&to=${to}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => { if (!cancelled) setAppointments(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setAppointments([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [psychologistId, weekStart.getTime()]);

  // Mapa "díaÍndice-hora" → primera cita que cae en esa franja, para lookup O(1) por celda.
  const cellMap = new Map<string, AvailabilityAppointment>();
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  for (const appt of appointments) {
    if (excludeAppointmentId && appt.id === excludeAppointmentId) continue;
    const d = new Date(appt.date);
    const dayIdx = (d.getDay() + 6) % 7; // 0=Lun … 6=Dom
    const h = d.getHours();
    cellMap.set(`${dayIdx}-${h}`, appt);
    // Amplía el rango visible si hay una cita real fuera de la jornada por defecto.
    if (h < startHour) startHour = h;
    if (h > endHour) endHour = h;
  }

  // Mapa "díaÍndice-hora" → sesión pendiente (sin guardar aún) que cae en
  // esa franja, solo para las que aterrizan en la semana visible.
  const pendingCellMap = new Map<string, { dateTimeLocal: string; sessionIndex: number }>();
  pendingDateTimes.forEach((dt, sessionIndex) => {
    if (!dt) return;
    const d = new Date(dt);
    if (isNaN(d.getTime())) return;
    if (d < weekStart || d >= addDays(weekStart, 7)) return; // fuera de la semana visible
    const dayIdx = (d.getDay() + 6) % 7;
    pendingCellMap.set(`${dayIdx}-${d.getHours()}`, { dateTimeLocal: dt, sessionIndex });
  });

  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const weekEnd = addDays(weekStart, 6);
  const rangeLabel = `${weekStart.getDate()} ${weekStart.toLocaleDateString('es-CO', { month: 'short' })} – ${weekEnd.getDate()} ${weekEnd.toLocaleDateString('es-CO', { month: 'short' })}`;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Disponibilidad{psychologistName ? ` — ${psychologistName}` : ''}
        </p>
        <div className="flex items-center gap-2">
          {pendingDateTimes.some(Boolean) && (
            <button
              type="button"
              onClick={() => pendingDateTimes.forEach((dt) => dt && onSlotClear(dt))}
              className="text-[9.5px] font-semibold text-indigo-600 hover:underline cursor-pointer"
            >
              Limpiar selección
            </button>
          )}
          {loading && <Loader2 className="h-3 w-3 animate-spin text-slate-300" />}
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setWeekStart((w) => addDays(w, -7))}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-charcoal-900 cursor-pointer"
          title="Semana anterior"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10.5px] font-medium text-slate-500">{rangeLabel}</span>
        <button
          type="button"
          onClick={() => setWeekStart((w) => addDays(w, 7))}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-charcoal-900 cursor-pointer"
          title="Semana siguiente"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
        <div className="grid min-w-[340px]" style={{ gridTemplateColumns: '28px repeat(7, 1fr)' }}>
          <div className="border-b border-slate-300 bg-slate-100" />
          {DAY_LABELS.map((label, dayIdx) => (
            <div
              key={label}
              className="border-b border-l border-slate-300 bg-slate-100 py-1 text-center text-[9.5px] font-bold uppercase text-slate-600"
            >
              {label} <span className="text-slate-400">{addDays(weekStart, dayIdx).getDate()}</span>
            </div>
          ))}

          {hours.map((hour) => (
            <div key={hour} className="contents">
              <div className="flex h-9 items-center justify-end border-b border-slate-200 bg-slate-50 pr-1 text-[9px] text-slate-500">
                {hour}h
              </div>
              {DAY_LABELS.map((_, dayIdx) => {
                const cellDate = addDays(weekStart, dayIdx);
                const appt = cellMap.get(`${dayIdx}-${hour}`);
                const isPast = cellDate < new Date(new Date().setHours(0, 0, 0, 0));
                if (appt) {
                  const initials = appt.patient
                    ? `${appt.patient.firstName?.[0] || ''}${appt.patient.lastName?.[0] || ''}`
                    : '';
                  return (
                    <div
                      key={dayIdx}
                      title={`${appt.patient ? `${appt.patient.firstName} ${appt.patient.lastName}` : 'Ocupado'} — ${appt.status}`}
                      className={`flex h-9 items-center justify-center border-b border-l border-slate-200 text-[8.5px] font-bold text-white ${STATUS_DOT_STYLES[appt.status] || 'bg-slate-400'}`}
                    >
                      {initials}
                    </div>
                  );
                }
                const pending = pendingCellMap.get(`${dayIdx}-${hour}`);
                if (pending) {
                  return (
                    <button
                      key={dayIdx}
                      type="button"
                      onClick={() => onSlotClear(pending.dateTimeLocal)}
                      title="Sesión seleccionada — clic para limpiar y elegir otro día"
                      className="flex h-9 cursor-pointer items-center justify-center border-b border-l border-slate-200 bg-indigo-100 transition-colors hover:bg-red-100"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-indigo-600 bg-white text-[8px] font-bold text-indigo-600">
                        S{pending.sessionIndex + 1}
                      </span>
                    </button>
                  );
                }
                return (
                  <button
                    key={dayIdx}
                    type="button"
                    disabled={isPast}
                    onClick={() => onSlotPick(toDateTimeLocal(cellDate, hour))}
                    title={isPast ? undefined : 'Usar este horario'}
                    className={`h-9 border-b border-l border-slate-200 transition-colors ${
                      isPast ? 'cursor-not-allowed bg-slate-100' : 'cursor-pointer bg-white hover:bg-indigo-100'
                    }`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] text-slate-400">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-400" /> Pendiente</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Atendida</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-400" /> Reprogramada</span>
        <span className="flex items-center gap-1">
          <span className="flex h-3 w-3 items-center justify-center rounded-full border-2 border-indigo-600 bg-white text-[6px] font-bold text-indigo-600">S</span>
          Sesión seleccionada (sin guardar) — clic para limpiar
        </span>
        <span className="flex items-center gap-1">clic en libre = usar horario</span>
      </div>
    </div>
  );
}
