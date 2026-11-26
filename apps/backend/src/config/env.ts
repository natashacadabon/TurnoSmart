import { z } from 'zod';

/** Una variable vacía copiada de .env.example equivale a no definirla. */
const emptyAsUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  // Orígenes permitidos para CORS, separados por coma.
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  SUPABASE_URL: z.url(),
  CORS_ENVIRONMENT: z.enum(['dev', 'production']).default('production'),
  CORS_VERCEL_PROJECT_ID: z
    .string()
    .regex(/^prj_[A-Za-z0-9]+$/)
    .optional(),
  CORS_VERCEL_TEAM_ID: z
    .string()
    .regex(/^team_[A-Za-z0-9]+$/)
    .optional(),
  CORS_VERCEL_TOKEN: z.string().trim().min(1).optional(),
  CORS_VERCEL_REPOSITORY_ID: z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine((id) => Number.isSafeInteger(Number(id)))
    .optional(),
  SUPABASE_ANON_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  APPOINTMENT_ACTION_SECRET: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .optional(),
  EMAIL_PROVIDER: z.enum(['disabled', 'console', 'resend']).default('disabled'),
  EMAIL_CRON_SECRET: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .optional(),
  EMAIL_FROM: z
    .string()
    .trim()
    .regex(/^(?:[^<>\r\n]+ <[^<>\s@]+@[^<>\s@]+>|[^<>\s@]+@[^<>\s@]+)$/)
    .optional(),
  RESEND_API_KEY: z.string().trim().min(1).optional(),
  APPOINTMENT_ACTIONS_URL: z
    .url({ protocol: /^https?$/ })
    .refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password && !url.search && !url.hash;
    })
    .optional(),
  // Gemini (A08): sin clave, la explicación de riesgo responde 503 AI_UNAVAILABLE.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  GEMINI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(2048).default(400),
  AI_RATE_LIMIT_PER_USER: z.coerce.number().int().min(1).default(10),
  AI_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(3_600_000),
  // Observabilidad (FINAL-08): /metrics exige `Authorization: Bearer <METRICS_TOKEN>`.
  // Sin token, /metrics responde 404 fuera de desarrollo y test.
  METRICS_TOKEN: emptyAsUndefined(z.string().trim().min(32).optional()),
  RELEASE_SHA: emptyAsUndefined(
    z
      .string()
      .regex(/^[0-9a-f]{7,40}$/)
      .optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

/** Valida el entorno al arrancar. Falla rápido sin imprimir valores sensibles. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuración de entorno inválida: ${fields}`);
  }
  if (
    result.data.CORS_ENVIRONMENT === 'dev' &&
    (!result.data.CORS_VERCEL_PROJECT_ID || !result.data.CORS_VERCEL_TOKEN)
  ) {
    throw new Error('Configuración de entorno inválida: CORS_VERCEL_PROJECT_ID, CORS_VERCEL_TOKEN');
  }
  const env = result.data;
  if (env.EMAIL_PROVIDER !== 'disabled') {
    const missing = [
      ...(!env.EMAIL_FROM ? ['EMAIL_FROM'] : []),
      ...(!env.APPOINTMENT_ACTION_SECRET ? ['APPOINTMENT_ACTION_SECRET'] : []),
      ...(!env.APPOINTMENT_ACTIONS_URL ? ['APPOINTMENT_ACTIONS_URL'] : []),
      ...(env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY ? ['RESEND_API_KEY'] : []),
    ];
    if (missing.length) throw new Error(`Configuración de entorno inválida: ${missing.join(', ')}`);
    if (env.EMAIL_PROVIDER === 'resend') {
      const actionsUrl = new URL(env.APPOINTMENT_ACTIONS_URL!);
      const localDevelopment =
        env.NODE_ENV !== 'production' &&
        actionsUrl.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(actionsUrl.hostname);
      if (actionsUrl.protocol !== 'https:' && !localDevelopment)
        throw new Error(
          'Configuración de entorno inválida: APPOINTMENT_ACTIONS_URL debe usar HTTPS con Resend; HTTP local solo se admite en desarrollo o test',
        );
    }
  }
  return result.data;
}
