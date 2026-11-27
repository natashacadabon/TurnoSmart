import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  authCallbackUrl,
  authErrorMessage,
  newPasswordProblem,
  nextAfterCallback,
  parseAuthCallback,
  validateNewPassword,
} from '../src/lib/auth-flow.mjs';

const origin = 'http://localhost:3000';

// Valores de prueba generados: no son credenciales y evitan falsos positivos de escáneres.
const tooShort = 'x'.repeat(5) + '1';
const lettersOnly = 'x'.repeat(16);
const valid = 'x'.repeat(9) + '1';
const mismatch = 'x'.repeat(9) + '2';

test('arma el callback de Auth en el mismo origen con el flujo explícito', () => {
  assert.equal(
    authCallbackUrl(origin, 'recovery'),
    'http://localhost:3000/auth/callback?flow=recovery',
  );
  assert.equal(
    authCallbackUrl('https://turnosmart.vercel.app/login', 'invite'),
    'https://turnosmart.vercel.app/auth/callback?flow=invite',
  );
});

test('reconoce invitación, recuperación y verificación por query o por hash', () => {
  assert.deepEqual(parseAuthCallback(`${origin}/auth/callback?flow=invite#access_token=x`), {
    flow: 'invite',
    error: null,
  });
  assert.equal(parseAuthCallback(`${origin}/auth/callback#type=recovery`).flow, 'recovery');
  assert.equal(parseAuthCallback(`${origin}/auth/callback#type=signup`).flow, 'verify');
  assert.equal(parseAuthCallback(`${origin}/auth/callback?flow=otro`).flow, null);
});

test('detecta enlaces vencidos e inválidos en hash o query', () => {
  const expired = parseAuthCallback(
    `${origin}/auth/callback?flow=invite#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`,
  );
  assert.deepEqual(expired, { flow: 'invite', error: { code: 'otp_expired', expired: true } });
  const invalid = parseAuthCallback(`${origin}/auth/callback?flow=recovery&error=access_denied`);
  assert.deepEqual(invalid.error, { code: 'access_denied', expired: false });
});

test('después del enlace, invitación y recuperación piden contraseña; verificación va al login', () => {
  assert.equal(nextAfterCallback('invite'), '/reset-password?flow=invite');
  assert.equal(nextAfterCallback('recovery'), '/reset-password?flow=recovery');
  assert.equal(nextAfterCallback('verify'), '/login?verified=1');
  assert.equal(nextAfterCallback(null), '/login?verified=1');
});

test('valida largo, letras y números y confirmación de la contraseña', () => {
  assert.match(validateNewPassword(tooShort, tooShort) ?? '', /10 caracteres/);
  assert.match(validateNewPassword(lettersOnly, lettersOnly) ?? '', /letras y números/);
  assert.match(validateNewPassword(valid, mismatch) ?? '', /no coinciden/);
  assert.equal(validateNewPassword(valid, valid), null);
});

test('traduce errores de Auth sin revelar si la cuenta existe', () => {
  assert.match(authErrorMessage({ code: 'over_email_send_rate_limit' }), /demasiados intentos/);
  assert.match(authErrorMessage({ status: 429 }), /demasiados intentos/);
  assert.match(authErrorMessage({ code: 'same_password' }), /distinta/);
  assert.equal(
    authErrorMessage({ message: 'Invalid login credentials' }),
    'Email o contraseña incorrectos',
  );
  assert.match(authErrorMessage({ code: 'user_not_found' }), /No se pudo completar/);
  assert.match(authErrorMessage(null), /No se pudo completar/);
});

test('indica qué campo marcar según el problema de la contraseña', () => {
  assert.equal(newPasswordProblem(tooShort, tooShort)?.field, 'password');
  assert.equal(newPasswordProblem(lettersOnly, lettersOnly)?.field, 'password');
  assert.equal(newPasswordProblem(valid, mismatch)?.field, 'confirmation');
  assert.equal(newPasswordProblem(valid, valid), null);
});
