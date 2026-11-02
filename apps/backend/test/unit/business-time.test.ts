import { describe, expect, it } from 'vitest';
import type { AvailabilityRuleInput } from '@turnosmart/shared';
import {
  BusinessCalendar,
  availabilityWindows,
  appointmentFits,
  localTime,
  timezoneFormatter,
} from '../../src/lib/business-time.js';
import { calculateSlots } from '../../src/modules/slots/calculator.js';

const interval = (start: string, end: string) => ({
  startsAt: new Date(start),
  endsAt: new Date(end),
});
const rule = (date: string, startTime = '00:00', endTime = '04:00'): AvailabilityRuleInput => ({
  dayOfWeek: new Date(`${date}T00:00Z`).getUTCDay(),
  startTime,
  endTime,
  active: true,
});
const temporal = { code: 'AVAILABILITY_TIME_UNRESOLVABLE', status: 409 };

describe('D06: una politica comun para B04/B05', () => {
  it.each([
    ['2026-03-08', 'America/New_York', '2026-03-08T06:30Z', '2026-03-08T07:30Z'],
    ['2026-11-01', 'America/New_York', '2026-11-01T05:30Z', '2026-11-01T07:30Z'],
    ['2026-04-05', 'Australia/Lord_Howe', '2026-04-04T14:45Z', '2026-04-04T15:45Z'],
    ['2026-10-04', 'Australia/Lord_Howe', '2026-10-03T15:15Z', '2026-10-03T16:15Z'],
    ['2026-03-08', 'America/Havana', '2026-03-08T05:00Z', '2026-03-08T06:00Z'],
    ['2026-11-01', 'America/Havana', '2026-11-01T04:15Z', '2026-11-01T05:15Z'],
  ])('mismo 409 para franja y turno en %s %s', (date, zone, start, end) => {
    const calendar = new BusinessCalendar(zone, [rule(date)]);
    expect(() => calendar.windows(date)).toThrow(expect.objectContaining(temporal));
    expect(() => calendar.contains(interval(start, end))).toThrow(
      expect.objectContaining(temporal),
    );
  });

  it('rechaza ambas ocurrencias ambiguas aunque sus propios extremos tengan igual offset', () => {
    const rules = [rule('2026-11-01', '01:00', '02:00')];
    for (const hour of ['05', '06'])
      expect(() =>
        appointmentFits(
          interval(`2026-11-01T${hour}:10Z`, `2026-11-01T${hour}:20Z`),
          rules,
          'America/New_York',
        ),
      ).toThrow(expect.objectContaining(temporal));
  });

  it('no desplaza limites inexistentes ni une franjas para evitar una transicion', () => {
    for (const [start, end] of [
      ['01:00', '02:00'],
      ['02:00', '04:00'],
    ])
      expect(() =>
        availabilityWindows('2026-03-08', 'America/New_York', [rule('2026-03-08', start, end)]),
      ).toThrow(expect.objectContaining(temporal));
    expect(() =>
      availabilityWindows('2026-11-01', 'America/New_York', [
        rule('2026-11-01', '00:00', '01:00'),
        rule('2026-11-01', '01:00', '04:00'),
      ]),
    ).toThrow(expect.objectContaining(temporal));
  });

  it('la fecha completa falla si otra franja activa es irresoluble; inactivas/otros dias no afectan', () => {
    const safe = rule('2026-11-01', '03:00', '04:00');
    const ambiguous = rule('2026-11-01', '01:00', '02:00');
    const booked = interval('2026-11-01T08:00Z', '2026-11-01T09:00Z');
    expect(() => appointmentFits(booked, [safe, ambiguous], 'America/New_York')).toThrow(
      expect.objectContaining(temporal),
    );
    expect(
      appointmentFits(booked, [safe, { ...ambiguous, active: false }], 'America/New_York'),
    ).toBe(true);
    expect(
      appointmentFits(booked, [safe, { ...ambiguous, dayOfWeek: 1 }], 'America/New_York'),
    ).toBe(true);
    expect(appointmentFits(booked, [], 'America/New_York')).toBe(false);
  });

  it.each([
    [
      '2026-03-08',
      'America/New_York',
      '00:00',
      '01:00',
      '2026-03-08T05:00:00.000Z',
      '2026-03-08T06:00:00.000Z',
    ],
    [
      '2026-03-08',
      'America/New_York',
      '03:00',
      '04:00',
      '2026-03-08T07:00:00.000Z',
      '2026-03-08T08:00:00.000Z',
    ],
    [
      '2026-11-01',
      'America/New_York',
      '02:00',
      '03:00',
      '2026-11-01T07:00:00.000Z',
      '2026-11-01T08:00:00.000Z',
    ],
    [
      '2026-04-05',
      'Australia/Lord_Howe',
      '02:00',
      '03:00',
      '2026-04-04T15:30:00.000Z',
      '2026-04-04T16:30:00.000Z',
    ],
    [
      '2026-11-02',
      'Pacific/Kiritimati',
      '00:10',
      '01:10',
      '2026-11-01T10:10:00.000Z',
      '2026-11-01T11:10:00.000Z',
    ],
    [
      '2026-11-02',
      'Pacific/Pago_Pago',
      '23:00',
      '23:59',
      '2026-11-03T10:00:00.000Z',
      '2026-11-03T10:59:00.000Z',
    ],
    [
      '2026-11-02',
      'Asia/Kathmandu',
      '09:00',
      '10:00',
      '2026-11-02T03:15:00.000Z',
      '2026-11-02T04:15:00.000Z',
    ],
    [
      '2026-11-02',
      'America/Argentina/Buenos_Aires',
      '00:00',
      '01:00',
      '2026-11-02T03:00:00.000Z',
      '2026-11-02T04:00:00.000Z',
    ],
  ])('limites y slots correctos %s %s %s–%s', (date, zone, start, end, utcStart, utcEnd) => {
    const calendar = new BusinessCalendar(zone, [rule(date, start, end)]);
    const windows = calendar.windows(date);
    expect(windows).toEqual([interval(utcStart, utcEnd)]);
    expect(calendar.contains(interval(utcStart, utcEnd))).toBe(true);
    expect(
      calendar.contains({
        startsAt: new Date(new Date(utcStart).getTime() - 1),
        endsAt: new Date(utcEnd),
      }),
    ).toBe(false);
    expect(
      calendar.contains({
        startsAt: new Date(utcStart),
        endsAt: new Date(new Date(utcEnd).getTime() + 1),
      }),
    ).toBe(false);
    const slots = calculateSlots(windows, 15, [], new Date('2026-01-01T00:00Z'));
    expect(slots[0]?.startsAt).toBe(utcStart);
    expect(new Set(slots.map((s) => s.startsAt)).size).toBe(slots.length);
    expect(slots.every((s) => calendar.contains(interval(s.startsAt, s.endsAt)))).toBe(true);
    expect(slots.map((s) => s.startsAt)).toEqual(slots.map((s) => s.startsAt).sort());
  });

  it('rechaza cruce de medianoche local aunque los instantes compartan fecha UTC', () => {
    expect(
      appointmentFits(
        interval('2026-11-02T02:30Z', '2026-11-02T03:30Z'),
        [rule('2026-11-01', '00:00', '23:59')],
        'America/Argentina/Buenos_Aires',
      ),
    ).toBe(false);
  });

  it('conserva anios ISO 0000/0099 y no los convierte a 1900/1999', () => {
    for (const year of ['0000', '0099']) {
      const date = `${year}-01-01`;
      expect(availabilityWindows(date, 'UTC', [rule(date, '09:00', '10:00')])).toEqual([
        interval(`${date}T09:00Z`, `${date}T10:00Z`),
      ]);
    }
  });

  it('rechaza un dia omitido; config persistida invalida conserva 500', () => {
    expect(() => availabilityWindows('2011-12-30', 'Pacific/Apia', [rule('2011-12-30')])).toThrow(
      expect.objectContaining(temporal),
    );
    for (const zone of ['invalid', '+03:00', '-04:00'])
      expect(() => timezoneFormatter(zone)).toThrow(
        expect.objectContaining({ code: 'INTERNAL_ERROR' }),
      );
    expect(() => localTime(new Date('1970-01-01T09:00:01Z'))).toThrow(
      expect.objectContaining({ code: 'INTERNAL_ERROR' }),
    );
  });
});
