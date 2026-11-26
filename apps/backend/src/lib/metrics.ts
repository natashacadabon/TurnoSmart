type MetricSnapshot = {
  requests: number;
  errors: number;
  durationMsTotal: number;
  byStatus: Record<string, number>;
};

const snapshot: MetricSnapshot = {
  requests: 0,
  errors: 0,
  durationMsTotal: 0,
  byStatus: {},
};

export function recordHttpRequest(status: number, durationMs: number) {
  snapshot.requests += 1;
  snapshot.durationMsTotal += durationMs;
  const key = String(status);
  snapshot.byStatus[key] = (snapshot.byStatus[key] ?? 0) + 1;
  if (status >= 500) snapshot.errors += 1;
}

export function getMetrics(): MetricSnapshot {
  return {
    requests: snapshot.requests,
    errors: snapshot.errors,
    durationMsTotal: snapshot.durationMsTotal,
    byStatus: { ...snapshot.byStatus },
  };
}
