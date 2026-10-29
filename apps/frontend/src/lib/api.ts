'use client';

import type { ApiErrorBody, ErrorCode, ValidationIssue } from '@turnosmart/shared';
import { getSupabase } from './supabase';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details?: ValidationIssue[],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** Cliente HTTP común: adjunta el access token vigente y normaliza errores del contrato A01. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor');
  }

  // 204 (p. ej. DELETE) no tiene cuerpo.
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;

  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  throw new ApiError(
    res.status,
    body?.error.code ?? 'INTERNAL_ERROR',
    body?.error.message ?? `Error ${res.status}`,
    body?.error.details,
    body?.error.requestId,
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.requestId ? `${err.message} (ref. ${err.requestId.slice(0, 8)})` : err.message;
  }
  return err instanceof Error ? err.message : 'Error inesperado';
}

/** Mapea detalles de validación 422 a errores por campo de formulario. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.details) return {};
  return Object.fromEntries(err.details.map((d) => [d.path, d.message]));
}
