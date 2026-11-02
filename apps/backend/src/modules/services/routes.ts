import { Router } from 'express';
import { z } from 'zod';
import {
  createServiceSchema,
  updateServiceSchema,
  listServicesQuerySchema,
  type ServiceDto,
  type ServiceResponse,
  type ListServicesResponse,
} from '@turnosmart/shared';
import { requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../lib/errors.js';
import { parse, omitUndefined } from '../../lib/http.js';
import type { ServiceRecord, ServiceRepository } from './repository.js';

const noQuery = z.strictObject({});
const serviceId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'UUID invalido');

function toDto(row: ServiceRecord): ServiceDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    durationMinutes: row.durationMinutes,
    priceCents: row.priceCents,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Montado detras de authenticate + requireProfile del modulo A. */
export function servicesRouter(deps: { services: ServiceRepository }): Router {
  const router = Router();
  router.get('/', requirePermission('services:read'), async (req, res) => {
    const query = parse(listServicesQuerySchema, req.query);
    const result = await deps.services.list(req.auth!.businessId, query);
    const body: ListServicesResponse = {
      data: result.items.map(toDto),
      meta: { ...query, total: result.total },
    };
    res.json(body);
  });
  router.post('/', requirePermission('services:write'), async (req, res) => {
    parse(noQuery, req.query);
    const input = parse(createServiceSchema, req.body);
    const row = await deps.services.create(req.auth!.businessId, {
      name: input.name,
      description: input.description ?? null,
      durationMinutes: input.durationMinutes,
      priceCents: input.priceCents ?? null,
      active: input.active ?? true,
    });
    const body: ServiceResponse = { data: toDto(row) };
    res.status(201).json(body);
  });
  router.patch('/:id', requirePermission('services:write'), async (req, res) => {
    parse(noQuery, req.query);
    const id = parse(serviceId, req.params.id);
    const input = parse(updateServiceSchema, req.body);
    const row = await deps.services.update(req.auth!.businessId, id, omitUndefined(input));
    if (!row) throw notFound('Servicio');
    const body: ServiceResponse = { data: toDto(row) };
    res.json(body);
  });
  return router;
}
