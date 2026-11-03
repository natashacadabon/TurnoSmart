import assert from 'node:assert/strict';
import { assertCurrentRevision } from './deploy-config.mjs';

export async function assignPreviewAlias(github, context, env, request = fetch) {
  const pr = context.payload.pull_request;
  const repository = context.payload.repository;
  const dev = context.eventName === 'push' && context.ref === 'refs/heads/dev';
  assert(
    env.DEPLOY_TARGET === 'preview' &&
      repository?.full_name &&
      (dev ||
        (context.eventName === 'pull_request' &&
          pr?.head.repo?.full_name === repository.full_name &&
          pr.user.login !== 'dependabot[bot]')),
    'Alias permitido solo para Preview de una PR interna',
  );
  assert(Number.isSafeInteger(repository.id) && repository.id > 0);
  if (!dev) assert(Number.isSafeInteger(pr.number) && pr.number > 0);
  const identity = dev ? String(repository.id) : `${repository.id}-${pr.number}`;
  const alias = dev
    ? `turnosmart-dev-${identity}.vercel.app`
    : `turnosmart-pr-${identity}.vercel.app`;
  const identityKey = dev ? 'turnosmartDevRepository' : 'turnosmartPullRequest';
  const projectId = env.VERCEL_PROJECT_ID;
  assert(/^prj_[a-z0-9]+$/i.test(projectId) && env.VERCEL_TOKEN, 'Falta configurar Vercel');
  if (env.DEPLOYMENT_URL)
    assert(
      /^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/i.test(env.DEPLOYMENT_URL),
      'URL Preview invalida',
    );
  const host = env.DEPLOYMENT_URL && new URL(env.DEPLOYMENT_URL).hostname;
  assert(dev || host, 'URL Preview invalida');

  async function api(path, body, allowMissing = false) {
    const url = new URL(path, 'https://api.vercel.com');
    if (env.VERCEL_ORG_ID?.startsWith('team_')) url.searchParams.set('teamId', env.VERCEL_ORG_ID);
    const res = await request(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (allowMissing && res.status === 404) return null;
    assert(res.ok, `Vercel no pudo verificar o asignar el alias (HTTP ${res.status})`);
    return res.json();
  }

  function assertOwnedPreview(candidate) {
    assert(
      candidate.projectId === projectId &&
        (candidate.target == null || candidate.target === 'preview') &&
        !candidate.customEnvironment &&
        candidate.meta?.[identityKey] === identity,
      dev ? 'El deployment no es un Preview de dev' : 'El deployment no es un Preview de esta PR',
    );
  }
  const aliasPath = `/v4/aliases/${alias}`;
  const current = await api(aliasPath, undefined, true);
  if (current) {
    assert(
      current.alias === alias &&
        !current.redirect &&
        current.projectId === projectId &&
        /^dpl_[a-z0-9]+$/i.test(current.deploymentId),
      'Alias ocupado por otro proyecto o dominio',
    );
  }
  if (dev && !host) {
    if (!current) return null;
    const candidate = await api(`/v13/deployments/${current.deploymentId}`);
    assertOwnedPreview(candidate);
    await assertCurrentRevision(github, context);
    return candidate.readyState === 'READY' && candidate.meta?.turnosmartMergeSha === context.sha
      ? `https://${alias}`
      : null;
  }
  const deployment = await api(`/v13/deployments/${host}`);
  assertOwnedPreview(deployment);
  assert(
    deployment.url === host &&
      deployment.readyState === 'READY' &&
      deployment.meta?.turnosmartMergeSha === context.sha &&
      /^dpl_[a-z0-9]+$/i.test(deployment.id),
    'El Preview no corresponde al artefacto verificado',
  );
  if (current && current.deploymentId !== deployment.id) {
    assertOwnedPreview(await api(`/v13/deployments/${current.deploymentId}`));
  }
  const domain = await api(`/v9/projects/${projectId}/domains/${alias}`, undefined, true);
  assert(!domain, 'El alias coincide con un dominio configurado del proyecto');
  await assertCurrentRevision(github, context);
  if (current?.deploymentId !== deployment.id) {
    const assigned = await api(`/v2/deployments/${deployment.id}/aliases`, { alias });
    assert.equal(assigned.alias, alias, 'Vercel no confirmo el alias esperado');
  }
  return `https://${alias}`;
}
