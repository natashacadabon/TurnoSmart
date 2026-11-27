import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  authorizeMigration,
  migrate,
  migrationStatus,
  migrationDiagnostic,
  runPrisma,
  validateMigrationContext,
} from './database-migrate.mjs';
import { SupabaseTargetError } from '../apps/backend/src/config/supabase-target.ts';

const dev = 'a'.repeat(20),
  production = 'b'.repeat(20);
const dsn = (ref) =>
  `postgresql://postgres:synthetic-secret@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
const env = {
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: 'c'.repeat(40),
  GITHUB_REPOSITORY: 'owner/repo',
  GH_TOKEN: 'fixture-github-token',
  MIGRATION_ENVIRONMENT: 'production',
  MIGRATION_OPERATION: 'deploy',
  DEPLOY_TARGET: 'production',
  SUPABASE_URL: `https://${production}.supabase.co`,
  DATABASE_URL: dsn(production),
  DIRECT_URL: dsn(production),
  EXPECTED_DEV_SUPABASE: `https://${dev}.supabase.co`,
  EXPECTED_PRODUCTION_SUPABASE: `https://${production}.supabase.co`,
};
const migration = '20261112000200_appointment_notification_actions';
const current = { status: 0, stdout: 'Database schema is up to date!\n', stderr: '' };
const pending = {
  status: 1,
  stdout: `Following migration have not yet been applied:\n${migration}\n\nTo apply migrations in development run prisma migrate dev.\nTo apply migrations in production run prisma migrate deploy.\n`,
  stderr: 'npm error code 1',
};
const noop = async () => {};
const options = { migrations: [migration], report: () => {}, authorize: noop };

test('diagnóstico seguro identifica variable, tipo y fase de la validación sin exponer valores', async () => {
  const cases = [
    ...[
      'SUPABASE_URL',
      'DATABASE_URL',
      'DIRECT_URL',
      'EXPECTED_DEV_SUPABASE',
      'EXPECTED_PRODUCTION_SUPABASE',
    ].map((variable) => [variable, '', 'MISSING_VARIABLE']),
    ['SUPABASE_URL', 'https://synthetic-secret.invalid', 'INVALID_URL'],
    ['DATABASE_URL', 'synthetic-secret', 'INVALID_URL'],
    ['DIRECT_URL', ' ' + env.DIRECT_URL, 'INVALID_URL'],
    ['DATABASE_URL', dsn(dev), 'PROJECT_MISMATCH'],
    ['DIRECT_URL', dsn(dev), 'PROJECT_MISMATCH'],
    ['DATABASE_URL', dsn(production).replace(':synthetic-secret', ''), 'INVALID_CREDENTIALS'],
    ['DATABASE_URL', dsn(production).replace('postgres:', 'other:'), 'INVALID_ENDPOINT'],
    ['DATABASE_URL', dsn(production).replace('/postgres?', '/other?'), 'INVALID_DATABASE'],
    ['DATABASE_URL', dsn(production) + '&host=synthetic-secret.invalid', 'INVALID_PARAMETER'],
    ['DATABASE_URL', dsn(production).replace('require', 'disable'), 'TLS_REQUIRED'],
    ['DIRECT_URL', dsn(production).replace('require', 'disable'), 'TLS_REQUIRED'],
    [
      'DIRECT_URL',
      dsn(production) + '&sslaccept=accept_invalid_certs',
      'TLS_CERTIFICATE_VALIDATION',
    ],
    ['DIRECT_URL', dsn(production) + '&schema=synthetic_secret', 'INVALID_SCHEMA'],
    [
      'DIRECT_URL',
      `postgresql://postgres.${production}:synthetic-secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`,
      'TRANSACTION_POOLER',
    ],
  ];
  for (const [variable, value, type] of cases) {
    const reports = [];
    await assert.rejects(
      () =>
        migrate(
          { ...env, [variable]: value },
          {
            ...options,
            run: () => assert.fail('No ejecutar Prisma'),
            authorize: () => assert.fail('No consultar GitHub'),
            report: (text) => reports.push(text),
          },
        ),
      (error) =>
        error instanceof SupabaseTargetError && error.variable === variable && error.code === type,
    );
    const summary = reports.join('\n');
    assert.match(summary, /Fase: validación del destino/);
    assert(summary.includes(`Variable: ${variable}\nTipo de error: ${type}`));
    assert(!/synthetic-secret|postgresql:\/\/|supabase\.co|fixture-github-token/.test(summary));
  }
});

test('Dev status reproduce el fallo con diez migraciones y muestra DIRECT_URL/TLS_REQUIRED', async () => {
  const reports = [];
  const source = {
    ...env,
    MIGRATION_ENVIRONMENT: 'dev',
    MIGRATION_OPERATION: 'status',
    GITHUB_REF: 'refs/heads/dev',
    DEPLOY_TARGET: 'preview',
    SUPABASE_URL: env.EXPECTED_DEV_SUPABASE,
    DATABASE_URL: dsn(dev),
    DIRECT_URL: dsn(dev).replace('sslmode=require', 'sslmode=disable'),
  };
  await assert.rejects(() =>
    migrate(source, {
      ...options,
      migrations: Array.from({ length: 10 }, (_, i) => `2026111200020${i}_fixture`),
      run: () => assert.fail('No ejecutar Prisma'),
      report: (text) => reports.push(text),
    }),
  );
  assert.match(reports.join(), /Migraciones locales: 10/);
  assert.match(reports.join(), /Variable: DIRECT_URL\nTipo de error: TLS_REQUIRED/);
  // Reproducción sintética: no demuestra que el secret remoto tenga este defecto.
});

test('CLI devuelve exit 1 y escribe el mismo diagnóstico seguro en log y resumen', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'turnosmart-migration-diagnostic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const summaryFile = join(dir, 'summary.md');
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/database-migrate.mjs'], {
    env: {
      ...process.env,
      ...env,
      DIRECT_URL: dsn(production).replace('sslmode=require', 'sslmode=disable'),
      GITHUB_STEP_SUMMARY: summaryFile,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  const summary = readFileSync(summaryFile, 'utf8');
  assert.match(
    summary,
    /Fase: validación del destino\nVariable: DIRECT_URL\nTipo de error: TLS_REQUIRED/,
  );
  assert(result.stdout.includes(summary.trim()));
  assert(
    !/synthetic-secret|fixture-github-token|postgresql:\/\/|supabase\.co/.test(
      summary + result.stdout + result.stderr,
    ),
  );
});

test('errores desconocidos o metadata manipulada nunca se convierten en mensajes/logs privados', async () => {
  for (const error of [
    new Error('postgresql://private:synthetic-secret@private.invalid'),
    { variable: 'DATABASE_URL', code: 'TLS_REQUIRED', message: 'synthetic-secret' },
    new SupabaseTargetError('synthetic-secret', 'TLS_REQUIRED', 'synthetic-secret'),
  ]) {
    assert.equal(migrationDiagnostic(error).type, 'UNEXPECTED_ERROR');
    const reports = [];
    await assert.rejects(() =>
      migrate(env, {
        ...options,
        authorize: async () => {
          throw error;
        },
        report: (text) => reports.push(text),
      }),
    );
    assert.match(reports.join(), /Fase: autorización GitHub/);
    assert.match(reports.join(), /Tipo de error: UNEXPECTED_ERROR/);
    assert(!/synthetic-secret|private\.invalid|postgresql:/.test(reports.join()));
  }
});

test('selección fail-closed: sólo dispatch, entorno/rama/target válidos y SHA completo', () => {
  assert.doesNotThrow(() => validateMigrationContext(env));
  assert.doesNotThrow(() =>
    validateMigrationContext({
      ...env,
      MIGRATION_ENVIRONMENT: 'dev',
      GITHUB_REF: 'refs/heads/dev',
      DEPLOY_TARGET: 'preview',
    }),
  );
  for (const override of [
    { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_EVENT_NAME: 'pull_request_target' },
    { GITHUB_REF: 'refs/heads/dev' },
    { GITHUB_REF: 'refs/heads/feat/test' },
    { GITHUB_REF: 'refs/tags/main' },
    { MIGRATION_ENVIRONMENT: undefined },
    { MIGRATION_ENVIRONMENT: 'preview' },
    { MIGRATION_ENVIRONMENT: 'dev' },
    { MIGRATION_OPERATION: '' },
    { MIGRATION_OPERATION: 'reset' },
    { DEPLOY_TARGET: 'preview' },
    { GITHUB_SHA: 'head' },
  ])
    assert.throws(() => validateMigrationContext({ ...env, ...override }));
});

test('variables ausentes, destinos cruzados, TLS y transaction DIRECT_URL fallan antes de consultar', async () => {
  for (const override of [
    ...[
      'DATABASE_URL',
      'DIRECT_URL',
      'SUPABASE_URL',
      'EXPECTED_DEV_SUPABASE',
      'EXPECTED_PRODUCTION_SUPABASE',
    ].map((key) => ({ [key]: '' })),
    { DATABASE_URL: dsn(dev) },
    { DIRECT_URL: dsn(dev) },
    { SUPABASE_URL: env.EXPECTED_DEV_SUPABASE },
    { EXPECTED_DEV_SUPABASE: env.EXPECTED_PRODUCTION_SUPABASE },
    { DATABASE_URL: dsn(production).replace('require', 'disable') },
    { DIRECT_URL: dsn(production).replace('require', 'disable') },
    {
      DIRECT_URL: `postgresql://postgres.${production}:synthetic-secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`,
    },
  ]) {
    const reports = [];
    await assert.rejects(() =>
      migrate(
        { ...env, ...override },
        {
          ...options,
          authorize: () => assert.fail('No debe consultar GitHub'),
          run: () => assert.fail('No debe consultar la base'),
          report: (text) => reports.push(text),
        },
      ),
    );
    assert(!reports.join().includes('synthetic-secret'));
    assert.match(reports.join(), /fallido/);
  }
});

test('status diferencia pendientes, historial divergente, fallos y errores reales', () => {
  assert.deepEqual(migrationStatus(current, [migration]), { state: 'al día', pending: [] });
  assert.deepEqual(migrationStatus(pending, [migration]), {
    state: 'pendientes',
    pending: [migration],
  });
  for (const result of [
    { ...pending, status: 2 },
    { ...pending, stdout: pending.stdout.replace(migration, 'unknown') },
    { ...pending, stderr: 'Error: P1001 synthetic-secret' },
    { ...pending, signal: 'SIGTERM' },
    { ...pending, error: new Error('synthetic-secret') },
    {
      status: 1,
      stdout:
        'Your local migration history and the migrations table from your database are different:',
    },
    { status: 1, stdout: 'Following migration have failed:' },
    { status: 1, stdout: 'The current database is not managed by Prisma Migrate.' },
    { status: 0, stdout: 'unknown output' },
  ])
    assert.throws(
      () => migrationStatus(result, [migration]),
      (error) => !error.message.includes('synthetic-secret'),
    );
});

test('status sólo consulta; deploy autoriza de nuevo, aplica y comprueba estado final', async () => {
  for (const state of [current, pending]) {
    const commands = [],
      reports = [];
    await migrate(
      { ...env, MIGRATION_OPERATION: 'status' },
      {
        ...options,
        run: (op) => {
          commands.push(op);
          return state;
        },
        report: (text) => reports.push(text),
      },
    );
    assert.deepEqual(commands, ['status']);
    assert.match(reports.join(), new RegExp(state === pending ? 'pendientes' : 'al día'));
  }
  const order = [],
    reports = [];
  await migrate(env, {
    ...options,
    authorize: async () => order.push('authorize'),
    run: (op) => {
      order.push(op);
      return op === 'deploy' ? { status: 0 } : order.length > 4 ? current : pending;
    },
    report: (text) => reports.push(text),
  });
  assert.deepEqual(order, ['authorize', 'status', 'authorize', 'deploy', 'status']);
  assert.match(reports.join(), /aplicado y verificado/);
  assert.match(reports.join(), new RegExp(migration));
  assert(!reports.join().includes('synthetic-secret'));
});

test('SHA/CI que dejan de estar autorizados bloquean escrituras; fallo deploy o estado final nunca informa éxito', async () => {
  let calls = 0;
  const commands = [];
  await assert.rejects(() =>
    migrate(env, {
      ...options,
      authorize: async () => {
        if (++calls === 2) throw new Error('Obsoleto');
      },
      run: (op) => {
        commands.push(op);
        return pending;
      },
    }),
  );
  assert.deepEqual(commands, ['status']);
  for (const failure of ['deploy', 'final']) {
    const reports = [],
      commands = [];
    await assert.rejects(() =>
      migrate(env, {
        ...options,
        run: (op) => {
          commands.push(op);
          return op === 'deploy'
            ? { status: failure === 'deploy' ? 1 : 0, stderr: 'synthetic-secret' }
            : pending;
        },
        report: (text) => reports.push(text),
      }),
    );
    assert.equal(commands.filter((op) => op === 'deploy').length, 1);
    assert.match(reports.join(), /Resultado: fallido/);
    assert(!reports.join().includes('synthetic-secret'));
  }
});

test('autorización exige última CI push exitosa para Production deploy y SHA vigente para todos', async () => {
  const successful = {
    head_sha: env.GITHUB_SHA,
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    run_number: 1,
    run_attempt: 1,
  };
  const request =
    (runs = [successful], sha = env.GITHUB_SHA) =>
    async (url, opts) => {
      assert.equal(opts.method, 'GET');
      assert.equal(opts.redirect, 'error');
      assert.equal(opts.headers.Authorization, 'Bearer fixture-github-token');
      return Response.json(
        url.includes('/git/ref/') ? { object: { sha } } : { workflow_runs: runs },
      );
    };
  await authorizeMigration(env, request());
  for (const runs of [
    [],
    [{ ...successful, conclusion: 'failure' }],
    [{ ...successful, status: 'in_progress' }],
    [successful, { ...successful, conclusion: 'failure', run_number: 2 }],
    [{ ...successful, event: 'pull_request' }],
  ])
    await assert.rejects(() => authorizeMigration(env, request(runs)));
  await assert.rejects(
    () => authorizeMigration(env, request([successful], 'd'.repeat(40))),
    /obsoleto/,
  );
  for (const source of [
    { ...env, MIGRATION_OPERATION: 'status' },
    {
      ...env,
      MIGRATION_ENVIRONMENT: 'dev',
      GITHUB_REF: 'refs/heads/dev',
      DEPLOY_TARGET: 'preview',
    },
  ])
    await authorizeMigration(source, async (url) => {
      assert(!url.includes('/actions/'));
      return Response.json({ object: { sha: env.GITHUB_SHA } });
    });
  for (const status of [401, 403, 404, 500])
    await assert.rejects(
      () => authorizeMigration(env, async () => new Response('fixture-github-token', { status })),
      (error) => !error.message.includes('fixture-github-token'),
    );
  await assert.rejects(() => authorizeMigration({ ...env, GH_TOKEN: '' }, request()));
});

test('ejecuta npm existente sin shell ni DSN/token en argumentos y sin token GitHub en Prisma', () => {
  for (const operation of ['status', 'deploy']) {
    runPrisma(operation, { ...env, npm_execpath: '/fixture/npm-cli.js' }, (exe, args, opts) => {
      assert.equal(exe, process.execPath);
      assert.deepEqual(args, [
        '/fixture/npm-cli.js',
        'run',
        operation === 'status' ? 'prisma:status' : 'prisma:migrate',
        '--workspace=apps/backend',
      ]);
      assert.equal(opts.shell, undefined);
      assert.equal(opts.env.GH_TOKEN, undefined);
      assert.equal(opts.env.DIRECT_URL, env.DIRECT_URL);
      return current;
    });
  }
});

test('CLI Prisma real carga su config y detecta conexión local inexistente sin consultar Supabase', () => {
  const local = {
    ...process.env,
    DEPLOY_TARGET: 'preview',
    RENDER: 'false',
    SUPABASE_URL: 'http://127.0.0.1:1',
    DATABASE_URL: 'postgresql://postgres:synthetic-secret@127.0.0.1:1/postgres',
    DIRECT_URL: 'postgresql://postgres:synthetic-secret@127.0.0.1:1/postgres',
  };
  const result = runPrisma('status', local);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Loaded Prisma config/);
  assert.match(result.stdout + result.stderr, /127\.0\.0\.1:1/);
  assert.match(result.stdout + result.stderr, /Error:\s+(?:P1001|Schema engine error)/);
  assert.throws(
    () => migrationStatus(result, [migration]),
    (error) => !error.message.includes('synthetic-secret'),
  );
});

test('workflow manual, status predeterminado, secretos por environment, cola por base y preflight sin secretos', () => {
  const require = createRequire(import.meta.url);
  const yaml = createRequire(require.resolve('@eslint/eslintrc/package.json'))('js-yaml');
  const workflow = yaml.load(readFileSync('.github/workflows/database-migrate.yml', 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.operation.default, 'status');
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.environment.options, ['dev', 'production']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const { preflight, migrate: job } = workflow.jobs;
  assert.equal(preflight.environment, undefined);
  assert(!JSON.stringify(preflight).includes('secrets.'));
  assert.equal(job.needs, 'preflight');
  assert.deepEqual(job.environment, {
    name: 'database-${{ inputs.environment }}',
    deployment: false,
  });
  assert.equal(job.concurrency.group, 'database-migrate-${{ inputs.environment }}');
  assert.equal(job.concurrency['cancel-in-progress'], false);
  const install = job.steps.find((step) => step.run?.startsWith('npm ci'));
  assert.equal(install.env, undefined);
  assert.equal(job.env, undefined);
  const execute = job.steps.find((step) => step.id === 'migration');
  assert.equal(execute.env.DATABASE_URL, '${{ secrets.DATABASE_URL }}');
  assert.equal(execute.env.DIRECT_URL, '${{ secrets.DIRECT_URL }}');
  assert(!execute.env.DATABASE_URL.includes('vars.'));
  assert.equal(execute.run, 'npm run database:migrate');
  const ci = preflight.steps.find((step) => step.uses?.startsWith('actions/github-script'));
  assert.match(ci.with.script, /assertSuccessfulCi/);
  assert.equal(ci.if, "inputs.environment == 'production' && inputs.operation == 'deploy'");
  assert.equal(
    job.steps.find((step) => step.uses?.startsWith('actions/setup-node')).with['node-version'],
    '22',
  );
  for (const step of [...preflight.steps, ...job.steps].filter((step) =>
    step.uses?.startsWith('actions/checkout'),
  )) {
    assert.equal(step.with.ref, '${{ github.sha }}');
    assert.equal(step.with['persist-credentials'], false);
  }
  const gitBash = join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe');
  const bash = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash';
  for (const [target, ref, operation, allowed] of [
    ['dev', 'dev', 'status', true],
    ['dev', 'dev', 'deploy', true],
    ['production', 'main', 'status', true],
    ['production', 'main', 'deploy', true],
    ['production', 'dev', 'deploy', false],
    ['dev', 'main', 'status', false],
    ['dev', 'feat/test', 'status', false],
    ['invalid', 'dev', 'status', false],
    ['dev', 'dev', 'reset', false],
  ]) {
    const result = spawnSync(
      bash,
      ['--noprofile', '--norc', '-euo', 'pipefail', '-c', preflight.steps[0].run],
      {
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: `refs/heads/${ref}`,
          MIGRATION_ENVIRONMENT: target,
          MIGRATION_OPERATION: operation,
        },
        encoding: 'utf8',
      },
    );
    assert.equal(
      result.status === 0,
      allowed,
      JSON.stringify({ target, ref, operation, error: result.error?.message }),
    );
  }
  assert(readdirSync('apps/backend/prisma/migrations').includes(migration));
});
