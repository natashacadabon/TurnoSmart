import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const command = process.argv[2];
if (!['up', 'down', 'logs', 'reset', 'config'].includes(command))
  throw new Error('Comando local desconocido.');

const id = createHash('sha256').update(root).digest('hex').slice(0, 16);
const socket =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\turnosmart-${id}`
    : join(tmpdir(), `turnosmart-${id}.sock`);
const localFile = join(root, '.env.dev');
const local = existsSync(localFile) ? parseEnv(readFileSync(localFile, 'utf8')) : {};
// Do not inherit cloud credentials or a remote DATABASE_URL from the terminal.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(path|systemroot|windir|comspec|pathext|temp|tmp|home|userprofile|appdata|localappdata|programfiles|programfiles\(x86\)|systemdrive|programdata)$/i.test(
      key,
    ),
  ),
);
for (const [key, fallback] of Object.entries({
  TS_FRONTEND_PORT: '3000',
  TS_BACKEND_PORT: '4000',
  TS_POSTGRES_PORT: '54325',
  TS_AUTH_PORT: '54326',
})) {
  const value = process.env[key] ?? local[key] ?? fallback;
  if (!/^\d+$/.test(value) || +value < 1024 || +value > 65535)
    throw new Error(`Puerto invalido: ${key}`);
  env[key] = String(+value);
}
if (
  new Set(
    ['TS_FRONTEND_PORT', 'TS_BACKEND_PORT', 'TS_POSTGRES_PORT', 'TS_AUTH_PORT'].map(
      (key) => env[key],
    ),
  ).size !== 4
)
  throw new Error('Los puertos locales deben ser distintos.');

env.TS_SEED_PASSWORD = local.TS_SEED_PASSWORD ?? 'TurnoSmartLocal2026';
if (env.TS_SEED_PASSWORD.length < 10) throw new Error('Password local demasiado corta.');
const state = join(root, '.local');
mkdirSync(state, { recursive: true });
const secretFile = join(state, 'auth-secret');
if (!local.TS_JWT_SECRET && !existsSync(secretFile))
  writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
env.TS_JWT_SECRET = local.TS_JWT_SECRET ?? readFileSync(secretFile, 'utf8');
if (!/^[a-f0-9]{64}$/.test(env.TS_JWT_SECRET)) throw new Error('TS_JWT_SECRET local invalido.');
function jwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, iss: 'turnosmart-local', exp: 4102444800 })}`;
  return `${payload}.${createHmac('sha256', env.TS_JWT_SECRET).update(payload).digest('base64url')}`;
}
env.TS_ANON_KEY = jwt('anon');
env.TS_SERVICE_KEY = jwt('service_role');

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: root, env, stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`Fallo el comando local: ${file}`);
  return result;
}
// Respect Docker context selection, but reject remote daemons before any operation.
const dockerEnv = { ...env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG'])
  if (process.env[key]) dockerEnv[key] = process.env[key];
const docker = (args, options = {}) => run('docker', args, { env: dockerEnv, ...options });
const endpoint =
  dockerEnv.DOCKER_HOST && !dockerEnv.DOCKER_CONTEXT
    ? dockerEnv.DOCKER_HOST
    : docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], {
        encoding: 'utf8',
        stdio: 'pipe',
      }).stdout.trim();
if (!/^(npipe:\/\/\/\/\.\/pipe\/[^/\\]+|unix:\/\/\/[^\r\n]+)$/.test(endpoint))
  throw new Error('Se requiere Docker local.');
const compose = (...args) =>
  docker([
    'compose',
    '--project-name',
    'turnosmart-local',
    '--env-file',
    process.platform === 'win32' ? 'NUL' : '/dev/null',
    '-f',
    'infra/docker/compose.dev.yml',
    ...args,
  ]);

async function stopRunning() {
  return new Promise((resolve, reject) => {
    const client = createConnection(socket);
    client.on('connect', () => client.end('stop'));
    let connected = false;
    client.on('connect', () => {
      connected = true;
    });
    client.on('close', () => resolve(connected));
    client.on('error', (error) => {
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) resolve();
      else reject(error);
    });
  });
}

const npm = (...args) => run(process.execPath, [process.env.npm_execpath, ...args]);
const databaseUrl = `postgresql://turnosmart_local:turnosmart-local-db@127.0.0.1:${env.TS_POSTGRES_PORT}/turnosmart_local`;
Object.assign(env, {
  NODE_ENV: 'development',
  HUSKY: '0',
  DOTENV_CONFIG_PATH: process.platform === 'win32' ? 'NUL' : '/dev/null',
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  SUPABASE_URL: `http://127.0.0.1:${env.TS_AUTH_PORT}`,
  SUPABASE_ANON_KEY: env.TS_ANON_KEY,
  PORT: env.TS_BACKEND_PORT,
  TURNOSMART_LOCAL_DEV: 'true',
  CORS_ORIGIN: `http://localhost:${env.TS_FRONTEND_PORT}`,
  CORS_ENVIRONMENT: 'production',
  TURNOSMART_DOCKER_SEED: 'true',
  ALLOW_REMOTE_SEED: 'false',
  SUPABASE_SECRET_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: env.TS_SERVICE_KEY,
  SEED_ADMIN_PASSWORD: env.TS_SEED_PASSWORD,
  GEMINI_API_KEY: '',
  NEXT_PUBLIC_API_URL: `http://localhost:${env.TS_BACKEND_PORT}`,
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${env.TS_AUTH_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: env.TS_ANON_KEY,
  NEXT_TELEMETRY_DISABLED: '1',
});
function prepare() {
  const marker = join(state, 'dependencies');
  const manifests = [
    'package-lock.json',
    'package.json',
    'apps/backend/package.json',
    'apps/frontend/package.json',
    'packages/shared/package.json',
  ];
  const fingerprint = createHash('sha256')
    .update(process.version)
    .update(manifests.map((file) => readFileSync(join(root, file))).join('\n'))
    .digest('hex');
  if (
    !existsSync(join(root, 'node_modules')) ||
    (existsSync(marker) && readFileSync(marker, 'utf8') !== fingerprint)
  )
    npm('ci', '--include=dev', '--no-audit', '--no-fund');
  else if (!existsSync(marker)) npm('ls', '--workspaces', '--depth=0');
  writeFileSync(marker, fingerprint);
  npm('run', 'prisma:generate', '--workspace=apps/backend');
  npm('run', 'prisma:migrate', '--workspace=apps/backend');
  npm('run', 'prisma:seed', '--workspace=apps/backend');
  npm('run', 'build:shared');
}

if (command === 'config') compose('config', '--quiet');
if (command === 'logs') compose('logs', '-f', ...process.argv.slice(3));
const stopped = ['down', 'reset'].includes(command) ? await stopRunning() : false;
if (command === 'down' && !stopped) compose('down', '--remove-orphans');
if (command === 'reset') {
  // Only the hard-coded application database inside the owned Compose service.
  // No volume removal, host DATABASE_URL, remote URL or auth schema reset.
  compose('up', '-d', '--wait', '--remove-orphans');
  try {
    compose(
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'turnosmart_local',
      '-d',
      'turnosmart_local',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
    );
    prepare();
  } finally {
    compose('down', '--remove-orphans');
  }
}
if (command === 'up') {
  const children = [];
  let stopping = false;
  const server = createServer((connection) => {
    connection.once('data', () => {
      shutdown();
      connection.end();
    });
  });
  function shutdown() {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (child.exitCode !== null || !child.pid) continue;
      if (process.platform === 'win32')
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          /* Already exited. */
        }
      }
    }
    try {
      compose('down', '--remove-orphans');
    } finally {
      server.close();
    }
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, resolve);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  try {
    compose('up', '-d', '--wait', '--remove-orphans');
    prepare();
    const tsx = join(root, 'node_modules/tsx/dist/cli.mjs');
    const next = join(root, 'node_modules/next/dist/bin/next');
    const tsc = join(root, 'node_modules/typescript/bin/tsc');
    const runtimeEnv = { ...env };
    for (const key of [
      'TS_JWT_SECRET',
      'TS_SERVICE_KEY',
      'TS_SEED_PASSWORD',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SEED_ADMIN_PASSWORD',
    ])
      delete runtimeEnv[key];
    function start(args, cwd) {
      const child = spawn(process.execPath, args, {
        cwd,
        env: runtimeEnv,
        stdio: 'inherit',
        detached: process.platform !== 'win32',
      });
      children.push(child);
      child.on('error', shutdown);
      child.on('exit', () => {
        if (!stopping) {
          process.exitCode = 1;
          shutdown();
        }
      });
    }
    start([tsc, '--watch', '--preserveWatchOutput'], join(root, 'packages/shared'));

    start([tsx, 'watch', 'src/index.ts'], join(root, 'apps/backend'));
    start(
      [next, 'dev', '--hostname', '127.0.0.1', '--port', env.TS_FRONTEND_PORT],
      join(root, 'apps/frontend'),
    );

    console.info(
      `Frontend http://localhost:${env.TS_FRONTEND_PORT} | API http://localhost:${env.TS_BACKEND_PORT}/ready. Ctrl+C o npm run docker:down para detener todo.`,
    );
  } catch (error) {
    shutdown();
    throw error;
  }
}
