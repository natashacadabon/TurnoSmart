/**
 * Límite de solicitudes por usuario en ventana fija, en memoria.
 * Suficiente para una instancia única (F1/B1); con varias réplicas habría que moverlo a la DB.
 */
export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();
  private nextCleanup = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = Infinity,
  ) {}

  tryConsume(key: string): boolean {
    const t = this.now();
    if (t >= this.nextCleanup) {
      for (const [id, hit] of this.hits) {
        if (t - hit.windowStart >= this.windowMs) this.hits.delete(id);
      }
      this.nextCleanup = t + this.windowMs;
    }
    const entry = this.hits.get(key);
    if (!entry || t - entry.windowStart >= this.windowMs) {
      if (!entry && this.hits.size >= this.maxKeys) return false;
      this.hits.set(key, { windowStart: t, count: 1 });
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count += 1;
    return true;
  }
}
