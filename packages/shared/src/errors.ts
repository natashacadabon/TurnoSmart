/**
 * Contrato de errores (A01). Todas las respuestas de error de la API tienen esta forma.
 * 401 sin autenticación, 403 sin permiso, 404 recurso ajeno o inexistente,
 * 409 conflicto, 422 entrada inválida.
 */
export const ERROR_CODES = {
  UNAUTHENTICATED: 401,
  TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  PROFILE_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVICE_NAME_CONFLICT: 409,
  CUSTOMER_HAS_APPOINTMENTS: 409,
  ALREADY_ONBOARDED: 409,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  AI_RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
  AI_INVALID_RESPONSE: 502,
  RISK_NOT_AVAILABLE: 404,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ValidationIssue[];
    requestId?: string;
  };
}
