/**
 * Auth, permisos y acceso entre negocios contra PostgreSQL real (Supabase local o DB descartable).
 * Requiere DATABASE_URL con migraciones aplicadas. Sin DB, falla: "no hay tests" no cuenta como éxito.
 * El token se simula con FakeVerifier; la validación real de tokens de Supabase se cubre en el E2E.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { PrismaRiskRepository } from '../../src/modules/ai/risk-repository.js';
import { PrismaCustomerRepository } from '../../src/modules/customers/repository.js';
import { PrismaEventRepository } from '../../src/modules/events/repository.js';
import { PrismaIdentityRepository } from '../../src/modules/identity/repository.js';
import { FakeVerifier } from '../fakes.js';
import { PrismaServiceRepository } from '../../src/modules/services/repository.js';
import { PrismaAvailabilityRepository } from '../../src/modules/availability/repository.js';
import { PrismaSlotsRepository } from '../../src/modules/slots/repository.js';
import { PrismaAppointmentRepository } from '../../src/modules/appointments/repository.js';
import { PrismaNotificationRepository } from '../../src/modules/notifications/repository.js';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL no definida: levantar Supabase local (ver README) antes de test:integration',
  );
}

const prisma = new PrismaClient();
const verifier = new FakeVerifier();
const identity = new PrismaIdentityRepository(prisma);
const app = createApp({
  corsOrigins: [],
  verifier,
  identity,
  customers: new PrismaCustomerRepository(prisma),
  services: new PrismaServiceRepository(prisma),
  availability: new PrismaAvailabilityRepository(prisma),
  slots: new PrismaSlotsRepository(prisma),
  appointments: new PrismaAppointmentRepository(prisma),
  events: new PrismaEventRepository(prisma),
  notifications: new PrismaNotificationRepository(prisma),
  risk: new PrismaRiskRepository(prisma),
  explainer: null,
  aiRateLimit: { limit: 10, windowMs: 60_000 },
  checkReady: async () => true,
});

const createdBusinesses: string[] = [];
const createdAdmins: string[] = [];
let ownerA: { Authorization: string };
let businessA: string;
let ownerB: { Authorization: string };

/** Negocio + OWNER creados directamente: el alta la hace el ADMIN de plataforma, no la API pública. */
async function createOwner(name: string) {
  const user = verifier.addUser();
  const auth = { Authorization: `Bearer ${user.token}` };
  const business = await prisma.business.create({ data: { name } });
  createdBusinesses.push(business.id);
  await prisma.profile.create({
    data: { id: user.id, businessId: business.id, email: `${user.id}@test.local`, role: 'OWNER' },
  });
  return { auth, userId: user.id, businessId: business.id };
}

/** OWNER adicional de un negocio existente; `active: false` lo deja desactivado. */
async function addOwner(businessId: string, active = true) {
  const user = verifier.addUser();
  await prisma.profile.create({
    data: {
      id: user.id,
      businessId,
      email: `${user.id}@test.local`,
      role: 'OWNER',
      active,
      deactivatedAt: active ? null : new Date(),
    },
  });
  return { auth: { Authorization: `Bearer ${user.token}` }, userId: user.id };
}

async function createPlatformAdmin(id = verifier.addUser().id, active = true) {
  await prisma.platformAdmin.create({
    data: {
      id,
      email: `${id}@admin.test.local`,
      active,
      deactivatedAt: active ? null : new Date(),
    },
  });
  createdAdmins.push(id);
  return { Authorization: `Bearer token-${id}` };
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  const a = await createOwner(`Test A ${Date.now()}`);
  ownerA = a.auth;
  businessA = a.businessId;
  ownerB = (await createOwner(`Test B ${Date.now()}`)).auth;
});

afterAll(async () => {
  // Cascade elimina perfiles, clientes y turnos de prueba. Los ADMIN no dependen de un negocio.
  await prisma.business.deleteMany({ where: { id: { in: createdBusinesses } } });
  await prisma.platformAdmin.deleteMany({ where: { id: { in: createdAdmins } } });
  await prisma.$disconnect();
});

describe('centro de notificaciones', () => {
  it('persiste avisos únicos y lecturas individuales, pagina y aísla los negocios', async () => {
    const member = await createOwner('Notificaciones A');
    const stranger = await createOwner('Notificaciones B');
    // Segundo OWNER del mismo negocio: comparte avisos pero tiene lecturas propias.
    const coOwnerAuth = (await addOwner(member.businessId)).auth;
    const path = '/api/notifications';
    const now = Date.now();

    async function appointment(businessId: string, startsAt: Date) {
      const [customer, service] = await Promise.all([
        prisma.customer.create({ data: { businessId, fullName: 'Cliente' } }),
        prisma.service.create({ data: { businessId, name: randomUUID(), durationMinutes: 30 } }),
      ]);
      return prisma.appointment.create({
        data: {
          businessId,
          customerId: customer.id,
          serviceId: service.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        },
      });
    }

    const near = await appointment(member.businessId, new Date(now + 4 * 60_000));
    const distant = await appointment(member.businessId, new Date(now + 24 * 60 * 60_000));
    const foreign = await appointment(stranger.businessId, new Date(now + 4 * 60_000));
    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).get(path).set(member.auth)).body).toEqual({
      items: [],
      nextCursor: null,
      unreadCount: 0,
    });
    const synced = await Promise.all(
      [member.auth, coOwnerAuth, member.auth].map((auth) =>
        request(app)
          .post(path + '/sync-upcoming')
          .set(auth),
      ),
    );
    for (const response of synced) {
      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([
        {
          id: synced[0]!.body.items[0].id,
          appointmentId: near.id,
          startsAt: near.startsAt.toISOString(),
        },
      ]);
    }
    const upcomingId = synced[0]!.body.items[0].id as string;
    expect((await request(app).get(path).set(stranger.auth)).body.items).toEqual([]);
    expect((await request(app).patch(`${path}/${upcomingId}/read`).set(stranger.auth)).status).toBe(
      404,
    );
    expect((await request(app).get(`${path}?cursor=${upcomingId}`).set(stranger.auth)).status).toBe(
      404,
    );
    expect(
      (await request(app).post(`/api/appointments/${foreign.id}/confirm`).set(stranger.auth))
        .status,
    ).toBe(200);
    expect(
      (await request(app).post(`/api/appointments/${distant.id}/confirm`).set(member.auth)).status,
    ).toBe(200);
    expect(
      (await request(app).post(`/api/appointments/${distant.id}/confirm`).set(member.auth)).status,
    ).toBe(409);

    const first = await request(app)
      .get(path + '?limit=1')
      .set(member.auth);
    expect(first.body).toMatchObject({
      items: [{ kind: 'CONFIRMED', appointmentId: distant.id }],
      unreadCount: 2,
    });
    expect(first.body.nextCursor).toBe(first.body.items[0].id);
    const second = await request(app)
      .get(`${path}?limit=1&cursor=${first.body.nextCursor}`)
      .set(member.auth);
    expect(second.body).toMatchObject({
      items: [{ id: upcomingId, kind: 'APPOINTMENT_UPCOMING' }],
      nextCursor: null,
    });
    const reads = await Promise.all(
      [1, 2].map(() => request(app).patch(`${path}/${upcomingId}/read`).set(member.auth)),
    );
    expect(reads.map((response) => response.status)).toEqual([200, 200]);
    expect(reads[0]!.body).toEqual(reads[1]!.body);
    expect(reads[0]!.body.unreadCount).toBe(1);
    expect((await request(app).get(path).set(coOwnerAuth)).body.unreadCount).toBe(2);
    expect(
      (
        await request(app)
          .get(path + '?filter=unread')
          .set(member.auth)
      ).body.items,
    ).toMatchObject([{ kind: 'CONFIRMED' }]);
    expect(
      (
        await request(app)
          .patch(path + '/read-all')
          .set(member.auth)
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .get(path + '?filter=unread')
          .set(member.auth)
      ).body,
    ).toMatchObject({ items: [], unreadCount: 0 });
    expect((await request(app).get(path).set(coOwnerAuth)).body.unreadCount).toBe(2);
    expect((await request(app).get(path).set(stranger.auth)).body.unreadCount).toBe(1);
    expect(
      (await request(app).post(`/api/appointments/${near.id}/cancel`).set(member.auth)).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(path + '/sync-upcoming')
          .set(member.auth)
      ).body.items,
    ).toEqual([]);
    await prisma.appointment.delete({ where: { id: near.id } });
    const preserved = await request(app)
      .get(path + '?filter=unread')
      .set(member.auth);
    expect(preserved.body.items).toMatchObject([{ kind: 'CANCELLED', appointmentId: null }]);
    expect(await prisma.notificationRead.count({ where: { businessId: member.businessId } })).toBe(
      2,
    );
  });

  it('mantiene las tablas nuevas fuera de la Data API', async () => {
    const [result] = await prisma.$queryRaw<{ enabled: boolean; directAccess: boolean }[]>`
      SELECT bool_and(c.relrowsecurity) AS enabled,
             bool_or(has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS "directAccess"
      FROM pg_class c CROSS JOIN pg_roles r
      WHERE c.oid IN ('public.notifications'::regclass, 'public.notification_reads'::regclass)
        AND r.rolname IN ('anon', 'authenticated')
    `;
    expect(result).toEqual({ enabled: true, directAccess: false });
  });
});

describe('integración API-DB: identidad', () => {
  it('readiness real', async () => {
    expect((await request(app).get('/ready')).status).toBe(200);
  });

  it('el alta pública de negocios ya no existe', async () => {
    const user = verifier.addUser();
    const res = await request(app)
      .post('/api/onboarding')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ businessName: 'Carrera' });
    expect(res.status).toBe(404);
    expect(await prisma.profile.count({ where: { id: user.id } })).toBe(0);
  });

  it('/me resuelve OWNER, ADMIN, OWNER desactivado y cuenta sin perfil', async () => {
    const me = (auth: { Authorization: string }) => request(app).get('/api/me').set(auth);
    const owner = await me(ownerA);
    expect(owner.headers['cache-control']).toBe('no-store');
    expect(owner.body).toMatchObject({
      access: 'OWNER',
      onboarded: true,
      profile: { role: 'OWNER' },
      business: { id: businessA },
    });
    expect((await me(await createPlatformAdmin())).body).toMatchObject({
      access: 'ADMIN',
      onboarded: false,
      admin: { role: 'ADMIN' },
    });
    expect((await me(await createPlatformAdmin(undefined, false))).body).toMatchObject({
      access: 'NONE',
      reason: 'DISABLED',
    });
    expect((await me((await addOwner(businessA, false)).auth)).body).toMatchObject({
      access: 'NONE',
      onboarded: false,
      reason: 'DISABLED',
    });
    const stranger = verifier.addUser();
    expect((await me({ Authorization: `Bearer ${stranger.token}` })).body).toMatchObject({
      access: 'NONE',
      reason: 'NO_PROFILE',
    });
  });

  it('el ADMIN de plataforma recibe 403 FORBIDDEN en rutas de negocio, aunque además sea OWNER', async () => {
    const admin = await createPlatformAdmin();
    const both = await addOwner(businessA);
    const bothAuth = await createPlatformAdmin(both.userId);
    expect((await request(app).get('/api/me').set(bothAuth)).body.access).toBe('ADMIN');
    for (const auth of [admin, bothAuth]) {
      for (const res of await Promise.all([
        request(app).get('/api/customers').set(auth),
        request(app).post('/api/customers').set(auth).send({ fullName: 'No debe existir' }),
        request(app).get('/api/services').set(auth),
        request(app).get('/api/appointments').set(auth),
        request(app).get('/api/notifications').set(auth),
        request(app).patch('/api/business').set(auth).send({ name: 'No debe cambiar' }),
      ])) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    }
    expect(await prisma.customer.count({ where: { fullName: 'No debe existir' } })).toBe(0);
    expect((await prisma.business.findUnique({ where: { id: businessA } }))?.name).not.toBe(
      'No debe cambiar',
    );
  });

  it('un OWNER desactivado recibe 403 ACCOUNT_DISABLED y la base exige fecha de baja', async () => {
    const disabled = await addOwner(businessA, false);
    for (const res of await Promise.all([
      request(app).get('/api/customers').set(disabled.auth),
      request(app).patch('/api/business').set(disabled.auth).send({ name: 'No debe cambiar' }),
    ])) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
    }
    await expect(
      prisma.profile.create({
        data: {
          id: randomUUID(),
          businessId: businessA,
          email: `${randomUUID()}@test.local`,
          active: false,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('integración API-DB: clientes y aislamiento', () => {
  it('persiste y otro negocio no puede leer, editar ni listar', async () => {
    const created = await request(app)
      .post('/api/customers')
      .set(ownerA)
      .send({ fullName: 'Cliente Persistente', email: 'p@example.com' });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const reloaded = await request(app).get(`/api/customers/${id}`).set(ownerA);
    expect(reloaded.body.fullName).toBe('Cliente Persistente');

    expect((await request(app).get(`/api/customers/${id}`).set(ownerB)).status).toBe(404);
    expect(
      (await request(app).patch(`/api/customers/${id}`).set(ownerB).send({ fullName: 'X' })).status,
    ).toBe(404);
    const listB = await request(app).get('/api/customers?search=Persistente').set(ownerB);
    expect(listB.body.total).toBe(0);

    const db = await prisma.customer.findUnique({ where: { id } });
    expect(db?.fullName).toBe('Cliente Persistente');
  });

  it('búsqueda insensible a mayúsculas', async () => {
    await request(app).post('/api/customers').set(ownerA).send({ fullName: 'Mariana Búsqueda' });
    const res = await request(app).get('/api/customers?search=mariana').set(ownerA);
    expect(
      res.body.items.some((c: { fullName: string }) => c.fullName === 'Mariana Búsqueda'),
    ).toBe(true);
  });

  it('eventos y explicación de un turno inexistente o ajeno → 404', async () => {
    const id = randomUUID();
    expect((await request(app).get(`/api/appointments/${id}/events`).set(ownerA)).status).toBe(404);
    expect(
      (await request(app).post(`/api/appointments/${id}/risk/explanation`).set(ownerA)).status,
    ).toBe(404);
  });

  it('persiste score, eventos y rechaza reservas concurrentes en PostgreSQL', async () => {
    const customer = await request(app)
      .post('/api/customers')
      .set(ownerA)
      .send({ fullName: `Cliente turno ${randomUUID()}` });
    const service = await request(app)
      .post('/api/services')
      .set(ownerA)
      .send({ name: `Servicio turno ${randomUUID()}`, durationMinutes: 60 });
    expect(customer.status).toBe(201);
    expect(service.status).toBe(201);

    expect(
      (
        await request(app)
          .put('/api/availability-rules')
          .set(ownerA)
          .send({ rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }] })
      ).status,
    ).toBe(200);

    const payload = {
      customerId: customer.body.id,
      serviceId: service.body.data.id,
      startsAt: '2099-01-05T13:00:00.000Z',
    };
    const results = await Promise.all(
      [1, 2].map(() => request(app).post('/api/appointments').set(ownerA).send(payload)),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);

    const created = results.find((result) => result.status === 201)!;
    const risk = await prisma.riskScore.findUnique({
      where: {
        appointmentId_businessId: { appointmentId: created.body.id, businessId: businessA },
      },
    });
    expect(risk?.level).toBe('LOW');
    expect(await prisma.appointmentEvent.count({ where: { appointmentId: created.body.id } })).toBe(
      1,
    );
  });
});

describe('integración API-DB: servicios', () => {
  it('persiste create/list/PATCH, aísla negocios y traduce conflictos únicos', async () => {
    const name = `Servicio ${randomUUID()}`;
    const payload = { name, durationMinutes: 30, priceCents: 1000 };
    const created = await request(app).post('/api/services').set(ownerA).send(payload);
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const listA = await request(app).get('/api/services?active=all').set(ownerA);
    expect(listA.body.data).toContainEqual(
      expect.objectContaining({ id, name, durationMinutes: 30, priceCents: 1000 }),
    );
    const listB = await request(app).get('/api/services?active=all').set(ownerB);
    expect(listB.body.data).not.toContainEqual(expect.objectContaining({ id }));

    const duplicate = await request(app).post('/api/services').set(ownerA).send(payload);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('SERVICE_NAME_CONFLICT');

    const sameNameInOtherBusiness = await request(app)
      .post('/api/services')
      .set(ownerB)
      .send(payload);
    expect(sameNameInOtherBusiness.status).toBe(201);
    expect(sameNameInOtherBusiness.body.data.id).not.toBe(id);

    expect(
      (await request(app).patch(`/api/services/${id}`).set(ownerB).send({ active: false })).status,
    ).toBe(404);
    const updated = await request(app)
      .patch(`/api/services/${id}`)
      .set(ownerA)
      .send({ name: `${name} actualizado`, durationMinutes: 45, active: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      id,
      name: `${name} actualizado`,
      durationMinutes: 45,
      active: false,
    });

    const conflictTarget = `Conflicto ${randomUUID()}`;
    const target = await request(app)
      .post('/api/services')
      .set(ownerA)
      .send({ name: conflictTarget, durationMinutes: 30 });
    expect(target.status).toBe(201);
    const patchConflict = await request(app)
      .patch(`/api/services/${id}`)
      .set(ownerA)
      .send({ name: conflictTarget });
    expect(patchConflict.status).toBe(409);
    expect(patchConflict.body.error.code).toBe('SERVICE_NAME_CONFLICT');

    const persisted = await prisma.service.findUnique({ where: { id } });
    expect(persisted).toMatchObject({
      businessId: businessA,
      name: `${name} actualizado`,
      durationMinutes: 45,
      active: false,
    });
  });
});
describe('integración API-DB: baja de clientes', () => {
  it('elimina un cliente sin turnos y respeta el aislamiento', async () => {
    const id = (await request(app).post('/api/customers').set(ownerA).send({ fullName: 'Baja' }))
      .body.id as string;
    expect((await request(app).delete(`/api/customers/${id}`).set(ownerB)).status).toBe(404);
    expect((await request(app).delete(`/api/customers/${id}`).set(ownerA)).status).toBe(204);
    expect(await prisma.customer.findUnique({ where: { id } })).toBeNull();
  });

  it('un cliente con turnos no se elimina (409) y el turno queda intacto', async () => {
    const customerId = (
      await request(app).post('/api/customers').set(ownerA).send({ fullName: 'Con turno' })
    ).body.id as string;
    const service = await prisma.service.create({
      data: { businessId: businessA, name: `Servicio ${Date.now()}`, durationMinutes: 30 },
    });
    const startsAt = new Date(Date.now() + 86_400_000);
    const appointment = await prisma.appointment.create({
      data: {
        businessId: businessA,
        customerId,
        serviceId: service.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      },
    });

    const res = await request(app).delete(`/api/customers/${customerId}`).set(ownerA);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOMER_HAS_APPOINTMENTS');
    expect(await prisma.customer.findUnique({ where: { id: customerId } })).not.toBeNull();

    // Limpieza explícita: la FK del turno al cliente es RESTRICT.
    await prisma.appointment.delete({ where: { id: appointment.id } });
    await prisma.service.delete({ where: { id: service.id } });
  });
});
