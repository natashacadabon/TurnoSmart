import { randomUUID } from 'node:crypto';
import type { AvailabilityRuleInput } from '@turnosmart/shared';
import type { InMemoryIdentity } from './fakes.js';
import type {
  AvailabilityRecord,
  AvailabilityRepository,
} from '../src/modules/availability/repository.js';

/** Doble HTTP: las transacciones se verifican por separado en PostgreSQL. */
export class InMemoryAvailability implements AvailabilityRepository {
  rows: AvailabilityRecord[] = [];
  constructor(private readonly identity: InMemoryIdentity) {}
  async list(businessId: string) {
    return {
      timezone: this.identity.businesses.get(businessId)!.timezone,
      rules: this.rows
        .filter((row) => row.businessId === businessId)
        .sort(
          (a, b) =>
            a.dayOfWeek - b.dayOfWeek ||
            a.startTime.getTime() - b.startTime.getTime() ||
            a.endTime.getTime() - b.endTime.getTime() ||
            a.id.localeCompare(b.id),
        ),
    };
  }
  async replace(businessId: string, rules: AvailabilityRuleInput[]) {
    const now = new Date();
    const rows = rules.map((rule) => {
      const startTime = new Date(`1970-01-01T${rule.startTime}:00.000Z`);
      const endTime = new Date(`1970-01-01T${rule.endTime}:00.000Z`);
      const previous = this.rows.find(
        (row) =>
          row.businessId === businessId &&
          row.dayOfWeek === rule.dayOfWeek &&
          row.startTime.getTime() === startTime.getTime() &&
          row.endTime.getTime() === endTime.getTime(),
      );
      return {
        ...rule,
        startTime,
        endTime,
        businessId,
        id: previous?.id ?? randomUUID(),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
    });
    this.rows = [...this.rows.filter((row) => row.businessId !== businessId), ...rows];
    return this.list(businessId);
  }
}
