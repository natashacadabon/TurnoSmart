import { SLOT_INTERVAL_MINUTES, type SlotDto } from '@turnosmart/shared';
import { AppError } from '../../lib/errors.js';
import type { Interval } from '../../lib/business-time.js';
const MINUTE = 60_000;

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
