import { randomUUID } from 'node:crypto';
import { AppError } from '../src/lib/errors.js';
import { bookingEnd } from '../src/modules/appointments/booking.js';
import { localTime, type AvailabilityRepository } from '../src/modules/availability/repository.js';
import type { CustomerRepository } from '../src/modules/customers/repository.js';
import type { ServiceRepository } from '../src/modules/services/repository.js';
import {
  canTransitionAppointmentStatus,
  projectAppointmentStatus,
  type AppointmentStatus,
} from '@turnosmart/shared';
import type {
  AppointmentEventInput,
  AppointmentListQuery,
  AppointmentRecord,
  AppointmentRepository,
  RiskScoreValues,
} from '../src/modules/appointments/repository.js';
import type { RiskRepository } from '../src/modules/ai/risk-repository.js';

export class InMemoryAppointmentRepository implements AppointmentRepository {
  readonly rows: AppointmentRecord[] = [];
  readonly operationAppointments = new Map<string, string>();
  readonly operationEvents: AppointmentEventInput[] = [];

  constructor(
    private readonly customers: CustomerRepository,
    private readonly services: ServiceRepository,
    private readonly availability: AvailabilityRepository,
    private readonly risk?: RiskRepository,
  ) {}

  private async end(
    businessId: string,
    customerId: string,
    serviceId: string,
    startsAt: Date,
    now: Date,
  ) {
    const week = await this.availability.list(businessId);
    return bookingEnd(
      {
        customerExists: (await this.customers.findById(businessId, customerId)) !== null,
        service: await this.services.findById(businessId, serviceId),
        timezone: week.timezone,
        rules: week.rules.map((rule) => ({
          ...rule,
          startTime: localTime(rule.startTime),
          endTime: localTime(rule.endTime),
        })),
      },
      startsAt,
      now,
    );
  }

  async list(businessId: string, query: AppointmentListQuery) {
    const all = this.rows
      .filter((row) => row.businessId === businessId)
      .filter((row) => !query.from || row.startsAt >= query.from)
      .filter((row) => !query.to || row.startsAt < query.to)
      .filter(
        (row) =>
          !query.status ||
          projectAppointmentStatus(row.status, row.confirmationStatus) === query.status,
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
    return {
      items: all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      total: all.length,
    };
  }

  async findById(businessId: string, id: string) {
    return this.rows.find((row) => row.businessId === businessId && row.id === id) ?? null;
  }

  async create(
    businessId: string,
    data: Pick<AppointmentRecord, 'customerId' | 'serviceId' | 'startsAt' | 'endsAt' | 'notes'>,
  ) {
    const now = new Date();
    const row: AppointmentRecord = {
      ...data,
      id: randomUUID(),
      businessId,
      status: 'SCHEDULED',
      confirmationStatus: 'PENDING',
      scheduleVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async createAtomically(
    businessId: string,
    data: Pick<AppointmentRecord, 'customerId' | 'serviceId' | 'startsAt' | 'notes'>,
    event?: AppointmentEventInput,
    clock: () => Date = () => new Date(),
    risk?: RiskScoreValues,
  ) {
    const operationId = event?.operationKey && `${businessId}:${event.operationKey}`;
    const existingId = operationId ? this.operationAppointments.get(operationId) : undefined;
    if (existingId) {
      const existing = await this.findById(businessId, existingId);
      if (existing) return { kind: 'created' as const, row: existing };
    }
    const endsAt = await this.end(
      businessId,
      data.customerId,
      data.serviceId,
      data.startsAt,
      clock(),
    );
    if (this.conflict(businessId, data.startsAt, endsAt)) {
      return { kind: 'conflict' as const };
    }
    const row = await this.create(businessId, { ...data, endsAt });
    if (operationId) {
      this.operationAppointments.set(operationId, row.id);
      if (event) this.operationEvents.push(event);
    }
    if (risk) await this.risk?.upsert(businessId, { appointmentId: row.id, ...risk });
    return { kind: 'created' as const, row };
  }

  async updateNotes(businessId: string, id: string, notes: string | null) {
    const row = await this.findById(businessId, id);
    if (!row) return null;
    row.notes = notes;
    row.updatedAt = new Date();
    return row;
  }

  async reschedule(businessId: string, id: string, startsAt: Date, endsAt: Date) {
    const row = await this.findById(businessId, id);
    if (!row) return null;
    if (row.startsAt.getTime() !== startsAt.getTime()) {
      Object.assign(row, {
        startsAt,
        endsAt,
        updatedAt: new Date(),
        scheduleVersion: row.scheduleVersion + 1,
      });
    }
    return row;
  }

  async rescheduleAtomically(
    businessId: string,
    id: string,
    startsAt: Date,
    event?: AppointmentEventInput,
    clock: () => Date = () => new Date(),
    _requestId?: string,
    risk?: RiskScoreValues,
  ) {
    const current = await this.findById(businessId, id);
    if (!current) return { kind: 'not_found' as const };
    const operationId = event?.operationKey && `${businessId}:${event.operationKey}`;
    const existingId = operationId ? this.operationAppointments.get(operationId) : undefined;
    if (existingId) return { kind: 'updated' as const, row: current };
    const now = clock();
    if (current.status !== 'SCHEDULED' || current.startsAt <= now) {
      throw new AppError('APPOINTMENT_NOT_RESCHEDULABLE', 'El turno no admite reprogramacion');
    }
    const endsAt = await this.end(businessId, current.customerId, current.serviceId, startsAt, now);
    if (this.conflict(businessId, startsAt, endsAt, id)) {
      return { kind: 'conflict' as const };
    }
    const result = {
      kind: 'updated' as const,
      row: (await this.reschedule(businessId, id, startsAt, endsAt)) as AppointmentRecord,
    };
    if (operationId) {
      this.operationAppointments.set(operationId, id);
      if (event) this.operationEvents.push(event);
    }
    if (risk) await this.risk?.upsert(businessId, { appointmentId: id, ...risk });
    return result;
  }

  async transitionAtomically(
    businessId: string,
    id: string,
    nextStatus: AppointmentStatus,
    _actorId?: string,
    operationKey?: string,
  ) {
    const current = await this.findById(businessId, id);
    if (!current) return { kind: 'not_found' as const };
    const operationId = operationKey && `${businessId}:${operationKey}`;
    if (operationId && this.operationAppointments.has(operationId))
      return { kind: 'updated' as const, row: current };
    const currentStatus = projectAppointmentStatus(current.status, current.confirmationStatus);
    if (!canTransitionAppointmentStatus(currentStatus, nextStatus) || nextStatus === 'SCHEDULED') {
      return { kind: 'invalid_transition' as const, currentStatus };
    }
    if (nextStatus === 'CONFIRMED') current.confirmationStatus = 'CONFIRMED';
    else current.status = nextStatus;
    current.updatedAt = new Date();
    if (operationId) {
      this.operationAppointments.set(operationId, id);
      this.operationEvents.push({
        type: nextStatus === 'NO_SHOW' ? 'MARKED_NO_SHOW' : nextStatus,
        operationKey,
      });
    }
    return { kind: 'updated' as const, row: current };
  }

  async hasConflict(businessId: string, startsAt: Date, endsAt: Date, excludeId?: string) {
    return this.conflict(businessId, startsAt, endsAt, excludeId);
  }

  private conflict(businessId: string, startsAt: Date, endsAt: Date, excludeId?: string) {
    return this.rows.some(
      (row) =>
        row.businessId === businessId &&
        row.id !== excludeId &&
        row.status === 'SCHEDULED' &&
        row.startsAt < endsAt &&
        row.endsAt > startsAt,
    );
  }

  async customerStats(businessId: string, customerId: string, before: Date) {
    const history = this.rows.filter(
      (row) =>
        row.businessId === businessId &&
        row.customerId === customerId &&
        row.startsAt < before &&
        ['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(row.status),
    );
    return {
      total: history.length,
      completed: history.filter((row) => row.status === 'COMPLETED').length,
      noShows: history.filter((row) => row.status === 'NO_SHOW').length,
      cancelled: history.filter((row) => row.status === 'CANCELLED').length,
    };
  }
}
