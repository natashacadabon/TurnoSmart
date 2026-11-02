import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from '../fakes.js';

describe('API de turnos - Fase 2', () => {
  const setup = async () => {
    const ctx = buildTestApp();
    const businessId = randomUUID();
    const user = ctx.verifier.addUser();
    ctx.identity.addMember(user.id, businessId, 'OWNER');
    const auth = { Authorization: `Bearer ${user.token}` };
    const customer = await ctx.customers.create(businessId, {
      fullName: 'Cliente de prueba',
      email: null,
      phone: null,
      notes: null,
    });
    const service = await ctx.services.create(businessId, {
      name: 'Consulta',
      description: null,
      durationMinutes: 60,
      priceCents: null,
      active: true,
    });
    await ctx.availability.replace(businessId, [
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', active: true },
    ]);
    return { ctx, businessId, auth, customer, service };
  };

  beforeEach(() => undefined);

  it('crea, lista, consulta y edita un turno dentro del tenant', async () => {
    const { ctx, auth, customer, service } = await setup();
    const startsAt = '2099-01-05T10:00:00.000Z';
    const created = await request(ctx.app)
      .post('/api/appointments')
      .set(auth)
      .send({ customerId: customer.id, serviceId: service.id, startsAt, notes: '  ' });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      customerId: customer.id,
      serviceId: service.id,
      startsAt,
      endsAt: '2099-01-05T11:00:00.000Z',
      status: 'SCHEDULED',
      notes: null,
    });

    const listed = await request(ctx.app)
      .get('/api/appointments?from=2099-01-05&to=2099-01-05')
      .set(auth);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);

    const id = created.body.id as string;
    const updated = await request(ctx.app)
      .patch(`/api/appointments/${id}`)
      .set(auth)
      .send({ notes: 'Llegar 10 minutos antes' });
    expect(updated.status).toBe(200);
    expect(updated.body.notes).toBe('Llegar 10 minutos antes');

    expect((await request(ctx.app).get(`/api/appointments/${id}`).set(auth)).status).toBe(200);
  });

  it('rechaza cliente inexistente, servicio inactivo, horario fuera de agenda y solapamiento', async () => {
    const { ctx, auth, customer, service } = await setup();
    const base = { serviceId: service.id, startsAt: '2099-01-05T10:00:00.000Z' };

    expect(
      (
        await request(ctx.app)
          .post('/api/appointments')
          .set(auth)
          .send({ ...base, customerId: randomUUID() })
      ).body.error.code,
    ).toBe('NOT_FOUND');

    await ctx.services.update(ctx.identity.profiles.values().next().value!.businessId, service.id, {
      active: false,
    });
    expect(
      (
        await request(ctx.app)
          .post('/api/appointments')
          .set(auth)
          .send({ ...base, customerId: customer.id })
      ).body.error.code,
    ).toBe('SERVICE_INACTIVE');

    await ctx.services.update(ctx.identity.profiles.values().next().value!.businessId, service.id, {
      active: true,
    });
    expect(
      (
        await request(ctx.app)
          .post('/api/appointments')
          .set(auth)
          .send({ ...base, customerId: customer.id, startsAt: '2099-01-05T18:00:00.000Z' })
      ).body.error.code,
    ).toBe('APPOINTMENT_OUTSIDE_AVAILABILITY');

    expect(
      (
        await request(ctx.app)
          .post('/api/appointments')
          .set(auth)
          .send({ ...base, customerId: customer.id })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(ctx.app)
          .post('/api/appointments')
          .set(auth)
          .send({ ...base, customerId: customer.id })
      ).body.error.code,
    ).toBe('APPOINTMENT_TIME_CONFLICT');
  });

  it('reprograma y aplica las transiciones válidas de estado', async () => {
    const { ctx, auth, customer, service } = await setup();
    const created = await request(ctx.app).post('/api/appointments').set(auth).send({
      customerId: customer.id,
      serviceId: service.id,
      startsAt: '2099-01-05T10:00:00.000Z',
    });
    const id = created.body.id as string;

    const rescheduled = await request(ctx.app)
      .post(`/api/appointments/${id}/reschedule`)
      .set(auth)
      .send({ startsAt: '2099-01-05T12:00:00.000Z' });
    expect(rescheduled.status).toBe(200);
    expect(rescheduled.body.endsAt).toBe('2099-01-05T13:00:00.000Z');

    expect(
      (await request(ctx.app).post(`/api/appointments/${id}/confirm`).set(auth)).body.status,
    ).toBe('CONFIRMED');
    expect(
      (await request(ctx.app).post(`/api/appointments/${id}/cancel`).set(auth)).body.status,
    ).toBe('CANCELLED');
    const invalid = await request(ctx.app).post(`/api/appointments/${id}/confirm`).set(auth);
    expect(invalid.status).toBe(409);
    expect(invalid.body.error.code).toBe('APPOINTMENT_INVALID_TRANSITION');
  });

  it('mantiene aislamiento entre negocios y permisos', async () => {
    const first = await setup();
    const second = await setup();
    const appointment = await request(first.ctx.app)
      .post('/api/appointments')
      .set(first.auth)
      .send({
        customerId: first.customer.id,
        serviceId: first.service.id,
        startsAt: '2099-01-05T14:00:00.000Z',
      });
    const id = appointment.body.id as string;

    expect(
      (await request(second.ctx.app).get(`/api/appointments/${id}`).set(second.auth)).status,
    ).toBe(404);
    const staff = second.ctx.verifier.addUser();
    second.ctx.identity.addMember(staff.id, second.businessId, 'STAFF');
    expect(
      (
        await request(second.ctx.app)
          .post('/api/appointments')
          .set({ Authorization: `Bearer ${staff.token}` })
          .send({
            customerId: second.customer.id,
            serviceId: second.service.id,
            startsAt: '2099-01-05T15:00:00.000Z',
          })
      ).status,
    ).toBe(201);
  });
});
