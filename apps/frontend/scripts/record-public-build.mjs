import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validatePublicEnv } from './public-env.mjs';
import { loadPublicBuildEnv } from './load-public-env.mjs';

// Solo el origen publico elegido; permite detectar un prebuilt de otro proveedor
// aunque el minificador conserve ambas URLs en JavaScript.
writeFileSync(
  fileURLToPath(new URL('../.next/backend-selection.json', import.meta.url)),
  JSON.stringify({ apiUrl: validatePublicEnv(loadPublicBuildEnv()) }),
);
