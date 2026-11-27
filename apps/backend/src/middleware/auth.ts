import type { RequestHandler } from 'express';
import { can, type Permission, type Role } from '@turnosmart/shared';
import { AppError } from '../lib/errors.js';
import {
  resolveAccess,
  type AccountAccess,
  type IdentityRepository,
} from '../modules/identity/repository.js';

export interface VerifiedUser {
  id: string;
  email: string | null;
}

/** Valida un access token de Supabase Auth. Devuelve null si es inválido o venció. */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedUser | null>;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/** 401 si falta el token o no es válido. No requiere perfil (sirve para /me). */
export function authenticate(verifier: TokenVerifier): RequestHandler {
  return async (req, _res, next) => {
    const token = bearerToken(req.header('authorization'));
    if (!token) throw new AppError('UNAUTHENTICATED', 'Falta el token de acceso');
    const user = await verifier.verify(token);
    if (!user) throw new AppError('TOKEN_INVALID', 'Token inválido o vencido');
    req.user = user;
    next();
  };
}

function deny(access: AccountAccess, expected: Role): never {
  if (access.kind === 'NONE' && access.reason === 'DISABLED')
    throw new AppError('ACCOUNT_DISABLED', 'La cuenta está desactivada');
  if (access.kind === 'NONE')
    throw new AppError('PROFILE_REQUIRED', 'La cuenta no tiene acceso asignado');
  throw new AppError(
    'FORBIDDEN',
    expected === 'OWNER'
      ? 'El administrador de la plataforma no opera negocios'
      : 'Sólo el administrador de la plataforma puede realizar esta operación',
  );
}

/**
 * Exige un OWNER activo y resuelve su negocio desde Profile. El negocio nunca se toma del request.
 * ADMIN global → 403 FORBIDDEN; OWNER desactivado → 403 ACCOUNT_DISABLED; sin perfil → 403 PROFILE_REQUIRED.
 */
export function requireProfile(identity: IdentityRepository): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user) throw new AppError('UNAUTHENTICATED', 'Falta el token de acceso');
    const access = await resolveAccess(identity, req.user.id);
    if (access.kind !== 'OWNER') deny(access, 'OWNER');
    const { business } = access.found;
    req.auth = {
      userId: req.user.id,
      email: req.user.email,
      businessId: business.id,
      timezone: business.timezone,
      role: 'OWNER',
      platformAdmin: false,
    };
    next();
  };
}

/** Exige un ADMIN global activo. Base para el panel de administración de la plataforma. */
export function requirePlatformAdmin(identity: IdentityRepository): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user) throw new AppError('UNAUTHENTICATED', 'Falta el token de acceso');
    const access = await resolveAccess(identity, req.user.id);
    if (access.kind !== 'ADMIN') deny(access, 'ADMIN');
    req.admin = { userId: req.user.id, email: req.user.email, role: 'ADMIN' };
    next();
  };
}

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    const role = req.auth?.role ?? req.admin?.role;
    if (!role) throw new AppError('UNAUTHENTICATED', 'Falta el token de acceso');
    if (!can(role, permission))
      throw new AppError('FORBIDDEN', 'No tiene permisos para esta operación');
    next();
  };
}
