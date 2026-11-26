import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../fakes.js';

describe('autenticación', () => {
  it('401 sin token', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('401 con token inválido o vencido', async () => {
    const { app } = buildTestApp();
    for (const header of ['Bearer expired', 'Bearer ', 'Basic abc']) {
      const res = await request(app).get('/api/me').set('Authorization', header);
      expect(res.status).toBe(401);
    }
  });

  it('/me indica cuenta sin perfil', async () => {
    const { app, verifier } = buildTestApp();
    const { id, token } = verifier.addUser();
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ onboarded: false, user: { id } });
  });

  it('cuenta sin perfil recibe 403 PROFILE_REQUIRED en rutas de negocio', async () => {
    const { app, verifier } = buildTestApp();
    const { token } = verifier.addUser();
    const res = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROFILE_REQUIRED');
  });
});

describe('onboarding', () => {
  it('crea un único negocio con rol OWNER, aunque el body intente otro rol o negocio', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { token } = verifier.addUser();
    const res = await request(app)
      .post('/api/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessName: 'Peluquería Sol', role: 'STAFF', businessId: randomUUID() });
    expect(res.status).toBe(201);
    expect(res.body.profile.role).toBe('OWNER');
    expect(res.body.business.name).toBe('Peluquería Sol');
    expect(res.body.business.timezone).toBe('America/Argentina/Buenos_Aires');
    expect(identity.businesses.size).toBe(1);
  });

  it('repetido no duplica el negocio', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { token } = verifier.addUser();
    const auth = { Authorization: `Bearer ${token}` };
    const first = await request(app)
      .post('/api/onboarding')
      .set(auth)
      .send({ businessName: 'Uno' });
    const second = await request(app)
      .post('/api/onboarding')
      .set(auth)
      .send({ businessName: 'Dos' });
    expect(second.status).toBe(200);
    expect(second.body.business.id).toBe(first.body.business.id);
    expect(identity.businesses.size).toBe(1);
  });

  it('rechaza cuentas de Auth sin email (Profile.email es obligatorio)', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { token } = verifier.addUser(randomUUID(), null);
    const res = await request(app)
      .post('/api/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessName: 'Sin email' });
    expect(res.status).toBe(422);
    expect(identity.businesses.size).toBe(0);
  });

  it('valida nombre y zona horaria', async () => {
    const { app, verifier } = buildTestApp();
    const { token } = verifier.addUser();
    const res = await request(app)
      .post('/api/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessName: 'X', timezone: 'Marte/Olympus' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'businessName',
      'timezone',
    ]);
  });
});

describe('permisos por rol', () => {
  it('STAFF no puede modificar el negocio; ADMIN sí', async () => {
    const { app, verifier, identity } = buildTestApp();
    const businessId = randomUUID();
    const staff = verifier.addUser();
    const admin = verifier.addUser();
    identity.addMember(staff.id, businessId, 'STAFF');
    identity.addMember(admin.id, businessId, 'ADMIN');

    const denied = await request(app)
      .patch('/api/business')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ name: 'Nuevo nombre' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const ok = await request(app)
      .patch('/api/business')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Nuevo nombre' });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('Nuevo nombre');
  });
});
