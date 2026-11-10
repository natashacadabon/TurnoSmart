import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePublicEnv } from './public-env.mjs';
import { selectBackendUrl } from '../src/lib/backend-url.mjs';

const valid = {
  NEXT_PUBLIC_API_URL_RENDER: 'https://turnosmart-backend-demo.onrender.com',
  NEXT_PUBLIC_API_URL_AZURE: 'https://turnosmart-api.azurewebsites.net',
  NEXT_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_build_fixture',
};
const jwt = (role) =>
  `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
test('acepta URL Azure/clave publishable y legacy anon; no verifica firma', () => {
  validatePublicEnv(valid);
  validatePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon') });
});
for (const name of Object.keys(valid))
  test(`exige ${name} sin imprimir valores`, () => {
    assert.throws(() => validatePublicEnv({ ...valid, [name]: '' }), {
      message: `Configuracion publica invalida: ${name}`,
    });
  });
for (const value of [
  'http://api.azurewebsites.net',
  'https://localhost',
  'https://localhost.',
  'https://demo.localhost',
  'https://127.0.0.1',
  'https://10.1.2.3',
  'https://172.16.1.1',
  'https://192.168.1.1',
  'https://169.254.0.1',
  'https://[::1]',
  'https://[::ffff:127.0.0.1]',
  'https://[fd00::1]',
  'https://backend',
  'https://api.azurewebsites.net/api',
  'https://api.azurewebsites.net?key=private',
  'https://user:private@api.azurewebsites.net',
  'not-a-url',
]) {
  test(`rechaza URL no publica o no origen: ${value.split('@').at(-1).split('?')[0]}`, () => {
    for (const name of [
      'NEXT_PUBLIC_API_URL_RENDER',
      'NEXT_PUBLIC_API_URL_AZURE',
      'NEXT_PUBLIC_SUPABASE_URL',
    ])
      assert.throws(() => validatePublicEnv({ ...valid, [name]: value }), {
        message: `Configuracion publica invalida: ${name}`,
      });
  });
}
for (const value of [
  'sb_secret_private',
  jwt('service_role'),
  jwt('authenticated'),
  'bad-key',
  'e30.bad.signature',
])
  test('rechaza key privilegiada o invalida sin exponerla', () => {
    assert.throws(() => validatePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: value }), {
      message: 'Configuracion publica invalida: NEXT_PUBLIC_SUPABASE_ANON_KEY',
    });
  });
test('rechaza variables privilegiadas con prefijo publico', () => {
  for (const name of [
    'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_SECRET_KEY',
    'NEXT_PUBLIC_DATABASE_URL',
    'NEXT_PUBLIC_GEMINI_API_KEY',
  ])
    assert.throws(() => validatePublicEnv({ ...valid, [name]: 'private' }), {
      message: `Configuracion publica invalida: ${name}`,
    });
});

test('selector: flag ausente/false usa Render, true usa Azure; ignora variable legacy', () => {
  assert.equal(validatePublicEnv(valid), valid.NEXT_PUBLIC_API_URL_RENDER);
  assert.equal(
    validatePublicEnv({ ...valid, NEXT_PUBLIC_USE_AZURE: 'false' }),
    valid.NEXT_PUBLIC_API_URL_RENDER,
  );
  assert.equal(
    validatePublicEnv({ ...valid, NEXT_PUBLIC_USE_AZURE: 'true' }),
    valid.NEXT_PUBLIC_API_URL_AZURE,
  );
  assert.equal(
    validatePublicEnv({ ...valid, NEXT_PUBLIC_API_URL: 'https://legacy.invalid' }),
    valid.NEXT_PUBLIC_API_URL_RENDER,
  );
  assert.equal(
    selectBackendUrl(
      'true',
      `${valid.NEXT_PUBLIC_API_URL_RENDER}/`,
      `${valid.NEXT_PUBLIC_API_URL_AZURE}/`,
    ),
    valid.NEXT_PUBLIC_API_URL_AZURE,
  );
  assert.equal(selectBackendUrl('false', undefined, valid.NEXT_PUBLIC_API_URL_AZURE), '');
});
test('selector: desarrollo usa exclusivamente la API local', () => {
  assert.equal(
    selectBackendUrl(
      'false',
      valid.NEXT_PUBLIC_API_URL_RENDER,
      valid.NEXT_PUBLIC_API_URL_AZURE,
      true,
    ),
    'http://localhost:4000',
  );
  assert.equal(selectBackendUrl('true', undefined, undefined, true), 'http://localhost:4000');
});
test('selector: el puerto de Compose sólo se usa en desarrollo', () => {
  const local = 'http://localhost:4001/';
  assert.equal(
    selectBackendUrl('false', undefined, undefined, true, undefined, local),
    'http://localhost:4001',
  );
  assert.equal(
    selectBackendUrl('false', valid.NEXT_PUBLIC_API_URL_RENDER, undefined, false, undefined, local),
    valid.NEXT_PUBLIC_API_URL_RENDER,
  );
});

test('selector rechaza valores distintos a strings true/false', () => {
  for (const flag of ['', 'TRUE', 'False', '0', '1', ' true ', true, false])
    assert.throws(() => validatePublicEnv({ ...valid, NEXT_PUBLIC_USE_AZURE: flag }), {
      message: 'Configuracion publica invalida: NEXT_PUBLIC_USE_AZURE',
    });
});
test('valida ambos proveedores aunque no se seleccionen, sin consultas de red', () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('No debe consultarse disponibilidad');
  };
  try {
    validatePublicEnv({ ...valid, NEXT_PUBLIC_USE_AZURE: 'true' });
    validatePublicEnv({ ...valid, NEXT_PUBLIC_USE_AZURE: 'false' });
    for (const flag of ['false', 'true'])
      for (const name of ['NEXT_PUBLIC_API_URL_RENDER', 'NEXT_PUBLIC_API_URL_AZURE'])
        assert.throws(() =>
          validatePublicEnv({ ...valid, NEXT_PUBLIC_USE_AZURE: flag, [name]: 'https://localhost' }),
        );
  } finally {
    globalThis.fetch = fetch;
  }
});
