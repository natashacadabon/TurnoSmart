type Level = 'info' | 'warn' | 'error';

/**
 * Logs JSON a consola. No registrar tokens, contraseñas, URLs con credenciales
 * ni notas de clientes: sólo identificadores y metadatos técnicos.
 */
function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === 'test' && level !== 'error') return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};
