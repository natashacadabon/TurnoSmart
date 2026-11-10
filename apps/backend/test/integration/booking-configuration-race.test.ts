/** PostgreSQL local descartable. El orden se observa en pg_stat_activity. */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildTestApp } from '../fakes.js';
import { PrismaAppointmentRepository } from '../../src/modules/appointments/repository.js';
import { PrismaAvailabilityRepository } from '../../src/modules/availability/repository.js';
import { PrismaServiceRepository } from '../../src/modules/services/repository.js';
import { PrismaIdentityRepository } from '../../src/modules/identity/repository.js';
import { PrismaCustomerRepository } from '../../src/modules/customers/repository.js';
import { PrismaRiskRepository } from '../../src/modules/ai/risk-repository.js';

const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Pruebas de carrera requieren PostgreSQL local descartable');
}
function client(prefix: string) {
  const target = new URL(url!);
  target.searchParams.set('connection_limit', '1');
  return {
    name: `${prefix}-${randomUUID()}`,
    prisma: new PrismaClient({ datasourceUrl: target.toString() }),
  };
}
const observer = new PrismaClient({ datasourceUrl: url });
const holder = client('hold');
const writer = client('config');
const booker = client('book');
const businesses: string[] = [];
function app(prisma: PrismaClient) {
  return buildTestApp({
    identity: new PrismaIdentityRepository(prisma),
    customers: new PrismaCustomerRepository(prisma),
    services: new PrismaServiceRepository(prisma),
    availability: new PrismaAvailabilityRepository(prisma),
    appointments: new PrismaAppointmentRepository(prisma),
    risk: new PrismaRiskRepository(prisma),
  });
}
const configApi = app(writer.prisma);
const bookingApi = app(booker.prisma);
beforeAll(async () => {
  for (const connection of [holder, writer, booker]) {
    await connection.prisma
      .$queryRaw`SELECT set_config('application_name', ${connection.name}, false)`;
  }
});
afterAll(async () => {
  try {
    await observer.business.deleteMany({ where: { id: { in: businesses } } });
  } finally {
    await Promise.all(
      [observer, holder.prisma, writer.prisma, booker.prisma].map((db) => db.$disconnect()),
    );
  }
});
async function blocked(name: string) {
  const deadline = Date.now() + 3500;
  while (Date.now() < deadline) {
    const rows = await observer.$queryRaw<{ blocked: boolean }[]>`
      SELECT cardinality(pg_blocking_pids(pid)) > 0 AS blocked
      FROM pg_stat_activity WHERE application_name = ${name} AND wait_event_type = 'Lock'
    `;
    if (rows.some((row) => row.blocked)) return;
    await delay(10);
  }
  throw new Error(`No se observó espera por el bloqueo de negocio: ${name}`);
}
async function ordered(
  businessId: string,
  first: { name: string; send: () => Promise<Response> },
  second: { name: string; send: () => Promise<Response> },
) {
  let unlock!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const lock = holder.prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
      acquired();
      await gate;
    },
    { timeout: 15000 },
  );
  let a: Promise<Response> | undefined;
  let b: Promise<Response> | undefined;
  try {
    await ready;
    a = first.send();
    await blocked(first.name);
    b = second.send();
    await blocked(second.name);
  } finally {
    unlock();
    await lock;
    await Promise.allSettled([...(a ? [a] : []), ...(b ? [b] : [])]);
  }
  if (!a || !b) throw new Error('No se iniciaron ambas operaciones');
  return Promise.all([a, b]);
}

const fullRules = [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', active: true }];
const kinds = ['availability', 'duration', 'inactive', 'timezone'] as const;
for (const reschedule of [false, true]) {
  for (const kind of kinds) {
    for (const configFirst of [true, false]) {
      it(`${reschedule ? 'reprogramar' : 'crear'} / ${kind} / ${configFirst ? 'configuración primero' : 'turno primero'}`, async () => {
        const business = await observer.business.create({
          data: { name: 'Race test', timezone: 'UTC' },
        });
        businesses.push(business.id);
        const businessId = business.id;
        const customer = await observer.customer.create({
          data: { businessId, fullName: 'Race customer' },
        });
        const service = await observer.service.create({
          data: { businessId, name: 'Race service', durationMinutes: 60 },
        });
        await new PrismaAvailabilityRepository(observer).replace(businessId, fullRules);
        async function member(ctx: ReturnType<typeof app>) {
          const user = ctx.verifier.addUser();
          await observer.profile.create({
            data: { id: user.id, businessId, email: `${user.id}@test.local`, role: 'OWNER' },
          });
          return { Authorization: `Bearer ${user.token}` };
        }
        const configAuth = await member(configApi);
        const bookingAuth = await member(bookingApi);
        const target =
          kind === 'timezone' ? '2099-01-05T10:00:00.000Z' : '2099-01-05T14:00:00.000Z';
        const originalStart =
          kind === 'timezone' ? '2099-01-05T14:00:00.000Z' : '2099-01-05T10:00:00.000Z';
        let originalId: string | undefined;
        if (reschedule) {
          const original = await request(bookingApi.app)
            .post('/api/appointments')
            .set(bookingAuth)
            .send({ customerId: customer.id, serviceId: service.id, startsAt: originalStart });
          expect(original.status).toBe(201);
          originalId = original.body.id;
        }
        const booking = {
          name: booker.name,
          send: () =>
            (reschedule
              ? request(bookingApi.app)
                  .post(`/api/appointments/${originalId}/reschedule`)
                  .set(bookingAuth)
                  .send({ startsAt: target })
              : request(bookingApi.app)
                  .post('/api/appointments')
                  .set(bookingAuth)
                  .send({ customerId: customer.id, serviceId: service.id, startsAt: target })
            ).then((response) => response),
        };
        const change = {
          name: writer.name,
          send: () =>
            (kind === 'availability'
              ? request(configApi.app)
                  .put('/api/availability-rules')
                  .set(configAuth)
                  .send({ rules: [{ ...fullRules[0], endTime: '12:00' }] })
              : kind === 'timezone'
                ? request(configApi.app)
                    .patch('/api/business')
                    .set(configAuth)
                    .send({ timezone: 'America/New_York' })
                : request(configApi.app)
                    .patch(`/api/services/${service.id}`)
                    .set(configAuth)
                    .send(kind === 'duration' ? { durationMinutes: 120 } : { active: false })
            ).then((response) => response),
        };
        const results = await ordered(
          businessId,
          configFirst ? change : booking,
          configFirst ? booking : change,
        );
        const configResponse = results[configFirst ? 0 : 1]!;
        const bookingResponse = results[configFirst ? 1 : 0]!;
        const rejected = configFirst && kind !== 'duration';
        expect(bookingResponse.status).toBe(rejected ? 409 : reschedule ? 200 : 201);
        expect(configResponse.status).toBe(
          !configFirst && ['availability', 'timezone'].includes(kind) ? 409 : 200,
        );
        if (rejected)
          expect(bookingResponse.body.error.code).toBe(
            kind === 'inactive' ? 'SERVICE_INACTIVE' : 'APPOINTMENT_OUTSIDE_AVAILABILITY',
          );
        if (configResponse.status === 409)
          expect(configResponse.body.error.code).toBe('AVAILABILITY_CONFLICT');
        const rows = await observer.appointment.findMany({
          where: { businessId },
          include: { events: true },
        });
        expect(rows).toHaveLength(rejected && !reschedule ? 0 : 1);
        if (rows[0]) {
          const row = rows[0];
          expect(row.startsAt.toISOString()).toBe(rejected ? originalStart : target);
          expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(
            configFirst && kind === 'duration' ? 120 * 60000 : 60 * 60000,
          );
          expect(row.events).toHaveLength(reschedule && !rejected ? 2 : 1);
          if (reschedule && !rejected)
            expect(
              row.events.find((event) => event.type === 'RESCHEDULED')?.metadata,
            ).toMatchObject({ previousStartsAt: originalStart, startsAt: target });
        }
        const currentBusiness = await observer.business.findUniqueOrThrow({
          where: { id: businessId },
        });
        const currentRules = await observer.availabilityRule.findMany({ where: { businessId } });
        expect(currentBusiness.timezone).toBe(
          kind === 'timezone' && configFirst ? 'America/New_York' : 'UTC',
        );
        expect(currentRules[0]?.endTime.toISOString().slice(11, 16)).toBe(
          kind === 'availability' && configFirst ? '12:00' : '17:00',
        );
      });
    }
  }
}

it('revierte el turno si falla la escritura de su evento', async () => {
  const business = await observer.business.create({
    data: { name: 'Rollback test', timezone: 'UTC' },
  });
  businesses.push(business.id);
  const customer = await observer.customer.create({
    data: { businessId: business.id, fullName: 'Rollback' },
  });
  const service = await observer.service.create({
    data: { businessId: business.id, name: 'Rollback', durationMinutes: 60 },
  });
  await new PrismaAvailabilityRepository(observer).replace(business.id, fullRules);
  const repository = new PrismaAppointmentRepository(booker.prisma);
  const start = new Date('2099-01-05T10:00:00Z');
  const metadata: Record<string, unknown> = {};
  metadata.circular = metadata;
  await expect(
    repository.createAtomically(
      business.id,
      { customerId: customer.id, serviceId: service.id, startsAt: start, notes: null },
      { type: 'CREATED', metadata },
    ),
  ).rejects.toThrow();
  expect(await observer.appointment.count({ where: { businessId: business.id } })).toBe(0);
  expect(await observer.appointmentEvent.count({ where: { businessId: business.id } })).toBe(0);
  const created = await repository.createAtomically(
    business.id,
    { customerId: customer.id, serviceId: service.id, startsAt: start, notes: null },
    { type: 'CREATED' },
  );
  if (created.kind !== 'created') throw new Error('No se creó el fixture');
  await expect(
    repository.rescheduleAtomically(business.id, created.row.id, new Date('2099-01-05T14:00Z'), {
      type: 'RESCHEDULED',
      metadata,
    }),
  ).rejects.toThrow();
  const persisted = await observer.appointment.findUniqueOrThrow({ where: { id: created.row.id } });
  expect(persisted.startsAt).toEqual(start);
  expect(await observer.appointmentEvent.count({ where: { businessId: business.id } })).toBe(1);
});

async function rescheduleFixture(status: 'SCHEDULED' | 'CONFIRMED' = 'SCHEDULED') {
  const business = await observer.business.create({
    data: { name: 'State race', timezone: 'UTC' },
  });
  businesses.push(business.id);
  const businessId = business.id;
  const customer = await observer.customer.create({ data: { businessId, fullName: 'State race' } });
  const service = await observer.service.create({
    data: { businessId, name: 'State race', durationMinutes: 60 },
  });
  await new PrismaAvailabilityRepository(observer).replace(businessId, fullRules);
  async function member(ctx: ReturnType<typeof app>) {
    const user = ctx.verifier.addUser();
    await observer.profile.create({
      data: { id: user.id, businessId, email: `${user.id}@test.local`, role: 'OWNER' },
    });
    return { Authorization: `Bearer ${user.token}` };
  }
  const auth = await member(bookingApi);
  const otherAuth = await member(configApi);
  const created = await request(bookingApi.app)
    .post('/api/appointments')
    .set(auth)
    .send({ customerId: customer.id, serviceId: service.id, startsAt: '2099-01-05T10:00:00.000Z' });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  if (status === 'CONFIRMED') {
    expect(
      (await request(bookingApi.app).post(`/api/appointments/${id}/confirm`).set(auth)).status,
    ).toBe(200);
  }
  const before = await observer.appointment.findUniqueOrThrow({
    where: { id },
    include: { events: true },
  });
  return { businessId, id, auth, otherAuth, before };
}

for (const status of ['SCHEDULED', 'CONFIRMED'] as const) {
  for (const cancelFirst of [true, false]) {
    it(`${status}: cancelación y reprogramación / ${cancelFirst ? 'cancelación primero' : 'reprogramación primero'}`, async () => {
      const { businessId, id, auth, otherAuth, before } = await rescheduleFixture(status);
      const target = '2099-01-05T14:00:00.000Z';
      const cancel = {
        name: writer.name,
        send: () =>
          request(configApi.app)
            .post(`/api/appointments/${id}/cancel`)
            .set(otherAuth)
            .then((response) => response),
      };
      const reschedule = {
        name: booker.name,
        send: () =>
          request(bookingApi.app)
            .post(`/api/appointments/${id}/reschedule`)
            .set(auth)
            .send({ startsAt: target })
            .then((response) => response),
      };
      const results = await ordered(
        businessId,
        cancelFirst ? cancel : reschedule,
        cancelFirst ? reschedule : cancel,
      );
      expect(results[cancelFirst ? 0 : 1]!.status).toBe(200);
      const response = results[cancelFirst ? 1 : 0]!;
      expect(response.status).toBe(cancelFirst ? 409 : 200);
      if (cancelFirst) expect(response.body.error.code).toBe('APPOINTMENT_NOT_RESCHEDULABLE');
      const row = await observer.appointment.findUniqueOrThrow({
        where: { id },
        include: { events: true },
      });
      expect(row.status).toBe('CANCELLED');
      expect(row.startsAt.toISOString()).toBe(cancelFirst ? before.startsAt.toISOString() : target);
      expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(60 * 60000);
      expect(row.events.filter((event) => event.type === 'RESCHEDULED')).toHaveLength(
        cancelFirst ? 0 : 1,
      );
      expect(row.events.filter((event) => event.type === 'CANCELLED')).toHaveLength(1);
      expect(row.events).toHaveLength(before.events.length + (cancelFirst ? 1 : 2));
      expect(row.events).toEqual(expect.arrayContaining(before.events));
    });
  }
  it(`${status}: dos reprogramaciones se serializan y encadenan sus eventos`, async () => {
    const { businessId, id, auth, otherAuth, before } = await rescheduleFixture(status);
    const first = '2099-01-05T12:00:00.000Z';
    const second = '2099-01-05T14:00:00.000Z';
    const results = await ordered(
      businessId,
      {
        name: booker.name,
        send: () =>
          request(bookingApi.app)
            .post(`/api/appointments/${id}/reschedule`)
            .set(auth)
            .send({ startsAt: first })
            .then((response) => response),
      },
      {
        name: writer.name,
        send: () =>
          request(configApi.app)
            .post(`/api/appointments/${id}/reschedule`)
            .set(otherAuth)
            .send({ startsAt: second })
            .then((response) => response),
      },
    );
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    const row = await observer.appointment.findUniqueOrThrow({
      where: { id },
      include: { events: true },
    });
    expect(row.status).toBe(status);
    expect(row.startsAt.toISOString()).toBe(second);
    expect(row.endsAt.toISOString()).toBe('2099-01-05T15:00:00.000Z');
    expect(row.events).toHaveLength(before.events.length + 2);
    expect(
      row.events.filter((event) => event.type === 'RESCHEDULED').map((event) => event.metadata),
    ).toEqual(
      expect.arrayContaining([
        { previousStartsAt: before.startsAt.toISOString(), startsAt: first },
        { previousStartsAt: first, startsAt: second },
      ]),
    );
  });
}

for (const status of ['CANCELLED', 'COMPLETED', 'NO_SHOW', 'SCHEDULED', 'CONFIRMED'] as const) {
  it(`rechaza ${status}${['SCHEDULED', 'CONFIRMED'].includes(status) ? ' ya iniciado' : ''} sin modificar turno ni historial`, async () => {
    const { id, auth } = await rescheduleFixture();
    await observer.appointment.update({
      where: { id },
      data: {
        status,
        ...(['SCHEDULED', 'CONFIRMED'].includes(status)
          ? { startsAt: new Date('2020-01-06T10:00Z'), endsAt: new Date('2020-01-06T11:00Z') }
          : {}),
      },
    });
    const before = await observer.appointment.findUniqueOrThrow({
      where: { id },
      include: { events: true },
    });
    const response = await request(bookingApi.app)
      .post(`/api/appointments/${id}/reschedule`)
      .set(auth)
      .send({ startsAt: '2099-01-05T14:00:00.000Z' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('APPOINTMENT_NOT_RESCHEDULABLE');
    expect(
      await observer.appointment.findUniqueOrThrow({ where: { id }, include: { events: true } }),
    ).toEqual(before);
    expect(
      await observer.appointmentEvent.count({ where: { appointmentId: id, type: 'RESCHEDULED' } }),
    ).toBe(0);
  });
}
