import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import { cleanupPreview } from './preview-cleanup.mjs';

const alias = 'turnosmart-pr-42-23.vercel.app';

function fixture(merged) {
  const context = {
    eventName: 'pull_request_target',
    repo: { owner: 'owner', repo: 'repo' },
    payload: {
      action: 'closed',
      repository: { id: 42, full_name: 'owner/repo' },
      pull_request: {
        number: 23,
        merged,
        head: { repo: { full_name: 'owner/repo' } },
        user: { login: 'contributor' },
      },
    },
  };
  const env = { VERCEL_PROJECT_ID: 'prj_demo', VERCEL_ORG_ID: 'team_demo', VERCEL_TOKEN: 'fake' };
  const entries = new Map();
  const deletions = [];
  const add = (id, override = {}, aliases = []) =>
    entries.set(id, {
      id,
      projectId: 'prj_demo',
      target: null,
      meta: { turnosmartPullRequest: '42-23' },
      aliases,
      ...override,
    });
  add('dpl_current', {}, [{ alias, uid: 'aliasCurrent' }]);
  add('dpl_old');
  add('dpl_dev', { meta: { turnosmartDevRepository: '42' } });
  add('dpl_devMixed', { meta: { turnosmartPullRequest: '42-23', turnosmartDevRepository: '42' } });
  add('dpl_otherPR', { meta: { turnosmartPullRequest: '42-24' } });
  add('dpl_otherRepo', { meta: { turnosmartPullRequest: '43-23' } });
  add('dpl_otherProject', { projectId: 'prj_other' });
  add('dpl_production', { target: 'production' });
  add('dpl_custom', { target: 'preview', customEnvironment: { id: 'env_test' } });
  add('dpl_shared', {}, [{ alias: 'turnosmart-dev-42.vercel.app', uid: 'aliasDev' }]);
  add('dpl_legacy', { meta: {} });
  const state = { value: 'closed', disappearsOnDelete: false };
  const github = { rest: { pulls: { get: async () => ({ data: { state: state.value } }) } } };
  const missing = () => new Response(null, { status: 404 });
  const request = async (url, { method }) => {
    assert.equal(url.origin, 'https://api.vercel.com');
    assert.equal(url.searchParams.get('teamId'), 'team_demo');
    const path = url.pathname;
    if (method === 'DELETE') {
      deletions.push(path);
      if (path.startsWith('/v2/aliases/')) {
        entries.get('dpl_current').aliases = [];
        return Response.json({});
      }
      entries.delete(path.split('/').at(-1));
      return state.disappearsOnDelete ? missing() : Response.json({});
    }
    if (path === '/v7/deployments') {
      assert.equal(url.searchParams.get('projectId'), 'prj_demo');
      const oldPage = url.searchParams.has('until');
      return Response.json({
        deployments: [...entries.values()]
          .filter((entry) => oldPage === (entry.id === 'dpl_old'))
          .map((entry) => ({ uid: entry.id, meta: entry.meta })),
        pagination: { next: oldPage ? null : 123 },
      });
    }
    if (path.startsWith('/v4/aliases/')) {
      return entries.get('dpl_current')?.aliases.length
        ? Response.json({ alias, deploymentId: 'dpl_current', projectId: 'prj_demo' })
        : missing();
    }
    if (path.startsWith('/v9/projects/')) return missing();
    const entry = entries.get(path.split('/')[3]);
    if (!entry) return missing();
    return Response.json(path.endsWith('/aliases') ? { aliases: entry.aliases } : entry);
  };
  return {
    context,
    state,
    deletions,
    entries,
    run: () => cleanupPreview(github, context, env, request),
  };
}

for (const merged of [true, false]) {
  test(`cleans only the closed PR and its history (merged=${merged})`, async () => {
    const { run, deletions, entries } = fixture(merged);
    assert.equal(await run(), 2);
    assert.deepEqual(deletions, [
      '/v2/aliases/aliasCurrent',
      '/v13/deployments/dpl_current',
      '/v13/deployments/dpl_old',
    ]);
    assert(entries.has('dpl_dev'));
    assert(entries.has('dpl_shared'));
    assert(entries.has('dpl_production'));
    assert.equal(await run(), 0);
    assert.equal(deletions.length, 3);
  });
}

test('reopened PRs, forks and Dependabot cannot delete anything', async () => {
  const { run, context, state, deletions } = fixture(false);
  state.value = 'open';
  assert.equal(await run(), 0);
  state.value = 'closed';
  context.payload.pull_request.head.repo.full_name = 'fork/repo';
  assert.equal(await run(), 0);
  context.payload.pull_request.head.repo.full_name = 'owner/repo';
  context.payload.pull_request.user.login = 'dependabot[bot]';
  assert.equal(await run(), 0);
  assert.deepEqual(deletions, []);
});

test('a concurrent removal returning 404 is harmless', async () => {
  const { run, state } = fixture(false);
  state.disappearsOnDelete = true;
  assert.equal(await run(), 0);
});

test('cleanup and publication use the same queued PR lock and cleanup uses trusted code', () => {
  const workflow = (file) =>
    yaml.load(
      readFileSync(new URL(`../../../.github/workflows/${file}.yml`, import.meta.url), 'utf8'),
    );
  const cleanup = workflow('frontend-preview-cleanup');
  const publish = workflow('frontend-preview');
  assert.deepEqual(cleanup.on, {
    pull_request_target: { types: ['closed'], branches: ['dev', 'main'] },
  });
  const job = cleanup.jobs.cleanup;
  assert.equal(job.steps[0].with.ref, '${{ github.event.repository.default_branch }}');
  assert.equal(job.environment, 'vercel-preview');
  assert.equal(job.concurrency.queue, 'max');
  assert.equal(publish.jobs.deploy.concurrency.queue, 'max');
  assert.equal(
    job.concurrency.group.split('${{')[0],
    publish.jobs.deploy.concurrency.group.split('${{')[0],
  );
  assert.equal(publish.concurrency['cancel-in-progress'], false);
});
