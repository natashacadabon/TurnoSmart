import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { assertSupabaseTarget } from './config/supabase-target.js';
import { logger } from './lib/logger.js';
import { SupabaseTokenVerifier } from './lib/supabase-verifier.js';
import { vercelPreviewCors } from './lib/vercel-preview-cors.js';
import { GeminiLlmClient } from './modules/ai/gemini-client.js';
import { RiskExplainer } from './modules/ai/risk-explainer.js';
import { PrismaRiskRepository } from './modules/ai/risk-repository.js';
import { PrismaCustomerRepository } from './modules/customers/repository.js';
import { PrismaEventRepository } from './modules/events/repository.js';
import { PrismaIdentityRepository } from './modules/identity/repository.js';
import { PrismaServiceRepository } from './modules/services/repository.js';
import { PrismaAvailabilityRepository } from './modules/availability/repository.js';
import { PrismaSlotsRepository } from './modules/slots/repository.js';
import { PrismaAppointmentRepository } from './modules/appointments/repository.js';
import { AppointmentActionLinks } from './modules/appointments/action-links.js';
import { PrismaNotificationRepository } from './modules/notifications/repository.js';
import { AppointmentEmailDispatcher } from './modules/notifications/email-dispatcher.js';
import { emailProcessing } from './modules/notifications/email-processing.js';
import {
  ConsoleEmailProvider,
  ResendEmailProvider,
} from './modules/notifications/email-provider.js';

const env = loadEnv();
assertSupabaseTarget(process.env);
const prisma = new PrismaClient();
const emailDispatcher =
  env.EMAIL_PROVIDER === 'disabled'
    ? null
    : new AppointmentEmailDispatcher(
        prisma,
        env.EMAIL_PROVIDER === 'resend'
          ? new ResendEmailProvider(env.RESEND_API_KEY!)
          : new ConsoleEmailProvider(),
        {
          from: env.EMAIL_FROM!,
          actionsUrl: env.APPOINTMENT_ACTIONS_URL!,
          actionSecret: env.APPOINTMENT_ACTION_SECRET!,
        },
      );

const explainer = env.GEMINI_API_KEY
  ? new RiskExplainer(new GeminiLlmClient(env.GEMINI_API_KEY, env.GEMINI_MODEL), {
      timeoutMs: env.GEMINI_TIMEOUT_MS,
      maxOutputTokens: env.GEMINI_MAX_OUTPUT_TOKENS,
    })
  : null;

const emailProcessor = emailDispatcher ? emailProcessing(() => emailDispatcher.drain()) : null;
const processEmails = () => emailProcessor?.request();

const app = createApp({
  corsOrigins: env.CORS_ORIGIN,
  corsPreviewOrigin:
    env.CORS_ENVIRONMENT === 'dev' && env.CORS_VERCEL_PROJECT_ID && env.CORS_VERCEL_TOKEN
      ? vercelPreviewCors({
          projectId: env.CORS_VERCEL_PROJECT_ID,
          token: env.CORS_VERCEL_TOKEN,
          teamId: env.CORS_VERCEL_TEAM_ID,
          repositoryId: env.CORS_VERCEL_REPOSITORY_ID,
        })
      : undefined,
  verifier: new SupabaseTokenVerifier(env.SUPABASE_URL, env.SUPABASE_ANON_KEY),
  identity: new PrismaIdentityRepository(prisma),
  customers: new PrismaCustomerRepository(prisma),
  services: new PrismaServiceRepository(prisma),
  availability: new PrismaAvailabilityRepository(prisma),
  slots: new PrismaSlotsRepository(prisma),
  appointments: new PrismaAppointmentRepository(prisma),
  appointmentActionLinks: new AppointmentActionLinks(prisma, env.APPOINTMENT_ACTION_SECRET),
  events: new PrismaEventRepository(prisma),
  notifications: new PrismaNotificationRepository(prisma),
  ...(emailProcessor && { requestEmailProcessing: processEmails }),
  ...(emailDispatcher &&
    env.EMAIL_CRON_SECRET && {
      emailCron: { secret: env.EMAIL_CRON_SECRET, run: processEmails },
    }),
  risk: new PrismaRiskRepository(prisma),
  explainer,
  aiRateLimit: { limit: env.AI_RATE_LIMIT_PER_USER, windowMs: env.AI_RATE_LIMIT_WINDOW_MS },
  checkReady: async () => {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  },
});

const host =
  env.NODE_ENV === 'development' && process.env.TURNOSMART_LOCAL_DEV === 'true'
    ? '127.0.0.1'
    : '0.0.0.0';
const server = app.listen(env.PORT, host, () => {
  logger.info('server_started', {
    port: env.PORT,
    ai: explainer ? env.GEMINI_MODEL : 'disabled',
  });
});

const emailTimer = emailDispatcher ? setInterval(processEmails, 5_000).unref() : undefined;
processEmails();

function shutdown(signal: string) {
  logger.info('server_stopping', { signal });
  if (emailTimer) clearInterval(emailTimer);
  server.close(() => {
    void Promise.resolve(emailProcessor?.close())
      .then(() => prisma.$disconnect())
      .finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
