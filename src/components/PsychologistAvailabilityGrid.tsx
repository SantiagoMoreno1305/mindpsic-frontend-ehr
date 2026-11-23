/**
 * PsychologistAvailabilityGrid.tsx
 *
 * Calendario semanal de disponibilidad de un psicólogo, embebido en el
 * modal de agendamiento delegado. Permite ver de un vistazo qué horas ya
 * tiene ocupadas antes de escoger fecha/hora, y hace clic-para-rellenar
 * sobre un espacio libre.
 *
 * Consume GET /api/appointments?psychologistId=&from=&to= (filtros
 * opcionales/aditivos — no afecta a quienes listan la agenda completa).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, CalendarDays, Info, Pencil, X } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { esCitaInactiva, ocupaHorario } from '../lib/appointmentStatus';

interface AvailabilityAppointment {
  id: string;
  date: string;
  status: string;
  patient?: { firstName: string; lastName: string } | null;
}

interface MonthEvent {
  dateTime: string;
  status: string;
  sessionIndex?: number;
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
  sessionNumberStart?: number;
  onSlotEdit?: (index: number) => void;
  editingIndex?: number | null;
  previewDateTime?: string;
  focusDateTime?: string;
  activeDateTime?: string;
  busyDateTimes?: ReadonlySet<string>;
  refreshKey?: number;
}

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const APPOINTMENT_DURATION_MINUTES = 45;

// Los mismos estilos alimentan los chips y su leyenda mensual.
const MONTH_STATUS = {
  Pendiente: { label: 'Pendiente', chip: 'border-orange-200 bg-orange-50 text-orange-800', dot: 'bg-orange-500' },
  Atendida: { label: 'Atendida', chip: 'border-emerald-200 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500' },
  Reprogramada: { label: 'Reprogramada', chip: 'border-violet-200 bg-violet-50 text-violet-800', dot: 'bg-violet-400' },
  Cancelada: { label: 'Liberado', chip: 'border-dashed border-slate-400 bg-white text-slate-600', dot: 'bg-slate-400' },
} as const;

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// Un criterio para la grilla, el drawer y la confirmación del lote.
export function slotConflicts(dateTimeLocal: string, occupied: Iterable<string>): boolean {
  const start = new Date(dateTimeLocal).getTime();
  if (!Number.isFinite(start)) return true;
  const end = start + APPOINTMENT_DURATION_MINUTES * 60_000;
  for (const value of occupied) {
    const otherStart = new Date(value).getTime();
    if (Number.isFinite(otherStart) && start < otherStart + APPOINTMENT_DURATION_MINUTES * 60_000 && otherStart < end) return true;
  }
  return false;
}

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

function toDateTimeLocal(d: Date, hour: number, minute = 0): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(minute)}`;
}

export function formatSlotTime(dateTimeLocal: string): string {
  const start = new Date(dateTimeLocal);
  const end = new Date(start.getTime() + APPOINTMENT_DURATION_MINUTES * 60_000);
  const time = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${time(start)}–${time(end)}`;
}

function formatChosenDate(dateTimeLocal: string): string {
  const date = new Date(dateTimeLocal);
  const day = DAY_LABELS[(date.getDay() + 6) % 7];
  const month = date.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
  return `${day}, ${date.getDate()} ${month}`;
}

export default function PsychologistAvailabilityGrid({
  psychologistId,
  psychologistName,
  onSlotPick,
  pendingDateTimes,
  onSlotClear,
  initialWeekDate,
  excludeAppointmentId,
  sessionNumberStart = 1,
  onSlotEdit,
  editingIndex = null,
  previewDateTime,
  focusDateTime,
  activeDateTime,
  busyDateTimes,
  refreshKey,
}: PsychologistAvailabilityGridProps) {
  const isPlaceholder = !psychologistId;
  const [weekStart, setWeekStart] = useState(() => getMonday(initialWeekDate || new Date()));
  const [day, setDay] = useState(() => initialWeekDate || new Date());
  const [month, setMonth] = useState(() => monthStart(initialWeekDate || new Date()));
  const [view, setView] = useState<'Semana' | 'Día' | 'Mes'>('Semana');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [appointments, setAppointments] = useState<AvailabilityAppointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const focusDate = focusDateTime?.slice(0, 10);
  useEffect(() => {
    if (!focusDate) return;
    const focused = new Date(`${focusDate}T00:00`);
    if (Number.isNaN(focused.getTime())) return;
    setDay(focused);
    setWeekStart(getMonday(focused));
    setMonth(monthStart(focused));
    setView('Día');
  }, [focusDate]);

  // Al cambiar de vista, las filas pasan de 30 a 60 minutos. Medimos la
  // fila ya renderizada para centrar el horario activo en ambos formatos.
  useLayoutEffect(() => {
    if (view === 'Mes' || !activeDateTime || !scrollRef.current) return;
    const date = new Date(activeDateTime);
    if (Number.isNaN(date.getTime())) return;
    if (view === 'Día' && date.toDateString() !== day.toDateString()) return;
    if (view === 'Semana' && (date < weekStart || date >= addDays(weekStart, 7))) return;
    const step = view === 'Día' ? 30 : 60;
    const minute = date.getHours() * 60 + Math.floor(date.getMinutes() / step) * step;
    const scroller = scrollRef.current;
    const row = scroller.querySelector<HTMLElement>(`[data-availability-minute="${minute}"]`);
    if (!row) return;
    scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      + row.clientHeight / 2 - scroller.clientHeight / 2;
    // weekStart/day en las dependencias — así, al navegar entre semanas (o
    // días en vista "Día"), la grilla se re-centra en el horario ya elegido
    // en vez de quedarse en el scroll de la semana anterior o saltar al
    // primer horario (antes `navigate` forzaba scrollTop=0 en cada clic).
  }, [view, activeDateTime, weekStart.getTime(), day.getTime()]);

  useEffect(() => {
    if (!psychologistId) {
      setAppointments([]);
      setLoading(false);
      setLoadError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setAppointments([]);
    // El backend trata `to` como límite exclusivo. Mes carga las seis
    // semanas completas para incluir también sus días adyacentes.
    const calendarStart = view === 'Mes' ? getMonday(month) : weekStart;
    const from = calendarStart.toISOString();
    const to = addDays(calendarStart, view === 'Mes' ? 42 : 7).toISOString();
    apiFetch(`/api/appointments?psychologistId=${psychologistId}&from=${from}&to=${to}`)
      .then((res) => { if (!res.ok) throw new Error('No se pudo consultar la agenda'); return res.json(); })
      .then((data) => { if (!cancelled) { if (!Array.isArray(data)) throw new Error('Respuesta de agenda inválida'); setAppointments(data); } })
      .catch(() => { if (!cancelled) { setAppointments([]); setLoadError(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [psychologistId, view, weekStart.getTime(), month.getTime(), refreshKey]);

  const occupied = new Set<string>(isPlaceholder ? [] : busyDateTimes || []);
  const cancelled = new Set<string>();
  for (const appt of appointments) {
    if (isPlaceholder) continue;
    if (appt.id === excludeAppointmentId) continue;
    const d = new Date(appt.date);
    const key = toDateTimeLocal(d, d.getHours(), d.getMinutes());
    if (esCitaInactiva(appt.status)) cancelled.add(key);
    else if (ocupaHorario(appt.status)) occupied.add(key);
  }

  const visibleDays = view === 'Día' ? [day] : DAY_LABELS.map((_, index) => addDays(weekStart, index));
  const intervals = Array.from({ length: view === 'Día' ? 48 : 24 }, (_, index) => index * (view === 'Día' ? 30 : 60));
  const weekEnd = addDays(weekStart, 6);
  const startMonth = weekStart.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
  const endMonth = weekEnd.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
  const rangeLabel = startMonth === endMonth
    ? `${weekStart.getDate()}–${weekEnd.getDate()} ${endMonth} ${weekEnd.getFullYear()}`
    : `${weekStart.getDate()} ${startMonth}–${weekEnd.getDate()} ${endMonth} ${weekEnd.getFullYear()}`;
  const selectedCount = pendingDateTimes.filter(Boolean).length;
  const dayLabel = day.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  const monthLabel = month.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  const monthDays = Array.from({ length: 42 }, (_, index) => addDays(getMonday(month), index));
  const monthEvents = new Map<string, MonthEvent[]>();
  if (view === 'Mes' && !isPlaceholder) {
    const addEvent = (event: MonthEvent) => {
      const dateKey = event.dateTime.slice(0, 10);
      const events = monthEvents.get(dateKey) || [];
      events.push(event);
      monthEvents.set(dateKey, events);
    };
    for (const appt of appointments) {
      if (appt.id === excludeAppointmentId) continue;
      const date = new Date(appt.date);
      if (Number.isNaN(date.getTime())) continue;
      addEvent({ dateTime: toDateTimeLocal(date, date.getHours(), date.getMinutes()), status: appt.status });
    }
    pendingDateTimes.forEach((dateTime, sessionIndex) => {
      if (dateTime && !Number.isNaN(new Date(dateTime).getTime()) && sessionIndex !== editingIndex) addEvent({ dateTime, status: 'Sin guardar', sessionIndex });
    });
    for (const events of monthEvents.values()) events.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  }

  const navigate = (direction: number) => {
    if (view === 'Mes') {
      setMonth(new Date(month.getFullYear(), month.getMonth() + direction, 1));
    } else if (view === 'Día') {
      const next = addDays(day, direction);
      setDay(next);
      setWeekStart(getMonday(next));
    } else {
      const next = addDays(weekStart, direction * 7);
      setWeekStart(next);
      setDay(next);
    }
    // Ya no se fuerza scrollTop=0 acá — el useLayoutEffect de más arriba
    // re-centra la grilla en el horario activo (activeDateTime) apenas la
    // semana/día navegada lo incluye, así la vista no "salta" al primer
    // horario en cada clic de < > mientras se está agendando.
  };

  const changeView = (nextView: 'Semana' | 'Día' | 'Mes') => {
    const active = activeDateTime ? new Date(activeDateTime) : null;
    if (active && !Number.isNaN(active.getTime())) {
      setDay(active);
      setWeekStart(getMonday(active));
      setMonth(monthStart(active));
    } else if (nextView === 'Mes') setMonth(monthStart(day));
    else if (view === 'Mes') {
      const target = day.getFullYear() === month.getFullYear() && day.getMonth() === month.getMonth() ? day : month;
      setDay(target);
      setWeekStart(getMonday(target));
    }
    setView(nextView);
  };

  const openMonthDay = (selected: Date) => {
    setDay(selected);
    setWeekStart(getMonday(selected));
    setMonth(monthStart(selected));
    setView('Día');
  };

  return (
    <div className="min-w-0">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-base font-bold text-slate-900">{isPlaceholder ? 'Horarios' : `Horarios de ${psychologistName || 'profesional'}`}</h4>
        {!isPlaceholder && <span className="shrink-0 text-xs font-medium text-slate-500">{selectedCount} de {pendingDateTimes.length} seleccionados</span>}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 cursor-pointer"
          aria-label={view === 'Mes' ? 'Mes anterior' : view === 'Día' ? 'Día anterior' : 'Semana anterior'}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-36 rounded-lg border border-slate-200 px-3 py-2 text-center text-xs font-semibold capitalize text-slate-800">{view === 'Mes' ? monthLabel : view === 'Día' ? dayLabel : rangeLabel}</span>
        <button
          type="button"
          onClick={() => navigate(1)}
          className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 cursor-pointer"
          aria-label={view === 'Mes' ? 'Mes siguiente' : view === 'Día' ? 'Día siguiente' : 'Semana siguiente'}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => { const today = new Date(); setDay(today); setWeekStart(getMonday(today)); setMonth(monthStart(today)); }} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100">Hoy</button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        <select aria-label="Vista de disponibilidad" value={view} onChange={(event) => changeView(event.target.value as 'Semana' | 'Día' | 'Mes')} className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"><option>Semana</option><option>Día</option><option>Mes</option></select>
      </div>

      {loadError && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">No se pudo consultar la agenda. Cambia de fecha o vuelve a abrir la vista para intentarlo de nuevo.</p>}

      {view === 'Mes' ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <div className="grid min-w-[700px] grid-cols-7">
            {DAY_LABELS.map((label) => <div key={label} className="border-b border-r border-slate-200 bg-slate-100 py-2 text-center text-[10px] font-bold uppercase text-slate-600">{label}</div>)}
            {monthDays.map((calendarDay) => {
              const dateKey = toDateTimeLocal(calendarDay, calendarDay.getHours()).slice(0, 10);
              const events = monthEvents.get(dateKey) || [];
              const adjacent = calendarDay.getMonth() !== month.getMonth() || calendarDay.getFullYear() !== month.getFullYear();
              const selected = !isPlaceholder && calendarDay.toDateString() === day.toDateString();
              const today = !isPlaceholder && calendarDay.toDateString() === new Date().toDateString();
              return (
                <button key={dateKey} type="button" disabled={isPlaceholder} onClick={() => openMonthDay(calendarDay)} aria-pressed={selected} aria-current={today ? 'date' : undefined} aria-label={`${calendarDay.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}: ${events.length ? events.map((event) => `${event.dateTime.slice(11, 16)} ${event.sessionIndex !== undefined ? `sesión ${sessionNumberStart + event.sessionIndex} sin guardar` : MONTH_STATUS[event.status as keyof typeof MONTH_STATUS]?.label || event.status}`).join(', ') : 'sin citas'}. Ver horarios del día`}
                  className={`relative flex min-h-[78px] min-w-0 flex-col gap-1 border-b border-r border-slate-200 p-1.5 text-left align-top focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 ${isPlaceholder ? 'cursor-default' : 'hover:bg-indigo-50'} ${adjacent ? 'bg-slate-50 text-slate-400' : 'bg-white text-slate-900'} ${selected ? 'z-10 ring-2 ring-inset ring-indigo-600' : ''}`}>
                  <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${today ? 'bg-indigo-700 text-white' : adjacent ? 'text-slate-400' : 'text-slate-900'}`}>{calendarDay.getDate()}</span>
                  {events.slice(0, 3).map((event, index) => {
                    const status = MONTH_STATUS[event.status as keyof typeof MONTH_STATUS];
                    const isPending = event.sessionIndex !== undefined;
                    return <span key={`${event.dateTime}-${event.status}-${index}`} className={`block w-full rounded border px-1 py-0.5 text-[10px] leading-tight ${adjacent ? 'opacity-60' : ''} ${isPending ? 'border-indigo-700 bg-indigo-700 font-semibold text-white' : status?.chip || 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                      <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${isPending ? 'bg-white' : status?.dot || 'bg-slate-500'}`} />
                      {event.dateTime.slice(11, 16)} · {isPending ? `Sesión ${sessionNumberStart + event.sessionIndex} Sin guardar` : status?.label || event.status}
                    </span>;
                  })}
                  {events.length > 3 && <span className="text-[10px] font-semibold text-indigo-700">+{events.length - 3} más</span>}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div className={view === 'Semana' ? 'min-w-[700px]' : 'min-w-[280px]'}>
        <div ref={scrollRef} className="max-h-[392px] overflow-y-auto overscroll-contain">
          <div className="grid" style={{ gridTemplateColumns: `70px repeat(${visibleDays.length}, minmax(90px, 1fr))` }}>
          <div className="sticky top-0 z-10 border-b border-slate-300 bg-slate-100" />
          {visibleDays.map((date) => (
            <div
              key={date.toDateString()}
              className="sticky top-0 z-10 border-b border-l border-slate-200 bg-slate-50 py-2 text-center text-[10px] font-bold uppercase text-slate-600"
            >
              {view === 'Día' ? date.toLocaleDateString('es-CO', { weekday: 'long' }) : DAY_LABELS[(date.getDay() + 6) % 7]} <span className="text-slate-400">{date.getDate()}</span>
            </div>
          ))}
          {intervals.map((minutes) => (
            <div key={minutes} className="contents">
              <div data-availability-minute={minutes} className="flex h-10 items-center justify-center border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                {pad(Math.floor(minutes / 60))}:{pad(minutes % 60)}
              </div>
              {visibleDays.map((date) => {
                const hour = Math.floor(minutes / 60);
                const minute = minutes % 60;
                const cellDate = new Date(date);
                cellDate.setHours(hour, minute, 0, 0);
                const key = toDateTimeLocal(cellDate, hour, minute);
                if (isPlaceholder) return <div key={key} className="h-10 border-b border-l border-slate-200 bg-white" />;
                const isPast = cellDate.getTime() < Date.now();
                const pendingIndex = pendingDateTimes.findIndex((value, index) => value && index !== editingIndex
                  && value.slice(0, 13) === key.slice(0, 13)
                  && (view === 'Semana' || Math.floor(Number(value.slice(14)) / 30) === Math.floor(minute / 30)));
                const preview = editingIndex !== null && previewDateTime && previewDateTime.slice(0, 13) === key.slice(0, 13)
                  && Math.floor(Number(previewDateTime.slice(14)) / (view === 'Día' ? 30 : 60)) === Math.floor(minute / (view === 'Día' ? 30 : 60));
                if (preview) {
                  const conflicts = slotConflicts(previewDateTime, [...occupied, ...pendingDateTimes.filter((value, index) => index !== editingIndex && value)]);
                  return <div key={key} className={`m-0.5 flex h-9 flex-col justify-center rounded border border-dashed px-2 text-[10px] leading-tight ${conflicts ? 'border-red-600 bg-red-50 text-red-800' : 'border-indigo-600 bg-indigo-50 text-indigo-800'}`}><b>Sesión {sessionNumberStart + editingIndex} · {conflicts ? 'Conflicto' : 'Vista previa'}</b><span>{formatSlotTime(previewDateTime)}</span></div>;
                }
                if (pendingIndex !== -1) {
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onSlotClear(pendingDateTimes[pendingIndex])}
                      title="Sesión seleccionada — clic para limpiar y elegir otro día"
                      className="m-0.5 flex h-9 cursor-pointer flex-col items-start justify-center rounded bg-indigo-700 px-2 text-left text-[10px] font-semibold leading-tight text-white hover:bg-indigo-800"
                    >
                      <span>Sesión {sessionNumberStart + pendingIndex}</span>
                      <span>{formatSlotTime(pendingDateTimes[pendingIndex])}</span>
                    </button>
                  );
                }
                if (slotConflicts(key, occupied)) {
                  const appointment = appointments.find((appt) => {
                    if (appt.id === excludeAppointmentId || !ocupaHorario(appt.status)) return false;
                    const start = new Date(appt.date);
                    return slotConflicts(key, [toDateTimeLocal(start, start.getHours(), start.getMinutes())]);
                  });
                  const status = appointment && MONTH_STATUS[appointment.status as keyof typeof MONTH_STATUS];
                  return <div key={key} title={appointment?.patient ? `${appointment.patient.firstName} ${appointment.patient.lastName} · ${appointment.status}` : 'Ocupado'} className={`m-0.5 flex h-9 items-center rounded border px-2 text-[10px] font-semibold ${status?.chip || 'border-slate-200 bg-slate-100 text-slate-600'}`}>{status?.label || 'Ocupado'}</div>;
                }
                // Un horario con una cita CANCELADA sigue disponible — se
                // marca con borde punteado, sin bloquear el clic para volver a agendar.
                const wasCancelled = cancelled.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={isPast || editingIndex !== null || loading || loadError}
                    onClick={() => onSlotPick(key)}
                    title={isPast ? undefined : loading || loadError ? 'Espera a que se consulte la disponibilidad' : wasCancelled ? 'Horario disponible — la cita anterior aquí fue cancelada' : 'Usar este horario'}
                    className={`relative h-10 border-b border-l border-slate-200 transition-colors ${
                      isPast || editingIndex !== null || loading || loadError ? 'cursor-not-allowed bg-slate-50' : 'cursor-pointer bg-white hover:bg-indigo-50'
                    }`}
                  >
                    {wasCancelled && !isPast && (
                      <span className="absolute inset-0.5 flex flex-col items-start justify-center rounded border border-dashed border-slate-500 px-2 text-left text-[10px] leading-tight text-slate-700"><b>Libre</b><span>Por cancelación</span></span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          </div>
        </div>
        </div>
      </div>
      )}

      {!isPlaceholder && <>
      {view === 'Mes' ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-slate-600">
          <b className="text-slate-800">Horarios:</b>
          {(['Pendiente', 'Atendida', 'Reprogramada', 'Cancelada'] as const).map((status) => <span key={status} className="flex items-center gap-1"><span className={status === 'Cancelada' ? 'h-3 w-3 rounded border border-dashed border-slate-500' : `h-2.5 w-2.5 rounded-full ${MONTH_STATUS[status].dot}`} />{MONTH_STATUS[status].label}</span>)}
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-indigo-700" /> Selección sin guardar</span>
          <span className="ml-auto flex items-center gap-1"><Info className="h-3.5 w-3.5" /> Selecciona un día para consultar sus horarios disponibles.</span>
        </div>
      ) : (
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-slate-600">
        <b className="text-slate-800">Horarios:</b>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border border-indigo-500 bg-white" /> Disponible</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-indigo-700" /> Seleccionado sin guardar</span>
        {editingIndex !== null && <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border border-dashed border-indigo-600 bg-indigo-50" /> Vista previa</span>}
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border border-dashed border-slate-500" /> {MONTH_STATUS.Cancelada.label}</span>
        <span className="h-4 border-l border-slate-300" />
        <b className="text-slate-800">Atenciones:</b>
        {(['Pendiente', 'Atendida', 'Reprogramada'] as const).map((status) => <span key={status} className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${MONTH_STATUS[status].dot}`} /> {MONTH_STATUS[status].label}</span>)}
      </div>
      )}
      <div className="mt-6">
        <h4 className="mb-2 text-base font-bold text-slate-900">Horarios elegidos</h4>
        {pendingDateTimes.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-slate-200 py-7 text-center text-slate-500">
            <CalendarDays className="mb-2 h-6 w-6" />
            <b className="text-xs">No hay citas seleccionadas</b>
            <span className="text-xs">Selecciona horarios disponibles en el calendario.</span>
          </div>
        ) : pendingDateTimes.map((dt, index) => (
          <div key={index} className={`mb-2 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-xs ${!dt ? 'border-dashed border-amber-300 bg-amber-50 text-amber-800' : editingIndex === index ? 'border-indigo-300 bg-indigo-50 text-slate-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
            <b className={`w-24 shrink-0 ${dt ? 'text-slate-900' : 'text-amber-900'}`}>Sesión {sessionNumberStart + index}</b>
            {dt ? (
              <span className="border-l border-slate-300 pl-3">{formatChosenDate(dt)} · {formatSlotTime(dt)}</span>
            ) : (
              <span className="border-l border-amber-300 pl-3 font-semibold">Sin horario asignado — selecciónalo en el calendario</span>
            )}
            {dt && editingIndex === index && <span className="ml-auto rounded border border-indigo-200 bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-700">Editando</span>}
            {dt && onSlotEdit && <button type="button" onClick={() => onSlotEdit(index)} aria-label={`Editar sesión ${sessionNumberStart + index}`} className={`${editingIndex === index ? '' : 'ml-auto'} inline-flex items-center gap-1 font-semibold text-indigo-700 hover:text-indigo-900`}><Pencil className="h-3.5 w-3.5" /> Editar</button>}
            {dt && <button type="button" onClick={() => onSlotClear(dt)} aria-label={`Quitar sesión ${sessionNumberStart + index}`} className="text-slate-500 hover:text-slate-900"><X className="h-4 w-4" /></button>}
          </div>
        ))}
        <p className="mt-2 text-xs text-slate-500">Horario de Bogotá (UTC−5)</p>
      </div>
      </>}
    </div>
  );
}
