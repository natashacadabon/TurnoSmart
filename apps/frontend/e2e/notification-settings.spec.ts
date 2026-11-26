import { expect, test, type Page, type Route } from '@playwright/test';
import type { BusinessNotificationPreferences } from '@turnosmart/shared';
import { renderAppointmentEmail, APPOINTMENT_EMAIL_KINDS } from '@turnosmart/shared';

const emailDetails = {
  business: 'Consultorio Sur',
  customer: 'María Pérez',
  service: 'Consulta de seguimiento',
  startsAt: '2099-01-05T13:00:00.000Z',
  timezone: 'America/Argentina/Buenos_Aires',
  professional: 'Dra. Laura Rodríguez',
};
const emailLinks = [
  { label: 'Cancelar turno', url: 'https://example.test/turno#token=cancel' },
  { label: 'Confirmar asistencia', url: 'https://example.test/turno#token=confirm' },
  { label: 'Solicitar reprogramación', url: 'https://example.test/turno#token=reschedule' },
];
const initial: BusinessNotificationPreferences = {
  bookingEmailEnabled: true,
  confirmationEmailEnabled: true,
  cancellationEmailEnabled: true,
  rescheduleEmailEnabled: true,
  remindersEnabled: true,
  reminderHours: [48, 24],
  reminder24hEnabled: true,
  reminder48hEnabled: true,
  customerConfirmationEnabled: true,
  customerCancellationEnabled: true,
  customerRescheduleEnabled: true,
  cancellationMinimumHours: 0,
  rescheduleMinimumHours: 0,
};
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, apikey, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};
async function setup(page: Page) {
  const role = 'OWNER';
  let preferences = { ...initial };
  const writes: object[] = [];
  const user = {
    id: '00000000-0000-4000-8000-000000000003',
    email: 'settings@turnosmart.test',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
  };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }),
    'ui-fixture',
  ].join('.');
  const respond = (route: Route, json: object) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers })
      : route.fulfill({ json, headers });
  await page.route(/\/auth\/v1\/(token|user)(\?.*)?$/, (route) =>
    respond(
      route,
      route.request().url().includes('/token')
        ? {
            access_token: token,
            refresh_token: 'fixture',
            expires_in: 3600,
            token_type: 'bearer',
            user,
          }
        : user,
    ),
  );
  await page.route(/\/api\/.*$/, (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return respond(route, {});
    if (url.pathname === '/api/me')
      return respond(route, {
        access: 'OWNER',
        onboarded: true,
        user,
        profile: { id: user.id, role, fullName: 'Operadora' },
        business: {
          id: '00000000-0000-4000-8000-000000000004',
          name: 'Consultorio Sur',
          timezone: 'America/Argentina/Buenos_Aires',
          createdAt: user.created_at,
        },
      });
    if (url.pathname.includes('/notification-preferences/preview/'))
      return respond(
        route,
        renderAppointmentEmail(
          url.pathname.split('/').at(-1) as Parameters<typeof renderAppointmentEmail>[0],
          emailDetails,
          url.pathname.endsWith('/CANCELLED') ? [] : emailLinks,
        ),
      );
    if (url.pathname.endsWith('/notification-preferences')) {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON();
        writes.push(body);
        preferences = { ...preferences, ...body };
      }
      return respond(route, preferences);
    }
    if (url.pathname.endsWith('/sync-upcoming')) return respond(route, { items: [] });
    return respond(route, {
      data: [],
      items: [],
      unreadCount: 0,
      meta: { total: 0 },
      nextCursor: null,
    });
  });
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(user.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('ui-fixture-password');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await page.goto('/settings');
  await expect(
    page.getByRole('heading', { name: 'Notificaciones por correo', exact: true }),
  ).toBeVisible();
  return writes;
}
for (const width of [1920, 1440, 1366, 1024, 768, 375]) {
  test(`configuración compacta y sin desbordes a ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 768 });
    await setup(page);
    await page.getByRole('button', { name: 'Agregar recordatorio' }).click();
    await expect(page.getByText('3 de 3 recordatorios configurados')).toBeVisible();
    const mail = await page
      .getByRole('region', { name: 'Notificaciones por correo', exact: true })
      .boundingBox();
    const actions = await page
      .getByRole('region', { name: 'Gestión de turnos por parte del cliente', exact: true })
      .boundingBox();
    expect(mail).not.toBeNull();
    expect(actions).not.toBeNull();
    if (width >= 900) {
      expect(Math.abs(mail!.y - actions!.y)).toBeLessThan(2);
      expect(Math.abs(mail!.width - actions!.width)).toBeLessThan(2);
    } else expect(actions!.y).toBeGreaterThan(mail!.y + mail!.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (width >= 1366)
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight),
      ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`settings-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Vista previa de emails' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page
        .frameLocator('iframe[title="Contenido del email"]')
        .getByRole('heading', { name: 'Tu turno está reservado' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    await expect(page.getByText('2 de 3 recordatorios configurados')).toBeVisible();
  });
}
test('preserva dependencias, guardado y descarte', async ({ page }) => {
  const writes = await setup(page);
  await page.getByRole('switch', { name: 'Permitir que el cliente cancele por enlace' }).uncheck();
  await expect(
    page.getByRole('spinbutton', { name: 'Anticipación mínima para cancelar (horas)' }),
  ).toBeDisabled();
  await page.getByRole('switch', { name: 'Recordatorios automáticos', exact: true }).uncheck();
  await expect(page.getByRole('button', { name: 'Agregar recordatorio' })).toBeDisabled();
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByText('Preferencias de notificaciones guardadas')).toBeVisible();
  expect(writes).toEqual([{ remindersEnabled: false, customerCancellationEnabled: false }]);
  await page.getByRole('switch', { name: 'Email al reservar' }).uncheck();
  await page.getByRole('button', { name: 'Descartar', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Email al reservar' })).toBeChecked();
});
for (const width of [1366, 375]) {
  test(`vista previa real con un único scroll a ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 768 });
    await setup(page);
    await page.getByRole('button', { name: 'Vista previa de emails' }).click();
    const dialog = page.getByRole('dialog');
    const frame = page.frameLocator('iframe[title="Contenido del email"]');
    await expect(frame.getByRole('heading', { name: 'Tu turno está reservado' })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Tipo de email' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cerrar', exact: true })).toBeInViewport();
    expect(
      await dialog.evaluate(
        (element) =>
          [...element.querySelectorAll<HTMLElement>('*'), element].filter(
            (node) =>
              ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) &&
              node.scrollHeight > node.clientHeight,
          ).length,
      ),
    ).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`preview-top-${width}.png`) });
    const actions = frame.getByRole('link');
    await expect(actions).toHaveText([
      'Confirmar asistencia',
      'Solicitar reprogramación',
      'Cancelar turno',
    ]);
    const boxes = await actions.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height, y: rect.y };
      }),
    );
    expect(new Set(boxes.map((box) => Math.round(box.width))).size).toBe(1);
    expect(new Set(boxes.map((box) => Math.round(box.height))).size).toBe(1);
    expect(boxes.every((box) => box.height >= 42 && box.height <= 46)).toBe(true);
    expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height);
    expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y + boxes[1]!.height);
    await expect(actions.nth(0)).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(actions.nth(1)).toHaveCSS('color', 'rgb(37, 99, 235)');
    await expect(actions.nth(2)).toHaveCSS('color', 'rgb(220, 38, 38)');
    expect(
      await frame.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await frame.getByText('Enviado con').scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('combobox', { name: 'Tipo de email' })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Cerrar', exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`preview-actions-${width}.png`) });
    await dialog.getByRole('combobox', { name: 'Tipo de email' }).click();
    await page.getByRole('option', { name: 'Cancelación', exact: true }).click();
    await expect(frame.getByRole('heading', { name: 'Tu turno fue cancelado' })).toBeVisible();
    await expect(frame.getByRole('link')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(dialog).toBeHidden();
  });
  test(`plantillas de correo desktop y mobile ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: width === 1366 ? 680 : width, height: 900 });
    for (const kind of APPOINTMENT_EMAIL_KINDS) {
      const rendered = renderAppointmentEmail(
        kind,
        {
          ...emailDetails,
          ...(kind === 'RESCHEDULED' ? { previousStartsAt: '2099-01-04T13:00:00.000Z' } : {}),
        },
        kind === 'CANCELLED' ? [] : emailLinks,
      );
      await page.setContent(rendered.html);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(rendered.subject);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await expect(page.getByText('Buenos Aires (UTC-03:00)', { exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`email-${kind}-${width}.png`),
        fullPage: true,
      });
    }
  });
}
