import { expect, test, type Page } from '@playwright/test';

// Resultado esperado del build bajo prueba, no vuelve a decidir el proveedor del cliente.
const api = process.env.E2E_API_URL ?? 'https://turnosmart-backend-demo.onrender.com';
const supabase = 'https://demo.supabase.co';
const userId = '10000000-0000-4000-8000-000000000001';
const user = {
  id: userId,
  email: 'demo@example.invalid',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};
const token = `e30.${Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;

async function mockPublicServices(page: Page, onboarded = true, unavailable = false) {
  const calls: string[] = [];
  const unexpected: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const origin = new URL(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:43128').origin;
    const headers = {
      'access-control-allow-origin': origin,
      'access-control-allow-headers':
        'authorization,content-type,apikey,x-client-info,x-supabase-api-version',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    if (url.startsWith(`${supabase}/auth/v1/`)) {
      calls.push(url);
      const body = url.includes('/token')
        ? {
            access_token: token,
            refresh_token: 'fixture-refresh',
            token_type: 'bearer',
            expires_in: 3600,
            user,
          }
        : {};
      await route.fulfill({ json: body, headers });
    } else if (url.startsWith(`${api}/api/`)) {
      calls.push(url);
      if (unavailable) {
        await route.abort();
        return;
      }
      if (request.method() !== 'OPTIONS')
        expect(request.headers().authorization).toBe(`Bearer ${token}`);
      const body = url.includes('/api/me')
        ? {
            onboarded,
            user: { id: user.id, email: user.email },
            ...(onboarded
              ? {
                  profile: { id: user.id, fullName: 'Demo', role: 'OWNER' },
                  business: {
                    id: '10000000-0000-4000-8000-000000000002',
                    name: 'Negocio demo',
                    timezone: 'UTC',
                    createdAt: '2026-01-01T00:00Z',
                  },
                }
              : {}),
          }
        : { items: [], page: 1, pageSize: 20, total: 0 };
      await route.fulfill({ json: body, headers });
    } else if (new URL(url).origin === origin) await route.continue();
    else {
      unexpected.push(url);
      await route.abort();
    }
  });
  return { calls, unexpected };
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(user.email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
}

test('sin sesion, ruta protegida redirige al login del mismo origen', async ({ page }) => {
  const { unexpected } = await mockPublicServices(page);
  await page.goto('/customers');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
  expect(unexpected).toEqual([]);
});

test('login/recarga/logout usan Supabase y el proveedor fijado al build, con Bearer', async ({
  page,
}) => {
  const { calls, unexpected } = await mockPublicServices(page);
  await signIn(page);
  await expect(page).toHaveURL(/\/customers$/);
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login$/);
  expect(calls.some((url) => url.startsWith(`${supabase}/auth/v1/token`))).toBe(true);
  expect(calls.some((url) => url.startsWith(`${api}/api/customers`))).toBe(true);
  expect(unexpected).toEqual([]);
});

test('un fallo del proveedor elegido muestra el error sin fallback al otro', async ({ page }) => {
  const { calls, unexpected } = await mockPublicServices(page, true, true);
  await signIn(page);
  await expect(page.getByTestId('account-error')).toContainText(
    'No se pudo conectar con el servidor',
  );
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
  expect(calls.some((url) => url.startsWith(`${api}/api/me`))).toBe(true);
  expect(unexpected).toEqual([]);
});

test('cuenta sin negocio redirige a onboarding, sin crear datos', async ({ page }) => {
  const { unexpected } = await mockPublicServices(page, false);
  await signIn(page);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('textbox', { name: /Nombre del negocio/i })).toBeVisible();
  expect(unexpected).toEqual([]);
});
