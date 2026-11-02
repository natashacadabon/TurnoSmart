import type { AvailabilityRuleInput } from '@turnosmart/shared';
import { AppError } from './errors.js';

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}
const MINUTE = 60_000;

/** Prisma transporta TIME con fecha auxiliar UTC: no convertirla a la zona local. */
export function localTime(value: Date): string {
  if (
    !Number.isFinite(value.getTime()) ||
    value.getUTCSeconds() !== 0 ||
    value.getUTCMilliseconds() !== 0
  )
    throw new AppError('INTERNAL_ERROR', 'Configuracion de disponibilidad invalida');
  return value.toISOString().slice(11, 16);
}

export function timezoneFormatter(timezone: string) {
  try {
    // Intl moderno acepta offsets numericos; el dominio requiere nombres IANA.
    if (/^[+-]/.test(timezone)) throw new RangeError('Se requiere zona IANA');
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      // Gregoriano proleptico como ISO, con era explicita para el anio ISO 0000.
      calendar: 'gregory',
      numberingSystem: 'latn',
      era: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new AppError('INTERNAL_ERROR', 'Zona horaria del negocio invalida');
  }
}

function project(formatter: Intl.DateTimeFormat, instant: number) {
  const p = Object.fromEntries(formatter.formatToParts(instant).map((v) => [v.type, v.value]));
  // setUTCFullYear evita el ajuste de Date.UTC de los anios 0..99 a 1900..1999.
  const year = p.era === 'BC' ? 1 - Number(p.year) : Number(p.year);
  const wall = new Date(0);
  wall.setUTCFullYear(year, Number(p.month) - 1, Number(p.day));
  wall.setUTCHours(
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
    new Date(instant).getUTCMilliseconds(),
  );
  return { wall: wall.getTime(), date: wall.toISOString().split('T')[0]! };
}

const unresolved = () =>
  new AppError(
    'AVAILABILITY_TIME_UNRESOLVABLE',
    'La franja contiene horas ambiguas, inexistentes o un cambio de offset',
  );

/** D06: conversion estricta, compartida por B04/B05. Cache solo por evaluacion,
 * nunca entre requests/tenants; las reglas y la zona son las de esa evaluacion.
 */
export class BusinessCalendar {
  private readonly formatter: Intl.DateTimeFormat;
  private readonly byDate = new Map<string, Interval[]>();

  constructor(
    timezone: string,
    private readonly rules: AvailabilityRuleInput[],
  ) {
    this.formatter = timezoneFormatter(timezone);
  }

  windows(date: string): Interval[] {
    const cached = this.byDate.get(date);
    if (cached) return cached;
    const midnight = new Date(`${date}T00:00:00.000Z`).getTime();
    const rules = this.rules.filter(
      (r) => r.active && r.dayOfWeek === new Date(midnight).getUTCDay(),
    );
    if (!rules.length) {
      this.byDate.set(date, []);
      return [];
    }
    // Busca offsets a ambos lados: tambien saltos de 30 minutos o de dia entero.
    // El rango abarca todos los offsets IANA y no presupone dias locales de 24h.
    const offsets = new Set<number>();
    for (let hour = -36; hour <= 36; hour++) {
      const instant = midnight + hour * 60 * MINUTE;
      offsets.add(project(this.formatter, instant).wall - instant);
    }
    const resolve = (wall: number) => {
      const matches = [...offsets]
        .map((offset) => wall - offset)
        .filter((instant) => project(this.formatter, instant).wall === wall);
      if (matches.length !== 1) throw unresolved();
      return matches[0]!;
    };
    const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const windows = rules.map((r) => {
      const start = minutes(r.startTime);
      const end = minutes(r.endTime);
      const startsAt = resolve(midnight + start * MINUTE);
      // No basta comparar los extremos: se rechazan tambien folds/gaps internos.
      for (let minute = start + 1; minute <= end; minute++) {
        if (resolve(midnight + minute * MINUTE) !== startsAt + (minute - start) * MINUTE)
          throw unresolved();
      }
      return { startsAt: new Date(startsAt), endsAt: new Date(startsAt + (end - start) * MINUTE) };
    });
    this.byDate.set(date, windows);
    return windows;
  }

  contains(appointment: Interval): boolean {
    const start = project(this.formatter, appointment.startsAt.getTime());
    const end = project(this.formatter, appointment.endsAt.getTime());
    if (start.date !== end.date || appointment.startsAt >= appointment.endsAt) return false;
    // Se comparan instantes persistidos completos, incluidos segundos/milisegundos.
    return this.windows(start.date).some(
      (w) => w.startsAt <= appointment.startsAt && appointment.endsAt <= w.endsAt,
    );
  }
}

export function availabilityWindows(
  date: string,
  timezone: string,
  rules: AvailabilityRuleInput[],
) {
  return new BusinessCalendar(timezone, rules).windows(date);
}

export function appointmentFits(
  appointment: Interval,
  rules: AvailabilityRuleInput[],
  timezone: string,
) {
  return new BusinessCalendar(timezone, rules).contains(appointment);
}
