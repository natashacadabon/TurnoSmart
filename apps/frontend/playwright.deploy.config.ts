import { defineConfig } from '@playwright/test';

/** Smoke de build productivo con Auth/API simuladas; nunca usa cuentas/BD reales. */
export default defineConfig({
  testDir: './e2e-deploy',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:43128',
    channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome',
    headless: true,
  },
});
