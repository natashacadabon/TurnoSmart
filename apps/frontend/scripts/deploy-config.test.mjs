import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  affectsFrontend,
  assertCurrentRevision,
  assertSuccessfulCi,
  frontendChanged,
  prepareVercel,
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

test('CD reutiliza el workflow tras Quality y Render queda limitado a dev y sus dependencias', () => {
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
  assert.equal(ci.jobs.vercel.needs, 'quality');
  assert.deepEqual(Object.keys(ci.jobs), ['quality', 'vercel']);
  assert.equal(ci.jobs.quality.name, 'Quality Checks');
  assert.equal(ci.jobs.quality.needs, undefined);
  assert.equal(ci.jobs.quality.if, undefined);
  assert.equal(ci.on.pull_request.types, undefined);
  assert.deepEqual(ci.jobs.vercel.secrets, {
    VERCEL_TOKEN: '${{ secrets.VERCEL_TOKEN }}',
    VERCEL_AUTOMATION_BYPASS: '${{ secrets.VERCEL_AUTOMATION_BYPASS }}',
  });
  assert.deepEqual(workflow.on.workflow_call.secrets, {
    VERCEL_TOKEN: { required: false },
    VERCEL_AUTOMATION_BYPASS: { required: false },
  });
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
  assert(!deploy.if.includes("github.event_name == 'push'"));
  assert(!deploy.if.includes("inputs.environment == 'production'"));
  assert(deploy.if.includes('github.event.pull_request.head.repo.full_name == github.repository'));
  assert(deploy.if.includes("github.event.pull_request.user.login != 'dependabot[bot]'"));
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

test('El alias de Preview solo se actualiza despues de verificar el bundle', () => {
  const workflow = yaml.load(
    readFileSync(join(repo, '.github/workflows/frontend-deploy.yml'), 'utf8'),
  );
  const steps = workflow.jobs.deploy.steps;
  const alias = steps.findIndex((step) => step.id === 'pr-alias');
  assert(alias > steps.findIndex((step) => step.name === 'Verify published bundle'));
  assert.equal(
    steps[alias].if,
    "github.event_name == 'pull_request' && env.DEPLOY_TARGET == 'preview'",
  );
  assert(steps.find((step) => step.id === 'upload').run.includes('turnosmartMergeSha=$GITHUB_SHA'));
});

test('El alias es estable por PR y rechaza colisiones o revisiones obsoletas', async () => {
  const alias = 'turnosmart-pr-123-23.vercel.app';
  const host = 'fixture-deployment.vercel.app';
  const context = {
    eventName: 'pull_request',
    sha: 'merge-sha',
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
    { stale: true, error: /obsoleta/ },
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
                merge_commit_sha: scenario.stale ? 'newer' : context.sha,
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

test('Caller y workflow reutilizable protegen Preview y dispatch', () => {
  const read = (name) => yaml.load(readFileSync(join(repo, '.github/workflows', name), 'utf8'));
  const ci = read('ci.yml');
  const caller = ci.jobs.vercel.if;
  const deploy = read('frontend-deploy.yml').jobs.deploy.if;
  const pr = {
    head: { repo: { full_name: 'owner/repo' } },
    user: { login: 'author' },
  };
  const github = {
    event_name: 'pull_request',
    base_ref: 'dev',
    repository: 'owner/repo',
    actor: 'maintainer',
    triggering_actor: 'other-maintainer',
    event: { pull_request: pr },
  };
  const evaluate = (expression, overrides = {}) =>
    runInNewContext(expression.trim().slice(3, -2), {
      github,
      inputs: { environment: 'preview' },
      needs: {
        quality: { result: 'success', outputs: { vercel: 'preview' } },
        preflight: { result: 'skipped' },
      },
      always: () => true,
      cancelled: () => false,
      ...overrides,
    });
  for (const condition of [caller, deploy]) {
    assert.equal(evaluate(condition), true);
    assert.equal(
      evaluate(condition, {
        github: { ...github, event: { pull_request: { ...pr, draft: true } } },
      }),
      true,
    );
    for (const pull_request of [
      { ...pr, user: { login: 'dependabot[bot]' } },
      { ...pr, head: { repo: { full_name: 'fork/repo' } } },
    ]) {
      assert.equal(evaluate(condition, { github: { ...github, event: { pull_request } } }), false);
    }
  }
  for (const result of ['failure', 'skipped', 'cancelled']) {
    assert.equal(
      evaluate(caller, { needs: { quality: { result, outputs: { vercel: 'preview' } } } }),
      false,
    );
  }
  assert.equal(evaluate(caller, { needs: { quality: { result: 'success', outputs: {} } } }), false);
  assert.equal(evaluate(caller, { cancelled: () => true }), false);
  for (const base_ref of ['dev', 'main']) {
    assert.equal(evaluate(caller, { github: { ...github, base_ref } }), true);
    assert.equal(evaluate(deploy, { github: { ...github, base_ref } }), true);
  }
  assert.equal(evaluate(deploy, { cancelled: () => true }), false);
  for (const ref of ['refs/heads/dev', 'refs/heads/main', 'refs/heads/feat/change']) {
    const push = { ...github, event_name: 'push', ref, event: {} };
    assert.equal(evaluate(caller, { github: push }), false);
    assert.equal(evaluate(deploy, { github: push }), false);
  }
  for (const result of ['success', 'failure', 'skipped', 'cancelled']) {
    assert.equal(
      evaluate(deploy, {
        github: { ...github, event_name: 'workflow_dispatch' },
        needs: { preflight: { result } },
      }),
      result === 'success',
    );
  }
});

test('Preview tiene un publicador por rama y respeta los filtros del PR', async () => {
  const ci = yaml.load(readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8'));
  const release = ci.jobs.quality.steps.find((step) => step.id === 'release').with.script;
  const run = new Function(
    'github',
    'context',
    'core',
    'process',
    'load',
    `return (async () => {${release.replaceAll('await import(', 'await load(')}})();`,
  );
  const pr = {
    number: 23,
    state: 'open',
    mergeable: true,
    user: { login: 'maintainer' },
    base: { ref: 'dev', repo: { full_name: 'owner/repo' } },
    head: { ref: 'feat/change', sha: 'head', repo: { full_name: 'owner/repo' } },
  };
  for (const [pull, devPrs, changed, expected] of [
    [pr, [], true, 'preview'],
    [{ ...pr, draft: true }, [], true, 'preview'],
    [{ ...pr, user: { login: 'dependabot[bot]' } }, [], true, undefined],
    [pr, [], false, undefined],
    [{ ...pr, base: { ...pr.base, ref: 'main' } }, [], true, 'preview'],
    [{ ...pr, base: { ...pr.base, ref: 'main' } }, [pr], true, undefined],
    [{ ...pr, base: { ...pr.base, ref: 'main' } }, [{ ...pr, mergeable: false }], true, 'preview'],
    [{ ...pr, head: { ...pr.head, repo: { full_name: 'fork/repo' } } }, [], true, undefined],
  ]) {
    const outputs = {};
    const sha = 'merge';
    await run(
      {
        rest: {
          pulls: {
            list: async () => ({ data: devPrs }),
            get: async () => ({ data: devPrs[0] }),
          },
        },
      },
      {
        repo: { owner: 'owner', repo: 'repo' },
        eventName: 'pull_request',
        payload: { pull_request: pull },
        ref: 'refs/pull/23/merge',
        sha,
      },
      { setOutput: (name, value) => (outputs[name] = value), info: () => {} },
      { env: { GITHUB_WORKSPACE: repo } },
      async (module) =>
        module === 'node:child_process'
          ? {
              execFileSync: (_git, args) => {
                assert.deepEqual(args, ['merge-base', `origin/${pull.base.ref}`, sha]);
                return 'base';
              },
            }
          : {
              frontendChanged: (base, current) => {
                assert.equal(base, 'base');
                assert.equal(current, sha);
                return changed;
              },
            },
    );
    assert.equal(outputs.target, expected);
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
          data: {
            state: 'open',
            base: { ref: 'dev' },
            head: { sha: 'head' },
            merge_commit_sha: 'new',
          },
        }),
      },
    },
  };
  const preview = {
    ...context,
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
