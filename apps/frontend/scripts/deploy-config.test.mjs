import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  affectsFrontend,
  assertCurrentRevision,
  assertSuccessfulCi,
  frontendChanged,
  prepareVercel,
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
  DEPLOY_TARGET: 'production',
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

test('CD reutiliza el workflow tras Quality y Render queda limitado a dev y sus dependencias', () => {
  const ci = yaml.load(readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8'));
  const workflow = yaml.load(
    readFileSync(join(repo, '.github/workflows/frontend-deploy.yml'), 'utf8'),
  );
  const {
    services: [render],
  } = yaml.load(readFileSync(join(repo, 'render.yaml'), 'utf8'));
  assert.deepEqual(ci.on.push.branches, ['feat/**', 'dev', 'main']);
  assert.deepEqual(ci.on.pull_request.branches, ['dev', 'main']);
  const vercel = JSON.parse(readFileSync(join(repo, 'apps/frontend/vercel.json'), 'utf8'));
  assert.equal(vercel.git.deploymentEnabled, false);
  assert.equal(ci.jobs.vercel.needs, 'quality');
  assert.equal(ci.jobs.vercel.uses, './.github/workflows/frontend-deploy.yml');
  assert(ci.concurrency['cancel-in-progress']);
  assert.equal(render.branch, 'dev');
  assert.equal(render.plan, 'free');
  assert.equal(render.autoDeployTrigger, 'checksPass');
  assert.equal(render.rootDir, undefined);
  assert(render.buildFilter.paths.includes('apps/backend/**'));
  assert(render.buildFilter.paths.includes('packages/shared/**'));
  assert(!render.buildFilter.paths.some((path) => path.startsWith('apps/frontend')));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_call', 'workflow_dispatch']);
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(inputs.target.options, ['render', 'azure']);
  assert.deepEqual(inputs.frontend_target.options, ['vercel', 'azure']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const { preflight, deploy } = workflow.jobs;
  assert.deepEqual(preflight.permissions, { contents: 'read', actions: 'read' });
  assert(preflight.steps[0].run.includes('Azure frontend bloqueado'));
  assert.equal(deploy.needs, 'preflight');
  assert(deploy.if.includes("startsWith(github.ref, 'refs/heads/feat/')"));
  assert(!deploy.if.includes("inputs.environment == 'production'"));
  assert(deploy.if.includes('github.event.pull_request.head.repo.full_name == github.repository'));
  assert(deploy.if.includes("github.actor != 'dependabot[bot]'"));
  assert(!Object.hasOwn(deploy.env, 'VERCEL_TOKEN'));
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
  const script = deploy.steps.map((step) => step.run ?? '').join('\n');
  const commands = [
    'pull --yes',
    'deploy-config.mjs prepare',
    'build --environment=',
    'verify:public-build',
    'deploy-config.mjs output',
    'deploy --prebuilt',
    'deploy-config.mjs published',
    'promote "$DEPLOYMENT_URL"',
  ];
  let previous = -1;
  for (const command of commands) {
    const index = script.indexOf(command);
    assert(index > previous, `Falta orden seguro: ${command}`);
    previous = index;
  }
});

test('Filtro frontend incluye shared y tooling de raiz, excluye cambios solo backend y docs', () => {
  for (const path of [
    'apps/frontend/src/app/page.tsx',
    'packages/shared/src/index.ts',
    'package-lock.json',
    'tsconfig.base.json',
  ])
    assert(affectsFrontend(path));
  for (const path of ['apps/backend/src/index.ts', 'render.yaml', 'README.md'])
    assert(!affectsFrontend(path));
  assert(frontendChanged(undefined, 'HEAD'));
});

test('Rechaza corridas obsoletas para Production y Preview', async () => {
  const context = { repo: {}, sha: 'new', ref: 'refs/heads/main' };
  const checkedRefs = [];
  const github = {
    rest: {
      git: {
        getRef: async ({ ref }) => {
          checkedRefs.push(ref);
          return { data: { object: { sha: 'new' } } };
        },
      },
      pulls: {
        get: async () => ({
          data: { state: 'open', base: { ref: 'dev' }, merge_commit_sha: 'new' },
        }),
      },
    },
  };
  const preview = {
    ...context,
    eventName: 'pull_request',
    payload: { pull_request: { number: 1 } },
  };
  await assertCurrentRevision(github, context);
  await assertCurrentRevision(github, { ...context, ref: 'refs/heads/feat/nested/change' });
  assert.deepEqual(checkedRefs, ['heads/main', 'heads/feat/nested/change']);
  await assertCurrentRevision(github, preview);
  await assert.rejects(assertCurrentRevision(github, { ...context, sha: 'old' }), /obsoleto/);
  await assert.rejects(assertCurrentRevision(github, { ...preview, sha: 'old' }), /obsoleta/);
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

for (const target of ['production', 'preview'])
  test(`Respeta entorno remoto ${target}, descarta claves privadas y valida selector`, (t) => {
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
    const filename = `.env.${target}.local`;
    const pulled = Object.entries(env)
      .filter(([name]) => name.startsWith('NEXT_PUBLIC_'))
      .map(([name, value]) => `${name}="${value}"`)
      .join('\n');
    write(`.vercel/${filename}`, `${pulled}\nSERVER_SECRET=private`);
    const deployment = { ...env, DEPLOY_TARGET: target };
    assert.equal(prepareVercel(root, deployment), join('.vercel', filename));
    for (const path of ['.vercel', 'apps/frontend/.vercel']) {
      const cache = readFileSync(join(root, path, filename), 'utf8');
      assert(cache.includes('NEXT_PUBLIC_USE_AZURE="false"'));
      assert(cache.includes(env.NEXT_PUBLIC_API_URL_RENDER));
      assert(cache.includes(env.NEXT_PUBLIC_API_URL_AZURE));
      assert(!cache.includes('private'));
      assert.equal(cache.trim().split('\n').length, 5);
    }
    const project = JSON.parse(readFileSync(join(root, '.vercel/project.json')));
    assert.equal(project.settings.nodeVersion, '22.x');
    assert(project.settings.buildCommand.includes('build:shared'));
    write(`.vercel/${filename}`, pulled.replace('="false"', '="true"'));
    assert.throws(() => prepareVercel(root, deployment), /USE_AZURE=false/);
    write(`.vercel/${filename}`, pulled.replace('sb_publishable_fixture', 'sb_secret_sensitive'));
    assert.throws(
      () => prepareVercel(root, deployment),
      (error) => !error.message.includes('sensitive'),
    );
    write(`.vercel/${filename}`, pulled);
    const checkpoint = {
      ...deployment,
      CHECKPOINT: 'true',
      CHECKPOINT_RENDER_URL: env.NEXT_PUBLIC_API_URL_RENDER,
      CHECKPOINT_AZURE_URL: env.NEXT_PUBLIC_API_URL_AZURE,
    };
    if (target === 'preview') {
      const push = {
        ...deployment,
        GITHUB_EVENT_NAME: 'push',
        EXPECTED_DEV_API: new URL(env.NEXT_PUBLIC_API_URL_RENDER).origin,
        EXPECTED_DEV_SUPABASE: new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin,
      };
      assert.equal(prepareVercel(root, push), join('.vercel', filename));
      assert.throws(
        () => prepareVercel(root, { ...push, EXPECTED_DEV_API: '' }),
        /Faltan los origenes Dev/,
      );
      assert.throws(
        () => prepareVercel(root, { ...push, EXPECTED_DEV_API: 'https://production.example' }),
        /origenes Render y Supabase de Dev/,
      );
      assert.throws(
        () => prepareVercel(root, { ...push, EXPECTED_DEV_SUPABASE: 'https://production.example' }),
        /origenes Render y Supabase de Dev/,
      );
      prepareVercel(root, checkpoint);
      assert(
        readFileSync(join(root, '.vercel', filename), 'utf8').includes(
          'NEXT_PUBLIC_USE_AZURE="true"',
        ),
      );
    } else {
      assert.throws(() => prepareVercel(root, checkpoint), /solo en Preview/);
    }
    write('.vercel/project.json', { ...project, projectId: 'wrong' });
    assert.throws(() => prepareVercel(root, deployment), /Proyecto/);
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
