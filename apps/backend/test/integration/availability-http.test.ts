/** HTTP con auth real y repositorio en memoria; sin .env ni PostgreSQL. */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/lib/errors.js';
import { buildTestApp } from '../fakes.js';

const path = '/api/availability-rules';
const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' };
describe('disponibilidad: HTTP, permisos y aislamiento', () => {
  let ctx: ReturnType<typeof buildTestApp>;
  let owner: { Authorization: string };
  let admin: { Authorization: string };
  let staff: { Authorization: string };
  let other: { Authorization: string };
  beforeEach(() => {
    ctx = buildTestApp();
    const businessId = randomUUID();
    const member = (role: 'OWNER' | 'ADMIN' | 'STAFF', business = businessId) => {
      const user = ctx.verifier.addUser();
      ctx.identity.addMember(user.id, business, role);
      return { Authorization: `Bearer ${user.token}` };
    };
    owner = member('OWNER');
    admin = member('ADMIN');
    staff = member('STAFF');
    other = member('OWNER', randomUUID());
    ctx.identity.businesses.get(businessId)!.timezone = 'America/Argentina/Buenos_Aires';
  });
  const put = (rules: unknown[], auth = owner) =>
    request(ctx.app).put(path).set(auth).send({ rules });

  it('lee semana vacia y reemplaza con DTO explicito, zona del negocio y orden estable', async () => {
    expect((await request(ctx.app).get(path).set(staff)).body).toEqual({
      data: { timezone: 'America/Argentina/Buenos_Aires', rules: [] },
    });
    const result = await put([
      { ...rule, dayOfWeek: 6, active: false },
      { ...rule, startTime: '12:00', endTime: '13:00' },
      rule,
    ]);
    expect(result.status).toBe(200);
    expect(result.body.data.rules[0]).toEqual({
      ...rule,
      active: true,
      id: expect.any(String),
      createdAt: expect.stringMatching(/\.\d{3}Z$/),
      updatedAt: expect.stringMatching(/\.\d{3}Z$/),
    });
    expect(result.body.data.rules.map((r: { startTime: string }) => r.startTime)).toEqual([
      '09:00',
      '12:00',
      '09:00',
    ]);
    expect(result.body.data.rules[2].active).toBe(false);
    expect((await request(ctx.app).get(path).set(staff)).body).toEqual(result.body);
    expect(JSON.stringify(result.body)).not.toContain('businessId');
  });
  it('ADMIN reemplaza, elimina omitidos, conserva IDs/createdAt y admite vaciar semana', async () => {
    const first = await put([rule, { ...rule, dayOfWeek: 2 }]);
    const second = await put([{ ...rule, active: false }], admin);
    expect(second.status).toBe(200);
    expect(second.body.data.rules).toHaveLength(1);
    expect(second.body.data.rules[0]).toMatchObject({
      id: first.body.data.rules[0].id,
      createdAt: first.body.data.rules[0].createdAt,
      active: false,
    });
    const repeated = await put([{ ...rule, active: false }]);
    expect(repeated.body.data.rules[0].id).toBe(second.body.data.rules[0].id);
    expect((await put([])).body.data.rules).toEqual([]);
  });
  it('GET y PUT estan aislados entre negocios aun al vaciar o reemplazar', async () => {
    const first = await put([rule]);
    expect((await request(ctx.app).get(path).set(other)).body.data.rules).toEqual([]);
    expect((await put([rule], other)).status).toBe(200);
    await put([], other);
    expect((await request(ctx.app).get(path).set(owner)).body).toEqual(first.body);
  });
  it('STAFF lee pero no escribe ni inyectando rol', async () => {
    expect((await request(ctx.app).get(path).set(staff)).status).toBe(200);
    const spy = vi.spyOn(ctx.availability, 'replace');
    expect((await put([], staff)).status).toBe(403);
    expect(
      (await request(ctx.app).put(path).set(staff).send({ rules: [], role: 'OWNER' })).status,
    ).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
  it('ambas rutas requieren token verificado y perfil', async () => {
    const user = ctx.verifier.addUser();
    for (const method of ['get', 'put'] as const) {
      expect((await request(ctx.app)[method](path)).status).toBe(401);
      expect(
        (await request(ctx.app)[method](path).set('Authorization', 'Bearer expired')).body.error
          .code,
      ).toBe('TOKEN_INVALID');
      expect(
        (await request(ctx.app)[method](path).set('Authorization', `Bearer ${user.token}`)).body
          .error.code,
      ).toBe('PROFILE_REQUIRED');
    }
  });
  it('rechaza query extra/repetida, campos protegidos y bodies invalidos sin cambios', async () => {
    const first = await put([rule]);
    const spy = vi.spyOn(ctx.availability, 'replace');
    for (const query of ['businessId=x', 'dayOfWeek=1&dayOfWeek=2']) {
      expect((await request(ctx.app).get(`${path}?${query}`).set(owner)).status).toBe(422);
      expect(
        (await request(ctx.app).put(`${path}?${query}`).set(owner).send({ rules: [] })).status,
      ).toBe(422);
    }
    for (const key of ['id', 'businessId', 'timezone', 'createdAt', 'updatedAt', 'role']) {
      expect(
        (
          await request(ctx.app)
            .put(path)
            .set(owner)
            .send({ rules: [], [key]: 'x' })
        ).status,
      ).toBe(422);
      expect((await put([{ ...rule, [key]: 'x' }])).status).toBe(422);
    }
    for (const rules of [
      [rule, rule],
      [{ ...rule, dayOfWeek: 7 }],
      [{ ...rule, endTime: '01:00' }],
      [{ ...rule, startTime: '09:00:01' }],
    ]) {
      const result = await put(rules);
      expect(result.status).toBe(422);
      expect(result.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        requestId: expect.any(String),
        details: expect.any(Array),
      });
    }
    expect((await request(ctx.app).put(path).set(owner).send({})).status).toBe(422);
    expect(
      (
        await request(ctx.app)
          .put(path)
          .set(owner)
          .set('Content-Type', 'application/json')
          .send('{')
      ).status,
    ).toBe(422);
    expect((await request(ctx.app).put(path).set(owner).type('text').send('rules=[]')).status).toBe(
      422,
    );
    expect(spy).not.toHaveBeenCalled();
    expect((await request(ctx.app).get(path).set(owner)).body).toEqual(first.body);
  });
  it('conserva el contrato de conflicto D03 y no escribe ante rechazo', async () => {
    const first = await put([rule]);
    vi.spyOn(ctx.availability, 'replace').mockRejectedValue(
      new AppError('AVAILABILITY_CONFLICT', 'Turno fuera de disponibilidad'),
    );
    const result = await put([]);
    expect(result.status).toBe(409);
    expect(result.body.error).toMatchObject({
      code: 'AVAILABILITY_CONFLICT',
      requestId: expect.any(String),
    });
    expect((await request(ctx.app).get(path).set(owner)).body).toEqual(first.body);
  });
  it('legado con segundos y fallos inesperados devuelven 500 sin detalles internos', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await put([rule]);
      ctx.availability.rows[0]!.startTime = new Date('1970-01-01T09:00:01Z');
      expect((await request(ctx.app).get(path).set(owner)).status).toBe(500);
      vi.spyOn(ctx.availability, 'replace').mockRejectedValue(
        new Error('private database constraint'),
      );
      const result = await put([]);
      expect(result.status).toBe(500);
      expect(result.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(result.body)).not.toContain('private');
    } finally {
      log.mockRestore();
    }
  });
});
