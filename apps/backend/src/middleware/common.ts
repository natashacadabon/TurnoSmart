import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@turnosmart/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  const started = performance.now();
  res.on('finish', () => {
    logger.info('request', {
      requestId: req.requestId,
      method: req.method,
      path: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - started),
    });
  });
  next();
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND', 'Ruta no encontrada'));
};

/** Errores uniformes: código estable, mensaje y detalles. Nunca se expone el stack. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appError: AppError;
  if (err instanceof AppError) {
    appError = err;
  } else if (err?.type === 'entity.parse.failed') {
    appError = new AppError('VALIDATION_ERROR', 'JSON inválido');
  } else if (err?.message === 'CORS_NOT_ALLOWED') {
    appError = new AppError('FORBIDDEN', 'Origen no permitido');
  } else {
    appError = new AppError('INTERNAL_ERROR', 'Error interno');
    logger.error('unhandled_error', {
      requestId: req.requestId,
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
    });
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
      requestId: req.requestId,
    },
  };
  res.status(appError.status).json(body);
};
