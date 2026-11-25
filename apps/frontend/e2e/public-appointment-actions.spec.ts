import { expect, test, type Page } from '@playwright/test';
import type { AppointmentPublicAction } from '@turnosmart/shared';

const token = 'test-action-token';
const preview = {
  businessName: 'Consultorio Sur',
  serviceName: 'Consulta',
  startsAt: '2099-01-05T13:00:00.000Z',
  timezone: 'America/Argentina/Buenos_Aires',
  allowed: true,
};
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function openAction(
  page: Page,
  action: AppointmentPublicAction,
  status = 200,
  allowed = true,
) {
  const writes: unknown[] = [];
  await page.route(/\/api\/public\/appointment-actions(?:\/preview|\/slots)?$/, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    expect(req.method()).toBe('POST');
    expect(req.headers().authorization).toBeUndefined();
    expect(req.postDataJSON()).toMatchObject({ token });
    if (req.url().endsWith('/preview'))
      return route.fulfill({
        status,
        headers,
        json:
          status === 200
            ? { ...preview, action, allowed }
            : { error: { code: 'NOT_FOUND', message: 'Enlace no encontrado' } },
      });
    if (req.url().endsWith('/slots'))
      return route.fulfill({
        headers,
        json: {
          data: [{ startsAt: '2099-01-05T14:00:00.000Z', endsAt: '2099-01-05T14:30:00.000Z' }],
        },
      });
    writes.push(req.postDataJSON());
    return route.fulfill({ status: 204, headers });
  });
  await page.goto('/turno/gestionar#token=' + token);
  return writes;
}

test('requiere confirmar la cancelación explícitamente en pantalla móvil', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const writes = await openAction(page, 'CANCEL');
  await expect(page.getByRole('heading', { name: 'Cancelar turno' })).toBeVisible();
  await expect(page).toHaveURL(/\/turno\/gestionar$/);
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: 'Cancelar turno', exact: true }).click();
  await page.getByRole('button', { name: 'Conservar turno' }).click();
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: 'Cancelar turno', exact: true }).click();
  await page.getByRole('button', { name: 'Sí, cancelar turno' }).click();
  await expect(page.getByText('Tu turno fue cancelado.').first()).toBeVisible();
  expect(writes).toEqual([{ token, confirmed: true }]);
});

test('confirma asistencia solo con una acción del cliente', async ({ page }) => {
  const writes = await openAction(page, 'CONFIRM');
  await expect(page.getByText('Consultorio Sur')).toBeVisible();
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: 'Confirmar asistencia' }).click();
  await expect(page.getByText('Tu asistencia quedó confirmada.').first()).toBeVisible();
  expect(writes).toEqual([{ token, confirmed: true }]);
});

test('elige un horario del backend y conserva el turno hasta la aprobación', async ({ page }) => {
  const writes = await openAction(page, 'REQUEST_RESCHEDULE');
  const submit = page.getByRole('button', { name: 'Enviar solicitud' });
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: '11:00 – 11:30' }).click();
  await submit.click();
  await expect(page.getByText(/Tu horario original sigue reservado/).first()).toBeVisible();
  expect(writes).toEqual([
    { token, confirmed: true, requestedStartsAt: '2099-01-05T14:00:00.000Z' },
  ]);
});

test('muestra un enlace vencido sin habilitar acciones', async ({ page }) => {
  const writes = await openAction(page, 'CANCEL', 404);
  await expect(page.getByText('El enlace venció o ya no está disponible.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar turno' })).toHaveCount(0);
  expect(writes).toEqual([]);
});

for (const action of ['CONFIRM', 'CANCEL', 'REQUEST_RESCHEDULE'] as const) {
  test(`respeta una acción pública deshabilitada: ${action}`, async ({ page }) => {
    const slotRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/appointment-actions/slots')) slotRequests.push(request.url());
    });
    const writes = await openAction(page, action, 200, false);
    await expect(
      page.getByText(
        'Esta acción no está disponible según la configuración y el plazo del negocio.',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Confirmar asistencia|Cancelar turno|Enviar solicitud/ }),
    ).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(slotRequests).toEqual([]);
  });
}
