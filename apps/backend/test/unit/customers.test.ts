import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from '../fakes.js';

describe('clientes', () => {
  let ctx: ReturnType<typeof buildTestApp>;
  let authA: { Authorization: string };
  let authB: { Authorization: string };

  beforeEach(() => {
    ctx = buildTestApp();
    const a = ctx.verifier.addUser();
    const b = ctx.verifier.addUser();
    ctx.identity.addMember(a.id, randomUUID(), 'STAFF');
    ctx.identity.addMember(b.id, randomUUID(), 'OWNER');
    authA = { Authorization: `Bearer ${a.token}` };
    authB = { Authorization: `Bearer ${b.token}` };
  });

  it('alta, consulta, edición y listado', async () => {
    const created = await request(ctx.app)
      .post('/api/customers')
      .set(authA)
      .send({ fullName: '  Ana Pérez ', email: 'ana@example.com', phone: '' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      fullName: 'Ana Pérez',
      email: 'ana@example.com',
      phone: null,
    });

    const id = created.body.id;
    const patched = await request(ctx.app)
      .patch(`/api/customers/${id}`)
      .set(authA)
      .send({ phone: '221 555-1234' });
    expect(patched.status).toBe(200);
    expect(patched.body.phone).toBe('221 555-1234');
    expect(patched.body.fullName).toBe('Ana Pérez');

    const got = await request(ctx.app).get(`/api/customers/${id}`).set(authA);
    expect(got.body.phone).toBe('221 555-1234');

    const list = await request(ctx.app).get('/api/customers?search=ana').set(authA);
    expect(list.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
  });

  it('email opcional y no único', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await request(ctx.app)
        .post('/api/customers')
        .set(authA)
        .send({ fullName: `C${i}`, email: 'x@y.com' });
      expect(res.status).toBe(201);
    }
    const noEmail = await request(ctx.app)
      .post('/api/customers')
      .set(authA)
      .send({ fullName: 'Sin email' });
    expect(noEmail.body.email).toBeNull();
  });

  it('normaliza el email (espacios y mayúsculas) y permite borrarlo', async () => {
    const created = await request(ctx.app)
      .post('/api/customers')
      .set(authA)
      .send({ fullName: 'Ana', email: '  Ana.Perez@Example.COM ' });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe('ana.perez@example.com');

    const cleared = await request(ctx.app)
      .patch(`/api/customers/${created.body.id}`)
      .set(authA)
      .send({ email: '' });
    expect(cleared.body.email).toBeNull();
  });

  it('valida el teléfono: acepta formatos habituales y rechaza texto', async () => {
    for (const phone of ['+54 11 5555 0101', '(0221) 555-1234', '2215551234']) {
      const ok = await request(ctx.app)
        .post('/api/customers')
        .set(authA)
        .send({ fullName: 'Tel', phone });
      expect(ok.status).toBe(201);
    }
    for (const phone of ['hola', '12-34', '+54 abc 123456']) {
      const bad = await request(ctx.app)
        .post('/api/customers')
        .set(authA)
        .send({ fullName: 'Tel', phone });
      expect(bad.status).toBe(422);
      expect(bad.body.error.details).toEqual([{ path: 'phone', message: 'Teléfono inválido' }]);
    }
  });

  it('valida nombre obligatorio y email', async () => {
    const res = await request(ctx.app)
      .post('/api/customers')
      .set(authA)
      .send({ fullName: ' ', email: 'no-email' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('pageSize acotado', async () => {
    const res = await request(ctx.app).get('/api/customers?pageSize=500').set(authA);
    expect(res.status).toBe(422);
  });

  it('un negocio no ve ni edita clientes de otro (404)', async () => {
    const created = await request(ctx.app)
      .post('/api/customers')
      .set(authA)
      .send({ fullName: 'Privado' });
    const id = created.body.id;

    expect((await request(ctx.app).get(`/api/customers/${id}`).set(authB)).status).toBe(404);
    expect(
      (await request(ctx.app).patch(`/api/customers/${id}`).set(authB).send({ fullName: 'Hack' }))
        .status,
    ).toBe(404);
    expect((await request(ctx.app).get('/api/customers').set(authB)).body.total).toBe(0);
    expect(ctx.customers.rows[0]?.fullName).toBe('Privado');
  });

  it('ignora businessId enviado en el body', async () => {
    const other = randomUUID();
    const res = await request(ctx.app)
      .post('/api/customers')
      .set(authA)
      .send({ fullName: 'X', businessId: other });
    expect(res.status).toBe(201);
    expect(ctx.customers.rows[0]?.businessId).not.toBe(other);
  });

  it('id mal formado responde 404', async () => {
    const res = await request(ctx.app).get('/api/customers/123').set(authA);
    expect(res.status).toBe(404);
  });
});

describe('baja de clientes', () => {
  let ctx: ReturnType<typeof buildTestApp>;
  let owner: { Authorization: string };
  let staff: { Authorization: string };
  let otherOwner: { Authorization: string };

  beforeEach(() => {
    ctx = buildTestApp();
    const businessId = randomUUID();
    const o = ctx.verifier.addUser();
    const s = ctx.verifier.addUser();
    const x = ctx.verifier.addUser();
    ctx.identity.addMember(o.id, businessId, 'OWNER');
    ctx.identity.addMember(s.id, businessId, 'STAFF');
    ctx.identity.addMember(x.id, randomUUID(), 'OWNER');
    owner = { Authorization: `Bearer ${o.token}` };
    staff = { Authorization: `Bearer ${s.token}` };
    otherOwner = { Authorization: `Bearer ${x.token}` };
  });

  const create = async (fullName: string) =>
    (await request(ctx.app).post('/api/customers').set(owner).send({ fullName })).body.id as string;

  it('OWNER elimina un cliente sin turnos: 204 y deja de existir', async () => {
    const id = await create('Para borrar');
    const res = await request(ctx.app).delete(`/api/customers/${id}`).set(owner);
    expect(res.status).toBe(204);
    expect((await request(ctx.app).get(`/api/customers/${id}`).set(owner)).status).toBe(404);
    expect((await request(ctx.app).delete(`/api/customers/${id}`).set(owner)).status).toBe(404);
  });

  it('STAFF no puede eliminar (403) y el cliente sigue existiendo', async () => {
    const id = await create('Protegido');
    const res = await request(ctx.app).delete(`/api/customers/${id}`).set(staff);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(ctx.customers.rows).toHaveLength(1);
  });

  it('otro negocio no puede eliminarlo (404)', async () => {
    const id = await create('Ajeno');
    expect((await request(ctx.app).delete(`/api/customers/${id}`).set(otherOwner)).status).toBe(
      404,
    );
    expect(ctx.customers.rows).toHaveLength(1);
  });

  it('un cliente con turnos no se elimina (409)', async () => {
    const id = await create('Con turnos');
    ctx.customers.withAppointments.add(id);
    const res = await request(ctx.app).delete(`/api/customers/${id}`).set(owner);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOMER_HAS_APPOINTMENTS');
    expect(ctx.customers.rows).toHaveLength(1);
  });
});
