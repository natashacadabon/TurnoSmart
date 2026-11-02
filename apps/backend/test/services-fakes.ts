import { randomUUID } from 'node:crypto';
import type { ListServicesQuery } from '@turnosmart/shared';
import { AppError } from '../src/lib/errors.js';
import type {
  ServiceData,
  ServiceRecord,
  ServiceRepository,
} from '../src/modules/services/repository.js';

/** Doble para HTTP; no sustituye pruebas de PostgreSQL o RLS. */
export class InMemoryServices implements ServiceRepository {
  readonly rows: ServiceRecord[] = [];
  async list(businessId: string, query: ListServicesQuery) {
    const all = this.rows
      .filter(
        (r) =>
          r.businessId === businessId &&
          (query.active === 'all' || r.active === (query.active === 'true')),
      )
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { items: all.slice(query.offset, query.offset + query.limit), total: all.length };
  }
  async create(businessId: string, data: ServiceData) {
    if (this.rows.some((r) => r.businessId === businessId && r.name === data.name))
      throw new AppError('SERVICE_NAME_CONFLICT', 'Nombre duplicado');
    const now = new Date();
    const row = { ...data, id: randomUUID(), businessId, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }
  async update(businessId: string, id: string, data: Partial<ServiceData>) {
    const row = this.rows.find((r) => r.id === id && r.businessId === businessId);
    if (!row) return null;
    if (
      data.name !== undefined &&
      this.rows.some((r) => r.businessId === businessId && r.id !== id && r.name === data.name)
    )
      throw new AppError('SERVICE_NAME_CONFLICT', 'Nombre duplicado');
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  }
}
