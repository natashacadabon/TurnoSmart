import { selectBackendUrl } from '../src/lib/backend-url.mjs';

/** Guardas de configuracion de build; nunca imprimen valores ni verifican firmas JWT. */
export function validatePublicEnv(source) {
  const names = [
    'NEXT_PUBLIC_API_URL_RENDER',
    'NEXT_PUBLIC_API_URL_AZURE',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ];
  const fail = (name) => {
    throw new Error(`Configuracion publica invalida: ${name}`);
  };
  for (const name of Object.keys(source)) {
    if (
      name.startsWith('NEXT_PUBLIC_') &&
      /SERVICE_ROLE|SECRET|DATABASE|DIRECT_URL|GEMINI/i.test(name)
    )
      fail(name);
  }
  for (const name of names) if (!source[name]?.trim()) fail(name);
  for (const name of names.slice(0, 3)) {
    let url;
    if (source[name] !== source[name].trim()) fail(name);
    try {
      url = new URL(source[name]);
    } catch {
      fail(name);
    }
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const local =
      host === 'localhost' ||
      /\.(localhost|local|internal)$/.test(host) ||
      /^(0|10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host) ||
      host === '::' ||
      host === '::1' ||
      /^(fc|fd|fe[89ab])[0-9a-f]*:/.test(host) ||
      host.startsWith('::ffff:');
    if (
      url.protocol !== 'https:' ||
      local ||
      host.endsWith('.') ||
      !host.includes('.') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      fail(name);
  }
  const key = source.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    try {
      const parts = key.split('.');
      if (
        parts.length !== 3 ||
        parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)) ||
        JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role !== 'anon'
      )
        fail(names[3]);
    } catch {
      fail(names[3]);
    }
  }
  return selectBackendUrl(
    source.NEXT_PUBLIC_USE_AZURE,
    source.NEXT_PUBLIC_API_URL_RENDER,
    source.NEXT_PUBLIC_API_URL_AZURE,
  );
}
