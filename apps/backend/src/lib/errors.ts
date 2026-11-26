import { ERROR_CODES, type ErrorCode, type ValidationIssue } from '@turnosmart/shared';
import type { ZodError } from 'zod';

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ValidationIssue[],
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_CODES[code];
  }
}

export const notFound = (what = 'Recurso') => new AppError('NOT_FOUND', `${what} no encontrado`);

export function validationError(error: ZodError): AppError {
  return new AppError(
    'VALIDATION_ERROR',
    'Datos inválidos',
    error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}
