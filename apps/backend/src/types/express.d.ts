import type { AuthContext } from '@turnosmart/shared';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      /** Usuario de Supabase Auth con token válido. */
      user?: { id: string; email: string | null };
      /** Contexto de negocio resuelto desde Profile. */
      auth?: AuthContext;
    }
  }
}

export {};
