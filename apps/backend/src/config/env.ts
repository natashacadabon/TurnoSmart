import { z } from 'zod';

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
  SUPABASE_ANON_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  // Gemini (A08): sin clave, la explicación de riesgo responde 503 AI_UNAVAILABLE.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  GEMINI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(2048).default(400),
  AI_RATE_LIMIT_PER_USER: z.coerce.number().int().min(1).default(10),
  AI_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(3_600_000),
});

export type Env = z.infer<typeof envSchema>;

/** Valida el entorno al arrancar. Falla rápido sin imprimir valores sensibles. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuración de entorno inválida: ${fields}`);
  }
  return result.data;
}
