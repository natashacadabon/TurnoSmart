/** Politica D06 con HTTP + Prisma real. Usar solo DB local descartable. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityRuleInput } from '@turnosmart/shared';
import { PrismaAvailabilityRepository } from '../../src/modules/availability/repository.js';
import { PrismaSlotsRepository } from '../../src/modules/slots/repository.js';
import { PrismaIdentityRepository } from '../../src/modules/identity/repository.js';
import { buildTestApp } from '../fakes.js';

if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL requerida: base descartable con migraciones');
const prisma = new PrismaClient();
const availability = new PrismaAvailabilityRepository(prisma);
const ctx = buildTestApp({
  availability,
  slots: new PrismaSlotsRepository(prisma),
  identity: new PrismaIdentityRepository(prisma),
});
const created: string[] = [];
const weekly = (date: string, startTime: string, endTime: string): AvailabilityRuleInput => ({
  dayOfWeek: new Date(`${date}T00:00Z`).getUTCDay(),
  startTime,
  endTime,
  active: true,
});

async function fixture(timezone: string) {
  const businessId = (await prisma.business.create({ data: { name: 'D06 test', timezone } })).id;
  created.push(businessId);
  const user = ctx.verifier.addUser();
  await prisma.profile.create({
    data: { id: user.id, businessId, email: `${user.id}@test.local`, role: 'OWNER' },
  });
  const serviceId = (
    await prisma.service.create({ data: { businessId, name: 'D06 service', durationMinutes: 15 } })
  ).id;
  const customerId = (await prisma.customer.create({ data: { businessId, fullName: 'Test' } })).id;
  const auth = { Authorization: `Bearer ${user.token}` };
  return {
    businessId,
    serviceId,
    put: (rules: AvailabilityRuleInput[]) =>
      request(ctx.app).put('/api/availability-rules').set(auth).send({ rules }),
    slots: (date: string, id = serviceId) =>
      request(ctx.app).get('/api/slots').set(auth).query({ date, serviceId: id }),
    book: (startsAt: string, endsAt: string) =>
      prisma.appointment.create({
        data: {
          businessId,
          serviceId,
          customerId,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          status: 'CONFIRMED',
        },
      }),
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-01-01T00:00:00Z');
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await prisma.business.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe('D06 B04/B05 integrados, sin Agenda', () => {
  it.each([
    ['2026-03-08', 'America/New_York', '2026-03-08T06:30Z', '2026-03-08T07:30Z'],
    ['2026-11-01', 'America/New_York', '2026-11-01T05:30Z', '2026-11-01T07:30Z'],
    ['2026-04-05', 'Australia/Lord_Howe', '2026-04-04T14:45Z', '2026-04-04T15:45Z'],
    ['2026-10-04', 'Australia/Lord_Howe', '2026-10-03T15:15Z', '2026-10-03T16:15Z'],
    ['2026-03-08', 'America/Havana', '2026-03-08T05:00Z', '2026-03-08T06:00Z'],
    ['2026-11-01', 'America/Havana', '2026-11-01T04:15Z', '2026-11-01T05:15Z'],
  ])('conflicto controlado y rollback %s %s', async (date, zone, start, end) => {
    const f = await fixture(zone);
    const rules = [weekly(date, '00:00', '04:00')];
    // Sin turnos, la regla recurrente es valida; se resuelve sobre fechas concretas.
    expect((await f.put(rules)).status).toBe(200);
    const previous = await availability.list(f.businessId);
    const booked = await f.book(start, end);
    const event = await prisma.appointmentEvent.create({
      data: { businessId: f.businessId, appointmentId: booked.id, type: 'CREATED' },
    });
    const put = await f.put(rules);
    const get = await f.slots(date);
    for (const result of [put, get]) {
      expect(result.status).toBe(409);
      expect(result.body.error).toMatchObject({
        code: 'AVAILABILITY_TIME_UNRESOLVABLE',
        requestId: expect.any(String),
      });
      expect(result.body).not.toHaveProperty('data');
    }
    expect(await availability.list(f.businessId)).toEqual(previous);
    expect(await prisma.appointment.findUnique({ where: { id: booked.id } })).toEqual(booked);
    expect(await prisma.appointmentEvent.findMany({ where: { businessId: f.businessId } })).toEqual(
      [event],
    );
    // Cerrar el dia es conflicto de disponibilidad, nunca un 500 temporal.
    expect((await f.put([])).body.error.code).toBe('AVAILABILITY_CONFLICT');
    // La transicion/ocupacion del primer negocio no afecta al segundo.
    const other = await fixture('UTC');
    expect((await other.put(rules)).status).toBe(200);
    expect((await other.slots(date)).status).toBe(200);
    expect((await other.slots(date, f.serviceId)).status).toBe(404);
  });

  it.each([
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
  ])('slots y limites UTC correctos %s %s', async (date, zone, start, end, utcStart, utcEnd) => {
    const f = await fixture(zone);
    const rules = [weekly(date, start, end)];
    expect((await f.put(rules)).status).toBe(200);
    const result = await f.slots(date);
    expect(result.status).toBe(200);
    const slots = result.body.data as { startsAt: string; endsAt: string }[];
    expect(slots[0]?.startsAt).toBe(utcStart);
    expect(slots).toHaveLength(start === '23:00' ? 3 : 4);
    expect(new Set(slots.map((s) => s.startsAt)).size).toBe(slots.length);
    expect(slots.map((s) => s.startsAt)).toEqual(slots.map((s) => s.startsAt).sort());
    const booked = await f.book(utcStart, utcEnd);
    expect((await f.put(rules)).status).toBe(200);
    expect((await f.slots(date)).body.data).toEqual([]);
    // Un milisegundo fuera del limite impide modificar disponibilidad, sin redondeos.
    await prisma.appointment.update({
      where: { id: booked.id },
      data: { endsAt: new Date(new Date(utcEnd).getTime() + 1) },
    });
    expect((await f.put(rules)).body.error.code).toBe('AVAILABILITY_CONFLICT');
  });

  it('dia local omitido devuelve 409 y dia cerrado devuelve []', async () => {
    vi.setSystemTime('2011-01-01T00:00:00Z');
    const f = await fixture('Pacific/Apia');
    expect((await f.put([weekly('2011-12-30', '09:00', '10:00')])).status).toBe(200);
    expect((await f.slots('2011-12-30')).body.error.code).toBe('AVAILABILITY_TIME_UNRESOLVABLE');
    expect((await f.slots('2011-12-31')).body.data).toEqual([]);
  });
});
