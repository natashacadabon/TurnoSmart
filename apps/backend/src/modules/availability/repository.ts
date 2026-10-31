import type { AvailabilityRule, PrismaClient } from '@prisma/client';
import type { AvailabilityRuleInput } from '@turnosmart/shared';
import { AppError } from '../../lib/errors.js';

export type AvailabilityRecord = AvailabilityRule;
export interface WeeklyAvailability {
  timezone: string;
  rules: AvailabilityRecord[];
}
export interface AvailabilityRepository {
  list(businessId: string): Promise<WeeklyAvailability>;
  replace(businessId: string, rules: AvailabilityRuleInput[]): Promise<WeeklyAvailability>;
}

const orderBy = [
  { dayOfWeek: 'asc' },
  { startTime: 'asc' },
  { endTime: 'asc' },
  { id: 'asc' },
] as const;

/** TIME se transporta en UTC por Prisma, sin convertir la hora de pared del negocio. */
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
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
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

/** Proyecta instantes existentes; no resuelve horas locales ambiguas a instantes (D06). */
export function appointmentFits(
  appointment: { startsAt: Date; endsAt: Date },
  rules: AvailabilityRuleInput[],
  timezone: string,
): boolean {
  const formatter = timezoneFormatter(timezone);
  const project = (date: Date) => {
    const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
    const wall = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      date.getUTCMilliseconds(),
    );
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      day: new Date(wall).getUTCDay(),
      minute:
        Number(parts.hour) * 60 +
        Number(parts.minute) +
        Number(parts.second) / 60 +
        date.getUTCMilliseconds() / 60000,
      offset: wall - date.getTime(),
    };
  };
  const start = project(appointment.startsAt);
  const end = project(appointment.endsAt);
  // D06 no aprueba como tratar intervalos que atraviesan cambios de offset.
  if (start.offset !== end.offset)
    throw new AppError('INTERNAL_ERROR', 'Cambio de zona horaria pendiente de politica D06');
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return (
    start.date === end.date &&
    rules.some(
      (rule) =>
        rule.active &&
        rule.dayOfWeek === start.day &&
        minutes(rule.startTime) <= start.minute &&
        end.minute <= minutes(rule.endTime),
    )
  );
}

export class PrismaAvailabilityRepository implements AvailabilityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(businessId: string): Promise<WeeklyAvailability> {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true, availabilityRules: { orderBy: [...orderBy] } },
    });
    timezoneFormatter(business.timezone);
    return { timezone: business.timezone, rules: business.availabilityRules };
  }

  async replace(businessId: string, rules: AvailabilityRuleInput[]): Promise<WeeklyAvailability> {
    return this.prisma.$transaction(async (tx) => {
      // Serializa PUTs del mismo negocio, incluso si no hay reglas. D07 requiere
      // que C acuerde y utilice el mismo protocolo antes de prometer exclusion B/C.
      await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
      const business = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { timezone: true },
      });
      timezoneFormatter(business.timezone);
      const appointments = await tx.appointment.findMany({
        where: {
          businessId,
          status: { in: ['SCHEDULED', 'CONFIRMED'] },
          endsAt: { gt: new Date() },
        },
        select: { startsAt: true, endsAt: true },
      });
      if (
        appointments.some((appointment) => !appointmentFits(appointment, rules, business.timezone))
      )
        throw new AppError(
          'AVAILABILITY_CONFLICT',
          'La configuracion deja turnos vigentes fuera de disponibilidad',
        );

      const tuples = rules.map((rule) => ({
        dayOfWeek: rule.dayOfWeek,
        startTime: new Date(`1970-01-01T${rule.startTime}:00.000Z`),
        endTime: new Date(`1970-01-01T${rule.endTime}:00.000Z`),
      }));
      await tx.availabilityRule.deleteMany({
        where: { businessId, ...(tuples.length ? { NOT: { OR: tuples } } : {}) },
      });
      for (const [index, tuple] of tuples.entries()) {
        await tx.availabilityRule.upsert({
          where: { businessId_dayOfWeek_startTime_endTime: { businessId, ...tuple } },
          create: { businessId, ...tuple, active: rules[index]!.active },
          update: { active: rules[index]!.active },
        });
      }
      const rows = await tx.availabilityRule.findMany({
        where: { businessId },
        orderBy: [...orderBy],
      });
      return { timezone: business.timezone, rules: rows };
    });
  }
}
