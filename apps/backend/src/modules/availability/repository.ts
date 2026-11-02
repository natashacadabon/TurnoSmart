import type { AvailabilityRule, PrismaClient } from '@prisma/client';
import type { AvailabilityRuleInput } from '@turnosmart/shared';
import { AppError } from '../../lib/errors.js';
import { BusinessCalendar, timezoneFormatter } from '../../lib/business-time.js';

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
      const calendar = new BusinessCalendar(business.timezone, rules);
      if (appointments.some((appointment) => !calendar.contains(appointment)))
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
