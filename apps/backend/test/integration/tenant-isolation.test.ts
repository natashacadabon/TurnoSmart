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
  events: new PrismaEventRepository(prisma),
  risk: new PrismaRiskRepository(prisma),
  explainer: null,
  aiRateLimit: { limit: 10, windowMs: 60_000 },
  checkReady: async () => true,
});

const createdBusinesses: string[] = [];
let ownerA: { Authorization: string };
let businessA: string;
let ownerB: { Authorization: string };

async function onboard(name: string) {
  const user = verifier.addUser();
  const auth = { Authorization: `Bearer ${user.token}` };
  const res = await request(app).post('/api/onboarding').set(auth).send({ businessName: name });
  expect(res.status).toBe(201);
  createdBusinesses.push(res.body.business.id);
  return { auth, userId: user.id, businessId: res.body.business.id as string };
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  const a = await onboard(`Test A ${Date.now()}`);
  ownerA = a.auth;
  businessA = a.businessId;
  ownerB = (await onboard(`Test B ${Date.now()}`)).auth;
});

afterAll(async () => {
  // Cascade elimina perfiles, clientes y turnos de prueba.
  await prisma.business.deleteMany({ where: { id: { in: createdBusinesses } } });
  await prisma.$disconnect();
});

describe('integración API-DB: identidad', () => {
  it('readiness real', async () => {
    expect((await request(app).get('/ready')).status).toBe(200);
  });

  it('onboarding concurrente crea un único negocio', async () => {
    const user = verifier.addUser();
    const auth = { Authorization: `Bearer ${user.token}` };
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post('/api/onboarding').set(auth).send({ businessName: 'Carrera' }),
      ),
    );
    const ids = new Set(results.map((r) => r.body.business?.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    createdBusinesses.push([...ids][0]);
    expect(await prisma.profile.count({ where: { id: user.id } })).toBe(1);
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
