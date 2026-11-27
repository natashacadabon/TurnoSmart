import type { MeResponse } from '@turnosmart/shared';

/**
 * Pantalla inicial según la cuenta (misma regla que el login de FINAL-11): el ADMIN global va al
 * panel de la plataforma; una cuenta sin negocio o desactivada va a /onboarding, donde acepta su
 * invitación o ve el aviso de bloqueo; el OWNER activo opera su negocio.
 */
export function accountHome(me: MeResponse): string {
  if (me.platformAdmin) return '/admin';
  if (me.accountDisabled || !me.onboarded) return '/onboarding';
  return '/customers';
}
