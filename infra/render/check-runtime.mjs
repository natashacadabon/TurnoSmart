import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';

assert.equal(process.platform, 'linux');
assert.equal(process.versions.node.split('.')[0], '22');
const require = createRequire(join(process.cwd(), 'package.json'));
assert.equal(require('@turnosmart/shared').SLOT_INTERVAL_MINUTES, 15);
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({
  datasourceUrl: 'postgresql://smoke:smoke@127.0.0.1:1/smoke?connect_timeout=1',
});
try {
  // P1001 demuestra que el motor Linux cargo: no es un error de binario ausente.
  await assert.rejects(db.$connect(), (error) => error.errorCode === 'P1001');
} finally {
  await db.$disconnect();
}
const port = 43129;
const child = spawn('npm', ['run', 'start:render'], {
  detached: true,
  stdio: 'ignore',
  env: {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    PORT: String(port),
    DATABASE_URL: 'postgresql://smoke:smoke@127.0.0.1:1/smoke?connect_timeout=1',
    SUPABASE_URL: 'https://supabase.invalid',
    SUPABASE_ANON_KEY: 'smoke-not-a-secret',
    CORS_ORIGIN: 'https://turnosmart-demo.vercel.app',
  },
});
try {
  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Start Command de Render fallo');
    health = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
    if (health?.ok) break;
    await setTimeout(100);
  }
  assert(health?.ok, 'No escucha en PORT');
  assert.equal((await health.json()).status, 'ok');
  assert.equal((await fetch(`http://127.0.0.1:${port}/ready`)).status, 503);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/customers`)).status, 401);
  const preflight = await fetch(`http://127.0.0.1:${port}/api/customers`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://turnosmart-demo.vercel.app',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get('access-control-allow-origin'),
    'https://turnosmart-demo.vercel.app',
  );
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/i);
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Origin: 'https://other.vercel.app' },
      })
    ).status,
    403,
  );
} finally {
  if (child.exitCode === null) {
    const exited = once(child, 'exit');
    process.kill(-child.pid, 'SIGTERM');
    await exited;
  }
}
console.log(
  'Render local: Node 22/Linux, shared/Prisma, Start Command, PORT, health/ready/auth/CORS aprobados; sin BD remota.',
);
