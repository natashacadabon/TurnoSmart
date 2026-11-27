import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  affectsFrontend,
  assertCurrentRevision,
  assertSuccessfulCi,
  prepareVercel,
  selectPreview,
  selectDevPreview,
  verifyOutput,
  verifyStandaloneOutput,
  verifyPublished,
  verifyProductionBackend,
  verifyVercelAccess,
  promoteProduction,
  assertTrustedPreviewContext,
  previewOutcome,
} from './deploy-config.mjs';
import { assignPreviewAlias } from './preview-alias.mjs';

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

test('Los contextos privilegiados Preview exigen la referencia Dev confiable en ambos eventos', () => {
  for (const eventName of ['workflow_run', 'pull_request_target']) {
    const context = {
      eventName,
      ref: 'refs/heads/dev',
      sha: 'a'.repeat(40),
      payload: { repository: { default_branch: 'dev' } },
    };
    assert.doesNotThrow(() => assertTrustedPreviewContext(context));
    for (const change of [
      { ref: 'refs/heads/feat/untrusted' },
      { ref: 'refs/pull/23/merge' },
      { ref: 'refs/heads/main' },
      { ref: 'refs/tags/dev' },
      { sha: 'head' },
      { eventName: 'pull_request' },
      { eventName: 'push' },
      { payload: { repository: { default_branch: 'main' } } },
      { payload: { repository: {} } },
    ])
      assert.throws(
        () => assertTrustedPreviewContext({ ...context, ...change }),
        /referencia confiable/,
      );
  }
});

test('El resumen distingue publicado, reutilizado, omitido y fallido sin falsos positivos', () => {
  const sha = 'a'.repeat(40);
  const results = { select: 'success', settings: 'success', build: 'success', deploy: 'success' };
  const url = 'https://fixture.vercel.app';
  const alias = 'https://turnosmart-dev-42.vercel.app';
  assert.deepEqual(previewOutcome(sha, results, url, alias), {
    status: 'publicado',
    message: 'Nuevo Preview publicado con alias verificado.',
  });
  assert.match(previewOutcome(sha, results, '', alias).message, /reutilizado/);
  assert.equal(
    previewOutcome('', { ...results, settings: 'skipped', build: 'skipped', deploy: 'skipped' })
      .status,
    'omitido',
  );
  assert.equal(
    previewOutcome('', Object.fromEntries(Object.keys(results).map((job) => [job, 'skipped'])))
      .status,
    'omitido',
  );
  for (const [candidate, jobs, output, stable] of [
    ['', results, url, alias],
    ['', { ...results, select: 'failure' }],
    [sha, { ...results, settings: 'failure' }],
    [sha, { ...results, build: 'cancelled' }],
    [sha, { ...results, deploy: 'skipped' }],
    [sha, results, url, ''],
    ['head', results, url, alias],
    [sha, {}, url, alias],
    [sha, results, 'https://fixture.vercel.app/?token=secret', alias],
    [sha, results, url, 'https://unexpected.example.com'],
  ])
    assert.equal(previewOutcome(candidate, jobs, output, stable).status, 'fallido');
});

test('El preflight valida proyecto y cuenta sin requerir acceso global a equipo/usuario', async () => {
  const source = { ...env, VERCEL_TOKEN: 'fixture-secret' };
  const project = { id: env.VERCEL_PROJECT_ID, accountId: env.VERCEL_ORG_ID };
  for (const target of ['preview', 'production']) {
    const calls = [];
    const result = await verifyVercelAccess(
      { ...source, DEPLOY_TARGET: target },
      async (url, options) => {
        calls.push(url.pathname);
        assert.equal(url.origin, 'https://api.vercel.com');
        assert.equal(url.searchParams.get('teamId'), env.VERCEL_ORG_ID);
        assert.equal(options.method, 'GET');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
        assert(options.signal instanceof AbortSignal);
        // Regresión real: este token puede acceder al proyecto pero no listar equipos/usuarios.
        return url.pathname === `/v9/projects/${env.VERCEL_PROJECT_ID}`
          ? Response.json(project)
          : new Response(null, { status: 403 });
      },
    );
    assert.deepEqual(result, { teamId: project.accountId, projectId: project.id });
    assert.deepEqual(calls, [`/v9/projects/${env.VERCEL_PROJECT_ID}`]);
  }
  for (const status of [401, 403, 404, 429, 500]) {
    await assert.rejects(
      () => verifyVercelAccess(source, async () => new Response('fixture-secret', { status })),
      (error) => {
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert(!error.message.includes('fixture-secret'));
        return true;
      },
    );
  }
  await assert.rejects(
    () =>
      verifyVercelAccess(source, async () => {
        throw new Error('fixture-secret');
      }),
    /red\/timeout/,
  );
  await assert.rejects(
    () => verifyVercelAccess(source, async () => new Response('not-json')),
    /JSON inválida/,
  );
  for (const override of [
    { ...project, id: 'prj_other' },
    { ...project, accountId: 'team_other' },
    null,
  ])
    await assert.rejects(
      () => verifyVercelAccess(source, async () => Response.json(override)),
      /no corresponde/,
    );
  for (const override of [
    { VERCEL_TOKEN: '' },
    { VERCEL_ORG_ID: 'natcads-projects' },
    { VERCEL_PROJECT_ID: 'other' },
    { DEPLOY_TARGET: 'invalid' },
  ])
    await assert.rejects(() =>
      verifyVercelAccess({ ...source, ...override }, async () =>
        assert.fail('No debe consultar con configuración inválida'),
      ),
    );
});

function promotionFixture(overrides = {}) {
  const source = {
    ...env,
    VERCEL_TOKEN: 'fixture-secret',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: 'a'.repeat(40),
    DEPLOYMENT_URL: 'https://fixture.vercel.app',
  };
  const project = {
    id: env.VERCEL_PROJECT_ID,
    accountId: env.VERCEL_ORG_ID,
    lastAliasRequest: { requestedAt: 100 },
  };
  const deployment = {
    id: 'dpl_fixture',
    projectId: project.id,
    ownerId: project.accountId,
    url: 'fixture.vercel.app',
    target: 'production',
    readyState: 'READY',
    meta: { turnosmartMergeSha: source.GITHUB_SHA },
  };
  const completed = {
    ...project,
    lastAliasRequest: {
      requestedAt: Date.now(),
      type: 'promote',
      toDeploymentId: deployment.id,
      jobStatus: 'succeeded',
    },
  };
  const calls = [];
  const request = async (url, options) => {
    calls.push({ path: url.pathname, method: options.method });
    assert.equal(url.origin, 'https://api.vercel.com');
    assert.equal(url.searchParams.get('teamId'), env.VERCEL_ORG_ID);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
    if (options.method === 'POST') {
      assert.equal(url.pathname, `/v10/projects/${project.id}/promote/${deployment.id}`);
      assert.equal(options.body, '{}');
      if (overrides.postError) throw new Error('fixture-secret');
      return new Response(null, { status: 202 });
    }
    const posted = calls.some((call) => call.method === 'POST');
    if (url.pathname === `/v9/projects/${project.id}`) {
      const state = posted
        ? { ...completed, ...overrides.completed }
        : { ...project, ...overrides.project };
      // Vercel sólo incluye el estado de promoción con rollbackInfo=true.
      if (url.searchParams.get('rollbackInfo') !== 'true') state.lastAliasRequest = null;
      return Response.json(state);
    }
    if (url.pathname.startsWith('/v13/deployments/'))
      return Response.json({
        ...deployment,
        ...overrides.deployment,
        ...(posted
          ? {
              aliasAssigned: true,
              aliasError: null,
              alias: ['production.vercel.app'],
              ...overrides.assigned,
            }
          : {}),
      });
    assert.fail('Consulta no esperada');
  };
  return { source, request, calls };
}

test('Promoción usa la operación oficial con teamId y acredita job y dominio antes de éxito', async () => {
  const f = promotionFixture();
  assert.equal(
    await promoteProduction(f.source, f.request, async () => {}),
    'https://production.vercel.app',
  );
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
  assert(!f.calls.some((call) => /teams|user|domains|aliases/.test(call.path)));
});

test('Promoción espera un job pendiente sin repetir el POST y propaga rechazos HTTP', async () => {
  const override = {
    completed: {
      lastAliasRequest: {
        requestedAt: Date.now(),
        type: 'promote',
        toDeploymentId: 'dpl_fixture',
        jobStatus: 'pending',
      },
    },
  };
  const f = promotionFixture(override);
  let waits = 0;
  assert.equal(
    await promoteProduction(f.source, f.request, async () => {
      waits++;
      override.completed.lastAliasRequest.jobStatus = 'succeeded';
    }),
    'https://production.vercel.app',
  );
  assert.equal(waits, 1);
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
  for (const status of [401, 403, 404, 429, 500]) {
    const rejected = promotionFixture();
    let posts = 0;
    await assert.rejects(
      () =>
        promoteProduction(rejected.source, async (url, options) => {
          if (options.method !== 'POST') return rejected.request(url, options);
          posts++;
          return new Response('fixture-secret', { status });
        }),
      (error) => {
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert(!error.message.includes('fixture-secret'));
        return true;
      },
    );
    assert.equal(posts, 1);
  }
});

test('La promoción rechaza Preview, otro proyecto, cuenta, SHA o estado previo inválido antes del POST', async () => {
  for (const override of [
    { deployment: { target: null } },
    { deployment: { target: 'preview' } },
    { deployment: { projectId: 'prj_other' } },
    { deployment: { ownerId: 'team_other' } },
    { deployment: { readyState: 'BUILDING' } },
    { deployment: { url: 'other.vercel.app' } },
    { deployment: { meta: { turnosmartMergeSha: 'b'.repeat(40) } } },
    { deployment: { id: '../other' } },
    { project: { accountId: 'team_other' } },
    { project: { rollingRelease: { active: true } } },
    { project: { lastAliasRequest: { requestedAt: 'invalid' } } },
  ]) {
    const f = promotionFixture(override);
    await assert.rejects(() => promoteProduction(f.source, f.request, async () => {}));
    assert(!f.calls.some((call) => call.method === 'POST'), JSON.stringify(override));
  }
  for (const override of [
    { GITHUB_REF: 'refs/heads/dev' },
    { DEPLOY_TARGET: 'preview' },
    { GITHUB_SHA: 'head' },
    { DEPLOYMENT_URL: 'https://fixture.vercel.app/?token=x' },
  ]) {
    const f = promotionFixture();
    await assert.rejects(() => promoteProduction({ ...f.source, ...override }, f.request));
    assert.equal(f.calls.length, 0);
  }
});

test('Aceptar la petición no acredita publicación: rechaza fallos, reemplazos, estados antiguos y dominios ausentes', async () => {
  for (const override of [
    ...['failed', 'skipped', 'pending', 'in-progress'].map((jobStatus) => ({
      completed: {
        lastAliasRequest: {
          requestedAt: Date.now(),
          type: 'promote',
          toDeploymentId: 'dpl_fixture',
          jobStatus,
        },
      },
    })),
    {
      completed: {
        lastAliasRequest: {
          requestedAt: Date.now(),
          type: 'rollback',
          toDeploymentId: 'dpl_fixture',
          jobStatus: 'succeeded',
        },
      },
    },
    {
      completed: {
        lastAliasRequest: {
          requestedAt: Date.now(),
          type: 'promote',
          toDeploymentId: 'dpl_other',
          jobStatus: 'succeeded',
        },
      },
    },
    {
      completed: {
        lastAliasRequest: {
          requestedAt: 100,
          type: 'promote',
          toDeploymentId: 'dpl_fixture',
          jobStatus: 'succeeded',
        },
      },
    },
    { completed: { lastAliasRequest: null } },
    {
      completed: {
        lastAliasRequest: {
          requestedAt: Date.now() - 60000,
          type: 'promote',
          toDeploymentId: 'dpl_fixture',
          jobStatus: 'succeeded',
        },
      },
    },
    {
      completed: {
        lastAliasRequest: {
          requestedAt: 'invalid',
          type: 'promote',
          toDeploymentId: 'dpl_fixture',
          jobStatus: 'succeeded',
        },
      },
    },
    { assigned: { alias: [] } },
    { assigned: { alias: ['https://other.com/?secret=x'] } },
    { assigned: { aliasAssigned: false } },
    { assigned: { aliasError: { code: 'error' } } },
    { assigned: { id: 'dpl_other' } },
    { assigned: { target: 'preview' } },
    { assigned: { ownerId: 'team_other' } },
    { assigned: { meta: {} } },
  ]) {
    const f = promotionFixture(override);
    await assert.rejects(() => promoteProduction(f.source, f.request, async () => {}));
    assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
  }
  const f = promotionFixture({ postError: true });
  await assert.rejects(
    () => promoteProduction(f.source, f.request),
    (error) => {
      assert.match(error.message, /no se reintentó/);
      assert(!error.message.includes('fixture-secret'));
      return true;
    },
  );
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
});

test('Production manual exige main y Render Dev conserva su configuración', () => {
  const ci = yaml.load(readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8'));
  const workflow = yaml.load(
    readFileSync(join(repo, '.github/workflows/frontend-deploy.yml'), 'utf8'),
  );
  const {
    services: [render],
  } = yaml.load(readFileSync(join(repo, 'render.yaml'), 'utf8'));
  assert.deepEqual(ci.on.push.branches, ['dev', 'main']);
  assert.deepEqual(ci.on.pull_request.branches, ['dev', 'main']);
  const vercel = JSON.parse(readFileSync(join(repo, 'apps/frontend/vercel.json'), 'utf8'));
  assert.equal(vercel.git.deploymentEnabled, false);
  assert.deepEqual(Object.keys(ci.jobs), ['quality']);
  assert.equal(ci.jobs.quality.name, 'Quality Checks');
  assert.equal(ci.jobs.quality.needs, undefined);
  assert.equal(ci.jobs.quality.if, undefined);
  assert.equal(ci.on.pull_request.types, undefined);
  assert(ci.concurrency['cancel-in-progress']);
  assert.equal(render.name, 'TurnoSmart');
  assert.equal(render.branch, 'dev');
  assert.equal(render.plan, 'free');
  assert.equal(render.autoDeployTrigger, 'checksPass');
  assert.equal(render.rootDir, undefined);
  assert(render.buildFilter.paths.includes('apps/backend/**'));
  assert(render.buildFilter.paths.includes('packages/shared/**'));
  assert(!render.buildFilter.paths.some((path) => path.startsWith('apps/frontend')));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(inputs.target.options, ['render', 'azure']);
  assert.deepEqual(inputs.frontend_target.options, ['vercel', 'azure']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const { preflight, deploy } = workflow.jobs;
  assert.deepEqual(preflight.permissions, { contents: 'read', actions: 'read' });
  assert(preflight.steps[0].run.includes('Azure frontend bloqueado'));
  assert.equal(deploy.needs, 'preflight');
  assert(!deploy.if.includes('pull_request'));
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
    'deploy-config.mjs vercel-access',
    'pull --yes',
    'deploy-config.mjs prepare',
    'build "${flags[@]}" --output .vercel/output',
    'verify:public-build',
    'deploy-config.mjs output',
    'deploy --prebuilt',
    'deploy-config.mjs published',
    'deploy-config.mjs backend',
    'deploy-config.mjs promote',
  ];
  let previous = -1;
  for (const command of commands) {
    const index = script.indexOf(command);
    assert(index > previous, `Falta orden seguro: ${command}`);
    previous = index;
  }
});

test('Production sólo autoriza main explícita aunque Dev tenga CI aprobada; Azure sigue en Preview', () => {
  const workflow = yaml.load(
    readFileSync(join(repo, '.github/workflows/frontend-deploy.yml'), 'utf8'),
  );
  const gate = workflow.jobs.preflight.steps[0];
  assert.equal(workflow.jobs.preflight.environment, undefined);
  const gitBash = join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe');
  const bash = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash';
  // Una CI aprobada no debe conceder permiso para publicar desde otra rama.
  assertSuccessfulCi(
    [
      {
        head_sha: 'approved',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        run_number: 1,
      },
    ],
    'approved',
  );
  for (const [ref, branch, target, allowed] of [
    ['refs/heads/main', 'main', 'render', true],
    ['refs/heads/dev', 'dev', 'render', false],
    ['refs/heads/dev', 'main', 'render', false],
    ['refs/heads/main', 'dev', 'render', false],
    ['refs/heads/main', undefined, 'render', false],
    ['refs/heads/dev', undefined, 'render', false],
    ['refs/heads/main', '', 'render', false],
    ['refs/heads/main', ' main', 'render', false],
    ['refs/heads/main', 'main ', 'render', false],
    ['refs/heads/main', 'main\n', 'render', false],
    ['refs/heads/main', 'refs/heads/main', 'render', false],
    ['refs/heads/feat/main', 'main', 'render', false],
    ['refs/tags/main', 'main', 'render', false],
    ['refs/pull/42/merge', 'main', 'render', false],
    ['', 'main', 'render', false],
    ['refs/heads/main', 'main', '', false],
    ['refs/heads/main', 'main', 'invalid', false],
    ['refs/heads/dev', undefined, 'azure', true],
    ['refs/heads/dev', 'main', 'azure', true],
    ['refs/heads/main', 'main', 'azure', false],
    ['refs/tags/dev', 'main', 'azure', false],
  ]) {
    const source = {
      ...process.env,
      FRONTEND_TARGET: 'vercel',
      HOBBY_ELIGIBLE: 'true',
      API_TARGET: target,
      GITHUB_REF: ref,
    };
    if (branch === undefined) delete source.PRODUCTION_BRANCH;
    else source.PRODUCTION_BRANCH = branch;
    const result = spawnSync(bash, ['--noprofile', '--norc', '-euo', 'pipefail', '-c', gate.run], {
      env: source,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(
      result.status === 0,
      allowed,
      JSON.stringify({ ref, branch, target, status: result.status, error: result.stderr }),
    );
  }
  assert.equal(gate.env.PRODUCTION_BRANCH, '${{ vars.VERCEL_PRODUCTION_BRANCH }}');
  // El checkpoint conserva los scopes Preview existentes; no recibe el target Production.
  assert.equal(
    workflow.jobs.deploy.environment.name,
    "vercel-${{ inputs.target == 'azure' && 'preview' || 'production' }}",
  );
  assert.equal(
    workflow.jobs.deploy.env.DEPLOY_TARGET,
    "${{ inputs.target == 'azure' && 'preview' || 'production' }}",
  );
});

test('Preview descarga settings y publica sin consultar Production; Production conserva sus flags', (t) => {
  const automatic = yaml.load(
    readFileSync(join(repo, '.github/workflows/frontend-preview.yml'), 'utf8'),
  );
  const manual = yaml.load(
    readFileSync(join(repo, '.github/workflows/frontend-deploy.yml'), 'utf8'),
  );
  const gitBash = join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe');
  const bash = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash';
  for (const [target, pull, upload] of [
    [
      'preview',
      automatic.jobs.settings.steps.find(
        (step) => step.name === 'Pull and sanitize Vercel settings',
      ),
      automatic.jobs.deploy.steps.find((step) => step.id === 'upload'),
    ],
    ...['preview', 'production'].map((target) => [
      target,
      manual.jobs.deploy.steps.find((step) => step.name === 'Pull Vercel settings'),
      manual.jobs.deploy.steps.find((step) => step.id === 'upload'),
    ]),
  ]) {
    const { root, write } = fixture(t);
    for (const dir of ['.vercel', 'apps/frontend/.vercel'])
      write(`${dir}/.env.preview.local`, 'NEXT_PUBLIC_USE_AZURE="false"\n');
    // Se ejecuta el shell real del workflow; la CLI y prepare se simulan sin red ni credenciales reales.
    const stubs = `
      npx() {
        printf '%s\\n' "$*" >> commands.log
        if [[ "$*" == *' deploy '* ]]; then printf '%s\\n' 'https://fixture.vercel.app'; fi
      }
      node() { [[ "$*" == 'apps/frontend/scripts/deploy-config.mjs prepare' || "$*" == 'apps/frontend/scripts/deploy-config.mjs vercel-access' ]]; }
      curl() { echo 'Consulta remota inesperada' >&2; return 97; }
      jq() { return 97; }
    `;
    const run = (token) =>
      spawnSync(
        bash,
        ['--noprofile', '--norc', '-euo', 'pipefail', '-c', `${stubs}\n${pull.run}\n${upload.run}`],
        {
          cwd: root,
          env: {
            ...process.env,
            DEPLOY_TARGET: target,
            VERCEL_TOKEN: token,
            VERCEL_ORG_ID: 'team_fixture',
            VERCEL_PROJECT_ID: 'prj_fixture',
            VERCEL_CLI_VERSION: '65.9.0',
            HEAD_REF: target === 'production' ? 'main' : 'dev',
            GITHUB_REF_NAME: target === 'production' ? 'main' : 'dev',
            GITHUB_HEAD_REF: '',
            GITHUB_REPOSITORY_ID: '42',
            PR_NUMBER: '',
            PR_SHA: 'fixture-sha',
            GITHUB_SHA: 'a'.repeat(40),
            GITHUB_OUTPUT: 'output.log',
          },
          encoding: 'utf8',
          timeout: 10000,
        },
      );
    const missing = run('');
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Configurar VERCEL_TOKEN/);
    assert(!existsSync(join(root, 'commands.log')));
    const result = run('fixture-token');
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const commands = readFileSync(join(root, 'commands.log'), 'utf8').trim().split('\n');
    assert.equal(commands.length, 2);
    for (const command of commands) assert.match(command, /--token=fixture-token(?:\s|$)/);
    assert.match(commands[0], new RegExp(`pull --yes --environment=${target}`));
    assert.match(commands[1], /deploy --prebuilt --archive=tgz --yes/);
    if (target === 'preview') {
      assert.match(commands[0], /--git-branch dev/);
      assert.match(commands[1], /--environment=preview/);
      assert(!commands.join('\n').includes('--prod'));
    } else {
      assert.match(commands[1], /--prod --skip-domain/);
      assert(!commands[1].includes('--environment=preview'));
    }
    assert.match(
      readFileSync(join(root, 'output.log'), 'utf8'),
      /url=https:\/\/fixture.vercel.app/,
    );
  }
  const deploy = manual.jobs.deploy;
  assert.equal(
    deploy.steps.find((step) => step.name === 'Promote Production').if,
    "env.DEPLOY_TARGET == 'production'",
  );
  assert.equal(
    deploy.steps.find((step) => step.name === 'Check current Production branch before promotion')
      .if,
    "env.DEPLOY_TARGET == 'production'",
  );
});

test('Promote usa el mismo token y equipo que upload; propaga errores del verificador', (t) => {
  const {
    jobs: { deploy },
  } = yaml.load(readFileSync(join(repo, '.github/workflows/frontend-deploy.yml'), 'utf8'));
  const promote = deploy.steps.find((step) => step.name === 'Promote Production');
  const upload = deploy.steps.find((step) => step.id === 'upload');
  const pull = deploy.steps.find((step) => step.name === 'Pull Vercel settings');
  assert.equal(deploy.env.VERCEL_CLI_VERSION, '65.9.0');
  assert.equal(deploy.env.VERCEL_ORG_ID, '${{ vars.VERCEL_ORG_ID }}');
  assert.equal(promote.env.VERCEL_TOKEN, '${{ secrets.VERCEL_TOKEN }}');
  assert.equal(upload.env.VERCEL_TOKEN, promote.env.VERCEL_TOKEN);
  assert.equal(pull.env.VERCEL_TOKEN, promote.env.VERCEL_TOKEN);
  const access = deploy.steps.find(
    (step) => step.name === 'Verify Vercel identity and project access',
  );
  assert.equal(access.env.VERCEL_TOKEN, promote.env.VERCEL_TOKEN);
  assert(deploy.steps.indexOf(access) < deploy.steps.indexOf(pull));
  assert.equal(promote.env.DEPLOYMENT_URL, '${{ steps.upload.outputs.url }}');
  const gitBash = join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe');
  const bash = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash';
  for (const [org, token, cliExit, expected] of [
    ['team_fixture', 'fixture-token', '0', 0],
    ['', 'fixture-token', '0', 1],
    ['team_fixture', '', '0', 1],
    ['team_fixture', 'fixture-token', '1', 1],
  ]) {
    const { root } = fixture(t);
    const result = spawnSync(
      bash,
      [
        '--noprofile',
        '--norc',
        '-euo',
        'pipefail',
        '-c',
        `
      node() { printf '%s\\n' "$@" > args.log; [[ "$CLI_EXIT" != 0 ]] || echo https://production.vercel.app; return "$CLI_EXIT"; }
      ${promote.run}
    `,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          VERCEL_ORG_ID: org,
          VERCEL_TOKEN: token,
          VERCEL_CLI_VERSION: '65.9.0',
          DEPLOYMENT_URL: 'https://fixture.vercel.app',
          CLI_EXIT: cliExit,
          GITHUB_OUTPUT: 'output.log',
        },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, expected, result.stderr);
    if (!org || !token) {
      assert(!existsSync(join(root, 'args.log')));
      assert.match(result.stderr, /Configurar VERCEL_(ORG_ID|TOKEN)/);
    } else {
      assert.deepEqual(readFileSync(join(root, 'args.log'), 'utf8').trim().split('\n'), [
        'apps/frontend/scripts/deploy-config.mjs',
        'promote',
      ]);
      if (expected === 0)
        assert.match(
          readFileSync(join(root, 'output.log'), 'utf8'),
          /url=https:\/\/production.vercel.app/,
        );
    }
  }
});

test('El alias es estable por PR y rechaza colisiones o revisiones obsoletas', async () => {
  const alias = 'turnosmart-pr-123-23.vercel.app';
  const host = 'fixture-deployment.vercel.app';
  const context = {
    eventName: 'pull_request',
    sha: 'head',
    repo: { owner: 'owner', repo: 'repo' },
    payload: {
      repository: { id: 123, full_name: 'owner/repo' },
      pull_request: {
        number: 23,
        base: { ref: 'dev' },
        head: { sha: 'head', repo: { full_name: 'owner/repo' } },
        user: { login: 'maintainer' },
      },
    },
  };
  const previewEnv = {
    ...env,
    DEPLOY_TARGET: 'preview',
    DEPLOYMENT_URL: `https://${host}`,
    VERCEL_TOKEN: 'fixture',
  };
  const deployment = {
    id: 'dpl_new',
    url: host,
    projectId: env.VERCEL_PROJECT_ID,
    readyState: 'READY',
    target: null,
    meta: { turnosmartPullRequest: '123-23', turnosmartMergeSha: context.sha },
  };
  const oldAlias = { alias, projectId: deployment.projectId, deploymentId: 'dpl_old' };
  for (const scenario of [
    {},
    { current: oldAlias },
    {
      current: oldAlias,
      previous: { ...deployment, target: 'production' },
      error: /no es un Preview/,
    },
    {
      current: oldAlias,
      previous: { ...deployment, meta: { turnosmartPullRequest: '123-24' } },
      error: /no es un Preview/,
    },
    { current: { ...oldAlias, projectId: 'prj_other' }, error: /Alias ocupado/ },
    { configuredDomain: true, error: /dominio configurado/ },
    { headChanged: true, error: /obsoleta/ },
    {
      source: { ...deployment, meta: { ...deployment.meta, turnosmartMergeSha: 'old' } },
      error: /artefacto verificado/,
    },
    { source: { ...deployment, target: 'production' }, error: /no es un Preview/ },
    { source: { ...deployment, readyState: 'BUILDING' }, error: /artefacto verificado/ },
    { source: { ...deployment, readyState: 'ERROR' }, error: /artefacto verificado/ },
    { production: true, error: /solo para Preview/ },
  ]) {
    let writes = 0;
    let checked = false;
    const github = {
      rest: {
        pulls: {
          get: async () => {
            checked = true;
            return {
              data: {
                state: 'open',
                base: { ref: 'dev' },
                head: { sha: scenario.headChanged ? 'newer' : 'head' },
              },
            };
          },
        },
      },
    };
    const request = async (url, init) => {
      assert.equal(url.origin, 'https://api.vercel.com');
      assert.equal(url.searchParams.get('teamId'), env.VERCEL_ORG_ID);
      switch (url.pathname) {
        case `/v13/deployments/${host}`:
          return Response.json(scenario.source ?? deployment);
        case '/v13/deployments/dpl_old':
          return Response.json(scenario.previous ?? deployment);
        case `/v4/aliases/${alias}`:
          return scenario.current
            ? Response.json(scenario.current)
            : new Response(null, { status: 404 });
        case `/v9/projects/${deployment.projectId}/domains/${alias}`:
          return new Response('{}', { status: scenario.configuredDomain ? 200 : 404 });
        case '/v2/deployments/dpl_new/aliases':
          assert(checked);
          assert.equal(init.method, 'POST');
          assert.deepEqual(JSON.parse(init.body), { alias });
          writes++;
          return Response.json({ alias });
        default:
          assert.fail(`Ruta inesperada: ${url.pathname}`);
      }
    };
    const run = () =>
      assignPreviewAlias(github, context, scenario.production ? env : previewEnv, request);
    if (scenario.error) await assert.rejects(run, scenario.error);
    else assert.equal(await run(), `https://${alias}`);
    assert.equal(writes, scenario.error ? 0 : 1);
  }
});

test('Preview separa codigo de la PR, secretos y definicion del workflow', () => {
  const ci = yaml.load(readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8'));
  const preview = yaml.load(
    readFileSync(join(repo, '.github/workflows/frontend-preview.yml'), 'utf8'),
  );
  const text = readFileSync(join(repo, '.github/workflows/frontend-preview.yml'), 'utf8');
  // La definicion privilegiada nunca viene de la PR: solo workflow_run tras CI.
  assert.deepEqual(Object.keys(preview.on), ['workflow_run']);
  assert.deepEqual(preview.on.workflow_run.workflows, [ci.name]);
  assert.deepEqual(preview.permissions, { contents: 'read' });
  assert(!text.includes('pull_request_target'));
  assert(!text.includes('VERCEL_AUTOMATION_BYPASS'));
  assert.deepEqual(Object.keys(preview.jobs), ['select', 'settings', 'build', 'deploy', 'report']);
  const { select, settings, build, deploy } = preview.jobs;
  assert(select.if.includes("github.event.workflow_run.conclusion == 'success'"));
  assert(select.if.includes("github.event.workflow_run.event == 'pull_request'"));
  assert.equal(settings.if, "needs.select.outputs.sha != ''");
  assert.deepEqual(build.needs, ['select', 'settings']);
  assert.deepEqual(deploy.needs, ['select', 'build']);
  // Solo el job que ejecuta codigo de la PR carece de secretos y environment.
  const checkout = (job) => job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(build.environment, undefined);
  assert.equal(checkout(build).with.ref, '${{ needs.select.outputs.sha }}');
  assert(!JSON.stringify(build).includes('secrets.'));
  assert(!JSON.stringify(build).includes('vars.VERCEL'));
  for (const job of [select, settings, deploy]) {
    assert.equal(
      checkout(job).with.ref,
      '${{ github.sha }}',
      'Scripts con secretos salen de la rama confiable',
    );
  }
  assert(
    select.steps
      .find((step) => step.id === 'select')
      .with.script.includes('assertTrustedPreviewContext(context)'),
  );
  const report = preview.jobs.report;
  assert.equal(report.if, '${{ always() }}');
  assert.deepEqual(report.needs, ['select', 'settings', 'build', 'deploy']);
  assert.equal(report.environment, undefined);
  assert.equal(checkout(report).with.ref, '${{ github.sha }}');
  assert(!JSON.stringify(report).includes('secrets.'));
  assert(report.steps[1].with.script.includes('previewOutcome'));
  assert(report.steps[1].with.script.includes("outcome.status === 'fallido'"));
  for (const job of [select, settings, build, deploy])
    assert.equal(checkout(job).with['persist-credentials'], false);
  for (const job of [settings, deploy]) assert.equal(job.environment.name, 'vercel-preview');
  assert.equal(settings.environment.deployment, false);
  assert.equal(deploy.environment.deployment, undefined);
  assert.match(deploy.environment.url, /steps\.preview-alias\.outputs\.url/);
  // Los jobs con token no instalan ni ejecutan scripts npm de la PR.
  assert(!JSON.stringify(settings).includes('npm run'));
  assert(!JSON.stringify(deploy).includes('npm run'));
  assert(!JSON.stringify(deploy).includes('npm ci'));
  // El deploy toma proyecto y PR de variables y del job select, no del artefacto.
  assert(
    !deploy.steps.some(
      (step) => step.uses?.includes('download-artifact') && step.with.name === 'vercel-settings',
    ),
  );
  assert(build.steps.some((step) => step.run?.includes('build --standalone')));
  const upload = deploy.steps.find((step) => step.id === 'upload');
  const preflight = deploy.steps.find((step) => step.run?.includes('standalone-output'));
  assert(preflight && deploy.steps.indexOf(preflight) < deploy.steps.indexOf(upload));
  assert.equal(preflight.env, undefined);
  assert(upload.run.includes('turnosmartPullRequest=$GITHUB_REPOSITORY_ID-$PR_NUMBER'));
  assert(upload.run.includes('turnosmartMergeSha=$PR_SHA'));
  const names = deploy.steps.map((step) => step.name ?? step.id);
  assert(names.indexOf('Check current revision') < names.indexOf('Upload prebuilt'));
  assert(names.indexOf('Upload prebuilt') < names.indexOf('Update verified Preview alias'));
  // Quality Checks sigue siendo el unico job de CI; ya no recibe secretos ni llama a Vercel.
  assert.deepEqual(Object.keys(ci.jobs), ['quality']);
  assert(!readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8').includes('VERCEL'));
});

test('Preview solo se selecciona para PR internas elegibles y prioriza dev', async () => {
  const sha = 'head';
  const pr = (overrides = {}) => ({
    number: 23,
    state: 'open',
    user: { login: 'maintainer' },
    base: { ref: 'dev' },
    head: { ref: 'feat/change', sha, repo: { full_name: 'owner/repo' } },
    ...overrides,
  });
  const run = (overrides = {}) => ({
    event: 'pull_request',
    conclusion: 'success',
    head_sha: sha,
    path: '.github/workflows/ci.yml@refs/pull/23/merge',
    head_repository: { full_name: 'owner/repo' },
    pull_requests: [{ number: 23 }],
    ...overrides,
  });
  const select = (workflowRun, prs, files = [{ filename: 'apps/frontend/src/a.ts' }]) =>
    selectPreview(
      {
        paginate: async () => files,
        rest: {
          pulls: {
            get: async ({ pull_number }) => ({ data: prs[pull_number] }),
            listFiles: () => {},
          },
        },
      },
      {
        repo: { owner: 'owner', repo: 'repo' },
        sha: 'default-branch',
        payload: { workflow_run: workflowRun, repository: { id: 1, full_name: 'owner/repo' } },
      },
    );
  const selected = await select(run(), { 23: pr() });
  assert.equal(selected.eventName, 'pull_request');
  assert.equal(selected.sha, sha);
  assert.equal(selected.payload.pull_request.number, 23);
  assert.deepEqual(selected.repo, { owner: 'owner', repo: 'repo' });
  const head = (value) => ({ ...pr().head, ...value });
  for (const [workflowRun, prs, files] of [
    [run({ conclusion: 'failure' }), { 23: pr() }],
    [run({ event: 'push' }), { 23: pr() }],
    [run({ head_repository: { full_name: 'fork/repo' } }), { 23: pr() }],
    [run({ pull_requests: [] }), {}],
    [run({ path: '.github/workflows/fake.yml' }), { 23: pr() }],
    [
      run(),
      { 23: pr() },
      [{ filename: 'apps/frontend/a.ts' }, { filename: '.github/workflows/ci.yml' }],
    ],
    [run(), { 23: pr() }, [{ filename: 'apps/frontend/a.ts', previous_filename: '.github/x.yml' }]],
    [run(), { 23: pr({ state: 'closed' }) }],
    [run(), { 23: pr({ user: { login: 'dependabot[bot]' } }) }],
    [run(), { 23: pr({ head: head({ sha: 'other' }) }) }],
    [run(), { 23: pr({ head: head({ ref: 'fix/change' }) }) }],
    [run(), { 23: pr({ head: head({ repo: { full_name: 'fork/repo' } }) }) }],
    [run(), { 23: pr({ base: { ref: 'release' } }) }],
    [run(), { 23: pr() }, [{ filename: 'apps/backend/src/index.ts' }]],
  ])
    assert.equal(await select(workflowRun, prs, files), null);
  const renamed = [{ filename: 'docs/a.ts', previous_filename: 'apps/frontend/src/a.ts' }];
  assert((await select(run(), { 23: pr() }, renamed)) !== null);
  const both = await select(run({ pull_requests: [{ number: 24 }, { number: 23 }] }), {
    23: pr(),
    24: pr({ number: 24, base: { ref: 'main' } }),
  });
  assert.equal(both.payload.pull_request.number, 23);
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
          data: {
            state: 'open',
            base: { ref: 'dev' },
            head: { sha: 'head' },
          },
        }),
      },
    },
  };
  const preview = {
    ...context,
    sha: 'head',
    eventName: 'pull_request',
    payload: { pull_request: { number: 1, base: { ref: 'dev' }, head: { sha: 'head' } } },
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
    const deployment = {
      ...env,
      DEPLOY_TARGET: target,
      EXPECTED_DEV_API:
        target === 'preview' ? env.NEXT_PUBLIC_API_URL_RENDER : 'https://dev-api.example',
      EXPECTED_DEV_SUPABASE:
        target === 'preview' ? env.NEXT_PUBLIC_SUPABASE_URL : 'https://dev-auth.example',
      EXPECTED_PRODUCTION_API:
        target === 'production' ? env.NEXT_PUBLIC_API_URL_RENDER : 'https://prod-api.example',
      EXPECTED_PRODUCTION_SUPABASE:
        target === 'production' ? env.NEXT_PUBLIC_SUPABASE_URL : 'https://prod-auth.example',
    };
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
      for (const overrides of [
        { EXPECTED_PRODUCTION_API: '' },
        { EXPECTED_PRODUCTION_SUPABASE: '' },
        { EXPECTED_PRODUCTION_API: deployment.EXPECTED_DEV_API },
        { EXPECTED_PRODUCTION_SUPABASE: deployment.EXPECTED_DEV_SUPABASE },
        { EXPECTED_PRODUCTION_API: 'https://127.0.0.1' },
      ])
        assert.throws(() => prepareVercel(root, { ...deployment, ...overrides }));
      for (const checkpointOptions of [
        { CHECKPOINT_AZURE_URL: deployment.EXPECTED_PRODUCTION_API },
        { CHECKPOINT_RENDER_URL: deployment.EXPECTED_PRODUCTION_API },
      ])
        assert.throws(
          () => prepareVercel(root, { ...checkpoint, ...checkpointOptions }),
          /Production/,
        );
      for (const name of ['NEXT_PUBLIC_API_URL_RENDER', 'NEXT_PUBLIC_SUPABASE_URL']) {
        const value =
          name === 'NEXT_PUBLIC_API_URL_RENDER'
            ? deployment.EXPECTED_PRODUCTION_API
            : deployment.EXPECTED_PRODUCTION_SUPABASE;
        write(`.vercel/${filename}`, pulled.replace(env[name], value));
        assert.throws(() => prepareVercel(root, deployment), /Production/);
        if (name === 'NEXT_PUBLIC_SUPABASE_URL')
          assert.throws(() => prepareVercel(root, checkpoint), /Production|Dev/);
      }
      write(`.vercel/${filename}`, pulled);
      assert.throws(
        () => prepareVercel(root, { ...deployment, EXPECTED_DEV_API: '' }),
        /Faltan los origenes Dev/,
      );
      assert.throws(
        () =>
          prepareVercel(root, { ...deployment, EXPECTED_DEV_API: 'https://production.example' }),
        /origenes Render y Supabase de Dev/,
      );
      assert.throws(
        () =>
          prepareVercel(root, {
            ...deployment,
            EXPECTED_DEV_SUPABASE: 'https://production.example',
          }),
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
      for (const [overrides, error] of [
        [{ EXPECTED_PRODUCTION_API: '' }, /Faltan los origenes Production/],
        [{ EXPECTED_PRODUCTION_SUPABASE: '' }, /Faltan los origenes Production/],
        [{ EXPECTED_PRODUCTION_API: 'https://other-api.example' }, /Production requiere/],
        [{ EXPECTED_PRODUCTION_SUPABASE: 'https://other-auth.example' }, /Production requiere/],
        [{ EXPECTED_DEV_API: deployment.EXPECTED_PRODUCTION_API }, /Production no puede usar/],
        [
          { EXPECTED_DEV_SUPABASE: deployment.EXPECTED_PRODUCTION_SUPABASE },
          /Production no puede usar/,
        ],
      ]) {
        assert.throws(() => prepareVercel(root, { ...deployment, ...overrides }), error);
      }
      for (const name of ['NEXT_PUBLIC_API_URL_RENDER', 'NEXT_PUBLIC_SUPABASE_URL']) {
        write(
          `.vercel/${filename}`,
          pulled
            .split('\n')
            .filter((line) => !line.startsWith(`${name}=`))
            .join('\n'),
        );
        assert.throws(() => prepareVercel(root, deployment), new RegExp(name));
      }
      for (const [name, devOrigin] of [
        ['NEXT_PUBLIC_API_URL_RENDER', deployment.EXPECTED_DEV_API],
        ['NEXT_PUBLIC_SUPABASE_URL', deployment.EXPECTED_DEV_SUPABASE],
      ]) {
        write(`.vercel/${filename}`, pulled.replace(env[name], devOrigin));
        assert.throws(() => prepareVercel(root, deployment), /Production no puede usar/);
      }
    }
    write('.vercel/project.json', { ...project, projectId: 'wrong' });
    assert.throws(() => prepareVercel(root, deployment), /Proyecto/);
  });

test('Production sólo promueve con backend operativo, sin redirecciones y del SHA candidato', async () => {
  const sha = 'a'.repeat(40);
  const config = {
    DEPLOY_TARGET: 'production',
    EXPECTED_DEV_API: 'https://dev.example',
    EXPECTED_DEV_SUPABASE: 'https://dev-auth.example',
    EXPECTED_PRODUCTION_API: 'https://prod.example',
    EXPECTED_PRODUCTION_SUPABASE: 'https://prod-auth.example',
  };
  const success = async (url, options) => {
    assert.equal(url.origin, config.EXPECTED_PRODUCTION_API);
    assert.equal(options.redirect, 'error');
    return Response.json(
      url.pathname === '/health'
        ? { status: 'ok', service: 'turnosmart-backend', version: sha }
        : { status: 'ready' },
    );
  };
  await verifyProductionBackend(config, sha, success);
  for (const response of [
    { status: 'ok', service: 'turnosmart-backend', version: 'b'.repeat(40) },
    { status: 'ok', service: 'other', version: sha },
    {},
  ])
    await assert.rejects(
      verifyProductionBackend(config, sha, async () => Response.json(response)),
      /SHA candidato/,
    );
  for (const status of [301, 401, 404, 500, 503])
    await assert.rejects(
      verifyProductionBackend(config, sha, async () => new Response(null, { status })),
      /no operativo/,
    );
  await assert.rejects(
    verifyProductionBackend(config, sha, async () => {
      throw new Error('secret diagnostic');
    }),
    (error) => !error.message.includes('secret diagnostic'),
  );
  await assert.rejects(
    verifyProductionBackend(config, sha, async () => new Response('not JSON')),
    /no operativo/,
  );
  await assert.rejects(
    verifyProductionBackend(config, sha, (url, opts) =>
      url.pathname === '/ready' ? Response.json({ status: 'unavailable' }) : success(url, opts),
    ),
    /no preparado/,
  );
  await assert.rejects(
    verifyProductionBackend(config, sha, (url, opts) =>
      url.pathname === '/ready' ? new Response(null, { status: 503 }) : success(url, opts),
    ),
    /no operativo/,
  );
  await assert.rejects(verifyProductionBackend(config, 'dev', success), /SHA candidato/);
  await assert.rejects(
    verifyProductionBackend({ ...config, DEPLOY_TARGET: 'preview' }, sha, success),
    /requiere Production/,
  );
  const workflow = yaml.load(
    readFileSync(join(repo, '.github/workflows/frontend-deploy.yml'), 'utf8'),
  );
  const steps = workflow.jobs.deploy.steps;
  const check = steps.find((s) => s.name === 'Verify Production backend before promotion');
  assert.equal(check.if, "env.DEPLOY_TARGET == 'production'");
  assert.equal(check.env.EXPECTED_PRODUCTION_API, '${{ vars.EXPECTED_PRODUCTION_API }}');
  assert.equal(
    workflow.jobs.deploy.environment.name,
    "vercel-${{ inputs.target == 'azure' && 'preview' || 'production' }}",
  );
  assert(
    steps.indexOf(check) <
      steps.findIndex((s) => s.name === 'Check current Production branch before promotion'),
  );
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

test('Dev requires a successful Quality job for the current dev SHA and exact CI attempt', async () => {
  const sha = 'a'.repeat(40);
  const run = {
    id: 10,
    run_attempt: 2,
    event: 'push',
    conclusion: 'success',
    head_branch: 'dev',
    head_repository: { full_name: 'owner/repo' },
    path: '.github/workflows/ci.yml',
    head_sha: sha,
  };
  const context = {
    repo: { owner: 'owner', repo: 'repo' },
    sha: 'publisher',
    payload: { workflow_run: run },
  };
  let head = sha;
  let conclusion = 'success';
  const github = {
    rest: {
      git: {
        getRef: async ({ ref }) => {
          assert.equal(ref, 'heads/dev');
          return { data: { object: { sha: head } } };
        },
      },
      actions: { listJobsForWorkflowRunAttempt: () => {} },
    },
    paginate: async (method, { run_id, attempt_number }) => {
      assert.equal(method, github.rest.actions.listJobsForWorkflowRunAttempt);
      assert.equal(run_id, 10);
      assert.equal(attempt_number, 2);
      return [{ name: 'Quality Checks', conclusion }];
    },
  };
  const preview = await selectDevPreview(github, context);
  assert.equal(preview.sha, sha);
  assert.equal(preview.ref, 'refs/heads/dev');
  await assertCurrentRevision(github, preview);
  for (const override of [
    { head_branch: 'main' },
    { event: 'pull_request' },
    { conclusion: 'failure' },
    { path: '.github/workflows/other.yml' },
    { head_repository: { full_name: 'fork/repo' } },
  ]) {
    assert.equal(
      await selectDevPreview(github, {
        ...context,
        payload: { workflow_run: { ...run, ...override } },
      }),
      null,
    );
  }
  conclusion = 'skipped';
  assert.equal(await selectDevPreview(github, context), null);
  conclusion = 'success';
  head = 'b'.repeat(40);
  assert.equal(await selectDevPreview(github, context), null);
  await assert.rejects(assertCurrentRevision(github, preview), /obsoleto/);
});

test('Dev alias deduplicates the current SHA and rejects a Production collision', async () => {
  const context = {
    eventName: 'push',
    ref: 'refs/heads/dev',
    sha: 'revision',
    payload: { repository: { id: 42, full_name: 'owner/repo' } },
  };
  const env = { DEPLOY_TARGET: 'preview', VERCEL_PROJECT_ID: 'prj_demo', VERCEL_TOKEN: 'fake' };
  const github = {
    rest: { git: { getRef: async () => ({ data: { object: { sha: context.sha } } }) } },
  };
  const alias = 'turnosmart-dev-42.vercel.app';
  const candidate = {
    id: 'dpl_demo',
    url: 'immutable.vercel.app',
    projectId: 'prj_demo',
    target: 'preview',
    readyState: 'READY',
    meta: { turnosmartDevRepository: '42', turnosmartMergeSha: context.sha },
  };
  let existing = true;
  let writes = 0;
  const request = async (url, options) => {
    if (options.method === 'POST') {
      writes++;
      assert.deepEqual(JSON.parse(options.body), { alias });
      return Response.json({ alias });
    }
    if (url.pathname === `/v4/aliases/${alias}`)
      return existing
        ? Response.json({ alias, deploymentId: candidate.id, projectId: 'prj_demo' })
        : new Response(null, { status: 404 });
    if (url.pathname.includes('/domains/')) return new Response(null, { status: 404 });
    assert.match(url.pathname, /^\/v13\/deployments\/(dpl_demo|immutable\.vercel\.app)$/);
    return Response.json(candidate);
  };
  assert.equal(await assignPreviewAlias(github, context, env, request), `https://${alias}`);
  assert.equal(writes, 0);
  candidate.meta.turnosmartMergeSha = 'old';
  assert.equal(await assignPreviewAlias(github, context, env, request), null);
  candidate.target = 'production';
  await assert.rejects(assignPreviewAlias(github, context, env, request), /Preview de dev/);
  existing = false;
  candidate.target = 'preview';
  candidate.meta.turnosmartMergeSha = context.sha;
  await assignPreviewAlias(
    github,
    context,
    { ...env, DEPLOYMENT_URL: 'https://immutable.vercel.app' },
    request,
  );
  assert.equal(writes, 1);
});

test('prebuilt Preview must be portable even when dependencies exist on the build runner', (t) => {
  const { root, write } = fixture(t);
  const config = '.vercel/output/functions/index.func/.vc-config.json';
  write('.vercel/output/config.json', { version: 3 });
  write('node_modules/client-only/index.js', '');
  write(config, {
    filePathMap: { 'node_modules/client-only/index.js': 'node_modules/client-only/index.js' },
  });
  assert.throws(() => verifyStandaloneOutput(root), /index.func.*1 referencias filePathMap/);
  write(config, { handler: 'index.js', runtime: 'nodejs22.x' });
  assert.throws(() => verifyStandaloneOutput(root), /Falta el archivo de entrada prebuilt/);
  write('.vercel/output/functions/index.func/index.js', '');
  write('.vercel/output/functions/index.func/node_modules/client-only/index.js', '');
  rmSync(join(root, 'node_modules'), { recursive: true });
  verifyStandaloneOutput(root);
});
