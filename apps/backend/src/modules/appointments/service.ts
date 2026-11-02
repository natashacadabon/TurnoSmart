import {
  canTransitionAppointmentStatus,
  type AppointmentStatus,
  type CreateAppointmentRequest,
  type ListAppointmentsQuery,
  type RescheduleAppointmentRequest,
} from '@turnosmart/shared';
import { AppError, notFound } from '../../lib/errors.js';
import {
  appointmentFits,
  localTime,
  type AvailabilityRepository,
} from '../availability/repository.js';
import type { CustomerRepository } from '../customers/repository.js';
import type { ServiceRepository } from '../services/repository.js';
import type { AppointmentRepository } from './repository.js';

const ACTIVE_STATUSES: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED'];

export class AppointmentService {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly customers: CustomerRepository,
    private readonly services: ServiceRepository,
    private readonly availability: AvailabilityRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  list(businessId: string, query: ListAppointmentsQuery) {
    const range = {
      ...(query.from ? { from: new Date(`${query.from}T00:00:00.000Z`) } : {}),
      ...(query.to
        ? { to: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000) }
        : {}),
    };
    return this.appointments.list(businessId, {
      ...range,
      page: query.page,
      pageSize: query.pageSize,
      ...(query.status ? { status: query.status } : {}),
    });
  }

  findById(businessId: string, id: string) {
    return this.appointments.findById(businessId, id);
  }

  async create(businessId: string, input: CreateAppointmentRequest) {
    const startsAt = new Date(input.startsAt);
    const service = await this.validateBooking(
      businessId,
      input.customerId,
      input.serviceId,
      startsAt,
    );
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
    await this.ensureAvailable(businessId, startsAt, endsAt);
    return this.appointments.create(businessId, {
      customerId: input.customerId,
      serviceId: input.serviceId,
      startsAt,
      endsAt,
      notes: input.notes ?? null,
    });
  }

  async updateNotes(businessId: string, id: string, notes: string | null) {
    const row = await this.appointments.updateNotes(businessId, id, notes);
    if (!row) throw notFound('Turno');
    return row;
  }

  async reschedule(businessId: string, id: string, input: RescheduleAppointmentRequest) {
    const current = await this.appointments.findById(businessId, id);
    if (!current) throw notFound('Turno');
    if (!ACTIVE_STATUSES.includes(current.status) || current.startsAt <= this.clock()) {
      throw new AppError('APPOINTMENT_NOT_RESCHEDULABLE', 'El turno no admite reprogramacion');
    }
    const startsAt = new Date(input.startsAt);
    const service = await this.validateBooking(
      businessId,
      current.customerId,
      current.serviceId,
      startsAt,
    );
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
    await this.ensureAvailable(businessId, startsAt, endsAt, id);
    const row = await this.appointments.reschedule(businessId, id, startsAt, endsAt);
    if (!row) throw notFound('Turno');
    return row;
  }

  async transition(businessId: string, id: string, status: AppointmentStatus) {
    const current = await this.appointments.findById(businessId, id);
    if (!current) throw notFound('Turno');
    if (!canTransitionAppointmentStatus(current.status, status)) {
      throw new AppError(
        'APPOINTMENT_INVALID_TRANSITION',
        `No se puede pasar de ${current.status} a ${status}`,
      );
    }
    const row = await this.appointments.updateStatus(businessId, id, status);
    if (!row) throw notFound('Turno');
    return row;
  }

  private async validateBooking(
    businessId: string,
    customerId: string,
    serviceId: string,
    startsAt: Date,
  ) {
    if (startsAt <= this.clock())
      throw new AppError('APPOINTMENT_IN_PAST', 'El turno debe ser futuro');
    if (!(await this.customers.findById(businessId, customerId))) throw notFound('Cliente');
    const service = await this.services.findById(businessId, serviceId);
    if (!service) throw notFound('Servicio');
    if (!service.active) throw new AppError('SERVICE_INACTIVE', 'El servicio esta inactivo');
    return service;
  }

  private async ensureAvailable(
    businessId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
  ) {
    const week = await this.availability.list(businessId);
    const rules = week.rules.map((rule) => ({
      dayOfWeek: rule.dayOfWeek,
      startTime: localTime(rule.startTime),
      endTime: localTime(rule.endTime),
      active: rule.active,
    }));
    if (!appointmentFits({ startsAt, endsAt }, rules, week.timezone)) {
      throw new AppError(
        'APPOINTMENT_OUTSIDE_AVAILABILITY',
        'El turno queda fuera de la disponibilidad del negocio',
      );
    }
    if (await this.appointments.hasConflict(businessId, startsAt, endsAt, excludeId)) {
      throw new AppError('APPOINTMENT_TIME_CONFLICT', 'El horario ya esta ocupado');
    }
  }
}
