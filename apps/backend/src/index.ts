import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { SupabaseTokenVerifier } from './lib/supabase-verifier.js';
import { GeminiLlmClient } from './modules/ai/gemini-client.js';
import { RiskExplainer } from './modules/ai/risk-explainer.js';
import { PrismaRiskRepository } from './modules/ai/risk-repository.js';
import { PrismaCustomerRepository } from './modules/customers/repository.js';
import { PrismaEventRepository } from './modules/events/repository.js';
import { PrismaIdentityRepository } from './modules/identity/repository.js';

const env = loadEnv();
const prisma = new PrismaClient();

const explainer = env.GEMINI_API_KEY
  ? new RiskExplainer(new GeminiLlmClient(env.GEMINI_API_KEY, env.GEMINI_MODEL), {
      timeoutMs: env.GEMINI_TIMEOUT_MS,
      maxOutputTokens: env.GEMINI_MAX_OUTPUT_TOKENS,
    })
  : null;

const app = createApp({
  corsOrigins: env.CORS_ORIGIN,
  verifier: new SupabaseTokenVerifier(env.SUPABASE_URL, env.SUPABASE_ANON_KEY),
  identity: new PrismaIdentityRepository(prisma),
  customers: new PrismaCustomerRepository(prisma),
  events: new PrismaEventRepository(prisma),
  risk: new PrismaRiskRepository(prisma),
  explainer,
  aiRateLimit: { limit: env.AI_RATE_LIMIT_PER_USER, windowMs: env.AI_RATE_LIMIT_WINDOW_MS },
  checkReady: async () => {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  },
});

const server = app.listen(env.PORT, '0.0.0.0', () => {
  logger.info('server_started', {
    port: env.PORT,
    ai: explainer ? env.GEMINI_MODEL : 'disabled',
  });
});

function shutdown(signal: string) {
  logger.info('server_stopping', { signal });
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
