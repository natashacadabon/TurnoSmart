import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import type {
  AppointmentDto,
  AppointmentEventDto,
  AvailabilityRuleInput,
  CreateAppointmentRequest,
  CustomerDto,
  NotificationDto,
  ServiceDto,
} from '@turnosmart/shared';
import { APPOINTMENT_STATUSES } from '@turnosmart/shared';
import {
  agendaReminders,
  canApplyReminderAction,
  reminderActions,
  reminderKey,
  type ReminderAction,
} from '../src/lib/agenda-reminders';
import {
  agendaHours,
  agendaTodayPosition,
  appointmentStates,
  businessDayRange,
  canSelectAgendaTime,
} from '../src/lib/agenda';

test.use({ timezoneId: 'America/Los_Angeles' });

const date = '2099-01-05';
const now = date + 'T12:00:00.000Z';
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const timestamps = { createdAt: now, updatedAt: now };
const customer: CustomerDto = {
  id: id(1),
  fullName: 'María Pérez',
  email: null,
  phone: null,
  notes: null,
  ...timestamps,
};
const service: ServiceDto = {
  id: id(2),
  name: 'Consulta',
  durationMinutes: 30,
  active: true,
  description: null,
  priceCents: null,
  ...timestamps,
};
const first = { startsAt: date + 'T13:00:00.000Z', endsAt: date + 'T13:30:00.000Z' };
const second = { startsAt: date + 'T14:00:00.000Z', endsAt: date + 'T14:30:00.000Z' };
const weekdays: AvailabilityRuleInput[] = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: '09:00',
  endTime: '18:00',
  active: true,
}));
const timezone = 'America/Argentina/Buenos_Aires';

function respond(route: Route, json: object, status = 200) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, apikey, x-client-info, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  };
  return route.request().method() === 'OPTIONS' || status === 204
    ? route.fulfill({ status: 204, headers })
    : route.fulfill({ status, json, headers });
}

async function openAgenda(
  page: Page,
  conflict = false,
  initialAppointments: AppointmentDto[] = [],
  options: {
    instant?: string;
    rules?: AvailabilityRuleInput[];
    rejectFirstTransition?: boolean;
    failMetrics?: boolean;
  } = {},
) {
  const instant = options.instant ?? now;
  await page.clock.setFixedTime(new Date(instant));
  const email = 'booking-ui@turnosmart.test';
  const user = {
    id: id(3),
    email,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: now,
  };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ sub: user.id, role: 'authenticated', exp: Date.parse(instant) / 1000 + 3600 }),
    'ui-fixture',
  ].join('.');
  await page.route(/\/auth\/v1\/(token|user)(\?.*)?$/, (route) =>
    respond(
      route,
      route.request().url().includes('/token')
        ? {
            access_token: token,
            refresh_token: 'ui-fixture',
            expires_in: 3600,
            token_type: 'bearer',
            user,
          }
        : user,
    ),
  );
  const writes: CreateAppointmentRequest[] = [];
  const appointments = [...initialAppointments];
  const notifications: NotificationDto[] = [];
  let failNotificationList = false;
  const transitions: string[] = [];
  const riskCalls: string[] = [];
  let rules = options.rules ?? weekdays;
  const customers = [customer];
  const slotDates: string[] = [];
  let bookedByAnother = false;
  await page.route(/\/api\/notifications(?:\/[^?]+)?(\?.*)?$/, async (route) => {
    if (route.request().method() === 'OPTIONS') return respond(route, {});
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/sync-upcoming')) {
      const current = await page.evaluate(() => Date.now());
      const due = agendaReminders(appointments, current, timezone, {}).queue;
      return respond(route, {
        items: due.map(({ appointment }) => {
          const previous = notifications.find(
            (item) =>
              item.kind === 'APPOINTMENT_UPCOMING' &&
              item.appointmentId === appointment.id &&
              item.startsAt === appointment.startsAt,
          );
          const notification = previous ?? {
            id: id(5000 + notifications.length),
            appointmentId: appointment.id,
            startsAt: appointment.startsAt,
            kind: 'APPOINTMENT_UPCOMING' as const,
            createdAt: new Date(current).toISOString(),
            readAt: null,
          };
          if (!previous) notifications.push(notification);
          return {
            id: notification.id,
            appointmentId: appointment.id,
            startsAt: appointment.startsAt,
          };
        }),
      });
    }
    if (url.pathname.endsWith('/read-all')) {
      for (const notice of notifications) notice.readAt ??= now;
      return respond(route, {}, 204);
    }
    const unreadCount = () => notifications.filter((notice) => !notice.readAt).length;
    if (url.pathname.endsWith('/read')) {
      const notice = notifications.find((item) => url.pathname.includes(item.id));
      if (!notice)
        return respond(
          route,
          { error: { code: 'NOT_FOUND', message: 'Notificación no encontrada' } },
          404,
        );
      notice.readAt ??= now;
      return respond(route, { readAt: notice.readAt, unreadCount: unreadCount() });
    }
    if (failNotificationList)
      return respond(
        route,
        { error: { code: 'INTERNAL_ERROR', message: 'Notificaciones no disponibles' } },
        503,
      );
    const ordered = [...notifications].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
    const cursor = url.searchParams.get('cursor');
    const offset = cursor ? ordered.findIndex((item) => item.id === cursor) + 1 : 0;
    const remaining = ordered
      .slice(offset)
      .filter((item) => url.searchParams.get('filter') !== 'unread' || !item.readAt);
    const limit = Number(url.searchParams.get('limit'));
    return respond(route, {
      items: remaining.slice(0, limit),
      unreadCount: unreadCount(),
      nextCursor: remaining.length > limit ? remaining[limit - 1]!.id : null,
    });
  });
  await page.route(
    /\/api\/(me|services|slots|customers(?:\/[^/?]+)?|availability-rules|appointments(?:\/[^/?]+(?:\/(?:events|confirm|cancel|complete|no-show|risk\/explanation))?)?)(\?.*)?$/,
    async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return respond(route, {});
      const url = new URL(request.url());
      if (url.pathname.endsWith('/risk/explanation')) {
        const appointmentId = url.pathname.split('/')[3]!;
        expect(request.method()).toBe('POST');
        riskCalls.push(appointmentId);
        const high = appointmentId === id(21);
        return respond(route, {
          risk: {
            appointmentId,
            score: high ? 85 : 45,
            level: high ? 'HIGH' : 'MEDIUM',
            factors: [],
            calculatedAt: now,
          },
          explanation: {
            summary: 'Confirmá la asistencia antes del turno.',
            recommendations: ['Enviar un recordatorio'],
          },
          generatedAt: now,
          model: 'fixture',
          disclaimer: 'Resultado de prueba',
        });
      }
      if (url.pathname.endsWith('/events')) return respond(route, []);
      if (url.pathname.startsWith('/api/customers/')) {
        const found = customers.find((item) => url.pathname.endsWith('/' + item.id));
        return found
          ? respond(route, found)
          : respond(route, { error: { code: 'NOT_FOUND', message: 'Cliente no encontrado' } }, 404);
      }
      if (url.pathname.startsWith('/api/appointments/')) {
        const [, , , appointmentId, action] = url.pathname.split('/');
        const appointment = appointments.find((item) => item.id === appointmentId);
        if (!appointment)
          return respond(
            route,
            { error: { code: 'NOT_FOUND', message: 'Turno no encontrado' } },
            404,
          );
        if (!action) return respond(route, appointment);
        expect(request.method()).toBe('POST');
        transitions.push(appointmentId + '/' + action);
        if (options.rejectFirstTransition && transitions.length === 1) {
          return respond(
            route,
            {
              error: {
                code: 'APPOINTMENT_INVALID_TRANSITION',
                message: 'El turno cambió en otra sesión',
              },
            },
            409,
          );
        }
        appointment.status = reminderActions[action as ReminderAction].status;
        notifications.push({
          id: id(5000 + notifications.length),
          appointmentId: appointment.id,
          startsAt: appointment.startsAt,
          createdAt: now,
          readAt: null,
          kind:
            appointment.status === 'NO_SHOW'
              ? 'MARKED_NO_SHOW'
              : (appointment.status as 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'),
        });
        return respond(route, appointment);
      }
      switch (url.pathname) {
        case '/api/me':
          return respond(route, {
            onboarded: true,
            user: { id: user.id, email },
            profile: { id: user.id, role: 'OWNER', fullName: 'Operadora' },
            business: {
              id: id(4),
              name: 'Negocio de prueba',
              timezone,
              createdAt: now,
            },
          });
        case '/api/availability-rules':
          return respond(route, {
            data: {
              timezone,
              rules: rules.map((rule, index) => ({ ...rule, id: id(50 + index), ...timestamps })),
            },
          });
        case '/api/services':
          expect(['true', 'all']).toContain(url.searchParams.get('active'));
          return respond(route, {
            data: [service, { ...service, id: id(5), name: 'Servicio desactivado', active: false }],
            meta: { active: 'true', limit: 100, offset: 0, total: 2 },
          });
        case '/api/customers': {
          if (options.failMetrics && url.searchParams.get('pageSize') === '1')
            return respond(route, { error: { message: 'Sin conexión' } }, 503);
          if (request.method() === 'POST') {
            const saved = { ...customer, id: id(6), fullName: request.postDataJSON().fullName };
            customers.push(saved);
            return respond(route, saved, 201);
          }
          const search = url.searchParams.get('search')?.toLowerCase() ?? '';
          const items = customers.filter((item) => item.fullName.toLowerCase().includes(search));
          return respond(route, { items, page: 1, pageSize: 50, total: items.length });
        }
        case '/api/slots':
          expect(url.searchParams.get('serviceId')).toBe(service.id);
          slotDates.push(url.searchParams.get('date')!);
          return respond(route, {
            data: slotDates.at(-1) !== date ? [] : bookedByAnother ? [second] : [first, second],
          });
        case '/api/appointments':
          if (request.method() === 'GET') {
            if (options.failMetrics)
              return respond(route, { error: { message: 'Sin conexión' } }, 503);
            return respond(route, {
              items: appointments,
              page: 1,
              pageSize: 100,
              total: appointments.length,
            });
          }
          writes.push(request.postDataJSON());
          if (conflict && !bookedByAnother) {
            bookedByAnother = true;
            return respond(
              route,
              {
                error: { code: 'APPOINTMENT_TIME_CONFLICT', message: 'El horario ya está ocupado' },
              },
              409,
            );
          }
          const body = writes.at(-1)!;
          const saved: AppointmentDto = {
            ...timestamps,
            id: id(7),
            customerId: body.customerId,
            serviceId: body.serviceId,
            startsAt: body.startsAt,
            endsAt: body.startsAt === first.startsAt ? first.endsAt : second.endsAt,
            notes: body.notes ?? null,
            status: 'SCHEDULED',
          };
          appointments.push(saved);
          return respond(route, saved, 201);
      }
    },
  );
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('ui-fixture-password');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/customers$/, { timeout: 30_000 });
  await page.getByRole('link', { name: 'Agenda', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nuevo turno' })).toBeVisible({ timeout: 30_000 });
  return {
    writes,
    slotDates,
    transitions,
    notifications,
    setNotificationError(fail: boolean) {
      failNotificationList = fail;
    },
    riskCalls,
    replaceRules(next: AvailabilityRuleInput[]) {
      rules = next;
    },
  };
}

async function selectService(page: Page) {
  await page.getByRole('combobox', { name: 'Servicio' }).click();
  await expect(page.getByRole('option', { name: /Servicio desactivado/ })).toHaveCount(0);
  await page.getByRole('option', { name: 'Consulta · 30 min' }).click();
}

test('reconsulta tras un 409, envía un solo POST por confirmación y actualiza el calendario', async ({
  page,
}) => {
  const { writes, slotDates } = await openAgenda(page, true);
  await page.getByRole('button', { name: 'Nuevo turno' }).click();
  const dialog = page.getByRole('dialog', { name: /Nuevo turno/ });
  await dialog.getByRole('combobox', { name: 'Cliente' }).fill('María');
  await page.getByRole('option', { name: /María Pérez/ }).click();
  await selectService(page);
  await expect(dialog.getByLabel('Fecha')).toHaveValue(date);
  await dialog.getByRole('button', { name: '10:00 – 10:30' }).click();
  await dialog.getByRole('textbox', { name: /Observaciones/ }).fill('Primera consulta');
  await expect(dialog.getByText('10:00 – 10:30 · 30 min')).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Confirmar turno' });
  await confirm.click();
  await expect(dialog.getByText(/La disponibilidad cambió/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '10:00 – 10:30' })).toHaveCount(0);
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByRole('textbox', { name: /Observaciones/ })).toHaveValue(
    'Primera consulta',
  );
  await dialog.getByRole('button', { name: '11:00 – 11:30' }).click();
  await confirm.evaluate((element: HTMLButtonElement) => {
    element.click();
    element.click();
  });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Turno guardado/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Turno programado/ })).toBeVisible();
  expect(writes).toEqual([
    {
      customerId: customer.id,
      serviceId: service.id,
      startsAt: first.startsAt,
      notes: 'Primera consulta',
    },
    {
      customerId: customer.id,
      serviceId: service.id,
      startsAt: second.startsAt,
      notes: 'Primera consulta',
    },
  ]);
  expect(slotDates).toEqual([date, date]);
});

function reminderFixture(
  n: number,
  minutes: number,
  status: AppointmentDto['status'] = 'SCHEDULED',
): AppointmentDto {
  const start = Date.parse(now) + minutes * 60_000;
  return {
    id: id(n),
    customerId: customer.id,
    serviceId: service.id,
    status,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 30 * 60_000).toISOString(),
    notes: null,
    ...timestamps,
  };
}

test('calcula el umbral, las transiciones, el descarte y la reaparición de avisos', () => {
  const clock = Date.parse(now);
  const soon = reminderFixture(31, 10);
  const later = reminderFixture(32, 11);
  const terminal = (['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const).map((status, index) =>
    reminderFixture(33 + index, 2, status),
  );
  const queue = (at: number, preferences = {}) =>
    agendaReminders([soon, later, ...terminal], at, timezone, preferences);
  expect(queue(clock).queue.map((item) => item.appointment.id)).toEqual([soon.id]);
  expect(queue(clock).nextTick).toBe(clock + 60_000);
  expect(queue(clock + 60_000).queue).toHaveLength(2);
  const snoozed = { [reminderKey(soon)]: { until: clock + 300_000 } };
  expect(queue(clock + 299_999, snoozed).queue.map((item) => item.appointment.id)).toEqual([
    later.id,
  ]);
  expect(queue(clock + 300_000, snoozed).queue).toHaveLength(2);
  expect(
    queue(clock + 60_000, { [reminderKey(soon)]: { dismissed: true } }).queue.map(
      (item) => item.appointment.id,
    ),
  ).toEqual([later.id]);
  expect(queue(clock + 600_000).queue[0]).toMatchObject({ phase: 'started', minutes: 0 });
  expect(canApplyReminderAction(soon, 'no-show', clock)).toBe(false);
  expect(canApplyReminderAction(soon, 'complete', clock)).toBe(false);
  expect(canApplyReminderAction(soon, 'no-show', clock + 600_000)).toBe(true);
  expect(canApplyReminderAction({ ...soon, status: 'CONFIRMED' }, 'confirm', clock)).toBe(false);
  expect(canApplyReminderAction(terminal[0]!, 'complete', clock + 600_000)).toBe(false);
  const nearMidnight = Date.parse('2099-01-06T02:57:00Z');
  const nextDay = { ...soon, startsAt: '2099-01-06T03:02:00Z' };
  expect(agendaReminders([nextDay], nearMidnight, timezone, {}).queue[0]?.minutes).toBe(5);
});

test('gestiona la cola de avisos, pospone y sincroniza cambios reales con el calendario', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const firstAlert = reminderFixture(31, 5);
  const secondAlert = reminderFixture(32, 10);
  const far = reminderFixture(33, 30);
  const { transitions, notifications } = await openAgenda(
    page,
    false,
    [firstAlert, secondAlert, far],
    {
      rejectFirstTransition: true,
    },
  );
  const card = page.getByRole('region', { name: 'Aviso de turno' });
  await expect(card).toHaveCount(1);
  await expect(card.getByText('María Pérez')).toBeVisible();
  await expect(card.getByText('Consulta', { exact: true })).toBeVisible();
  await expect(card.getByText('Comienza en 5 min')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notificaciones (2 sin leer)' })).toBeVisible();
  await page.getByRole('button', { name: 'Nuevo turno' }).click();
  await expect(card).toBeHidden();
  await page
    .getByRole('dialog', { name: /Nuevo turno/ })
    .getByRole('button', { name: 'Cancelar', exact: true })
    .click();
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: 'Expandir calendario' }).click();
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: 'Recordar en 5 min' }).click();
  expect(
    notifications
      .filter((notice) => notice.kind === 'APPOINTMENT_UPCOMING')
      .every((notice) => !notice.readAt),
  ).toBe(true);
  await expect(card.getByText('Comienza en 10 min')).toBeVisible();
  await card.getByRole('button', { name: 'Confirmar turno' }).click();
  await expect(page.getByText('El turno cambió en otra sesión')).toBeVisible();
  const secondEvent = page.locator(
    '#agenda-calendar-grid a[href="/appointments/' + secondAlert.id + '"]',
  );
  await expect(secondEvent).toContainText('Turno programado');
  await card.getByRole('button', { name: 'Cancelar turno' }).click();
  expect(transitions).toEqual([secondAlert.id + '/confirm']);
  await card.getByRole('button', { name: 'Confirmar cancelación' }).click();
  await expect(secondEvent).toContainText('Turno cancelado');
  await page.clock.setFixedTime(new Date(Date.parse(now) + 300_000));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(card.getByText('Es hora del turno')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Marcar ausente' })).toBeVisible();
  await card.getByRole('button', { name: 'Marcar completado' }).click();
  await expect(
    page.locator('#agenda-calendar-grid a[href="/appointments/' + firstAlert.id + '"]'),
  ).toContainText('Turno completado');
  await expect(card).toBeHidden();
  await expect(page.getByRole('button', { name: 'Notificaciones (4 sin leer)' })).toBeVisible();
  expect(notifications.filter((notice) => notice.kind === 'APPOINTMENT_UPCOMING')).toHaveLength(2);
  expect(transitions).toEqual([
    secondAlert.id + '/confirm',
    secondAlert.id + '/cancel',
    firstAlert.id + '/complete',
  ]);
  await page.clock.setFixedTime(new Date(Date.parse(now) + 25 * 60_000));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(card.getByText('Comienza en 5 min')).toBeVisible();
  await card.getByRole('button', { name: 'Cerrar avisos' }).click();
  await expect(card).toBeHidden();
  await expect(page.getByRole('button', { name: 'Notificaciones (5 sin leer)' })).toBeVisible();
  expect(notifications.find((notice) => notice.appointmentId === far.id)?.readAt).toBeNull();
});

test('la campana abre un historial persistente, marca lecturas y navega al turno en móvil', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const appointment = reminderFixture(80, 90);
  const { notifications, setNotificationError } = await openAgenda(page, false, [appointment]);
  const bell = page.getByRole('button', { name: /^Notificaciones/ });
  const popup = page.getByRole('dialog', { name: 'Notificaciones' });
  await bell.focus();
  await page.keyboard.press('Enter');
  await expect(popup.getByText('No tenés notificaciones')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(bell).toBeFocused();
  await bell.click();
  await expect(popup).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(popup).toHaveCount(0);

  for (let index = 0; index < 23; index++) {
    notifications.push({
      id: id(7000 + index),
      appointmentId: index === 22 ? appointment.id : null,
      kind: index === 22 ? 'CONFIRMED' : 'COMPLETED',
      startsAt: appointment.startsAt,
      createdAt: new Date(Date.parse(now) - (22 - index) * 60_000).toISOString(),
      readAt: index < 20 ? now : null,
    });
  }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(bell).toHaveAccessibleName('Notificaciones (3 sin leer)');
  setNotificationError(true);
  await bell.click();
  await expect(popup.getByText('No se pudieron cargar las notificaciones.')).toBeVisible();
  setNotificationError(false);
  await popup.getByRole('button', { name: 'Reintentar' }).click();
  await expect(popup.getByRole('alert')).toHaveCount(0);
  const box = (await popup.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  const rows = popup.getByRole('listitem');
  await expect(rows).toHaveCount(8);
  await expect(rows.first()).toContainText('Turno confirmado');
  await rows.nth(1).getByRole('button', { name: 'Marcar como leída' }).click();
  await expect(popup.getByText('2 sin leer')).toBeVisible();
  await rows.first().getByRole('button', { name: 'Ver turno' }).click();
  await expect(page).toHaveURL(new RegExp('/appointments/' + appointment.id + '$'), {
    timeout: 30_000,
  });
  expect(notifications.at(-1)?.readAt).not.toBeNull();
  await page.getByRole('link', { name: 'Volver a Agenda' }).click();
  await expect(bell).toHaveAccessibleName('Notificaciones (1 sin leer)');
  await bell.click();
  await popup.getByRole('link', { name: 'Ver todas las notificaciones' }).click();
  await expect(page).toHaveURL(/\/notifications$/, { timeout: 30_000 });
  const history = page.getByRole('list', { name: 'Notificaciones' });
  await expect(history.getByRole('listitem')).toHaveCount(20);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(history.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'No leídas', exact: true }).click();
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Marcar todas como leídas' }).click();
  await expect(page.getByText('0 sin leer')).toBeVisible();
  await page.reload();
  await expect(history.getByRole('listitem')).toHaveCount(20);
  await expect(page.getByText('0 sin leer')).toBeVisible();
});

test('detalle reprograma con confirmación, maneja errores y actualiza historial y agenda', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const item = reminderFixture(71, 60);
  const path = '/api/appointments/' + item.id;
  const events: AppointmentEventDto[] = [
    { id: id(90), appointmentId: item.id, type: 'CREATED', createdAt: now, metadata: null },
  ];
  await openAgenda(page, false, [item]);
  await page.route('**' + path + '/events', (route) => respond(route, events));
  await page.route(/\/api\/slots\?/, (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('excludeAppointmentId')).toBe(item.id);
    expect(query.get('serviceId')).toBe(service.id);
    return respond(route, { data: query.get('date') === date ? [first, second] : [] });
  });
  const reschedules: unknown[] = [];
  await page.route('**' + path + '/reschedule', (route) => {
    if (route.request().method() === 'OPTIONS') return respond(route, {});
    reschedules.push(route.request().postDataJSON());
    if (reschedules.length === 1)
      return respond(
        route,
        { error: { code: 'APPOINTMENT_TIME_CONFLICT', message: 'El horario ya está ocupado' } },
        409,
      );
    events.push({
      id: id(91),
      appointmentId: item.id,
      type: 'RESCHEDULED',
      createdAt: now,
      metadata: { previousStartsAt: item.startsAt, startsAt: second.startsAt },
    });
    Object.assign(item, second);
    return respond(route, item);
  });
  let attempts = 0;
  let rejectReload = false;
  await page.route('**' + path, (route) => {
    if (route.request().method() !== 'GET' || !rejectReload) return route.fallback();
    rejectReload = false;
    return respond(
      route,
      { error: { code: 'INTERNAL_ERROR', message: 'No se pudo recargar' } },
      500,
    );
  });
  await page.route('**' + path + '/confirm', (route) => {
    if (route.request().method() === 'OPTIONS') return respond(route, {});
    attempts++;
    if (attempts === 1) return route.abort('failed');
    if (attempts === 2) {
      rejectReload = true;
      return respond(
        route,
        { error: { code: 'FORBIDDEN', message: 'Permisos insuficientes' } },
        403,
      );
    }
    if (attempts === 3)
      return respond(
        route,
        {
          error: { code: 'APPOINTMENT_INVALID_TRANSITION', message: 'El estado del turno cambió' },
        },
        409,
      );
    events.push({
      id: id(92),
      appointmentId: item.id,
      type: 'CONFIRMED',
      createdAt: now,
      metadata: { previousStatus: item.status, status: 'CONFIRMED' },
    });
    item.status = 'CONFIRMED';
    return respond(route, item);
  });
  await page.goto('/appointments/' + item.id);
  await expect(page.getByRole('heading', { name: 'María Pérez' })).toBeVisible({ timeout: 30_000 });
  const contact = page.getByRole('region', { name: 'Cliente', exact: true });
  const serviceDetails = page.getByRole('region', { name: 'Servicio', exact: true });
  expect((await serviceDetails.boundingBox())!.y).toBeGreaterThan((await contact.boundingBox())!.y);
  expect(await page.locator('html').evaluate((element) => element.scrollWidth)).toBe(390);
  await expect(page.getByRole('button', { name: 'Marcar ausente' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Marcar completado' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reprogramar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reprogramar turno' });
  expect((await dialog.boundingBox())?.width).toBe(390);
  await dialog.getByLabel('Fecha').fill('2099-01-11');
  await expect(dialog.getByText(/No hay horarios disponibles/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Revisar cambio' })).toBeDisabled();
  await dialog.getByLabel('Fecha').fill(date);
  await expect(dialog.getByRole('button', { name: '10:00 – 10:30' })).toHaveCount(0);
  async function review() {
    await dialog.getByRole('button', { name: '11:00 – 11:30' }).click();
    await dialog.getByRole('button', { name: 'Revisar cambio' }).click();
    await expect(dialog.getByText(/10:00 – 10:30/)).toBeVisible();
    await expect(dialog.getByText(/11:00 – 11:30/)).toBeVisible();
  }
  await review();
  expect(reschedules).toEqual([]);
  await dialog.getByRole('button', { name: 'Confirmar reprogramación' }).click();
  await expect(dialog.getByRole('alert')).toContainText('El horario ya está ocupado');
  await expect(dialog.getByRole('button', { name: 'Revisar cambio' })).toBeDisabled();
  await review();
  await dialog.getByRole('button', { name: 'Confirmar reprogramación' }).click();
  await expect(dialog).toHaveCount(0);
  const rescheduled = page
    .getByRole('status')
    .filter({ hasText: 'Turno reprogramado correctamente' });
  await expect(rescheduled).toBeVisible();
  await expect(rescheduled).toHaveCount(1);
  await rescheduled.getByRole('button', { name: 'Cerrar notificación' }).click();
  await expect(rescheduled).toHaveCount(0);
  const history = page.getByRole('list', { name: 'Historial del turno' });
  await expect(history.getByText('Turno reprogramado', { exact: true })).toBeVisible();
  await expect(history.getByText(/Antes.*10:00/)).toBeVisible();
  await expect(history.getByText(/Nuevo inicio.*11:00/)).toBeVisible();
  expect(reschedules).toEqual([{ startsAt: second.startsAt }, { startsAt: second.startsAt }]);
  const confirm = page.getByRole('button', { name: 'Confirmar turno', exact: true });
  const summary = page.getByRole('region', { name: 'María Pérez' });
  const summaryTop = () =>
    summary.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  const top = await summaryTop();
  for (const message of [
    'No se pudo conectar con el servidor',
    'Permisos insuficientes',
    'El estado del turno cambió',
  ]) {
    const reload =
      message === 'Permisos insuficientes'
        ? page.waitForResponse(
            (response) => response.url().endsWith(path) && response.status() === 500,
          )
        : undefined;
    await confirm.click();
    const toast = page.getByRole('alert').filter({ hasText: 'No se pudo actualizar el turno.' });
    await expect(toast).toContainText(message);
    await expect(toast).toHaveCount(1);
    await expect(confirm).toBeEnabled();
    if (reload) {
      await reload;
      await expect(page.getByText('No se pudo recargar')).toHaveCount(0);
    }
    expect(await summaryTop()).toBe(top);
  }
  await confirm.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Turno confirmado correctamente' }),
  ).toBeVisible();
  await expect(history.getByText('Turno confirmado', { exact: true })).toBeVisible();
  await expect(history.getByText('Confirmado', { exact: true })).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await page.getByRole('link', { name: 'Volver a Agenda' }).click({ timeout: 30_000 });
  const event = page.locator('#agenda-calendar-grid a[href="/appointments/' + item.id + '"]');
  await expect(event).toContainText('Turno confirmado', { timeout: 30_000 });
  await expect(event).toContainText('11:00');
});

test('detalle oculta acciones de turnos cerrados y confirma una ausencia luego del inicio', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const closed = (['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const).map((status, index) =>
    reminderFixture(72 + index, 60, status),
  );
  const pending = reminderFixture(75, -1, 'CONFIRMED');
  const { transitions } = await openAgenda(page, false, [...closed, pending]);
  for (const item of closed) {
    await page.goto('/appointments/' + item.id);
    await expect(page.getByText('El turno está cerrado.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('group', { name: 'Acciones del turno' })).toHaveCount(0);
  }
  await page.goto('/appointments/' + pending.id);
  await page.getByRole('button', { name: 'Marcar ausente' }).click();
  const dialog = page.getByRole('dialog', { name: 'Marcar ausente' });
  await expect(dialog.getByText(/María Pérez/)).toBeVisible();
  expect(transitions).toEqual([]);
  await dialog.getByRole('button', { name: 'Confirmar cambio' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Turno marcado como ausente' }),
  ).toBeVisible();
  await expect(page.getByText('Ausente', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Acciones del turno' })).toHaveCount(0);
  expect(transitions).toEqual([pending.id + '/no-show']);
});

test('el toast de cancelación flota y el detalle conserva dos columnas en escritorio', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: new Date(now) });
  const item = reminderFixture(76, 60);
  const { transitions } = await openAgenda(page, false, [item]);
  await page.goto('/appointments/' + item.id);
  const summary = page.getByRole('region', { name: 'María Pérez' });
  await expect(summary).toBeVisible({ timeout: 30_000 });
  const top = (await summary.boundingBox())!.y;
  const clientBox = (await page
    .getByRole('region', { name: 'Cliente', exact: true })
    .boundingBox())!;
  const serviceBox = (await page
    .getByRole('region', { name: 'Servicio', exact: true })
    .boundingBox())!;
  expect(serviceBox.y).toBe(clientBox.y);
  expect(serviceBox.x).toBeGreaterThan(clientBox.x);
  const riskBox = (await page.getByRole('region', { name: 'Riesgo de ausencia' }).boundingBox())!;
  const historyBox = (await page
    .getByRole('region', { name: 'Historial', exact: true })
    .boundingBox())!;
  expect(historyBox.y).toBe(riskBox.y);
  expect(historyBox.x).toBeGreaterThan(riskBox.x);

  await page.getByRole('button', { name: 'Cancelar turno', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancelar turno' });
  await dialog.getByRole('button', { name: 'Confirmar cancelación' }).click();
  await expect(dialog).toHaveCount(0);
  const toast = page.getByRole('status').filter({ hasText: 'Turno cancelado correctamente' });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute('aria-live', 'polite');
  const toastBox = (await toast.boundingBox())!;
  const back = (await page.getByRole('link', { name: 'Volver a Agenda' }).boundingBox())!;
  expect(1440 - toastBox.x - toastBox.width).toBeLessThan(32);
  expect(toastBox.y).toBeLessThan(40);
  expect(back.x + back.width).toBeLessThan(toastBox.x);
  expect((await summary.boundingBox())!.y).toBe(top);
  await expect(summary.getByText('Cancelado', { exact: true })).toBeVisible();
  await expect(summary.getByRole('group', { name: 'Acciones del turno' })).toHaveCount(0);
  expect(transitions).toEqual([item.id + '/cancel']);
  await page.clock.runFor(4700);
  await expect(toast).toHaveCount(0);
  expect((await summary.boundingBox())!.y).toBe(top);
});

test('calcula límites semanales y diarios, cortes, días cerrados y rango UTC', () => {
  const rules = [
    { ...weekdays[0]!, endTime: '13:00' },
    { ...weekdays[0]!, startTime: '16:00', endTime: '20:00' },
    { ...weekdays[1]!, startTime: '10:30', endTime: '15:15' },
    { ...weekdays[0]!, dayOfWeek: 6, startTime: '08:00', endTime: '12:00' },
    { ...weekdays[0]!, dayOfWeek: 0, active: false },
  ];
  expect(agendaHours(rules)).toMatchObject({
    hiddenDays: [0, 3, 4, 5],
    bounds: { slotMinTime: '08:00', slotMaxTime: '20:00' },
  });
  expect(agendaHours(rules, 2).bounds).toEqual({ slotMinTime: '10:30', slotMaxTime: '15:15' });
  expect(agendaHours(rules).businessHours).toHaveLength(4);
  expect(agendaHours([]).bounds).toBeNull();
  expect(canSelectAgendaTime(rules, date + 'T14:00:00-03:00')).toBe(false);
  expect(canSelectAgendaTime(rules, date + 'T16:00:00-03:00', date + 'T16:30:00-03:00')).toBe(true);
  expect(canSelectAgendaTime(rules, date + 'T12:45:00-03:00', date + 'T13:15:00-03:00')).toBe(
    false,
  );
  expect(canSelectAgendaTime(rules, '2099-01-11')).toBe(false);
  expect(businessDayRange(date, timezone)).toEqual({ from: date, to: '2099-01-06' });
  expect(businessDayRange('2026-03-08', 'America/New_York')).toEqual({
    from: '2026-03-08',
    to: '2026-03-09',
  });
});

test('elige la hora del negocio, la apertura o el próximo día con atención', () => {
  const position = (instant: string, rules = weekdays) =>
    agendaTodayPosition(rules, new Date(instant), timezone);
  expect(position('2099-01-05T17:30:00Z')).toEqual({ date, time: '14:15' });
  expect(position('2099-01-05T10:00:00Z')).toEqual({ date, time: '09:00' });
  expect(position('2099-01-06T01:00:00Z')).toEqual({ date, time: '09:00' });
  expect(position('2099-01-11T04:00:00Z')).toEqual({ date: '2099-01-12', time: '09:00' });
  const split = [
    { ...weekdays[0]!, endTime: '13:00' },
    { ...weekdays[0]!, startTime: '16:00', endTime: '20:00' },
  ];
  expect(position('2099-01-05T17:30:00Z', split)).toEqual({ date, time: '09:00' });
  expect(position('2099-01-05T19:05:00Z', split)).toEqual({ date, time: '16:00' });
  expect(position('2099-01-05T17:30:00Z', [{ ...weekdays[0]!, active: false }])).toBeNull();
  expect(
    agendaTodayPosition(weekdays, new Date('2026-07-06T18:30:00Z'), 'America/New_York'),
  ).toEqual({ date: '2026-07-06', time: '14:15' });
});

async function scrollPosition(grid: Locator, time: string, minutes = 0) {
  return grid
    .locator('.booking-calendar-slot[data-time="' + time + '"]')
    .evaluate((lane, minute) => {
      let viewport = lane.parentElement;
      while (viewport && !/^(auto|scroll)$/.test(getComputedStyle(viewport).overflowY)) {
        viewport = viewport.parentElement;
      }
      if (!viewport) throw new Error('No se encontró el área desplazable de la agenda');
      const area = viewport.getBoundingClientRect();
      const row = lane.getBoundingClientRect();
      const target =
        row.top - area.top - viewport.clientTop + viewport.scrollTop + (row.height * minute) / 30;
      return {
        top: viewport.scrollTop,
        target: Math.max(0, Math.min(target, viewport.scrollHeight - viewport.clientHeight)),
        x: area.left + area.width / 2,
        y: area.top + area.height / 2,
      };
    }, minutes);
}

test('posiciona Semana al entrar y en Hoy, y respeta el desplazamiento manual', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 800 });
  await openAgenda(page, false, [], { instant: '2099-01-05T17:30:00Z' });
  const grid = page.locator('#agenda-calendar-grid');
  async function expectAt(time: string, minute = 0) {
    await expect
      .poll(async () => {
        const { top, target } = await scrollPosition(grid, time, minute);
        return Math.abs(top - target);
      })
      .toBeLessThan(4);
  }
  await expectAt('14:00:00', 15);
  const initial = await scrollPosition(grid, '14:00:00', 15);
  expect(initial.top).toBeGreaterThan(50);
  await page.mouse.move(initial.x, initial.y);
  await page.mouse.wheel(0, -100);
  await expect
    .poll(async () => (await scrollPosition(grid, '09:00:00')).top)
    .toBeLessThan(initial.top - 50);
  const manual = (await scrollPosition(grid, '09:00:00')).top;
  await page.getByRole('button', { name: 'Expandir calendario' }).click();
  await page.getByRole('button', { name: 'Contraer calendario' }).click();
  await expect.poll(async () => (await scrollPosition(grid, '09:00:00')).top).toBeCloseTo(manual);
  await grid.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expectAt('14:00:00', 15);
  await grid.getByRole('button', { name: /semana siguiente/i }).click();
  await expect(grid.locator('[data-date="2099-01-12"]').first()).toBeVisible();
  await expectAt('09:00:00');
  await grid.getByText('Día', { exact: true }).click();
  await expectAt('09:00:00');
  await grid.getByText('Mes', { exact: true }).click();
  await expect(grid.locator('.booking-calendar-slot')).toHaveCount(0);
  await grid.getByText('Día', { exact: true }).click();
  await expectAt('09:00:00');
  await grid.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect(grid.locator('[data-date="2099-01-05"]').first()).toBeVisible();
  await expectAt('14:00:00', 15);
});

test('abre Día en la próxima jornada real cuando hoy no hay atención', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const rules = [{ ...weekdays[0]!, startTime: '10:30' }];
  await openAgenda(page, false, [], { instant: '2099-01-11T04:00:00Z', rules });
  const grid = page.locator('#agenda-calendar-grid');
  await expect(grid.locator('[data-date="2099-01-12"]').first()).toBeVisible();
  await expect(grid.locator('.booking-calendar-slot[data-time="09:00:00"]')).toHaveCount(0);
  await expect.poll(async () => (await scrollPosition(grid, '10:30:00')).top).toBeLessThan(4);
});

test('conserva el calendario al expandir y refleja horarios, estados y cambios de disponibilidad', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  const initial = APPOINTMENT_STATUSES.map((status, index): AppointmentDto => ({
    id: id(20 + index),
    status,
    customerId: customer.id,
    serviceId: service.id,
    startsAt: date + 'T' + String(13 + index).padStart(2, '0') + ':00:00.000Z',
    endsAt: date + 'T' + String(13 + index).padStart(2, '0') + ':30:00.000Z',
    notes: null,
    ...timestamps,
  }));
  const { replaceRules, riskCalls } = await openAgenda(page, false, initial);
  const grid = page.locator('#agenda-calendar-grid');
  const slot = (time: string) => grid.locator('.booking-calendar-slot[data-time="' + time + '"]');
  await expect(slot('09:00:00')).toHaveCount(1);
  await expect(slot('00:00:00')).toHaveCount(0);
  await expect(grid.locator('[data-date="2099-01-10"]')).toHaveCount(0);
  await expect(grid.locator('[data-date="2099-01-11"]')).toHaveCount(0);
  const legend = page.getByRole('region', { name: 'Estados de turnos' });
  const iconNames = {
    SCHEDULED: 'clock-3',
    CONFIRMED: 'badge-check',
    CANCELLED: 'circle-x',
    COMPLETED: 'check-circle-2',
    NO_SHOW: 'user-x',
  };
  for (const [index, status] of APPOINTMENT_STATUSES.entries()) {
    const { label, color } = appointmentStates[status];
    const legendLabel = legend.getByText(label, { exact: true });
    await expect(legendLabel).toBeVisible();
    const event = grid.getByRole('link', { name: new RegExp('Turno ' + label.toLowerCase()) });
    await expect(event).toBeVisible();
    await expect(event).toHaveCSS('--fc-event-color', color);
    await expect(event).toContainText(String(10 + index) + ':00');
    const selector = 'svg.lucide-' + iconNames[status];
    const legendIcon = legendLabel.locator('..').locator(selector);
    const eventIcon = event.locator(selector);
    await expect(legendIcon).toHaveAttribute('width', '15');
    await expect(eventIcon).toHaveAttribute('width', '13');
    for (const icon of [legendIcon, eventIcon]) {
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute('stroke', color);
      await expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  }
  const compact = (await grid.boundingBox())!.width;
  const title = await grid.locator('.booking-calendar-title').textContent();
  const sidebar = page.getByRole('complementary', { name: 'Seguimiento de agenda' });
  await expect(sidebar).toBeVisible();
  const insights = sidebar.getByRole('region', { name: 'Recomendación IA' });
  const health = sidebar.getByRole('region', { name: 'Salud de la agenda' });
  const kpis = page.getByRole('region', { name: 'Indicadores del día' });
  const highRisk = kpis.getByRole('region', { name: 'Riesgo alto' });
  await expect(
    kpis.getByRole('region', { name: 'Turnos hoy' }).getByText('5', { exact: true }),
  ).toBeVisible();
  await expect(
    kpis.getByRole('region', { name: 'Clientes' }).getByText('1', { exact: true }),
  ).toBeVisible();
  await expect(
    kpis.getByRole('region', { name: 'Emails enviados' }).getByText('Sin datos'),
  ).toBeVisible();
  await expect(highRisk.getByText('Sin datos')).toBeVisible();
  await expect(health.getByRole('definition')).toHaveText(['1', '1', '1']);
  await expect(
    health.getByRole('img', { name: /distribución.*1 cancelados.*1 ausentes/i }),
  ).toBeVisible();
  expect(
    await page.locator('html').evaluate((element) => element.scrollHeight),
  ).toBeLessThanOrEqual(1081);
  await page.getByRole('button', { name: 'Expandir calendario' }).click();
  await expect(sidebar).toBeHidden();
  await expect.poll(async () => (await grid.boundingBox())!.width).toBeGreaterThan(compact);
  await expect(grid.locator('.booking-calendar-title')).toHaveText(title!);
  await page.getByRole('button', { name: 'Contraer calendario' }).click();
  await expect(sidebar).toBeVisible();
  await expect.poll(async () => (await grid.boundingBox())!.width).toBeCloseTo(compact);
  expect(riskCalls).toEqual([]);
  await insights.getByRole('button', { name: 'Consultar IA' }).click();
  const riskDialog = page.getByRole('dialog', { name: 'Recomendación IA' });
  expect(riskCalls).toEqual([]);
  await riskDialog.getByRole('button', { name: 'Explicar con IA' }).click();
  await expect(riskDialog.getByText('Confirmá la asistencia antes del turno.')).toBeVisible();
  await riskDialog.getByRole('button', { name: 'Cerrar' }).click();
  await expect(insights.getByText('Riesgo medio')).toBeVisible();
  await expect(highRisk.getByText('Sin datos')).toBeVisible();
  await insights.getByRole('button', { name: 'Ver análisis' }).click();
  await expect(riskDialog.getByText('Enviar un recordatorio')).toBeVisible();
  expect(riskCalls).toEqual([id(20)]);
  await riskDialog.getByRole('button', { name: 'Cerrar' }).click();
  await insights.getByRole('button', { name: 'Consultar IA' }).click();
  await riskDialog.getByRole('button', { name: 'Explicar con IA' }).click();
  await expect(riskDialog.getByText('Riesgo alto')).toBeVisible();
  await riskDialog.getByRole('button', { name: 'Cerrar' }).click();
  await expect(insights.getByRole('listitem').first().getByText('Riesgo alto')).toBeVisible();
  await expect(highRisk.getByText('1', { exact: true })).toBeVisible();
  expect(riskCalls).toEqual([id(20), id(21)]);

  replaceRules([
    { ...weekdays[0]!, endTime: '13:00' },
    { ...weekdays[0]!, startTime: '16:00', endTime: '20:00' },
    { ...weekdays[1]!, startTime: '10:00', endTime: '15:00' },
    { ...weekdays[0]!, dayOfWeek: 6, startTime: '08:00', endTime: '12:00' },
  ]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(grid.locator('[data-date="2099-01-10"]').first()).toBeVisible();
  await expect(slot('08:00:00')).toHaveCount(1);
  await grid.getByText('Día', { exact: true }).click();
  await expect(slot('08:00:00')).toHaveCount(0);
  await expect(slot('19:30:00')).toHaveCount(1);
  const gap = slot('15:00:00');
  await gap.scrollIntoViewIfNeeded();
  const bounds = (await gap.boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + 4);
  await expect(page.getByRole('dialog', { name: /Nuevo turno/ })).toHaveCount(0);
  await grid.getByRole('button', { name: /día siguiente/i }).click();
  await expect(slot('09:00:00')).toHaveCount(0);
  await expect(slot('10:00:00')).toHaveCount(1);
  await expect(slot('15:00:00')).toHaveCount(0);
  await grid.getByText('Mes', { exact: true }).click();
  const sunday = grid.locator('.booking-calendar-day[data-date="2099-01-11"]');
  await expect(sunday).toContainText('Cerrado');
  await sunday.click();
  await expect(page.getByRole('dialog', { name: /Nuevo turno/ })).toHaveCount(0);

  replaceRules([]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText(/Todavía no hay horarios de atención/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo turno' })).toBeDisabled();
  const monday = grid.locator('.booking-calendar-day[data-date="2099-01-05"]');
  const completedLink = monday.getByRole('link', { name: /Turno completado/ });
  const insideCell = await completedLink.isVisible();
  if (!insideCell) {
    await monday.getByText(/^\+\d+ turnos?$/).click({ timeout: 5000 });
  }
  const completed = insideCell
    ? completedLink
    : page.getByRole('dialog').getByRole('link', { name: /Turno completado/ });
  await expect(completed.locator('svg.lucide-check-circle-2')).toBeVisible();
  await completed.click({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Estado del turno' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Completado', { exact: true })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test('Mes muestra turnos en la celda y lista solo los que desbordan en orden horario', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = (sequence: number, day: string, hour: number): AppointmentDto => ({
    ...reminderFixture(120 + sequence, 60),
    startsAt: day + 'T' + String(hour).padStart(2, '0') + ':00:00.000Z',
    endsAt: day + 'T' + String(hour).padStart(2, '0') + ':30:00.000Z',
  });
  const sparse = [fixture(0, date, 13), fixture(1, date, 14)];
  const busyDay = '2099-01-06';
  const dense = Array.from({ length: 10 }, (_, index) => fixture(2 + index, busyDay, 12 + index));
  const historical = { ...fixture(12, '2099-01-04', 14), status: 'COMPLETED' as const };
  await openAgenda(page, false, [...sparse, ...dense.slice().reverse(), historical]);
  const grid = page.locator('#agenda-calendar-grid');
  await grid.getByText('Mes', { exact: true }).click();
  const cell = (day: string) => grid.locator(`.booking-calendar-day[data-date="${day}"]`);
  const links = (day: string) => cell(day).getByRole('link', { name: /turno/i });
  async function expectCentered(day: Locator, indicator: Locator) {
    await expect(indicator).toBeVisible();
    const box = (await day.boundingBox())!;
    const chip = (await indicator.boundingBox())!;
    expect(Math.abs(chip.x + chip.width / 2 - (box.x + box.width / 2))).toBeLessThan(4);
    expect(chip.x).toBeGreaterThanOrEqual(box.x);
    expect(chip.x + chip.width).toBeLessThanOrEqual(box.x + box.width);
    expect(chip.y).toBeGreaterThanOrEqual(box.y);
    expect(chip.y + chip.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
  }
  await expect(links(date)).toHaveCount(2);
  await expect(links(date).first()).toContainText('10:00');
  await expect(links(date).first()).toContainText('María Pérez');
  await expect(links(date).first().locator('svg.lucide-clock-3')).toBeVisible();
  await expect(cell(date).getByText(/^\+\d+ turnos?$/)).toHaveCount(0);

  const overflow = cell(busyDay).locator('.agenda-month-more-chip');
  const overflowButton = cell(busyDay).getByRole('button', { name: /^\+\d+ turnos?$/ });
  await expectCentered(cell(busyDay), overflow);
  await expect(overflow.locator('svg.lucide-calendar-days')).toBeVisible();
  const visible = await links(busyDay).evaluateAll((items) =>
    items.map((item) => item.getAttribute('href')),
  );
  expect(visible.length).toBeGreaterThanOrEqual(1);
  expect(visible).toEqual(dense.slice(0, visible.length).map((item) => '/appointments/' + item.id));
  await expect(overflow).toHaveText(`+${dense.length - visible.length} turnos`);
  await expect(overflowButton).toHaveAccessibleDescription(
    `Mostrar ${dense.length - visible.length} turnos adicionales`,
  );
  await page.keyboard.press('Tab');
  await overflowButton.focus();
  await expect(overflow).toHaveCSS('outline-width', '2px');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog
        .getByRole('link', { name: /turno/i })
        .evaluateAll((items) => items.map((item) => item.getAttribute('href'))),
    )
    .toEqual(dense.slice(visible.length).map((item) => '/appointments/' + item.id));
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(overflowButton).toBeFocused();

  const sunday = cell('2099-01-04');
  const closedChip = sunday.locator('.agenda-month-closed-chip');
  await expectCentered(sunday, closedChip);
  await expect(closedChip.locator('svg.lucide-lock-keyhole')).toBeVisible();
  const dayNumber = (await sunday.locator('.agenda-day-number').boundingBox())!;
  expect((await closedChip.boundingBox())!.y).toBeGreaterThanOrEqual(
    dayNumber.y + dayNumber.height,
  );
  await expect(sunday).toHaveAccessibleName(/domingo.*cerrado/i);
  await expect(sunday.getByRole('button')).toHaveCount(0);
  await expect(sunday.getByRole('link', { name: /Turno completado/ })).toBeVisible();
  await sunday.locator('.agenda-day-number').click();
  await expect(page.getByRole('dialog', { name: /Nuevo turno/ })).toHaveCount(0);
  const outside = cell('2099-02-01');
  await expectCentered(outside, outside.locator('.agenda-month-closed-chip'));
  await expect(outside.getByRole('button')).toHaveCount(0);
  await expect(cell('2099-01-07').locator('.agenda-month-more-chip')).toHaveCount(0);

  await page.getByRole('button', { name: 'Expandir calendario' }).click();
  await expect(links(date)).toHaveCount(2);
  await expectCentered(cell(busyDay), overflow);
  await expectCentered(sunday, closedChip);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectCentered(cell(busyDay), overflow);
  await expectCentered(sunday, closedChip);
  expect(await page.locator('html').evaluate((element) => element.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 390, height: 730 });
  const single = sunday.getByRole('button', { name: '+1', exact: true });
  await expect(single).toHaveAccessibleDescription('Mostrar 1 turno adicional');
  await expectCentered(sunday, sunday.locator('.agenda-month-more-chip'));
  await single.click();
  await expect(dialog.getByRole('link', { name: /Turno completado/ })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await grid.getByRole('button', { name: /mes siguiente/i }).click();
  await expect(grid.locator('.booking-calendar-title')).toContainText(/febrero/i);
  await expectCentered(outside, outside.locator('.agenda-month-closed-chip'));
});

test('Agenda distingue métricas en cero de datos no disponibles', async ({ page, context }) => {
  test.setTimeout(120_000);
  await openAgenda(page);
  const metrics = page.getByRole('region', { name: 'Indicadores del día' });
  for (const label of ['Turnos hoy', 'Riesgo alto']) {
    await expect(
      metrics.getByRole('region', { name: label }).getByText('0', { exact: true }),
    ).toBeVisible();
  }
  await expect(
    metrics.getByRole('region', { name: 'Emails enviados' }).getByText('Sin datos'),
  ).toBeVisible();

  const unavailable = await context.newPage();
  await openAgenda(unavailable, false, [], { failMetrics: true });
  const empty = unavailable.getByRole('region', { name: 'Indicadores del día' });
  for (const label of ['Turnos hoy', 'Clientes', 'Riesgo alto', 'Emails enviados']) {
    await expect(empty.getByRole('region', { name: label }).getByText('Sin datos')).toBeVisible();
  }
  await expect(unavailable.getByRole('region', { name: 'Salud de la agenda' })).toContainText(
    'Datos aún no disponibles',
  );
  await unavailable.close();
});

test('abre desde una fecha del calendario móvil, crea un cliente y limpia el slot al cambiar la fecha', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { writes, slotDates } = await openAgenda(page);
  await page.getByText('Mes', { exact: true }).click();
  await page.locator('.booking-calendar-day[data-date="2099-01-06"]').click();
  const dialog = page.getByRole('dialog', { name: /Nuevo turno/ });
  await expect(dialog.getByLabel('Fecha')).toHaveValue('2099-01-06');
  expect((await dialog.boundingBox())?.width).toBe(390);
  await dialog.getByRole('button', { name: 'Crear cliente' }).click();
  const customerDialog = page.getByRole('dialog').last();
  await customerDialog.getByRole('textbox', { name: 'Nombre y apellido' }).fill('Ana Díaz');
  await customerDialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Cliente' })).toHaveValue('Ana Díaz');
  await selectService(page);
  await expect(dialog.getByText(/No hay horarios disponibles/)).toBeVisible();
  await dialog.getByLabel('Fecha').fill(date);
  await dialog.getByRole('button', { name: '10:00 – 10:30' }).click();
  await dialog.getByLabel('Fecha').fill('2099-01-06');
  await expect(dialog.getByRole('button', { name: 'Confirmar turno' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '10:00 – 10:30' })).toHaveCount(0);
  expect(slotDates).toContain('2099-01-06');
  expect(writes).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByText('Día', { exact: true }).click();
  const lane = page.locator('.booking-calendar-slot[data-time="10:00:00"]');
  await lane.scrollIntoViewIfNeeded();
  const bounds = await lane.boundingBox();
  expect(bounds).not.toBeNull();
  // FullCalendar recibe el clic en una capa interactiva sobre las líneas horarias.
  await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + 4);
  await expect(dialog.getByLabel('Fecha')).toHaveValue(date);
  await selectService(page);
  await expect(dialog.getByRole('button', { name: '10:00 – 10:30' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('mantiene la agenda sin actualizaciones antes del montaje al volver a la pestaña otro día', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await openAgenda(page);
  const grid = page.locator('#agenda-calendar-grid');
  await expect(grid.locator('.booking-calendar-title')).toBeVisible();

  await page.clock.setFixedTime(new Date('2099-01-06T12:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await grid.getByText('Hoy', { exact: true }).click();
  await grid.getByText('Día', { exact: true }).click();
  await expect(grid.locator('[data-date="2099-01-06"]').first()).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Secciones principales' });
  await navigation.getByRole('link', { name: 'Clientes', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await navigation.getByRole('link', { name: 'Agenda', exact: true }).click();
  await expect(grid.locator('.booking-calendar-title')).toBeVisible();

  expect(errors).toEqual([]);
});
