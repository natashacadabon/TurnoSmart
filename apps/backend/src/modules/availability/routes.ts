import { Router } from 'express';
import { z } from 'zod';
import {
  availabilityRuleInputSchema,
  replaceAvailabilityRulesSchema,
  type AvailabilityRulesResponse,
} from '@turnosmart/shared';
import { requirePermission } from '../../middleware/auth.js';
import { parse } from '../../lib/http.js';
import { AppError } from '../../lib/errors.js';
import {
  timezoneFormatter,
  toAvailabilityRuleInput,
  type AvailabilityRepository,
  type WeeklyAvailability,
} from './repository.js';

const noQuery = z.strictObject({});

function response(week: WeeklyAvailability): AvailabilityRulesResponse {
  timezoneFormatter(week.timezone);
  // Exponer las franjas representables permite corregir un solapamiento mediante el PUT validado.
  const rules = week.rules.map((row) => {
    const parsed = availabilityRuleInputSchema.safeParse(toAvailabilityRuleInput(row));
    if (!parsed.success)
      throw new AppError(
        'INTERNAL_ERROR',
        'La disponibilidad guardada contiene una franja inválida.',
      );
    return {
      id: row.id,
      ...parsed.data,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
  return { data: { timezone: week.timezone, rules } };
}

export function availabilityRouter(deps: { availability: AvailabilityRepository }): Router {
  const router = Router();
  router.get('/', requirePermission('availability:read'), async (req, res) => {
    parse(noQuery, req.query);
    res.json(response(await deps.availability.list(req.auth!.businessId)));
  });
  router.put('/', requirePermission('availability:write'), async (req, res) => {
    parse(noQuery, req.query);
    const input = parse(replaceAvailabilityRulesSchema, req.body);
    res.json(response(await deps.availability.replace(req.auth!.businessId, input.rules)));
  });
  return router;
}
