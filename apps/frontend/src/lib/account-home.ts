import type { MeResponse } from '@turnosmart/shared';

/**
 * Pantalla inicial según el acceso de la cuenta: el OWNER opera su negocio, el ADMIN global va al
 * panel de la plataforma, una cuenta verificada sin perfil completa el alta del negocio y una
 * cuenta desactivada (o STAFF legado) ve el aviso.
 */
export function accountHome(me: MeResponse): string {
  if (me.access === 'OWNER') return '/customers';
  if (me.access === 'ADMIN') return '/admin';
  return me.reason === 'NO_PROFILE' ? '/onboarding' : '/sin-acceso';
}
