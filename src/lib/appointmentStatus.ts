// Estados de cita (decisión 2026-11-18, espejo de
// modules/appointments/appointment-status.js en Mind):
//  - 'Anulada' (se cerró su autorización, o no se tomó antes de un cambio de
//    tratante) y 'Reasignada' (pasó a otro psicólogo) se tratan igual que una
//    cancelada en calendarios y disponibilidad.
//  - 'Por reagendar': pasó al nuevo tratante pero su hora ya estaba ocupada.
//    Sigue siendo una sesión pendiente (reserva cupo), pero su fecha no vale:
//    no ocupa horario y se resuelve reprogramándola, aunque esa fecha ya pasó.
export const ESTADOS_CITA_INACTIVOS = ['Cancelada', 'Anulada', 'Reasignada'] as const;
export const ESTADO_POR_REAGENDAR = 'Por reagendar';

export function esCitaInactiva(status: string | null | undefined): boolean {
  return !!status && (ESTADOS_CITA_INACTIVOS as readonly string[]).includes(status);
}

/** ¿Bloquea su fecha/hora en la agenda del psicólogo? */
export function ocupaHorario(status: string | null | undefined): boolean {
  return !esCitaInactiva(status) && status !== ESTADO_POR_REAGENDAR;
}
