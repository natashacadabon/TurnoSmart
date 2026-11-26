import { randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  SeedError,
  seedFailure,
  seedStep,
  reportSeedFailure,
  withSeedCleanup,
} from '../../prisma/seed-diagnostics.js';
import { checkSeedSchema } from '../../prisma/seed-checks.js';
import { findSeedUser, ensureSeedUsers } from '../../prisma/seed-auth.js';
import { buildSeedData } from '../../prisma/seed-data.js';

const privateValue = randomBytes(32).toString('base64url');
const privateUrl = `postgresql://private:${privateValue}@private.invalid/postgres`;
const privateToken = `sb_secret_${privateValue}`;
const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(privateUrl, {
    code,
    clientVersion: '6.12.0',
    ...(meta ? { meta } : {}),
  });

describe('diagnosticos seguros del seed', () => {
  it.each(['P2002', 'P2003', 'P2004', 'P2021', 'P2022', 'P2028', 'P2034'])(
    'conserva %s sin datos de message, meta o stack',
    (code) => {
      const error = known(code, { target: [privateValue], message: privateUrl, key: privateToken });
      const result = seedFailure('services', error).diagnostic;
      expect(result).toMatchObject({
        stage: 'services',
        type: 'PrismaClientKnownRequestError',
        code,
      });
      const output = JSON.stringify(result);
      for (const hidden of [privateValue, privateUrl, privateToken])
        expect(output.includes(hidden)).toBe(false);
      expect(output).not.toContain('stack');
    },
  );
  it('conserva codigo de inicializacion Prisma y causa de red sin URL', () => {
    const error = new Prisma.PrismaClientInitializationError(privateUrl, '6.12.0', 'P1001');
    expect(seedFailure('prisma_connection', error).diagnostic).toMatchObject({
      code: 'P1001',
      stage: 'prisma_connection',
      type: 'PrismaClientInitializationError',
    });
    const network = new TypeError(privateUrl, {
      cause: { code: 'ENOTFOUND', hostname: privateValue, message: privateToken },
    });
    expect(seedFailure('prisma_connection', network).diagnostic).toMatchObject({
      causeCode: 'ENOTFOUND',
      type: 'TypeError',
    });
    expect(JSON.stringify(seedFailure('prisma_connection', network).diagnostic)).not.toContain(
      privateValue,
    );
  });
  it('informa SQLSTATE seguro para tablas ausentes y permisos, sin copiar meta', () => {
    for (const databaseCode of ['42P01', '42703', '42501', '23505', '23503']) {
      expect(
        seedFailure('migrations', known('P2010', { code: databaseCode, message: privateUrl }))
          .diagnostic,
      ).toMatchObject({ stage: 'migrations', code: 'P2010', databaseCode });
    }
  });
  it('no publica nombres, codigos ni mensajes arbitrarios, incluso SeedError', () => {
    for (const error of [
      new Error(privateUrl),
      new SeedError(privateValue),
      {
        name: privateValue,
        code: privateToken,
        message: privateUrl,
        status: privateValue,
        meta: { code: privateValue },
      },
      privateValue,
    ]) {
      const output = JSON.stringify(seedFailure('profiles', error).diagnostic);
      expect(output.includes(privateValue)).toBe(false);
      expect(output).not.toContain(privateUrl);
    }
    expect(
      seedFailure(
        'profiles',
        new SeedError('Un usuario existente tiene otro perfil/negocio/rol; seed cancelado.'),
      ).diagnostic.code,
    ).toBe('SEED_PROFILE_CONFLICT');
  });
  it('serializa solo el diagnostico y conserva etapas internas al envolverlas', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const error = seedFailure('availability', known('P2003'));
      await expect(
        seedStep('transaction_commit', async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      reportSeedFailure(error);
      expect(JSON.parse(spy.mock.calls[0]![0] as string)).toMatchObject({
        event: 'seed_failed',
        stage: 'availability',
        code: 'P2003',
      });
    } finally {
      spy.mockRestore();
    }
  });
  it('un fallo de disconnect no oculta la causa inicial', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = seedFailure('services', known('P2002'));
    try {
      await expect(
        withSeedCleanup(
          async () => {
            throw original;
          },
          async () => {
            throw known('P1017');
          },
        ),
      ).rejects.toBe(original);
      expect(JSON.parse(spy.mock.calls[0]![0] as string)).toMatchObject({
        event: 'seed_cleanup_failed',
        stage: 'disconnect',
        code: 'P1017',
      });
      await expect(
        withSeedCleanup(
          async () => true,
          async () => {
            throw known('P1017');
          },
        ),
      ).rejects.toMatchObject({ diagnostic: { stage: 'disconnect', code: 'P1017' } });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('preflight de migraciones solo lectura', () => {
  it('consulta estructura sin leer filas ni aplicar migraciones', async () => {
    const query = vi.fn().mockResolvedValue([]);
    await checkSeedSchema({ $queryRaw: query } as unknown as PrismaClient);
    const sql = (query.mock.calls[0]![0] as TemplateStringsArray).join('');
    expect(sql).toContain('LIMIT 0');
    expect(sql).toContain('public.services');
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|ALTER|DROP/i);
  });
  it('marca migrations cuando PostgreSQL informa que falta una tabla', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockRejectedValue(known('P2010', { code: '42P01', message: privateUrl })),
    };
    await expect(
      seedStep('migrations', () => checkSeedSchema(prisma as unknown as PrismaClient)),
    ).rejects.toMatchObject({
      diagnostic: { stage: 'migrations', code: 'P2010', databaseCode: '42P01' },
    });
  });
});

describe('errores Supabase Auth sin perder codigo/status', () => {
  it('listado denegado mantiene etapa Auth y HTTP 403', async () => {
    const admin = {
      listUsers: vi.fn().mockResolvedValue({
        data: null,
        error: { name: 'AuthApiError', code: 'not_admin', status: 403, message: privateToken },
      }),
    };
    await expect(
      findSeedUser(admin as unknown as SupabaseClient['auth']['admin'], 'test@turnosmart.test'),
    ).rejects.toMatchObject({
      diagnostic: { stage: 'supabase_auth', code: 'not_admin', status: 403 },
    });
  });
  it('creacion denegada no se oculta buscando de nuevo el usuario', async () => {
    const admin = {
      listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
      createUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: {
          name: 'AuthApiError',
          code: 'weak_password',
          status: 422,
          message: privateValue,
        },
      }),
    };
    await expect(
      ensureSeedUsers(
        admin as unknown as SupabaseClient['auth']['admin'],
        buildSeedData().accounts.slice(0, 1),
        privateValue,
      ),
    ).rejects.toMatchObject({
      diagnostic: { stage: 'user_creation', code: 'weak_password', status: 422 },
    });
    expect(admin.listUsers).toHaveBeenCalledTimes(1);
  });
  it('recupera una carrera de duplicado sin cambiar password', async () => {
    const account = buildSeedData().accounts[0]!;
    const user = {
      id: 'test-user',
      email: account.email,
      email_confirmed_at: new Date().toISOString(),
    };
    const admin = {
      listUsers: vi
        .fn()
        .mockResolvedValueOnce({ data: { users: [] }, error: null })
        .mockResolvedValueOnce({ data: { users: [user] }, error: null }),
      createUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { name: 'AuthApiError', code: 'email_exists', status: 422, message: privateValue },
      }),
    };
    const profiles = await ensureSeedUsers(
      admin as unknown as SupabaseClient['auth']['admin'],
      [account],
      privateValue,
    );
    expect(profiles[0]?.id).toBe(user.id);
    expect(admin.createUser).toHaveBeenCalledTimes(1);
  });
});
