import { expect, test } from '@playwright/test';
import {
  appointmentToCalendarEvent,
  slotTimeFormatter,
  slotToCalendarEvent,
} from '../src/lib/calendar-events';

test('preserva instantes UTC y presenta el horario en la zona del negocio', () => {
  const slot = { startsAt: '2026-11-04T02:45:00.000Z', endsAt: '2026-11-04T03:15:00.000Z' };
  expect(slotToCalendarEvent(slot)).toEqual({ start: slot.startsAt, end: slot.endsAt });
  const formatter = slotTimeFormatter('America/Argentina/Buenos_Aires');
  expect(formatter.format(new Date(slot.startsAt))).toBe('23:45');
  expect(formatter.format(new Date(slot.endsAt))).toBe('00:15');
  expect(
    appointmentToCalendarEvent(
      {
        ...slot,
        id: 'turno',
        customerId: 'cliente',
        serviceId: 'servicio',
        status: 'CONFIRMED',
        notes: 'privado',
        createdAt: slot.startsAt,
        updatedAt: slot.startsAt,
      },
      'Consulta',
    ),
  ).toEqual({
    start: slot.startsAt,
    end: slot.endsAt,
    id: 'turno',
    title: 'Consulta',
    extendedProps: { status: 'CONFIRMED' },
  });
});
