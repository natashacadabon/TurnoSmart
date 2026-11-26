import type { AvailabilityRuleInput } from '@turnosmart/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { appointmentFits } from '../availability/repository.js';

export interface BookingConfiguration {
  customerExists: boolean;
  service: { active: boolean; durationMinutes: number } | null;
  timezone: string;
  rules: AvailabilityRuleInput[];
}

/** El repositorio carga esta configuración después de bloquear el negocio. */
export function bookingEnd(configuration: BookingConfiguration, startsAt: Date, now: Date): Date {
  if (startsAt <= now) throw new AppError('APPOINTMENT_IN_PAST', 'El turno debe ser futuro');
  if (!configuration.customerExists) throw notFound('Cliente');
  if (!configuration.service) throw notFound('Servicio');
  if (!configuration.service.active)
    throw new AppError('SERVICE_INACTIVE', 'El servicio esta inactivo');
  const endsAt = new Date(startsAt.getTime() + configuration.service.durationMinutes * 60_000);
  if (!appointmentFits({ startsAt, endsAt }, configuration.rules, configuration.timezone)) {
    throw new AppError(
      'APPOINTMENT_OUTSIDE_AVAILABILITY',
      'El turno queda fuera de la disponibilidad del negocio',
    );
  }
  return endsAt;
}
