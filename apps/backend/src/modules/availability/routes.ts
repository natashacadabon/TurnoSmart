import { Router } from 'express';
import { z } from 'zod';
import { replaceAvailabilityRulesSchema, type AvailabilityRulesResponse } from '@turnosmart/shared';
import { requirePermission } from '../../middleware/auth.js';
import { parse } from '../../lib/http.js';
import { AppError } from '../../lib/errors.js';
import {
  localTime,
  timezoneFormatter,
  type AvailabilityRepository,
  type WeeklyAvailability,
} from './repository.js';

const noQuery = z.strictObject({});

function response(week: WeeklyAvailability): AvailabilityRulesResponse {
  timezoneFormatter(week.timezone);
  const rules = week.rules.map((row) => ({
    id: row.id,
    dayOfWeek: row.dayOfWeek,
    startTime: localTime(row.startTime),
    endTime: localTime(row.endTime),
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
  if (
    !replaceAvailabilityRulesSchema.safeParse({
      rules: rules.map(({ dayOfWeek, startTime, endTime, active }) => ({
        dayOfWeek,
        startTime,
        endTime,
        active,
      })),
    }).success
  )
    throw new AppError('INTERNAL_ERROR', 'Configuracion de disponibilidad invalida');
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
