import {
  canTransitionAppointmentStatus,
  type AppointmentStatus,
  type CreateAppointmentRequest,
  type ListAppointmentsQuery,
  type RescheduleAppointmentRequest,
} from '@turnosmart/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { calculateNoShowRisk } from '../ai/risk-calculator.js';
import type { RiskRepository } from '../ai/risk-repository.js';
import type { AppointmentRepository } from './repository.js';

export class AppointmentService {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly risk: RiskRepository,
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
    const result = await this.appointments.createAtomically(
      businessId,
      {
        customerId: input.customerId,
        serviceId: input.serviceId,
        startsAt,
        notes: input.notes ?? null,
      },
      { type: 'CREATED' },
      this.clock,
    );
    if (result.kind === 'conflict') {
      throw new AppError('APPOINTMENT_TIME_CONFLICT', 'El horario ya esta ocupado');
    }
    await this.persistRiskScore(businessId, result.row);
    return result.row;
  }

  async updateNotes(businessId: string, id: string, notes: string | null) {
    const row = await this.appointments.updateNotes(businessId, id, notes);
    if (!row) throw notFound('Turno');
    return row;
  }

  async reschedule(businessId: string, id: string, input: RescheduleAppointmentRequest) {
    const startsAt = new Date(input.startsAt);
    const result = await this.appointments.rescheduleAtomically(
      businessId,
      id,
      startsAt,
      {
        type: 'RESCHEDULED',
        metadata: { startsAt: startsAt.toISOString() },
      },
      this.clock,
    );
    if (result.kind === 'not_found') throw notFound('Turno');
    if (result.kind === 'conflict') {
      throw new AppError('APPOINTMENT_TIME_CONFLICT', 'El horario ya esta ocupado');
    }
    await this.persistRiskScore(businessId, result.row);
    return result.row;
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
    const eventType =
      status === 'NO_SHOW'
        ? ('MARKED_NO_SHOW' as const)
        : (status as 'CONFIRMED' | 'CANCELLED' | 'COMPLETED');
    const result = await this.appointments.transitionAtomically(
      businessId,
      id,
      current.status,
      status,
      {
        type: eventType,
        metadata: { previousStatus: current.status, status },
      },
    );
    if (result.kind === 'not_found') throw notFound('Turno');
    if (result.kind === 'invalid_transition') {
      throw new AppError(
        'APPOINTMENT_INVALID_TRANSITION',
        `No se puede pasar de ${result.currentStatus} a ${status}`,
      );
    }
    return result.row;
  }

  private async persistRiskScore(
    businessId: string,
    appointment: { id: string; customerId: string; startsAt: Date },
  ) {
    const history = await this.appointments.customerStats(
      businessId,
      appointment.customerId,
      appointment.startsAt,
    );
    const risk = calculateNoShowRisk({
      startsAt: appointment.startsAt,
      now: this.clock(),
      history,
    });
    await this.risk.upsert(businessId, {
      appointmentId: appointment.id,
      ...risk,
    });
  }
}
