import {
  type AppointmentStatus,
  type CreateAppointmentRequest,
  type ListAppointmentsQuery,
  type RescheduleAppointmentRequest,
} from '@turnosmart/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { calculateNoShowRisk } from '../ai/risk-calculator.js';
import type { AppointmentRepository, RiskScoreValues } from './repository.js';

export class AppointmentService {
  constructor(
    private readonly appointments: AppointmentRepository,
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

  async create(businessId: string, input: CreateAppointmentRequest, operationKey?: string) {
    const startsAt = new Date(input.startsAt);
    const risk = await this.calculateRiskScore(businessId, input.customerId, startsAt);
    const result = await this.appointments.createAtomically(
      businessId,
      {
        customerId: input.customerId,
        serviceId: input.serviceId,
        startsAt,
        notes: input.notes ?? null,
      },
      { type: 'CREATED', ...(operationKey && { operationKey }) },
      this.clock,
      risk,
    );
    if (result.kind === 'conflict') {
      throw new AppError('APPOINTMENT_TIME_CONFLICT', 'El horario ya esta ocupado');
    }
    return result.row;
  }

  async updateNotes(businessId: string, id: string, notes: string | null) {
    const row = await this.appointments.updateNotes(businessId, id, notes);
    if (!row) throw notFound('Turno');
    return row;
  }

  async reschedule(
    businessId: string,
    id: string,
    input: RescheduleAppointmentRequest,
    requestId?: string,
    actorId?: string,
    operationKey?: string,
  ) {
    const startsAt = new Date(input.startsAt);
    const current = await this.appointments.findById(businessId, id);
    if (!current) throw notFound('Turno');
    const risk = await this.calculateRiskScore(businessId, current.customerId, startsAt);
    const result = await this.appointments.rescheduleAtomically(
      businessId,
      id,
      startsAt,
      {
        type: 'RESCHEDULED',
        ...(operationKey && { operationKey }),
        metadata: { startsAt: startsAt.toISOString(), ...(actorId && { actorId }) },
      },
      this.clock,
      requestId,
      risk,
    );
    if (result.kind === 'not_found') throw notFound('Turno');
    if (result.kind === 'conflict') {
      throw new AppError('APPOINTMENT_TIME_CONFLICT', 'El horario ya esta ocupado');
    }
    return result.row;
  }

  async transition(
    businessId: string,
    id: string,
    status: AppointmentStatus,
    actorId?: string,
    operationKey?: string,
  ) {
    const result = await this.appointments.transitionAtomically(
      businessId,
      id,
      status,
      actorId,
      operationKey,
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

  private async calculateRiskScore(
    businessId: string,
    customerId: string,
    startsAt: Date,
  ): Promise<RiskScoreValues> {
    const history = await this.appointments.customerStats(businessId, customerId, startsAt);
    return calculateNoShowRisk({
      startsAt,
      now: this.clock(),
      history,
    });
  }
}
