import type { RequestHandler } from 'express';
import { can, type Permission } from '@turnosmart/shared';
import { AppError } from '../lib/errors.js';
import type { IdentityRepository } from '../modules/identity/repository.js';

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

/** 401 si falta el token o no es válido. No requiere perfil (sirve para /me y onboarding). */
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

/** Resuelve negocio y rol desde Profile. El negocio nunca se toma del request. */
export function requireProfile(identity: IdentityRepository): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user) throw new AppError('UNAUTHENTICATED', 'Falta el token de acceso');
    const found = await identity.findProfileWithBusiness(req.user.id);
    if (!found)
      throw new AppError('PROFILE_REQUIRED', 'La cuenta todavía no tiene negocio asociado');
    req.auth = {
      userId: req.user.id,
      email: req.user.email,
      businessId: found.business.id,
      role: found.profile.role,
    };
    next();
  };
}

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw new AppError('UNAUTHENTICATED', 'Falta el token de acceso');
    if (!can(req.auth.role, permission))
      throw new AppError('FORBIDDEN', 'No tiene permisos para esta operación');
    next();
  };
}
