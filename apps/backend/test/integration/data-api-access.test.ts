/**
 * FINAL-02: la Data API de Supabase (PostgREST) no expone el schema public.
 * anon y authenticated no tienen privilegios sobre tablas, secuencias ni funciones; RLS está
 * habilitado en todas las tablas; un JWT válido de un OWNER no puede leer ni escribir directo.
 * Requiere DATABASE_URL con migraciones aplicadas (Supabase local o DB descartable).
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL no definida: levantar Supabase local (ver README) antes de test:integration',
  );
}

const prisma = new PrismaClient();
const DATA_API_ROLES = ['anon', 'authenticated'] as const;

let tables: string[] = [];
let ownerId: string;
let businessId: string;

beforeAll(async () => {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
    ORDER BY c.relname`;
  tables = rows.map((row) => row.name);
  businessId = randomUUID();
  ownerId = randomUUID();
  await prisma.business.create({ data: { id: businessId, name: 'Data API' } });
  await prisma.profile.create({
    data: { id: ownerId, businessId, email: `${ownerId}@example.test`, role: 'OWNER' },
  });
});

afterAll(async () => {
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.$disconnect();
});

/** Ejecuta una consulta como lo haría PostgREST con el JWT de la cuenta indicada. */
async function asDataApi(role: (typeof DATA_API_ROLES)[number], sql: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      JSON.stringify({ sub: ownerId, role }),
    );
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
    return tx.$queryRawUnsafe(sql);
  });
}

function permissionDenied(error: unknown) {
  const code =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? String((error.meta as { code?: string } | undefined)?.code ?? error.code)
      : '';
  const message = error instanceof Error ? error.message : String(error);
  return code === '42501' || /permission denied/i.test(message);
}

describe('Data API cerrada para anon y authenticated', () => {
  it('incluye las tablas del dominio y de identidad', () => {
    expect(tables).toEqual(
      expect.arrayContaining([
        'businesses',
        'profiles',
        'platform_admins',
        'customers',
        'services',
        'appointments',
        'risk_scores',
        'notifications',
      ]),
    );
  });

  it('todas las tablas tienen RLS habilitado', async () => {
    const withoutRls = await prisma.$queryRaw<{ name: string }[]>`
      SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname <> '_prisma_migrations' AND NOT c.relrowsecurity`;
    expect(withoutRls).toEqual([]);
  });

  it('ningún rol de la Data API tiene privilegios sobre tablas, secuencias o funciones', async () => {
    const grants = await prisma.$queryRaw<{ role: string; object: string; privilege: string }[]>`
      SELECT r.role, c.relname AS object, p.privilege
      FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
      CROSS JOIN pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm')
        AND has_table_privilege(r.role, c.oid, p.privilege)
      UNION ALL
      SELECT r.role, c.relname, 'USAGE'
      FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
      CROSS JOIN pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S'
        AND has_sequence_privilege(r.role, c.oid, 'USAGE')
      UNION ALL
      SELECT r.role, f.proname, 'EXECUTE'
      FROM unnest(ARRAY['anon', 'authenticated']) AS r(role)
      CROSS JOIN pg_proc f
      JOIN pg_namespace n ON n.oid = f.pronamespace
      WHERE n.nspname = 'public' AND has_function_privilege(r.role, f.oid, 'EXECUTE')`;
    expect(grants).toEqual([]);
  });

  it('una tabla creada después hereda el cierre (privilegios por defecto)', async () => {
    const table = `data_api_probe_${randomUUID().replaceAll('-', '')}`;
    await prisma.$executeRawUnsafe(`CREATE TABLE public.${table} (id int)`);
    try {
      const [row] = await prisma.$queryRawUnsafe<{ anon: boolean; authenticated: boolean }[]>(
        `SELECT has_table_privilege('anon', 'public.${table}', 'SELECT') AS anon,
                has_table_privilege('authenticated', 'public.${table}', 'SELECT') AS authenticated`,
      );
      expect(row).toEqual({ anon: false, authenticated: false });
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE public.${table}`);
    }
  });

  for (const role of DATA_API_ROLES) {
    it(`${role} con JWT de un OWNER no lee ni escribe directo`, async () => {
      for (const table of ['businesses', 'profiles', 'customers', 'appointments']) {
        const read = await asDataApi(role, `SELECT * FROM public.${table} LIMIT 1`).then(
          () => null,
          (error: unknown) => error,
        );
        expect(permissionDenied(read), `${role} SELECT ${table}`).toBe(true);
      }
      const write = await asDataApi(
        role,
        `INSERT INTO public.customers (business_id, full_name) VALUES ('${businessId}', 'Intruso')`,
      ).then(
        () => null,
        (error: unknown) => error,
      );
      expect(permissionDenied(write)).toBe(true);
      expect(await prisma.customer.count({ where: { businessId } })).toBe(0);
    });
  }
});
