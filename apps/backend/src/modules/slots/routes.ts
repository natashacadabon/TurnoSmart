import { Router } from 'express';
import { slotsQuerySchema, type SlotsResponse } from '@turnosmart/shared';
import { parse } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import type { AvailabilityRepository } from '../availability/repository.js';
import type { SlotsRepository } from './repository.js';
import { SlotsService } from './service.js';

export function slotsRouter(deps: {
  slots: SlotsRepository;
  availability: AvailabilityRepository;
}): Router {
  const router = Router();
  const service = new SlotsService(deps.slots, deps.availability);
  router.get('/', requirePermission('slots:read'), async (req, res) => {
    const query = parse(slotsQuerySchema, req.query);
    const { businessId, timezone } = req.auth!;
    const response: SlotsResponse = { data: await service.list(businessId, timezone, query) };
    res.json(response);
  });
  return router;
}
