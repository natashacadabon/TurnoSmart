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
});

describe('onboarding (POST /api/onboarding)', () => {
  const onboard = (app: App, token: string, body: Record<string, unknown>) =>
    request(app).post('/api/onboarding').set('Authorization', `Bearer ${token}`).send(body);

  it('401 sin token', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/onboarding').send({ businessName: 'Sol' });
    expect(res.status).toBe(401);
  });

  it('una cuenta nueva crea su negocio como OWNER (201) y luego opera el negocio', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { id, token } = verifier.addUser();
    const res = await onboard(app, token, {
      businessName: 'Peluquería Sol',
      timezone: 'America/Argentina/Buenos_Aires',
      fullName: 'Ana Pérez',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      access: 'OWNER',
      onboarded: true,
      platformAdmin: false,
      user: { id },
      profile: { id, fullName: 'Ana Pérez', role: 'OWNER' },
      business: { name: 'Peluquería Sol', timezone: 'America/Argentina/Buenos_Aires' },
    });
    expect(identity.businesses.size).toBe(1);
    expect(identity.profiles.get(id)).toMatchObject({ role: 'OWNER', active: true });

    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(me.body).toMatchObject({ access: 'OWNER', business: { id: res.body.business.id } });
    const customers = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${token}`);
    expect(customers.status).toBe(200);
  });

  it('repetir el onboarding responde 200 con el mismo negocio y no crea otro', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { token } = verifier.addUser();
    const first = await onboard(app, token, { businessName: 'Peluquería Sol' });
    const again = await onboard(app, token, { businessName: 'Otro nombre' });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.business).toEqual(first.body.business);
    expect(identity.businesses.size).toBe(1);
  });

  it('ignora rol y negocio inyectados en el body: siempre crea un OWNER de un negocio nuevo', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { id, token } = verifier.addUser();
    const injected = randomUUID();
    const res = await onboard(app, token, {
      businessName: 'Peluquería Sol',
      role: 'ADMIN',
      businessId: injected,
      platformAdmin: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ access: 'OWNER', platformAdmin: false });
    expect(res.body.business.id).not.toBe(injected);
    expect(identity.admins.has(id)).toBe(false);
    expect(identity.profiles.get(id)!.role).toBe('OWNER');
  });

  it('valida el body (422) sin crear nada', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { token } = verifier.addUser();
    const bodies = [{}, { businessName: 'A' }, { businessName: 'Sol', timezone: 'Marte/Base' }];
    for (const body of bodies) {
      const res = await onboard(app, token, body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(identity.businesses.size).toBe(0);
    expect(identity.profiles.size).toBe(0);
  });

  it('el ADMIN global no puede crear un negocio (403 FORBIDDEN)', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { id, token } = verifier.addUser();
    identity.addPlatformAdmin(id);
    const res = await onboard(app, token, { businessName: 'Peluquería Sol' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(identity.businesses.size).toBe(0);
    expect(identity.profiles.size).toBe(0);
  });

  it('un OWNER desactivado o un STAFF legado no puede volver a registrarse (403 ACCOUNT_DISABLED)', async () => {
    const { app, verifier, identity } = buildTestApp();
    const disabled = verifier.addUser();
    const staff = verifier.addUser();
    const businessId = randomUUID();
    identity.addMember(disabled.id, businessId, 'OWNER', false);
    identity.addLegacyProfile(staff.id);
    for (const { token } of [disabled, staff]) {
      const res = await onboard(app, token, { businessName: 'Peluquería Sol' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    }
    expect([...identity.businesses.keys()]).toEqual([businessId]);
    expect(identity.profiles.get(disabled.id)!.active).toBe(false);
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
      platformAdmin: false,
      user: { id },
      profile: { id, role: 'OWNER' },
      business: { id: businessId },
    });
  });

  it('ADMIN de plataforma: acceso ADMIN con perfil global y sin negocio', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { id, token } = verifier.addUser();
    identity.addPlatformAdmin(id);
    const res = await me(app, token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      access: 'ADMIN',
      onboarded: false,
      platformAdmin: true,
      user: { id, email: expect.any(String) },
      profile: { id, fullName: 'Admin', role: 'ADMIN' },
      business: null,
    });
  });

  it('OWNER desactivado: acceso NONE con motivo DISABLED', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { id, token } = verifier.addUser();
    identity.addMember(id, randomUUID(), 'OWNER', false);
    const res = await me(app, token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      access: 'NONE',
      onboarded: false,
      platformAdmin: false,
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
    expect(res.body).toMatchObject({
      access: 'NONE',
      onboarded: false,
      platformAdmin: false,
      reason: 'DISABLED',
    });
    expect(res.body.profile).toBeUndefined();
  });

  it('STAFF legado: acceso NONE con motivo DISABLED', async () => {
    const { app, verifier, identity } = buildTestApp();
    const { id, token } = verifier.addUser();
    identity.addMember(id, randomUUID(), 'STAFF');
    const res = await me(app, token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ access: 'NONE', onboarded: false, reason: 'DISABLED' });
    expect(res.body.business).toBeUndefined();
  });

  it('cuenta sin perfil: acceso NONE con motivo NO_PROFILE', async () => {
    const { app, verifier } = buildTestApp();
    const { id, token } = verifier.addUser();
    const res = await me(app, token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      access: 'NONE',
      onboarded: false,
      platformAdmin: false,
      user: { id, email: expect.any(String) },
      reason: 'NO_PROFILE',
    });
  });
});

describe('permisos por rol', () => {
  function setup() {
    const ctx = buildTestApp();
    const businessId = randomUUID();
    const owner = ctx.verifier.addUser();
    const admin = ctx.verifier.addUser();
    const disabled = ctx.verifier.addUser();
    const staff = ctx.verifier.addUser();
    ctx.identity.addMember(owner.id, businessId);
    ctx.identity.addPlatformAdmin(admin.id);
    ctx.identity.addMember(disabled.id, businessId, 'OWNER', false);
    ctx.identity.addMember(staff.id, businessId, 'STAFF');
    return { ...ctx, businessId, owner, admin, disabled, staff };
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

  it('ADMIN se resuelve como cuenta global sin negocio y no accede a la API operativa', async () => {
    const { app, verifier, identity } = buildTestApp();
    const admin = verifier.addUser();
    identity.addMember(admin.id, randomUUID(), 'ADMIN');
    expect(identity.businesses.size).toBe(0);

    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${admin.token}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      access: 'ADMIN',
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

  it('el ADMIN de plataforma recibe 403 FORBIDDEN en las rutas de negocio', async () => {
    const { app, admin, identity, businessId } = setup();
    for (const [i, res] of (await Promise.all(businessCalls(app, admin.token))).entries()) {
      expect(res.status, `llamada ${i}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(identity.businesses.get(businessId)!.name).toBe('Negocio');
  });

  it('un OWNER desactivado o un STAFF legado recibe 403 ACCOUNT_DISABLED en las rutas de negocio', async () => {
    const { app, disabled, staff, identity, businessId } = setup();
    for (const user of [disabled, staff]) {
      for (const [i, res] of (await Promise.all(businessCalls(app, user.token))).entries()) {
        expect(res.status, `llamada ${i}`).toBe(403);
        expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
      }
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
    expect(identity.admins.has(owner.id)).toBe(false);
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
