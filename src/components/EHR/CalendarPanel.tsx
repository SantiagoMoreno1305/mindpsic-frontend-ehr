/**
 * CalendarPanel.tsx
 *
 * Panel de agendamiento (Día / Semana / Mes) del portal de psicólogos.
 * Tema claro institucional (toast + charcoal), consistente con el resto de ehr.
 */
import { useMemo, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Video,
  MapPin,
  Clock,
  CalendarDays,
  User2,
} from 'lucide-react';

export type CalendarView = 'day' | 'week' | 'month';

export interface CalendarAppointment {
  id: string;
  patientName: string;
  patientId: string;
  appDate: Date;
  timeSlot: string;
  atencionType: string;
  estatus: string;
  modalidad: string;
  [key: string]: any;
}

export type ApptStatusKey = 'pendiente' | 'atendida' | 'no_atendido' | 'reprogramada';

const STATUS_STYLES: Record<ApptStatusKey, { chip: string; dot: string; label: string }> = {
  pendiente:    { chip: 'border-toast-300 bg-toast-100 text-toast-500',      dot: 'bg-toast-500',   label: 'Pendiente' },
  atendida:     { chip: 'border-emerald-300 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', label: 'Atendida' },
  no_atendido:  { chip: 'border-rose-300 bg-rose-50 text-rose-700',          dot: 'bg-rose-500',    label: 'No Atendido' },
  reprogramada: { chip: 'border-indigo-300 bg-indigo-50 text-indigo-700',    dot: 'bg-indigo-500',  label: 'Reprogramada' },
};

export function normalizeStatus(status: string): ApptStatusKey {
  const s = (status || '').toLowerCase();
  if (s.includes('no atend')) return 'no_atendido';
  if (s.includes('atend')) return 'atendida';
  if (s.includes('reprogram')) return 'reprogramada';
  return 'pendiente';
}

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
}

interface CalendarPanelProps {
  appointments: CalendarAppointment[];
  view: CalendarView;
  setView: (v: CalendarView) => void;
  currentDate: Date;
  setCurrentDate: (d: Date) => void;
  onSelectAppointment: (app: CalendarAppointment) => void;
  onNewAppointment: () => void;
  // Slot libre en el header, entre la navegación de fecha y el selector de
  // vista (Día/Semana/Mes) — p. ej. un filtro por psicólogo. CalendarPanel no
  // conoce ese concepto a propósito (lo usan tanto el calendario general del
  // admin como el personal del psicólogo, que no necesita filtrar por sí mismo).
  filterSlot?: ReactNode;
}

export default function CalendarPanel({
  appointments,
  view,
  setView,
  currentDate,
  setCurrentDate,
  onSelectAppointment,
  onNewAppointment,
  filterSlot,
}: CalendarPanelProps) {
  const today = new Date();

  const sorted = useMemo(
    () => [...appointments].sort((a, b) => a.appDate.getTime() - b.appDate.getTime()),
    [appointments],
  );

  function move(dir: -1 | 1) {
    const next = new Date(currentDate);
    if (view === 'month') next.setMonth(next.getMonth() + dir);
    else if (view === 'week') next.setDate(next.getDate() + dir * 7);
    else next.setDate(next.getDate() + dir);
    setCurrentDate(next);
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  const title =
    view === 'day'
      ? `${currentDate.getDate()} de ${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
      : `${MONTHS[currentDate.getMonth()]} de ${currentDate.getFullYear()}`;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-6 shadow-sm text-left">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl md:text-2xl font-bold text-charcoal-900">{title}</h2>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-toast-50 p-0.5">
            <button
              onClick={() => move(-1)}
              aria-label="Anterior"
              className="rounded-md p-1.5 text-charcoal-400 transition-colors hover:bg-white hover:text-charcoal-900 cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={goToday}
              className="rounded-md px-3 py-1 text-sm font-medium text-charcoal-700 transition-colors hover:bg-white cursor-pointer"
            >
              Hoy
            </button>
            <button
              onClick={() => move(1)}
              aria-label="Siguiente"
              className="rounded-md p-1.5 text-charcoal-400 transition-colors hover:bg-white hover:text-charcoal-900 cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {filterSlot}

        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-slate-200 bg-toast-50 p-0.5">
            {(['day', 'week', 'month'] as CalendarView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                  view === v ? 'bg-toast-500 text-white shadow-sm' : 'text-charcoal-400 hover:text-charcoal-900'
                }`}
              >
                {v === 'day' ? 'Día' : v === 'week' ? 'Semana' : 'Mes'}
              </button>
            ))}
          </div>
          <button
            onClick={onNewAppointment}
            className="flex items-center gap-1.5 rounded-lg bg-charcoal-900 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-charcoal-800 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nueva cita</span>
          </button>
        </div>
      </div>

      {/* Leyenda */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3">
        {(Object.keys(STATUS_STYLES) as ApptStatusKey[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`h-2 w-2 rounded-full ${STATUS_STYLES[s].dot}`} />
            {STATUS_STYLES[s].label}
          </span>
        ))}
      </div>

      <div className="mt-4">
        {view === 'month' && (
          <MonthView currentDate={currentDate} appts={sorted} today={today} onSelectDay={(d) => { setCurrentDate(d); setView('day'); }} />
        )}
        {view === 'week' && (
          <WeekView currentDate={currentDate} appts={sorted} today={today} onSelectAppointment={onSelectAppointment} />
        )}
        {view === 'day' && (
          <DayView date={currentDate} appts={sorted} onSelectAppointment={onSelectAppointment} />
        )}
      </div>
    </div>
  );
}

/* ---------------- Month ---------------- */

function MonthView({
  currentDate,
  appts,
  today,
  onSelectDay,
}: {
  currentDate: Date;
  appts: CalendarAppointment[];
  today: Date;
  onSelectDay: (d: Date) => void;
}) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-toast-50">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-charcoal-400">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="min-h-24 border-b border-r border-slate-200 bg-slate-50/60 last:border-r-0" />;
          const dayAppts = appts.filter((a) => sameDay(a.appDate, date));
          const isToday = sameDay(date, today);
          return (
            <button
              key={i}
              onClick={() => onSelectDay(date)}
              className="min-h-24 border-b border-r border-slate-200 p-1.5 text-left align-top transition-colors [&:nth-child(7n)]:border-r-0 hover:bg-toast-50/60 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    isToday ? 'bg-toast-500 text-white' : 'text-charcoal-700'
                  }`}
                >
                  {date.getDate()}
                </span>
                {dayAppts.length > 0 && <span className="text-[10px] font-medium text-slate-400">{dayAppts.length}</span>}
              </div>
              <div className="mt-1 flex flex-col gap-1">
                {dayAppts.slice(0, 3).map((a) => {
                  const s = STATUS_STYLES[normalizeStatus(a.estatus)];
                  return (
                    <span key={a.id} className={`flex items-center gap-1 truncate rounded border px-1 py-0.5 text-[10px] font-medium ${s.chip}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
                      <span className="truncate">{fmtTime(a.appDate)} {a.patientName}</span>
                    </span>
                  );
                })}
                {dayAppts.length > 3 && <span className="pl-1 text-[10px] font-medium text-slate-400">+{dayAppts.length - 3} más</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Week ---------------- */

function WeekView({
  currentDate,
  appts,
  today,
  onSelectAppointment,
}: {
  currentDate: Date;
  appts: CalendarAppointment[];
  today: Date;
  onSelectAppointment: (app: CalendarAppointment) => void;
}) {
  const start = new Date(currentDate);
  start.setDate(currentDate.getDate() - currentDate.getDay());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
      {days.map((d) => {
        const dayAppts = appts.filter((a) => sameDay(a.appDate, d));
        const isToday = sameDay(d, today);
        return (
          <div key={d.toISOString()} className="rounded-xl border border-slate-200">
            <div className={`border-b border-slate-200 px-2 py-2 text-center ${isToday ? 'bg-toast-50' : ''}`}>
              <p className="text-[11px] uppercase tracking-wider text-charcoal-400">{WEEKDAYS[d.getDay()]}</p>
              <p className={`mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold ${isToday ? 'bg-toast-500 text-white' : 'text-charcoal-800'}`}>
                {d.getDate()}
              </p>
            </div>
            <div className="flex min-h-24 flex-col gap-1.5 p-2">
              {dayAppts.length === 0 && <p className="py-4 text-center text-[10px] text-slate-400">Sin citas</p>}
              {dayAppts.map((a) => (
                <ApptCard key={a.id} a={a} compact onClick={() => onSelectAppointment(a)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Day ---------------- */

function DayView({
  date,
  appts,
  onSelectAppointment,
}: {
  date: Date;
  appts: CalendarAppointment[];
  onSelectAppointment: (app: CalendarAppointment) => void;
}) {
  const dayAppts = appts.filter((a) => sameDay(a.appDate, date));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-charcoal-400">
        {WEEKDAYS[date.getDay()]}, {date.getDate()} de {MONTHS[date.getMonth()]} — {dayAppts.length} cita(s)
      </p>
      {dayAppts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-400">No hay citas agendadas para este día.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {dayAppts.map((a) => (
            <ApptCard key={a.id} a={a} onClick={() => onSelectAppointment(a)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Card / Chip ---------------- */

function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLES[normalizeStatus(status)];
  return (
    <span className={`inline-flex w-fit max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${s.chip}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
      <span className="truncate">{s.label}</span>
    </span>
  );
}

function ApptCard({ a, compact, onClick }: { a: CalendarAppointment; compact?: boolean; onClick: () => void }) {
  const isVirtual = a.modalidad === 'Virtual' || a.modalidad === 'VIRTUAL';

  if (compact) {
    return (
      <div onClick={onClick} className="flex cursor-pointer flex-col gap-1.5 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 transition-colors hover:bg-toast-50/60 hover:border-toast-200">
        <span className="flex items-center gap-1 text-xs font-semibold text-charcoal-900">
          <Clock className="h-3.5 w-3.5 shrink-0 text-charcoal-400" />
          {fmtTime(a.appDate)}
        </span>
        <StatusChip status={a.estatus} />
        <p className="truncate text-xs font-semibold text-charcoal-900">{a.patientName}</p>
        <p className="flex items-center gap-1 truncate text-[11px] text-slate-500">
          {isVirtual ? <Video className="h-3 w-3 shrink-0" /> : <MapPin className="h-3 w-3 shrink-0" />}
          <span className="truncate">{a.atencionType}</span>
        </p>
      </div>
    );
  }

  return (
    <div onClick={onClick} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 transition-colors hover:bg-toast-50/60 hover:border-toast-200">
      <div className="flex w-28 shrink-0 flex-col gap-1.5">
        <span className="flex items-center gap-1 text-sm font-semibold text-charcoal-900">
          <Clock className="h-3.5 w-3.5 text-charcoal-400" />
          {fmtTime(a.appDate)}
        </span>
        <StatusChip status={a.estatus} />
      </div>
      <div className="min-w-0 flex-1 border-l border-slate-200 pl-3">
        <p className="truncate text-sm font-semibold text-charcoal-900">{a.patientName}</p>
        <p className="flex items-center gap-1 truncate text-xs text-slate-500">
          {isVirtual ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
          {a.atencionType}
        </p>
        {a.psychologistName && (
          <p className="flex items-center gap-1 truncate text-xs text-slate-500">
            <User2 className="h-3 w-3 shrink-0" />
            {a.psychologistName}
          </p>
        )}
      </div>
    </div>
  );
}
