import {
  canTransitionAppointmentStatus,
  isTerminalAppointmentStatus,
  type AppointmentDto,
} from '@turnosmart/shared';
import { api } from './api';

export const appointmentActions = {
  confirm: { status: 'CONFIRMED', label: 'Confirmar turno' },
  cancel: { status: 'CANCELLED', label: 'Cancelar turno' },
  complete: { status: 'COMPLETED', label: 'Marcar completado' },
  'no-show': { status: 'NO_SHOW', label: 'Marcar ausente' },
} as const;
export type AppointmentAction = keyof typeof appointmentActions;

export function canApplyAppointmentAction(
  appointment: AppointmentDto,
  action: AppointmentAction,
  now: number,
) {
  const needsStart = action === 'complete' || action === 'no-show';
  return (
    canTransitionAppointmentStatus(appointment.status, appointmentActions[action].status) &&
    (!needsStart || Date.parse(appointment.startsAt) <= now)
  );
}

export function canRescheduleAppointment(appointment: AppointmentDto, now: number) {
  return !isTerminalAppointmentStatus(appointment.status) && Date.parse(appointment.startsAt) > now;
}

export function appointmentChanged(previous: AppointmentDto, current: AppointmentDto) {
  return (
    previous.status !== current.status ||
    previous.startsAt !== current.startsAt ||
    previous.endsAt !== current.endsAt
  );
}

export async function transitionAppointment(
  appointment: AppointmentDto,
  action: AppointmentAction,
  canApply = canApplyAppointmentAction,
) {
  const path = '/api/appointments/' + appointment.id;
  const fresh = await api<AppointmentDto>(path);
  if (appointmentChanged(appointment, fresh) || !canApply(fresh, action, Date.now())) {
    return { kind: 'stale' as const, appointment: fresh };
  }
  const saved = await api<AppointmentDto>(path + '/' + action, { method: 'POST' });
  return { kind: 'saved' as const, appointment: saved };
}
