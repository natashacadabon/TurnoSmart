import type { AppointmentStatus, PrismaClient } from '@prisma/client';
import type { Interval } from './calculator.js';

export interface SlotAppointment extends Interval {
  id: string;
  serviceId: string;
  status: AppointmentStatus;
}
export interface SlotsRepository {
  findService(
    businessId: string,
    id: string,
  ): Promise<{ active: boolean; durationMinutes: number } | null>;
  findAppointment(businessId: string, id: string): Promise<SlotAppointment | null>;
  occupied(businessId: string, range: Interval, excludeId?: string): Promise<Interval[]>;
}

/** Lecturas acotadas por tenant; ocupacion de TODOS los servicios en una sola consulta. */
export class PrismaSlotsRepository implements SlotsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findService(businessId: string, id: string) {
    return this.prisma.service.findUnique({
      where: { id_businessId: { id, businessId } },
      select: { active: true, durationMinutes: true },
    });
  }

  findAppointment(businessId: string, id: string) {
    return this.prisma.appointment.findUnique({
      where: { id_businessId: { id, businessId } },
      select: { id: true, serviceId: true, status: true, startsAt: true, endsAt: true },
    });
  }

  occupied(businessId: string, range: Interval, excludeId?: string) {
    return this.prisma.appointment.findMany({
      where: {
        businessId,
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        startsAt: { lt: range.endsAt },
        endsAt: { gt: range.startsAt },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { startsAt: true, endsAt: true },
    });
  }
}
