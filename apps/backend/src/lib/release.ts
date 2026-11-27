/** Versión desplegada, para correlacionar logs, /health y la evidencia de cada entrega. */
export interface ReleaseInfo {
  /** SHA de Git del build o "dev" si no se informó. */
  sha: string;
  /** Variable de la que salió el SHA. */
  source: 'RELEASE_SHA' | 'RENDER_GIT_COMMIT' | 'GITHUB_SHA' | 'none';
}

const SHA = /^[0-9a-f]{7,40}$/;

export function releaseInfo(
  source: NodeJS.ProcessEnv = process.env,
  explicit?: string,
): ReleaseInfo {
  const candidates = [
    // El SHA que informa el proveedor es el del código realmente desplegado.
    ['RENDER_GIT_COMMIT', source.RENDER_GIT_COMMIT],
    ['RELEASE_SHA', explicit ?? source.RELEASE_SHA],
    ['GITHUB_SHA', source.GITHUB_SHA],
  ] as const;
  for (const [name, value] of candidates) {
    const sha = value?.trim().toLowerCase();
    if (sha && SHA.test(sha)) return { sha, source: name };
  }
  return { sha: 'dev', source: 'none' };
}
