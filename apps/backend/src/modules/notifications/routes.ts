import { notificationsQuerySchema } from '@turnosmart/shared';
import { Router } from 'express';
import { parse, parseId } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import type { PrismaNotificationRepository } from './repository.js';

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
    await repository.markAllRead(req.auth!);
    res.status(204).end();
  });
  router.patch('/:id/read', async (req, res) => {
    res.json(await repository.markRead(req.auth!, parseId(req.params.id, 'Notificación')));
  });
  return router;
}
