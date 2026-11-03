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
  prepareVercel,
  selectPreview,
  verifyOutput,
  verifyPublished,
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

test('Production manual y Render quedan limitados a dev y sus dependencias', () => {
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
    'pull --yes',
    'deploy-config.mjs prepare',
    'build "${flags[@]}" --output .vercel/output',
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
  assert.deepEqual(Object.keys(preview.jobs), ['select', 'settings', 'build', 'deploy']);
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
      undefined,
      'Scripts con secretos salen de la rama confiable',
    );
  }
  for (const job of [select, settings, build, deploy])
    assert.equal(checkout(job).with['persist-credentials'], false);
  for (const job of [settings, deploy]) assert.equal(job.environment, 'vercel-preview');
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
  const upload = deploy.steps.find((step) => step.id === 'upload');
  assert(upload.run.includes('turnosmartPullRequest=$GITHUB_REPOSITORY_ID-$PR_NUMBER'));
  assert(upload.run.includes('turnosmartMergeSha=$PR_SHA'));
  const names = deploy.steps.map((step) => step.name ?? step.id);
  assert(names.indexOf('Check current revision') < names.indexOf('Upload prebuilt'));
  assert(names.indexOf('Upload prebuilt') < names.indexOf('Update verified PR alias'));
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
      EXPECTED_PRODUCTION_API: env.NEXT_PUBLIC_API_URL_RENDER,
      EXPECTED_PRODUCTION_SUPABASE: env.NEXT_PUBLIC_SUPABASE_URL,
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
