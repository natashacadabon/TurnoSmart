import { isTerminalAppointmentStatus, type AppointmentDto } from '@turnosmart/shared';
import { businessDate } from './booking';
import { canApplyAppointmentAction, type AppointmentAction } from './appointment-actions';
export { appointmentActions as reminderActions } from './appointment-actions';
export type ReminderAction = AppointmentAction;

const MINUTE = 60_000;
export const REMINDER_LEAD_MS = 10 * MINUTE;
export const REMINDER_SNOOZE_MS = 5 * MINUTE;
export type ReminderPhase = 'soon' | 'started';
export type ReminderPreference = { dismissed?: boolean; until?: number; seen?: ReminderPhase };
export type ReminderPreferences = Record<string, ReminderPreference>;

export function reminderKey(appointment: AppointmentDto) {
  return appointment.id + '/' + appointment.startsAt;
}

export function canApplyReminderAction(
  appointment: AppointmentDto,
  action: ReminderAction,
  now: number,
) {
  const started = Date.parse(appointment.startsAt) <= now;
  return canApplyAppointmentAction(appointment, action, now) && !(action === 'confirm' && started);
}

export function agendaReminders(
  appointments: AppointmentDto[],
  now: number,
  timezone: string,
  preferences: ReminderPreferences,
) {
  const today = businessDate(new Date(now), timezone);
  const queue = [];
  let nextTick = Infinity;
  function wakeAt(at: number) {
    if (at > now) nextTick = Math.min(nextTick, at);
  }
  for (const appointment of appointments) {
    if (isTerminalAppointmentStatus(appointment.status)) continue;
    const key = reminderKey(appointment);
    const preference = preferences[key];
    if (preference?.dismissed) continue;
    const start = Date.parse(appointment.startsAt);
    const remaining = start - now;
    // Los pendientes anteriores al día actual no se acumulan en la cola.
    if (remaining <= 0 && businessDate(new Date(start), timezone) !== today) continue;
    if (remaining > REMINDER_LEAD_MS) {
      wakeAt(start - REMINDER_LEAD_MS);
      continue;
    }
    if (preference?.until && preference.until > now) {
      wakeAt(preference.until);
      continue;
    }
    const phase: ReminderPhase = remaining > 0 ? 'soon' : 'started';
    const minutes = Math.ceil(remaining / MINUTE);
    if (phase === 'soon') wakeAt(start - (minutes - 1) * MINUTE);
    else wakeAt(start + MINUTE);
    queue.push({ appointment, key, phase, minutes, fresh: preference?.seen !== phase });
  }
  queue.sort((a, b) => {
    const rank = (minutes: number) => (minutes >= 0 ? minutes : Infinity);
    return (
      rank(a.minutes) - rank(b.minutes) ||
      0 ||
      (a.minutes < 0 && b.minutes < 0
        ? Date.parse(b.appointment.startsAt) - Date.parse(a.appointment.startsAt)
        : Date.parse(a.appointment.startsAt) - Date.parse(b.appointment.startsAt))
    );
  });
  return { queue, nextTick };
}
