import type { MeResponse } from '@turnosmart/shared';

/**
 * Pantalla inicial según el acceso de la cuenta: el OWNER opera su negocio, el ADMIN global va al
 * panel de la plataforma y una cuenta sin acceso (sin perfil o desactivada) ve el aviso.
 */
export function accountHome(me: MeResponse): string {
  if (me.access === 'OWNER') return '/customers';
  if (me.access === 'ADMIN') return '/admin';
  return '/sin-acceso';
}
