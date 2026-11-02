/** Integracion HTTP con middleware real y repositorio en memoria. Sin DB ni .env. */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from '../fakes.js';

const payload = { name: 'Corte', durationMinutes: 30 };
describe('servicios: integracion HTTP, auth y tenant', () => {
  let ctx: ReturnType<typeof buildTestApp>;
  let owner: { Authorization: string };
  let admin: { Authorization: string };
  let staff: { Authorization: string };
  let other: { Authorization: string };
  beforeEach(() => {
    ctx = buildTestApp();
    const business = randomUUID();
    const add = (role: 'OWNER' | 'ADMIN' | 'STAFF', businessId = business) => {
      const user = ctx.verifier.addUser();
      ctx.identity.addMember(user.id, businessId, role);
      return { Authorization: `Bearer ${user.token}` };
    };
    owner = add('OWNER');
    admin = add('ADMIN');
    staff = add('STAFF');
    other = add('OWNER', randomUUID());
  });
  const create = async () => request(ctx.app).post('/api/services').set(owner).send(payload);

  it('crea con defaults, fechas UTC y DTO sin tenant; STAFF puede leer', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.any(String),
      ...payload,
      description: null,
      priceCents: null,
      active: true,
      createdAt: expect.stringMatching(/\.\d{3}Z$/),
      updatedAt: expect.any(String),
    });
    const list = await request(ctx.app).get('/api/services').set(staff);
    expect(list.status).toBe(200);
    expect(list.body).toEqual({
      data: [res.body.data],
      meta: { active: 'true', limit: 50, offset: 0, total: 1 },
    });
  });
  it('ADMIN edita; PATCH conserva omitidos, admite null/0, desactiva y reactiva sin borrar', async () => {
    const created = await create();
    const id = created.body.data.id;
    const patch = await request(ctx.app).patch(`/api/services/${id}`).set(admin).send({
      name: ' Corte nuevo ',
      description: ' ',
      priceCents: 0,
      durationMinutes: 45,
      active: false,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.data).toMatchObject({
      name: 'Corte nuevo',
      description: null,
      priceCents: 0,
      durationMinutes: 45,
      active: false,
      createdAt: created.body.data.createdAt,
    });
    expect((await request(ctx.app).get('/api/services').set(owner)).body.data).toEqual([]);
    expect(
      (await request(ctx.app).get('/api/services?active=false').set(owner)).body.meta.total,
    ).toBe(1);
    const cleared = await request(ctx.app)
      .patch(`/api/services/${id}`)
      .set(owner)
      .send({ priceCents: null });
    expect(cleared.body.data).toMatchObject({
      active: false,
      name: 'Corte nuevo',
      priceCents: null,
      durationMinutes: 45,
    });
    expect(
      (await request(ctx.app).patch(`/api/services/${id}`).set(owner).send({ active: true }))
        .status,
    ).toBe(200);
    expect(ctx.services.rows).toHaveLength(1);
    expect((await request(ctx.app).delete(`/api/services/${id}`).set(owner)).status).toBe(404);
  });
  it('filtra, ordena, pagina y cuenta antes del offset', async () => {
    for (const name of ['Zeta', 'Beta', 'Alfa'])
      await request(ctx.app)
        .post('/api/services')
        .set(owner)
        .send({ ...payload, name });
    const res = await request(ctx.app).get('/api/services?active=all&limit=1&offset=1').set(owner);
    expect(res.body.data.map((r: { name: string }) => r.name)).toEqual(['Beta']);
    expect(res.body.meta).toEqual({ active: 'all', limit: 1, offset: 1, total: 3 });
    const empty = await request(ctx.app).get('/api/services?offset=99').set(owner);
    expect(empty.body.data).toEqual([]);
    expect(empty.body.meta.total).toBe(3);
  });
  it('aisla listado y PATCH; IDs ajenos e inexistentes responden igual', async () => {
    const res = await create();
    const id = res.body.data.id;
    expect(
      (await request(ctx.app).get('/api/services?active=all').set(other)).body.meta.total,
    ).toBe(0);
    const foreign = await request(ctx.app)
      .patch(`/api/services/${id}`)
      .set(other)
      .send({ active: false });
    const missing = await request(ctx.app)
      .patch(`/api/services/${randomUUID()}`)
      .set(other)
      .send({ active: false });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body.error.code).toBe('NOT_FOUND');
    expect(missing.body.error.code).toBe('NOT_FOUND');
    expect(ctx.services.rows[0]?.active).toBe(true);
    expect((await request(ctx.app).post('/api/services').set(other).send(payload)).status).toBe(
      201,
    );
  });
  it('unicidad trim por negocio incluye inactivos y PATCH', async () => {
    const first = await create();
    const id = first.body.data.id;
    await request(ctx.app).patch(`/api/services/${id}`).set(owner).send({ active: false });
    const duplicate = await request(ctx.app)
      .post('/api/services')
      .set(owner)
      .send({ ...payload, name: ' Corte ' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('SERVICE_NAME_CONFLICT');
    const second = await request(ctx.app)
      .post('/api/services')
      .set(owner)
      .send({ ...payload, name: 'Otro' });
    expect(
      (
        await request(ctx.app)
          .patch(`/api/services/${second.body.data.id}`)
          .set(owner)
          .send({ name: 'Corte' })
      ).status,
    ).toBe(409);
  });
  it('rechaza campos protegidos, query extra/repetida y PATCH vacio o UUID invalido', async () => {
    const res = await create();
    const id = res.body.data.id;
    for (const extra of [
      { businessId: randomUUID() },
      { id },
      { role: 'OWNER' },
      { createdAt: 'x' },
      { updatedAt: 'x' },
    ]) {
      expect(
        (
          await request(ctx.app)
            .post('/api/services')
            .set(owner)
            .send({ ...payload, ...extra })
        ).status,
      ).toBe(422);
      expect(
        (await request(ctx.app).patch(`/api/services/${id}`).set(owner).send(extra)).status,
      ).toBe(422);
    }
    for (const query of [
      'active=true&active=false',
      'limit=1&limit=2',
      'businessId=x',
      'offset=-1',
    ])
      expect((await request(ctx.app).get(`/api/services?${query}`).set(owner)).status).toBe(422);
    expect(
      (await request(ctx.app).post('/api/services?businessId=x').set(owner).send(payload)).status,
    ).toBe(422);
    expect(
      (
        await request(ctx.app)
          .patch(`/api/services/${id}?active=true`)
          .set(owner)
          .send({ active: false })
      ).status,
    ).toBe(422);
    expect((await request(ctx.app).patch(`/api/services/${id}`).set(owner).send({})).status).toBe(
      422,
    );
    expect(
      (await request(ctx.app).patch('/api/services/no-uuid').set(owner).send({ active: false }))
        .status,
    ).toBe(422);
    expect((await request(ctx.app).post('/api/services').set(owner).send({})).status).toBe(422);
  });
  it('STAFF no escribe aunque intente inyectar rol', async () => {
    const res = await create();
    expect(
      (
        await request(ctx.app)
          .post('/api/services')
          .set(staff)
          .send({ ...payload, role: 'OWNER' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(ctx.app)
          .patch(`/api/services/${res.body.data.id}`)
          .set(staff)
          .send({ active: false })
      ).status,
    ).toBe(403);
  });
  it('requiere token verificado y perfil A; JSON invalido mantiene contrato A', async () => {
    expect((await request(ctx.app).get('/api/services')).status).toBe(401);
    expect(
      (await request(ctx.app).get('/api/services').set('Authorization', 'Bearer expired')).body
        .error.code,
    ).toBe('TOKEN_INVALID');
    const user = ctx.verifier.addUser();
    expect(
      (await request(ctx.app).get('/api/services').set('Authorization', `Bearer ${user.token}`))
        .body.error.code,
    ).toBe('PROFILE_REQUIRED');
    const malformed = await request(ctx.app)
      .post('/api/services')
      .set(owner)
      .set('Content-Type', 'application/json')
      .send('{');
    expect(malformed.status).toBe(422);
  });
  it('errores inesperados no se convierten en listado vacio ni filtran detalles', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.spyOn(ctx.services, 'list').mockRejectedValue(new Error('private database constraint'));
      const res = await request(ctx.app).get('/api/services').set(owner);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('private');
    } finally {
      spy.mockRestore();
    }
  });
});
