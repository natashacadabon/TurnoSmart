import {
  SLOT_INTERVAL_MINUTES,
  type AvailabilityRuleInput,
  type SlotDto,
} from '@turnosmart/shared';
import { AppError } from '../../lib/errors.js';
import { timezoneFormatter } from '../availability/repository.js';

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}
const MINUTE = 60_000;

/** D06: no desplaza horas inexistentes ni elige entre dos instantes ambiguos.
 * Valida toda la franja, incluidos cambios internos de offset, antes de ofrecerla.
 */
export function availabilityWindows(
  date: string,
  timezone: string,
  rules: AvailabilityRuleInput[],
): Interval[] {
  if (/^[+-]/.test(timezone))
    throw new AppError('INTERNAL_ERROR', 'Se requiere una zona horaria IANA del negocio');
  const formatter = timezoneFormatter(timezone);
  const midnight = new Date(`${date}T00:00:00.000Z`).getTime();
  const project = (instant: number) => {
    const p = Object.fromEntries(formatter.formatToParts(instant).map((v) => [v.type, v.value]));
    return new Date(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000Z`,
    ).getTime();
  };
  // Descubre offsets en ambos lados de transiciones, incluso cambios de 30 min
  // o de fecha completa. No presupone dias de 24h ni offsets enteros en horas.
  const offsets = new Set<number>();
  for (let hour = -36; hour <= 36; hour++) {
    const instant = midnight + hour * 60 * MINUTE;
    offsets.add(project(instant) - instant);
  }
  const resolve = (wall: number) => {
    const matches = [...offsets].map((offset) => wall - offset).filter((t) => project(t) === wall);
    if (matches.length !== 1)
      throw new AppError(
        'AVAILABILITY_TIME_UNRESOLVABLE',
        'Franja horaria pendiente de politica D06',
      );
    return matches[0]!;
  };
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return rules
    .filter((r) => r.active && r.dayOfWeek === new Date(midnight).getUTCDay())
    .map((r) => {
      const start = minutes(r.startTime);
      const end = minutes(r.endTime);
      const startsAt = resolve(midnight + start * MINUTE);
      for (let minute = start + 1; minute <= end; minute++) {
        if (resolve(midnight + minute * MINUTE) !== startsAt + (minute - start) * MINUTE)
          throw new AppError('AVAILABILITY_TIME_UNRESOLVABLE', 'Franja cruza cambio de offset D06');
      }
      return { startsAt: new Date(startsAt), endsAt: new Date(startsAt + (end - start) * MINUTE) };
    });
}

/** Calculo puro: intervalos semiabiertos; cada grilla se ancla a su propia franja. */
export function calculateSlots(
  windows: Interval[],
  durationMinutes: number,
  occupied: Interval[],
  now: Date,
): SlotDto[] {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0)
    throw new AppError('INTERNAL_ERROR', 'Duracion de servicio invalida');
  const slots = new Map<number, SlotDto>();
  for (const window of windows) {
    for (
      let start = window.startsAt.getTime();
      start + durationMinutes * MINUTE <= window.endsAt.getTime();
      start += SLOT_INTERVAL_MINUTES * MINUTE
    ) {
      const end = start + durationMinutes * MINUTE;
      if (start <= now.getTime()) continue;
      if (occupied.some((a) => a.startsAt.getTime() < end && a.endsAt.getTime() > start)) continue;
      slots.set(start, {
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
      });
    }
  }
  return [...slots.entries()].sort(([a], [b]) => a - b).map(([, slot]) => slot);
}
