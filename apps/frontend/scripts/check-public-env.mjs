import { validatePublicEnv } from './public-env.mjs';
import { loadPublicBuildEnv } from './load-public-env.mjs';

// Reutilizar el cargador propio de Next y su precedencia, sin nueva dependencia.
validatePublicEnv(loadPublicBuildEnv());
console.log(
  'Variables publicas de build verificadas: HTTPS, sin localhost ni claves privilegiadas.',
);
