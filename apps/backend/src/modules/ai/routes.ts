import { Router } from 'express';
import type { RiskExplanationResponse, RiskScoreDto } from '@turnosmart/shared';
import { requirePermission } from '../../middleware/auth.js';
import { AppError, notFound } from '../../lib/errors.js';
import { parseId } from '../../lib/http.js';
import { ExplanationCache } from './explanation-cache.js';
import type { FixedWindowRateLimiter } from './rate-limiter.js';
import { DISCLAIMER, type RiskExplainer } from './risk-explainer.js';
import { sanitizeFactors, type RiskRepository } from './risk-repository.js';

/**
 * POST /api/appointments/:id/risk/explanation[?refresh=true]. Montado detrás de authenticate +
 * requireProfile. Devuelve la explicación guardada para la versión actual del score sin llamar a
 * Gemini ni consumir el límite; `refresh=true` fuerza una nueva. Si Gemini falla, el score y la
 * agenda siguen operativos: sólo esta llamada devuelve error.
 */
export function aiRouter(deps: {
  risk: RiskRepository;
  explainer: RiskExplainer | null;
  limiter: FixedWindowRateLimiter;
  cache: ExplanationCache;
}): Router {
  const router = Router();
  // Pedidos simultáneos de la misma versión del score comparten una sola llamada a Gemini
  // (p. ej. dos pestañas o el doble montaje de React en desarrollo).
  const inFlight = new Map<string, Promise<Omit<RiskExplanationResponse, 'cached'>>>();

  router.post('/:id/risk/explanation', requirePermission('risk:explain'), async (req, res) => {
    const id = parseId(req.params.id, 'Turno');
    const refresh = req.query.refresh === 'true';
    const found = await deps.risk.find(req.auth!.businessId, id);
    if (!found.appointmentExists) throw notFound('Turno');
    if (!found.risk)
      throw new AppError('RISK_NOT_AVAILABLE', 'El turno todavía no tiene score calculado');
    if (!deps.explainer)
      throw new AppError('AI_UNAVAILABLE', 'La IA no está configurada en este entorno');

    const risk: RiskScoreDto = {
      appointmentId: found.risk.appointmentId,
      score: found.risk.score,
      level: found.risk.level,
      factors: sanitizeFactors(found.risk.factors),
      calculatedAt: found.risk.calculatedAt.toISOString(),
    };
    const key = ExplanationCache.key(
      req.auth!.businessId,
      id,
      risk.calculatedAt,
      deps.explainer.model,
    );
    const saved = refresh ? null : deps.cache.get(key);
    if (saved) {
      res.json({ ...saved, cached: true } satisfies RiskExplanationResponse);
      return;
    }
    const pending = refresh ? undefined : inFlight.get(key);
    if (pending) {
      res.json({ ...(await pending), cached: true } satisfies RiskExplanationResponse);
      return;
    }
    if (!deps.limiter.tryConsume(req.auth!.userId)) {
      throw new AppError('RATE_LIMITED', 'Alcanzó el límite de explicaciones, intente más tarde');
    }

    const explainer = deps.explainer;
    const generation = explainer.explain(risk, req.requestId).then((explanation) => {
      const body = {
        risk,
        explanation,
        model: explainer.model,
        generatedAt: new Date().toISOString(),
        disclaimer: DISCLAIMER,
      };
      deps.cache.set(key, body);
      return body;
    });
    inFlight.set(key, generation);
    try {
      res.json({ ...(await generation), cached: false } satisfies RiskExplanationResponse);
    } finally {
      inFlight.delete(key);
    }
  });

  return router;
}
