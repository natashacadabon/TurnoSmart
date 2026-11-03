import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
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

export function affectsFrontend(path) {
  return (
    /^(apps\/frontend\/|packages\/shared\/|\.husky\/|\.github\/workflows\/(ci|frontend-deploy|frontend-preview)\.yml$)/.test(
      path,
    ) || /^(package(-lock)?\.json|\.npmrc|\.nvmrc|tsconfig[^/]*\.json)$/.test(path)
  );
}

// Se ejecuta en el workflow confiable tras CI. Devuelve un contexto con forma de
// pull_request (sha = head verificado) o null si la PR no debe publicar Preview.
export async function selectPreview(github, context) {
  const run = context.payload.workflow_run;
  if (run?.event !== 'pull_request' || run.conclusion !== 'success') return null;
  const { owner, repo } = context.repo;
  const full = `${owner}/${repo}`;
  if (run.head_repository?.full_name !== full) return null;
  // Un workflow de la PR con el mismo nombre no debe contar como Quality Checks.
  if (!/^\.github\/workflows\/ci\.yml(@.+)?$/.test(run.path ?? '')) return null;
  const candidates = [];
  for (const { number } of run.pull_requests ?? []) {
    const { data } = await github.rest.pulls.get({ owner, repo, pull_number: number });
    candidates.push(data);
  }
  // Con PR a dev y a main para el mismo SHA se publica la de dev.
  candidates.sort((a, b) => (a.base.ref === 'dev' ? -1 : 0) - (b.base.ref === 'dev' ? -1 : 0));
  for (const pr of candidates) {
    if (
      pr.state !== 'open' ||
      !['dev', 'main'].includes(pr.base.ref) ||
      pr.head.sha !== run.head_sha ||
      !pr.head.ref.startsWith('feat/') ||
      pr.head.repo?.full_name !== full ||
      pr.user.login === 'dependabot[bot]'
    )
      continue;
    const files = await github.paginate(github.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: pr.number,
      per_page: 100,
    });
    // Una PR que edita CI o workflows podria fabricar el exito: se publica tras fusionarla.
    const names = files.flatMap((file) => [file.filename, file.previous_filename]).filter(Boolean);
    if (names.some((name) => name.startsWith('.github/'))) continue;
    if (
      !files.some((file) =>
        [file.filename, file.previous_filename].some((p) => p && affectsFrontend(p)),
      )
    )
      continue;
    return {
      ...context,
      repo: context.repo,
      eventName: 'pull_request',
      sha: pr.head.sha,
      payload: { ...context.payload, pull_request: pr },
    };
  }
  return null;
}

export async function assertCurrentRevision(github, context) {
  if (context.eventName === 'pull_request') {
    const pr = context.payload.pull_request;
    const { data } = await github.rest.pulls.get({
      ...context.repo,
      pull_number: pr.number,
    });
    assert(
      data.state === 'open' &&
        ['dev', 'main'].includes(pr.base.ref) &&
        data.base.ref === pr.base.ref &&
        data.head.sha === pr.head.sha &&
        data.head.sha === context.sha,
      'Preview obsoleta: ejecutar CI para la revision actual del PR.',
    );
    return;
  }
  const { data } = await github.rest.git.getRef({
    ...context.repo,
    ref: context.ref.slice('refs/'.length),
  });
  assert(data.object.sha === context.sha, 'Despliegue obsoleto: la rama cambio durante CI.');
}

export function prepareVercel(root, env) {
  const target = env.DEPLOY_TARGET;
  assert(target === 'preview' || target === 'production', 'Entorno Vercel invalido');
  const checkpoint = env.CHECKPOINT === 'true';
  assert(!checkpoint || target === 'preview', 'Checkpoint Azure solo en Preview');
  const filename = `.env.${target}.local`;
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
  // Conservar los valores publicos del target de Vercel y descartar el resto.
  const pulled = parseEnv(readFileSync(join(root, '.vercel', filename), 'utf8'));
  const values = Object.fromEntries(publicNames.map((name) => [name, pulled[name]]));
  if (checkpoint) {
    values.NEXT_PUBLIC_USE_AZURE = 'true';
    values.NEXT_PUBLIC_API_URL_RENDER = env.CHECKPOINT_RENDER_URL;
    values.NEXT_PUBLIC_API_URL_AZURE = env.CHECKPOINT_AZURE_URL;
  } else {
    assert(
      values.NEXT_PUBLIC_USE_AZURE === undefined || values.NEXT_PUBLIC_USE_AZURE === 'false',
      'Configurar NEXT_PUBLIC_USE_AZURE=false en Vercel para CD.',
    );
  }
  validatePublicEnv(values);
  if (!checkpoint) {
    assert(env.EXPECTED_DEV_API && env.EXPECTED_DEV_SUPABASE, 'Faltan los origenes Dev esperados');
    const apiOrigin = new URL(values.NEXT_PUBLIC_API_URL_RENDER).origin;
    const supabaseOrigin = new URL(values.NEXT_PUBLIC_SUPABASE_URL).origin;
    if (target === 'production') {
      assert(
        env.EXPECTED_PRODUCTION_API && env.EXPECTED_PRODUCTION_SUPABASE,
        'Faltan los origenes Production esperados',
      );
      assert(
        [env.EXPECTED_DEV_API, env.EXPECTED_DEV_SUPABASE].every(
          (value) => URL.canParse(value) && new URL(value).origin === value,
        ),
        'Los origenes Dev esperados deben ser canonicos',
      );
      assert(
        apiOrigin !== env.EXPECTED_DEV_API && supabaseOrigin !== env.EXPECTED_DEV_SUPABASE,
        'Production no puede usar Render o Supabase de Dev',
      );
      assert(
        apiOrigin === env.EXPECTED_PRODUCTION_API &&
          supabaseOrigin === env.EXPECTED_PRODUCTION_SUPABASE,
        'Production requiere los origenes Render y Supabase esperados',
      );
    } else {
      assert(
        apiOrigin === env.EXPECTED_DEV_API && supabaseOrigin === env.EXPECTED_DEV_SUPABASE,
        'Preview requiere los origenes Render y Supabase de Dev',
      );
    }
  }
  const contents = publicNames
    .map((name) => {
      const value = values[name] ?? 'false';
      assert(!/[\r\n"\\$`]/.test(value), `Valor no serializable: ${name}`);
      return `${name}="${value}"`;
    })
    .join('\n');
  for (const dir of ['.vercel', 'apps/frontend/.vercel']) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, filename), `${contents}\n`, { mode: 0o600 });
  }
  return join('.vercel', filename);
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

export async function verifyPublished(root, deploymentUrl, request = fetch, bypass) {
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
      headers: bypass ? { 'x-vercel-protection-bypass': bypass } : undefined,
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
  if (command === 'prepare') console.log(prepareVercel(root, process.env));
  else if (command === 'output') verifyOutput(root);
  else if (command === 'published')
    await verifyPublished(
      root,
      process.env.DEPLOYMENT_URL,
      fetch,
      process.env.VERCEL_AUTOMATION_BYPASS,
    );
  else throw new Error('Comando de verificacion desconocido');
}
