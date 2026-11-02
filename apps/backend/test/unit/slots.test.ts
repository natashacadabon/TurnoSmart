import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { slotsQuerySchema } from '@turnosmart/shared';
import { availabilityWindows, calculateSlots } from '../../src/modules/slots/calculator.js';
import { PrismaSlotsRepository } from '../../src/modules/slots/repository.js';

const rule = { dayOfWeek: 1, startTime: '09:10', endTime: '12:10', active: true };
const interval = (start: string, end: string) => ({
  startsAt: new Date(start),
  endsAt: new Date(end),
});
const now = new Date('2026-01-01T00:00:00Z');
const times = (slots: { startsAt: string }[]) => slots.map((s) => s.startsAt.slice(11, 16));

describe('calculo puro de slots', () => {
  const windows = availabilityWindows('2026-11-02', 'America/Argentina/Buenos_Aires', [rule]);
  it('ancla cada 15 minutos al inicio de franja, usa duracion real y devuelve UTC ordenado', () => {
    const slots = calculateSlots(windows, 60, [], now);
    expect(times(slots)).toEqual([
      '12:10',
      '12:25',
      '12:40',
      '12:55',
      '13:10',
      '13:25',
      '13:40',
      '13:55',
      '14:10',
    ]);
    expect(slots[0]).toEqual({
      startsAt: '2026-11-02T12:10:00.000Z',
      endsAt: '2026-11-02T13:10:00.000Z',
    });
    expect(calculateSlots(windows, 180, [], now)).toHaveLength(1);
    expect(calculateSlots(windows, 181, [], now)).toEqual([]);
  });
  it.each([
    ['12:10', '12:11'],
    ['12:09', '12:11'],
    ['12:11', '12:12'],
    ['12:00', '12:30'],
    ['12:00', '16:00'],
  ])('excluye toda forma de solapamiento %s–%s', (start, end) => {
    const occupied = [interval(`2026-11-02T${start}:00Z`, `2026-11-02T${end}:00Z`)];
    expect(times(calculateSlots(windows, 60, occupied, now))).not.toContain('12:10');
  });
  it('permite adyacencia exacta y bloquea por milisegundos', () => {
    expect(
      times(calculateSlots(windows, 60, [interval('2026-11-02T13:10Z', '2026-11-02T14:10Z')], now)),
    ).toEqual(['12:10', '14:10']);
    expect(
      times(
        calculateSlots(
          windows,
          60,
          [interval('2026-11-02T13:09:59.999Z', '2026-11-02T14:10:00.001Z')],
          now,
        ),
      ),
    ).toEqual([]);
  });
  it('exige una unica franja aunque sean adyacentes; filtra dias/inactivas y ordena', () => {
    const split = availabilityWindows('2026-11-02', 'UTC', [
      { ...rule, startTime: '10:10', endTime: '11:10' },
      { ...rule, endTime: '10:10' },
      { ...rule, active: false, startTime: '13:00', endTime: '14:00' },
      { ...rule, dayOfWeek: 2 },
    ]);
    expect(times(calculateSlots(split, 60, [], now))).toEqual(['09:10', '10:10']);
    expect(calculateSlots(split, 61, [], now)).toEqual([]);
    expect(availabilityWindows('2026-11-03', 'UTC', [rule])).toEqual([]);
  });
  it('solo incluye comienzos estrictamente futuros y no redondea now', () => {
    expect(times(calculateSlots(windows, 60, [], new Date('2026-11-02T13:10Z')))[0]).toBe('13:25');
    expect(times(calculateSlots(windows, 60, [], new Date('2026-11-02T13:09:59.999Z')))[0]).toBe(
      '13:10',
    );
    expect(calculateSlots(windows, 60, [], new Date('2026-11-03T00:00Z'))).toEqual([]);
    expect(() => calculateSlots(windows, 0, [], now)).toThrow();
  });
});

describe('zonas IANA y D06 sin desambiguacion implicita', () => {
  const sunday = { ...rule, dayOfWeek: 0, startTime: '00:00', endTime: '04:00' };
  it.each([
    ['2026-03-08', 'America/New_York', '02:00', '03:00'],
    ['2026-03-08', 'America/New_York', '01:00', '04:00'],
    ['2026-11-01', 'America/New_York', '01:00', '02:00'],
    ['2026-11-01', 'America/New_York', '00:00', '04:00'],
    ['2026-10-04', 'Australia/Lord_Howe', '01:00', '04:00'],
    ['2026-04-05', 'Australia/Lord_Howe', '01:30', '02:30'],
  ])('rechaza gap, fold o transicion interna %s %s', (date, timezone, startTime, endTime) => {
    expect(() => availabilityWindows(date, timezone, [{ ...sunday, startTime, endTime }])).toThrow(
      expect.objectContaining({ code: 'AVAILABILITY_TIME_UNRESOLVABLE' }),
    );
  });
  it('resuelve franjas univocas antes/despues del salto y offsets fraccionarios', () => {
    expect(
      availabilityWindows('2026-03-08', 'America/New_York', [{ ...sunday, startTime: '03:00' }])[0],
    ).toEqual(interval('2026-03-08T07:00Z', '2026-03-08T08:00Z'));
    expect(
      availabilityWindows('2026-11-01', 'America/New_York', [{ ...sunday, startTime: '02:00' }])[0],
    ).toEqual(interval('2026-11-01T07:00Z', '2026-11-01T09:00Z'));
    expect(
      availabilityWindows('2026-11-02', 'Asia/Kathmandu', [rule])[0]?.startsAt.toISOString(),
    ).toBe('2026-11-02T03:25:00.000Z');
    expect(
      availabilityWindows('2026-11-02', 'Pacific/Kiritimati', [rule])[0]?.startsAt.toISOString(),
    ).toBe('2026-11-01T19:10:00.000Z');
  });
  it('rechaza un dia local omitido y zona invalida', () => {
    expect(() =>
      availabilityWindows('2011-12-30', 'Pacific/Apia', [{ ...rule, dayOfWeek: 5 }]),
    ).toThrow(expect.objectContaining({ code: 'AVAILABILITY_TIME_UNRESOLVABLE' }));
    expect(() => availabilityWindows('2026-11-02', 'invalid', [rule])).toThrow(
      expect.objectContaining({ code: 'INTERNAL_ERROR' }),
    );
    expect(() => availabilityWindows('2026-11-02', '+03:00', [rule])).toThrow(
      expect.objectContaining({ code: 'INTERNAL_ERROR' }),
    );
  });
});

describe('contratos y consultas de slots', () => {
  it('valida fechas reales, UUIDs, repetidos y campos desconocidos', () => {
    const query = { date: '2028-02-29', serviceId: '20000000-0000-4000-8000-000000000001' };
    expect(slotsQuerySchema.safeParse(query).success).toBe(true);
    for (const extra of [
      { date: '2026-02-29' },
      { date: '2026-04-31' },
      { date: '2026-1-01' },
      { date: ['2026-01-01', '2026-01-02'] },
      { serviceId: 'bad' },
      { excludeAppointmentId: 'bad' },
      { businessId: 'other' },
      { timezone: 'UTC' },
    ])
      expect(slotsQuerySchema.safeParse({ ...query, ...extra }).success).toBe(false);
  });
  it('Prisma limita TODAS las lecturas por tenant y ocupa por intervalo, sin filtrar servicio', async () => {
    const prisma = {
      service: { findUnique: vi.fn().mockResolvedValue(null) },
      appointment: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const repo = new PrismaSlotsRepository(prisma as unknown as PrismaClient);
    await repo.findService('tenant', 'service');
    await repo.findAppointment('tenant', 'appointment');
    expect(prisma.service.findUnique).toHaveBeenCalledWith({
      where: { id_businessId: { id: 'service', businessId: 'tenant' } },
      select: { active: true, durationMinutes: true },
    });
    expect(prisma.appointment.findUnique).toHaveBeenCalledWith({
      where: { id_businessId: { id: 'appointment', businessId: 'tenant' } },
      select: { id: true, serviceId: true, status: true, startsAt: true, endsAt: true },
    });
    const range = interval('2026-11-02T12:00Z', '2026-11-02T15:00Z');
    await repo.occupied('tenant', range, 'excluded');
    expect(prisma.appointment.findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        businessId: 'tenant',
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        startsAt: { lt: range.endsAt },
        endsAt: { gt: range.startsAt },
        id: { not: 'excluded' },
      },
      select: { startsAt: true, endsAt: true },
    });
    prisma.appointment.findMany.mockClear();
    await repo.occupied('tenant', range);
    expect(prisma.appointment.findMany.mock.calls[0]?.[0].where).not.toHaveProperty('id');
  });
});
