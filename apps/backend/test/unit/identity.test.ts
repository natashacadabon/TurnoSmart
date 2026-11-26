import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../fakes.js';

type App = ReturnType<typeof buildTestApp>['app'];

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

  it('cuenta sin perfil recibe 403 PROFILE_REQUIRED en rutas de negocio', async () => {
    const { app, verifier } = buildTestApp();
    const { token } = verifier.addUser();
    const res = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROFILE_REQUIRED');
  });

  it('ya no existe el alta pública de negocios (POST /api/onboarding)', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { token } = verifier.addUser();
    const res = await request(app)
      .post('/api/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessName: 'Peluquería Sol', role: 'OWNER', businessId: randomUUID() });
    expect(res.status).toBe(404);
    expect(identity.businesses.size).toBe(0);
    expect(identity.profiles.size).toBe(0);
  });
});

describe('/me', () => {
  const me = (app: App, token: string) =>
    request(app).get('/api/me').set('Authorization', `Bearer ${token}`);

  it('OWNER activo: acceso OWNER con perfil y negocio, sin cache', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { id, token } = verifier.addUser();
    const businessId = randomUUID();
    identity.addMember(id, businessId);
    const res = await me(app, token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      access: 'OWNER',
      onboarded: true,
      user: { id },
      profile: { id, role: 'OWNER' },
      business: { id: businessId },
    });
    expect(res.body.admin).toBeUndefined();
  });

  it('ADMIN de plataforma: acceso ADMIN sin negocio ni perfil', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { id, token } = verifier.addUser();
    identity.addPlatformAdmin(id);
    const res = await me(app, token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      access: 'ADMIN',
      onboarded: false,
      user: { id },
      admin: { id, role: 'ADMIN' },
    });
    expect(res.body.business).toBeUndefined();
    expect(res.body.profile).toBeUndefined();
  });

  it('OWNER desactivado: acceso NONE con motivo DISABLED', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { id, token } = verifier.addUser();
    identity.addMember(id, randomUUID(), 'OWNER', false);
    const res = await me(app, token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      access: 'NONE',
      onboarded: false,
      user: { id },
      reason: 'DISABLED',
    });
    expect(res.body.business).toBeUndefined();
    expect(res.body.profile).toBeUndefined();
  });

  it('ADMIN de plataforma desactivado: acceso NONE con motivo DISABLED', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { id, token } = verifier.addUser();
    identity.addPlatformAdmin(id, false);
    const res = await me(app, token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ access: 'NONE', onboarded: false, reason: 'DISABLED' });
    expect(res.body.admin).toBeUndefined();
  });

  it('cuenta sin perfil: acceso NONE con motivo NO_PROFILE', async () => {
    const { app, verifier } = buildTestApp();
    const { id, token } = verifier.addUser();
    const res = await me(app, token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      access: 'NONE',
      onboarded: false,
      user: { id },
      reason: 'NO_PROFILE',
    });
  });

  it('una cuenta ADMIN y OWNER a la vez se resuelve como ADMIN y no opera el negocio', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { id, token } = verifier.addUser();
    identity.addMember(id, randomUUID());
    identity.addPlatformAdmin(id);
    const res = await me(app, token);
    expect(res.body).toMatchObject({ access: 'ADMIN', admin: { id, role: 'ADMIN' } });
    expect(res.body.business).toBeUndefined();

    const denied = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
  });
});

describe('permisos por rol', () => {
  function setup() {
    const ctx = buildTestApp();
    const businessId = randomUUID();
    const owner = ctx.verifier.addUser();
    const admin = ctx.verifier.addUser();
    const disabled = ctx.verifier.addUser();
    ctx.identity.addMember(owner.id, businessId);
    ctx.identity.addPlatformAdmin(admin.id);
    ctx.identity.addMember(disabled.id, businessId, 'OWNER', false);
    return { ...ctx, businessId, owner, admin, disabled };
  }

  /** Lecturas y escrituras de negocio: clientes, servicios, disponibilidad, slots, turnos, eventos, riesgo y negocio. */
  const businessCalls = (app: App, token: string) => {
    const auth = { Authorization: `Bearer ${token}` };
    const id = randomUUID();
    return [
      request(app).get('/api/customers').set(auth),
      request(app).post('/api/customers').set(auth).send({ fullName: 'Ana Pérez' }),
      request(app).get('/api/services').set(auth),
      request(app).post('/api/services').set(auth).send({ name: 'Corte', durationMinutes: 30 }),
      request(app).get('/api/availability-rules').set(auth),
      request(app).put('/api/availability-rules').set(auth).send({ rules: [] }),
      request(app).get(`/api/slots?serviceId=${id}&date=2026-12-01`).set(auth),
      request(app).get('/api/appointments').set(auth),
      request(app).get(`/api/appointments/${id}/events`).set(auth),
      request(app).post(`/api/appointments/${id}/risk/explanation`).set(auth),
      request(app).patch('/api/business').set(auth).send({ name: 'Nuevo nombre' }),
      request(app).get('/api/business/notification-preferences').set(auth),
      request(app)
        .patch('/api/business/notification-preferences')
        .set(auth)
        .send({ remindersEnabled: false }),
    ];
  };

  it('el ADMIN de plataforma recibe 403 FORBIDDEN en las rutas de negocio', async () => {
    const { app, admin, identity, businessId } = setup();
    for (const [i, res] of (await Promise.all(businessCalls(app, admin.token))).entries()) {
      expect(res.status, `llamada ${i}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(identity.businesses.get(businessId)!.name).toBe('Negocio');
  });

  it('un OWNER desactivado recibe 403 ACCOUNT_DISABLED en las rutas de negocio', async () => {
    const { app, disabled, identity, businessId } = setup();
    for (const [i, res] of (await Promise.all(businessCalls(app, disabled.token))).entries()) {
      expect(res.status, `llamada ${i}`).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    }
    expect(identity.businesses.get(businessId)!.name).toBe('Negocio');
  });

  it('el OWNER modifica su negocio aunque el body intente inyectar rol o negocio', async () => {
    const { app, owner, identity, businessId } = setup();
    const otherId = randomUUID();
    const res = await request(app)
      .patch('/api/business')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Nuevo nombre', role: 'ADMIN', businessId: otherId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: businessId, name: 'Nuevo nombre' });
    expect(identity.businesses.get(businessId)!.name).toBe('Nuevo nombre');
    expect(identity.businesses.has(otherId)).toBe(false);
    expect(identity.profiles.get(owner.id)!.role).toBe('OWNER');
  });

  it('un segundo OWNER activo del mismo negocio también lo opera', async () => {
    const { app, verifier, identity, businessId } = setup();
    const second = verifier.addUser();
    identity.addMember(second.id, businessId);
    const res = await request(app)
      .patch('/api/business')
      .set('Authorization', `Bearer ${second.token}`)
      .send({ name: 'Segundo' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Segundo');
  });
});
