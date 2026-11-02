import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Misma precedencia que Next; no imprime ni escribe archivos de entorno. */
export function loadPublicBuildEnv() {
  const require = createRequire(import.meta.url);
  const { loadEnvConfig } = createRequire(require.resolve('next/package.json'))('@next/env');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  loadEnvConfig(root, false, { info() {}, error() {} });
  return process.env;
}
