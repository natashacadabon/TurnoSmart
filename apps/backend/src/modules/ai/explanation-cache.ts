import type { RiskExplanationResponse } from '@turnosmart/shared';

/**
 * Explicaciones ya generadas, en memoria de la instancia. La clave incluye la fecha de cálculo del
 * score: cuando el score cambia (reserva, reprogramación, confirmación) la clave cambia y se genera
 * una explicación nueva. Así la pantalla puede pedirla sola al abrirse sin llamar a Gemini en cada
 * visita ni consumir el límite por usuario.
 */
export class ExplanationCache {
  private readonly entries = new Map<
    string,
    { value: Omit<RiskExplanationResponse, 'cached'>; at: number }
  >();

  constructor(
    private readonly maxEntries = 500,
    private readonly ttlMs = 24 * 3_600_000,
    private readonly now: () => number = Date.now,
  ) {}

  static key(businessId: string, appointmentId: string, calculatedAt: string, model: string) {
    return `${businessId}|${appointmentId}|${calculatedAt}|${model}`;
  }

  get(key: string): Omit<RiskExplanationResponse, 'cached'> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.at > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    // Reinsertar mantiene el orden de uso reciente (LRU simple con Map).
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: Omit<RiskExplanationResponse, 'cached'>) {
    this.entries.delete(key);
    this.entries.set(key, { value, at: this.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
