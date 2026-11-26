type Level = 'info' | 'warn' | 'error';

/** Campos que nunca se escriben aunque un llamador los pase por error. */
const SENSITIVE =
  /token|password|secret|authorization|cookie|api[-_]?key|prompt|email|phone|notes/i;

/** Campos fijos de cada línea (servicio y SHA) para correlacionar con el despliegue. */
let base: Record<string, unknown> = { service: 'turnosmart-backend' };

export function setLogContext(fields: Record<string, unknown>) {
  base = { ...base, ...fields };
}

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, SENSITIVE.test(key) ? '[redacted]' : value]),
  );
}

/**
 * Logs JSON a consola. No registrar tokens, contraseñas, URLs con credenciales, prompts
 * ni datos de clientes: sólo identificadores técnicos (requestId) y metadatos.
 */
function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === 'test' && level !== 'error') return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...base,
    ...redact(fields),
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};
