import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSupabaseTarget } from '../../src/config/supabase-target.js';
vi.mock('dotenv/config', () => ({}));

const dev = 'a'.repeat(20);
const prod = 'b'.repeat(20);
const db = (ref: string) =>
  `postgresql://postgres:synthetic-secret@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
const pool = (ref: string, port = 6543) =>
  `postgresql://postgres.${ref}:synthetic-secret@aws-0-us-east-1.pooler.supabase.com:${port}/postgres?sslmode=require`;
const config = () => ({
  SUPABASE_URL: `https://${prod}.supabase.co`,
  DATABASE_URL: pool(prod),
  DIRECT_URL: db(prod),
  EXPECTED_DEV_SUPABASE: `https://${dev}.supabase.co`,
  EXPECTED_PRODUCTION_SUPABASE: `https://${prod}.supabase.co`,
  DEPLOY_TARGET: 'production',
  SUPABASE_ANON_KEY: 'sb_publishable_fixture',
});
const originalArgv = process.argv;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  process.argv = originalArgv;
});

describe('identidad Supabase antes de arranque/migración', () => {
  it('valida direct/session/transaction runtime y deriva el entorno de la rama Render', () => {
    expect(assertSupabaseTarget(config())).toBe(prod);
    expect(assertSupabaseTarget({ ...config(), DIRECT_URL: pool(prod, 5432) }, true)).toBe(prod);
    expect(assertSupabaseTarget({ ...config(), DATABASE_URL: db(prod) })).toBe(prod);
    expect(
      assertSupabaseTarget({
        ...config(),
        RENDER: 'true',
        RENDER_GIT_BRANCH: 'main',
        DEPLOY_TARGET: undefined,
      }),
    ).toBe(prod);
    expect(
      assertSupabaseTarget({
        ...config(),
        SUPABASE_URL: `https://${dev}.supabase.co`,
        DATABASE_URL: pool(dev),
        DIRECT_URL: db(dev),
        RENDER: 'true',
        RENDER_GIT_BRANCH: 'dev',
        DEPLOY_TARGET: undefined,
      }),
    ).toBe(dev);
  });

  it.each([
    { DATABASE_URL: db(dev) },
    { DIRECT_URL: db(dev) },
    { SUPABASE_URL: `https://${dev}.supabase.co` },
    { EXPECTED_PRODUCTION_SUPABASE: `https://${dev}.supabase.co` },
    { EXPECTED_PRODUCTION_SUPABASE: undefined },
    { EXPECTED_DEV_SUPABASE: undefined },
    { DEPLOY_TARGET: undefined },
    { DEPLOY_TARGET: undefined, RENDER_GIT_BRANCH: 'main' },
    { DEPLOY_TARGET: 'invalid' },
    { SUPABASE_URL: `https://${prod}.supabase.co/` },
    { EXPECTED_PRODUCTION_SUPABASE: `https://${prod}.supabase.co.attacker.invalid` },
    { DATABASE_URL: db(prod) + '&host=remote.invalid' },
    { DATABASE_URL: db(prod) + '&sslmode=disable' },
    { DATABASE_URL: db(prod).replace('sslmode=require', 'sslmode=disable') },
    { DATABASE_URL: db(prod).replace('synthetic-secret', '') },
    { DATABASE_URL: db(prod).replace('/postgres?', '/other?') },
    { DIRECT_URL: pool(prod) },
    { RENDER: 'true', RENDER_GIT_BRANCH: 'feat/test' },
    { RENDER: 'true', RENDER_GIT_BRANCH: 'dev' },
    { CORS_ENVIRONMENT: 'dev' },
  ])('rechaza configuración incorrecta sin filtrar DSN: %#', (overrides) => {
    expect(() => assertSupabaseTarget({ ...config(), ...overrides }, true)).toThrow();
    try {
      assertSupabaseTarget({ ...config(), ...overrides }, true);
    } catch (error) {
      expect((error as Error).message).not.toContain('synthetic-secret');
    }
  });

  it('migraciones remotas requieren DIRECT_URL y una clave JWT anon debe corresponder al proyecto', () => {
    expect(() => assertSupabaseTarget({ ...config(), DIRECT_URL: undefined }, true)).toThrow(
      /DIRECT_URL/,
    );
    const key = (ref: string, role = 'anon') =>
      [
        'header',
        Buffer.from(JSON.stringify({ ref, role })).toString('base64url'),
        'signature',
      ].join('.');
    expect(assertSupabaseTarget({ ...config(), SUPABASE_ANON_KEY: key(prod) })).toBe(prod);
    expect(() => assertSupabaseTarget({ ...config(), SUPABASE_ANON_KEY: key(dev) })).toThrow(
      /ANON_KEY/,
    );
    expect(() =>
      assertSupabaseTarget({ ...config(), SUPABASE_ANON_KEY: key(prod, 'service_role') }),
    ).toThrow(/ANON_KEY/);
  });

  it('conserva Docker/loopback local sin variables cloud y rechaza redirecciones de conexión', () => {
    const local = {
      SUPABASE_URL: 'http://127.0.0.1:8000',
      DATABASE_URL: 'postgresql://turnosmart_local:local@127.0.0.1:5432/turnosmart_local',
      DIRECT_URL: 'postgresql://turnosmart_local:local@127.0.0.1:5432/turnosmart_local',
    };
    expect(assertSupabaseTarget(local, true)).toBeNull();
    expect(() => assertSupabaseTarget({ ...local, DEPLOY_TARGET: 'production' })).toThrow(
      /locales/,
    );
    expect(() => assertSupabaseTarget({ ...local, RENDER: 'true' })).toThrow(/locales/);
    expect(() =>
      assertSupabaseTarget(
        { ...local, DIRECT_URL: local.DIRECT_URL + '?host=remote.invalid' },
        true,
      ),
    ).toThrow(/parametro/);
  });

  it('Prisma bloquea configuración de migrate antes de cargar el motor; validate/generate siguen sin conexión', async () => {
    for (const [name, value] of Object.entries(config())) vi.stubEnv(name, value);
    // Sólo se importa la configuración con argv sintético: nunca se ejecuta Prisma migrate.
    process.argv = ['node', 'prisma', 'migrate', 'deploy'];
    await expect(import('../../prisma.config.js')).resolves.toBeDefined();
    vi.resetModules();
    vi.stubEnv('DIRECT_URL', db(dev));
    await expect(import('../../prisma.config.js')).rejects.toThrow(/DIRECT_URL/);
    vi.resetModules();
    process.argv = ['node', 'prisma', 'generate'];
    await expect(import('../../prisma.config.js')).resolves.toBeDefined();
  });
});
