import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePublicEnv } from './public-env.mjs';
import { loadPublicBuildEnv } from './load-public-env.mjs';

validatePublicEnv(loadPublicBuildEnv());
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../.next/static');
function chunks(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? chunks(path)
      : entry.name.endsWith('.js')
        ? [readFileSync(path, 'utf8')]
        : [];
  });
}
const bundle = chunks(root).join('\n');
for (const name of [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
])
  assert(
    bundle.includes(process.env[name].replace(/\/$/, '')),
    `Bundle no coincide con ${name}; reconstruir con el entorno correcto.`,
  );
assert(!bundle.includes('http://localhost:4000'), 'Fallback local de API en bundle productivo');
// El SDK contiene el prefijo literal para reconocer tipos; buscar una clave completa.
assert(!/sb_secret_[A-Za-z0-9_-]{16,}/.test(bundle), 'Clave privilegiada en bundle');
console.log(
  'Bundle del navegador verificado: contiene las tres variables publicas esperadas, sin API localhost.',
);
