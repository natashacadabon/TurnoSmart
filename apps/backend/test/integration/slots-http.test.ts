/** API completa con auth y repositorios en memoria; no certifica RLS. */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentStatus } from '@prisma/client';
import { buildTestApp } from '../fakes.js';

describe('B05 HTTP', () => {
  let ctx: ReturnType<typeof buildTestApp>;
  let businessId: string;
  let otherId: string;
  let serviceId: string;
  let auth: { Authorization: string };
  let other: { Authorization: string };
  const query = () => ({ date: '2026-11-02', serviceId });
  const get = (extra = {}, headers = auth) =>
    request(ctx.app)
      .get('/api/slots')
      .set(headers)
      .query({ ...query(), ...extra });
  const addAppointment = (status: AppointmentStatus = 'SCHEDULED', extra = {}) => {
    const row = {
      id: randomUUID(),
      businessId,
      serviceId,
      status,
      startsAt: new Date('2026-11-02T12:30Z'),
      endsAt: new Date('2026-11-02T13:30Z'),
      ...extra,
    };
    ctx.slots.rows.push(row);
    return row;
  };
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2026-11-02T10:00:00Z');
    ctx = buildTestApp();
    businessId = randomUUID();
    otherId = randomUUID();
    const member = (id: string, role: 'OWNER' | 'ADMIN' | 'STAFF' = 'OWNER') => {
      const user = ctx.verifier.addUser();
      ctx.identity.addMember(user.id, id, role);
      return { Authorization: `Bearer ${user.token}` };
    };
    auth = member(businessId);
    other = member(otherId);
    ctx.identity.businesses.get(businessId)!.timezone = 'America/Argentina/Buenos_Aires';
    serviceId = (
      await ctx.services.create(businessId, {
        name: 'Servicio',
        description: null,
        priceCents: null,
        durationMinutes: 60,
        active: true,
      })
    ).id;
    await ctx.availability.replace(businessId, [
      { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', active: true },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());
  afterEach(() => vi.useRealTimers());

  it('usa timezone autenticado, DTO UTC y una sola consulta de ocupacion', async () => {
    addAppointment('CONFIRMED', { serviceId: randomUUID() });
    const spy = vi.spyOn(ctx.slots, 'occupied');
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      data: [
        { startsAt: '2026-11-02T13:30:00.000Z', endsAt: '2026-11-02T14:30:00.000Z' },
        { startsAt: '2026-11-02T13:45:00.000Z', endsAt: '2026-11-02T14:45:00.000Z' },
        { startsAt: '2026-11-02T14:00:00.000Z', endsAt: '2026-11-02T15:00:00.000Z' },
      ],
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toBe(businessId);
  });
  it.each(['SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'] as const)(
    'ocupacion para estado %s',
    async (status) => {
      addAppointment(status);
      expect((await get()).body.data).toHaveLength(
        ['SCHEDULED', 'CONFIRMED'].includes(status) ? 3 : 9,
      );
    },
  );
  it('servicio ajeno/inexistente es 404; inactivo es 409 aun sin franjas', async () => {
    expect((await get({}, other)).body.error.code).toBe('NOT_FOUND');
    expect((await get({ serviceId: randomUUID() })).status).toBe(404);
    await ctx.services.update(businessId, serviceId, { active: false });
    await ctx.availability.replace(businessId, []);
    expect((await get()).body.error.code).toBe('SERVICE_INACTIVE');
  });
  it('turnos de otro negocio no bloquean ni pueden excluirse', async () => {
    const appointment = addAppointment('SCHEDULED', { businessId: otherId });
    expect((await get()).body.data).toHaveLength(9);
    expect((await get({ excludeAppointmentId: appointment.id })).body.error.code).toBe('NOT_FOUND');
  });
  it('excluye solo turnos futuros del mismo servicio, sin modificar datos', async () => {
    const current = addAppointment();
    const before = structuredClone(ctx.slots.rows);
    expect((await get({ excludeAppointmentId: current.id })).body.data).toHaveLength(9);
    expect(ctx.slots.rows).toEqual(before);
    current.serviceId = randomUUID();
    expect((await get({ excludeAppointmentId: current.id })).body.error.code).toBe(
      'APPOINTMENT_SERVICE_MISMATCH',
    );
    current.serviceId = serviceId;
    for (const status of ['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const) {
      current.status = status;
      expect((await get({ excludeAppointmentId: current.id })).body.error.code).toBe(
        'APPOINTMENT_NOT_RESCHEDULABLE',
      );
    }
    current.status = 'CONFIRMED';
    current.startsAt = new Date();
    expect((await get({ excludeAppointmentId: current.id })).body.error.code).toBe(
      'APPOINTMENT_NOT_RESCHEDULABLE',
    );
    current.startsAt = new Date(Date.now() - 1);
    expect((await get({ excludeAppointmentId: current.id })).status).toBe(409);
    expect((await get({ excludeAppointmentId: randomUUID() })).status).toBe(404);
  });
  it('no une franjas adyacentes, ignora inactivas, respeta ahora y semana vacia', async () => {
    await ctx.availability.replace(businessId, [
      { dayOfWeek: 1, startTime: '09:10', endTime: '10:10', active: true },
      { dayOfWeek: 1, startTime: '10:10', endTime: '11:10', active: true },
      { dayOfWeek: 1, startTime: '11:10', endTime: '12:10', active: false },
    ]);
    expect((await get()).body.data.map((s: { startsAt: string }) => s.startsAt)).toEqual([
      '2026-11-02T12:10:00.000Z',
      '2026-11-02T13:10:00.000Z',
    ]);
    vi.setSystemTime('2026-11-02T12:10Z');
    expect((await get()).body.data).toHaveLength(1);
    expect((await get({ date: '2026-10-26' })).body).toEqual({ data: [] });
    await ctx.availability.replace(businessId, []);
    const spy = vi.spyOn(ctx.slots, 'occupied');
    expect((await get()).body).toEqual({ data: [] });
    expect(spy).not.toHaveBeenCalled();
  });
  it('mantiene auth, perfil, permisos de lectura y validacion estricta', async () => {
    expect((await request(ctx.app).get('/api/slots')).status).toBe(401);
    expect((await get({}, { Authorization: 'Bearer expired' })).body.error.code).toBe(
      'TOKEN_INVALID',
    );
    const user = ctx.verifier.addUser();
    const headers = { Authorization: `Bearer ${user.token}` };
    expect((await get({}, headers)).body.error.code).toBe('PROFILE_REQUIRED');
    for (const role of ['STAFF', 'ADMIN', 'OWNER'] as const) {
      ctx.identity.addMember(user.id, businessId, role);
      expect((await get({}, headers)).status).toBe(200);
    }
    for (const extra of [
      { businessId: otherId },
      { timezone: 'UTC' },
      { date: '2026-02-29' },
      { serviceId: 'bad' },
      { date: ['2026-11-02', '2026-11-03'] },
      { excludeAppointmentId: 'bad' },
    ])
      expect((await get(extra)).status).toBe(422);
    expect((await request(ctx.app).get('/api/slots').set(auth)).status).toBe(422);
  });
  it.each(['2026-03-08', '2026-11-01'])(
    'DST %s devuelve conflicto sin escoger conversion',
    async (date) => {
      vi.setSystemTime('2026-01-01T00:00Z');
      ctx.identity.businesses.get(businessId)!.timezone = 'America/New_York';
      await ctx.availability.replace(businessId, [
        { dayOfWeek: 0, startTime: '00:00', endTime: '04:00', active: true },
      ]);
      const result = await get({ date });
      expect(result.status).toBe(409);
      expect(result.body.error).toMatchObject({
        code: 'AVAILABILITY_TIME_UNRESOLVABLE',
        requestId: expect.any(String),
      });
      await ctx.availability.replace(businessId, [
        { dayOfWeek: 0, startTime: '03:00', endTime: '04:00', active: true },
      ]);
      expect((await get({ date })).status).toBe(200);
    },
  );
  it('errores internos mantienen envelope sin filtrar detalles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(ctx.slots, 'occupied').mockRejectedValue(new Error('private database data'));
    const result = await get();
    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(result.body)).not.toContain('private');
  });
});
