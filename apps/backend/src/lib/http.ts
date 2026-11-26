import type { ZodType } from 'zod';
import { AppError, validationError } from './errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Un id mal formado se responde como inexistente (404), sin filtrar detalles. */
export function parseId(value: unknown, what = 'Recurso'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new AppError('NOT_FOUND', `${what} no encontrado`);
  }
  return value;
}

/** Quita claves undefined de un PATCH parcial (exactOptionalPropertyTypes). */
export function omitUndefined<T extends object>(
  obj: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}
