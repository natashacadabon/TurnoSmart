import { randomUUID } from 'node:crypto';
import type { AppointmentStatus } from '@prisma/client';
import type {
  AppointmentEventInput,
  AppointmentListQuery,
  AppointmentRecord,
  AppointmentRepository,
} from '../src/modules/appointments/repository.js';

export class InMemoryAppointmentRepository implements AppointmentRepository {
  readonly rows: AppointmentRecord[] = [];

  async list(businessId: string, query: AppointmentListQuery) {
    const all = this.rows
      .filter((row) => row.businessId === businessId)
      .filter((row) => !query.from || row.startsAt >= query.from)
      .filter((row) => !query.to || row.startsAt < query.to)
      .filter((row) => !query.status || row.status === query.status)
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
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async createAtomically(
    businessId: string,
    data: Pick<AppointmentRecord, 'customerId' | 'serviceId' | 'startsAt' | 'endsAt' | 'notes'>,
    _event?: AppointmentEventInput,
  ) {
    if (await this.hasConflict(businessId, data.startsAt, data.endsAt)) {
      return { kind: 'conflict' as const };
    }
    return { kind: 'created' as const, row: await this.create(businessId, data) };
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
    Object.assign(row, { startsAt, endsAt, updatedAt: new Date() });
    return row;
  }

  async rescheduleAtomically(
    businessId: string,
    id: string,
    startsAt: Date,
    endsAt: Date,
    _event?: AppointmentEventInput,
  ) {
    const current = await this.findById(businessId, id);
    if (!current) return { kind: 'not_found' as const };
    if (await this.hasConflict(businessId, startsAt, endsAt, id)) {
      return { kind: 'conflict' as const };
    }
    return {
      kind: 'updated' as const,
      row: (await this.reschedule(businessId, id, startsAt, endsAt)) as AppointmentRecord,
    };
  }

  async updateStatus(businessId: string, id: string, status: AppointmentStatus) {
    const row = await this.findById(businessId, id);
    if (!row) return null;
    row.status = status;
    row.updatedAt = new Date();
    return row;
  }

  async transitionAtomically(
    businessId: string,
    id: string,
    expectedStatus: AppointmentStatus,
    nextStatus: AppointmentStatus,
    _event?: AppointmentEventInput,
  ) {
    const current = await this.findById(businessId, id);
    if (!current) return { kind: 'not_found' as const };
    if (current.status !== expectedStatus) {
      return { kind: 'invalid_transition' as const, currentStatus: current.status };
    }
    return {
      kind: 'updated' as const,
      row: (await this.updateStatus(businessId, id, nextStatus)) as AppointmentRecord,
    };
  }

  async hasConflict(businessId: string, startsAt: Date, endsAt: Date, excludeId?: string) {
    return this.rows.some(
      (row) =>
        row.businessId === businessId &&
        row.id !== excludeId &&
        ['SCHEDULED', 'CONFIRMED'].includes(row.status) &&
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
