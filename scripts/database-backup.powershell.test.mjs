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
  generateKey,
  outsideRepository,
  repository,
  restore,
} from './database-backup.mjs';

const exec = promisify(execFile);
assert.equal(process.versions.node.split('.')[0], '22', 'Ejecutar con Node.js 22.x');
// This suite is mandatory separately from npm test. Missing/old pwsh is a failure.
try {
  await exec(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "if ($PSVersionTable.PSVersion -lt [version]'7.4') { exit 1 }",
    ],
    { timeout: 10000 },
  );
} catch {
  throw new Error('test:backup:powershell requiere PowerShell 7.4+ (pwsh en PATH) y Node.js 22.x.');
}
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

async function fixture(t) {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'turnosmart-backup-unit-'));
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

test('wrappers: sintaxis válida y generación de clave sin sobrescribir', async (t) => {
  const f = await fixture(t);
  const parser = [
    "$ErrorActionPreference='Stop'",
    ...['backup-db.ps1', 'restore-db.ps1', 'protect-backup-path.ps1'].map(
      (name) =>
        "$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('" +
        join(repository, 'scripts', name).replaceAll("'", "''") +
        "',[ref]$tokens,[ref]$errors); if($errors.Count -ne 0){throw 'PowerShell syntax error'}",
    ),
  ].join('; ');
  await exec('pwsh', ['-NoProfile', '-NonInteractive', '-Command', parser]);
  const keyFile = join(f.root, 'keys/wrapper.backup-key');
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-File',
    join(repository, 'scripts/backup-db.ps1'),
    '-GenerateKey',
    '-KeyFile',
    keyFile,
  ];
  const result = await exec('pwsh', args);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  const original = await fs.readFile(keyFile);
  assert.equal(original.length, 32);
  await assert.rejects(exec('pwsh', args));
  assert.deepEqual(await fs.readFile(keyFile), original);
});
