import assert from 'node:assert/strict';
import { readdirSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const root = resolve(process.argv[2]);
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
assert.equal(process.versions.node.split('.')[0], '22');
assert.deepEqual(readdirSync(root).sort(), [
  'build-info.json',
  'dist',
  'node_modules',
  'package.json',
]);
function inspect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    assert(!lstatSync(path).isSymbolicLink(), 'El ZIP no debe contener enlaces workspace');
    assert(!/^\.env(?:\.|$)/.test(entry.name), 'Archivo de entorno en ZIP');
    assert(
      !['test', 'tests', '__tests__', 'coverage', '.git', '.github', '.bin'].includes(entry.name),
      'Herramientas/tests en ZIP',
    );
    assert(!/(?:^|[.-])(test|spec)\.[cm]?[jt]sx?$/.test(entry.name), 'Archivo de test en ZIP');
    if (entry.isDirectory()) inspect(path);
  }
}
inspect(root);
for (const name of ['prisma', 'typescript', 'tsx', 'vitest', 'eslint', 'husky', 'next'])
  assert(!existsSync(join(root, 'node_modules', name)), `Dependencia dev: ${name}`);
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.equal(manifest.scripts.start, 'node dist/index.js');
assert(!manifest.devDependencies && !manifest.workspaces);
const require = createRequire(join(root, 'package.json'));
for (const name of Object.keys(manifest.dependencies)) require.resolve(name);
assert.equal(require('@turnosmart/shared').SLOT_INTERVAL_MINUTES, 15);
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({
  datasourceUrl: 'postgresql://smoke:smoke@127.0.0.1:1/smoke?connect_timeout=1',
});
try {
  await assert.rejects(db.$connect(), (error) => error.errorCode === 'P1001');
} finally {
  await db.$disconnect();
}
// Env de prueba cerrado: no hereda credenciales del host ni usa .env/Supabase.
const port = 43127;
const child = spawn(process.execPath, ['dist/index.js'], {
  cwd: root,
  stdio: 'ignore',
  env: {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    PORT: String(port),
    CORS_ORIGIN: 'https://demo.invalid',
    SUPABASE_URL: 'https://supabase.invalid',
    SUPABASE_ANON_KEY: 'smoke-not-a-secret',
    DATABASE_URL: 'postgresql://smoke:smoke@127.0.0.1:1/smoke?connect_timeout=1',
  },
});
try {
  let response;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Startup del ZIP fallo');
    response = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
    if (response?.ok) break;
    await setTimeout(100);
  }
  assert(response?.ok, 'El backend no escucha en PORT');
  assert.equal((await response.json()).status, 'ok');
  assert.equal((await fetch(`http://127.0.0.1:${port}/ready`)).status, 503);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/customers`)).status, 401);
  const cors = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: { Origin: 'https://demo.invalid' },
  });
  assert.equal(cors.headers.get('access-control-allow-origin'), 'https://demo.invalid');
} finally {
  child.kill('SIGTERM');
}
console.log(
  'ZIP extraido verificado: Linux x64, Node 22, Prisma cargado, shared, PORT, health/ready/auth/CORS; sin secretos ni dev tools.',
);
