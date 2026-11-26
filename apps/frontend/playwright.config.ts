import { defineConfig, devices } from '@playwright/test';

/**
 * E2E del recorrido crítico (A09), sin mocks: frontend + API + Supabase reales.
 * Requiere los servidores levantados y una cuenta de prueba provisionada (ver README).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
