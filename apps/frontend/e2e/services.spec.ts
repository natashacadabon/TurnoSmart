import { expect, test, type Page, type Route } from '@playwright/test';
import type {
  AvailabilityRuleDto,
  AvailabilityRuleInput,
  Role,
  ServiceDto,
  SlotDto,
} from '@turnosmart/shared';

test.use({ timezoneId: 'America/Los_Angeles' });

const email = process.env.E2E_USER_EMAIL ?? 'ui@turnosmart.test';
const password = process.env.E2E_USER_PASSWORD ?? 'ui-fixture-password';
const fixtureId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const timestamp = '2026-01-01T00:00:00.000Z';
const timezone = 'America/Argentina/Buenos_Aires';
const service: ServiceDto = {
  id: fixtureId,
  name: 'Consulta inicial',
  description: 'Atención individual',
  durationMinutes: 30,
  priceCents: 125050,
  active: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};

async function login(page: Page) {
  await page.goto('/login');
  const submit = page.getByRole('button', { name: 'Ingresar' });
  await expect(submit).toBeEnabled();
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email!);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password!);
  await submit.click();
  await expect(page).toHaveURL(/\/customers/, { timeout: 30_000 });
  await page.getByRole('link', { name: 'Servicios', exact: true }).click();
  await expect(page).toHaveURL(/\/services/, { timeout: 30_000 });
}

function respond(route: Route, json: object, status = 200) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, apikey, x-client-info, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
  };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  return route.fulfill({ status, json, headers });
}

async function fixtures(page: Page, role: Role = 'OWNER', overlapping = false) {
  const user = {
    id: fixtureId,
    email,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: timestamp,
  };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: fixtureId,
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.ui-fixture`;
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
  let services = [service];
  let rules: AvailabilityRuleDto[] = [
    {
      id: fixtureId,
      dayOfWeek: 0,
      startTime: '09:00',
      endTime: '12:00',
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
  if (overlapping) {
    rules.push({ ...rules[0]!, id: secondId, startTime: '11:00', endTime: '13:00' });
  }
  let availabilityReads = 0;
  let slotError = false;
  let slots: SlotDto[] = [
    { startsAt: '2027-03-01T12:00:00.000Z', endsAt: '2027-03-01T12:30:00.000Z' },
  ];
  let slotGate = Promise.resolve();
  const writes: Array<{ method: string; path: string; body: object }> = [];
  await page.route(
    /\/api\/(me|services(?:\/[^/?]+)?|availability-rules|slots)(?:\?.*)?$/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (method === 'OPTIONS') return respond(route, {});
      if (url.pathname === '/api/me') {
        return respond(route, {
          onboarded: true,
          user: { id: fixtureId, email },
          profile: { id: fixtureId, role, fullName: 'Persona E2E' },
          business: { id: fixtureId, name: 'Negocio E2E', timezone, createdAt: timestamp },
        });
      }
      if (url.pathname === '/api/slots') {
        expect(method).toBe('GET');
        await slotGate;
        return slotError
          ? respond(
              route,
              { error: { code: 'FORBIDDEN', message: 'No tenés permiso para consultar horarios' } },
              403,
            )
          : respond(route, {
              data: slots,
            });
      }
      if (method === 'GET') {
        if (url.pathname === '/api/availability-rules') {
          availabilityReads++;
          return respond(route, { data: { timezone, rules } });
        }
        expect(url.searchParams.get('active')).toBe('all');
        return respond(route, {
          data: services,
          meta: { active: 'all', limit: 100, offset: 0, total: services.length },
        });
      }

      const body = request.postDataJSON();
      expect(body).not.toHaveProperty('businessId');
      writes.push({ method, path: url.pathname, body });
      if (url.pathname === '/api/availability-rules') {
        rules = body.rules.map((rule: AvailabilityRuleInput, index: number) => ({
          ...rule,
          id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          createdAt: timestamp,
          updatedAt: timestamp,
        }));
        return respond(route, { data: { timezone, rules } });
      }
      if (method === 'POST') {
        if (body.name === 'Nombre rechazado') {
          return respond(
            route,
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Validación del servidor',
                details: [{ path: 'name', message: 'Nombre rechazado por el servidor' }],
              },
            },
            422,
          );
        }
        if (services.some((item) => item.name === body.name)) {
          return respond(
            route,
            {
              error: { code: 'SERVICE_NAME_CONFLICT', message: 'Nombre duplicado' },
            },
            409,
          );
        }
        const created = { ...service, ...body, id: secondId };
        services = [...services, created];
        return respond(route, { data: created }, 201);
      }
      const id = url.pathname.split('/').at(-1);
      const changed = { ...services.find((item) => item.id === id), ...body };
      services = services.map((item) => (item.id === id ? changed : item));
      return respond(route, { data: changed });
    },
  );
  return {
    writes,
    showcase: () => {
      services = Array.from({ length: 8 }, (_, index) => ({
        ...service,
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        name: [
          'Consulta inicial',
          'Seguimiento',
          'Consulta extendida',
          'Evaluación',
          'Control',
          'Asesoramiento',
          'Tratamiento',
          'Primera entrevista',
        ][index]!,
        description:
          'Atención personalizada y seguimiento profesional con información extensa del servicio.',
        active: index !== 7,
      }));
      rules = [1, 2, 3, 4, 5].flatMap((dayOfWeek) => [
        {
          ...rules[0]!,
          id: `morning-${dayOfWeek}`,
          dayOfWeek,
          startTime: '09:00',
          endTime: '12:00',
        },
        {
          ...rules[0]!,
          id: `afternoon-${dayOfWeek}`,
          dayOfWeek,
          startTime: '15:00',
          endTime: '18:00',
        },
      ]);
    },
    getAvailabilityReads: () => availabilityReads,
    rejectSlots: () => {
      slotError = true;
    },
    resolveSlots: (items: SlotDto[]) => {
      slotError = false;
      slots = items;
    },
    holdSlots: () => {
      let release!: () => void;
      slotGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

test('crea, edita, desactiva y activa servicios con validación y conflicto de nombre', async ({
  page,
}) => {
  const { writes } = await fixtures(page);
  await login(page);
  await expect(page.getByRole('row', { name: /Consulta inicial/ })).toContainText(
    'Atención individual',
  );
  await page.getByRole('button', { name: 'Nuevo servicio' }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByRole('textbox', { name: 'Nombre', exact: true });
  await name.fill(' ');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialog).toBeVisible();
  expect(writes).toHaveLength(0);

  await name.fill(service.name);
  await dialog.getByLabel('Duración (minutos)').fill('45');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialog.getByText('Ya existe un servicio con ese nombre.')).toBeVisible();
  await name.fill('Nombre rechazado');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialog.getByText('Nombre rechazado por el servidor')).toBeVisible();
  await name.fill('Consulta extendida');
  await dialog.getByLabel('Descripción').fill('Incluye seguimiento');
  await dialog.getByLabel('Precio').fill('99.50');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialog).toBeHidden();
  expect(writes.at(-1)).toMatchObject({
    method: 'POST',
    body: { name: 'Consulta extendida', priceCents: 9950, durationMinutes: 45 },
  });

  const row = page.getByRole('row', { name: /Consulta extendida/ });
  await expect(row).toContainText('Incluye seguimiento');
  await row.getByRole('button', { name: /Editar/ }).click();
  await dialog.getByLabel('Duración (minutos)').fill('60');
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(row).toContainText('60');
  expect(writes.at(-1)).toMatchObject({ method: 'PATCH', body: { durationMinutes: 60 } });

  await row.getByRole('button', { name: /Más acciones/ }).click();
  await page.getByRole('menuitem', { name: 'Desactivar servicio', exact: true }).click();
  await expect(row).toContainText('Inactivo');
  expect(writes.at(-1)).toMatchObject({ method: 'PATCH', body: { active: false } });
  await row.getByRole('button', { name: /Más acciones/ }).click();
  await page.getByRole('menuitem', { name: 'Activar servicio', exact: true }).click();
  await expect(row).toContainText('Activo');
  expect(writes.at(-1)).toMatchObject({ method: 'PATCH', body: { active: true } });
});

test('muestra un solapamiento guardado y permite corregir la franja sin quitarla', async ({
  page,
}) => {
  const { writes } = await fixtures(page, 'OWNER', true);
  await login(page);
  await expect(page.getByText(/La disponibilidad guardada tiene errores/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Editar disponibilidad del domingo', exact: true })
    .click();
  const save = page.getByRole('button', { name: 'Guardar cambios' });
  await expect(page.getByText(/Se solapa con la franja 09:00–12:00/)).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByLabel('Inicio domingo 2').fill('12:00');
  await save.click();
  await expect(page.getByText('Disponibilidad guardada.')).toBeVisible();
  expect(writes.at(-1)?.body).toEqual({
    rules: [
      { dayOfWeek: 0, startTime: '09:00', endTime: '12:00', active: true },
      { dayOfWeek: 0, startTime: '12:00', endTime: '13:00', active: true },
    ],
  });
});

test('edita un día, conserva el borrador al navegar y guarda franjas adyacentes', async ({
  page,
}) => {
  const { writes, getAvailabilityReads } = await fixtures(page);
  await login(page);
  await expect(page.getByRole('heading', { name: 'Disponibilidad semanal' })).toBeVisible();
  const sunday = page.getByRole('button', {
    name: 'Editar disponibilidad del domingo',
    exact: true,
  });
  const monday = page.getByRole('button', { name: 'Editar disponibilidad del lunes', exact: true });
  const save = page
    .getByRole('dialog')
    .getByRole('button', { name: 'Guardar cambios', exact: true });
  await expect(
    page.getByRole('group', { name: 'Semana de atención' }).getByRole('button'),
  ).toHaveCount(7);
  await sunday.click();
  await expect(page.getByLabel('Inicio domingo 1')).toHaveValue('09:00');
  await expect(save).toBeDisabled();

  await page.getByRole('button', { name: /Agregar franja/ }).click();
  const start = page.getByLabel('Inicio domingo 2');
  const end = page.getByLabel('Fin domingo 2');
  await start.fill('13:00');
  await end.fill('12:00');
  await expect(save).toBeDisabled();
  await start.fill('11:00');
  await end.fill('13:00');
  await expect(save).toBeDisabled();
  expect(writes).toHaveLength(0);

  await start.fill('12:00');
  await expect(page.getByText(/cambios.*sin guardar/i)).toBeVisible();
  const confirmation = page.waitForEvent('dialog').then(async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('link', { name: 'Clientes', exact: true }).click();
  await confirmation;
  await expect(page).toHaveURL(/\/services/, { timeout: 30_000 });
  await monday.focus();
  await monday.press('Enter');
  await expect(page.getByLabel('Inicio domingo 2')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await sunday.click();
  await expect(start).toHaveValue('12:00');
  expect(getAvailabilityReads()).toBe(1);

  await save.click();
  await expect(page.getByText('Disponibilidad guardada.')).toBeVisible();
  expect(writes.at(-1)).toEqual({
    method: 'PUT',
    path: '/api/availability-rules',
    body: {
      rules: [
        { dayOfWeek: 0, startTime: '09:00', endTime: '12:00', active: true },
        { dayOfWeek: 0, startTime: '12:00', endTime: '13:00', active: true },
      ],
    },
  });

  await page.reload();
  await sunday.click();
  await expect(start).toHaveValue('12:00');
  await expect(end).toHaveValue('13:00');
  await expect(save).toBeDisabled();
});

test('habilita un día y confirma el reemplazo de franjas al copiar en mobile', async ({ page }) => {
  const { writes } = await fixtures(page);
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  const sunday = page.getByRole('button', {
    name: 'Editar disponibilidad del domingo',
    exact: true,
  });
  const monday = page.getByRole('button', { name: 'Editar disponibilidad del lunes', exact: true });
  await monday.click();
  const attendance = page.getByLabel(/Atender el lunes/i);
  await expect(attendance).not.toBeChecked();
  await attendance.check();
  await page.getByLabel('Inicio lunes 1').fill('10:00');
  await page.getByLabel('Fin lunes 1').fill('11:00');

  await page.getByRole('button', { name: 'Copiar horario a otros días' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copiar horario a otros días', exact: true });
  await dialog.getByRole('checkbox', { name: /Domingo/ }).check();
  await expect(dialog.getByText(/reemplaz/i).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await sunday.click();
  await expect(page.getByLabel('Inicio domingo 1')).toHaveValue('09:00');

  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await monday.click();
  await page.getByRole('button', { name: 'Copiar horario a otros días' }).click();
  await dialog.getByRole('checkbox', { name: /Domingo/ }).check();
  await dialog.getByRole('checkbox', { name: /Martes/ }).check();
  await dialog.getByRole('button', { name: 'Copiar horario', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await sunday.click();
  await expect(page.getByLabel('Inicio domingo 1')).toHaveValue('10:00');
  await expect(page.getByLabel('Fin domingo 1')).toHaveValue('11:00');

  await page.getByLabel(/Atender el domingo/i).uncheck();
  await expect(page.getByLabel(/Atender el domingo/i)).not.toBeChecked();
  await page.getByRole('button', { name: /Eliminar franja 1 del domingo/ }).click();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Disponibilidad guardada.')).toBeVisible();
  expect(writes.at(-1)).toEqual({
    method: 'PUT',
    path: '/api/availability-rules',
    body: {
      rules: [
        { dayOfWeek: 1, startTime: '10:00', endTime: '11:00', active: true },
        { dayOfWeek: 2, startTime: '10:00', endTime: '11:00', active: true },
      ],
    },
  });
});
test('Staff consulta horarios en la zona del negocio y ve el error del servidor', async ({
  page,
}) => {
  const { rejectSlots, writes } = await fixtures(page, 'STAFF');
  await login(page);
  await expect(page.getByRole('row', { name: /Consulta inicial/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo servicio' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Consultar horarios', exact: true }).click();
  await page.getByRole('combobox', { name: 'Servicio', exact: true }).click();
  await page.getByRole('option', { name: /Consulta inicial/ }).click();
  await page.getByLabel(/^Fecha/).fill('2027-03-01');
  const request = page.waitForRequest(
    (item) => item.method() === 'GET' && item.url().includes('/api/slots?'),
  );
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
  const params = new URL((await request).url()).searchParams;
  expect(Object.fromEntries(params)).toEqual({ serviceId: fixtureId, date: '2027-03-01' });
  await expect(page.getByRole('button', { name: '09:00 – 09:30' })).toBeVisible();

  rejectSlots();
  await page.getByLabel(/^Fecha/).fill('2027-03-02');
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /permiso/i })).toBeVisible();
  expect(writes).toHaveLength(0);
});

test('horarios: rangos reales, selección accesible, loading, vacío y reintento responsive', async ({
  page,
}, testInfo) => {
  const { writes, resolveSlots, rejectSlots, holdSlots } = await fixtures(page, 'STAFF');
  const available = [
    { startsAt: '2027-03-01T12:00:00.000Z', endsAt: '2027-03-01T12:30:00.000Z' },
    { startsAt: '2027-03-01T17:00:00.000Z', endsAt: '2027-03-01T18:00:00.000Z' },
    { startsAt: '2027-03-02T02:45:00.000Z', endsAt: '2027-03-02T03:15:00.000Z' },
  ];
  resolveSlots(available);
  await login(page);
  await page.getByRole('button', { name: 'Consultar horarios', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Consultar horarios' });
  const consult = panel.getByRole('button', { name: 'Consultar', exact: true });
  await expect(consult).toBeDisabled();
  await expect(panel.getByText('Zona horaria del negocio: Buenos Aires')).toBeVisible();
  await expect(
    panel.getByText(/Consultar o seleccionar un horario no genera una reserva/),
  ).toBeVisible();
  await panel.getByRole('combobox', { name: 'Servicio', exact: true }).click();
  await page.getByRole('option', { name: /Consulta inicial/ }).click();
  const date = panel.getByLabel(/^Fecha/);
  await date.fill('2027-03-01');
  const release = holdSlots();
  await consult.click();
  await expect(panel.getByRole('progressbar')).toBeVisible();
  await expect(date).toBeDisabled();
  await expect(panel.getByRole('combobox')).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Consultando…', exact: true })).toBeDisabled();
  release();
  await expect(panel.getByText('3 horarios disponibles', { exact: true })).toBeVisible();
  const morning = panel.getByRole('button', { name: '09:00 – 09:30' });
  const afternoon = panel.getByRole('button', { name: '14:00 – 15:00' });
  await expect(panel.getByRole('list', { name: /mañana/ })).toContainText('09:00 – 09:30');
  await expect(panel.getByRole('list', { name: /tarde y noche/ })).toContainText('14:00 – 15:00');
  await expect(panel.getByRole('button', { name: '23:45 – 00:15' })).toBeVisible();
  await morning.focus();
  await morning.press('Space');
  await expect(morning).toHaveAttribute('aria-pressed', 'true');
  await afternoon.focus();
  await afternoon.press('Enter');
  await expect(afternoon).toHaveAttribute('aria-pressed', 'true');
  await expect(morning).toHaveAttribute('aria-pressed', 'false');
  for (const width of [390, 320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const bounds = await afternoon.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(36);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    if (width !== 320) {
      await panel.screenshot({ path: testInfo.outputPath(`horarios-${width}.png`) });
    }
  }
  await date.fill('2027-03-02');
  await expect(afternoon).toHaveCount(0);
  resolveSlots([]);
  await consult.click();
  await expect(panel.getByText('No hay horarios disponibles.', { exact: true })).toBeVisible();
  rejectSlots();
  await panel.getByRole('button', { name: 'Reintentar' }).click();
  await expect(panel.getByRole('alert')).toContainText('No tenés permiso');
  resolveSlots(available);
  const retry = page.waitForRequest(
    (request) => request.method() === 'GET' && request.url().includes('/api/slots?'),
  );
  await panel.getByRole('button', { name: 'Reintentar' }).click();
  expect(Object.fromEntries(new URL((await retry).url()).searchParams)).toEqual({
    serviceId: fixtureId,
    date: '2027-03-02',
  });
  await expect(morning).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test('consulta de horarios usa Express con una sesión real', async ({ page }) => {
  test.skip(
    !process.env.E2E_USER_EMAIL || !process.env.E2E_USER_PASSWORD,
    'Requiere servidores reales y cuenta E2E provisionada.',
  );
  await login(page);
  await page.getByRole('button', { name: 'Consultar horarios', exact: true }).click();
  await page.getByRole('combobox', { name: 'Servicio', exact: true }).click();
  const firstOption = page.getByRole('option').first();
  await expect(firstOption, 'Provisionar un servicio activo en el negocio E2E').toBeVisible();
  await firstOption.click();
  await page.getByLabel(/^Fecha/).fill('2099-01-05');
  const response = page.waitForResponse(
    (item) => item.request().method() === 'GET' && item.url().includes('/api/slots?'),
  );
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
  const result = await response;
  expect(result.ok()).toBe(true);
  expect(await result.json()).toMatchObject({ data: expect.any(Array) });
});

for (const width of [1920, 1440, 1366, 1024, 768, 375]) {
  test(`servicios responsive ${width}px: catálogo, jornadas partidas y días cerrados`, async ({
    page,
  }, testInfo) => {
    const { showcase, getAvailabilityReads, writes } = await fixtures(page);
    showcase();
    await page.setViewportSize({ width, height: 768 });
    await login(page);
    await expect(page.getByText('8 servicios totales')).toBeVisible();
    await expect(page.getByText('7 servicios activos')).toBeVisible();
    await expect(page.getByText('30 h semanales de atención')).toBeVisible();
    const catalog = page.getByRole('region', { name: 'Catálogo de servicios', exact: true });
    const availability = page.getByRole('region', { name: 'Disponibilidad semanal', exact: true });
    const slots = page.getByRole('region', { name: 'Consultar horarios', exact: true });
    for (const card of [catalog, availability, slots]) {
      await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      expect(await card.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(
        true,
      );
    }
    if (width >= 1200) {
      const left = (await catalog.boundingBox())!;
      const right = (await availability.boundingBox())!;
      expect(Math.abs(left.y - right.y)).toBeLessThan(1);
      expect(Math.abs(left.height - right.height)).toBeLessThan(1);
    } else {
      const top = (await catalog.boundingBox())!;
      const bottom = (await availability.boundingBox())!;
      expect(bottom.y).toBeGreaterThanOrEqual(top.y + top.height);
    }
    const week = page.getByRole('group', { name: 'Semana de atención' });
    await expect(week.getByRole('button')).toHaveCount(7);
    await expect(week.getByText('Cerrado', { exact: true })).toHaveCount(2);
    await expect(week.getByText('09:00–12:00', { exact: true })).toHaveCount(5);
    await expect(week.getByText('15:00–18:00', { exact: true })).toHaveCount(5);
    await expect(
      page.getByRole('button', { name: 'Consultar horarios', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    if (width >= 1366)
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        768,
      );
    await page.screenshot({ path: testInfo.outputPath(`services-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Página siguiente' }).click();
    await expect(page.getByRole('row', { name: /Primera entrevista/ })).toBeVisible();
    await page.getByRole('combobox', { name: 'Estado', exact: true }).click();
    await page.getByRole('option', { name: 'Inactivos', exact: true }).click();
    await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
    if (width >= 1200) {
      expect(
        Math.abs(
          (await catalog.boundingBox())!.height - (await availability.boundingBox())!.height,
        ),
      ).toBeLessThan(1);
    }
    await page.getByRole('textbox', { name: 'Buscar por nombre' }).fill('sin coincidencias');
    await expect(page.getByText('No hay resultados', { exact: true })).toBeVisible();
    expect(getAvailabilityReads()).toBe(1);
    expect(writes).toHaveLength(0);
  });
}
