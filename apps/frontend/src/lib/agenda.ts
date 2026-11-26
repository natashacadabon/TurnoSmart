import type { AppointmentStatus, AvailabilityRuleInput } from '@turnosmart/shared';
import { BadgeCheck, CheckCircle2, CircleX, Clock3, UserX, type LucideIcon } from 'lucide-react';
import { Temporal } from 'temporal-polyfill';

export const appointmentStates = {
  SCHEDULED: { label: 'Programado', icon: Clock3, color: '#1d4ed8', background: '#eff6ff' },
  CONFIRMED: { label: 'Confirmado', icon: BadgeCheck, color: '#0e7490', background: '#ecfeff' },
  COMPLETED: { label: 'Completado', icon: CheckCircle2, color: '#166534', background: '#f0fdf4' },
  CANCELLED: { label: 'Cancelado', icon: CircleX, color: '#475569', background: '#f1f5f9' },
  NO_SHOW: { label: 'Ausente', icon: UserX, color: '#b91c1c', background: '#fef2f2' },
} satisfies Record<
  AppointmentStatus,
  { label: string; icon: LucideIcon; color: string; background: string }
>;

export function weekday(date: string) {
  return new Date(date.slice(0, 10) + 'T00:00:00Z').getUTCDay();
}

export function agendaHours(rules: AvailabilityRuleInput[], day?: number) {
  const active = rules.filter((rule) => rule.active);
  const days = new Set(active.map((rule) => rule.dayOfWeek));
  const windows = day === undefined ? active : active.filter((rule) => rule.dayOfWeek === day);
  return {
    hiddenDays: Array.from({ length: 7 }, (_, index) => index).filter((index) => !days.has(index)),
    businessHours: active.map(({ dayOfWeek, startTime, endTime }) => ({
      daysOfWeek: [dayOfWeek],
      startTime,
      endTime,
    })),
    bounds: windows.length
      ? {
          slotMinTime: windows.map((rule) => rule.startTime).sort()[0]!,
          slotMaxTime: windows
            .map((rule) => rule.endTime)
            .sort()
            .at(-1)!,
        }
      : null,
  };
}

export function agendaTodayPosition(rules: AvailabilityRuleInput[], now: Date, timezone: string) {
  const local = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(timezone);
  const today = local.toPlainDate();
  const minutes = local.hour * 60 + local.minute;
  const time = [local.hour, local.minute].map((part) => String(part).padStart(2, '0')).join(':');

  for (let offset = 0; offset < 7; offset++) {
    const date = today.add({ days: offset });
    const day = date.dayOfWeek % 7;
    const { bounds } = agendaHours(rules, day);
    if (!bounds) continue;
    const window =
      offset === 0 &&
      rules.find(
        (rule) =>
          rule.active && rule.dayOfWeek === day && rule.startTime <= time && time < rule.endTime,
      );
    if (!window) return { date: date.toString(), time: bounds.slotMinTime };
    // Dejar contexto antes de ahora sin retroceder a un tramo cerrado.
    const opening = Number(window.startTime.slice(0, 2)) * 60 + Number(window.startTime.slice(3));
    const target = Math.max(opening, minutes - 15);
    const scrollTime = [Math.floor(target / 60), target % 60]
      .map((part) => String(part).padStart(2, '0'))
      .join(':');
    return { date: date.toString(), time: scrollTime };
  }
  return null;
}

/** FullCalendar entrega cadenas ISO ya expresadas en la zona del negocio. */
export function canSelectAgendaTime(rules: AvailabilityRuleInput[], start: string, end?: string) {
  const day = weekday(start);
  if (end && end.slice(0, 10) !== start.slice(0, 10)) return false;
  const time = start.slice(11, 16);
  return rules.some(
    (rule) =>
      rule.active &&
      rule.dayOfWeek === day &&
      (!time ||
        (time >= rule.startTime &&
          time < rule.endTime &&
          (!end || end.slice(11, 16) <= rule.endTime))),
  );
}

/** La API de turnos usa fechas UTC inclusivas para un rango por inicio. */
export function utcAppointmentDates(start: Date, end: Date) {
  return {
    from: start.toISOString().slice(0, 10),
    to: new Date(end.getTime() - 1).toISOString().slice(0, 10),
  };
}

export function businessDayRange(date: string, timezone: string) {
  const day = Temporal.PlainDate.from(date);
  return utcAppointmentDates(
    new Date(day.toZonedDateTime(timezone).epochMilliseconds),
    new Date(day.add({ days: 1 }).toZonedDateTime(timezone).epochMilliseconds),
  );
}
