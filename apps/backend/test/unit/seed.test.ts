import { randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PrismaClient, Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createServiceSchema } from '@turnosmart/shared';
import {
  buildSeedData,
  validateSeedData,
  assertNoActiveOverlaps,
  SEED_ADMIN_EMAIL,
  SEED_OWNER_EMAIL,
  SEED_PLATFORM_ADMIN_EMAIL,
} from '../../prisma/seed-data.js';
import { readSeedConfig, ensureSeedUsers, verifyAdminLogin } from '../../prisma/seed-auth.js';
import { seedDomain } from '../../prisma/seed-runner.js';

const now = new Date('2026-10-30T20:00:00.000Z');
const password = () => randomBytes(24).toString('base64url');
const localEnv = () => ({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://127.0.0.1:54322/postgres',
  DIRECT_URL: 'postgresql://localhost:54322/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: randomUUID(),
  SUPABASE_SERVICE_ROLE_KEY: randomUUID(),
  SEED_ADMIN_PASSWORD: password(),
});

const authorizedRef = 'gtghqinpghiryxuloeub';
const otherRef = 'abcdefghijklmnopqrst';
const remoteEnv = () => ({
  ...localEnv(),
  DATABASE_URL: `postgresql://postgres.${authorizedRef}@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require`,
  DIRECT_URL: `postgresql://postgres@db.${authorizedRef}.supabase.co:5432/postgres?sslmode=require`,
  SUPABASE_URL: `https://${authorizedRef}.supabase.co`,
  ALLOW_REMOTE_SEED: 'true',
  SEED_CONFIRM_REMOTE: `seed:${authorizedRef}`,
});

it('limita el modo Docker a los servicios locales exactos y requiere desarrollo', () => {
  const database = 'postgresql://turnosmart_local@postgres:5432/turnosmart_local';
  const env = {
    ...localEnv(),
    TURNOSMART_DOCKER_SEED: 'true',
    DATABASE_URL: database,
    DIRECT_URL: database,
    SUPABASE_URL: 'http://auth-gateway:8080',
  };
  expect(readSeedConfig(env).projectRef).toBeNull();
  for (const invalid of [
    { ...env, DIRECT_URL: localEnv().DIRECT_URL },
    { ...env, SUPABASE_URL: 'https://example.com' },
    { ...env, NODE_ENV: 'test' },
    { ...remoteEnv(), TURNOSMART_DOCKER_SEED: 'true' },
  ]) {
    expect(() => readSeedConfig(invalid)).toThrow(/Compose local/);
  }
  expect(() => readSeedConfig({ ...env, TURNOSMART_DOCKER_SEED: 'false' })).toThrow(
    /ALLOW_REMOTE_SEED/,
  );
});

it('permite el seed local desde Windows pero rechaza destinos remotos y parametros de redireccion', () => {
  const database = 'postgresql://turnosmart_local@127.0.0.1:54325/turnosmart_local';
  const env = {
    ...localEnv(),
    TURNOSMART_DOCKER_SEED: 'true',
    DATABASE_URL: database,
    DIRECT_URL: database,
    SUPABASE_URL: 'http://127.0.0.1:54326',
  };
  expect(readSeedConfig(env).projectRef).toBeNull();
  for (const invalid of [
    { ...env, DATABASE_URL: database.replace('127.0.0.1', 'remote.test') },
    { ...env, DATABASE_URL: database + '?host=remote.test' },
    { ...env, SUPABASE_URL: 'https://remote.test' },
    { ...env, NODE_ENV: 'test' },
  ])
    expect(() => readSeedConfig(invalid)).toThrow(/Compose local/);
});

describe('seed: autorizacion Cloud sin red', () => {
  it('admite unicamente el proyecto autorizado con triple coincidencia y confirmacion', () => {
    expect(readSeedConfig(remoteEnv()).projectRef).toBe(authorizedRef);
    const direct = `postgresql://postgres@db.${authorizedRef}.supabase.co:5432/postgres?sslmode=require`;
    expect(readSeedConfig({ ...remoteEnv(), DATABASE_URL: direct }).projectRef).toBe(authorizedRef);
    expect(
      readSeedConfig({
        ...remoteEnv(),
        DIRECT_URL: `postgresql://postgres.${authorizedRef}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslaccept=strict`,
      }).projectRef,
    ).toBe(authorizedRef);
  });
  it('requiere TLS y no permite omitir la validacion del certificado', () => {
    for (const key of ['DATABASE_URL', 'DIRECT_URL'] as const) {
      for (const mode of ['disable', 'allow', 'prefer', 'no-verify', '']) {
        const env = remoteEnv();
        env[key] = env[key].replace(/sslmode=[^&]*/, `sslmode=${mode}`);
        expect(() => readSeedConfig(env)).toThrow(/conexion TLS/);
      }
      const env = remoteEnv();
      env[key] = env[key].replace(
        'sslmode=require',
        'sslmode=require&sslaccept=accept_invalid_certs',
      );
      expect(() => readSeedConfig(env)).toThrow(/certificado TLS/);
    }
  });
  it.each(['', 'false', 'TRUE'])('rechaza habilitacion distinta de true: %s', (value) => {
    expect(() => readSeedConfig({ ...remoteEnv(), ALLOW_REMOTE_SEED: value })).toThrow(
      /ALLOW_REMOTE_SEED/,
    );
  });
  it.each(['', 'true', `seed:${otherRef}`, authorizedRef])(
    'exige confirmacion exacta: %s',
    (value) => {
      expect(() => readSeedConfig({ ...remoteEnv(), SEED_CONFIRM_REMOTE: value })).toThrow(
        /confirmacion/,
      );
    },
  );
  it('rechaza proyectos no listados, produccion y falta de DIRECT_URL', () => {
    expect(() =>
      readSeedConfig({
        ...remoteEnv(),
        SUPABASE_URL: `https://${otherRef}.supabase.co`,
        SEED_CONFIRM_REMOTE: `seed:${otherRef}`,
      }),
    ).toThrow(/lista autorizada/);
    expect(() => readSeedConfig({ ...remoteEnv(), NODE_ENV: 'production' })).toThrow(/produccion/);
    expect(() => readSeedConfig({ ...remoteEnv(), NODE_ENV: ' PRODUCTION ' })).toThrow(
      /produccion/,
    );
    expect(() => readSeedConfig({ ...remoteEnv(), DIRECT_URL: '' })).toThrow(/DIRECT_URL/);
  });
  it('rechaza referencias cruzadas en conexion directa o pooler', () => {
    expect(() =>
      readSeedConfig({
        ...remoteEnv(),
        DATABASE_URL: `postgresql://postgres.${otherRef}@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`,
      }),
    ).toThrow(/mismo proyecto/);
    expect(() =>
      readSeedConfig({
        ...remoteEnv(),
        DIRECT_URL: `postgresql://postgres@db.${otherRef}.supabase.co:5432/postgres?sslmode=require`,
      }),
    ).toThrow(/mismo proyecto/);
  });
  it('rechaza mezclas local/remoto y hosts que solo aparentan ser Supabase', () => {
    for (const key of ['DATABASE_URL', 'DIRECT_URL', 'SUPABASE_URL'] as const) {
      expect(() => readSeedConfig({ ...remoteEnv(), [key]: localEnv()[key] })).toThrow();
    }
    for (const SUPABASE_URL of [
      `http://${authorizedRef}.supabase.co`,
      `https://${authorizedRef}.supabase.co.attacker.test`,
      `https://${authorizedRef}.supabase.co/other`,
      `https://${authorizedRef}.supabase.co?redirect=x`,
    ]) {
      expect(() => readSeedConfig({ ...remoteEnv(), SUPABASE_URL })).toThrow();
    }
    for (const DATABASE_URL of [
      `postgresql://postgres.${authorizedRef}@attacker.pooler.supabase.com:5432/postgres`,
      `postgresql://postgres.${authorizedRef}@aws-0-us-east-1.pooler.supabase.com.attacker.test:5432/postgres`,
      `postgresql://postgres@db.${authorizedRef}.supabase.co:5432/postgres?host=attacker.test&sslmode=require`,
      `postgresql://postgres@db.${authorizedRef}.supabase.co:5432/postgres?schema=other&sslmode=require`,
      `postgresql://postgres@db.${authorizedRef}.supabase.co:5432/other?sslmode=require`,
    ])
      expect(() => readSeedConfig({ ...remoteEnv(), DATABASE_URL })).toThrow();
  });
  it('errores de destino no incluyen claves ni URLs completas', () => {
    const env = {
      ...remoteEnv(),
      DATABASE_URL: `postgresql://postgres:${password()}@db.${otherRef}.supabase.co:5432/postgres?sslmode=require`,
    };
    let rejected = false;
    try {
      readSeedConfig(env);
    } catch (error) {
      rejected = true;
      expect((error as Error).message.includes(env.DATABASE_URL)).toBe(false);
      expect((error as Error).message.includes(env.SUPABASE_SERVICE_ROLE_KEY)).toBe(false);
      expect((error as Error).message.includes(env.SEED_ADMIN_PASSWORD)).toBe(false);
    }
    expect(rejected).toBe(true);
  });
  it('admite sb_secret como clave privilegiada y conserva fallback legacy', async () => {
    const key = `sb_secret_${password()}`;
    const cfg = readSeedConfig({ ...remoteEnv(), SUPABASE_SECRET_KEY: key });
    expect(cfg.serviceKey === key).toBe(true);
    expect(readSeedConfig(localEnv()).serviceKey.length > 0).toBe(true);
    expect(() =>
      readSeedConfig({ ...remoteEnv(), SUPABASE_SECRET_KEY: `sb_publishable_${password()}` }),
    ).toThrow(/privilegiada/);
    let sentApiKey = false;
    const fakeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentApiKey = new Headers(init?.headers).get('apikey') === key;
      return new Response(JSON.stringify({ users: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const client = createClient(cfg.supabaseUrl, cfg.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fakeFetch },
    });
    const result = await client.auth.admin.listUsers();
    expect(result.error).toBeNull();
    expect(sentApiKey).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});

describe('seed: destinos y datos', () => {
  it('admite passwords de diez caracteres y rechaza menos', () => {
    const env = localEnv();
    const generated = password();
    expect(() =>
      readSeedConfig({ ...env, SEED_ADMIN_PASSWORD: generated.slice(0, 10) }),
    ).not.toThrow();
    expect(() => readSeedConfig({ ...env, SEED_ADMIN_PASSWORD: generated.slice(0, 9) })).toThrow(
      /10 caracteres/,
    );
  });

  it('admite solo entorno local y exige password configurable', () => {
    expect(readSeedConfig(localEnv()).supabaseUrl).toBe('http://127.0.0.1:54321');
    const env = localEnv();
    for (const key of ['DATABASE_URL', 'SUPABASE_URL', 'DIRECT_URL'] as const) {
      const remote =
        key === 'SUPABASE_URL'
          ? 'https://project.supabase.co'
          : 'postgresql://db.project.supabase.co/postgres';
      expect(() => readSeedConfig({ ...env, [key]: remote })).toThrow(/loopback/);
    }
    for (const hostname of ['127.0.0.1.attacker.test', '10.0.0.1', 'host.docker.internal'])
      expect(() => readSeedConfig({ ...env, SUPABASE_URL: `http://${hostname}` })).toThrow(
        /loopback/,
      );
    expect(() => readSeedConfig({ ...env, NODE_ENV: 'production' })).toThrow(/produccion/);
    expect(() => readSeedConfig({ ...env, SEED_ADMIN_PASSWORD: '' })).toThrow(
      /SEED_ADMIN_PASSWORD/,
    );
    expect(() => readSeedConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' })).toThrow(/SERVICE_ROLE/);
  });
  it.each(['2026-10-30T02:00:00Z', '2026-11-01T22:00:00Z', '2026-12-31T22:00:00Z'])(
    'relaciones, horas y contratos para %s',
    (timestamp) => {
      const instant = new Date(timestamp);
      const data = buildSeedData(instant);
      expect(() => validateSeedData(data)).not.toThrow();
      expect(data.businesses).toHaveLength(2);
      expect(data.accounts).toHaveLength(6);
      expect(new Set(data.accounts.map((a) => a.role))).toEqual(new Set(['OWNER']));
      // Por negocio: un OWNER activo y dos OWNER desactivados (antiguos ADMIN/STAFF de negocio).
      for (const business of data.businesses) {
        const members = data.accounts.filter((a) => a.businessId === business.id);
        expect(members.filter((a) => a.active)).toHaveLength(1);
        expect(members.filter((a) => !a.active)).toHaveLength(2);
      }
      for (const a of data.accounts) {
        // Igual que la restriccion de la base: active si y solo si deactivatedAt es null.
        expect(a.active).toBe(a.deactivatedAt === null);
      }
      expect(data.accounts.find((a) => a.email === SEED_OWNER_EMAIL)).toMatchObject({
        role: 'OWNER',
        active: true,
        businessId: data.businesses[0]!.id,
      });
      expect(SEED_OWNER_EMAIL).toBe(SEED_ADMIN_EMAIL);
      expect(data.platformAdmins).toEqual([
        { email: SEED_PLATFORM_ADMIN_EMAIL, fullName: expect.any(String) },
      ]);
      expect(data.accounts.some((a) => a.email === SEED_PLATFORM_ADMIN_EMAIL)).toBe(false);
      expect(data.customers).toHaveLength(8);
      expect(data.services).toHaveLength(8);
      expect(data.rules).toHaveLength(20);
      expect(data.appointments).toHaveLength(10);
      expect(data.services.filter((s) => !s.active)).toHaveLength(2);
      for (const s of data.services) {
        const { name, description, durationMinutes, priceCents, active } = s;
        expect(
          createServiceSchema.safeParse({ name, description, durationMinutes, priceCents, active })
            .success,
        ).toBe(true);
      }
      for (const a of data.appointments) {
        if (['COMPLETED', 'NO_SHOW'].includes(a.status)) expect(a.endsAt < instant).toBe(true);
        else expect(a.startsAt > instant).toBe(true);
      }
      expect(buildSeedData(instant)).toEqual(data);
    },
  );
  it('detecta referencias cruzadas y solapamientos; admite adyacencia y otros negocios', () => {
    const data = buildSeedData(now);
    const first = data.appointments[0]!;
    const second = data.appointments[1]!;
    expect(() => assertNoActiveOverlaps([first, { ...first, businessId: 'other' }])).not.toThrow();
    expect(() =>
      assertNoActiveOverlaps([first, { ...second, startsAt: first.endsAt }]),
    ).not.toThrow();
    expect(() => assertNoActiveOverlaps([first, { ...second, startsAt: first.startsAt }])).toThrow(
      /superpuestos/,
    );
    first.customerId = data.customers[4]!.id;
    expect(() => validateSeedData(data)).toThrow(/Relacion/);
  });
  it('rechaza un email repetido entre OWNER y ADMIN de plataforma', () => {
    const data = buildSeedData(now);
    data.platformAdmins = [{ ...data.platformAdmins[0]!, email: SEED_OWNER_EMAIL }];
    expect(() => validateSeedData(data)).toThrow(/duplicados/);
  });
});

function fakeAdmin() {
  type User = {
    id: string;
    email: string;
    email_confirmed_at: string;
    password?: string | undefined;
  };
  const users: User[] = [];
  const api = {
    listUsers: vi.fn(async ({ page, perPage }: { page: number; perPage: number }) => ({
      data: { users: users.slice((page - 1) * perPage, page * perPage) },
      error: null,
    })),
    createUser: vi.fn(async ({ email, password }: { email: string; password?: string }) => {
      const user = { id: randomUUID(), email, password, email_confirmed_at: now.toISOString() };
      users.push(user);
      return { data: { user }, error: null };
    }),
  };
  return { users, api, admin: api as unknown as SupabaseClient['auth']['admin'] };
}

describe('seed: Supabase Auth con dobles, sin red', () => {
  it('crea usuarios por Auth y repite sin duplicar ni cambiar passwords', async () => {
    const { users, api, admin } = fakeAdmin();
    const accounts = buildSeedData(now).accounts;
    const first = await ensureSeedUsers(admin, accounts, password());
    const second = await ensureSeedUsers(admin, accounts, password());
    expect(users).toHaveLength(6);
    expect(api.createUser).toHaveBeenCalledTimes(6);
    expect(second).toEqual(first);
    expect(
      api.createUser.mock.calls.every(
        ([call]) => 'email_confirm' in call && call.email_confirm === true,
      ),
    ).toBe(true);
    expect(first.find((p) => p.email === SEED_ADMIN_EMAIL)?.role).toBe('OWNER');
  });
  it('crea el ADMIN de plataforma con el mismo helper generico y conserva sus campos', async () => {
    const { users, api, admin } = fakeAdmin();
    const data = buildSeedData(now);
    const seedPassword = password();
    const owners = await ensureSeedUsers(admin, data.accounts, seedPassword);
    const platform = await ensureSeedUsers(admin, data.platformAdmins, seedPassword);
    expect(platform).toEqual([
      {
        id: expect.any(String),
        email: SEED_PLATFORM_ADMIN_EMAIL,
        fullName: data.platformAdmins[0]!.fullName,
      },
    ]);
    expect(owners.some((o) => o.id === platform[0]!.id)).toBe(false);
    expect(api.createUser).toHaveBeenCalledTimes(7);
    // Solo el OWNER demo y el ADMIN de plataforma reciben la password conocida del seed.
    const known = users.filter((u) => u.password === seedPassword).map((u) => u.email);
    expect(known.sort()).toEqual([SEED_OWNER_EMAIL, SEED_PLATFORM_ADMIN_EMAIL].sort());
    expect(await ensureSeedUsers(admin, data.platformAdmins, password())).toEqual(platform);
    expect(api.createUser).toHaveBeenCalledTimes(7);
  });
  it('pagina usuarios existentes sin depender de la primera pagina', async () => {
    const { users, admin, api } = fakeAdmin();
    for (let i = 0; i < 201; i++)
      users.push({
        id: randomUUID(),
        email: `other${i}@turnosmart.test`,
        email_confirmed_at: now.toISOString(),
      });
    const account = buildSeedData(now).accounts[0]!;
    users.push({ id: randomUUID(), email: account.email, email_confirmed_at: now.toISOString() });
    await ensureSeedUsers(admin, [account], password());
    expect(api.createUser).not.toHaveBeenCalled();
    expect(api.listUsers).toHaveBeenCalledTimes(2);
  });
  it('verifica login con password y token usando Auth publico; error sanitizado', async () => {
    const id = randomUUID();
    const auth = {
      signInWithPassword: vi.fn().mockResolvedValue({
        data: { user: { id }, session: { access_token: randomUUID() } },
        error: null,
      }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id } }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    };
    await verifyAdminLogin(auth as unknown as SupabaseClient['auth'], password(), id);
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: {
        name: 'AuthApiError',
        code: 'invalid_credentials',
        status: 400,
        message: 'sensitive-provider-error',
      },
    });
    await expect(
      verifyAdminLogin(auth as unknown as SupabaseClient['auth'], password(), id),
    ).rejects.toThrow(/password original/);
  });
});

type Row = Record<string, unknown> & { id: string };
type Where = Record<string, unknown>;
function matches(row: Row, where: Where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (typeof value === 'object' && value !== null) {
      if ('in' in value) return (value.in as unknown[]).includes(row[key]);
      if (key === 'metadata' && 'equals' in value)
        return (row.metadata as Record<string, unknown>)?.source === value.equals;
    }
    return row[key] === value;
  });
}
/** Transaccion simulada con rollback: no prueba PostgreSQL ni RLS reales. */
function memoryPrisma() {
  const names = [
    'business',
    'profile',
    'platformAdmin',
    'customer',
    'service',
    'availabilityRule',
    'appointment',
    'appointmentEvent',
    'riskScore',
    'reminder',
  ] as const;
  let tables: Record<string, Map<string, Row>> = Object.fromEntries(
    names.map((n) => [n, new Map<string, Row>()]),
  );
  const models = Object.fromEntries(
    names.map((name) => [
      name,
      {
        findUnique: async ({ where }: { where: { id: string } }) =>
          tables[name]!.get(where.id) ?? null,
        findMany: async ({ where }: { where: Where }) =>
          [...tables[name]!.values()].filter((r) => matches(r, where)),
        count: async ({ where }: { where: Where }) =>
          [...tables[name]!.values()].filter((r) => matches(r, where)).length,
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: Row;
          update: Record<string, unknown>;
        }) => {
          const current = tables[name]!.get(where.id);
          const row = current ? { ...current, ...update } : { ...create };
          tables[name]!.set(row.id, row);
          return row;
        },
      },
    ]),
  );
  const client = {
    ...models,
    $transaction: async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const snapshot = structuredClone(tables);
      try {
        return await fn(models as unknown as Prisma.TransactionClient);
      } catch (error) {
        tables = snapshot;
        throw error;
      }
    },
  };
  return { prisma: client as unknown as PrismaClient, rows: () => tables };
}

describe('seed: repeticion y aislamiento del runner con dobles', () => {
  it.each([
    ['profile', 'profiles'],
    ['business', 'businesses'],
    ['customer', 'customers'],
    ['service', 'services'],
    ['availabilityRule', 'availability'],
    ['appointment', 'appointments'],
    ['appointmentEvent', 'appointment_events'],
    ['riskScore', 'risk_scores'],
    ['reminder', 'reminders'],
  ] as const)('marca la etapa de %s sin perder el codigo Prisma', async (model, stage) => {
    const { prisma } = memoryPrisma();
    const data = buildSeedData(now),
      profiles = data.accounts.map((a) => ({ ...a, id: randomUUID() }));
    const delegate = prisma[model] as unknown as { upsert: () => Promise<unknown> };
    vi.spyOn(delegate, 'upsert').mockRejectedValue({
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      message: 'private data',
    });
    await expect(seedDomain(prisma, data, profiles)).rejects.toMatchObject({
      diagnostic: { stage, code: 'P2002' },
    });
  });

  it('dos ejecuciones conservan cantidades e IDs, sin borrar datos ajenos', async () => {
    const { prisma, rows } = memoryPrisma();
    const data = buildSeedData(now);
    const profiles = data.accounts.map((a) => ({ ...a, id: randomUUID() }));
    const untouched = { id: randomUUID(), name: 'Dato existente' };
    rows().business!.set(untouched.id, untouched);
    const platformAdmins = data.platformAdmins.map((a) => ({ ...a, id: randomUUID() }));
    const first = await seedDomain(prisma, data, profiles, platformAdmins);
    const second = await seedDomain(
      prisma,
      buildSeedData(new Date(now.getTime() + 7 * 86400000)),
      profiles,
      platformAdmins,
    );
    expect(second).toEqual(first);
    expect(second).toEqual({
      businesses: 2,
      profiles: 6,
      platformAdmins: 1,
      customers: 8,
      services: 8,
      availabilityRules: 20,
      appointments: 10,
      appointmentEvents: 10,
      riskScores: 10,
      reminders: 10,
    });
    expect(rows().business!.get(untouched.id)).toEqual(untouched);
    expect(rows().business!.size).toBe(3);
    expect(rows().platformAdmin!.size).toBe(1);
    expect([...rows().profile!.values()].filter((p) => p.active)).toHaveLength(2);
    for (const p of rows().profile!.values()) {
      expect(p.role).toBe('OWNER');
      expect(p.active).toBe(p.deactivatedAt === null);
    }
    for (const a of rows().appointment!.values()) {
      expect(rows().service!.get(a.serviceId as string)?.businessId).toBe(a.businessId);
      expect(rows().customer!.get(a.customerId as string)?.businessId).toBe(a.businessId);
    }
    expect([...rows().reminder!.values()].every((r) => r.status === 'CANCELLED')).toBe(true);
  });
  it('no reasigna perfiles ajenos y revierte ante choques con turnos manuales', async () => {
    const { prisma, rows } = memoryPrisma();
    const data = buildSeedData(now),
      profiles = data.accounts.map((a) => ({ ...a, id: randomUUID() }));
    const conflict = { ...profiles[0]!, businessId: randomUUID() };
    rows().profile!.set(conflict.id, conflict);
    await expect(seedDomain(prisma, data, profiles)).rejects.toThrow(/otro perfil/);
    expect(rows().business!.size).toBe(0);
    rows().profile!.clear(); // Solo el doble de prueba; nunca una base real.
    const manual = { ...data.appointments[0]!, id: randomUUID() };
    rows().appointment!.set(manual.id, manual);
    await expect(seedDomain(prisma, data, profiles)).rejects.toThrow(/superpuestos/);
    expect(rows().business!.size).toBe(0);
    expect(rows().appointment!.size).toBe(1);
  });
  it('rechaza una cuenta que sea ADMIN de plataforma y OWNER a la vez, sin escribir nada', async () => {
    const data = buildSeedData(now);
    const profiles = data.accounts.map((a) => ({ ...a, id: randomUUID() }));
    const admin = { ...data.platformAdmins[0]!, id: profiles[0]!.id };
    // Se cancela en la etapa de perfiles, antes de crear negocios, perfiles o ADMIN.
    const conflict = { diagnostic: { stage: 'profiles', type: 'SeedError' } };

    // El mismo ID en ambas listas del seed.
    let db = memoryPrisma();
    await expect(seedDomain(db.prisma, data, profiles, [admin])).rejects.toMatchObject(conflict);
    expect(db.rows().platformAdmin!.size).toBe(0);
    expect(db.rows().business!.size).toBe(0);

    // El ADMIN ya tiene un perfil de negocio en la base.
    db = memoryPrisma();
    const adminId = randomUUID();
    db.rows().profile!.set(adminId, { id: adminId, businessId: randomUUID(), role: 'OWNER' });
    await expect(
      seedDomain(db.prisma, data, profiles, [{ ...admin, id: adminId }]),
    ).rejects.toMatchObject(conflict);
    expect(db.rows().platformAdmin!.size).toBe(0);
    expect(db.rows().business!.size).toBe(0);

    // Un OWNER del seed ya es ADMIN de plataforma en la base.
    db = memoryPrisma();
    db.rows().platformAdmin!.set(profiles[1]!.id, { id: profiles[1]!.id, active: true });
    await expect(
      seedDomain(db.prisma, data, profiles, [{ ...admin, id: randomUUID() }]),
    ).rejects.toMatchObject(conflict);
    expect(db.rows().platformAdmin!.size).toBe(1);
    expect(db.rows().business!.size).toBe(0);
    expect(db.rows().profile!.size).toBe(0);
  });
});
