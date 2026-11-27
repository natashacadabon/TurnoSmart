import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { validatePublicEnv, validatePublicOrigin } from './public-env.mjs';

const publicNames = [
  'NEXT_PUBLIC_USE_AZURE',
  'NEXT_PUBLIC_API_URL_RENDER',
  'NEXT_PUBLIC_API_URL_AZURE',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];

// workflow_run y pull_request_target se ejecutan desde la rama predeterminada,
// no desde la rama candidata. Fallar antes de solicitar el environment Preview.
export function assertTrustedPreviewContext(context) {
  assert(
    ['workflow_run', 'pull_request_target'].includes(context.eventName) &&
      context.payload.repository?.default_branch === 'dev' &&
      context.ref === 'refs/heads/dev' &&
      /^[a-f0-9]{40}$/.test(context.sha),
    'Preview requiere dev como default branch y referencia confiable; revisar las restricciones de vercel-preview.',
  );
}

export function previewOutcome(sha, results, url, alias) {
  const required = ['select', 'settings', 'build', 'deploy'];
  if (required.some((job) => !Object.hasOwn(results, job)))
    return { status: 'fallido', message: 'Preview no publicado: informe de jobs incompleto.' };
  if (Object.values(results).some((value) => ['failure', 'cancelled'].includes(value)))
    return {
      status: 'fallido',
      message: 'Preview no publicado: revisar el job fallido o cancelado.',
    };
  if (!sha && required.slice(1).some((job) => results[job] !== 'skipped'))
    return {
      status: 'fallido',
      message: 'Preview no publicado: jobs ejecutados sin una revisión seleccionada.',
    };
  if (!sha)
    return {
      status: 'omitido',
      message:
        'Sin revisión elegible: CD, evento, rama, origen, cambios o vigencia no cumplen los filtros.',
    };
  const validUrl = (value) => /^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/i.test(value ?? '');
  if (
    !/^[a-f0-9]{40}$/.test(sha) ||
    Object.values(results).some((value) => value !== 'success') ||
    !validUrl(alias) ||
    (url && !validUrl(url))
  )
    return {
      status: 'fallido',
      message: 'Preview no publicado: faltan jobs aprobados o un alias verificado.',
    };
  return {
    status: 'publicado',
    message: url
      ? 'Nuevo Preview publicado con alias verificado.'
      : 'Preview existente verificado y reutilizado; no se creó otro deployment.',
  };
}

// Alcance de proyecto: no consultar /teams ni /user, que pueden devolver 403/404
// con un token válido para este proyecto. La CLI de promoción sí hace esas consultas.
function vercelApi(env, request) {
  assert(env.VERCEL_TOKEN, 'Falta VERCEL_TOKEN');
  assert(/^team_[a-z0-9]+$/i.test(env.VERCEL_ORG_ID), 'VERCEL_ORG_ID debe ser un ID team_...');
  assert(
    /^prj_[a-z0-9]+$/i.test(env.VERCEL_PROJECT_ID),
    'VERCEL_PROJECT_ID debe ser un ID prj_...',
  );
  return async (path, method = 'GET') => {
    const url = new URL(path, 'https://api.vercel.com');
    url.searchParams.set('teamId', env.VERCEL_ORG_ID);
    let response;
    try {
      response = await request(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${env.VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
    } catch {
      throw new Error(`Vercel: fallo de red/timeout en ${method}; no se reintentó la operación.`);
    }
    assert(
      response.ok,
      `Vercel: ${method} rechazado (HTTP ${response.status}). Revisar acceso al proyecto, sin ampliar permisos automáticamente.`,
    );
    if (method === 'POST') return;
    try {
      return await response.json();
    } catch {
      throw new Error('Vercel: respuesta JSON inválida');
    }
  };
}
function assertProject(project, env) {
  assert(
    project?.id === env.VERCEL_PROJECT_ID && project.accountId === env.VERCEL_ORG_ID,
    'El proyecto Vercel no corresponde al equipo esperado',
  );
}
export async function verifyVercelAccess(env, request = fetch) {
  assert(['preview', 'production'].includes(env.DEPLOY_TARGET), 'DEPLOY_TARGET inválido');
  const api = vercelApi(env, request);
  const project = await api(`/v9/projects/${env.VERCEL_PROJECT_ID}`);
  assertProject(project, env);
  return { teamId: project.accountId, projectId: project.id };
}

// Misma operación que requestPromote de CLI 65.9.0, sin consultar identidad global.
// Sólo el workflow controlado llama a esta función después de CI/bundle/backend/SHA.
export async function promoteProduction(
  env,
  request = fetch,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  assert(
    env.DEPLOY_TARGET === 'production' && env.GITHUB_REF === 'refs/heads/main',
    'Promoción permitida sólo desde main a Production',
  );
  assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA), 'SHA candidato inválido');
  assert(
    /^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/i.test(env.DEPLOYMENT_URL ?? ''),
    'URL inmutable inválida',
  );
  const host = new URL(env.DEPLOYMENT_URL).hostname;
  const api = vercelApi(env, request);
  const projectPath = `/v9/projects/${env.VERCEL_PROJECT_ID}?rollbackInfo=true`;
  const project = await api(projectPath);
  assertProject(project, env);
  assert(!project.rollingRelease, 'No se admite promoción parcial mediante rolling release');
  const deployment = await api(`/v13/deployments/${host}`);
  assert(
    deployment?.projectId === env.VERCEL_PROJECT_ID &&
      deployment.ownerId === env.VERCEL_ORG_ID &&
      deployment.url === host &&
      deployment.target === 'production' &&
      deployment.readyState === 'READY' &&
      deployment.meta?.turnosmartMergeSha === env.GITHUB_SHA &&
      /^dpl_[a-z0-9]+$/i.test(deployment.id),
    'El deployment no es Production READY del proyecto y SHA candidatos',
  );
  const previousRequest = project.lastAliasRequest?.requestedAt ?? 0;
  assert(
    Number.isSafeInteger(previousRequest) && previousRequest >= 0,
    'Estado previo de promoción inválido',
  );
  const startedAt = Date.now();
  // No repetir POST: un timeout podría haber ocurrido después de aceptar la promoción.
  await api(`/v10/projects/${env.VERCEL_PROJECT_ID}/promote/${deployment.id}`, 'POST');
  const deadline = Date.now() + 180_000;
  for (let attempt = 0; attempt < 36 && Date.now() < deadline; attempt++) {
    const current = await api(projectPath);
    assertProject(current, env);
    const job = current.lastAliasRequest;
    if (
      Number.isSafeInteger(job?.requestedAt) &&
      job.requestedAt > previousRequest &&
      job.requestedAt >= startedAt - 5000 &&
      job.requestedAt <= Date.now() + 5000
    ) {
      assert(
        job.type === 'promote' && job.toDeploymentId === deployment.id,
        'Otra operación sustituyó la promoción candidata',
      );
      assert(!['failed', 'skipped'].includes(job.jobStatus), 'Vercel no completó la promoción');
      if (job.jobStatus === 'succeeded' && !current.rollingRelease) {
        const assigned = await api(`/v13/deployments/${deployment.id}`);
        const checks = {
          id: assigned?.id === deployment.id,
          projectId: assigned?.projectId === env.VERCEL_PROJECT_ID,
          ownerId: assigned?.ownerId === env.VERCEL_ORG_ID,
          url: assigned?.url === host,
          target: assigned?.target === 'production',
          readyState: assigned?.readyState === 'READY',
          'meta.turnosmartMergeSha': assigned?.meta?.turnosmartMergeSha === env.GITHUB_SHA,
          aliasAssigned: assigned?.aliasAssigned === true,
          aliasError: !assigned?.aliasError,
          alias:
            Array.isArray(assigned?.alias) &&
            assigned.alias.length > 0 &&
            assigned.alias.every(
              (name) => typeof name === 'string' && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(name),
            ),
        };
        const failed = Object.keys(checks).filter((key) => !checks[key]);
        assert(
          failed.length === 0,
          'La promoción no confirmó los dominios Production del deployment candidato; ' +
            `fase=verificación posterior; campos inválidos=${failed.join(', ')}. ` +
            'Vercel informó job succeeded; consultar el estado antes de reintentar.',
        );
        return `https://${assigned.alias[0]}`;
      }
    }
    if (attempt < 35) await pause(5000);
  }
  throw new Error(
    'Promoción pendiente: timeout sin acreditar publicación; no reintentar sin consultar su estado',
  );
}

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

export async function selectDevPreview(github, context) {
  const run = context.payload.workflow_run;
  const { owner, repo } = context.repo;
  if (
    run?.event !== 'push' ||
    run.conclusion !== 'success' ||
    run.head_branch !== 'dev' ||
    run.head_repository?.full_name !== `${owner}/${repo}` ||
    !/^\.github\/workflows\/ci\.yml(@.+)?$/.test(run.path ?? '') ||
    !/^[a-f0-9]{40}$/.test(run.head_sha)
  )
    return null;
  const { data } = await github.rest.git.getRef({ owner, repo, ref: 'heads/dev' });
  if (data.object.sha !== run.head_sha) return null;
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, {
    owner,
    repo,
    run_id: run.id,
    attempt_number: run.run_attempt,
  });
  if (!jobs.some((job) => job.name === 'Quality Checks' && job.conclusion === 'success'))
    return null;
  return {
    ...context,
    repo: context.repo,
    eventName: 'push',
    ref: 'refs/heads/dev',
    sha: run.head_sha,
  };
}

export function selectFrontendPreview(github, context) {
  return context.payload.workflow_run?.event === 'push'
    ? selectDevPreview(github, context)
    : selectPreview(github, context);
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

function expectedOrigins(env) {
  assert(env.EXPECTED_DEV_API && env.EXPECTED_DEV_SUPABASE, 'Faltan los origenes Dev esperados');
  assert(
    env.EXPECTED_PRODUCTION_API && env.EXPECTED_PRODUCTION_SUPABASE,
    'Faltan los origenes Production esperados',
  );
  for (const name of [
    'EXPECTED_DEV_API',
    'EXPECTED_DEV_SUPABASE',
    'EXPECTED_PRODUCTION_API',
    'EXPECTED_PRODUCTION_SUPABASE',
  ]) {
    assert.equal(
      validatePublicOrigin(env[name], name),
      env[name],
      'Los origenes esperados deben ser canonicos',
    );
  }
  assert(
    env.EXPECTED_DEV_API !== env.EXPECTED_PRODUCTION_API &&
      env.EXPECTED_DEV_SUPABASE !== env.EXPECTED_PRODUCTION_SUPABASE,
    'Production no puede usar destinos de Dev; Preview no puede usar destinos Production',
  );
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
  expectedOrigins(env);
  const apiOrigin = new URL(values.NEXT_PUBLIC_API_URL_RENDER).origin;
  const supabaseOrigin = new URL(values.NEXT_PUBLIC_SUPABASE_URL).origin;
  if (target === 'production') {
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
    const production = new Set([env.EXPECTED_PRODUCTION_API, env.EXPECTED_PRODUCTION_SUPABASE]);
    assert(
      [
        values.NEXT_PUBLIC_API_URL_RENDER,
        values.NEXT_PUBLIC_API_URL_AZURE,
        values.NEXT_PUBLIC_SUPABASE_URL,
      ].every((value) => !production.has(new URL(value).origin)),
      'Preview y checkpoint no pueden usar destinos Production',
    );
    assert(
      apiOrigin === env.EXPECTED_DEV_API && supabaseOrigin === env.EXPECTED_DEV_SUPABASE,
      'Preview requiere los origenes Render y Supabase de Dev',
    );
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

/** Sólo GET a los endpoints existentes; no sigue redirects ni registra sus cuerpos. */
export async function verifyProductionBackend(env, sha, request = fetch) {
  assert.equal(env.DEPLOY_TARGET, 'production', 'La comprobacion de backend requiere Production');
  expectedOrigins(env);
  assert(/^[a-f0-9]{40}$/.test(sha ?? ''), 'Falta el SHA candidato completo');
  async function get(path, timeout) {
    try {
      const response = await request(new URL(path, env.EXPECTED_PRODUCTION_API), {
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
        headers: { 'Cache-Control': 'no-cache' },
      });
      assert.equal(response.status, 200);
      return await response.json();
    } catch {
      throw new Error('Backend Production no operativo: ' + path);
    }
  }
  const health = await get('/health', 90000);
  assert(
    health?.status === 'ok' && health?.service === 'turnosmart-backend' && health?.version === sha,
    'El backend Production no coincide con el SHA candidato',
  );
  const ready = await get('/ready', 15000);
  assert.equal(ready?.status, 'ready', 'Backend Production no preparado');
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

// The publisher receives only this directory, with no workspace dependencies.
export function verifyStandaloneOutput(root) {
  const output = join(root, '.vercel/output');
  assert.equal(JSON.parse(readFileSync(join(output, 'config.json'))).version, 3);
  const outputPath = realpathSync(output);
  for (const entry of readdirSync(output, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const label = JSON.stringify(relative(output, path));
    if (entry.isSymbolicLink()) {
      let target;
      try {
        target = relative(outputPath, realpathSync(path));
      } catch {
        throw new Error(`Enlace prebuilt sin destino: ${label}`);
      }
      assert(
        !isAbsolute(target) && target !== '..' && !target.startsWith(`..${sep}`),
        `Enlace prebuilt fuera del artefacto: ${label}`,
      );
    }
    if (entry.name !== '.vc-config.json') continue;
    let config;
    try {
      config = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new Error(`Configuracion prebuilt ilegible: ${label}`);
    }
    const sources = Object.values(config.filePathMap ?? {});
    assert(
      sources.length === 0,
      `Prebuilt no autocontenido en ${label}: ${sources.length} referencias filePathMap. Reconstruir con vercel build --standalone.`,
    );
    const entrypoint = config.entrypoint ?? config.handler;
    if (typeof entrypoint === 'string') {
      const directory = dirname(path);
      const file = resolve(directory, entrypoint);
      const filePath = relative(directory, file);
      assert(
        !isAbsolute(filePath) &&
          filePath !== '..' &&
          !filePath.startsWith(`..${sep}`) &&
          statSync(file, { throwIfNoEntry: false })?.isFile(),
        `Falta el archivo de entrada prebuilt en ${label}`,
      );
    }
  }
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
  else if (command === 'standalone-output') verifyStandaloneOutput(root);
  else if (command === 'published')
    await verifyPublished(
      root,
      process.env.DEPLOYMENT_URL,
      fetch,
      process.env.VERCEL_AUTOMATION_BYPASS,
    );
  else if (command === 'backend')
    await verifyProductionBackend(process.env, process.env.GITHUB_SHA);
  else if (command === 'promote') console.log(await promoteProduction(process.env));
  else if (command === 'vercel-access') {
    await verifyVercelAccess(process.env);
    console.log(
      'Equipo y proyecto Vercel verificados por lectura; no se verificó una promoción real.',
    );
  } else throw new Error('Comando de verificacion desconocido');
}
