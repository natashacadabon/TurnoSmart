import { expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import request from 'supertest';
import { buildTestApp } from '../fakes.js';
import {
  ConsoleEmailProvider,
  ResendEmailProvider,
} from '../../src/modules/notifications/email-provider.js';
import { renderAppointmentEmail } from '../../src/modules/notifications/email-templates.js';

const details = {
  business: 'Estudio <Sur>',
  customer: 'Ana & Bea',
  service: 'Consulta',
  startsAt: '2099-01-05T01:15:00.000Z',
  timezone: 'America/Argentina/Buenos_Aires',
  professional: 'Dra. Silva',
};
const message = {
  from: 'TurnoSmart <turnos@example.com>',
  to: 'cliente@example.com',
  ...renderAppointmentEmail('BOOKED', details),
};

it('renderiza una plantilla móvil, con fecha local y datos escapados', () => {
  expect(message.html).toContain('width=device-width');
  expect(message.html).toContain('@media');
  expect(message.html).toContain('Estudio &lt;Sur&gt;');
  expect(message.html).toContain('Ana &amp; Bea');
  expect(message.html).toContain('Dra. Silva');
  expect(message.text).toContain('4 de enero de 2099');
  expect(message.text).toContain('22:15');
  expect(message.text).toContain('Buenos Aires (UTC-03:00)');
  expect(message.html).not.toContain('America/Argentina/Buenos_Aires');
});

it.each([
  'BOOKED',
  'CONFIRMED',
  'CANCELLED',
  'RESCHEDULED',
  'RESCHEDULE_DECLINED',
  'REMINDER_24H',
  'REMINDER_48H',
  'REMINDER',
] as const)('mantiene el diseño compartido de %s y el orden de las acciones recibidas', (kind) => {
  const links = [
    { label: 'Cancelar turno', url: 'https://example.test/turno#token=cancel' },
    { label: 'Solicitar reprogramación', url: 'https://example.test/turno#token=reschedule' },
    { label: 'Confirmar asistencia', url: 'https://example.test/turno#token=confirm' },
  ];
  const rendered = renderAppointmentEmail(kind, details, links);
  expect(rendered.html.indexOf('Confirmar asistencia')).toBeLessThan(
    rendered.html.indexOf('Solicitar reprogramación'),
  );
  expect(rendered.html.indexOf('Solicitar reprogramación')).toBeLessThan(
    rendered.html.indexOf('Cancelar turno'),
  );
  expect(rendered.html.match(/class="action"/g)).toHaveLength(3);
  expect(rendered.html).toContain('background-color:#15803D');
  expect(rendered.html).toContain('border:1px solid #2563EB');
  expect(rendered.html).toContain('border:1px solid #DC2626');
  expect(rendered.html).toContain('background-color:#F8FAFC');
  expect(rendered.html).toContain('Enviado con');
  expect(rendered.html).not.toMatch(/display:\s*(?:flex|grid)|<script|@import/);
  for (const link of links) expect(rendered.html).toContain(`href="${link.url}"`);
  expect(links[0]?.label).toBe('Cancelar turno');
});

it('no agrega acciones que el negocio no habilitó y conserva el escape de los enlaces', () => {
  const html = renderAppointmentEmail('BOOKED', details, [
    { label: 'Cancelar turno', url: 'https://example.test/?a=1&b="2"#token=cancel' },
  ]).html;
  expect(html.match(/class="action"/g)).toHaveLength(1);
  expect(html).not.toContain('Confirmar asistencia');
  expect(html).not.toContain('Solicitar reprogramación');
  expect(html).toContain('href="https://example.test/?a=1&amp;b=&quot;2&quot;#token=cancel"');
  expect(renderAppointmentEmail('CANCELLED', details).html).not.toContain('class="action"');
});

it('distingue la confirmación, cancelación y resultados de reprogramación', () => {
  expect(renderAppointmentEmail('CONFIRMED', details).subject).toContain('confirmada');
  expect(renderAppointmentEmail('CANCELLED', details).subject).toContain('cancelado');
  const updated = renderAppointmentEmail('RESCHEDULED', {
    ...details,
    previousStartsAt: '2099-01-04T23:15:00.000Z',
  });
  expect(updated.text).toContain('Horario anterior:');
  expect(updated.text).toContain('20:15');
  expect(renderAppointmentEmail('RESCHEDULE_DECLINED', details).text).toContain('reserva original');
});

it('envía por HTTPS con clave estable y clasifica errores sin exponer el cuerpo', async () => {
  const id = '0f0fb7f1-6ef1-4a17-92c3-a8cc393e2c15';
  const network = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id }))
    .mockResolvedValueOnce(Response.json({ message: 'dato privado' }, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ message: 'dato privado' }, { status: 422 }));
  const provider = new ResendEmailProvider('fake-key', network);
  await expect(provider.send(message, 'job-1')).resolves.toEqual({ id });
  expect(network.mock.calls[0]?.[0]).toBe('https://api.resend.com/emails');
  expect(network.mock.calls[0]?.[1]?.headers).toMatchObject({ 'Idempotency-Key': 'job-1' });
  expect(JSON.parse(String(network.mock.calls[0]?.[1]?.body))).toMatchObject({
    html: message.html,
    subject: message.subject,
  });
  await expect(provider.send(message, 'job-2')).rejects.toMatchObject({
    code: 'RESEND_HTTP_429',
    retryable: true,
  });
  await expect(provider.send(message, 'job-3')).rejects.toMatchObject({
    code: 'RESEND_HTTP_422',
    retryable: false,
  });
});

it('simula envíos sin credenciales y valida la configuración de Resend', async () => {
  await expect(new ConsoleEmailProvider().send(message, 'test')).resolves.toEqual({
    id: 'console:test',
  });
  const base = {
    SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_ANON_KEY: 'test',
    DATABASE_URL: 'test',
  };
  expect(loadEnv(base).EMAIL_PROVIDER).toBe('disabled');
  expect(() => loadEnv({ ...base, EMAIL_PROVIDER: 'resend' })).toThrow('RESEND_API_KEY');
  const config = {
    ...base,
    APPOINTMENT_ACTION_SECRET: 'ba'.repeat(32),
    EMAIL_FROM: message.from,
    APPOINTMENT_ACTIONS_URL: 'http://localhost:3000/turno/gestionar',
  };
  expect(loadEnv({ ...config, EMAIL_PROVIDER: 'console' }).EMAIL_PROVIDER).toBe('console');
  const resend = { ...config, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'fake' };
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const local = { ...resend, APPOINTMENT_ACTIONS_URL: `http://${host}:3001/turno/gestionar` };
    expect(loadEnv(local).EMAIL_PROVIDER).toBe('resend');
    expect(loadEnv({ ...local, NODE_ENV: 'test' }).EMAIL_PROVIDER).toBe('resend');
    expect(() => loadEnv({ ...local, NODE_ENV: 'production' })).toThrow('HTTPS');
  }
  for (const host of ['example.com', 'localhost.example.com', '192.168.1.10']) {
    expect(() =>
      loadEnv({ ...resend, APPOINTMENT_ACTIONS_URL: `http://${host}/turno/gestionar` }),
    ).toThrow('HTTPS');
  }
  expect(
    loadEnv({
      ...resend,
      NODE_ENV: 'production',
      APPOINTMENT_ACTIONS_URL: 'https://turnos.example.com/turno/gestionar',
    }).EMAIL_PROVIDER,
  ).toBe('resend');
});
it('solo permite disparar el procesador con la credencial del cron', async () => {
  const run = vi.fn();
  const secret = 'ab'.repeat(32);
  const { app } = buildTestApp({ emailCron: { secret, run } });
  expect((await request(app).post('/internal/email-jobs')).status).toBe(401);
  expect(
    (
      await request(app)
        .post('/internal/email-jobs')
        .set('Authorization', 'Bearer ' + 'bc'.repeat(32))
    ).status,
  ).toBe(401);
  expect(
    (
      await request(app)
        .post('/internal/email-jobs')
        .set('Authorization', 'Bearer ' + secret)
    ).status,
  ).toBe(202);
  expect(run).toHaveBeenCalledTimes(1);
});
