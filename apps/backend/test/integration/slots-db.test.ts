/** PostgreSQL descartable con migraciones. FakeVerifier no certifica tokens ni RLS. */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type AppointmentStatus } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaSlotsRepository } from '../../src/modules/slots/repository.js';
import { PrismaAvailabilityRepository } from '../../src/modules/availability/repository.js';
import { PrismaIdentityRepository } from '../../src/modules/identity/repository.js';
import { buildTestApp } from '../fakes.js';

if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL requerida: usar base descartable con migraciones');
const prisma = new PrismaClient();
const availability = new PrismaAvailabilityRepository(prisma);
const ctx = buildTestApp({
  slots: new PrismaSlotsRepository(prisma),
  availability,
  identity: new PrismaIdentityRepository(prisma),
});
const created: string[] = [];
let businessId: string;
let serviceId: string;
let customerId: string;
let owner: { Authorization: string };
const get = (extra = {}, auth = owner) =>
  request(ctx.app)
    .get('/api/slots')
    .set(auth)
    .query({ date: '2026-11-02', serviceId, ...extra });
async function member(id: string) {
  const user = ctx.verifier.addUser();
  await prisma.profile.create({
    data: { id: user.id, businessId: id, email: `${user.id}@test.local` },
  });
  return { Authorization: `Bearer ${user.token}` };
}
async function appointment(status: AppointmentStatus, extra = {}) {
  return prisma.appointment.create({
    data: {
      businessId,
      customerId,
      serviceId,
      startsAt: new Date('2026-11-02T12:30Z'),
      endsAt: new Date('2026-11-02T13:30Z'),
      status,
      ...extra,
    },
  });
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-01-01T00:00:00Z');
  businessId = (
    await prisma.business.create({
      data: { name: 'B05 test', timezone: 'America/Argentina/Buenos_Aires' },
    })
  ).id;
  created.push(businessId);
  owner = await member(businessId);
  serviceId = (
    await prisma.service.create({ data: { businessId, name: 'Servicio', durationMinutes: 60 } })
  ).id;
  customerId = (await prisma.customer.create({ data: { businessId, fullName: 'Test privado' } }))
    .id;
  await availability.replace(businessId, [
    { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', active: true },
  ]);
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await prisma.business.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe('B05 API + PostgreSQL', () => {
  it.each(['SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'] as const)(
    'aplica estado %s en agenda compartida sin modificar turnos/eventos',
    async (status) => {
      const anotherService = await prisma.service.create({
        data: { businessId, name: randomUUID(), durationMinutes: 15 },
      });
      const booked = await appointment(status, { serviceId: anotherService.id });
      const result = await get();
      expect(result.status).toBe(200);
      expect(result.body.data).toHaveLength(['SCHEDULED', 'CONFIRMED'].includes(status) ? 3 : 9);
      expect(await prisma.appointment.findUnique({ where: { id: booked.id } })).toEqual(booked);
      expect(await prisma.appointmentEvent.count({ where: { businessId } })).toBe(0);
      expect(JSON.stringify(result.body)).not.toContain(customerId);
    },
  );
  it('filtra ocupacion que comienza antes del dia, adyacencia y milisegundos', async () => {
    const booked = await appointment('CONFIRMED', {
      startsAt: new Date('2026-11-01T23:00Z'),
      endsAt: new Date('2026-11-02T12:00Z'),
    });
    expect((await get()).body.data).toHaveLength(9);
    await prisma.appointment.update({
      where: { id: booked.id },
      data: { endsAt: new Date('2026-11-02T12:00:00.001Z') },
    });
    expect((await get()).body.data).toHaveLength(8);
  });
  it('aisla servicios, exclusiones y ocupacion entre negocios', async () => {
    const otherId = (await prisma.business.create({ data: { name: 'B05 other' } })).id;
    created.push(otherId);
    const otherAuth = await member(otherId);
    const booked = await appointment('SCHEDULED');
    expect((await get({}, otherAuth)).status).toBe(404);
    const otherService = await prisma.service.create({
      data: { businessId: otherId, name: 'Other', durationMinutes: 60 },
    });
    await availability.replace(otherId, [
      { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', active: true },
    ]);
    expect((await get({ serviceId: otherService.id }, otherAuth)).body.data).toHaveLength(9);
    expect(
      (await get({ serviceId: otherService.id, excludeAppointmentId: booked.id }, otherAuth)).body
        .error.code,
    ).toBe('NOT_FOUND');
    expect((await get({ excludeAppointmentId: booked.id })).body.data).toHaveLength(9);
    await prisma.service.update({ where: { id: serviceId }, data: { active: false } });
    expect((await get()).body.error.code).toBe('SERVICE_INACTIVE');
  });
  it('no une franjas adyacentes y conserva TIME y anclaje independiente', async () => {
    await availability.replace(businessId, [
      { dayOfWeek: 1, startTime: '09:10', endTime: '10:10', active: true },
      { dayOfWeek: 1, startTime: '10:10', endTime: '11:10', active: true },
    ]);
    expect((await get()).body.data).toEqual([
      { startsAt: '2026-11-02T12:10:00.000Z', endsAt: '2026-11-02T13:10:00.000Z' },
      { startsAt: '2026-11-02T13:10:00.000Z', endsAt: '2026-11-02T14:10:00.000Z' },
    ]);
  });
  it.each(['2026-03-08', '2026-11-01'])(
    'D06 %s rechaza transicion y resuelve una franja univoca',
    async (date) => {
      await prisma.business.update({
        where: { id: businessId },
        data: { timezone: 'America/New_York' },
      });
      await availability.replace(businessId, [
        { dayOfWeek: 0, startTime: '00:00', endTime: '04:00', active: true },
      ]);
      expect((await get({ date })).body.error.code).toBe('AVAILABILITY_TIME_UNRESOLVABLE');
      await availability.replace(businessId, [
        { dayOfWeek: 0, startTime: '03:00', endTime: '04:00', active: true },
      ]);
      const result = await get({ date });
      expect(result.status).toBe(200);
      expect(result.body.data).toEqual([
        {
          startsAt: `${date}T${date.includes('03-08') ? '07' : '08'}:00:00.000Z`,
          endsAt: `${date}T${date.includes('03-08') ? '08' : '09'}:00:00.000Z`,
        },
      ]);
    },
  );
});
