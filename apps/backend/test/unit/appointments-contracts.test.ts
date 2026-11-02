import { describe, expect, it } from 'vitest';
import {
  canTransitionAppointmentStatus,
  appointmentStatusTransitions,
  createAppointmentSchema,
  isTerminalAppointmentStatus,
  listAppointmentsQuerySchema,
  rescheduleAppointmentSchema,
  updateAppointmentSchema,
} from '@turnosmart/shared';

describe('contratos de turnos', () => {
  it('acepta una reserva válida y normaliza notas vacías', () => {
    const result = createAppointmentSchema.parse({
      customerId: '11111111-1111-4111-8111-111111111111',
      serviceId: '22222222-2222-4222-8222-222222222222',
      startsAt: '2026-11-10T14:00:00.000Z',
      notes: '  ',
    });

    expect(result.notes).toBeNull();
  });

  it('rechaza ids inválidos, timestamps locales y campos desconocidos', () => {
    const result = createAppointmentSchema.safeParse({
      customerId: 'customer-1',
      serviceId: '22222222-2222-4222-8222-222222222222',
      startsAt: '2026-11-10T14:00:00',
      unexpected: true,
    });

    expect(result.success).toBe(false);
  });

  it('valida la reprogramación como un instante UTC', () => {
    expect(
      rescheduleAppointmentSchema.safeParse({ startsAt: '2026-11-10T14:15:00.000Z' }).success,
    ).toBe(true);
    expect(
      rescheduleAppointmentSchema.safeParse({ startsAt: '2026-11-10T14:15:00-03:00' }).success,
    ).toBe(false);
  });

  it('aplica valores por defecto y filtros acotados en el listado', () => {
    expect(listAppointmentsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 50,
    });
    expect(
      listAppointmentsQuerySchema.safeParse({ status: 'UNKNOWN', pageSize: 101 }).success,
    ).toBe(false);
    expect(
      listAppointmentsQuerySchema.safeParse({ from: '2026-11-12', to: '2026-11-10' }).success,
    ).toBe(false);
  });

  it('rechaza un PATCH sin campos editables', () => {
    expect(updateAppointmentSchema.safeParse({}).success).toBe(false);
  });

  it('permite las transiciones operativas y bloquea estados terminales', () => {
    expect(canTransitionAppointmentStatus('SCHEDULED', 'CONFIRMED')).toBe(true);
    expect(canTransitionAppointmentStatus('CONFIRMED', 'CANCELLED')).toBe(true);
    expect(canTransitionAppointmentStatus('CANCELLED', 'CONFIRMED')).toBe(false);
    expect(canTransitionAppointmentStatus('COMPLETED', 'NO_SHOW')).toBe(false);
    expect(isTerminalAppointmentStatus('CANCELLED')).toBe(true);
    expect(isTerminalAppointmentStatus('SCHEDULED')).toBe(false);
    expect(appointmentStatusTransitions('CONFIRMED')).toEqual([
      'CANCELLED',
      'COMPLETED',
      'NO_SHOW',
    ]);
  });
});
