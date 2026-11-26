import { Router } from 'express';
import {
  executeAppointmentActionSchema,
  previewAppointmentActionSchema,
  publicAppointmentSlotsSchema,
} from '@turnosmart/shared';
import { AppError } from '../../lib/errors.js';
import { parse } from '../../lib/http.js';
import { FixedWindowRateLimiter } from '../ai/rate-limiter.js';
import type { AppointmentActionLinks } from './action-links.js';

export function publicAppointmentActionsRouter(links: AppointmentActionLinks) {
  const router = Router();
  const byIp = new FixedWindowRateLimiter(60, 60_000, Date.now, 10_000);
  const byLink = new FixedWindowRateLimiter(30, 60_000, Date.now, 10_000);
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    if (!byIp.tryConsume(req.ip ?? 'unknown')) {
      throw new AppError('RATE_LIMITED', 'Demasiados intentos');
    }
    next();
  });
  function limitLink(token: string) {
    const reference = token.split('.', 1)[0]!;
    if (!byLink.tryConsume(reference)) throw new AppError('RATE_LIMITED', 'Demasiados intentos');
  }
  router.post('/preview', async (req, res) => {
    const { token } = parse(previewAppointmentActionSchema, req.body);
    limitLink(token);
    res.json(await links.preview(token));
  });
  router.post('/slots', async (req, res) => {
    const { token, date } = parse(publicAppointmentSlotsSchema, req.body);
    limitLink(token);
    res.json({ data: await links.slots(token, date) });
  });
  router.post('/', async (req, res) => {
    const { token, message, requestedStartsAt } = parse(executeAppointmentActionSchema, req.body);
    limitLink(token);
    await links.execute(token, message, requestedStartsAt);
    res.status(204).end();
  });
  return router;
}
