import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { buildSeedData, SEED_ADMIN_EMAIL, validateSeedData } from './seed-data.js';
import { ensureSeedUsers, readSeedConfig, SeedError, verifyAdminLogin } from './seed-auth.js';
import { seedDomain } from './seed-runner.js';
import { checkSeedSchema } from './seed-checks.js';
import { seedStep, reportSeedFailure, withSeedCleanup } from './seed-diagnostics.js';

// Mantiene la ubicacion del seed anterior. Variables de la terminal tienen prioridad.
config({ path: fileURLToPath(new URL('../.env', import.meta.url)), override: false });

async function main() {
  const env = await seedStep('configuration', () => readSeedConfig(process.env)); // Destino autorizado y confirmado antes de toda red/escritura.
  console.info(
    env.projectRef
      ? `Destino Cloud de desarrollo autorizado: ${env.projectRef}`
      : 'Destino: Supabase local.',
  );
  const fixtures = await seedStep('fixtures', () => {
    const data = buildSeedData();
    validateSeedData(data);
    return data;
  });
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, redirect: 'error' }),
    },
  };
  const { adminClient, loginClient } = await seedStep('supabase_auth', () => ({
    adminClient: createClient(env.supabaseUrl, env.serviceKey, options),
    loginClient: createClient(env.supabaseUrl, env.anonKey, options),
  }));
  const prisma = await seedStep(
    'prisma_connection',
    () => new PrismaClient({ datasources: { db: { url: env.databaseUrl } } }),
  );
  await withSeedCleanup(
    async () => {
      console.info('[seed] Conexion Prisma.');
      await seedStep('prisma_connection', () => prisma.$connect());
      console.info(
        '[seed] Comprobacion de tablas y permisos de lectura (sin aplicar migraciones).',
      );
      await seedStep('migrations', () => checkSeedSchema(prisma));
      const owner = await ensureSeedUsers(
        adminClient.auth.admin,
        fixtures.accounts.filter((a) => a.email === SEED_ADMIN_EMAIL),
        env.password,
      );
      await verifyAdminLogin(loginClient.auth, env.password, owner[0]!.id);
      const others = await ensureSeedUsers(
        adminClient.auth.admin,
        fixtures.accounts.filter((a) => a.email !== SEED_ADMIN_EMAIL),
        env.password,
      );
      const counts = await seedDomain(prisma, fixtures, [...owner, ...others]);
      await seedStep('profiles', async () => {
        const profile = await prisma.profile.findUnique({ where: { id: owner[0]!.id } });
        if (profile?.role !== 'OWNER' || profile.businessId !== fixtures.businesses[0]!.id)
          throw new SeedError('No se pudo verificar el perfil OWNER del administrador.');
      });
      console.info('Seed completado. Login Auth y perfil OWNER verificados.');
      console.info(`Administrador: ${SEED_ADMIN_EMAIL}`);
      console.info(JSON.stringify(counts));
    },
    () => prisma.$disconnect(),
  );
}

main().catch((error: unknown) => {
  reportSeedFailure(error);
  process.exitCode = 1;
});
