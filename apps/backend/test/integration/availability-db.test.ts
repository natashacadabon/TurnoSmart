/** Ejecutar solo contra PostgreSQL descartable con migraciones aplicadas. */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaAvailabilityRepository } from '../../src/modules/availability/repository.js';
import { PrismaIdentityRepository } from '../../src/modules/identity/repository.js';
import { buildTestApp } from '../fakes.js';

if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL requerida: usar base descartable con migraciones');
const prisma = new PrismaClient();
const repository = new PrismaAvailabilityRepository(prisma);
const ctx = buildTestApp({
  availability: repository,
  identity: new PrismaIdentityRepository(prisma),
});
const createdBusinesses: string[] = [];
const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', active: true };
const path = '/api/availability-rules';
let businessId: string;
let otherId: string;
let owner: { Authorization: string };
let other: { Authorization: string };
let staff: { Authorization: string };

async function member(id: string, role: 'OWNER' | 'STAFF') {
  const user = ctx.verifier.addUser();
  await prisma.profile.create({
    data: { id: user.id, businessId: id, email: `${user.id}@test.local`, role },
  });
  return { Authorization: `Bearer ${user.token}` };
}
async function appointment(
  status: 'SCHEDULED' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW' = 'SCHEDULED',
  startsAt = new Date('2099-11-02T12:00:00Z'),
  endsAt = new Date('2099-11-02T13:00:00Z'),
) {
  const customer = await prisma.customer.create({ data: { businessId, fullName: 'Test' } });
  const service = await prisma.service.create({
    data: { businessId, name: randomUUID(), durationMinutes: 15 },
  });
  return prisma.appointment.create({
    data: { businessId, serviceId: service.id, customerId: customer.id, startsAt, endsAt, status },
  });
}
beforeEach(async () => {
  const business = await prisma.business.create({
    data: { name: 'B04 test', timezone: 'America/Argentina/Buenos_Aires' },
  });
  businessId = business.id;
  createdBusinesses.push(businessId);
  const second = await prisma.business.create({ data: { name: 'B04 other', timezone: 'UTC' } });
  otherId = second.id;
  createdBusinesses.push(otherId);
  owner = await member(businessId, 'OWNER');
  other = await member(otherId, 'OWNER');
  staff = await member(businessId, 'STAFF');
});
afterAll(async () => {
  await prisma.business.deleteMany({ where: { id: { in: createdBusinesses } } });
  await prisma.$disconnect();
});

describe('B04 API + PostgreSQL', () => {
  it('persiste TIME exacto, conserva IDs, aplica permisos y aisla ambos negocios', async () => {
    const first = await request(ctx.app)
      .put(path)
      .set(owner)
      .send({ rules: [rule] });
    expect(first.status).toBe(200);
    const row = (await repository.list(businessId)).rules[0]!;
    expect(row.startTime.toISOString()).toBe('1970-01-01T09:00:00.000Z');
    expect((await request(ctx.app).get(path).set(staff)).body).toEqual(first.body);
    expect((await request(ctx.app).put(path).set(staff).send({ rules: [] })).status).toBe(403);
    expect((await request(ctx.app).get(path).set(other)).body.data.rules).toEqual([]);
    await repository.replace(otherId, [{ ...rule, active: false }]);
    await repository.replace(businessId, [{ ...rule, active: false }]);
    const kept = (await repository.list(businessId)).rules[0]!;
    expect(kept.id).toBe(row.id);
    expect(kept.createdAt).toEqual(row.createdAt);
    await repository.replace(businessId, []);
    expect((await repository.list(otherId)).rules).toHaveLength(1);
    expect((await repository.list(businessId)).rules).toEqual([]);
  });
  it('rollback real si una escritura falla despues del borrado y de una insercion', async () => {
    const original = await repository.replace(businessId, [rule]);
    await expect(
      repository.replace(businessId, [
        { ...rule, dayOfWeek: 2 },
        { ...rule, dayOfWeek: 7 },
      ]),
    ).rejects.toThrow();
    expect(await repository.list(businessId)).toEqual(original);
  });
  it('serializa PUTs concurrentes sin mezclar semanas, aun desde semana vacia', async () => {
    const a = [rule, { ...rule, dayOfWeek: 2 }];
    const b = [
      { ...rule, dayOfWeek: 3 },
      { ...rule, dayOfWeek: 4 },
    ];
    await Promise.all([repository.replace(businessId, a), repository.replace(businessId, b)]);
    const days = (await repository.list(businessId)).rules.map((r) => r.dayOfWeek);
    expect([
      [1, 2],
      [3, 4],
    ]).toContainEqual(days);
  });
  it.each(['SCHEDULED', 'CONFIRMED'] as const)(
    'D03 rechaza reduccion para %s y conserva turnos/eventos/reglas',
    async (status) => {
      // 2099-11-02 es lunes; se usa el intervalo persistido y no la duracion de 15 minutos del servicio.
      const booked = await appointment(status);
      const first = await repository.replace(businessId, [rule]);
      const events = await prisma.appointmentEvent.findMany({ where: { businessId } });
      for (const rules of [
        [],
        [{ ...rule, active: false }],
        [{ ...rule, endTime: '09:30' }],
        [
          { ...rule, endTime: '09:30' },
          { ...rule, startTime: '09:30' },
        ],
      ]) {
        const result = await request(ctx.app).put(path).set(owner).send({ rules });
        expect(result.status).toBe(409);
        expect(result.body.error.code).toBe('AVAILABILITY_CONFLICT');
        expect(await repository.list(businessId)).toEqual(first);
      }
      expect(await prisma.appointment.findUnique({ where: { id: booked.id } })).toEqual(booked);
      expect(await prisma.appointmentEvent.findMany({ where: { businessId } })).toEqual(events);
    },
  );
  it('ignora finalizados/cancelados/no-show y turnos pasados, incluye en curso y otros negocios no bloquean', async () => {
    for (const status of ['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const) await appointment(status);
    await appointment(
      'SCHEDULED',
      new Date('2020-01-06T12:00:00Z'),
      new Date('2020-01-06T13:00:00Z'),
    );
    await expect(repository.replace(businessId, [])).resolves.toMatchObject({ rules: [] });
    const ongoing = await appointment(
      'CONFIRMED',
      new Date(Date.now() - 60000),
      new Date(Date.now() + 3600000),
    );
    await expect(repository.replace(businessId, [])).rejects.toMatchObject({
      code: 'AVAILABILITY_CONFLICT',
    });
    await expect(repository.replace(otherId, [])).resolves.toMatchObject({ rules: [] });
    expect(await prisma.appointment.findUnique({ where: { id: ongoing.id } })).toEqual(ongoing);
  });
});
