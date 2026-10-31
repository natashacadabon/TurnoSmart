import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SEED_ADMIN_EMAIL, type SeedData } from './seed-data.js';
import { ALLOWED_REMOTE_SEED_PROJECT_REFS } from './seed-targets.js';

import { SeedError, seedStep } from './seed-diagnostics.js';
export { SeedError } from './seed-diagnostics.js';
export type SeedConfig = ReturnType<typeof readSeedConfig>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PROJECT_REF = /^[a-z0-9]{20}$/;

function seedUrl(env: NodeJS.ProcessEnv, key: string, protocols: string[]) {
  const raw = env[key];
  if (!raw) throw new SeedError(`Falta ${key}.`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SeedError(`${key} no es una URL valida.`);
  }
  if (!protocols.includes(url.protocol)) throw new SeedError(`${key}: protocolo no permitido.`);
  return { raw, url };
}

/** Solo hosts oficiales identificables; sin DNS, red ni decodificacion de passwords. */
function databaseProject(url: URL, key: string) {
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname);
  let username: string;
  try {
    username = decodeURIComponent(url.username);
  } catch {
    throw new SeedError(`${key}: usuario no valido.`);
  }
  const pooledUser = /^postgres\.([a-z0-9]{20})$/.exec(username);
  if ((!direct || username !== 'postgres') && (!pooler || !pooledUser))
    throw new SeedError(`${key}: host/usuario Supabase no autorizado.`);
  if (url.pathname !== '/postgres' || url.hash || !['', '5432', '6543'].includes(url.port))
    throw new SeedError(`${key}: base o puerto no permitido.`);
  if (key === 'DIRECT_URL' && url.port === '6543')
    throw new SeedError('DIRECT_URL requiere conexion directa o pooler de sesion (5432).');
  // No permitir parametros que redirijan la conexion o seleccionen otro schema.
  const allowedParams = new Set([
    'pgbouncer',
    'schema',
    'sslmode',
    'sslaccept',
    'connection_limit',
    'pool_timeout',
    'connect_timeout',
    'socket_timeout',
    'statement_cache_size',
  ]);
  for (const name of url.searchParams.keys()) {
    if (!allowedParams.has(name) || url.searchParams.getAll(name).length !== 1)
      throw new SeedError(`${key}: parametro de conexion no permitido.`);
  }
  if (!['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? ''))
    throw new SeedError(`${key}: se requiere una conexion TLS.`);
  if (url.searchParams.has('sslaccept') && url.searchParams.get('sslaccept') !== 'strict')
    throw new SeedError(`${key}: no se permite omitir la validacion del certificado TLS.`);
  if (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public')
    throw new SeedError(`${key}: solo se admite schema public.`);
  return direct?.[1] ?? pooledUser![1]!;
}

/** Se valida antes de crear clientes o hacer la primera llamada de red. */
export function readSeedConfig(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV?.trim().toLowerCase() === 'production')
    throw new SeedError('Seed bloqueado en produccion.');
  const db = seedUrl(env, 'DATABASE_URL', ['postgres:', 'postgresql:']);
  const api = seedUrl(env, 'SUPABASE_URL', ['http:', 'https:']);
  const direct = env.DIRECT_URL ? seedUrl(env, 'DIRECT_URL', ['postgres:', 'postgresql:']) : null;
  const local = [db.url, api.url, ...(direct ? [direct.url] : [])].every((url) =>
    LOCAL_HOSTS.has(url.hostname),
  );
  let projectRef: string | null = null;
  if (!local) {
    if (env.ALLOW_REMOTE_SEED !== 'true')
      throw new SeedError('Fuera de loopback: Cloud requiere ALLOW_REMOTE_SEED=true.');
    const apiMatch = /^([a-z0-9]{20})\.supabase\.co$/.exec(api.url.hostname);
    if (
      !apiMatch ||
      api.url.protocol !== 'https:' ||
      api.url.port ||
      api.url.username ||
      api.url.password ||
      api.url.pathname !== '/' ||
      api.url.search ||
      api.url.hash
    )
      throw new SeedError('SUPABASE_URL: solo se admite la URL HTTPS oficial del proyecto.');
    projectRef = apiMatch[1]!;
    if (!PROJECT_REF.test(projectRef) || !ALLOWED_REMOTE_SEED_PROJECT_REFS.includes(projectRef))
      throw new SeedError('Project Ref remoto fuera de la lista autorizada.');
    if (!direct)
      throw new SeedError('Cloud requiere DIRECT_URL explicita para verificar el proyecto.');
    if (
      databaseProject(db.url, 'DATABASE_URL') !== projectRef ||
      databaseProject(direct.url, 'DIRECT_URL') !== projectRef
    )
      throw new SeedError(
        'DATABASE_URL, DIRECT_URL y SUPABASE_URL deben corresponder al mismo proyecto autorizado.',
      );
    if (env.SEED_CONFIRM_REMOTE !== `seed:${projectRef}`)
      throw new SeedError(
        'Falta confirmacion explicita: SEED_CONFIRM_REMOTE=seed:<Project Ref autorizado>.',
      );
  }
  // SUPABASE_SECRET_KEY admite sb_secret_...; el SDK lo envia como API key, no lo decodificamos como JWT.
  const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey)
    throw new SeedError('Falta SUPABASE_SECRET_KEY o SUPABASE_SERVICE_ROLE_KEY (solo backend).');
  if (serviceKey.startsWith('sb_publishable_'))
    throw new SeedError('La clave administrativa debe ser privilegiada, no publishable.');
  if (!env.SUPABASE_ANON_KEY) throw new SeedError('Falta SUPABASE_ANON_KEY para verificar login.');
  if (!env.SEED_ADMIN_PASSWORD || env.SEED_ADMIN_PASSWORD.length < 10)
    throw new SeedError('Defini SEED_ADMIN_PASSWORD con al menos 10 caracteres.');
  return {
    databaseUrl: db.raw,
    supabaseUrl: api.raw,
    serviceKey,
    anonKey: env.SUPABASE_ANON_KEY,
    password: env.SEED_ADMIN_PASSWORD,
    projectRef,
  };
}

type Admin = Pick<SupabaseClient['auth']['admin'], 'listUsers' | 'createUser'>;
export async function findSeedUser(admin: Admin, email: string) {
  return seedStep('supabase_auth', async () => {
    for (let page = 1; ; page++) {
      const { data, error } = await admin.listUsers({ page, perPage: 200 });
      if (error) throw error; // seedStep conserva solo tipo/codigo/status permitidos.
      const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (user) return user;
      if (data.users.length < 200) return null;
    }
  });
}

/** Reutiliza cuentas sin actualizar password ni metadatos del usuario existente. */
export async function ensureSeedUsers(
  admin: Admin,
  accounts: SeedData['accounts'],
  password: string,
) {
  const profiles = [];
  for (const account of accounts) {
    let user = await findSeedUser(admin, account.email);
    if (!user) {
      user = await seedStep('user_creation', async () => {
        const result = await admin.createUser({
          email: account.email,
          password:
            account.email === SEED_ADMIN_EMAIL ? password : randomBytes(32).toString('base64url'),
          email_confirm: true,
          user_metadata: { source: 'turnosmart-development-seed' },
        });
        if (result.error) {
          // Solo un duplicado admite recuperar la carrera. No ocultar 401/403/429 u otros errores.
          if (result.error.code === 'email_exists' || result.error.code === 'user_already_exists') {
            const existing = await findSeedUser(admin, account.email);
            if (existing) return existing;
          }
          throw result.error;
        }
        if (!result.data.user) throw new SeedError('Auth no devolvio un usuario creado.');
        return result.data.user;
      });
    }
    await seedStep('supabase_auth', () => {
      if (!user.email_confirmed_at)
        throw new SeedError(
          'Una cuenta de prueba existente no esta confirmada; revisala en Auth del destino.',
        );
    });
    profiles.push({ id: user.id, ...account });
  }
  return profiles;
}

export async function verifyAdminLogin(
  auth: SupabaseClient['auth'],
  password: string,
  expectedId: string,
) {
  await seedStep('auth_login', async () => {
    const { data, error } = await auth.signInWithPassword({ email: SEED_ADMIN_EMAIL, password });
    if (error) throw error;
    if (data.user?.id !== expectedId || !data.session)
      throw new SeedError(
        'No se pudo iniciar sesion: si la cuenta ya existia, usa su password original. El seed no la cambia.',
      );
    const verified = await auth.getUser(data.session.access_token);
    if (verified.error) throw verified.error;
    if (verified.data.user?.id !== expectedId)
      throw new SeedError('El token del administrador no pudo verificarse.');
  });
  await seedStep('auth_session_cleanup', async () => {
    const { error } = await auth.signOut({ scope: 'local' });
    if (error) throw error;
  });
}
