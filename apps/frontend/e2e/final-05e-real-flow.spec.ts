import { expect, test, type Page } from '@playwright/test';
import type { AvailabilityRuleInput, AvailabilityRulesResponse } from '@turnosmart/shared';

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;

test.describe('FINAL-05E · recorrido funcional real', () => {
  test.skip(
    !email || !password,
    'Definir E2E_USER_EMAIL y E2E_USER_PASSWORD para ejecutar el recorrido contra Auth/API/DB reales',
  );
  test.describe.configure({ mode: 'serial' });

  let restoreAvailability: { origin: string; rules: AvailabilityRuleInput[] } | null = null;

  async function authenticatedRequest<T>(
    page: Page,
    origin: string,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) {
    return page.evaluate(
      async ({ origin, path, method, body }) => {
        const entry = Object.entries(localStorage).find(([key]) => key.endsWith('-auth-token'));
        if (!entry) throw new Error('No se encontró la sesión de Supabase para el E2E real');
        const session = JSON.parse(entry[1]) as { access_token?: string };
        if (!session.access_token) throw new Error('La sesión de Supabase no tiene access_token');
        const response = await fetch(origin + path, {
          method: method ?? 'GET',
          headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            Authorization: `Bearer ${session.access_token}`,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        const result = text ? JSON.parse(text) : undefined;
        if (!response.ok) throw new Error(`API E2E ${response.status}: ${text}`);
        return result as T;
      },
      { origin, path, method: init.method, body: init.body },
    );
  }

  test.afterEach(async ({ page }) => {
    if (!restoreAvailability) return;
    const { origin, rules } = restoreAvailability;
    restoreAvailability = null;
    await authenticatedRequest(page, origin, '/api/availability-rules', {
      method: 'PUT',
      body: { rules },
    });
  });

  async function login(page: Page) {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email!);
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.waitForURL(/\/(customers|onboarding)/, { timeout: 30_000 });

    if (page.url().includes('/onboarding')) {
      await page.getByLabel('Nombre del negocio').fill(`Negocio E2E ${Date.now()}`);
      await page.getByRole('button', { name: 'Crear negocio' }).click();
    }
    await expect(page).toHaveURL(/\/customers$/);
  }

  function futureBusinessDate(timezone: string, days: number) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(new Date());
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.UTC(year, month - 1, day + days, 12)));
  }

  test('completa reserva, confirmación, reprogramación, cierre e historial con datos reales', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    let apiOrigin = '';
    page.on('request', (request) => {
      try {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/')) apiOrigin = url.origin;
      } catch {
        // Las URLs del navegador ya fueron validadas por Playwright.
      }
    });

    const suffix = Date.now();
    const customerName = `FINAL05E Cliente ${suffix}`;
    const serviceName = `FINAL05E Servicio ${suffix}`;

    await login(page);

    // Cliente real persistido mediante la pantalla de clientes.
    await page.getByRole('button', { name: 'Nuevo cliente' }).click();
    const customerDialog = page.getByRole('dialog', { name: /Nuevo cliente/ });
    await customerDialog.getByLabel('Nombre y apellido').fill(customerName);
    await customerDialog
      .getByRole('textbox', { name: 'Email', exact: true })
      .fill(`final05e-${suffix}@example.com`);
    await customerDialog.getByRole('button', { name: 'Guardar' }).click();
    await expect(customerDialog).toBeHidden();
    await page.getByLabel('Buscar clientes').fill(customerName);
    await expect(page.getByRole('row', { name: new RegExp(customerName) })).toBeVisible();

    // Servicio real persistido mediante la pantalla de servicios.
    await page.goto('/services');
    await expect(page.getByRole('heading', { name: 'Servicios', exact: true })).toBeVisible();

    if (!apiOrigin) throw new Error('No se pudo detectar la URL de la API real');
    const originalAvailability = await authenticatedRequest<AvailabilityRulesResponse>(
      page,
      apiOrigin,
      '/api/availability-rules',
    );
    restoreAvailability = {
      origin: apiOrigin,
      rules: originalAvailability.data.rules.map(({ dayOfWeek, startTime, endTime, active }) => ({
        dayOfWeek,
        startTime,
        endTime,
        active,
      })),
    };

    await page.getByRole('button', { name: 'Nuevo servicio' }).click();
    const serviceDialog = page.getByRole('dialog', { name: /Nuevo servicio/ });
    await serviceDialog.getByLabel('Nombre').fill(serviceName);
    await serviceDialog
      .getByLabel('Descripción')
      .fill('Servicio creado por el recorrido FINAL-05E.');
    await serviceDialog.getByLabel('Duración (minutos)').fill('30');
    await serviceDialog.getByRole('button', { name: 'Guardar' }).click();
    await expect(serviceDialog).toBeHidden();
    await expect(page.getByText(serviceName, { exact: true })).toBeVisible();

    // Se configura una franja estable en todos los días para que el caso no dependa del día de ejecución.
    const monday = page.getByRole('button', { name: 'Editar disponibilidad del lunes' });
    await monday.click();
    const editor = page.getByRole('dialog', { name: /Horarios del lunes/ });
    const removeRange = editor.getByRole('button', { name: /Eliminar franja/ });
    while ((await removeRange.count()) > 0) await removeRange.first().click();

    const openSwitch = editor.getByRole('switch');
    if (!(await openSwitch.isChecked())) await openSwitch.check();
    if ((await removeRange.count()) === 0) {
      await editor.getByRole('button', { name: 'Agregar franja' }).click();
    }
    await editor.getByLabel('Inicio lunes 1').fill('08:00');
    await editor.getByLabel('Fin lunes 1').fill('20:00');

    await editor.getByRole('button', { name: 'Copiar horario a otros días' }).click();
    const copyDialog = page.getByRole('dialog', { name: /Copiar horario a otros días/ });
    for (const checkbox of await copyDialog.getByRole('checkbox').all()) await checkbox.check();
    await copyDialog.getByRole('button', { name: 'Copiar horario' }).click();
    await editor.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(
      editor.getByRole('alert').filter({ hasText: 'Disponibilidad guardada' }),
    ).toBeVisible();
    const timezoneText = await page
      .getByText(/Horarios de atención · /)
      .first()
      .textContent();
    const timezone = timezoneText?.split('·').at(-1)?.trim() ?? 'America/Argentina/Buenos_Aires';
    await editor.getByRole('button', { name: 'Cerrar' }).click();

    // Reserva real desde la agenda.
    await page.getByRole('link', { name: 'Agenda', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Nuevo turno' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Nuevo turno' }).click();
    const appointmentDialog = page.getByRole('dialog', { name: /Nuevo turno/ });
    await appointmentDialog.getByRole('combobox', { name: 'Cliente' }).fill(customerName);
    await page.getByRole('option', { name: new RegExp(customerName) }).click();
    await appointmentDialog.getByRole('combobox', { name: 'Servicio' }).click();
    await page.getByRole('option', { name: new RegExp(`${serviceName} · 30 min`) }).click();
    await appointmentDialog.getByLabel('Fecha').fill(futureBusinessDate(timezone, 7));

    const availableSlots = appointmentDialog
      .getByRole('group', { name: 'Horarios disponibles' })
      .locator('button[aria-pressed]');
    await expect(availableSlots.first()).toBeVisible({ timeout: 30_000 });
    await availableSlots.first().click();
    await appointmentDialog
      .getByRole('textbox', { name: /Observaciones/ })
      .fill('Recorrido funcional FINAL-05E');
    await appointmentDialog.getByRole('button', { name: 'Confirmar turno' }).click();
    await expect(appointmentDialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText(/Turno guardado/)).toBeVisible();
    const appointmentLink = page.getByRole('link', { name: /Turno programado/ });
    await expect(appointmentLink).toBeVisible();
    await appointmentLink.click();
    await expect(page.getByRole('heading', { name: 'Detalle del turno' })).toBeVisible();

    // Confirmación real y persistencia del primer evento.
    await page.getByRole('button', { name: 'Confirmar turno', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Turno confirmado correctamente' }),
    ).toBeVisible({ timeout: 30_000 });
    const history = page.getByRole('list', { name: 'Historial del turno' });
    await expect(history.getByText('Turno creado', { exact: true })).toBeVisible();
    await expect(history.getByText('Turno confirmado', { exact: true })).toBeVisible();

    // Reprogramación real a otro slot disponible del mismo día.
    await page.getByRole('button', { name: 'Reprogramar', exact: true }).click();
    const rescheduleDialog = page.getByRole('dialog', { name: 'Reprogramar turno' });
    const rescheduleSlots = rescheduleDialog
      .getByRole('group', { name: 'Horarios disponibles' })
      .locator('button[aria-pressed]');
    await expect(rescheduleSlots.first()).toBeVisible({ timeout: 30_000 });
    await rescheduleSlots.first().click();
    await rescheduleDialog.getByRole('button', { name: 'Revisar cambio' }).click();
    await rescheduleDialog.getByRole('button', { name: 'Confirmar reprogramación' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Turno reprogramado correctamente' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(history.getByText('Turno reprogramado', { exact: true })).toBeVisible();

    // Cancelación como cierre terminal y comprobación después de recargar.
    await page.getByRole('button', { name: 'Cancelar turno', exact: true }).click();
    const cancelDialog = page.getByRole('dialog', { name: 'Cancelar turno' });
    await cancelDialog.getByRole('button', { name: 'Confirmar cancelación' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Turno cancelado correctamente' }),
    ).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByText('El turno está cerrado.', { exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Acciones del turno' })).toHaveCount(0);
    await expect(
      page.getByRole('list', { name: 'Historial del turno' }).getByText('Turno cancelado', {
        exact: true,
      }),
    ).toBeVisible();

    // Regresión UX mínima: el detalle completo no desborda el viewport móvil.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Detalle del turno' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
});
