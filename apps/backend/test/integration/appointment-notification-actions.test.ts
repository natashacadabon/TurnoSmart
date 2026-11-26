import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, expect, it } from 'vitest';
import { AppointmentActionLinks } from '../../src/modules/appointments/action-links.js';
import { PrismaAppointmentRepository } from '../../src/modules/appointments/repository.js';
import { PrismaRiskRepository } from '../../src/modules/ai/risk-repository.js';
import { PrismaAvailabilityRepository } from '../../src/modules/availability/repository.js';
import { PrismaEventRepository } from '../../src/modules/events/repository.js';
import { PrismaIdentityRepository } from '../../src/modules/identity/repository.js';
import { PrismaNotificationRepository } from '../../src/modules/notifications/repository.js';
import { buildTestApp } from '../fakes.js';

const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Estas pruebas requieren PostgreSQL local descartable');
}

const prisma = new PrismaClient({ datasourceUrl: url });
const businesses: string[] = [];
const platformAdmins: string[] = [];
afterAll(async () => {
  try {
    await prisma.business.deleteMany({ where: { id: { in: businesses } } });
    await prisma.platformAdmin.deleteMany({ where: { id: { in: platformAdmins } } });
  } finally {
    await prisma.$disconnect();
  }
});

async function fixture() {
  const startsAt = new Date('2099-01-05T10:00:00Z');
  let now = new Date('2099-01-04T10:00:00Z');
  const { app, verifier } = buildTestApp({
    appointmentActionLinks: new AppointmentActionLinks(prisma, 'ab'.repeat(32), () => now),
    appointments: new PrismaAppointmentRepository(prisma),
    identity: new PrismaIdentityRepository(prisma),
    notifications: new PrismaNotificationRepository(prisma),
    events: new PrismaEventRepository(prisma),
    risk: new PrismaRiskRepository(prisma),
  });
  const api = request(app);
  const business = await prisma.business.create({ data: { name: 'Negocio', timezone: 'UTC' } });
  businesses.push(business.id);
  const businessId = business.id;
  const customer = await prisma.customer.create({
    data: { businessId, fullName: 'Cliente', email: 'cliente@example.com' },
  });
  const service = await prisma.service.create({
    data: { businessId, name: 'Consulta', durationMinutes: 60 },
  });
  await new PrismaAvailabilityRepository(prisma).replace(businessId, [
    { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', active: true },
  ]);
  const row = await prisma.appointment.create({
    data: {
      businessId,
      customerId: customer.id,
      serviceId: service.id,
      startsAt,
      endsAt: new Date('2099-01-05T11:00:00Z'),
    },
  });
  async function member(tenant = businessId, active = true) {
    const user = verifier.addUser();
    await prisma.profile.create({
      data: {
        id: user.id,
        businessId: tenant,
        email: `${user.id}@example.com`,
        role: 'OWNER',
        active,
        deactivatedAt: active ? null : new Date(),
      },
    });
    return { Authorization: `Bearer ${user.token}` };
  }
  async function platformAdmin() {
    const user = verifier.addUser();
    await prisma.platformAdmin.create({
      data: { id: user.id, email: `${user.id}@admin.example.com` },
    });
    platformAdmins.push(user.id);
    return { Authorization: `Bearer ${user.token}` };
  }
  // Dos OWNER activos del mismo negocio: ambos operan turnos y preferencias.
  const owner = await member();
  const coOwner = await member();
  const path = `/api/appointments/${row.id}`;
  const publicPath = '/api/public/appointment-actions';
  async function issue(action: 'CONFIRM' | 'CANCEL' | 'REQUEST_RESCHEDULE') {
    const response = await api.post(`${path}/action-links`).set(owner).send({ action });
    expect(response.status).toBe(200);
    return response.body.token as string;
  }
  return {
    api,
    owner,
    coOwner,
    member,
    platformAdmin,
    row,
    customer,
    path,
    publicPath,
    issue,
    advanceTo: (date: Date) => {
      now = date;
    },
    execute: (token: string, message?: string) =>
      api.post(publicPath).send({ token, confirmed: true, ...(message && { message }) }),
    current: () =>
      prisma.appointment.findUniqueOrThrow({ where: { id: row.id }, include: { events: true } }),
  };
}

it('guarda preferencias por negocio y aplica roles y límites de configuración', async () => {
  const { api, owner, coOwner, member, platformAdmin } = await fixture();
  const other = await prisma.business.create({ data: { name: 'Otro' } });
  businesses.push(other.id);
  const otherOwner = await member(other.id);
  const admin = await platformAdmin();
  const disabledOwner = await member(undefined, false);
  const path = '/api/business/notification-preferences';
  const preferences = {
    bookingEmailEnabled: true,
    confirmationEmailEnabled: true,
    remindersEnabled: true,
    reminderHours: [72, 12, 2],
    reminder24hEnabled: true,
    reminder48hEnabled: true,
    cancellationEmailEnabled: true,
    rescheduleEmailEnabled: true,
    customerCancellationEnabled: false,
    customerConfirmationEnabled: false,
    customerRescheduleEnabled: true,
    cancellationMinimumHours: 12,
    rescheduleMinimumHours: 6,
  };
  // El ADMIN de plataforma y un OWNER desactivado no leen ni configuran, ni inyectando rol.
  for (const [auth, code] of [
    [admin, 'FORBIDDEN'],
    [disabledOwner, 'ACCOUNT_DISABLED'],
  ] as const) {
    const denied = await api
      .patch(path)
      .set(auth)
      .send({ ...preferences, role: 'OWNER' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe(code);
    expect((await api.get(path).set(auth)).status).toBe(403);
  }
  expect((await api.patch(path).set(coOwner).send({ cancellationMinimumHours: -1 })).status).toBe(
    422,
  );
  expect((await api.patch(path).set(coOwner).send({ businessId: other.id })).status).toBe(422);
  const saved = { ...preferences, reminder24hEnabled: false, reminder48hEnabled: false };
  expect((await api.patch(path).set(coOwner).send(preferences)).body).toEqual(saved);
  expect((await api.get(path).set(owner)).body).toEqual(saved);
  expect((await api.get(path).set(otherOwner)).body).toMatchObject({
    bookingEmailEnabled: true,
    remindersEnabled: true,
    reminderHours: [48, 24],
  });
  for (const body of [
    { reminderHours: [2, 2] },
    { reminderHours: [2, 6, 12, 24] },
    { reminderHours: [1] },
    { reminderHours: [2.5] },
    { reminderHours: [] },
    { rescheduleMinimumHours: -1 },
    { rescheduleMinimumHours: 721 },
  ])
    expect((await api.patch(path).set(coOwner).send(body)).status).toBe(422);
  expect((await api.get(path).set(owner)).body).toEqual(saved);
});

it('reconcilia anticipaciones, conserva enviados y cancela los pendientes al deshabilitar', async () => {
  const f = await fixture();
  const path = '/api/business/notification-preferences';
  const update = (body: object) => f.api.patch(path).set(f.coOwner).send(body);
  expect((await update({ remindersEnabled: true, reminderHours: [72, 12, 2] })).status).toBe(200);
  const jobs = await prisma.reminder.findMany({
    where: { appointmentId: f.row.id },
    orderBy: { scheduledAt: 'asc' },
  });
  expect(jobs.map((job) => job.reminderOffsetHours)).toEqual([72, 12, 2]);
  expect(jobs.map((job) => job.scheduledAt.toISOString())).toEqual([
    '2099-01-02T10:00:00.000Z',
    '2099-01-04T22:00:00.000Z',
    '2099-01-05T08:00:00.000Z',
  ]);
  await prisma.reminder.update({
    where: { id: jobs[0]!.id },
    data: { status: 'SENT', sentAt: new Date(), attempts: 1 },
  });
  await Promise.all([update({ reminderHours: [72, 6] }), update({ reminderHours: [72, 6] })]);
  const changed = await prisma.reminder.findMany({ where: { appointmentId: f.row.id } });
  expect(changed).toHaveLength(4);
  expect(changed.find((job) => job.reminderOffsetHours === 72)?.status).toBe('SENT');
  expect(
    changed.filter((job) => job.status === 'PENDING').map((job) => job.reminderOffsetHours),
  ).toEqual([6]);
  expect((await update({ remindersEnabled: false })).status).toBe(200);
  expect(
    await prisma.reminder.count({
      where: { appointmentId: f.row.id, status: 'PENDING' },
    }),
  ).toBe(0);
  expect((await update({ remindersEnabled: true })).status).toBe(200);
  const resumed = await prisma.reminder.findMany({ where: { appointmentId: f.row.id } });
  expect(resumed).toHaveLength(4);
  expect(resumed.find((job) => job.reminderOffsetHours === 72)?.status).toBe('SENT');
  expect(resumed.find((job) => job.reminderOffsetHours === 6)?.status).toBe('PENDING');
  expect((await update({ remindersEnabled: false, reminderHours: [] })).status).toBe(200);
  const emptyEnabled = await update({ remindersEnabled: true });
  expect(emptyEnabled.status).toBe(422);
  expect(emptyEnabled.body.error.details).toEqual([
    { path: 'reminderHours', message: 'Elegí al menos una anticipación.' },
  ]);
});

it('emite enlaces con alcance, verifica firma y registra una sola confirmación concurrente', async () => {
  const f = await fixture();
  const other = await prisma.business.create({ data: { name: 'Otro' } });
  businesses.push(other.id);
  const otherOwner = await f.member(other.id);
  expect(
    (await f.api.post(`${f.path}/action-links`).set(otherOwner).send({ action: 'CONFIRM' })).status,
  ).toBe(404);
  expect((await f.api.get(`${f.path}/reschedule-request`).set(otherOwner)).status).toBe(404);
  const token = await f.issue('CONFIRM');
  expect(await f.issue('CONFIRM')).toBe(token);
  const badToken = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  expect((await f.execute(badToken)).status).toBe(404);
  const preview = await f.api.post(`${f.publicPath}/preview`).send({ token });
  expect(preview.headers['cache-control']).toBe('no-store');
  expect(preview.body).toEqual({
    businessName: 'Negocio',
    serviceName: 'Consulta',
    timezone: 'UTC',
    startsAt: f.row.startsAt.toISOString(),
    action: 'CONFIRM',
    allowed: true,
  });
  expect((await f.current()).events).toHaveLength(0);
  expect(
    (await Promise.all([f.execute(token), f.execute(token)])).map((res) => res.status),
  ).toEqual([204, 204]);
  const stored = await f.current();
  expect(stored).toMatchObject({
    status: 'SCHEDULED',
    confirmationStatus: 'CONFIRMED',
    scheduleVersion: 1,
  });
  expect(stored.events.map((event) => event.type)).toEqual(['CONFIRMED']);
  expect(
    (await f.api.get('/api/appointments?status=CONFIRMED').set(f.owner)).body.items[0],
  ).toMatchObject({
    status: 'CONFIRMED',
    operationalStatus: 'SCHEDULED',
    confirmationStatus: 'CONFIRMED',
  });
  expect((await f.api.get('/api/appointments?status=SCHEDULED').set(f.owner)).body.total).toBe(0);
});

it('exige confirmación explícita y vuelve a evaluar la política de cancelación', async () => {
  const f = await fixture();
  const token = await f.issue('CANCEL');
  const preferences = '/api/business/notification-preferences';
  const preview = () => f.api.post(`${f.publicPath}/preview`).send({ token });
  expect((await f.api.post(f.publicPath).send({ token })).status).toBe(422);
  expect((await preview()).body.allowed).toBe(true);
  await f.api.patch(preferences).set(f.coOwner).send({ cancellationMinimumHours: 25 });
  expect((await f.execute(token)).body.error.code).toBe('APPOINTMENT_CANCELLATION_NOT_ALLOWED');
  await f.api
    .patch(preferences)
    .set(f.coOwner)
    .send({ cancellationMinimumHours: 24, customerCancellationEnabled: false });
  expect((await f.execute(token)).status).toBe(409);
  expect((await f.current()).status).toBe('SCHEDULED');
  await f.api.patch(preferences).set(f.coOwner).send({ customerCancellationEnabled: true });
  expect((await f.execute(token)).status).toBe(204);
  expect((await f.execute(token)).status).toBe(204);
  expect((await preview()).status).toBe(404);
  const current = await f.current();
  expect(current.status).toBe('CANCELLED');
  expect(current.events.map((event) => event.type)).toEqual(['CANCELLED']);
});

it('rechaza enlaces expirados y enlaces cuyo destinatario cambió', async () => {
  const f = await fixture();
  const token = await f.issue('CONFIRM');
  await prisma.customer.update({
    where: { id: f.customer.id },
    data: { email: 'nuevo@example.com' },
  });
  expect((await f.execute(token)).status).toBe(404);
  const replacement = await f.issue('CONFIRM');
  f.advanceTo(f.row.startsAt);
  expect((await f.execute(replacement)).status).toBe(404);
  expect((await f.current()).confirmationStatus).toBe('PENDING');
});

it('rechaza acciones deshabilitadas incluso con enlaces emitidos y respeta el plazo de reprogramación', async () => {
  const f = await fixture();
  const confirm = await f.issue('CONFIRM');
  const cancel = await f.issue('CANCEL');
  const reschedule = await f.issue('REQUEST_RESCHEDULE');
  const preferences = '/api/business/notification-preferences';
  expect(
    (
      await f.api.patch(preferences).set(f.coOwner).send({
        customerConfirmationEnabled: false,
        customerCancellationEnabled: false,
        customerRescheduleEnabled: false,
      })
    ).status,
  ).toBe(200);
  for (const token of [confirm, cancel, reschedule]) {
    expect((await f.api.post(f.publicPath + '/preview').send({ token })).body.allowed).toBe(false);
    expect([403, 409]).toContain((await f.execute(token)).status);
  }
  expect(
    (
      await f.api.post(f.publicPath + '/slots').send({
        token: reschedule,
        date: '2099-01-05',
      })
    ).status,
  ).toBe(403);
  expect((await f.current()).events).toHaveLength(0);
  expect((await f.current()).startsAt).toEqual(f.row.startsAt);
  await f.api.patch(preferences).set(f.coOwner).send({
    customerRescheduleEnabled: true,
    rescheduleMinimumHours: 25,
  });
  expect((await f.execute(reschedule)).status).toBe(403);
  await f.api.patch(preferences).set(f.coOwner).send({ rescheduleMinimumHours: 24 });
  expect((await f.execute(reschedule)).status).toBe(204);
  expect((await f.current()).startsAt).toEqual(f.row.startsAt);
  expect((await f.current()).events.map((event) => event.type)).toEqual(['RESCHEDULE_REQUESTED']);
});

it('conserva la reserva, descarta y aprueba por ID bajo el bloqueo de agenda', async () => {
  const f = await fixture();
  const pending = () => f.api.get(`${f.path}/reschedule-request`).set(f.owner);
  const dismiss = (requestId: string) =>
    f.api.post(`${f.path}/reschedule-request/dismiss`).set(f.owner).send({ requestId });
  const approve = (requestId: string, startsAt: string) =>
    f.api.post(`${f.path}/reschedule-request/approve`).set(f.owner).send({ requestId, startsAt });
  const first = await f.issue('REQUEST_RESCHEDULE');
  expect(
    (await Promise.all([f.execute(first, 'Por la tarde'), f.execute(first, 'Por la tarde')])).map(
      (res) => res.status,
    ),
  ).toEqual([204, 204]);
  const firstId = (await pending()).body.id as string;
  expect((await pending()).body.message).toBe('Por la tarde');
  const feed = '/api/notifications';
  expect((await f.api.get(feed).set(f.owner)).body.unreadCount).toBe(0);
  const notices = await f.api.get(feed + '?includeRequests=true').set(f.owner);
  expect(notices.body).toMatchObject({
    items: [{ kind: 'RESCHEDULE_REQUESTED', appointmentId: f.row.id }],
    unreadCount: 1,
  });
  expect(
    (
      await f.api
        .patch(`${feed}/${notices.body.items[0].id}/read?includeRequests=true`)
        .set(f.owner)
    ).body.unreadCount,
  ).toBe(0);
  expect((await f.current()).startsAt).toEqual(f.row.startsAt);
  expect((await approve(randomUUID(), '2099-01-05T14:00:00Z')).status).toBe(409);
  expect((await dismiss(firstId)).status).toBe(204);
  expect((await dismiss(firstId)).status).toBe(204);
  expect((await f.execute(first)).status).toBe(204);
  expect((await pending()).body).toBeNull();
  const move = await f.api
    .post(`${f.path}/reschedule`)
    .set(f.owner)
    .send({ startsAt: '2099-01-05T12:00:00Z' });
  expect(move.status).toBe(200);
  expect((await f.execute(first)).status).toBe(404);
  const second = await f.issue('REQUEST_RESCHEDULE');
  const slotLookup = f.api
    .post(`${f.publicPath}/slots`)
    .send({ token: second, date: '2099-01-05' });
  const slots = await slotLookup;
  expect(slots.status).toBe(200);
  expect(slots.body.data).toContainEqual({
    startsAt: '2099-01-05T14:00:00.000Z',
    endsAt: '2099-01-05T15:00:00.000Z',
  });
  expect(
    slots.body.data.some(
      (slot: { startsAt: string }) => slot.startsAt === '2099-01-05T12:00:00.000Z',
    ),
  ).toBe(false);
  const propose = (requestedStartsAt: string) =>
    f.api.post(f.publicPath).send({ token: second, confirmed: true, requestedStartsAt });
  expect((await propose('2099-01-05T14:07:00Z')).status).toBe(409);
  expect((await propose('2099-01-05T14:00:00Z')).status).toBe(204);
  expect((await pending()).body.requestedStartsAt).toBe('2099-01-05T14:00:00.000Z');
  expect(
    (await f.api.get('/api/appointments').set(f.owner)).body.items[0].rescheduleRequested,
  ).toBe(true);
  const secondId = (await pending()).body.id as string;
  expect((await approve(secondId, '2099-01-05T12:00:00Z')).status).toBe(409);
  expect((await approve(secondId, '2099-01-05T19:00:00Z')).status).toBe(409);
  expect((await pending()).body.id).toBe(secondId);
  const results = await Promise.all([
    approve(secondId, '2099-01-05T14:00:00Z'),
    approve(secondId, '2099-01-05T14:00:00Z'),
  ]);
  expect(results.map((res) => res.status)).toEqual([200, 200]);
  expect((await pending()).body).toBeNull();
  expect(
    (await f.api.get('/api/appointments').set(f.owner)).body.items[0].rescheduleRequested,
  ).toBe(false);
  const current = await f.current();
  expect(current.startsAt.toISOString()).toBe('2099-01-05T14:00:00.000Z');
  expect(current.scheduleVersion).toBe(3);
  expect(current.events.filter((event) => event.type === 'RESCHEDULE_REQUESTED')).toHaveLength(2);
  expect(
    current.events.filter((event) => event.type === 'RESCHEDULE_REQUEST_DISMISSED'),
  ).toHaveLength(1);
  expect(current.events.filter((event) => event.type === 'RESCHEDULED')).toHaveLength(2);
  const history = await f.api.get(`${f.path}/events?includeRequests=true`).set(f.owner);
  expect(history.body).toHaveLength(5);
  expect((await f.api.get(`${f.path}/events`).set(f.owner)).body).toHaveLength(2);
});
