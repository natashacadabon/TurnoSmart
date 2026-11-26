import { expect, test, type Page, type Route } from '@playwright/test';

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;

// Sin cuenta de prueba el E2E falla: "no hay tests" no debe interpretarse como éxito.
if (!email || !password) {
  throw new Error(
    'Definir E2E_USER_EMAIL y E2E_USER_PASSWORD (cuenta de prueba provisionada en Supabase)',
  );
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email!);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Ingresar' }).click();

  // Una cuenta nueva pasa por el onboarding una única vez.
  await page.waitForURL(/\/(customers|onboarding)/);
  if (page.url().includes('/onboarding')) {
    await page.getByLabel('Nombre del negocio').fill('Negocio E2E');
    await page.getByRole('button', { name: 'Crear negocio' }).click();
  }
  await expect(page).toHaveURL(/\/customers/);
}

test('credenciales inválidas muestran error y permiten reintentar', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email!);
  await page
    .getByRole('textbox', { name: 'Contraseña', exact: true })
    .fill('contraseña-incorrecta');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'incorrectos' })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('ruta protegida sin sesión redirige a login', async ({ page }) => {
  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login/);
});

test('recuperación ante error: API caída → error visible → reintentar → salir', async ({
  page,
}) => {
  await login(page);

  // Con sesión válida, la API no puede resolver la cuenta: nunca debe quedar cargando.
  const apiDown = (route: Route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Servicio no disponible' },
      }),
    });
  await page.route('**/api/me', apiDown);
  await page.reload();
  await expect(
    page.getByRole('alert').filter({ hasText: 'No se pudo cargar tu cuenta' }),
  ).toBeVisible();
  await expect(page.getByTestId('account-error')).toContainText('Servicio no disponible');

  // Cuando la API vuelve, "Reintentar" recupera la pantalla sin recargar ni volver a iniciar sesión.
  await page.unroute('**/api/me', apiDown);
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();

  // Desde el estado de error también se puede cerrar la sesión.
  await page.route('**/api/me', apiDown);
  await page.reload();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login/);
  await page.unroute('**/api/me', apiDown);
  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login/);
});

test('recorrido crítico: login → cliente → recarga → edición → baja → logout', async ({ page }) => {
  const name = `Cliente E2E ${Date.now()}`;
  await login(page);

  // Alta con validación del servidor.
  await page.getByRole('button', { name: 'Nuevo cliente' }).click();
  await page.getByLabel('Nombre y apellido').fill(name);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('no-es-un-email');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();

  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('e2e@example.com');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Persistencia tras recargar (sesión recuperada).
  await page.reload();
  await page.getByLabel('Buscar clientes').fill(name);
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();

  // Edición persistente.
  await row.getByRole('button', { name: `Editar ${name}` }).click();
  await page.getByLabel('Teléfono').fill('221 555-0000');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.reload();
  await page.getByLabel('Buscar clientes').fill(name);
  await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('221 555-0000');

  // Baja: se confirma, desaparece y no vuelve al recargar.
  await page.getByRole('button', { name: `Eliminar ${name}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await page.getByLabel('Buscar clientes').fill(name);
  await expect(page.getByText('Sin resultados')).toBeVisible();

  // Logout cierra la sesión.
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login/);
});
