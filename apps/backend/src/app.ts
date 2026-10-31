import cors from 'cors';
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

export interface AppDeps {
  corsOrigins: string[];
  verifier: TokenVerifier;
  identity: IdentityRepository;
  customers: CustomerRepository;
  services: ServiceRepository;
  events: EventRepository;
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
        cb(new Error('CORS_NOT_ALLOWED'));
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'turnosmart-backend',
      version: process.env.RELEASE_SHA ?? 'dev',
    });
  });

  app.get('/ready', async (_req, res) => {
    const ok = await deps.checkReady().catch(() => false);
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'unavailable' });
  });

  const authed = [authenticate(deps.verifier), requireProfile(deps.identity)];
  const limiter = new FixedWindowRateLimiter(deps.aiRateLimit.limit, deps.aiRateLimit.windowMs);

  app.use('/api', identityRouter(deps));
  app.use('/api/customers', ...authed, customersRouter(deps));
  app.use('/api/services', ...authed, servicesRouter(deps));
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
