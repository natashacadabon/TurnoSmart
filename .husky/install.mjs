// https://typicode.github.io/husky/how-to.html#ci-server-and-docker
if (
  process.env.NODE_ENV === 'production' ||
  ['true', '1'].includes(process.env.CI) ||
  process.env.HUSKY === '0' ||
  process.env.VERCEL === '1' ||
  process.env.RENDER === 'true'
) {
  process.exit(0);
}

let huskyUrl;
try {
  huskyUrl = import.meta.resolve('husky');
} catch (error) {
  // Una instalacion sin devDependencies puede no contener Husky.
  if (error.code === 'ERR_MODULE_NOT_FOUND') process.exit(0);
  throw error;
}

// No ocultar errores de un Husky instalado pero roto.
const husky = (await import(huskyUrl)).default;
const message = husky();
if (message) console.log(message);
