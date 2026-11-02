import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePublicEnv } from './public-env.mjs';

const publicNames = [
  'NEXT_PUBLIC_USE_AZURE',
  'NEXT_PUBLIC_API_URL_RENDER',
  'NEXT_PUBLIC_API_URL_AZURE',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];

// No filtrar por conclusion: un exito anterior no debe ocultar un run nuevo fallido/en curso.
export function assertSuccessfulCi(runs, sha) {
  const latest = runs
    .filter((run) => run.head_sha === sha && run.event === 'push')
    .sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0];
  assert(
    latest?.status === 'completed' && latest.conclusion === 'success',
    'La revision requiere el ultimo run de ci.yml por push completado con success.',
  );
}

export function validateDeployment(env) {
  validatePublicEnv(env);
  for (const name of ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID'])
    assert(env[name]?.trim() && !/[\r\n]/.test(env[name]), `Falta variable valida: ${name}`);
}

export function prepareVercel(root, env) {
  validateDeployment(env);
  const projectPath = join(root, '.vercel/project.json');
  const project = JSON.parse(readFileSync(projectPath, 'utf8'));
  assert.equal(project.projectId, env.VERCEL_PROJECT_ID, 'Proyecto Vercel incorrecto');
  assert.equal(project.orgId, env.VERCEL_ORG_ID, 'Organizacion Vercel incorrecta');
  assert.equal(project.settings?.rootDirectory, 'apps/frontend', 'Root Directory incorrecto');
  const config = JSON.parse(readFileSync(join(root, 'apps/frontend/vercel.json'), 'utf8'));
  Object.assign(project.settings, {
    framework: config.framework,
    nodeVersion: '22.x',
    buildCommand: config.buildCommand,
    installCommand: config.installCommand,
    outputDirectory: null,
  });
  writeFileSync(projectPath, JSON.stringify(project));
  // pull descarga env remoto. Reemplazarlo por allowlist del runner antes de build.
  // Cubrir ambos layouts del CLI para monorepos; no copiar secretos de servidor.
  const contents = publicNames
    .map((name) => {
      const value = env[name] ?? 'false';
      assert(!/[\r\n"\\$`]/.test(value), `Valor no serializable: ${name}`);
      return `${name}="${value}"`;
    })
    .join('\n');
  for (const dir of ['.vercel', 'apps/frontend/.vercel']) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, '.env.production.local'), `${contents}\n`, { mode: 0o600 });
  }
}

function javascriptFiles(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = join(prefix, entry.name);
    return entry.isDirectory()
      ? javascriptFiles(join(dir, entry.name), name)
      : entry.name.endsWith('.js')
        ? [name]
        : [];
  });
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function verifyOutput(root) {
  const next = join(root, 'apps/frontend/.next/static');
  const output = join(root, '.vercel/output/static/_next/static');
  assert.equal(JSON.parse(readFileSync(join(root, '.vercel/output/config.json'))).version, 3);
  const files = javascriptFiles(next);
  assert(files.length > 0, 'Sin bundle Next');
  for (const file of files)
    assert.equal(
      digest(readFileSync(join(output, file))),
      digest(readFileSync(join(next, file))),
      'El artefacto Vercel no coincide con el bundle verificado',
    );
}

export async function verifyPublished(root, deploymentUrl, request = fetch) {
  const origin = new URL(deploymentUrl);
  assert(
    origin.protocol === 'https:' &&
      origin.hostname.endsWith('.vercel.app') &&
      !origin.username &&
      !origin.password &&
      origin.pathname === '/' &&
      !origin.search &&
      !origin.hash,
    'URL de deployment Vercel invalida',
  );
  async function get(path) {
    const response = await request(new URL(path, origin), {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    assert(response.ok, 'Deployment inaccesible; revisar readiness y Deployment Protection');
    return Buffer.from(await response.arrayBuffer());
  }
  const html = (await get('/login')).toString('utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"?#]+)[^"\n]*"/g)].map(
    (match) => match[1],
  );
  assert(scripts.length > 0, 'Login publicado sin scripts');
  for (const path of new Set(scripts)) {
    assert(
      path.startsWith('/_next/static/') && !path.split('/').includes('..'),
      'Script inesperado',
    );
    readFileSync(join(root, '.vercel/output/static', path.slice(1)));
  }
  // Incluir chunks lazy (p. ej. cliente HTTP), aunque /login no los importe.
  const output = join(root, '.vercel/output/static/_next/static');
  const files = javascriptFiles(output);
  assert(files.length > 0, 'Artefacto sin JavaScript');
  for (let index = 0; index < files.length; index += 4) {
    await Promise.all(
      files.slice(index, index + 4).map(async (file) => {
        const path = `/_next/static/${file.replaceAll('\\', '/')}`;
        assert.equal(
          digest(await get(path)),
          digest(readFileSync(join(output, file))),
          'Bundle publicado distinto del artefacto',
        );
      }),
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.cwd();
  const command = process.argv[2];
  if (command === 'validate') validateDeployment(process.env);
  else if (command === 'prepare') prepareVercel(root, process.env);
  else if (command === 'output') verifyOutput(root);
  else if (command === 'published') await verifyPublished(root, process.env.DEPLOYMENT_URL);
  else throw new Error('Comando de verificacion desconocido');
  console.log(`Verificacion de deployment: ${command} OK`);
}
