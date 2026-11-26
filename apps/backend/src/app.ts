import cors from 'cors';
import { timingSafeEqual } from 'node:crypto';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { authenticate, requireProfile, type TokenVerifier } from './middleware/auth.js';
import { errorHandler, notFoundHandler, requestId } from './middleware/common.js';
import type { IdentityRepository } from './modules/identity/repository.js';
import { identityRouter } from './modules/identity/routes.js';
import type { CustomerRepository } from './modules/customers/repository.js';
import { customersRouter } from './modules/customers/routes.js';
import type { EventRepository } from './modules/events/repository.js';
import { eventsRouter } from './modules/events/routes.js';
import type { RiskRepository } from './modules/ai/risk-repository.js';
import type { RiskExplainer } from './modules/ai/risk-explainer.js';
import { FixedWindowRateLimiter } from './modules/ai/rate-limiter.js';
import { aiRouter } from './modules/ai/routes.js';
import type { ServiceRepository } from './modules/services/repository.js';
import { servicesRouter } from './modules/services/routes.js';
import type { AvailabilityRepository } from './modules/availability/repository.js';
import { availabilityRouter } from './modules/availability/routes.js';
import { slotsRouter } from './modules/slots/routes.js';
import type { SlotsRepository } from './modules/slots/repository.js';
import type { AppointmentRepository } from './modules/appointments/repository.js';
import { appointmentsRouter } from './modules/appointments/routes.js';
import type { AppointmentActionLinks } from './modules/appointments/action-links.js';
import { publicAppointmentActionsRouter } from './modules/appointments/public-routes.js';
import type { PrismaNotificationRepository } from './modules/notifications/repository.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { getMetrics } from './lib/metrics.js';

export interface AppDeps {
  corsOrigins: string[];
  corsPreviewOrigin?: ((origin: string) => Promise<boolean>) | undefined;
  verifier: TokenVerifier;
  identity: IdentityRepository;
  customers: CustomerRepository;
  services: ServiceRepository;
  availability: AvailabilityRepository;
  slots: SlotsRepository;
  appointments: AppointmentRepository;
  appointmentActionLinks?: AppointmentActionLinks;
  events: EventRepository;
  notifications?: PrismaNotificationRepository;
  emailCron?: { secret: string; run: () => void };
  requestEmailProcessing?: () => void;
  risk: RiskRepository;
  /** null si GEMINI_API_KEY no está configurada: la explicación responde 503. */
  explainer: RiskExplainer | null;
  aiRateLimit: { limit: number; windowMs: number };
  /** Comprobación de dependencias para /ready (p. ej. SELECT 1). */
  checkReady: () => Promise<boolean>;
}

/** Construye la app sin escuchar puertos, para poder probarla con supertest. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // Requests sin Origin (curl, smoke tests, server-to-server) no son de navegador.
        if (!origin || deps.corsOrigins.includes(origin)) return cb(null, true);
        const reject = () => cb(new Error('CORS_NOT_ALLOWED'));
        if (!deps.corsPreviewOrigin) return reject();
        void deps.corsPreviewOrigin(origin).then((allowed) => {
          if (allowed) cb(null, true);
          else reject();
        }, reject);
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  if (deps.requestEmailProcessing) {
    const requestProcessing = deps.requestEmailProcessing;
    app.use((req, res, next) => {
      const appointmentWrite =
        req.method === 'POST' &&
        (req.path === '/api/appointments' ||
          req.path.startsWith('/api/appointments/') ||
          req.path === '/api/public/appointment-actions');
      const preferenceWrite =
        req.method === 'PATCH' && req.path === '/api/business/notification-preferences';
      if (appointmentWrite || preferenceWrite) {
        res.once('finish', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) requestProcessing();
        });
      }
      next();
    });
  }

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'turnosmart-backend',
      version: process.env.RENDER_GIT_COMMIT ?? process.env.RELEASE_SHA ?? 'dev',
    });
  });

  app.get('/ready', async (_req, res) => {
    const ok = await deps.checkReady().catch(() => false);
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'unavailable' });
  });

  app.get('/metrics', (_req, res) => {
    res.json(getMetrics());
  });

  const emailCron = deps.emailCron;
  if (emailCron) {
    const expected = Buffer.from(`Bearer ${emailCron.secret}`);
    app.post('/internal/email-jobs', (req, res) => {
      const supplied = Buffer.from(req.header('authorization') ?? '');
      res.set('Cache-Control', 'no-store');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        res.sendStatus(401);
        return;
      }
      emailCron.run();
      res.sendStatus(202);
    });
  }

  const authed = [authenticate(deps.verifier), requireProfile(deps.identity)];
  const limiter = new FixedWindowRateLimiter(deps.aiRateLimit.limit, deps.aiRateLimit.windowMs);

  app.use('/api', identityRouter(deps));
  if (deps.appointmentActionLinks) {
    app.use(
      '/api/public/appointment-actions',
      publicAppointmentActionsRouter(deps.appointmentActionLinks),
    );
  }
  app.use('/api/customers', ...authed, customersRouter(deps));
  app.use('/api/services', ...authed, servicesRouter(deps));
  app.use('/api/availability-rules', ...authed, availabilityRouter(deps));
  app.use('/api/slots', ...authed, slotsRouter(deps));
  if (deps.notifications)
    app.use('/api/notifications', ...authed, notificationsRouter(deps.notifications));
  app.use(
    '/api/appointments',
    ...authed,
    appointmentsRouter({
      appointments: deps.appointments,
      actionLinks: deps.appointmentActionLinks,
      risk: deps.risk,
    }),
  );
  app.use('/api/appointments', ...authed, eventsRouter(deps));
  app.use(
    '/api/appointments',
    ...authed,
    aiRouter({ risk: deps.risk, explainer: deps.explainer, limiter }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
