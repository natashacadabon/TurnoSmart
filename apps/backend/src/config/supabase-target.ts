/** Solo hosts oficiales identificables; sin DNS, red ni decodificacion de passwords. */
export function databaseProject(url: URL, key: string) {
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname);
  let username: string;
  try {
    username = decodeURIComponent(url.username);
  } catch {
    throw new Error(`${key}: usuario no valido.`);
  }
  const pooledUser = /^postgres\.([a-z0-9]{20})$/.exec(username);
  if ((!direct || username !== 'postgres') && (!pooler || !pooledUser))
    throw new Error(`${key}: host/usuario Supabase no autorizado.`);
  if (url.pathname !== '/postgres' || url.hash || !['', '5432', '6543'].includes(url.port))
    throw new Error(`${key}: base o puerto no permitido.`);
  if (key === 'DIRECT_URL' && url.port === '6543')
    throw new Error('DIRECT_URL requiere conexion directa o pooler de sesion (5432).');
  validateParameters(url, key, true);
  return direct?.[1] ?? pooledUser![1]!;
}

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function readUrl(source: NodeJS.ProcessEnv, key: string, protocols: string[]) {
  try {
    const raw = source[key];
    if (!raw || raw !== raw.trim()) throw new Error();
    const url = new URL(raw);
    if (!protocols.includes(url.protocol)) throw new Error();
    return url;
  } catch {
    throw new Error(`Configuracion de destino invalida: ${key}`);
  }
}

function apiProject(source: NodeJS.ProcessEnv, key: string) {
  const url = readUrl(source, key, ['https:']);
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  if (
    !match ||
    url.origin !== source[key] ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(`Configuracion de destino invalida: ${key}`);
  return match[1]!;
}

/** Sin red ni SQL. Se ejecuta antes de crear Prisma o iniciar una migración. */
export function assertSupabaseTarget(source: NodeJS.ProcessEnv, migration = false) {
  const api = readUrl(source, 'SUPABASE_URL', ['http:', 'https:']);
  const db = readUrl(source, 'DATABASE_URL', ['postgres:', 'postgresql:']);
  const direct = source.DIRECT_URL
    ? readUrl(source, 'DIRECT_URL', ['postgres:', 'postgresql:'])
    : null;
  const urls = [api, db, ...(direct ? [direct] : [])];
  if (urls.every((url) => localHosts.has(url.hostname))) {
    validateParameters(db, 'DATABASE_URL', false);
    if (direct) validateParameters(direct, 'DIRECT_URL', false);
    if (source.RENDER === 'true' || source.DEPLOY_TARGET === 'production')
      throw new Error('Production/Render no admite destinos locales');
    if (migration && !direct) throw new Error('Falta DIRECT_URL para migraciones');
    return null;
  }

  const branch = source.RENDER === 'true' ? source.RENDER_GIT_BRANCH : undefined;
  const renderTarget = branch === 'main' ? 'production' : branch === 'dev' ? 'preview' : undefined;
  if (source.RENDER === 'true' && !renderTarget) throw new Error('Rama Render no autorizada');
  if (renderTarget && source.DEPLOY_TARGET && source.DEPLOY_TARGET !== renderTarget)
    throw new Error('DEPLOY_TARGET no coincide con la rama Render');
  const target = renderTarget ?? source.DEPLOY_TARGET;
  if (target !== 'preview' && target !== 'production')
    throw new Error('Falta DEPLOY_TARGET preview/production para destino remoto');
  const dev = apiProject(source, 'EXPECTED_DEV_SUPABASE');
  const production = apiProject(source, 'EXPECTED_PRODUCTION_SUPABASE');
  if (dev === production)
    throw new Error('Dev y Production deben ser proyectos Supabase distintos');
  const project = apiProject(source, 'SUPABASE_URL');
  if (project !== (target === 'production' ? production : dev))
    throw new Error('SUPABASE_URL no corresponde al entorno seleccionado');
  for (const [key, url] of [
    ['DATABASE_URL', db],
    ['DIRECT_URL', direct],
  ] as const) {
    if (url && (!url.password || databaseProject(url, key) !== project))
      throw new Error(`${key} no corresponde al proyecto Supabase esperado`);
  }
  if (migration && !direct) throw new Error('Falta DIRECT_URL para migraciones remotas');
  if (target === 'production' && source.CORS_ENVIRONMENT === 'dev')
    throw new Error('Production no admite CORS dinamico de Dev');
  const publicKey = source.SUPABASE_ANON_KEY;
  if (publicKey?.startsWith('sb_secret_'))
    throw new Error('SUPABASE_ANON_KEY requiere una clave publica');
  if (publicKey?.includes('.')) {
    try {
      const claims = JSON.parse(Buffer.from(publicKey.split('.')[1]!, 'base64url').toString());
      if (claims.role !== 'anon' || claims.ref !== project) throw new Error();
    } catch {
      throw new Error('SUPABASE_ANON_KEY no corresponde al proyecto esperado');
    }
  }
  return project;
}

function validateParameters(url: URL, key: string, remote: boolean) {
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
      throw new Error(`${key}: parametro de conexion no permitido.`);
  }
  if (
    remote &&
    !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')
  )
    throw new Error(`${key}: se requiere una conexion TLS.`);
  if (url.searchParams.has('sslaccept') && url.searchParams.get('sslaccept') !== 'strict')
    throw new Error(`${key}: no se permite omitir la validacion del certificado TLS.`);
  if (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public')
    throw new Error(`${key}: solo se admite schema public.`);
}
