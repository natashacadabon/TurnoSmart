import type { AppointmentDto, SlotDto } from '@turnosmart/shared';

// Preserve UTC instants. The calendar's timeZone controls presentation.
export function slotToCalendarEvent(slot: SlotDto) {
  return { start: slot.startsAt, end: slot.endsAt };
}

export function appointmentToCalendarEvent(appointment: AppointmentDto, title: string) {
  return {
    ...slotToCalendarEvent(appointment),
    id: appointment.id,
    title,
    extendedProps: { status: appointment.status },
  };
}

export function slotTimeFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
