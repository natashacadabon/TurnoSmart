const vercelHost = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/;
const prAlias = /^turnosmart-pr-([1-9]\d*)-([1-9]\d*)\.vercel\.app$/;
const cacheSize = 100;
const maxAliasRequests = 8;

interface PreviewConfig {
  projectId: string;
  token: string;
  teamId?: string | undefined;
  repositoryId?: string | undefined;
}

interface Deployment {
  id?: string;
  projectId?: string;
  url?: string;
  state?: string;
  readyState?: string;
  target?: string | null;
  customEnvironment?: unknown;
  meta?: Record<string, string>;
}

export function vercelPreviewCors(config: PreviewConfig, request = fetch) {
  async function get<T>(path: string, signal: AbortSignal, params = {}) {
    const url = new URL(path, 'https://api.vercel.com');
    url.search = new URLSearchParams(params).toString();
    if (config.teamId) url.searchParams.set('teamId', config.teamId);
    const res = await request(url, {
      headers: { Authorization: `Bearer ${config.token}` },
      redirect: 'error',
      signal,
    });
    if (!res.ok) throw new Error('Vercel lookup failed');
    return (await res.json()) as T;
  }

  function isPreview(deployment: Deployment, state: string | undefined) {
    return (
      deployment.projectId === config.projectId &&
      state === 'READY' &&
      (deployment.target == null || deployment.target === 'preview') &&
      !deployment.customEnvironment
    );
  }

  let hosts = new Set<string>();
  let listExpiresAt = 0;
  let listPending: Promise<void> | undefined;
  async function refreshDeployments() {
    try {
      const { deployments } = await get<{ deployments: Deployment[] }>(
        '/v7/deployments',
        AbortSignal.timeout(3000),
        { projectId: config.projectId, state: 'READY', limit: '100' },
      );
      hosts = new Set(
        deployments.flatMap((entry) =>
          isPreview(entry, entry.state) && entry.url && vercelHost.test(entry.url)
            ? [entry.url]
            : [],
        ),
      );
      listExpiresAt = Date.now() + 60_000;
    } catch {
      hosts.clear();
      listExpiresAt = Date.now() + 15_000;
    }
  }

  const aliases = new Map<string, { allowed: boolean; expiresAt: number }>();
  const pendingAliases = new Map<string, Promise<boolean>>();
  async function verifyAlias(host: string, identity: string) {
    try {
      const signal = AbortSignal.timeout(3000);
      const alias = await get<{
        alias?: string;
        projectId?: string;
        deploymentId?: string;
        redirect?: string | null;
        deletedAt?: number | null;
      }>(`/v4/aliases/${host}`, signal);
      if (
        alias.alias !== host ||
        alias.projectId !== config.projectId ||
        alias.redirect ||
        alias.deletedAt ||
        !alias.deploymentId ||
        !/^dpl_[a-zA-Z0-9]+$/.test(alias.deploymentId)
      )
        return false;
      const deployment = await get<Deployment>(`/v13/deployments/${alias.deploymentId}`, signal);
      return (
        deployment.id === alias.deploymentId &&
        isPreview(deployment, deployment.readyState) &&
        deployment.meta?.turnosmartPullRequest === identity
      );
    } catch {
      return false;
    }
  }

  return async (origin: string) => {
    const host = origin.slice('https://'.length);
    if (!origin.startsWith('https://') || !vercelHost.test(host)) return false;
    if (host.startsWith('turnosmart-pr-')) {
      const match = prAlias.exec(host);
      if (!match || match[1] !== config.repositoryId || !Number.isSafeInteger(Number(match[2]))) {
        return false;
      }
      const cached = aliases.get(host);
      if (cached && cached.expiresAt > Date.now()) return cached.allowed;
      const pending = pendingAliases.get(host);
      if (pending) return pending;
      if (pendingAliases.size >= maxAliasRequests) return false;
      const lookup = verifyAlias(host, `${match[1]}-${match[2]}`).then((allowed) => {
        pendingAliases.delete(host);
        aliases.delete(host);
        if (aliases.size >= cacheSize) {
          const oldest = aliases.keys().next();
          if (!oldest.done) aliases.delete(oldest.value);
        }
        aliases.set(host, { allowed, expiresAt: Date.now() + (allowed ? 60_000 : 15_000) });
        return allowed;
      });
      pendingAliases.set(host, lookup);
      return lookup;
    }
    if (Date.now() >= listExpiresAt) {
      listPending ??= refreshDeployments().finally(() => {
        listPending = undefined;
      });
      await listPending;
    }
    return hosts.has(host);
  };
}
