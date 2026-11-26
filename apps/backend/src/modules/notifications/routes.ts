import { notificationsQuerySchema } from '@turnosmart/shared';
import { Router } from 'express';
import { z } from 'zod';
import { parse, parseId } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import type { PrismaNotificationRepository } from './repository.js';

const visibilityQuery = z.object({ includeRequests: z.stringbool().default(false) });

export function notificationsRouter(repository: PrismaNotificationRepository): Router {
  const router = Router();
  router.use(requirePermission('appointments:read'));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/', async (req, res) => {
    res.json(await repository.list(req.auth!, parse(notificationsQuerySchema, req.query)));
  });
  router.post('/sync-upcoming', async (req, res) => {
    res.json({ items: await repository.syncUpcoming(req.auth!) });
  });
  router.patch('/read-all', async (req, res) => {
    const { includeRequests } = parse(visibilityQuery, req.query);
    await repository.markAllRead(req.auth!, includeRequests);
    res.status(204).end();
  });
  router.patch('/:id/read', async (req, res) => {
    const { includeRequests } = parse(visibilityQuery, req.query);
    res.json(
      await repository.markRead(req.auth!, parseId(req.params.id, 'Notificación'), includeRequests),
    );
  });
  return router;
}
