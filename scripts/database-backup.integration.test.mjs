import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  cleanupRecovery,
  decryptMetadata,
  encryptMetadata,
  localDocker,
  postgresImage,
  repository,
  run,
} from './database-backup.mjs';

const exec = promisify(execFile);
const pg = (id, sql) =>
  run(
    'docker',
    [
      'exec',
      '-i',
      id,
      'psql',
      '-X',
      '-q',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '--host=/var/run/postgresql',
      '--username=postgres',
      '--dbname=turnosmart_synthetic',
    ],
    { input: sql },
  );
const targetPg = (id, sql) =>
  run(
    'docker',
    [
      'exec',
      '-i',
      id,
      'psql',
      '-X',
      '-q',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '--host=/var/run/postgresql',
      '--username=postgres',
      '--dbname=turnosmart_restore',
    ],
    { input: sql },
  );
const invoke = async (file, args, env = {}) => {
  const result = await exec(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-File', join(repository, 'scripts', file), ...args],
    { env: { ...process.env, DIRECT_URL: '', DATABASE_URL: '', ...env }, timeout: 120_000 },
  );
  return JSON.parse(result.stdout);
};
const snapshot = `SELECT json_build_object(
 'counts',json_build_object('businesses',(SELECT count(*) FROM businesses),'profiles',(SELECT count(*) FROM profiles),'customers',(SELECT count(*) FROM customers),'services',(SELECT count(*) FROM services),'appointments',(SELECT count(*) FROM appointments),'events',(SELECT count(*) FROM appointment_events)),
 'migrations',(SELECT json_agg(json_build_object('name',migration_name,'checksum',checksum,'finished',finished_at) ORDER BY migration_name) FROM _prisma_migrations),
 'dataHashes',json_build_object('appointments',(SELECT md5(string_agg(row_to_json(t)::text,'|' ORDER BY id)) FROM appointments t),'events',(SELECT md5(string_agg(row_to_json(t)::text,'|' ORDER BY id)) FROM appointment_events t),'customers',(SELECT md5(string_agg(row_to_json(t)::text,'|' ORDER BY id)) FROM customers t)),
 'permissions',json_build_object('anonCustomers',has_table_privilege('anon','customers','SELECT'),'authenticatedAppointmentWrites',has_table_privilege('authenticated','appointments','UPDATE'),'serviceBypass',(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role'),'objectAcls',(SELECT md5(string_agg(c.relname||pg_get_userbyid(c.relowner)||coalesce((SELECT string_agg(coalesce(pg_get_userbyid(a.grantee),'PUBLIC')||pg_get_userbyid(a.grantor)||a.privilege_type||a.is_grantable::text,'|' ORDER BY pg_get_userbyid(a.grantee),pg_get_userbyid(a.grantor),a.privilege_type) FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a),''),'|' ORDER BY c.relname)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','S'))),
 'rls',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity),
 'orphans',(SELECT count(*) FROM appointments a LEFT JOIN customers c ON c.id=a.customer_id AND c.business_id=a.business_id WHERE c.id IS NULL),
 'confirmation',(SELECT confirmation_status::text FROM appointments LIMIT 1));`;

test(
  'recuperación PostgreSQL real: nueve migraciones, datos sintéticos, ACL/RLS, fallos y limpieza segura',
  { timeout: 240_000 },
  async (t) => {
    await localDocker();
    const temporary = await fs.mkdtemp(join(tmpdir(), 'turnosmart-recovery-drill-'));
    const token = randomUUID();
    const name = 'turnosmart-restore-existing-' + token;
    const source = await run('docker', [
      'run',
      '--detach',
      '--pull=never',
      '--name',
      name,
      '--label',
      `io.turnosmart.backup-fixture=${token}`,
      '--network=none',
      '--read-only',
      '--user=postgres',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--memory=1024m',
      '--cpus=1',
      '--tmpfs',
      '/var/lib/postgresql/data:rw,noexec,nosuid,uid=70,gid=70,mode=0700,size=512m',
      '--tmpfs',
      '/var/run/postgresql:rw,noexec,nosuid,uid=70,gid=70,mode=0770,size=16m',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=256m',
      '--env',
      'POSTGRES_DB=turnosmart_synthetic',
      '--env',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      postgresImage,
      'postgres',
      '-c',
      'listen_addresses=',
    ]);
    let recovered;
    t.after(async () => {
      if (recovered) await cleanupRecovery(recovered.containerId, recovered.cleanupToken);
      const identity = JSON.parse(await run('docker', ['inspect', source]))[0];
      assert.equal(identity.Config.Labels['io.turnosmart.backup-fixture'], token);
      await run('docker', ['rm', '--force', source]);
      await fs.rm(temporary, { recursive: true });
    });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        await pg(source, 'SELECT 1');
        ready = true;
        break;
      } catch {
        await new Promise((res) => setTimeout(res, 500));
      }
    }
    assert.ok(ready, 'PostgreSQL sintético debe iniciar');
    const bootstrap = (
      await fs.readFile(join(repository, 'infra/docker/init-local.sql'), 'utf8')
    ).replace('CREATE ROLE postgres NOLOGIN;', '');
    await pg(
      source,
      bootstrap +
        `
    CREATE TABLE public._prisma_migrations (
      id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz,
      migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0
    );`,
    );
    const migrationRoot = join(repository, 'apps/backend/prisma/migrations');
    const migrations = (await fs.readdir(migrationRoot, { withFileTypes: true }))
      .filter((f) => f.isDirectory())
      .map((f) => f.name)
      .sort();
    assert.equal(migrations.length, 9);
    for (const migration of migrations) {
      const sql = await fs.readFile(join(migrationRoot, migration, 'migration.sql'), 'utf8');
      await pg(source, sql);
      const checksum = createHash('sha256').update(sql).digest('hex');
      await pg(
        source,
        `INSERT INTO _prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count) VALUES ('${randomUUID()}','${checksum}','${migration}',now(),1);`,
      );
      if (migration === migrations[0]) {
        await pg(
          source,
          `
        INSERT INTO businesses(id,name,updated_at) VALUES ('10000000-0000-4000-8000-000000000001','Synthetic A',now()),('10000000-0000-4000-8000-000000000002','Synthetic B',now());
        INSERT INTO profiles(id,business_id,email,role,updated_at) VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','fixture-a@invalid.example','OWNER',now()),('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','fixture-b@invalid.example','OWNER',now());
        INSERT INTO customers(id,business_id,full_name,updated_at) VALUES ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic client A',now()),('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Synthetic client B',now());
        INSERT INTO services(id,business_id,name,duration_minutes,updated_at) VALUES ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic service',30,now());
        INSERT INTO appointments(id,business_id,customer_id,service_id,starts_at,ends_at,status,updated_at) VALUES ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','2099-01-05T13:00:00Z','2099-01-05T13:30:00Z','CONFIRMED',now());
        INSERT INTO appointment_events(business_id,appointment_id,type) VALUES ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','CREATED'),('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','CONFIRMED');
      `,
        );
      }
    }
    await pg(
      source,
      'CREATE ROLE synthetic_owner NOLOGIN; ALTER TABLE public.customers OWNER TO synthetic_owner;',
    );
    const before = JSON.parse(await pg(source, snapshot));
    assert.equal(before.confirmation, 'CONFIRMED');
    const keyFile = join(temporary, 'keys/recovery.backup-key');
    await invoke('backup-db.ps1', ['-GenerateKey', '-KeyFile', keyFile]);
    const backupArgs = [
      '-KeyFile',
      keyFile,
      '-SourceEnvironment',
      'local',
      '-ExpectedDatabase',
      'turnosmart_synthetic',
      '-SourceContainer',
      name,
      '-OutputDirectory',
      join(temporary, 'backups'),
    ];
    const backupStarted = performance.now();
    const archive = await invoke('backup-db.ps1', backupArgs);
    const backupSeconds = (performance.now() - backupStarted) / 1000;
    const restoreArgs = [
      '-BackupFile',
      archive.backupFile,
      '-KeyFile',
      keyFile,
      '-ExpectedEnvironment',
      'local',
      '-ConfirmRestore',
      'RESTORE_TEST_DATABASE',
    ];

    await t.test(
      'rechaza base origen equivocada y no altera un contenedor preexistente',
      async () => {
        await assert.rejects(
          invoke('backup-db.ps1', [...backupArgs, '-ExpectedDatabase', 'wrong_database']),
        );
        await assert.rejects(invoke('restore-db.ps1', [...restoreArgs, '-TargetName', name]));
        await assert.rejects(cleanupRecovery(source, randomUUID()), /destino/);
        assert.deepEqual(JSON.parse(await pg(source, snapshot)), before);
      },
    );

    await t.test(
      'restaura esquema, datos, propietarios, permisos, RLS e historial de migraciones',
      async () => {
        const restoreStarted = performance.now();
        recovered = await invoke('restore-db.ps1', restoreArgs);
        const wallSeconds = (performance.now() - restoreStarted) / 1000;
        const after = JSON.parse(await targetPg(recovered.containerId, snapshot));
        assert.deepEqual(after, before);
        assert.equal(recovered.verification.migrations, 9);
        assert.equal(recovered.verification.failedMigrations, 0);
        assert.equal(recovered.verification.unvalidatedConstraints, 0);
        assert.equal(after.orphans, 0);
        assert.equal(after.permissions.anonCustomers, false);
        assert.equal(after.permissions.authenticatedAppointmentWrites, false);
        const visible = await targetPg(
          recovered.containerId,
          `SET ROLE authenticated; SET request.jwt.claim.sub='20000000-0000-4000-8000-000000000001'; SELECT count(*) FROM customers;`,
        );
        assert.equal(visible, '1');
        // Demonstrate the incompatible historical enum without changing any existing database.
        await assert.rejects(
          targetPg(
            recovered.containerId,
            `BEGIN; UPDATE appointments SET status='CONFIRMED'; ROLLBACK;`,
          ),
        );
        assert.deepEqual(JSON.parse(await targetPg(recovered.containerId, snapshot)), before);
        t.diagnostic(
          `Backup PostgreSQL sintético: ${backupSeconds.toFixed(3)} s; recuperación total PowerShell: ${wallSeconds.toFixed(3)} s; motor verificado: ${recovered.recoverySeconds} s.`,
        );
      },
    );

    await t.test(
      'preflight de extensiones rechaza una dependencia ausente sin restaurar SQL',
      async () => {
        const copy = join(temporary, 'missing-extension');
        await fs.cp(join(temporary, 'backups'), copy, { recursive: true });
        const indexFile = join(copy, archive.backupFile.split(/[\\/]/).at(-1));
        const index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
        const metaPath = join(copy, index.metadataFile);
        const key = await fs.readFile(keyFile);
        const metadata = decryptMetadata(await fs.readFile(metaPath), key);
        metadata.identity.extensions.push({ name: 'synthetic_missing_ext', version: '1.0' });
        const bytes = encryptMetadata(metadata, key);
        key.fill(0);
        await fs.writeFile(metaPath, bytes);
        index.metadataSha256 = createHash('sha256').update(bytes).digest('hex');
        await fs.writeFile(indexFile, JSON.stringify(index));
        const destination = 'turnosmart-restore-extension-' + randomUUID();
        await assert.rejects(
          invoke('restore-db.ps1', [
            '-BackupFile',
            indexFile,
            '-KeyFile',
            keyFile,
            '-ExpectedEnvironment',
            'local',
            '-ConfirmRestore',
            'RESTORE_TEST_DATABASE',
            '-TargetName',
            destination,
          ]),
          (error) => /synthetic_missing_ext@1.0/.test(error.stderr) && error.stdout === '',
        );
        await assert.rejects(run('docker', ['inspect', destination]));
      },
    );

    await t.test(
      'un dump alterado no ejecuta SQL aunque se recalcule el checksum exterior',
      async () => {
        const copy = join(temporary, 'tampered-dump');
        await fs.cp(join(temporary, 'backups'), copy, { recursive: true });
        const indexFile = join(copy, archive.backupFile.split(/[\\/]/).at(-1));
        const index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
        const dump = join(copy, index.dumpFile);
        const bytes = await fs.readFile(dump);
        bytes[32] ^= 1;
        await fs.writeFile(dump, bytes);
        index.dumpSha256 = createHash('sha256').update(bytes).digest('hex');
        await fs.writeFile(indexFile, JSON.stringify(index));
        const destination = 'turnosmart-restore-tampered-' + randomUUID();
        await assert.rejects(
          invoke('restore-db.ps1', [
            '-BackupFile',
            indexFile,
            '-KeyFile',
            keyFile,
            '-ExpectedEnvironment',
            'local',
            '-ConfirmRestore',
            'RESTORE_TEST_DATABASE',
            '-TargetName',
            destination,
          ]),
          (error) => /dump alterado/.test(error.stderr) && error.stdout === '',
        );
        await assert.rejects(run('docker', ['inspect', destination]));
      },
    );

    await t.test('interrupción controlada de restore elimina su contenedor aislado', async () => {
      const destination = 'turnosmart-restore-interrupted-' + randomUUID();
      const module = join(temporary, 'interrupt.mjs');
      await fs.writeFile(
        module,
        `import {execFile} from 'node:child_process';let checking=false;const timer=setInterval(()=>{if(checking)return;checking=true;execFile('docker',['inspect',${JSON.stringify(destination)}],error=>{checking=false;if(!error){clearInterval(timer);process.emit('SIGTERM');}});},100);timer.unref();`,
      );
      await assert.rejects(
        invoke('restore-db.ps1', [...restoreArgs, '-TargetName', destination], {
          NODE_OPTIONS: '--import=' + pathToFileURL(module).href,
        }),
        (error) => {
          assert.equal(error.code, 143);
          assert.equal(error.stdout, '');
          return true;
        },
      );
      await assert.rejects(run('docker', ['inspect', destination]));
      assert.equal(JSON.parse(await pg(source, snapshot)).counts.appointments, 1);
    });

    await t.test(
      'fallo real de pg_restore no informa éxito y elimina sólo el destino recién creado',
      async () => {
        await pg(
          source,
          `CREATE FUNCTION public.synthetic_restore_guard() RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN IF current_database()='turnosmart_restore' THEN RAISE EXCEPTION 'synthetic restore failure'; END IF; RETURN true; END $$;
      CREATE TABLE public.synthetic_restore_failure(id integer CHECK (public.synthetic_restore_guard())); INSERT INTO public.synthetic_restore_failure VALUES(1);`,
        );
        const broken = await invoke('backup-db.ps1', backupArgs);
        const failedName = 'turnosmart-restore-failure-' + randomUUID();
        await assert.rejects(
          invoke('restore-db.ps1', [
            '-BackupFile',
            broken.backupFile,
            '-KeyFile',
            keyFile,
            '-ExpectedEnvironment',
            'local',
            '-ConfirmRestore',
            'RESTORE_TEST_DATABASE',
            '-TargetName',
            failedName,
          ]),
          (error) => {
            assert.equal(error.stdout, '');
            assert.match(error.stderr, /código 1/);
            assert.equal(error.stderr.includes('synthetic restore failure'), false);
            return true;
          },
        );
        await assert.rejects(run('docker', ['inspect', '--type=container', failedName]));
        assert.equal(JSON.parse(await pg(source, snapshot)).counts.appointments, 1);
      },
    );

    await t.test(
      'cleanup PowerShell valida token y elimina exclusivamente su destino',
      async () => {
        await assert.rejects(
          invoke('restore-db.ps1', [
            '-CleanupContainerId',
            recovered.containerId,
            '-CleanupToken',
            randomUUID(),
            '-ConfirmCleanup',
            'REMOVE_LOCAL_RECOVERY',
          ]),
        );
        await invoke('restore-db.ps1', [
          '-CleanupContainerId',
          recovered.containerId,
          '-CleanupToken',
          recovered.cleanupToken,
          '-ConfirmCleanup',
          'REMOVE_LOCAL_RECOVERY',
        ]);
        await assert.rejects(run('docker', ['inspect', recovered.containerId]));
        recovered = undefined;
        assert.equal(JSON.parse(await pg(source, snapshot)).counts.customers, 2);
      },
    );
  },
);
