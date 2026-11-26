import assert from 'node:assert/strict';

export async function cleanupPreview(github, context, env, request = fetch) {
  const { action, pull_request: pr, repository } = context.payload;
  const { owner, repo } = context.repo;
  if (
    context.eventName !== 'pull_request_target' ||
    action !== 'closed' ||
    repository?.full_name !== `${owner}/${repo}` ||
    pr?.head.repo?.full_name !== repository.full_name ||
    pr.user.login === 'dependabot[bot]'
  )
    return 0;

  assert(Number.isSafeInteger(repository.id) && repository.id > 0);
  assert(Number.isSafeInteger(pr.number) && pr.number > 0);
  const identity = `${repository.id}-${pr.number}`;
  const alias = `turnosmart-pr-${identity}.vercel.app`;
  const projectId = env.VERCEL_PROJECT_ID;
  assert(/^prj_[a-z0-9]+$/i.test(projectId) && env.VERCEL_TOKEN, 'Falta configurar Vercel');

  async function isClosed() {
    const { data } = await github.rest.pulls.get({ owner, repo, pull_number: pr.number });
    return data.state === 'closed';
  }

  async function api(path, method = 'GET', allowMissing = true) {
    const url = new URL(path, 'https://api.vercel.com');
    if (env.VERCEL_ORG_ID?.startsWith('team_')) url.searchParams.set('teamId', env.VERCEL_ORG_ID);
    const response = await request(url, {
      method,
      headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (allowMissing && (response.status === 404 || response.status === 410)) return null;
    assert(response.ok, `Vercel rechazo la limpieza (HTTP ${response.status})`);
    return method === 'DELETE' ? true : response.json();
  }

  const ownsPreview = (deployment) =>
    deployment?.projectId === projectId &&
    (deployment.target === null || deployment.target === 'preview') &&
    !deployment.customEnvironment &&
    !deployment.meta?.turnosmartDevRepository &&
    deployment.meta?.turnosmartPullRequest === identity;

  if (!(await isClosed())) return 0;

  const ids = new Set();
  const query = new URLSearchParams({ projectId, limit: '100' });
  let cursor;
  do {
    if (cursor != null) query.set('until', String(cursor));
    const page = await api(`/v7/deployments?${query}`, 'GET', false);
    for (const entry of page.deployments) {
      if (entry.meta?.turnosmartPullRequest === identity && /^dpl_[a-z0-9]+$/i.test(entry.uid))
        ids.add(entry.uid);
    }
    const next = page.pagination.next;
    assert(
      next === null ||
        (Number.isSafeInteger(next) && next > 0 && (cursor == null || next < cursor)),
      'Cursor de Vercel invalido',
    );
    cursor = next;
  } while (cursor !== null);

  // Include the stable alias even if the deployment is absent from the listing.
  const current = await api(`/v4/aliases/${alias}`);
  if (
    current?.alias === alias &&
    current.projectId === projectId &&
    !current.redirect &&
    /^dpl_[a-z0-9]+$/i.test(current.deploymentId)
  )
    ids.add(current.deploymentId);

  let deleted = 0;
  for (const id of ids) {
    const deployment = await api(`/v13/deployments/${id}`);
    if (!ownsPreview(deployment) || deployment.id !== id) continue;
    const links = await api(`/v2/deployments/${id}/aliases`);
    if (!links) continue;
    // An unexpected alias can serve dev, Production, another PR or a custom domain.
    if (links.aliases.some((link) => link.alias !== alias || link.redirect)) continue;
    if (links.aliases.length) {
      const domain = await api(`/v9/projects/${projectId}/domains/${alias}`);
      if (domain) continue;
      for (const link of links.aliases) {
        assert(/^[a-z0-9_]+$/i.test(link.uid), 'ID de alias invalido');
        if (!(await isClosed())) return deleted;
        await api(`/v2/aliases/${link.uid}`, 'DELETE');
      }
    }
    if (!(await isClosed())) return deleted;
    if (await api(`/v13/deployments/${id}`, 'DELETE')) deleted++;
  }
  return deleted;
}
