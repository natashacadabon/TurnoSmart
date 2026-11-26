// Lógica pura de los enlaces de Supabase Auth (invitación, recuperación y verificación de correo).
// Sin dependencias del navegador para poder probarla con node:test.

/** @typedef {'invite' | 'recovery' | 'verify'} AuthFlow */

/** @type {readonly AuthFlow[]} */
export const AUTH_FLOWS = ['invite', 'recovery', 'verify'];

export const PASSWORD_MIN_LENGTH = 10;

/**
 * URL a la que Supabase redirige después de validar el enlace del correo. Debe estar en la
 * lista de Redirect URLs del proyecto de Auth (`<origen>/auth/callback`).
 * @param {string} origin
 * @param {AuthFlow} flow
 */
export function authCallbackUrl(origin, flow) {
  const url = new URL('/auth/callback', origin);
  url.searchParams.set('flow', flow);
  return url.toString();
}

/**
 * Lee el flujo pedido y un posible error devuelto por Supabase en la URL de callback.
 * Supabase informa los errores en el hash (#error=...) o en la query (?error=...).
 * @param {string} href
 * @returns {{ flow: AuthFlow | null; error: null | { code: string; expired: boolean } }}
 */
export function parseAuthCallback(href) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const read = (/** @type {string} */ key) => url.searchParams.get(key) ?? hash.get(key);
  const requested = url.searchParams.get('flow');
  const type = hash.get('type');
  /** @type {AuthFlow | null} */
  let flow = null;
  if (AUTH_FLOWS.includes(/** @type {AuthFlow} */ (requested)))
    flow = /** @type {AuthFlow} */ (requested);
  else if (type === 'invite' || type === 'recovery') flow = type;
  else if (type === 'signup' || type === 'email_change' || type === 'email') flow = 'verify';
  const code = read('error_code') ?? read('error');
  if (!code) return { flow, error: null };
  return {
    flow,
    error: { code, expired: code === 'otp_expired' || code === 'flow_state_expired' },
  };
}

/**
 * Pantalla de destino después de procesar el enlace con una sesión válida.
 * @param {AuthFlow | null} flow
 */
export function nextAfterCallback(flow) {
  if (flow === 'invite') return '/reset-password?flow=invite';
  if (flow === 'recovery') return '/reset-password?flow=recovery';
  return '/login?verified=1';
}

/**
 * Valida la nueva contraseña antes de enviarla a Supabase. Devuelve un mensaje o null.
 * @param {string} password
 * @param {string} confirmation
 */
export function validateNewPassword(password, confirmation) {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password))
    return 'La contraseña debe combinar letras y números.';
  if (password !== confirmation) return 'Las contraseñas no coinciden.';
  return null;
}

/**
 * Traduce errores de Supabase Auth sin revelar si una cuenta existe.
 * @param {{ code?: string; message?: string; status?: number } | null | undefined} error
 */
export function authErrorMessage(error) {
  const code = error?.code ?? '';
  if (
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    error?.status === 429
  )
    return 'Hiciste demasiados intentos. Esperá unos minutos y volvé a probar.';
  if (code === 'same_password') return 'La nueva contraseña debe ser distinta de la anterior.';
  if (code === 'weak_password')
    return 'La contraseña es demasiado débil. Usá al menos 10 caracteres con letras y números.';
  if (code === 'email_not_confirmed')
    return 'Tu correo todavía no está verificado. Abrí el enlace de invitación que te enviamos.';
  if (code === 'invalid_credentials' || error?.message === 'Invalid login credentials')
    return 'Email o contraseña incorrectos';
  if (code === 'session_not_found' || code === 'refresh_token_not_found')
    return 'El enlace ya no es válido. Pedí uno nuevo.';
  return 'No se pudo completar la operación. Intentá de nuevo.';
}
