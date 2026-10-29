import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TokenVerifier, VerifiedUser } from '../middleware/auth.js';

/** Verifica tokens contra Supabase Auth (cubre firma, vencimiento y usuarios eliminados). */
export class SupabaseTokenVerifier implements TokenVerifier {
  private readonly client: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  async verify(token: string): Promise<VerifiedUser | null> {
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  }
}
