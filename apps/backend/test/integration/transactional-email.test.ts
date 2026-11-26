import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { PrismaAppointmentRepository } from '../../src/modules/appointments/repository.js';
import { AppointmentActionLinks } from '../../src/modules/appointments/action-links.js';
import { PrismaAvailabilityRepository } from '../../src/modules/availability/repository.js';
import { PrismaIdentityRepository } from '../../src/modules/identity/repository.js';
import { PrismaSlotsRepository } from '../../src/modules/slots/repository.js';
import { AppointmentEmailDispatcher } from '../../src/modules/notifications/email-dispatcher.js';
import {
  EmailDeliveryError,
  type EmailProvider,
} from '../../src/modules/notifications/email-provider.js';
import { scheduleAppointmentReminders } from '../../src/modules/notifications/reminder-schedule.js';
import { emailProcessing } from '../../src/modules/notifications/email-processing.js';
import { buildTestApp } from '../fakes.js';

const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Estas pruebas requieren PostgreSQL local descartable');
}
const prisma = new PrismaClient({ datasourceUrl: url });
const businesses: string[] = [];
afterEach(async () => {
  await prisma.business.deleteMany({ where: { id: { in: businesses.splice(0) } } });
});
afterAll(() => prisma.$disconnect());

async function fixture({
  enabled = true,
  email = 'client@example.com' as string | null,
  reminder48hEnabled = false,
  reminder24hEnabled = false,
  immediate = false,
  providerFails = false,
} = {}) {
  const secret = 'ba'.repeat(32);
  const appointments = new PrismaAppointmentRepository(prisma);
  let processor: ReturnType<typeof emailProcessing> | undefined;
  const { app, verifier } = buildTestApp({
    appointments,
    identity: new PrismaIdentityRepository(prisma),
    slots: new PrismaSlotsRepository(prisma),
    availability: new PrismaAvailabilityRepository(prisma),
    appointmentActionLinks: new AppointmentActionLinks(prisma, secret),
    ...(immediate && { requestEmailProcessing: () => processor!.request() }),
  });
  const business = await prisma.business.create({
    data: {
      name: 'Consultorio Sur',
      timezone: 'America/Argentina/Buenos_Aires',
      bookingEmailEnabled: enabled,
      confirmationEmailEnabled: enabled,
      cancellationEmailEnabled: enabled,
      rescheduleEmailEnabled: enabled,
      reminder48hEnabled,
      reminder24hEnabled,
      remindersEnabled: reminder48hEnabled || reminder24hEnabled,
      reminderHours: [...(reminder48hEnabled ? [48] : []), ...(reminder24hEnabled ? [24] : [])],
    },
  });
  businesses.push(business.id);
  const businessId = business.id;
  const user = verifier.addUser();
  await prisma.profile.create({
    data: { id: user.id, email: 'owner@example.com', businessId, role: 'OWNER' },
  });
  const customer = await prisma.customer.create({ data: { businessId, fullName: 'Ana', email } });
  const service = await prisma.service.create({
    data: { businessId, name: 'Consulta', durationMinutes: 30 },
  });
  await new PrismaAvailabilityRepository(prisma).replace(businessId, [
    { dayOfWeek: 1, startTime: '09:00', endTime: '18:00', active: true },
  ]);
  const api = request(app);
  const auth = { Authorization: `Bearer ${user.token}` };
  const send = vi.fn<EmailProvider['send']>().mockResolvedValue({ id: 'fake-provider-id' });
  if (providerFails) send.mockRejectedValueOnce(new EmailDeliveryError('TEMPORARY', true));
  let clockOffset = 0;
  const options = {
    from: 'TurnoSmart <turnos@example.com>',
    actionsUrl: 'https://turnos.example.com/turno/gestionar',
    actionSecret: secret,
  };
  const worker = () =>
    new AppointmentEmailDispatcher(
      prisma,
      { name: 'fake', send },
      options,
      () => new Date(Date.now() + clockOffset),
    );
  if (immediate) processor = emailProcessing(() => worker().drain());
  const create = await api.post('/api/appointments').set(auth).send({
    customerId: customer.id,
    serviceId: service.id,
    startsAt: '2099-01-05T13:00:00Z',
  });
  expect(create.status).toBe(201);
  const id = create.body.id as string;
  return {
    id,
    api,
    auth,
    customer,
    serviceId: service.id,
    businessId,
    send,
    worker,
    processor,
    path: `/api/appointments/${id}`,
    jobs: () =>
      prisma.reminder.findMany({ where: { appointmentId: id }, orderBy: { createdAt: 'asc' } }),
    advance: (ms: number) => {
      clockOffset += ms;
    },
    runAt: (date: Date) => {
      clockOffset = date.getTime() - Date.now();
    },
  };
}

it('encola la reserva y envía una sola vez con enlaces válidos aunque haya dos procesadores', async () => {
  const f = await fixture();
  expect(await f.jobs()).toMatchObject([{ emailKind: 'BOOKED', status: 'PENDING', attempts: 0 }]);
  await Promise.all([f.worker().drain(), f.worker().drain()]);
  expect(f.send).toHaveBeenCalledTimes(1);
  const [message] = f.send.mock.calls[0]!;
  expect(message.text).toContain('Hora: 10:00');
  expect(message.text).toContain('Consultorio Sur');
  expect(message.text).toContain('Cliente: Ana');
  const links = [
    ...message.html.matchAll(
      /href="https:\/\/turnos\.example\.com\/turno\/gestionar#token=([^"]+)"/g,
    ),
  ];
  expect(links).toHaveLength(3);
  const previews = await Promise.all(
    links.map((link) =>
      f.api.post('/api/public/appointment-actions/preview').send({ token: link[1] }),
    ),
  );
  expect(previews.map((res) => res.body.action)).toEqual([
    'CONFIRM',
    'REQUEST_RESCHEDULE',
    'CANCEL',
  ]);
  expect(await f.jobs()).toMatchObject([
    { status: 'SENT', attempts: 1, providerId: 'fake-provider-id' },
  ]);
});

it('dispara el correo tras commit sin Cron y responde aunque el proveedor siga pendiente', async () => {
  const f = await fixture({ immediate: true });
  try {
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect((await f.jobs())[0]?.status).toBe('SENT'));
    let release!: () => void;
    f.send.mockImplementationOnce(async () => {
      // The provider observes the committed appointment and outbox through another connection.
      expect(await prisma.appointment.count({ where: { businessId: f.businessId } })).toBe(2);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { id: 'second-email' };
    });
    const created = await f.api.post('/api/appointments').set(f.auth).send({
      customerId: f.customer.id,
      serviceId: f.serviceId,
      startsAt: '2099-01-05T14:00:00Z',
    });
    expect(created.status).toBe(201);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const queued = await prisma.reminder.findFirst({
      where: { appointmentId: created.body.id, emailKind: 'BOOKED' },
    });
    expect(queued).toMatchObject({ status: 'PENDING', attempts: 1 });
    release();
  } finally {
    await f.processor!.close();
  }
});

it('conserva la reserva ante fallo del envío inmediato y recupera con la misma clave', async () => {
  const f = await fixture({ immediate: true, providerFails: true });
  try {
    await vi.waitFor(async () =>
      expect((await f.jobs())[0]).toMatchObject({
        status: 'PENDING',
        attempts: 1,
        errorMessage: 'TEMPORARY',
      }),
    );
    expect((await f.api.get(f.path).set(f.auth)).body.status).toBe('SCHEDULED');
    f.advance(61_000);
    f.processor!.request();
    await vi.waitFor(async () => expect((await f.jobs())[0]?.status).toBe('SENT'));
    expect(f.send.mock.calls[0]).toEqual(f.send.mock.calls[1]);
  } finally {
    await f.processor!.close();
  }
});

it('mantiene el turno ante un fallo, registra el intento y reusa la clave y el mensaje', async () => {
  const f = await fixture();
  f.send.mockRejectedValueOnce(new EmailDeliveryError('TEMPORARY', true));
  await f.worker().drain();
  expect(await f.jobs()).toMatchObject([
    { status: 'PENDING', attempts: 1, errorMessage: 'TEMPORARY' },
  ]);
  expect((await f.api.get(f.path).set(f.auth)).body.status).toBe('SCHEDULED');
  await f.worker().drain();
  expect(f.send).toHaveBeenCalledTimes(1);
  f.advance(61_000);
  await f.worker().drain();
  expect(f.send.mock.calls[0]).toEqual(f.send.mock.calls[1]);
  expect(await f.jobs()).toMatchObject([{ status: 'SENT', attempts: 2, errorMessage: null }]);
});

it('envía ambos recordatorios al vencer, confirma desde el correo y libera el slot al cancelar', async () => {
  const f = await fixture({ reminder48hEnabled: true, reminder24hEnabled: true });
  const path = '/api/public/appointment-actions';
  await f.worker().drain();
  expect(f.send).toHaveBeenCalledTimes(1);
  f.runAt(new Date('2099-01-03T13:00:01Z'));
  await f.worker().drain();
  expect(f.send).toHaveBeenCalledTimes(2);
  f.runAt(new Date('2099-01-04T13:00:01Z'));
  await f.worker().drain();
  expect(f.send).toHaveBeenCalledTimes(3);
  const [confirm, , cancel] = [...f.send.mock.calls[2]![0].html.matchAll(/#token=([^"]+)"/g)].map(
    (match) => match[1],
  );
  const slots = async () => {
    const result = await f.api.get('/api/slots').set(f.auth).query({
      date: '2099-01-05',
      serviceId: f.serviceId,
    });
    expect(result.status).toBe(200);
    return result.body.data as { startsAt: string }[];
  };
  const originalStart = '2099-01-05T13:00:00.000Z';
  expect((await slots()).some((slot) => slot.startsAt === originalStart)).toBe(false);
  // Scanners can load a link or run the preview, neither changes the appointment.
  expect((await f.api.get(path).query({ token: cancel })).status).toBe(404);
  expect((await f.api.head(path).query({ token: cancel })).status).toBe(404);
  expect((await f.api.post(path + '/preview').send({ token: cancel })).status).toBe(200);
  expect((await f.api.get(f.path).set(f.auth)).body.status).toBe('SCHEDULED');
  expect((await f.api.post(path).send({ token: confirm, confirmed: true })).status).toBe(204);
  expect((await f.api.get(f.path).set(f.auth)).body).toMatchObject({
    status: 'CONFIRMED',
    operationalStatus: 'SCHEDULED',
    confirmationStatus: 'CONFIRMED',
  });
  const cancellations = await Promise.all([
    f.api.post(path).send({ token: cancel, confirmed: true }),
    f.api.post(path).send({ token: cancel, confirmed: true }),
  ]);
  expect(cancellations.map(({ status }) => status)).toEqual([204, 204]);
  expect((await slots()).some((slot) => slot.startsAt === originalStart)).toBe(true);
  await f.worker().drain();
  const jobs = await f.jobs();
  expect(jobs).toHaveLength(5);
  expect(Object.fromEntries(jobs.map(({ emailKind, status }) => [emailKind, status]))).toEqual({
    BOOKED: 'SENT',
    REMINDER_48H: 'SENT',
    REMINDER_24H: 'SENT',
    CONFIRMED: 'CANCELLED',
    CANCELLED: 'SENT',
  });
  expect(f.send).toHaveBeenCalledTimes(4);
});

it('envía confirmación, resultado de cambio y cancelación con sus preferencias', async () => {
  const f = await fixture();
  await f.worker().drain();
  expect((await f.api.post(f.path + '/confirm').set(f.auth)).status).toBe(200);
  await f.worker().drain();
  expect(
    (
      await f.api
        .post(f.path + '/reschedule')
        .set(f.auth)
        .send({ startsAt: '2099-01-05T14:00:00Z' })
    ).status,
  ).toBe(200);
  await f.worker().drain();
  expect((await f.api.post(f.path + '/cancel').set(f.auth)).status).toBe(200);
  await f.worker().drain();
  expect((await f.jobs()).map(({ emailKind, status }) => [emailKind, status])).toEqual([
    ['BOOKED', 'SENT'],
    ['CONFIRMED', 'SENT'],
    ['RESCHEDULED', 'SENT'],
    ['CANCELLED', 'SENT'],
  ]);
  expect(f.send.mock.calls[2]?.[0].text).toContain('Horario anterior:');
  expect(f.send.mock.calls[3]?.[0].html).not.toContain('#token=');
});

it('omite la cola sin preferencia o destinatario y descarta un destinatario que cambió', async () => {
  expect(await (await fixture({ enabled: false })).jobs()).toEqual([]);
  expect(await (await fixture({ email: null })).jobs()).toEqual([]);
  const f = await fixture();
  await prisma.customer.update({
    where: { id: f.customer.id },
    data: { email: 'other@example.com' },
  });
  await f.worker().drain();
  expect(f.send).not.toHaveBeenCalled();
  expect(await f.jobs()).toMatchObject([{ status: 'CANCELLED', attempts: 0 }]);
});

it('deja un resultado incierto para revisión cuando vence la ventana de reintentos', async () => {
  const f = await fixture();
  f.send.mockRejectedValueOnce(new EmailDeliveryError('TIMEOUT', true));
  await f.worker().drain();
  f.advance(24 * 3_600_000);
  await f.worker().drain();
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(await f.jobs()).toMatchObject([
    { status: 'FAILED', attempts: 1, errorMessage: 'EMAIL_RETRY_LIMIT' },
  ]);
});

it('avisa cuando se rechaza un cambio y conserva la reserva original', async () => {
  const f = await fixture();
  await f.worker().drain();
  const issued = await f.api
    .post(f.path + '/action-links')
    .set(f.auth)
    .send({ action: 'REQUEST_RESCHEDULE' });
  expect(issued.status).toBe(200);
  expect(
    (
      await f.api.post('/api/public/appointment-actions').send({
        token: issued.body.token,
        confirmed: true,
      })
    ).status,
  ).toBe(204);
  const pending = await f.api.get(f.path + '/reschedule-request').set(f.auth);
  expect(
    (
      await f.api
        .post(f.path + '/reschedule-request/dismiss')
        .set(f.auth)
        .send({
          requestId: pending.body.id,
        })
    ).status,
  ).toBe(204);
  await f.worker().drain();
  expect(await f.jobs()).toMatchObject([
    { emailKind: 'BOOKED', status: 'SENT' },
    { emailKind: 'RESCHEDULE_DECLINED', status: 'SENT' },
  ]);
  expect(f.send.mock.calls[1]?.[0].text).toContain('reserva original sigue vigente');
  expect((await f.api.get(f.path).set(f.auth)).body.startsAt).toBe('2099-01-05T13:00:00.000Z');
});

it('programa 48 h y 24 h exactas y deduplica al repetir la programación', async () => {
  const f = await fixture({ enabled: false, reminder48hEnabled: true, reminder24hEnabled: true });
  const jobs = await f.jobs();
  expect(
    jobs.map(({ emailKind, scheduledAt }) => [emailKind, scheduledAt.toISOString()]).sort(),
  ).toEqual([
    ['REMINDER_24H', '2099-01-04T13:00:00.000Z'],
    ['REMINDER_48H', '2099-01-03T13:00:00.000Z'],
  ]);
  await prisma.$transaction((tx) =>
    scheduleAppointmentReminders(tx, f.businessId, f.id, new Date()),
  );
  expect((await f.jobs()).map(({ id }) => id).sort()).toEqual(jobs.map(({ id }) => id).sort());
});

it('descuenta horas reales incluso al cruzar el cambio de horario de verano', async () => {
  const f = await fixture({ enabled: false, reminder48hEnabled: true, reminder24hEnabled: true });
  const startsAt = new Date('2099-03-09T13:00:00Z');
  await prisma.$transaction(async (tx) => {
    await tx.reminder.deleteMany({ where: { appointmentId: f.id } });
    await tx.business.update({
      where: { id: f.businessId },
      data: { timezone: 'America/New_York' },
    });
    await tx.appointment.update({
      where: { id: f.id },
      data: { startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000) },
    });
    await tx.$executeRaw`SET LOCAL TIME ZONE 'America/New_York'`;
    await scheduleAppointmentReminders(tx, f.businessId, f.id, new Date());
  });
  expect((await f.jobs()).map((job) => job.scheduledAt.toISOString()).sort()).toEqual([
    '2099-03-07T13:00:00.000Z',
    '2099-03-08T13:00:00.000Z',
  ]);
});

it('no programa plazos vencidos y aplica cambios de preferencias a reservas existentes', async () => {
  const f = await fixture({ enabled: false, reminder48hEnabled: true });
  const patch = (body: object) =>
    f.api.patch('/api/business/notification-preferences').set(f.auth).send(body);
  expect((await f.jobs()).map((job) => job.emailKind)).toEqual(['REMINDER_48H']);
  expect((await patch({ reminder48hEnabled: false, reminder24hEnabled: true })).status).toBe(200);
  expect(await f.jobs()).toMatchObject([
    { emailKind: 'REMINDER_48H', status: 'CANCELLED' },
    { emailKind: 'REMINDER_24H', status: 'PENDING' },
  ]);
  expect((await patch({ reminder48hEnabled: true })).status).toBe(200);
  expect((await f.jobs()).every((job) => job.status === 'PENDING')).toBe(true);
  await prisma.reminder.deleteMany({ where: { appointmentId: f.id } });
  await prisma.$transaction((tx) =>
    scheduleAppointmentReminders(tx, f.businessId, f.id, new Date('2099-01-03T14:00:00Z')),
  );
  expect(await f.jobs()).toMatchObject([{ emailKind: 'REMINDER_24H' }]);
});

it('reintenta un recordatorio sin duplicar el envío y genera tres acciones firmadas', async () => {
  const f = await fixture({ enabled: false, reminder48hEnabled: true });
  await f.worker().drain();
  expect(f.send).not.toHaveBeenCalled();
  f.runAt(new Date('2099-01-03T13:00:01Z'));
  f.send.mockRejectedValueOnce(new EmailDeliveryError('RETRY', true));
  await Promise.all([f.worker().drain(), f.worker().drain()]);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(await f.jobs()).toMatchObject([{ status: 'PENDING', attempts: 1, errorMessage: 'RETRY' }]);
  f.advance(61_000);
  await Promise.all([f.worker().drain(), f.worker().drain()]);
  expect(f.send).toHaveBeenCalledTimes(2);
  expect(f.send.mock.calls[0]).toEqual(f.send.mock.calls[1]);
  expect(f.send.mock.calls[1]?.[0].text).toContain('Hora: 10:00');
  expect(await f.jobs()).toMatchObject([{ status: 'SENT', attempts: 2 }]);
  const links = [...f.send.mock.calls[1]![0].html.matchAll(/#token=([^"]+)"/g)];
  const previews = await Promise.all(
    links.map((link) =>
      f.api.post('/api/public/appointment-actions/preview').send({ token: link[1] }),
    ),
  );
  expect(previews.map((res) => res.body.action)).toEqual([
    'CONFIRM',
    'REQUEST_RESCHEDULE',
    'CANCEL',
  ]);
});

it('reemplaza recordatorios al mover el turno y los invalida al cancelar o finalizar', async () => {
  const f = await fixture({ enabled: false, reminder24hEnabled: true });
  expect(
    (
      await f.api
        .post(f.path + '/reschedule')
        .set(f.auth)
        .send({
          startsAt: '2099-01-05T14:00:00Z',
        })
    ).status,
  ).toBe(200);
  expect(await f.jobs()).toMatchObject([
    { status: 'CANCELLED', scheduleVersion: 1 },
    { status: 'PENDING', scheduleVersion: 2, scheduledAt: new Date('2099-01-04T14:00:00Z') },
  ]);
  expect((await f.api.post(f.path + '/cancel').set(f.auth)).status).toBe(200);
  expect((await f.jobs()).every((job) => job.status === 'CANCELLED')).toBe(true);
  f.runAt(new Date('2099-01-04T15:00:00Z'));
  await f.worker().drain();
  expect(f.send).not.toHaveBeenCalled();
  const finished = await fixture({ enabled: false, reminder24hEnabled: true });
  await prisma.appointment.update({ where: { id: finished.id }, data: { status: 'COMPLETED' } });
  finished.runAt(new Date('2099-01-04T15:00:00Z'));
  await finished.worker().drain();
  expect(finished.send).not.toHaveBeenCalled();
  expect(await finished.jobs()).toMatchObject([{ status: 'CANCELLED', attempts: 0 }]);
});

it('invalida el enlace emitido en el recordatorio cuando se aprueba el cambio', async () => {
  const f = await fixture({ reminder48hEnabled: true, reminder24hEnabled: true });
  const publicPath = '/api/public/appointment-actions';
  const requestPath = f.path + '/reschedule-request';
  f.runAt(new Date('2099-01-03T13:00:01Z'));
  await f.worker().drain();
  const reminder = f.send.mock.calls.find(
    ([message]) => message.subject === 'Recordatorio de tu turno',
  )![0];
  const [confirm, reschedule] = [...reminder.html.matchAll(/#token=([^"]+)"/g)].map(
    (match) => match[1],
  );
  const proposed = '2099-01-05T14:00:00.000Z';
  expect(
    (
      await f.api
        .post(publicPath)
        .send({ token: reschedule, confirmed: true, requestedStartsAt: proposed })
    ).status,
  ).toBe(204);
  const pending = await f.api.get(requestPath).set(f.auth);
  expect(pending.body.requestedStartsAt).toBe(proposed);
  const approved = await f.api
    .post(requestPath + '/approve')
    .set(f.auth)
    .send({ requestId: pending.body.id, startsAt: proposed });
  expect(approved.status).toBe(200);
  expect(approved.body.startsAt).toBe(proposed);
  expect((await f.api.post(publicPath).send({ token: confirm, confirmed: true })).status).toBe(404);
  expect(await f.jobs()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ emailKind: 'REMINDER_48H', status: 'SENT', scheduleVersion: 1 }),
      expect.objectContaining({
        emailKind: 'REMINDER_24H',
        status: 'CANCELLED',
        scheduleVersion: 1,
      }),
      expect.objectContaining({ emailKind: 'REMINDER_48H', status: 'PENDING', scheduleVersion: 2 }),
      expect.objectContaining({ emailKind: 'REMINDER_24H', status: 'PENDING', scheduleVersion: 2 }),
    ]),
  );
});
