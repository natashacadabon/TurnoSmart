import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import {
  assertSupabaseTarget,
  SupabaseTargetError,
} from '../apps/backend/src/config/supabase-target.ts';
import { assertSuccessfulCi } from '../apps/frontend/scripts/deploy-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const destinationErrors = {
  MISSING_VARIABLE: 'Variable obligatoria ausente o vacía.',
  INVALID_URL: 'URL inválida: revisar formato, protocolo, espacios y origen canónico.',
  INVALID_CREDENTIALS: 'Credenciales de conexión ausentes o con formato inválido.',
  INVALID_ENDPOINT: 'Host o usuario Supabase no permitido.',
  INVALID_DATABASE: 'Base o puerto no permitido.',
  TRANSACTION_POOLER:
    'DIRECT_URL requiere conexión directa o session pooler 5432, no transaction pooler.',
  INVALID_PARAMETER: 'Parámetro de conexión no permitido o duplicado.',
  TLS_REQUIRED: 'La conexión requiere sslmode=require, verify-ca o verify-full.',
  TLS_CERTIFICATE_VALIDATION: 'No se permite omitir la validación del certificado TLS.',
  INVALID_SCHEMA: 'Sólo se admite schema public.',
  PROJECT_MISMATCH: 'El proyecto de la variable no coincide con el entorno seleccionado.',
  SAME_PROJECTS: 'Las expectativas Dev y Production deben identificar proyectos distintos.',
  INVALID_ENVIRONMENT: 'Configuración incompatible con el entorno seleccionado.',
  BRANCH_NOT_ALLOWED: 'Rama no autorizada para el entorno.',
  LOCAL_TARGET: 'El workflow exige un destino Supabase remoto identificado.',
  INVALID_PUBLIC_KEY: 'La clave pública tiene tipo o proyecto incorrecto.',
};
const diagnosticVariables = new Set([
  'SUPABASE_URL',
  'DATABASE_URL',
  'DIRECT_URL',
  'EXPECTED_DEV_SUPABASE',
  'EXPECTED_PRODUCTION_SUPABASE',
  'DEPLOY_TARGET',
  'RENDER_GIT_BRANCH',
  'CORS_ENVIRONMENT',
  'SUPABASE_ANON_KEY',
]);

// No interpretar ni imprimir error.message/stack/cause: sólo metadata y textos permitidos.
export function migrationDiagnostic(error) {
  if (
    error instanceof SupabaseTargetError &&
    typeof error.code === 'string' &&
    Object.hasOwn(destinationErrors, error.code) &&
    typeof error.variable === 'string' &&
    error.variable.split(', ').every((name) => diagnosticVariables.has(name))
  )
    return {
      variable: error.variable,
      type: error.code,
      description: destinationErrors[error.code],
    };
  return {
    variable: 'no identificada',
    type: 'UNEXPECTED_ERROR',
    description: 'Error no clasificado; no se muestra información privada.',
  };
}

export function validateMigrationContext(env) {
  assert(env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'Sólo se admite workflow_dispatch');
  assert(['dev', 'production'].includes(env.MIGRATION_ENVIRONMENT), 'Entorno inválido');
  assert(['status', 'deploy'].includes(env.MIGRATION_OPERATION), 'Operación inválida');
  const production = env.MIGRATION_ENVIRONMENT === 'production';
  assert(env.GITHUB_REF === `refs/heads/${production ? 'main' : 'dev'}`, 'Rama no autorizada');
  assert(env.DEPLOY_TARGET === (production ? 'production' : 'preview'), 'DEPLOY_TARGET incorrecto');
  assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA), 'SHA inválido');
  assert(/^22\./.test(process.versions.node), 'Se requiere Node 22');
}

// El mismo control de CI que los publicadores existentes; sólo GET, sin imprimir respuestas.
export async function authorizeMigration(env, request = fetch) {
  validateMigrationContext(env);
  assert(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(env.GITHUB_REPOSITORY ?? ''), 'Repositorio inválido');
  assert(env.GH_TOKEN, 'Falta token de lectura de GitHub');
  const get = async (path) => {
    let response;
    try {
      response = await request(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}${path}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
      });
      assert(response.ok);
      return await response.json();
    } catch {
      throw new Error('No se pudo verificar la autorización GitHub; operación bloqueada');
    }
  };
  const ref = await get(`/git/ref/${env.GITHUB_REF.slice('refs/'.length)}`);
  assert(ref.object?.sha === env.GITHUB_SHA, 'SHA obsoleto: generar una ejecución nueva');
  if (env.MIGRATION_ENVIRONMENT === 'production' && env.MIGRATION_OPERATION === 'deploy') {
    const runs = await get(
      `/actions/workflows/ci.yml/runs?head_sha=${env.GITHUB_SHA}&event=push&per_page=100`,
    );
    assertSuccessfulCi(runs.workflow_runs, env.GITHUB_SHA);
  }
}

// Contrato de salida de Prisma 6.12 fijado en el lockfile. Nunca aceptar cualquier exit 1.
export function migrationStatus(result, migrations) {
  const output = stripVTControlCharacters(result.stdout ?? '').replaceAll('\r\n', '\n');
  const errors = stripVTControlCharacters(result.stderr ?? '');
  if (
    result.error ||
    result.signal ||
    /\bP\d{4}\b|Error:|have failed|not managed/.test(output + errors)
  )
    throw new Error(
      'Prisma status falló; revisar conexión, permisos o historial (salida privada omitida)',
    );
  if (result.status === 0 && /Database schema is up to date!\s*$/.test(output))
    return { state: 'al día', pending: [] };
  const block =
    /Following migrations? have not yet been applied:\n([\s\S]+?)\n\nTo apply migrations in development run prisma migrate dev\.\nTo apply migrations in production run prisma migrate deploy\.\s*$/.exec(
      output,
    );
  const pending = block?.[1].split('\n');
  if (result.status === 1 && pending?.length && pending.every((name) => migrations.includes(name)))
    return { state: 'pendientes', pending };
  throw new Error('Prisma status no reconocible o historial incompatible; operación bloqueada');
}

export function runPrisma(operation, env, spawn = spawnSync) {
  assert(['status', 'deploy'].includes(operation), 'Operación Prisma no autorizada');
  assert(env.npm_execpath, 'Ejecutar mediante npm run database:migrate');
  const childEnv = { ...env };
  delete childEnv.GH_TOKEN;
  delete childEnv.GITHUB_TOKEN;
  // Node + npm CLI evita shells y credenciales en argumentos, también en Windows.
  return spawn(
    process.execPath,
    [
      env.npm_execpath,
      'run',
      operation === 'status' ? 'prisma:status' : 'prisma:migrate',
      '--workspace=apps/backend',
    ],
    {
      cwd: root,
      env: { ...childEnv, NO_COLOR: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' },
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}

export async function migrate(
  env,
  {
    run = runPrisma,
    authorize = authorizeMigration,
    migrations = readdirSync(resolve(root, 'apps/backend/prisma/migrations'), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
    report = (text) => {
      console.log(text);
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text + '\n');
    },
  } = {},
) {
  let result = 'fallido';
  let phase = 'validación del contexto';
  let pending = [];
  let diagnostic;
  try {
    validateMigrationContext(env);
    assert(
      migrations.every((name) => /^\d{14}_[a-z0-9_]+$/i.test(name)),
      'Nombres de migración inválidos',
    );
    phase = 'validación del destino';
    if (!assertSupabaseTarget(env, true))
      throw new SupabaseTargetError(
        'SUPABASE_URL',
        'LOCAL_TARGET',
        'Este workflow sólo admite Supabase remoto identificado',
      );
    phase = 'autorización GitHub';
    await authorize(env);
    phase = 'status inicial';
    const initial = migrationStatus(run('status', env), migrations);
    pending = initial.pending;
    if (env.MIGRATION_OPERATION === 'status') {
      result = initial.state;
      return;
    }
    // Volver a autorizar después de consultar, inmediatamente antes de la única escritura.
    phase = 'autorización previa a escritura';
    await authorize(env);
    phase = 'deploy';
    const deployed = run('deploy', env);
    assert(
      !deployed.error && !deployed.signal && deployed.status === 0,
      'Prisma deploy falló; no se reintenta ni se resuelve/reset automáticamente',
    );
    phase = 'status final';
    const final = migrationStatus(run('status', env), migrations);
    assert(final.pending.length === 0, 'Quedan migraciones pendientes después de deploy');
    result = 'aplicado y verificado';
  } catch (error) {
    diagnostic = migrationDiagnostic(error);
    throw error;
  } finally {
    // Sólo nombres locales validados; jamás stdout/stderr de Prisma, DSN ni mensajes SQL.
    const safeContext =
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') &&
      ['dev', 'production'].includes(env.MIGRATION_ENVIRONMENT) &&
      ['status', 'deploy'].includes(env.MIGRATION_OPERATION);
    report(
      `### Migraciones\n${safeContext ? `Entorno: ${env.MIGRATION_ENVIRONMENT}\nSHA: ${env.GITHUB_SHA}\nOperación: ${env.MIGRATION_OPERATION}` : 'Contexto inválido'}\nResultado: ${result}\nFase: ${phase}${diagnostic ? `\nVariable: ${diagnostic.variable}\nTipo de error: ${diagnostic.type}\nDiagnóstico: ${diagnostic.description}` : ''}\nMigraciones locales: ${migrations.length}\nPendientes antes de operar: ${pending.length ? pending.join(', ') : 'ninguna identificada'}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  migrate(process.env).catch(() => {
    console.error(
      'Operación bloqueada o fallida. Consultar el resumen y la guía de migraciones; no se muestran conexiones ni salida privada.',
    );
    process.exitCode = 1;
  });
}
