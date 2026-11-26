import type { AdminContext, AuthContext } from '@turnosmart/shared';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      /** Usuario de Supabase Auth con token válido. */
      user?: { id: string; email: string | null };
      /** Contexto de negocio de un OWNER activo, resuelto desde Profile. */
      auth?: AuthContext;
      /** Contexto de un ADMIN global activo, resuelto desde platform_admins. */
      admin?: AdminContext;
    }
  }
}

export {};
