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

const prismaErrors = {
  PRISMA_AUTHENTICATION_ERROR: 'Prisma rechazó la autenticación.',
  PRISMA_CONNECTION_ERROR: 'Prisma no pudo establecer o mantener la conexión.',
  PRISMA_TLS_ERROR: 'Prisma rechazó la conexión TLS.',
  PRISMA_PERMISSION_ERROR: 'Prisma informó permisos insuficientes.',
  PRISMA_FAILED_MIGRATION: 'El historial contiene una migración fallida.',
  PRISMA_HISTORY_DIVERGED: 'El historial local y el de la base divergen.',
  PRISMA_BASELINE_REQUIRED:
    'La base no tiene un historial Prisma compatible; requiere revisión de baseline.',
  PRISMA_ENGINE_ERROR: 'El schema engine falló sin un código Prisma identificable.',
  PRISMA_ERROR: 'Prisma informó un error; consultar los códigos preservados.',
  PRISMA_EXECUTION_ERROR: 'No se pudo completar la ejecución del subproceso.',
  PRISMA_STATUS_UNRECOGNIZED: 'Salida de status no reconocida; no se autoriza deploy.',
  PRISMA_COMMAND_FAILED: 'El comando Prisma terminó con error.',
  PRISMA_PENDING_AFTER_DEPLOY:
    'Deploy terminó pero quedan migraciones pendientes; revisar antes de reintentar.',
};
class PrismaCommandError extends Error {
  constructor(type) {
    super(prismaErrors[type]);
    this.diagnostic = { variable: 'no identificada', type, description: prismaErrors[type] };
  }
}

export function prismaCommandInfo(result) {
  const output = stripVTControlCharacters(
    `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  ).replaceAll('\r\n', '\n');
  // Sólo códigos en marcadores de error del CLI/engine, nunca palabras extraídas de un DSN.
  const prismaCodes = [
    ...new Set(
      [
        ...output.matchAll(
          /(?:(?:^|\n)\s*(?:Error(?: code)?:\s*|(?=P\d{4}(?:\s|:|$)))|"error_code"\s*:\s*")(P\d{4})\b/gim,
        ),
      ].map((match) => match[1]),
    ),
  ].slice(0, 10);
  const executionCodes = [
    'ENOENT',
    'EACCES',
    'EPERM',
    'ETIMEDOUT',
    'ENOBUFS',
    'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
  ];
  const signals = ['SIGTERM', 'SIGINT', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGHUP'];
  return {
    exitCode:
      Number.isSafeInteger(result.status) && result.status >= 0 ? result.status : 'no disponible',
    prismaCodes,
    executionCode: result.error
      ? executionCodes.includes(result.error.code)
        ? result.error.code
        : 'EXECUTION_FAILED'
      : 'ninguno',
    signal: result.signal
      ? signals.includes(result.signal)
        ? result.signal
        : 'SIGNAL_RECEIVED'
      : 'ninguna',
    stdoutBytes: Buffer.byteLength(result.stdout ?? ''),
    stderrBytes: Buffer.byteLength(result.stderr ?? ''),
  };
}

function assertPrismaResult(result) {
  if (result.error || result.signal || result.status === null || result.status === undefined)
    throw new PrismaCommandError('PRISMA_EXECUTION_ERROR');
  const output = stripVTControlCharacters(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  const { prismaCodes } = prismaCommandInfo(result);
  const types = {
    P1000: 'PRISMA_AUTHENTICATION_ERROR',
    P1001: 'PRISMA_CONNECTION_ERROR',
    P1002: 'PRISMA_CONNECTION_ERROR',
    P1008: 'PRISMA_CONNECTION_ERROR',
    P1017: 'PRISMA_CONNECTION_ERROR',
    P1010: 'PRISMA_PERMISSION_ERROR',
    P1011: 'PRISMA_TLS_ERROR',
    P3005: 'PRISMA_BASELINE_REQUIRED',
    P3009: 'PRISMA_FAILED_MIGRATION',
    P3018: 'PRISMA_FAILED_MIGRATION',
  };
  if (prismaCodes.length) throw new PrismaCommandError(types[prismaCodes[0]] ?? 'PRISMA_ERROR');
  if (
    /Your local migration history and the migrations table from your database are different/.test(
      output,
    )
  )
    throw new PrismaCommandError('PRISMA_HISTORY_DIVERGED');
  if (/Following migrations? have failed:/.test(output))
    throw new PrismaCommandError('PRISMA_FAILED_MIGRATION');
  if (/not managed by Prisma Migrate/.test(output))
    throw new PrismaCommandError('PRISMA_BASELINE_REQUIRED');
  if (/Schema engine error:/i.test(output)) throw new PrismaCommandError('PRISMA_ENGINE_ERROR');
  if (/^\s*Error:/im.test(output)) throw new PrismaCommandError('PRISMA_ERROR');
}

// No interpretar ni imprimir error.message/stack/cause: sólo metadata y textos permitidos.
export function migrationDiagnostic(error) {
  if (error instanceof PrismaCommandError) return error.diagnostic;
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
  assertPrismaResult(result);
  const output = stripVTControlCharacters(result.stdout ?? '').replaceAll('\r\n', '\n');
  if (result.status === 0 && /Database schema is up to date!\s*$/.test(output))
    return { state: 'al día', pending: [] };
  const block =
    /Following migrations? have not yet been applied:\n([\s\S]+?)\n\nTo apply migrations in development run prisma migrate dev\.\nTo apply migrations in production run prisma migrate deploy\.\s*$/.exec(
      output,
    );
  const pending = block?.[1].split('\n');
  if (result.status === 1 && pending?.length && pending.every((name) => migrations.includes(name)))
    return { state: 'pendientes', pending };
  throw new PrismaCommandError('PRISMA_STATUS_UNRECOGNIZED');
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
  const commands = [];
  const execute = (operation) => {
    let value;
    try {
      value = run(operation, env);
    } catch (error) {
      value = { status: null, error };
    }
    commands.push({ phase, operation, ...prismaCommandInfo(value) });
    return value;
  };
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
    const initial = migrationStatus(execute('status'), migrations);
    pending = initial.pending;
    if (env.MIGRATION_OPERATION === 'status') {
      result = initial.state;
      return;
    }
    // Volver a autorizar después de consultar, inmediatamente antes de la única escritura.
    phase = 'autorización previa a escritura';
    await authorize(env);
    phase = 'deploy';
    const deployed = execute('deploy');
    assertPrismaResult(deployed);
    if (deployed.status !== 0) throw new PrismaCommandError('PRISMA_COMMAND_FAILED');
    phase = 'status final';
    const final = migrationStatus(execute('status'), migrations);
    if (final.pending.length !== 0) throw new PrismaCommandError('PRISMA_PENDING_AFTER_DEPLOY');
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
    for (const command of commands)
      report(
        `Subproceso: prisma migrate ${command.operation} (${command.phase})\nExit code: ${command.exitCode}\nCódigos Prisma: ${command.prismaCodes.join(', ') || 'ninguno informado'}\nError de ejecución: ${command.executionCode}\nSeñal: ${command.signal}\nCaptura: stdout ${command.stdoutBytes} bytes; stderr ${command.stderrBytes} bytes (contenido privado omitido)`,
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
