import type { SlotsRepository, SlotAppointment } from '../src/modules/slots/repository.js';
import type { Interval } from '../src/modules/slots/calculator.js';
import type { InMemoryServices } from './services-fakes.js';

export class InMemorySlots implements SlotsRepository {
  rows: (SlotAppointment & { businessId: string })[] = [];
  constructor(private readonly services: InMemoryServices) {}
  async findService(businessId: string, id: string) {
    return this.services.rows.find((r) => r.id === id && r.businessId === businessId) ?? null;
  }
  async findAppointment(businessId: string, id: string) {
    return this.rows.find((r) => r.id === id && r.businessId === businessId) ?? null;
  }
  async occupied(businessId: string, range: Interval, excludeId?: string) {
    return this.rows.filter(
      (r) =>
        r.businessId === businessId &&
        r.id !== excludeId &&
        ['SCHEDULED', 'CONFIRMED'].includes(r.status) &&
        r.startsAt < range.endsAt &&
        r.endsAt > range.startsAt,
    );
  }
}
