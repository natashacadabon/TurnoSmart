import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  encryptMetadata,
  decryptMetadata,
  localDocker,
  outsideRepository,
  parseConnection,
  removeWorkspace,
  repository,
  validateTarget,
  validateImageConfig,
  postgresImage,
} from './database-backup.mjs';
const exec = promisify(execFile);
const fakeUrl = 'postgresql://postgres:synthetic-secret-not-for-logs@127.0.0.1:1/fixture';

test('no cifra metadata que luego sería rechazada por exceder el límite de recuperación', () => {
  assert.throws(
    () => encryptMetadata({ oversized: 'x'.repeat(4 * 1024 * 1024) }, Buffer.alloc(32)),
    /Metadata demasiado grande/,
  );
});

test('conexiones: credenciales ausentes, origen incorrecto, pooler transaccional y TLS inseguro', () => {
  assert.throws(() => parseConnection(undefined, 'fixture'), /DIRECT_URL/);
  assert.throws(
    () => parseConnection('postgres://postgres@localhost/fixture', 'fixture'),
    /credenciales/,
  );
  assert.throws(() => parseConnection(fakeUrl, 'production'), /ExpectedDatabase/);
  assert.throws(
    () => parseConnection(fakeUrl.replace(':1/', ':6543/'), 'fixture'),
    /transaction pooler/,
  );
  assert.throws(
    () => parseConnection(fakeUrl + '?pgbouncer=true', 'fixture'),
    /transaction pooler/,
  );
  assert.throws(
    () => parseConnection('postgres://u:p@db.invalid/fixture?sslmode=require', 'fixture'),
    /verify-full/,
  );
  assert.throws(
    () => parseConnection('postgres://u:p@x.pooler.supabase.com/fixture', 'fixture'),
    /session/,
  );
  const parsed = parseConnection('postgres://u:p%3Ass%5Cword@localhost/fixture', 'fixture');
  assert.equal(parsed.passfile, 'localhost:5432:fixture:u:p\\:ss\\\\word\n');
  assert.equal(parsed.env.PGPASSWORD, undefined);
  assert.equal(
    parseConnection('postgres://u:p@x.pooler.supabase.com/fixture', 'fixture', 'session').env
      .PGSSLMODE,
    'verify-full',
  );
});

test('no admite destinos de producción ni imágenes libres o incompatibles', () => {
  assert.doesNotThrow(() => validateImageConfig({ Volumes: { '/var/lib/postgresql/data': {} } }));
  assert.throws(() => validateImageConfig({ Volumes: { '/var/lib/postgresql': {} } }), /volúmenes/);
  assert.throws(() => validateTarget('production', postgresImage, 16, 1024), /destino/);
  assert.throws(
    () => validateTarget('turnosmart-restore-testing123', 'postgres:16-alpine', 16, 1024),
    /digest/,
  );
  assert.throws(
    () => validateTarget('turnosmart-restore-testing123', postgresImage, 17, 1024),
    /versión/,
  );
});

test('cleanup no sigue enlaces y rechaza tokens o rutas ajenas', async (t) => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'turnosmart-backup-node-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const f = { root };
  const work = { base: f.root, path: join(f.root, '.turnosmart-backup-owned'), token: 'owner' };
  await fs.mkdir(work.path);
  await fs.writeFile(join(work.path, '.owner'), work.token);
  const outside = join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(join(outside, 'keep'), 'safe');
  await fs.symlink(
    outside,
    join(work.path, 'link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(removeWorkspace({ ...work, token: 'wrong' }), /ajeno/);
  await assert.rejects(removeWorkspace({ ...work, base: dirname(f.root) }), /alcance/);
  await removeWorkspace(work);
  assert.equal(await fs.readFile(join(outside, 'keep'), 'utf8'), 'safe');
});

test('Git ignora backups/temporales/claves accidentales pero conserva las migraciones SQL', async () => {
  const ignored = [
    'backups/legacy.dump',
    'accidental.dump',
    'accidental.dump.enc',
    'accidental.meta.enc',
    'accidental.backup.json',
    'accidental.backup-key',
    '.turnosmart-backup-fixture/pgpass',
  ];
  for (const file of ignored) {
    const result = await exec('git', ['-C', repository, 'check-ignore', '--no-index', file]);
    assert.equal(result.stdout.trim(), file);
  }
  await assert.rejects(
    exec('git', [
      '-C',
      repository,
      'check-ignore',
      '--no-index',
      'apps/backend/prisma/migrations/fixture/migration.sql',
    ]),
    (error) => error.code === 1,
  );
});

test('Docker: permite named pipes locales y sockets Unix; rechaza endpoints remotos', async () => {
  const previous = { host: process.env.DOCKER_HOST, context: process.env.DOCKER_CONTEXT };
  try {
    delete process.env.DOCKER_HOST;
    process.env.DOCKER_CONTEXT = 'fixture-context';
    for (const endpoint of [
      'npipe:////./pipe/docker_engine',
      'npipe:////./pipe/dockerDesktopLinuxEngine',
      'unix:///var/run/docker.sock',
      'unix:///Users/fixture/.docker/run/docker.sock',
    ]) {
      await localDocker(async (file, args) => {
        assert.equal(file, 'docker');
        assert.deepEqual(args, ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
        return endpoint;
      });
    }
    for (const endpoint of [
      'tcp://127.0.0.1:2375',
      'tcp://remote.invalid:2376',
      'ssh://remote.invalid',
      'http://localhost:2375',
      'npipe:////remote/pipe/docker_engine',
      'npipe:////localhost/pipe/docker_engine',
      'npipe:////./pipe/docker/engine',
      'unix://remote.invalid/var/run/docker.sock',
      'unix://relative.sock',
      'npipe:////./pipe/',
      '',
      'unix:///var/run/docker.sock\nssh://remote',
    ]) {
      await assert.rejects(
        localDocker(async () => endpoint),
        /daemon Docker local/,
        endpoint,
      );
    }
    delete process.env.DOCKER_CONTEXT;
    process.env.DOCKER_HOST = 'npipe:////./pipe/dockerDesktopLinuxEngine';
    const unexpected = async () => {
      throw new Error('DOCKER_HOST should be used');
    };
    await localDocker(unexpected);
    process.env.DOCKER_HOST = 'tcp://remote.invalid:2376';
    await assert.rejects(localDocker(unexpected), /daemon Docker local/);
    process.env.DOCKER_CONTEXT = 'explicit-context';
    await localDocker(async () => 'unix:///var/run/docker.sock');
  } finally {
    for (const [name, value] of [
      ['DOCKER_HOST', previous.host],
      ['DOCKER_CONTEXT', previous.context],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('metadata: cifrado autenticado conserva datos y rechaza alteraciones', () => {
  const key = Buffer.alloc(32, 7);
  const metadata = { database: 'synthetic', sha: 'fixture' };
  const encrypted = encryptMetadata(metadata, key);
  assert.deepEqual(decryptMetadata(encrypted, key), metadata);
  encrypted[20] ^= 1;
  assert.throws(() => decryptMetadata(encrypted, key), /Clave incorrecta/);
});

test('rutas: rechaza el checkout y sus alias físicos sin requerir PowerShell', async (t) => {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'turnosmart-backup-paths-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(outsideRepository(join(repository, 'dump')), /fuera del repositorio/);
  const physical = join(root, 'repository');
  await fs.mkdir(physical);
  const alias = join(root, 'alias');
  await fs.symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    outsideRepository(join(physical, 'dump'), { root: alias }),
    /físicamente fuera/,
  );
  await assert.rejects(outsideRepository(join(alias, 'dump')), /enlaces/);
});

test('CLI: Node 22 es la única versión soportada y se rechaza Node 20/24', async () => {
  assert.equal(
    process.versions.node.split('.')[0],
    '22',
    'Ejecutar las validaciones con Node.js 22.x',
  );
  const core = join(repository, 'scripts/database-backup.mjs');
  await assert.rejects(
    exec(process.execPath, [core, 'invalid-operation']),
    (error) => error.code === 1 && /Operación inválida/.test(error.stderr),
  );
  for (const version of ['20.0.0', '24.0.0']) {
    // Exercise the version guard using a synthetic version, without claiming Node 24 support.
    const preload =
      'data:text/javascript,' +
      encodeURIComponent(
        'Object.defineProperty(process.versions, "node", {value:' + JSON.stringify(version) + '});',
      );
    await assert.rejects(
      exec(process.execPath, ['--import', preload, core, 'invalid-operation']),
      (error) =>
        error.code === 1 && /Se requiere Node.js 22.x/.test(error.stderr) && error.stdout === '',
    );
  }
});
