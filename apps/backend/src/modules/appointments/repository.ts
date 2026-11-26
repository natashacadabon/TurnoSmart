import { Prisma, type AppointmentEventType, type PrismaClient } from '@prisma/client';
import {
  canTransitionAppointmentStatus,
  projectAppointmentStatus,
  type AppointmentStatus,
} from '@turnosmart/shared';
import { AppError } from '../../lib/errors.js';
import { operationalAvailabilityRules } from '../availability/repository.js';
import { recordAppointmentNotification } from '../notifications/repository.js';
import { enqueueAppointmentEmail } from '../notifications/email-queue.js';
import {
  invalidateAppointmentReminders,
  scheduleAppointmentReminders,
} from '../notifications/reminder-schedule.js';
import { bookingEnd } from './booking.js';

export type AppointmentRecord = Prisma.AppointmentGetPayload<{
  select: typeof appointmentSelect;
}> & {
  rescheduleRequested?: boolean;
};

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
  rescheduleAtomically(
    businessId: string,
    id: string,
    startsAt: Date,
    event?: AppointmentEventInput,
    clock?: () => Date,
    requestId?: string,
  ): Promise<AppointmentRescheduleResult>;
  transitionAtomically(
    businessId: string,
    id: string,
    nextStatus: AppointmentStatus,
    actorId?: string,
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

export const appointmentSelect = {
  id: true,
  businessId: true,
  customerId: true,
  serviceId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  confirmationStatus: true,
  scheduleVersion: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function rescheduleRequestForVersion(
  tx: Prisma.TransactionClient,
  row: Pick<AppointmentRecord, 'id' | 'businessId' | 'scheduleVersion'>,
  type: 'RESCHEDULE_REQUESTED' | 'RESCHEDULE_REQUEST_DISMISSED',
) {
  return tx.appointmentEvent.findFirst({
    where: {
      businessId: row.businessId,
      appointmentId: row.id,
      type,
      metadata: { path: ['scheduleVersion'], equals: row.scheduleVersion },
    },
    select: { id: true, metadata: true, createdAt: true },
  });
}

export async function pendingRescheduleRequest(
  tx: Prisma.TransactionClient,
  row: AppointmentRecord,
) {
  if (row.status !== 'SCHEDULED') return null;
  const request = await rescheduleRequestForVersion(tx, row, 'RESCHEDULE_REQUESTED');
  if (!request || (await rescheduleRequestForVersion(tx, row, 'RESCHEDULE_REQUEST_DISMISSED')))
    return null;
  const metadata = request.metadata as Prisma.JsonObject;
  return {
    id: request.id,
    createdAt: request.createdAt.toISOString(),
    message: typeof metadata.message === 'string' ? metadata.message : null,
    ...(typeof metadata.requestedStartsAt === 'string' && {
      requestedStartsAt: metadata.requestedStartsAt,
    }),
  };
}

export async function appendAppointmentEvent(
  tx: Prisma.TransactionClient,
  row: Pick<AppointmentRecord, 'id' | 'businessId' | 'startsAt' | 'scheduleVersion'>,
  event: AppointmentEventInput,
) {
  const saved = await tx.appointmentEvent.create({
    data: {
      businessId: row.businessId,
      appointmentId: row.id,
      type: event.type,
      ...(event.metadata && { metadata: event.metadata as Prisma.InputJsonValue }),
    },
  });
  await recordAppointmentNotification(tx, saved, row.startsAt);
  await enqueueAppointmentEmail(tx, saved, row);
  return saved;
}

/** Caller holds the business lock and has resolved the appointment in that scope. */
export async function transitionAppointment(
  tx: Prisma.TransactionClient,
  current: AppointmentRecord,
  nextStatus: AppointmentStatus,
  actor: { source: 'customer' } | { source: 'staff'; actorId?: string },
): Promise<AppointmentTransitionResult> {
  const previousStatus = projectAppointmentStatus(current.status, current.confirmationStatus);
  if (actor.source === 'customer' && previousStatus === nextStatus) {
    return { kind: 'updated', row: current };
  }
  if (!canTransitionAppointmentStatus(previousStatus, nextStatus) || nextStatus === 'SCHEDULED') {
    return { kind: 'invalid_transition', currentStatus: previousStatus };
  }
  const row = await tx.appointment.update({
    where: { id_businessId: { id: current.id, businessId: current.businessId } },
    data: nextStatus === 'CONFIRMED' ? { confirmationStatus: 'CONFIRMED' } : { status: nextStatus },
    select: appointmentSelect,
  });
  await appendAppointmentEvent(tx, row, {
    type: nextStatus === 'NO_SHOW' ? 'MARKED_NO_SHOW' : nextStatus,
    metadata: { previousStatus, status: nextStatus, ...actor },
  });
  if (row.status !== 'SCHEDULED') {
    await invalidateAppointmentReminders(tx, row.businessId, { appointmentId: row.id }, new Date());
  }
  return { kind: 'updated', row };
}

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
    const where: Prisma.AppointmentWhereInput = {
      businessId,
      ...(query.from || query.to
        ? {
            startsAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
      ...(query.status === 'CONFIRMED'
        ? { status: 'SCHEDULED', confirmationStatus: 'CONFIRMED' }
        : query.status === 'SCHEDULED'
          ? { status: 'SCHEDULED', confirmationStatus: 'PENDING' }
          : query.status && { status: query.status }),
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
    if (!items.length) return { items, total };
    const pending = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM appointments a
      WHERE a.business_id = ${businessId}::uuid AND a.id IN (${Prisma.join(items.map(({ id }) => Prisma.sql`${id}::uuid`))})
        AND a.status = 'SCHEDULED'
        AND EXISTS (
          SELECT 1 FROM appointment_events e WHERE e.business_id = a.business_id AND e.appointment_id = a.id
            AND e.type = 'RESCHEDULE_REQUESTED' AND e.metadata->'scheduleVersion' = to_jsonb(a.schedule_version)
        )
        AND NOT EXISTS (
          SELECT 1 FROM appointment_events e WHERE e.business_id = a.business_id AND e.appointment_id = a.id
            AND e.type = 'RESCHEDULE_REQUEST_DISMISSED' AND e.metadata->'scheduleVersion' = to_jsonb(a.schedule_version)
        )
    `;
    const ids = new Set(pending.map(({ id }) => id));
    return {
      items: items.map((item) => ({ ...item, rescheduleRequested: ids.has(item.id) })),
      total,
    };
  }

  findById(businessId: string, id: string) {
    return this.prisma.appointment.findUnique({
      where: { id_businessId: { id, businessId } },
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
        const now = clock?.() ?? new Date();
        const endsAt = bookingEnd(configuration, data.startsAt, now);
        const conflict = await tx.appointment.findFirst({
          where: {
            businessId,
            status: 'SCHEDULED',
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
        if (event) await appendAppointmentEvent(tx, row, event);
        await scheduleAppointmentReminders(tx, businessId, row.id, now);
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

  async rescheduleAtomically(
    businessId: string,
    id: string,
    startsAt: Date,
    event?: AppointmentEventInput,
    clock?: () => Date,
    requestId?: string,
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
        if (requestId) {
          const approved = await tx.appointmentEvent.findFirst({
            where: {
              businessId,
              appointmentId: id,
              type: 'RESCHEDULED',
              AND: [
                { metadata: { path: ['requestId'], equals: requestId } },
                { metadata: { path: ['startsAt'], equals: startsAt.toISOString() } },
                { metadata: { path: ['scheduleVersion'], equals: current.scheduleVersion } },
              ],
            },
            select: { id: true },
          });
          if (approved) return { kind: 'updated' as const, row: current };
        }
        if (current.status !== 'SCHEDULED' || current.startsAt <= now) {
          throw new AppError('APPOINTMENT_NOT_RESCHEDULABLE', 'El turno no admite reprogramacion');
        }
        const pending = await pendingRescheduleRequest(tx, current);
        if (requestId && pending?.id !== requestId) {
          throw new AppError('CONFLICT', 'La solicitud ya no está pendiente');
        }
        if (current.startsAt.getTime() === startsAt.getTime()) {
          if (requestId) throw new AppError('CONFLICT', 'Elegí un horario distinto para aprobar');
          return { kind: 'updated' as const, row: current };
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
            status: 'SCHEDULED',
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { id: true },
        });
        if (conflict) return { kind: 'conflict' as const };
        const row = await tx.appointment.update({
          where: { id_businessId: { id, businessId } },
          data: { startsAt, endsAt, scheduleVersion: { increment: 1 } },
          select: appointmentSelect,
        });
        await invalidateAppointmentReminders(tx, businessId, { appointmentId: id }, now);
        await scheduleAppointmentReminders(tx, businessId, id, now);
        if (event) {
          await appendAppointmentEvent(tx, row, {
            type: event.type,
            metadata: {
              ...event.metadata,
              previousStartsAt: current.startsAt.toISOString(),
              ...(pending && { requestId: pending.id, scheduleVersion: row.scheduleVersion }),
            },
          });
        }
        return { kind: 'updated' as const, row };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async transitionAtomically(
    businessId: string,
    id: string,
    nextStatus: AppointmentStatus,
    actorId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
      const current = await tx.appointment.findUnique({
        where: { id_businessId: { id, businessId } },
        select: appointmentSelect,
      });
      if (!current) return { kind: 'not_found' as const };
      return transitionAppointment(tx, current, nextStatus, {
        source: 'staff',
        ...(actorId && { actorId }),
      });
    });
  }

  async hasConflict(businessId: string, startsAt: Date, endsAt: Date, excludeId?: string) {
    const row = await this.prisma.appointment.findFirst({
      where: {
        businessId,
        status: 'SCHEDULED',
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return row !== null;
  }

  async customerStats(businessId: string, customerId: string, before: Date) {
    const where: Prisma.AppointmentWhereInput = {
      businessId,
      customerId,
      startsAt: { lt: before },
      status: { in: ['COMPLETED', 'NO_SHOW', 'CANCELLED'] },
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
