import { timingSafeEqual } from 'node:crypto';
import { Prisma, type AppointmentPublicActionLink, type PrismaClient } from '@prisma/client';
import type { AppointmentPublicAction } from '@turnosmart/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { signActionLink, upsertActionLink } from './action-token.js';
import { customerActionAllowed, customerActionSelect } from './action-policy.js';
import { SlotsService } from '../slots/service.js';
import { PrismaSlotsRepository } from '../slots/repository.js';
import { listWeeklyAvailability, timezoneFormatter } from '../availability/repository.js';
import {
  appendAppointmentEvent,
  appointmentSelect,
  pendingRescheduleRequest,
  rescheduleRequestForVersion,
  transitionAppointment,
} from './repository.js';

const tokenFormat = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.([\w-]{43})$/;
const invalidLink = () => notFound('Enlace');

export class AppointmentActionLinks {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly secret?: string,
    private readonly clock = () => new Date(),
  ) {}

  private token(link: AppointmentPublicActionLink) {
    if (!this.secret) {
      throw new AppError(
        'APPOINTMENT_ACTIONS_UNAVAILABLE',
        'Los enlaces de turno no están configurados',
      );
    }
    return signActionLink(link, this.secret);
  }

  issue(businessId: string, id: string, action: AppointmentPublicAction) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
        const row = await tx.appointment.findUnique({
          where: { id_businessId: { id, businessId } },
          select: {
            ...appointmentSelect,
            customer: { select: { email: true } },
            business: { select: customerActionSelect },
          },
        });
        if (!row) throw notFound('Turno');
        const recipient = row.customer.email;
        if (row.status !== 'SCHEDULED' || row.startsAt <= this.clock() || !recipient) {
          throw new AppError(
            'CONFLICT',
            'El turno requiere un horario futuro y un cliente con email',
          );
        }
        if (!customerActionAllowed(action, row.business, row.startsAt, this.clock()))
          throw new AppError('FORBIDDEN', 'La política del negocio no permite esta acción');
        const scope = {
          appointmentId: id,
          businessId,
          scheduleVersion: row.scheduleVersion,
          action,
          recipient,
        };
        const link = await upsertActionLink(tx, { ...scope, expiresAt: row.startsAt }, action);
        return {
          token: this.token(link),
          expiresAt: link.expiresAt.toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private async verify(token: string) {
    const match = tokenFormat.exec(token);
    if (!match?.[1] || !match[2]) throw invalidLink();
    const link = await this.prisma.appointmentPublicActionLink.findUnique({
      where: { id: match[1] },
    });
    if (!link || !timingSafeEqual(Buffer.from(token), Buffer.from(this.token(link)))) {
      throw invalidLink();
    }
    return link;
  }

  private async context(
    tx: Prisma.TransactionClient,
    link: AppointmentPublicActionLink,
    lockCustomer = false,
  ) {
    const row = await tx.appointment.findUnique({
      where: { id_businessId: { id: link.appointmentId, businessId: link.businessId } },
      select: {
        ...appointmentSelect,
        business: {
          select: {
            name: true,
            timezone: true,
            ...customerActionSelect,
          },
        },
        service: { select: { name: true } },
      },
    });
    if (!row || row.scheduleVersion !== link.scheduleVersion) throw invalidLink();
    if (lockCustomer) {
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${row.customerId}::uuid AND business_id = ${row.businessId}::uuid FOR SHARE`;
    }
    const customer = await tx.customer.findUnique({
      where: { id_businessId: { id: row.customerId, businessId: row.businessId } },
      select: { email: true },
    });
    const now = this.clock();
    if (customer?.email !== link.recipient || link.expiresAt <= now || row.startsAt <= now) {
      throw invalidLink();
    }
    return { row, now };
  }

  async preview(token: string) {
    const link = await this.verify(token);
    return this.prisma.$transaction(
      async (tx) => {
        const { row, now } = await this.context(tx, link);
        if (row.status !== 'SCHEDULED') throw invalidLink();
        const alreadySubmitted =
          link.action === 'REQUEST_RESCHEDULE' &&
          (link.usedAt || (await rescheduleRequestForVersion(tx, row, 'RESCHEDULE_REQUESTED')));
        return {
          businessName: row.business.name,
          serviceName: row.service.name,
          startsAt: row.startsAt.toISOString(),
          timezone: row.business.timezone,
          action: link.action,
          allowed: customerActionAllowed(link.action, row.business, row.startsAt, now),
          ...(alreadySubmitted && { alreadySubmitted: true }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async availableSlots(
    tx: Prisma.TransactionClient,
    row: { id: string; businessId: string; serviceId: string; startsAt: Date },
    date: string,
    now: Date,
  ) {
    const slots = new SlotsService(
      new PrismaSlotsRepository(tx),
      { list: (id) => listWeeklyAvailability(tx, id) },
      () => now,
    );
    const result = await slots.list(row.businessId, {
      date,
      serviceId: row.serviceId,
      excludeAppointmentId: row.id,
    });
    return result.filter((slot) => Date.parse(slot.startsAt) !== row.startsAt.getTime());
  }

  async slots(token: string, date: string) {
    const link = await this.verify(token);
    if (link.action !== 'REQUEST_RESCHEDULE') throw invalidLink();
    return this.prisma.$transaction(
      async (tx) => {
        const { row, now } = await this.context(tx, link);
        if (row.status !== 'SCHEDULED') throw invalidLink();
        if (!customerActionAllowed(link.action, row.business, row.startsAt, now))
          throw new AppError('FORBIDDEN', 'La política del negocio no permite esta acción');
        return this.availableSlots(tx, row, date, now);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async execute(token: string, message?: string, requestedStartsAt?: string) {
    const verified = await this.verify(token);
    if (
      (message !== undefined || requestedStartsAt !== undefined) &&
      verified.action !== 'REQUEST_RESCHEDULE'
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        'El mensaje solo se admite al solicitar reprogramación',
      );
    }
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${verified.businessId}::uuid FOR UPDATE`;
        const link = await tx.appointmentPublicActionLink.findUnique({
          where: { id: verified.id },
        });
        if (!link) throw invalidLink();
        const { row, now } = await this.context(tx, link, true);
        if (!customerActionAllowed(link.action, row.business, row.startsAt, now)) {
          throw new AppError(
            link.action === 'CANCEL' ? 'APPOINTMENT_CANCELLATION_NOT_ALLOWED' : 'FORBIDDEN',
            'La política del negocio no permite esta acción o venció la anticipación mínima',
          );
        }
        if (
          link.usedAt &&
          (row.status === 'SCHEDULED' || (link.action === 'CANCEL' && row.status === 'CANCELLED'))
        )
          return;
        if (row.status !== 'SCHEDULED') throw invalidLink();
        if (link.action === 'REQUEST_RESCHEDULE') {
          if (!(await rescheduleRequestForVersion(tx, row, 'RESCHEDULE_REQUESTED'))) {
            if (requestedStartsAt) {
              const requested = new Date(requestedStartsAt);
              const parts = Object.fromEntries(
                timezoneFormatter(row.business.timezone)
                  .formatToParts(requested)
                  .map(({ type, value }) => [type, value]),
              );
              const slots = await this.availableSlots(
                tx,
                row,
                `${parts.year}-${parts.month}-${parts.day}`,
                now,
              );
              if (!slots.some((slot) => Date.parse(slot.startsAt) === requested.getTime())) {
                throw new AppError(
                  'APPOINTMENT_TIME_CONFLICT',
                  'El horario solicitado ya no está disponible',
                );
              }
            }
            await appendAppointmentEvent(tx, row, {
              type: 'RESCHEDULE_REQUESTED',
              metadata: {
                source: 'customer',
                scheduleVersion: row.scheduleVersion,
                message: message ?? null,
                ...(requestedStartsAt && {
                  requestedStartsAt: new Date(requestedStartsAt).toISOString(),
                }),
              },
            });
          }
        } else {
          await transitionAppointment(
            tx,
            row,
            link.action === 'CONFIRM' ? 'CONFIRMED' : 'CANCELLED',
            { source: 'customer' },
          );
        }
        await tx.appointmentPublicActionLink.update({
          where: { id: link.id },
          data: { usedAt: now },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  getPendingRequest(businessId: string, id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.appointment.findUnique({
          where: { id_businessId: { id, businessId } },
          select: appointmentSelect,
        });
        if (!row) throw notFound('Turno');
        return pendingRescheduleRequest(tx, row);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  dismissRequest(businessId: string, id: string, requestId: string, actorId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
        const row = await tx.appointment.findUnique({
          where: { id_businessId: { id, businessId } },
          select: appointmentSelect,
        });
        if (!row) throw notFound('Turno');
        const pending = await pendingRescheduleRequest(tx, row);
        if (pending?.id !== requestId) {
          const dismissed = await rescheduleRequestForVersion(
            tx,
            row,
            'RESCHEDULE_REQUEST_DISMISSED',
          );
          if ((dismissed?.metadata as Prisma.JsonObject | undefined)?.requestId === requestId)
            return;
          throw new AppError('CONFLICT', 'La solicitud ya no está pendiente');
        }
        await appendAppointmentEvent(tx, row, {
          type: 'RESCHEDULE_REQUEST_DISMISSED',
          metadata: { source: 'staff', actorId, scheduleVersion: row.scheduleVersion, requestId },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
