import { Router } from 'express';
import { APPOINTMENT_EVENT_TYPES } from '@turnosmart/shared';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../lib/errors.js';
import { parse, parseId } from '../../lib/http.js';
import { toEventDto, type EventRepository } from './repository.js';

const eventsQuery = z.object({ includeRequests: z.stringbool().default(false) });
const legacyTypes = new Set<string>(APPOINTMENT_EVENT_TYPES);

/** GET /api/appointments/:id/events. Montado detrás de authenticate + requireProfile. */
export function eventsRouter(deps: { events: EventRepository }): Router {
  const router = Router();

  router.get('/:id/events', requirePermission('appointments:read'), async (req, res) => {
    const id = parseId(req.params.id, 'Turno');
    const { includeRequests } = parse(eventsQuery, req.query);
    const events = await deps.events.listForAppointment(req.auth!.businessId, id);
    if (!events) throw notFound('Turno');
    res.json(
      events.filter((event) => includeRequests || legacyTypes.has(event.type)).map(toEventDto),
    );
  });

  return router;
}
