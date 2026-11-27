import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../fakes.js';

describe('identidad y separación de roles', () => {
  it('401 sin token', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('cuenta sin perfil recibe PROFILE_REQUIRED en rutas operativas', async () => {
    const { app, verifier } = buildTestApp();
    const { token } = verifier.addUser();
    const res = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROFILE_REQUIRED');
  });

  it('ADMIN se resuelve como cuenta global sin negocio y no accede a la API operativa', async () => {
    const { app, verifier, identity } = buildTestApp();
    const admin = verifier.addUser();
    identity.addMember(admin.id, randomUUID(), 'ADMIN');

    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${admin.token}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      onboarded: false,
      platformAdmin: true,
      business: null,
      profile: { role: 'ADMIN' },
    });

    const operational = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(operational.status).toBe(403);
    expect(operational.body.error.code).toBe('FORBIDDEN');
  });

  it('OWNER tiene acceso a su negocio y ADMIN global no puede modificarlo', async () => {
    const { app, verifier, identity } = buildTestApp();
    const businessId = randomUUID();
    const owner = verifier.addUser();
    const admin = verifier.addUser();
    identity.addMember(owner.id, businessId, 'OWNER');
    identity.addMember(admin.id, randomUUID(), 'ADMIN');

    const ownerResponse = await request(app)
      .patch('/api/business')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Nuevo nombre' });
    expect(ownerResponse.status).toBe(200);

    const adminResponse = await request(app)
      .patch('/api/business')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'No permitido' });
    expect(adminResponse.status).toBe(403);
  });

  it('el onboarding público no crea OWNERS sin una invitación emitida por ADMIN', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { token } = verifier.addUser();
    const res = await request(app)
      .post('/api/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessName: 'Negocio no permitido' });
    expect(res.status).toBe(403);
    expect(identity.businesses.size).toBe(0);
  });

  it('reports a disabled OWNER account without sending it to another invitation', async () => {
    const { app, verifier, identity } = buildTestApp();
    const businessId = randomUUID();
    const owner = verifier.addUser();
    identity.addMember(owner.id, businessId, 'OWNER');
    identity.profiles.get(owner.id)!.active = false;

    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${owner.token}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      onboarded: false,
      platformAdmin: false,
      accountDisabled: true,
      profile: { role: 'OWNER' },
      business: { id: businessId },
    });
  });
});
