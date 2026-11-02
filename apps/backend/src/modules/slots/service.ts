import { replaceAvailabilityRulesSchema, type SlotsQuery } from '@turnosmart/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { localTime, type AvailabilityRepository } from '../availability/repository.js';
import { availabilityWindows, calculateSlots } from './calculator.js';
import type { SlotsRepository } from './repository.js';

export class SlotsService {
  constructor(
    private readonly repository: SlotsRepository,
    private readonly availability: AvailabilityRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(businessId: string, timezone: string, query: SlotsQuery) {
    const now = this.clock();
    const service = await this.repository.findService(businessId, query.serviceId);
    if (!service) throw notFound('Servicio');
    if (!service.active) throw new AppError('SERVICE_INACTIVE', 'El servicio esta inactivo');
    if (query.excludeAppointmentId) {
      const appointment = await this.repository.findAppointment(
        businessId,
        query.excludeAppointmentId,
      );
      if (!appointment) throw notFound('Turno');
      if (appointment.serviceId !== query.serviceId)
        throw new AppError('APPOINTMENT_SERVICE_MISMATCH', 'El turno pertenece a otro servicio');
      if (!['SCHEDULED', 'CONFIRMED'].includes(appointment.status) || appointment.startsAt <= now)
        throw new AppError('APPOINTMENT_NOT_RESCHEDULABLE', 'El turno no admite reprogramacion');
    }
    const week = await this.availability.list(businessId);
    const parsed = replaceAvailabilityRulesSchema.safeParse({
      rules: week.rules.map((r) => ({
        dayOfWeek: r.dayOfWeek,
        startTime: localTime(r.startTime),
        endTime: localTime(r.endTime),
        active: r.active,
      })),
    });
    if (!parsed.success)
      throw new AppError('INTERNAL_ERROR', 'Configuracion de disponibilidad invalida');
    const windows = availabilityWindows(query.date, timezone, parsed.data.rules);
    if (!windows.length) return [];
    const range = {
      startsAt: new Date(Math.min(...windows.map((w) => w.startsAt.getTime()))),
      endsAt: new Date(Math.max(...windows.map((w) => w.endsAt.getTime()))),
    };
    const occupied = await this.repository.occupied(businessId, range, query.excludeAppointmentId);
    return calculateSlots(windows, service.durationMinutes, occupied, now);
  }
}
