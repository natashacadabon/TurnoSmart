import { Prisma, type AppointmentStatus, type PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { operationalAvailabilityRules } from '../availability/repository.js';
import { recordAppointmentNotification } from '../notifications/repository.js';
import { bookingEnd } from './booking.js';
import type { AppointmentEventType } from '@turnosmart/shared';

export interface AppointmentRecord {
  id: string;
  businessId: string;
  customerId: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppointmentListQuery {
  from?: Date;
  to?: Date;
  status?: AppointmentStatus;
  page: number;
  pageSize: number;
}

export type AppointmentCreateResult =
  { kind: 'created'; row: AppointmentRecord } | { kind: 'conflict' };
export type AppointmentRescheduleResult =
  { kind: 'updated'; row: AppointmentRecord } | { kind: 'conflict' } | { kind: 'not_found' };
export type AppointmentTransitionResult =
  | { kind: 'updated'; row: AppointmentRecord }
  | { kind: 'not_found' }
  | { kind: 'invalid_transition'; currentStatus: AppointmentStatus };

export interface AppointmentEventInput {
  type: AppointmentEventType;
  metadata?: Record<string, unknown>;
}

export interface CustomerAppointmentStats {
  total: number;
  completed: number;
  noShows: number;
  cancelled: number;
}

export interface AppointmentRepository {
  list(
    businessId: string,
    query: AppointmentListQuery,
  ): Promise<{ items: AppointmentRecord[]; total: number }>;
  findById(businessId: string, id: string): Promise<AppointmentRecord | null>;
  create(
    businessId: string,
    data: Pick<AppointmentRecord, 'customerId' | 'serviceId' | 'startsAt' | 'endsAt' | 'notes'>,
  ): Promise<AppointmentRecord>;
  createAtomically(
    businessId: string,
    data: Pick<AppointmentRecord, 'customerId' | 'serviceId' | 'startsAt' | 'notes'>,
    event?: AppointmentEventInput,
    clock?: () => Date,
  ): Promise<AppointmentCreateResult>;
  updateNotes(
    businessId: string,
    id: string,
    notes: string | null,
  ): Promise<AppointmentRecord | null>;
  reschedule(
    businessId: string,
    id: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<AppointmentRecord | null>;
  rescheduleAtomically(
    businessId: string,
    id: string,
    startsAt: Date,
    event?: AppointmentEventInput,
    clock?: () => Date,
  ): Promise<AppointmentRescheduleResult>;
  updateStatus(
    businessId: string,
    id: string,
    status: AppointmentStatus,
  ): Promise<AppointmentRecord | null>;
  transitionAtomically(
    businessId: string,
    id: string,
    expectedStatus: AppointmentStatus,
    nextStatus: AppointmentStatus,
    event?: AppointmentEventInput,
  ): Promise<AppointmentTransitionResult>;
  hasConflict(
    businessId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
  ): Promise<boolean>;
  customerStats(
    businessId: string,
    customerId: string,
    before: Date,
  ): Promise<CustomerAppointmentStats>;
}

const appointmentSelect = {
  id: true,
  businessId: true,
  customerId: true,
  serviceId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function loadBookingConfiguration(
  tx: Prisma.TransactionClient,
  businessId: string,
  customerId: string,
  serviceId: string,
) {
  const business = await tx.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { timezone: true, availabilityRules: true },
  });
  const customer = await tx.customer.findUnique({
    where: { id_businessId: { id: customerId, businessId } },
    select: { id: true },
  });
  const service = await tx.service.findUnique({
    where: { id_businessId: { id: serviceId, businessId } },
    select: { active: true, durationMinutes: true },
  });
  return {
    timezone: business.timezone,
    rules: operationalAvailabilityRules(business.availabilityRules),
    customerExists: customer !== null,
    service,
  };
}

export class PrismaAppointmentRepository implements AppointmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(businessId: string, query: AppointmentListQuery) {
    const where = {
      businessId,
      ...(query.from || query.to
        ? {
            startsAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: appointmentSelect,
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return { items, total };
  }

  findById(businessId: string, id: string) {
    return this.prisma.appointment.findUnique({
      where: { id_businessId: { id, businessId } },
      select: appointmentSelect,
    });
  }

  create(
    businessId: string,
    data: Pick<AppointmentRecord, 'customerId' | 'serviceId' | 'startsAt' | 'endsAt' | 'notes'>,
  ) {
    return this.prisma.appointment.create({
      data: { ...data, businessId },
      select: appointmentSelect,
    });
  }

  async createAtomically(
    businessId: string,
    data: Pick<AppointmentRecord, 'customerId' | 'serviceId' | 'startsAt' | 'notes'>,
    event?: AppointmentEventInput,
    clock?: () => Date,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        // Todas las operaciones que reservan o modifican agenda usan el mismo
        // lock. Así, dos solicitudes para el mismo negocio se serializan.
        await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
        const configuration = await loadBookingConfiguration(
          tx,
          businessId,
          data.customerId,
          data.serviceId,
        );
        const endsAt = bookingEnd(configuration, data.startsAt, clock?.() ?? new Date());
        const conflict = await tx.appointment.findFirst({
          where: {
            businessId,
            status: { in: ['SCHEDULED', 'CONFIRMED'] },
            startsAt: { lt: endsAt },
            endsAt: { gt: data.startsAt },
          },
          select: { id: true },
        });
        if (conflict) return { kind: 'conflict' as const };
        const row = await tx.appointment.create({
          data: { ...data, endsAt, businessId },
          select: appointmentSelect,
        });
        if (event) {
          await tx.appointmentEvent.create({
            data: {
              businessId,
              appointmentId: row.id,
              type: event.type,
              ...(event.metadata ? { metadata: event.metadata as Prisma.InputJsonValue } : {}),
            },
          });
        }
        return { kind: 'created' as const, row };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async updateNotes(businessId: string, id: string, notes: string | null) {
    const result = await this.prisma.appointment.updateMany({
      where: { id, businessId },
      data: { notes },
    });
    if (result.count === 0) return null;
    return this.findById(businessId, id);
  }

  async reschedule(businessId: string, id: string, startsAt: Date, endsAt: Date) {
    try {
      return await this.prisma.appointment.update({
        where: { id_businessId: { id, businessId } },
        data: { startsAt, endsAt },
        select: appointmentSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        return null;
      throw error;
    }
  }

  async rescheduleAtomically(
    businessId: string,
    id: string,
    startsAt: Date,
    event?: AppointmentEventInput,
    clock?: () => Date,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
        const current = await tx.appointment.findUnique({
          where: { id_businessId: { id, businessId } },
          select: appointmentSelect,
        });
        if (!current) return { kind: 'not_found' as const };
        const now = clock?.() ?? new Date();
        if (!['SCHEDULED', 'CONFIRMED'].includes(current.status) || current.startsAt <= now) {
          throw new AppError('APPOINTMENT_NOT_RESCHEDULABLE', 'El turno no admite reprogramacion');
        }
        const configuration = await loadBookingConfiguration(
          tx,
          businessId,
          current.customerId,
          current.serviceId,
        );
        const endsAt = bookingEnd(configuration, startsAt, now);
        const conflict = await tx.appointment.findFirst({
          where: {
            businessId,
            id: { not: id },
            status: { in: ['SCHEDULED', 'CONFIRMED'] },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { id: true },
        });
        if (conflict) return { kind: 'conflict' as const };
        const row = await tx.appointment.update({
          where: { id_businessId: { id, businessId } },
          data: { startsAt, endsAt },
          select: appointmentSelect,
        });
        if (event) {
          const savedEvent = await tx.appointmentEvent.create({
            data: {
              businessId,
              appointmentId: id,
              type: event.type,
              ...(event.metadata
                ? {
                    metadata: {
                      ...event.metadata,
                      previousStartsAt: current.startsAt.toISOString(),
                    } as Prisma.InputJsonValue,
                  }
                : {}),
            },
          });
          await recordAppointmentNotification(tx, savedEvent, row.startsAt);
        }
        return { kind: 'updated' as const, row };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async updateStatus(businessId: string, id: string, status: AppointmentStatus) {
    try {
      return await this.prisma.appointment.update({
        where: { id_businessId: { id, businessId } },
        data: { status },
        select: appointmentSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        return null;
      throw error;
    }
  }

  async transitionAtomically(
    businessId: string,
    id: string,
    expectedStatus: AppointmentStatus,
    nextStatus: AppointmentStatus,
    event?: AppointmentEventInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
      const current = await tx.appointment.findUnique({
        where: { id_businessId: { id, businessId } },
        select: { status: true },
      });
      if (!current) return { kind: 'not_found' as const };
      if (current.status !== expectedStatus) {
        return { kind: 'invalid_transition' as const, currentStatus: current.status };
      }
      const row = await tx.appointment.update({
        where: { id_businessId: { id, businessId } },
        data: { status: nextStatus },
        select: appointmentSelect,
      });
      if (event) {
        const savedEvent = await tx.appointmentEvent.create({
          data: {
            businessId,
            appointmentId: id,
            type: event.type,
            ...(event.metadata ? { metadata: event.metadata as Prisma.InputJsonValue } : {}),
          },
        });
        await recordAppointmentNotification(tx, savedEvent, row.startsAt);
      }
      return { kind: 'updated' as const, row };
    });
  }

  async hasConflict(businessId: string, startsAt: Date, endsAt: Date, excludeId?: string) {
    const row = await this.prisma.appointment.findFirst({
      where: {
        businessId,
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return row !== null;
  }

  async customerStats(businessId: string, customerId: string, before: Date) {
    const where = {
      businessId,
      customerId,
      startsAt: { lt: before },
      status: { in: ['COMPLETED', 'NO_SHOW', 'CANCELLED'] as AppointmentStatus[] },
    };
    const [total, completed, noShows, cancelled] = await this.prisma.$transaction([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.count({ where: { ...where, status: 'COMPLETED' } }),
      this.prisma.appointment.count({ where: { ...where, status: 'NO_SHOW' } }),
      this.prisma.appointment.count({ where: { ...where, status: 'CANCELLED' } }),
    ]);
    return { total, completed, noShows, cancelled };
  }
}
