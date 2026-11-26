import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  backup,
  decryptMetadata,
  encryptMetadata,
  generateKey,
  localDocker,
  outsideRepository,
  parseConnection,
  removeWorkspace,
  repository,
  restore,
  validateTarget,
  validateImageConfig,
  postgresImage,
} from './database-backup.mjs';

const exec = promisify(execFile);
const core = join(repository, 'scripts/database-backup.mjs');
const fakeIdentity = {
  database: 'fixture',
  user: 'postgres',
  serverVersion: 160011,
  owner: 'postgres',
  migrationTable: true,
  roles: [],
  memberships: [],
  databasePrivileges: [],
  extensions: [{ name: 'plpgsql', version: '1.0' }],
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fakeUrl = 'postgresql://postgres:synthetic-secret-not-for-logs@127.0.0.1:1/fixture';

test('no cifra metadata que luego sería rechazada por exceder el límite de recuperación', () => {
  assert.throws(
    () => encryptMetadata({ oversized: 'x'.repeat(4 * 1024 * 1024) }, Buffer.alloc(32)),
    /Metadata demasiado grande/,
  );
});

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'turnosmart-backup-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const keyFile = join(root, 'keys/recovery.backup-key');
  await generateKey(keyFile);
  const psql = join(root, 'psql.ps1');
  await fs.writeFile(psql, `'${JSON.stringify(fakeIdentity)}'\n`);
  const tool = async (name, body) => {
    const path = join(root, name + '.ps1');
    await fs.writeFile(
      path,
      `if ($args -contains '--version') { 'pg_dump (PostgreSQL) 16.11'; exit 0 }\n${body}\n`,
    );
    return path;
  };
  const pgDump = await tool(
    'pg-dump',
    `[Console]::OpenStandardOutput().Write([Text.Encoding]::UTF8.GetBytes('PGDMPsynthetic data only'))`,
  );
  const outputDirectory = join(root, 'backups');
  const args = [
    'backup',
    '--key-file',
    keyFile,
    '--environment',
    'local',
    '--database',
    'fixture',
    '--psql',
    psql,
    '--pg-dump',
    pgDump,
    '--output-directory',
    outputDirectory,
  ];
  const invoke = (extra = [], env = {}) =>
    exec(process.execPath, [core, ...args, ...extra], {
      env: { ...process.env, DIRECT_URL: fakeUrl, ...env },
      timeout: 20_000,
    });
  return { root, keyFile, psql, pgDump, outputDirectory, tool, invoke, args };
}

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

test('rechaza rutas del repositorio, enlaces y claves existentes sin sobrescribir', async (t) => {
  await assert.rejects(outsideRepository(join(repository, 'backups')), /fuera del repositorio/);
  const f = await fixture(t);
  const key = await fs.readFile(f.keyFile);
  await assert.rejects(generateKey(f.keyFile));
  assert.deepEqual(await fs.readFile(f.keyFile), key);
  const link = join(f.root, 'linked');
  await fs.symlink(f.outputDirectory, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(outsideRepository(join(link, 'dump')), /enlaces/);
  const fakeRepository = join(f.root, 'repository');
  await fs.mkdir(fakeRepository);
  const rootAlias = join(f.root, 'repository-alias');
  await fs.symlink(fakeRepository, rootAlias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    outsideRepository(join(fakeRepository, 'dump'), { root: rootAlias }),
    /físicamente fuera/,
  );
});

test('un backup cifra datos y metadata, verifica checksum y no deja plaintext ni pgpass', async (t) => {
  const f = await fixture(t);
  const { stdout, stderr } = await f.invoke();
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  const index = JSON.parse(await fs.readFile(result.backupFile, 'utf8'));
  assert.equal(index.environment, 'local');
  assert.match(index.sha, /^[a-f0-9]{40}$/);
  assert.equal(typeof index.dirty, 'boolean');
  const dump = await fs.readFile(join(f.outputDirectory, index.dumpFile));
  assert.equal(hash(dump), index.dumpSha256);
  assert.equal(dump.includes(Buffer.from('synthetic data')), false);
  assert.equal(dump.subarray(0, 4).toString(), 'TSB1');
  const metaBytes = await fs.readFile(join(f.outputDirectory, index.metadataFile));
  assert.equal(hash(metaBytes), index.metadataSha256);
  assert.equal(metaBytes.includes(Buffer.from('database')), false);
  const metadata = decryptMetadata(metaBytes, await fs.readFile(f.keyFile));
  assert.equal(metadata.identity.database, 'fixture');
  assert.equal(metadata.plainSha256, hash(Buffer.from('PGDMPsynthetic data only')));
  assert.equal((await fs.readdir(f.outputDirectory)).length, 3);
  assert.equal(stdout.includes('synthetic-secret-not-for-logs'), false);
});

test('PowerShell propaga códigos de salida y no acepta la antigua URL destructiva', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    exec(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(repository, 'scripts/backup-db.ps1'),
        '-SourceEnvironment',
        'local',
        '-ExpectedDatabase',
        'fixture',
        '-KeyFile',
        f.keyFile,
      ],
      { env: { ...process.env, DIRECT_URL: '', DATABASE_URL: fakeUrl }, timeout: 20_000 },
    ),
    (error) =>
      error.code !== 0 &&
      /DIRECT_URL/.test(error.stderr) &&
      !error.stderr.includes('synthetic-secret-not-for-logs'),
  );
  await assert.rejects(
    exec(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(repository, 'scripts/restore-db.ps1'),
        '-BackupFile',
        'missing',
        '-ExpectedEnvironment',
        'local',
        '-TargetDatabaseUrl',
        fakeUrl,
        '-ConfirmRestore',
        'RESTORE_TEST_DATABASE',
      ],
      { timeout: 10_000 },
    ),
  );
});

for (const [name, body, message] of [
  ['pg_dump-error', `Write-Error 'synthetic-secret-not-for-logs'; exit 23`, /código 23/],
  ['invalid-archive', `[Console]::Write('not a dump')`, /custom válido/],
]) {
  test(`${name}: detecta fallo y limpia únicamente su staging`, async (t) => {
    const f = await fixture(t);
    await fs.mkdir(f.outputDirectory, { recursive: true });
    const sentinel = join(f.outputDirectory, 'previous-backup.keep');
    await fs.writeFile(sentinel, 'preserve');
    const pgDump = await f.tool(name, body);
    await assert.rejects(f.invoke(['--pg-dump', pgDump]), (error) => {
      assert.match(error.stderr, message);
      assert.equal(error.stderr.includes('synthetic-secret-not-for-logs'), false);
      return true;
    });
    assert.deepEqual(await fs.readdir(f.outputDirectory), ['previous-backup.keep']);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'preserve');
  });
}

test('salida inválida no crea un índice exitoso ni modifica la clave', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    backup({
      keyFile: f.keyFile,
      environment: 'local',
      database: 'fixture',
      outputDirectory: f.keyFile,
    }),
  );
  assert.equal((await fs.readFile(f.keyFile)).length, 32);
});

test('restore rechaza archivos ausentes, truncados, checksums alterados, clave incorrecta y entorno distinto antes de Docker', async (t) => {
  const f = await fixture(t);
  const { stdout } = await f.invoke();
  const { backupFile } = JSON.parse(stdout);
  const options = { keyFile: f.keyFile, environment: 'local', backupFile };
  await assert.rejects(restore({ ...options, backupFile: join(f.root, 'missing.backup.json') }));
  await assert.rejects(restore({ ...options, environment: 'production' }), /entorno/);
  const wrongKey = join(f.root, 'keys/other.backup-key');
  await generateKey(wrongKey);
  await assert.rejects(restore({ ...options, keyFile: wrongKey }), /Clave incorrecta/);
  const index = JSON.parse(await fs.readFile(backupFile, 'utf8'));
  const meta = join(dirname(backupFile), index.metadataFile);
  const original = await fs.readFile(meta);
  const corrupted = Buffer.from(original);
  corrupted[20] ^= 1;
  await fs.writeFile(meta, corrupted);
  await assert.rejects(restore(options), /Checksum/);
  index.metadataSha256 = hash(corrupted);
  await fs.writeFile(backupFile, JSON.stringify(index));
  await assert.rejects(restore(options), /Clave incorrecta/);
  await fs.writeFile(meta, original.subarray(0, 12));
  index.metadataSha256 = hash(original.subarray(0, 12));
  await fs.writeFile(backupFile, JSON.stringify(index));
  await assert.rejects(restore(options), /Metadata cifrada inválida/);
});

test('no admite destinos de producción, imágenes libres ni un daemon remoto', async () => {
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
  await assert.rejects(
    localDocker(async () => 'tcp://remote.invalid:2376'),
    /local/,
  );
  await assert.rejects(
    localDocker(async () => 'npipe:////remote/pipe/docker'),
    /local/,
  );
});

test('cleanup no sigue enlaces y rechaza tokens o rutas ajenas', async (t) => {
  const f = await fixture(t);
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

test('una interrupción controlada limpia pgpass y no publica un backup exitoso', async (t) => {
  const f = await fixture(t);
  const marker = join(f.root, 'dump-started');
  const markerLiteral = marker.replaceAll("'", "''");
  const slow = await f.tool(
    'slow-pg-dump',
    `[IO.File]::WriteAllText('${markerLiteral}', $env:PGPASSFILE); Start-Sleep -Seconds 30`,
  );
  const signalModule = join(f.root, 'signal.mjs');
  await fs.writeFile(
    signalModule,
    `import { existsSync } from 'node:fs';
const timer=setInterval(()=>{if(existsSync(${JSON.stringify(marker)})){clearInterval(timer);process.emit('SIGTERM');}},25);timer.unref();`,
  );
  await assert.rejects(
    exec(
      process.execPath,
      ['--import', pathToFileURL(signalModule).href, core, ...f.args, '--pg-dump', slow],
      { env: { ...process.env, DIRECT_URL: fakeUrl }, timeout: 20000 },
    ),
    (error) => {
      assert.equal(error.code, 143);
      assert.equal(error.stdout, '');
      assert.equal(error.stderr.includes('synthetic-secret-not-for-logs'), false);
      return true;
    },
  );
  assert.deepEqual(await fs.readdir(f.outputDirectory), []);
  await assert.rejects(fs.stat(await fs.readFile(marker, 'utf8')), { code: 'ENOENT' });
});

test('una colisión al publicar revierte archivos propios y conserva el backup ajeno', async (t) => {
  const f = await fixture(t);
  const out = f.outputDirectory.replaceAll("'", "''");
  const tool = await f.tool(
    'publication-collision',
    `
    $staged=$null
    for($i=0;$i -lt 100;$i++) {
      $staged=Get-ChildItem -LiteralPath '${out}' -Directory -Force | ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Filter '*.dump.enc' -File } | Select-Object -First 1
      if($staged){break}; Start-Sleep -Milliseconds 10
    }
    if(-not $staged){exit 31}
    $destination=Join-Path '${out}' ($staged.Name -replace '\\.dump\\.enc$', '.meta.enc')
    [IO.File]::WriteAllText($destination,'preserve previous backup')
    [Console]::OpenStandardOutput().Write([Text.Encoding]::UTF8.GetBytes('PGDMPsynthetic collision'))
  `,
  );
  await assert.rejects(f.invoke(['--pg-dump', tool]));
  const remaining = await fs.readdir(f.outputDirectory);
  assert.equal(remaining.length, 1);
  assert.ok(remaining[0].endsWith('.meta.enc'));
  assert.equal(
    await fs.readFile(join(f.outputDirectory, remaining[0]), 'utf8'),
    'preserve previous backup',
  );
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
