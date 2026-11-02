import { randomUUID } from 'node:crypto';
import type { AppointmentStatus } from '@prisma/client';
import type {
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

  async updateStatus(businessId: string, id: string, status: AppointmentStatus) {
    const row = await this.findById(businessId, id);
    if (!row) return null;
    row.status = status;
    row.updatedAt = new Date();
    return row;
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
}
