import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { localDocker, postgresImage } from './database-backup.mjs';
import {
  migrationStatus,
  migrationDiagnostic,
  prismaCommandInfo,
  runPrisma,
} from './database-migrate.mjs';

// Sólo un contenedor nuevo, efímero y loopback; no usa Docker Compose ni bases existentes.
test(
  'Prisma 6.12 real: actualizada, pendientes, autenticación, conexión, TLS e historial',
  { timeout: 120000 },
  async () => {
    await localDocker();
    const name = `turnosmart-migrate-test-${randomUUID()}`;
    const docker = (args, input) => {
      const r = spawnSync('docker', args, { encoding: 'utf8', input });
      assert.equal(r.status, 0, `Docker de fixture falló: ${args[0]}`);
      return r.stdout.trim();
    };
    const id = docker([
      'run',
      '-d',
      '--name',
      name,
      '--label',
      `io.turnosmart.migrations-test=${name}`,
      '--tmpfs',
      '/var/lib/postgresql/data:rw',
      '-p',
      '127.0.0.1::5432',
      '-e',
      'POSTGRES_PASSWORD=synthetic-secret',
      postgresImage,
    ]);
    const sql = (text) =>
      docker(
        ['exec', '-i', id, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'],
        text,
      );
    try {
      let ready = false;
      for (let i = 0; i < 40; i++) {
        const r = spawnSync(
          'docker',
          ['exec', id, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
          { encoding: 'utf8' },
        );
        if (r.status === 0) {
          ready = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert(ready, 'PostgreSQL sintético no inició');
      const port = docker(['port', id, '5432/tcp']).match(/^127\.0\.0\.1:(\d+)$/)?.[1];
      assert(port);
      const url = `postgresql://postgres:synthetic-secret@127.0.0.1:${port}/postgres`;
      const env = {
        ...process.env,
        RENDER: 'false',
        DEPLOY_TARGET: 'preview',
        SUPABASE_URL: 'http://127.0.0.1:1',
        DATABASE_URL: url,
        DIRECT_URL: url,
      };
      const dir = 'apps/backend/prisma/migrations';
      const migrations = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      assert.equal(
        JSON.parse(readFileSync('node_modules/prisma/package.json', 'utf8')).version,
        '6.12.0',
      );
      sql(
        'CREATE TABLE "_prisma_migrations" (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0);',
      );
      for (const migration of migrations) {
        assert(/^\d{14}_[a-z0-9_]+$/i.test(migration));
        const checksum = createHash('sha256')
          .update(readFileSync(`${dir}/${migration}/migration.sql`))
          .digest('hex');
        sql(
          `INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at,applied_steps_count) VALUES ('${randomUUID()}','${checksum}','${migration}',now(),1);`,
        );
      }
      const updated = runPrisma('status', env);
      assert.equal(updated.status, 0);
      assert.match(updated.stdout + updated.stderr, /prisma\.config\.ts/);
      assert.equal(migrationStatus(updated, migrations).state, 'al día');
      const last = migrations.at(-1);
      sql(`DELETE FROM "_prisma_migrations" WHERE migration_name='${last}';`);
      const pending = runPrisma('status', env);
      // Salida real del CLI; no fixture escrita a mano.
      assert.equal(pending.status, 1);
      assert.deepEqual(migrationStatus(pending, migrations).pending, [last]);
      console.log(JSON.stringify({ case: 'pendientes', ...prismaCommandInfo(pending) }));
      const reject = (label, result, allowed) => {
        assert.notEqual(result.status, 0);
        assert.throws(
          () => migrationStatus(result, migrations),
          (error) => {
            const diagnostic = migrationDiagnostic(error);
            assert(allowed.includes(diagnostic.type), `${label}: ${diagnostic.type}`);
            const safe = JSON.stringify({
              case: label,
              ...diagnostic,
              ...prismaCommandInfo(result),
            });
            assert(!/synthetic-secret|synthetic-wrong|postgresql:\/\//.test(safe));
            console.log(safe);
            return true;
          },
        );
      };
      reject(
        'autenticación',
        runPrisma('status', {
          ...env,
          DATABASE_URL: url.replace('synthetic-secret', 'synthetic-wrong'),
          DIRECT_URL: url.replace('synthetic-secret', 'synthetic-wrong'),
        }),
        ['PRISMA_AUTHENTICATION_ERROR', 'PRISMA_ENGINE_ERROR'],
      );
      reject(
        'TLS',
        runPrisma('status', {
          ...env,
          DATABASE_URL: url + '?sslmode=require',
          DIRECT_URL: url + '?sslmode=require',
        }),
        ['PRISMA_TLS_ERROR', 'PRISMA_ENGINE_ERROR'],
      );
      reject(
        'conexión',
        runPrisma('status', {
          ...env,
          DATABASE_URL: url.replace(`:${port}/`, ':1/'),
          DIRECT_URL: url.replace(`:${port}/`, ':1/'),
        }),
        ['PRISMA_CONNECTION_ERROR', 'PRISMA_ENGINE_ERROR'],
      );
      sql(
        `INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at,applied_steps_count) VALUES ('${randomUUID()}','${'a'.repeat(64)}','20260101000000_unknown',now(),1);`,
      );
      reject('divergencia', runPrisma('status', env), ['PRISMA_HISTORY_DIVERGED']);
      sql(
        `DELETE FROM "_prisma_migrations" WHERE migration_name='20260101000000_unknown'; INSERT INTO "_prisma_migrations" (id,checksum,migration_name,logs) VALUES ('${randomUUID()}','${'a'.repeat(64)}','${last}','synthetic-secret');`,
      );
      reject('migración fallida', runPrisma('status', env), ['PRISMA_FAILED_MIGRATION']);
    } finally {
      assert.equal(
        docker([
          'inspect',
          '--format',
          '{{index .Config.Labels "io.turnosmart.migrations-test"}}',
          id,
        ]),
        name,
      );
      docker(['rm', '-f', id]);
    }
  },
);
