import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  assertSuccessfulCi,
  prepareVercel,
  validateDeployment,
  verifyOutput,
  verifyPublished,
} from './deploy-config.mjs';

// Usar el parser YAML ya requerido por ESLint, sin agregar dependencias.
const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('@eslint/eslintrc/package.json'))('js-yaml');
const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const env = {
  NEXT_PUBLIC_USE_AZURE: 'false',
  NEXT_PUBLIC_API_URL_RENDER: 'https://render.example.com',
  NEXT_PUBLIC_API_URL_AZURE: 'https://azure.example.com',
  NEXT_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture',
  VERCEL_TOKEN: 'private-fixture',
  VERCEL_ORG_ID: 'team_fixture',
  VERCEL_PROJECT_ID: 'prj_fixture',
};
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'turnosmart-deploy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(path, value) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return { root, write };
}

test('YAML valido: manual, destinos independientes, CI exacta y permisos minimos', () => {
  const workflow = yaml.load(
    readFileSync(join(repo, '.github/workflows/frontend-deploy.yml'), 'utf8'),
  );
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(inputs.target.options, ['render', 'azure']);
  assert.deepEqual(inputs.frontend_target.options, ['vercel', 'azure']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const { preflight, deploy } = workflow.jobs;
  assert.deepEqual(preflight.permissions, { contents: 'read', actions: 'read' });
  assert(preflight.steps[0].run.includes('Azure frontend bloqueado'));
  assert.equal(deploy.needs, 'preflight');
  assert.equal(deploy.if, "inputs.frontend_target == 'vercel'");
  assert.equal(
    deploy.env.NEXT_PUBLIC_USE_AZURE,
    "${{ inputs.target == 'azure' && 'true' || 'false' }}",
  );
  for (const job of [preflight, deploy]) {
    const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    assert.equal(checkout.with.ref, '${{ github.sha }}');
    assert.equal(checkout.with['persist-credentials'], false);
    assert(!job.steps.some((step) => step.uses?.startsWith('azure/')));
  }
  const gate = preflight.steps.find((step) => step.uses?.startsWith('actions/github-script@')).with
    .script;
  assert(gate.includes("workflow_id: 'ci.yml', head_sha: context.sha"));
  assert(gate.includes('assertSuccessfulCi(data.workflow_runs, context.sha)'));
  assert.equal(
    deploy.steps.find((step) => step.uses?.startsWith('actions/setup-node@')).with['node-version'],
    '22',
  );
  const script = deploy.steps.find((step) => step.name === 'Deploy a Vercel').run;
  const commands = [
    'deploy-config.mjs validate',
    'pull --yes',
    'deploy-config.mjs prepare',
    'build --prod',
    'verify:public-build',
    'deploy-config.mjs output',
    'deploy --prebuilt',
    'deploy-config.mjs published',
  ];
  let previous = -1;
  for (const command of commands) {
    const index = script.indexOf(command);
    assert(index > previous, `Falta orden seguro: ${command}`);
    previous = index;
  }
});

test('CI requiere ultimo push exitoso del SHA exacto, incluso con reruns', () => {
  const success = {
    head_sha: 'abc',
    event: 'push',
    run_number: 1,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
  };
  assertSuccessfulCi([success], 'abc');
  for (const runs of [
    [],
    [{ ...success, head_sha: 'other' }],
    [{ ...success, event: 'pull_request' }],
    [{ ...success, status: 'in_progress' }],
    [success, { ...success, run_number: 2, conclusion: 'failure' }],
    [success, { ...success, run_attempt: 2, conclusion: 'cancelled' }],
  ])
    assert.throws(() => assertSuccessfulCi(runs, 'abc'), /ci.yml/);
});

test('Variables obligatorias y claves privilegiadas se rechazan sin imprimir valores', () => {
  validateDeployment(env);
  for (const name of Object.keys(env)) {
    const invalid = { ...env, [name]: '' };
    assert.throws(() => validateDeployment(invalid));
  }
  assert.throws(
    () => validateDeployment({ ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_sensitive' }),
    (error) => !error.message.includes('sensitive'),
  );
});

for (const flag of ['false', 'true'])
  test(`pull no domina el build: selector ${flag} y URLs del runner`, (t) => {
    const { root, write } = fixture(t);
    write('.vercel/project.json', {
      projectId: env.VERCEL_PROJECT_ID,
      orgId: env.VERCEL_ORG_ID,
      settings: { rootDirectory: 'apps/frontend', nodeVersion: '20.x', buildCommand: 'wrong' },
    });
    write(
      'apps/frontend/vercel.json',
      JSON.parse(readFileSync(join(repo, 'apps/frontend/vercel.json'))),
    );
    write('.vercel/.env.production.local', 'NEXT_PUBLIC_USE_AZURE=wrong\nSERVER_SECRET=private');
    prepareVercel(root, { ...env, NEXT_PUBLIC_USE_AZURE: flag });
    for (const path of ['.vercel', 'apps/frontend/.vercel']) {
      const cache = readFileSync(join(root, path, '.env.production.local'), 'utf8');
      assert(cache.includes(`NEXT_PUBLIC_USE_AZURE="${flag}"`));
      assert(cache.includes(env.NEXT_PUBLIC_API_URL_RENDER));
      assert(cache.includes(env.NEXT_PUBLIC_API_URL_AZURE));
      assert(!cache.includes('private'));
      assert.equal(cache.trim().split('\n').length, 5);
    }
    const project = JSON.parse(readFileSync(join(root, '.vercel/project.json')));
    assert.equal(project.settings.nodeVersion, '22.x');
    assert(project.settings.buildCommand.includes('build:shared'));
    write('.vercel/project.json', { ...project, projectId: 'wrong' });
    assert.throws(() => prepareVercel(root, env), /Proyecto/);
  });

test('Artefacto y bundle publicado deben coincidir byte por byte', async (t) => {
  const { root, write } = fixture(t);
  write('.next-unused', 'ignored');
  write('apps/frontend/.next/static/chunks/app.js', 'correct-bundle');
  write('apps/frontend/.next/static/chunks/lazy-api.js', 'correct-bundle');
  write('.vercel/output/config.json', { version: 3 });
  write('.vercel/output/static/_next/static/chunks/app.js', 'correct-bundle');
  write('.vercel/output/static/_next/static/chunks/lazy-api.js', 'correct-bundle');
  verifyOutput(root);
  const request = async (url) =>
    new Response(
      url.pathname === '/login'
        ? '<script src="/_next/static/chunks/app.js" async></script>'
        : 'correct-bundle',
    );
  await verifyPublished(root, 'https://demo.vercel.app', request);
  await assert.rejects(
    verifyPublished(root, 'https://demo.vercel.app', async (url) =>
      url.pathname.endsWith('/lazy-api.js') ? new Response('wrong-provider') : request(url),
    ),
    /distinto/,
  );
  await assert.rejects(
    verifyPublished(root, 'https://demo.vercel.app', async () => new Response('', { status: 401 })),
    /inaccesible/,
  );
  await assert.rejects(
    verifyPublished(root, 'https://demo.vercel.app', async (url) =>
      url.pathname === '/login' ? request(url) : new Response('stale'),
    ),
    /distinto/,
  );
  await assert.rejects(verifyPublished(root, 'https://attacker.example.com', request), /invalida/);
  write('.vercel/output/static/_next/static/chunks/app.js', 'stale');
  assert.throws(() => verifyOutput(root), /no coincide/);
});
