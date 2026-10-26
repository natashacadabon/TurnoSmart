import { Router } from 'express';
import type { AppointmentEventDto } from '@turnosmart/shared';
import { requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../lib/errors.js';
import { parseId } from '../../lib/http.js';
import { toEventDto, type EventRepository } from './repository.js';

/** GET /api/appointments/:id/events. Montado detrás de authenticate + requireProfile. */
export function eventsRouter(deps: { events: EventRepository }): Router {
  const router = Router();

  router.get('/:id/events', requirePermission('appointments:read'), async (req, res) => {
    const id = parseId(req.params.id, 'Turno');
    const events = await deps.events.listForAppointment(req.auth!.businessId, id);
    if (!events) throw notFound('Turno');
    const body: AppointmentEventDto[] = events.map(toEventDto);
    res.json(body);
  });

  return router;
}
