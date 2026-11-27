/**
 * Métricas en memoria de la instancia (se reinician con cada despliegue). Sólo contadores
 * técnicos: nunca identificadores de negocio, clientes ni contenido de requests.
 */
type AiOutcome =
  'ok' | 'timeout' | 'quota' | 'unavailable' | 'invalid' | 'circuit_open' | 'global_limit';

type MetricSnapshot = {
  startedAt: string;
  uptimeSeconds: number;
  requests: number;
  errors: number;
  durationMsTotal: number;
  /** Requests que superaron SLOW_REQUEST_MS. */
  slowRequests: number;
  byStatus: Record<string, number>;
  ai: { calls: number; durationMsTotal: number; byOutcome: Partial<Record<AiOutcome, number>> };
  dependencies: { readyFailures: number; lastReadyFailureAt: string | null };
};

export const SLOW_REQUEST_MS = 2000;
const started = new Date();

const snapshot = {
  requests: 0,
  errors: 0,
  durationMsTotal: 0,
  slowRequests: 0,
  byStatus: {} as Record<string, number>,
  ai: { calls: 0, durationMsTotal: 0, byOutcome: {} as Partial<Record<AiOutcome, number>> },
  dependencies: { readyFailures: 0, lastReadyFailureAt: null as string | null },
};

export function recordHttpRequest(status: number, durationMs: number) {
  snapshot.requests += 1;
  snapshot.durationMsTotal += durationMs;
  if (durationMs >= SLOW_REQUEST_MS) snapshot.slowRequests += 1;
  const key = String(status);
  snapshot.byStatus[key] = (snapshot.byStatus[key] ?? 0) + 1;
  if (status >= 500) snapshot.errors += 1;
}

/** Resultado de una explicación de IA. `durationMs` sólo cuando hubo llamada al proveedor. */
export function recordAiCall(outcome: AiOutcome, durationMs?: number) {
  if (durationMs !== undefined) {
    snapshot.ai.calls += 1;
    snapshot.ai.durationMsTotal += durationMs;
  }
  snapshot.ai.byOutcome[outcome] = (snapshot.ai.byOutcome[outcome] ?? 0) + 1;
}

export function recordReadyFailure(at = new Date()) {
  snapshot.dependencies.readyFailures += 1;
  snapshot.dependencies.lastReadyFailureAt = at.toISOString();
}

export function getMetrics(now = new Date()): MetricSnapshot {
  return {
    startedAt: started.toISOString(),
    uptimeSeconds: Math.round((now.getTime() - started.getTime()) / 1000),
    requests: snapshot.requests,
    errors: snapshot.errors,
    durationMsTotal: snapshot.durationMsTotal,
    slowRequests: snapshot.slowRequests,
    byStatus: { ...snapshot.byStatus },
    ai: {
      calls: snapshot.ai.calls,
      durationMsTotal: snapshot.ai.durationMsTotal,
      byOutcome: { ...snapshot.ai.byOutcome },
    },
    dependencies: { ...snapshot.dependencies },
  };
}
