import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const postgresImage =
  'postgres:16-alpine@sha256:890480b08124ce7f79960a9bb16fe39729aa302bd384bfd7c408fee6c8f7adb7';
const label = 'io.turnosmart.recovery-session';
const database = 'turnosmart_restore';
const magic = Buffer.from('TSB1');
const environments = ['local', 'staging', 'production'];
const identifier = /^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/;
const digest = /^[a-f0-9]{64}$/;
const activeChildren = new Set();
let interrupted = false;
let cleaningUp = false;
let interruptCode = 1;
export class BackupError extends Error {}
const requireThat = (condition, message) => {
  if (!condition) throw new BackupError(message);
};

// Never forward connection URLs, key locations, or ambient libpq overrides to tools.
export function toolEnvironment(extra = {}) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|SYSTEMDRIVE|DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG)$/i.test(
          key,
        ),
      ),
    ),
    ...extra,
  };
}

function launch(
  file,
  args,
  { env = toolEnvironment(), timeout = 600_000, toolLabel = basename(file) } = {},
) {
  requireThat(!interrupted || cleaningUp, 'Operación interrumpida.');
  const powershell = file.toLowerCase().endsWith('.ps1');
  const child = spawn(
    powershell ? 'pwsh' : file,
    powershell ? ['-NoProfile', '-NonInteractive', '-File', file, ...args] : args,
    { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  // Drain diagnostics without logging SQL, values, connection strings or credentials.
  child.stderr.resume();
  activeChildren.add(child);
  child.stdin.on('error', () => {});
  const timer = setTimeout(() => child.kill(), timeout);
  const done = new Promise((res, rej) => {
    child.once('error', () => rej(new BackupError(`${toolLabel} no pudo ejecutarse.`)));
    child.once('close', (code) =>
      code === 0
        ? res()
        : rej(new BackupError(`${toolLabel} falló (código ${code ?? 'interrumpido'}).`)),
    );
  }).finally(() => {
    clearTimeout(timer);
    activeChildren.delete(child);
  });
  // A caller may be busy draining stdout before it awaits the exit status.
  done.catch(() => {});
  return { child, done };
}

export async function run(file, args, options = {}) {
  const { child, done } = launch(file, args, options);
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output += chunk;
    if (output.length > 8 * 1024 * 1024) child.kill();
  });
  child.stdin.end(options.input ?? '');
  await done;
  requireThat(output.length <= 8 * 1024 * 1024, 'Respuesta de herramienta demasiado grande.');
  return output.trim();
}

export async function outsideRepository(input, { root = repository, existing = false } = {}) {
  requireThat(
    typeof input === 'string' && input.length > 0 && !input.includes('\0'),
    'Falta una ruta válida.',
  );
  const target = resolve(input);
  const rel = relative(root, target);
  requireThat(
    rel !== '' && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)),
    'Los backups, claves y temporales deben estar fuera del repositorio.',
  );
  for (let cursor = target; ; cursor = dirname(cursor)) {
    try {
      requireThat(
        !(await fs.lstat(cursor)).isSymbolicLink(),
        'No se admiten enlaces o junctions en las rutas de backup.',
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (dirname(cursor) === cursor) break;
  }
  if (existing) requireThat((await fs.stat(target)).isFile(), 'El archivo no es válido.');
  // Resolve physical ancestors as well (including Windows short-name/namespace aliases).
  let ancestor = target;
  const missing = [];
  let physical;
  for (;;) {
    try {
      physical = await fs.realpath(ancestor);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.unshift(basename(ancestor));
      const parent = dirname(ancestor);
      requireThat(parent !== ancestor, 'No se pudo resolver el destino físico.');
      ancestor = parent;
    }
  }
  physical = resolve(physical, ...missing);
  const physicalRelative = relative(await fs.realpath(root), physical);
  requireThat(
    physicalRelative === '..' ||
      physicalRelative.startsWith('..' + sep) ||
      isAbsolute(physicalRelative),
    'Los backups, claves y temporales deben estar físicamente fuera del repositorio.',
  );
  return physical;
}

async function protect(path, checkOnly = false) {
  if (process.platform === 'win32') {
    await run('pwsh', [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(repository, 'scripts/protect-backup-path.ps1'),
      '-LiteralPath',
      path,
      ...(checkOnly ? ['-CheckOnly'] : []),
    ]);
  } else if (checkOnly) {
    const stat = await fs.stat(path);
    requireThat(
      (stat.mode & 0o077) === 0 && stat.uid === process.getuid(),
      'La clave debe ser privada (modo 600).',
    );
  } else await fs.chmod(path, (await fs.stat(path)).isDirectory() ? 0o700 : 0o600);
}

async function workspace(base) {
  await fs.mkdir(base, { recursive: true });
  const path = await fs.mkdtemp(join(base, '.turnosmart-backup-'));
  const token = randomUUID();
  try {
    await protect(path);
    await fs.writeFile(join(path, '.owner'), token, { flag: 'wx', mode: 0o600 });
    return { path, base, token };
  } catch (error) {
    await fs.rmdir(path).catch(() => {});
    throw error;
  }
}

export async function removeWorkspace(work) {
  const path = resolve(work.path);
  requireThat(
    dirname(path) === resolve(work.base) && basename(path).startsWith('.turnosmart-backup-'),
    'Limpieza fuera de alcance.',
  );
  requireThat(
    !(await fs.lstat(path)).isSymbolicLink(),
    'No se elimina un workspace reemplazado por un enlace.',
  );
  requireThat(
    (await fs.readFile(join(path, '.owner'), 'utf8')) === work.token,
    'Workspace ajeno: no se elimina.',
  );
  // fs.rm removes links themselves, never their referents. Only this newly created directory.
  await fs.rm(path, { recursive: true });
}

export async function generateKey(keyFile) {
  const target = await outsideRepository(keyFile);
  await fs.mkdir(dirname(target), { recursive: true });
  const handle = await fs.open(target, 'wx', 0o600);
  try {
    // On Windows protect the empty file before writing any secret bytes.
    await protect(target);
    await handle.writeFile(randomBytes(32));
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.unlink(target);
    throw error;
  }
  await handle.close();
  return { keyFile: target, created: true };
}

async function readKey(file) {
  const path = await outsideRepository(file, { existing: true });
  await protect(path, true);
  requireThat(
    (await fs.stat(path)).size === 32,
    'La clave debe contener exactamente 32 bytes aleatorios.',
  );
  return fs.readFile(path);
}

export function parseConnection(value, expectedDatabase, mode = 'direct') {
  requireThat(value, 'DIRECT_URL no está configurada. No se usa DATABASE_URL como fallback.');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BackupError('DIRECT_URL no es una conexión PostgreSQL válida.');
  }
  requireThat(
    ['postgres:', 'postgresql:'].includes(url.protocol),
    'Protocolo de conexión inválido.',
  );
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = url.port || '5432';
  const name = decodeURIComponent(url.pathname.slice(1));
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  requireThat(
    identifier.test(name) && name === expectedDatabase,
    'La base origen no coincide con ExpectedDatabase.',
  );
  requireThat(
    identifier.test(user) && password.length > 0 && !/[\r\n\0]/.test(password + host),
    'Faltan credenciales válidas para el backup.',
  );
  requireThat(
    ['direct', 'session'].includes(mode) && port !== '6543' && !url.searchParams.has('pgbouncer'),
    'pg_dump requiere conexión directa o session pooler; no transaction pooler.',
  );
  requireThat(
    !host.endsWith('.pooler.supabase.com') || mode === 'session',
    'El pooler debe declararse como session.',
  );
  requireThat(
    [...url.searchParams.keys()].every((k) => k === 'sslmode'),
    'Opciones de conexión no admitidas.',
  );
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const sslmode = url.searchParams.get('sslmode') ?? (local ? 'disable' : 'verify-full');
  requireThat(
    local ? ['disable', 'require', 'verify-full'].includes(sslmode) : sslmode === 'verify-full',
    'La conexión remota requiere sslmode=verify-full y un certificado raíz confiable.',
  );
  const escape = (text) => text.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
  return {
    env: {
      PGHOST: host,
      PGPORT: port,
      PGDATABASE: name,
      PGUSER: user,
      PGSSLMODE: sslmode,
      ...(process.env.PGSSLROOTCERT ? { PGSSLROOTCERT: process.env.PGSSLROOTCERT } : {}),
    },
    passfile: [host, port, name, user, password].map(escape).join(':') + '\n',
  };
}

export async function localDocker(execute = run) {
  const endpoint =
    process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
      ? process.env.DOCKER_HOST
      : await execute('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  requireThat(
    /^(npipe:\/\/\/\/\.\/pipe\/[^/\\]+|unix:\/\/\/[^\r\n]+)$/.test(endpoint.trim()),
    'Se requiere un daemon Docker local; destinos remotos prohibidos.',
  );
}

const pgArguments = (user, name) => [
  '--host=/var/run/postgresql',
  '--port=5432',
  '--username=' + user,
  '--dbname=' + name,
  '--no-password',
];
const psqlArguments = (user, name, sql) => [
  ...pgArguments(user, name),
  '-X',
  '-A',
  '-t',
  '-v',
  'ON_ERROR_STOP=1',
  '-c',
  sql,
];
const identitySql = `SELECT json_build_object('database',current_database(),'user',current_user,
 'serverVersion',current_setting('server_version_num')::int,
 'owner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),
 'databasePrivileges',(SELECT coalesce(json_agg(json_build_object('role',coalesce(r.rolname,'PUBLIC'),'privilege',a.privilege_type,'grantable',a.is_grantable)),'[]') FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE d.datname=current_database()),
 'migrationTable',to_regclass('public._prisma_migrations') IS NOT NULL,
 'extensions',(SELECT coalesce(json_agg(json_build_object('name',extname,'version',extversion)),'[]') FROM pg_extension),
 'roles',(SELECT coalesce(json_agg(json_build_object('name',rolname,'inherit',rolinherit,'bypass',rolbypassrls)),'[]') FROM pg_roles WHERE rolname !~ '^pg_'),
 'memberships',(SELECT coalesce(json_agg(json_build_object('role',r.rolname,'member',m.rolname,'admin',a.admin_option)),'[]')
 FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member WHERE m.rolname !~ '^pg_'));`;

async function source(options, work) {
  if (options.sourceContainer) {
    requireThat(
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(options.sourceContainer),
      'Contenedor origen inválido.',
    );
    requireThat(identifier.test(options.databaseUser ?? 'postgres'), 'Usuario inválido.');
    await localDocker();
    const inspected = JSON.parse(
      await run('docker', ['inspect', '--type=container', options.sourceContainer]),
    );
    requireThat(
      digest.test(inspected[0]?.Id) && inspected[0]?.State?.Running,
      'El contenedor origen no está activo.',
    );
    const container = inspected[0].Id;
    const user = options.databaseUser ?? 'postgres';
    return {
      query: (sql) =>
        run('docker', ['exec', container, 'psql', ...psqlArguments(user, options.database, sql)]),
      version: () => run('docker', ['exec', container, 'pg_dump', '--version']),
      dump: () =>
        launch(
          'docker',
          [
            'exec',
            container,
            'pg_dump',
            ...pgArguments(user, options.database),
            '--format=custom',
            '--no-tablespaces',
          ],
          { toolLabel: 'pg_dump' },
        ),
    };
  }
  const connection = parseConnection(
    process.env.DIRECT_URL,
    options.database,
    options.connectionMode,
  );
  const pgpass = join(work.path, 'pgpass');
  await fs.writeFile(pgpass, connection.passfile, { flag: 'wx', mode: 0o600 });
  const env = toolEnvironment({ ...connection.env, PGPASSFILE: pgpass });
  return {
    query: (sql) =>
      run(options.psql ?? 'psql', ['-X', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
        env,
      }),
    version: () => run(options.pgDump ?? 'pg_dump', ['--version'], { env }),
    dump: () =>
      launch(
        options.pgDump ?? 'pg_dump',
        ['--format=custom', '--no-tablespaces', '--no-password'],
        { env },
      ),
  };
}

function hashStream() {
  const hash = createHash('sha256');
  let prefix = Buffer.alloc(0);
  const stream = new Transform({
    transform(chunk, _, callback) {
      hash.update(chunk);
      if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk]).subarray(0, 5);
      callback(null, chunk);
    },
  });
  return {
    stream,
    result: () => ({ sha256: hash.digest('hex'), header: prefix.toString('ascii') }),
  };
}

async function checksum(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function encryptDump(producer, target, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('turnosmart:dump:v1'));
  await fs.writeFile(target, Buffer.concat([magic, iv]), { flag: 'wx', mode: 0o600 });
  const hash = hashStream();
  producer.child.stdin.end();
  const copying = pipeline(
    producer.child.stdout,
    hash.stream,
    cipher,
    createWriteStream(target, { flags: 'a' }),
  );
  try {
    await Promise.all([copying, producer.done]);
    await fs.appendFile(target, cipher.getAuthTag());
    const plain = hash.result();
    requireThat(plain.header === 'PGDMP', 'pg_dump no produjo un archivo custom válido.');
    return plain.sha256;
  } catch (error) {
    producer.child.kill();
    await Promise.allSettled([copying, producer.done]);
    throw error;
  }
}

export function encryptMetadata(value, key) {
  const plaintext = Buffer.from(JSON.stringify(value));
  requireThat(
    plaintext.length + 32 <= 4 * 1024 * 1024,
    'Metadata demasiado grande; no se publica un backup que exceda el límite de recuperación.',
  );
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('turnosmart:metadata:v1'));
  return Buffer.concat([magic, iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

export function decryptMetadata(bytes, key) {
  requireThat(
    bytes.length >= 32 && bytes.subarray(0, 4).equals(magic),
    'Metadata cifrada inválida.',
  );
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(4, 16));
  decipher.setAAD(Buffer.from('turnosmart:metadata:v1'));
  decipher.setAuthTag(bytes.subarray(-16));
  try {
    return JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(16, -16)), decipher.final()]).toString(),
    );
  } catch {
    throw new BackupError('Clave incorrecta o metadata alterada.');
  }
}

export async function backup(options) {
  requireThat(
    environments.includes(options.environment) && identifier.test(options.database ?? ''),
    'Entorno y base origen explícitos requeridos.',
  );
  const directory = await outsideRepository(
    options.outputDirectory ?? join(homedir(), '.turnosmart', 'backups'),
  );
  const keyRelative = relative(
    directory,
    await outsideRepository(options.keyFile, { existing: true }),
  );
  requireThat(
    keyRelative.startsWith('..' + sep) || isAbsolute(keyRelative),
    'La clave debe guardarse separada del directorio de backups.',
  );
  const key = await readKey(options.keyFile);
  let work;
  let credentialWork;
  const published = [];
  let committed = false;
  try {
    work = await workspace(directory);
    if (!options.sourceContainer) {
      const credentialsBase = await outsideRepository(
        process.platform === 'win32'
          ? join(process.env.LOCALAPPDATA ?? tmpdir(), 'TurnoSmart', 'backup-staging')
          : join(tmpdir(), 'turnosmart-backup-staging'),
      );
      credentialWork = await workspace(credentialsBase);
    }
    const pg = await source(options, credentialWork ?? work);
    const identity = JSON.parse(await pg.query(identitySql));
    requireThat(
      identity.database === options.database && identity.migrationTable === true,
      'Origen incorrecto: no es la base TurnoSmart esperada.',
    );
    const major = Math.floor(identity.serverVersion / 10000);
    const version = await pg.version();
    requireThat(
      Number(/\b(\d+)\./.exec(version)?.[1]) === major,
      'pg_dump y servidor deben tener la misma versión mayor.',
    );
    const sha = await run('git', ['-C', repository, 'rev-parse', 'HEAD']);
    requireThat(/^[a-f0-9]{40}$/.test(sha), 'No se pudo identificar el SHA del repositorio.');
    const dirty = (await run('git', ['-C', repository, 'status', '--porcelain'])).length > 0;
    const createdAt = new Date().toISOString();
    const stem = `turnosmart-${options.environment}-${createdAt.replace(/[-:.]/g, '')}-${sha.slice(0, 12)}-${randomBytes(8).toString('hex')}`;
    const dumpName = stem + '.dump.enc';
    const metadataName = stem + '.meta.enc';
    const dumpPath = join(work.path, dumpName);
    const plainSha256 = await encryptDump(pg.dump(), dumpPath, key);
    const metadata = {
      version: 1,
      environment: options.environment,
      createdAt,
      sha,
      dirty,
      major,
      identity,
      plainSha256,
    };
    validateMetadata(metadata, metadata);
    await fs.writeFile(join(work.path, metadataName), encryptMetadata(metadata, key), {
      flag: 'wx',
      mode: 0o600,
    });
    const index = {
      version: 1,
      environment: options.environment,
      createdAt,
      sha,
      dirty,
      dumpFile: dumpName,
      metadataFile: metadataName,
      dumpSha256: await checksum(dumpPath),
      metadataSha256: await checksum(join(work.path, metadataName)),
    };
    const indexName = stem + '.backup.json';
    await fs.writeFile(join(work.path, indexName), JSON.stringify(index, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    // Exclusive hard links: never overwrite a previous backup. Index is the commit marker.
    for (const name of [dumpName, metadataName, indexName]) {
      const file = await fs.open(join(work.path, name), 'r+');
      try {
        await file.sync();
      } finally {
        await file.close();
      }
      const destination = join(directory, name);
      await fs.link(join(work.path, name), destination);
      published.push(destination);
    }
    committed = true;
    return {
      backupFile: join(directory, indexName),
      environment: options.environment,
      createdAt,
      sha,
      dirty,
      dumpSha256: index.dumpSha256,
    };
  } finally {
    key.fill(0);
    const cleanups = [
      ...(credentialWork ? [removeWorkspace(credentialWork)] : []),
      ...(work ? [removeWorkspace(work)] : []),
      ...(!committed ? published.map((path) => fs.unlink(path)) : []),
    ];
    const cleaned = await Promise.allSettled(cleanups);
    requireThat(
      cleaned.every((result) => result.status === 'fulfilled'),
      'No se completó la limpieza privada; revisar el staging y los artefactos antes de continuar.',
    );
  }
}

function validateMetadata(metadata, index) {
  requireThat(
    metadata?.version === 1 &&
      ['environment', 'sha', 'createdAt', 'dirty'].every((k) => metadata[k] === index[k]) &&
      Number.isInteger(metadata.major) &&
      metadata.major >= 16 &&
      metadata.major <= 19 &&
      digest.test(metadata.plainSha256),
    'Metadata de backup incoherente.',
  );
  const identity = metadata.identity;
  requireThat(
    identity?.migrationTable === true &&
      identifier.test(identity.owner) &&
      Array.isArray(identity.roles) &&
      identity.roles.length <= 512 &&
      identity.roles.every(
        (role) =>
          identifier.test(role.name) &&
          typeof role.inherit === 'boolean' &&
          typeof role.bypass === 'boolean',
      ) &&
      Array.isArray(identity.memberships) &&
      identity.memberships.every(
        (m) => identifier.test(m.role) && identifier.test(m.member) && typeof m.admin === 'boolean',
      ),
    'Inventario de roles inválido.',
  );
  requireThat(
    Array.isArray(identity.databasePrivileges) &&
      identity.databasePrivileges.every(
        (p) =>
          identifier.test(p.role) &&
          ['CONNECT', 'CREATE', 'TEMPORARY'].includes(p.privilege) &&
          typeof p.grantable === 'boolean',
      ),
    'Permisos de base inválidos.',
  );
  requireThat(
    Array.isArray(identity.extensions) &&
      identity.extensions.length <= 128 &&
      identity.extensions.every(
        (e) => identifier.test(e.name) && /^[A-Za-z0-9_.+-]{1,64}$/.test(e.version),
      ),
    'Inventario de extensiones inválido.',
  );
}

async function readBackup(file, key, environment) {
  const path = await outsideRepository(file, { existing: true });
  requireThat(
    path.endsWith('.backup.json') && (await fs.stat(path)).size <= 65536,
    'Se requiere el índice .backup.json.',
  );
  const index = JSON.parse(await fs.readFile(path, 'utf8'));
  const stem = basename(path).slice(0, -'.backup.json'.length);
  requireThat(
    index.version === 1 &&
      environments.includes(environment) &&
      index.environment === environment &&
      /^[a-f0-9]{40}$/.test(index.sha) &&
      digest.test(index.dumpSha256) &&
      digest.test(index.metadataSha256) &&
      index.dumpFile === stem + '.dump.enc' &&
      index.metadataFile === stem + '.meta.enc',
    'Índice o entorno del backup inválido.',
  );
  const dumpPath = await outsideRepository(join(dirname(path), index.dumpFile), { existing: true });
  const metaPath = await outsideRepository(join(dirname(path), index.metadataFile), {
    existing: true,
  });
  requireThat((await fs.stat(metaPath)).size <= 4 * 1024 * 1024, 'Metadata demasiado grande.');
  requireThat(
    (await checksum(dumpPath)) === index.dumpSha256 &&
      (await checksum(metaPath)) === index.metadataSha256,
    'Checksum del backup inválido.',
  );
  const metadata = decryptMetadata(await fs.readFile(metaPath), key);
  validateMetadata(metadata, index);
  return { dumpPath, metadata };
}

export function validateTarget(name, image, major, memory) {
  requireThat(
    /^turnosmart-restore-[a-z0-9][a-z0-9-]{7,80}$/.test(name),
    'El destino debe ser un nuevo contenedor turnosmart-restore-*.',
  );
  requireThat(
    new RegExp(`^postgres:${major}-alpine@sha256:[a-f0-9]{64}$`).test(image),
    'La imagen debe ser postgres oficial, fijada por digest y de la misma versión mayor.',
  );
  requireThat(
    Number.isInteger(memory) && memory >= 256 && memory <= 16384,
    'Límite de memoria inválido.',
  );
}

export function validateImageConfig(config) {
  requireThat(
    config &&
      Object.keys(config.Volumes ?? {}).every((path) => path === '/var/lib/postgresql/data'),
    'Layout de volúmenes de la imagen no compatible; no se crea un destino con volúmenes anónimos.',
  );
}

async function inspectOwned(id, token) {
  requireThat(
    digest.test(id) && /^[a-f0-9-]{36}$/.test(token),
    'Identidad de recuperación inválida.',
  );
  const container = JSON.parse(await run('docker', ['inspect', '--type=container', id]))[0];
  requireThat(
    container?.Id === id &&
      container.Config?.Labels?.[label] === token &&
      /^\/turnosmart-restore-/.test(container.Name) &&
      container.HostConfig?.NetworkMode === 'none' &&
      Object.keys(container.HostConfig?.PortBindings ?? {}).length === 0 &&
      (container.Mounts ?? []).every((m) => m.Type === 'tmpfs'),
    'El destino no coincide con una recuperación local aislada creada por este script.',
  );
  return container;
}

export async function cleanupRecovery(id, token) {
  await localDocker();
  await inspectOwned(id, token);
  await run('docker', ['rm', '--force', id]);
  return { removed: true };
}

const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
async function queryTarget(id, sql) {
  return run('docker', ['exec', id, 'psql', ...psqlArguments('postgres', database, sql)]);
}

async function decryptToContainer(path, key, id, expectedHash) {
  const size = (await fs.stat(path)).size;
  requireThat(size > 32, 'Dump cifrado vacío.');
  const handle = await fs.open(path, 'r');
  const header = Buffer.alloc(16),
    tag = Buffer.alloc(16);
  try {
    await handle.read(header, 0, 16, 0);
    await handle.read(tag, 0, 16, size - 16);
  } finally {
    await handle.close();
  }
  requireThat(header.subarray(0, 4).equals(magic), 'Formato de dump inválido.');
  const decrypt = createDecipheriv('aes-256-gcm', key, header.subarray(4));
  decrypt.setAAD(Buffer.from('turnosmart:dump:v1'));
  decrypt.setAuthTag(tag);
  const writer = launch('docker', [
    'exec',
    '-i',
    id,
    'sh',
    '-c',
    'umask 077; cat > /tmp/turnosmart.dump',
  ]);
  writer.child.stdout.resume();
  const hash = hashStream();
  const copying = pipeline(
    createReadStream(path, { start: 16, end: size - 17 }),
    decrypt,
    hash.stream,
    writer.child.stdin,
  );
  try {
    // Unauthenticated plaintext goes only to tmpfs. SQL is not executed until GCM verifies.
    await Promise.all([copying, writer.done]);
    const plain = hash.result();
    requireThat(
      plain.sha256 === expectedHash && plain.header === 'PGDMP',
      'Dump descifrado inválido.',
    );
  } catch {
    writer.child.kill();
    await Promise.allSettled([copying, writer.done]);
    throw new BackupError('Clave incorrecta, dump alterado o escritura temporal fallida.');
  }
}

export async function restore(options) {
  const started = performance.now();
  const key = await readKey(options.keyFile);
  let id, token, name;
  let success = false;
  try {
    const { dumpPath, metadata } = await readBackup(options.backupFile, key, options.environment);
    name =
      options.targetName ?? `turnosmart-restore-${Date.now()}-${randomBytes(6).toString('hex')}`;
    const image = options.image ?? postgresImage;
    const memory = Number(options.memoryMb ?? 1024);
    validateTarget(name, image, metadata.major, memory);
    await localDocker();
    validateImageConfig(JSON.parse(await run('docker', ['image', 'inspect', image]))[0]?.Config);
    // docker run must create a NEW named resource; a collision fails without touching it.
    token = randomUUID();
    id = await run('docker', [
      'run',
      '--detach',
      '--pull=never',
      '--name',
      name,
      '--label',
      `${label}=${token}`,
      '--network=none',
      '--read-only',
      '--user=postgres',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=128',
      `--memory=${memory}m`,
      '--cpus=1',
      '--tmpfs',
      `/var/lib/postgresql/data:rw,noexec,nosuid,uid=70,gid=70,mode=0700,size=${Math.floor(memory * 0.6)}m`,
      '--tmpfs',
      '/var/run/postgresql:rw,noexec,nosuid,uid=70,gid=70,mode=0770,size=16m',
      '--tmpfs',
      `/tmp:rw,noexec,nosuid,size=${Math.floor(memory * 0.3)}m`,
      '--env',
      `POSTGRES_DB=${database}`,
      '--env',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      image,
      'postgres',
      '-c',
      'listen_addresses=',
      '-c',
      'shared_buffers=32MB',
    ]);
    await inspectOwned(id, token);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      requireThat(!interrupted, 'Operación interrumpida.');
      try {
        await queryTarget(id, 'SELECT 1');
        ready = true;
        break;
      } catch {
        await new Promise((res) => setTimeout(res, 500));
      }
    }
    requireThat(ready, 'PostgreSQL descartable no inició.');
    const target = JSON.parse(
      await queryTarget(
        id,
        `SELECT json_build_object('database',current_database(),'user',current_user,'major',current_setting('server_version_num')::int/10000,'tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'));`,
      ),
    );
    requireThat(
      target.database === database &&
        target.user === 'postgres' &&
        target.major === metadata.major &&
        target.tables === 0,
      'La identidad del destino no coincide o la base no está vacía.',
    );
    const available = JSON.parse(
      await queryTarget(
        id,
        `SELECT coalesce(json_agg(json_build_object('name',name,'version',version)),'[]') FROM pg_available_extension_versions;`,
      ),
    );
    const missing = metadata.identity.extensions.filter(
      (e) => !available.some((a) => a.name === e.name && a.version === e.version),
    );
    requireThat(
      missing.length === 0,
      'Extensiones/versiones no disponibles en la imagen de recuperación: ' +
        missing.map((e) => `${e.name}@${e.version}`).join(', '),
    );
    const roles = metadata.identity.roles.filter(
      (role) => role.name !== 'postgres' && !role.name.startsWith('pg_'),
    );
    const statements = roles.map(
      (role) =>
        `CREATE ROLE ${quote(role.name)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION ${role.inherit ? 'INHERIT' : 'NOINHERIT'} ${role.bypass ? 'BYPASSRLS' : 'NOBYPASSRLS'};`,
    );
    for (const m of metadata.identity.memberships)
      statements.push(
        `GRANT ${quote(m.role)} TO ${quote(m.member)}${m.admin ? ' WITH ADMIN OPTION' : ''};`,
      );
    statements.push(
      `ALTER DATABASE ${quote(database)} OWNER TO ${quote(metadata.identity.owner)};`,
    );
    statements.push(`REVOKE ALL ON DATABASE ${quote(database)} FROM PUBLIC;`);
    for (const p of metadata.identity.databasePrivileges)
      statements.push(
        `GRANT ${p.privilege} ON DATABASE ${quote(database)} TO ${p.role === 'PUBLIC' ? 'PUBLIC' : quote(p.role)}${p.grantable ? ' WITH GRANT OPTION' : ''};`,
      );
    await queryTarget(id, 'BEGIN;\n' + statements.join('\n') + '\nCOMMIT;');
    await decryptToContainer(dumpPath, key, id, metadata.plainSha256);
    await run('docker', ['exec', id, 'pg_restore', '--list', '/tmp/turnosmart.dump'], {
      toolLabel: 'pg_restore',
    });
    await run(
      'docker',
      [
        'exec',
        id,
        'pg_restore',
        ...pgArguments('postgres', database),
        '--single-transaction',
        '--exit-on-error',
        '/tmp/turnosmart.dump',
      ],
      { toolLabel: 'pg_restore' },
    );
    const verification = JSON.parse(
      await queryTarget(
        id,
        `SELECT json_build_object('tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'), 'migrations',(SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL), 'failedMigrations',(SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL), 'unvalidatedConstraints',(SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated), 'rlsTables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity));`,
      ),
    );
    requireThat(
      verification.tables > 0 &&
        verification.migrations > 0 &&
        verification.failedMigrations === 0 &&
        verification.unvalidatedConstraints === 0 &&
        verification.rlsTables > 0,
      'Falló la verificación de esquema, migraciones o consistencia.',
    );
    await run('docker', ['exec', id, 'rm', '--', '/tmp/turnosmart.dump']);
    success = true;
    return {
      containerId: id,
      containerName: name,
      cleanupToken: token,
      database,
      recoverySeconds: Number(((performance.now() - started) / 1000).toFixed(3)),
      verification,
    };
  } finally {
    key.fill(0);
    cleaningUp = true;
    try {
      if (!id && token && name) {
        // docker run can fail after creating a container. Never remove a name collision.
        try {
          const candidate = JSON.parse(
            await run('docker', ['inspect', '--type=container', name]),
          )[0];
          if (candidate?.Config?.Labels?.[label] === token) id = candidate.Id;
        } catch {
          /* No owned resource was created. */
        }
      }
      if (id && (!success || interrupted)) await cleanupRecovery(id, token);
    } finally {
      cleaningUp = false;
    }
  }
}

async function main() {
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ])
    process.on(signal, () => {
      if (interrupted) return;
      interrupted = true;
      interruptCode = code;
      if (!cleaningUp) for (const child of activeChildren) child.kill();
    });
  requireThat(process.versions.node.split('.')[0] === '22', 'Se requiere Node.js 22.x.');
  const [operation, ...args] = process.argv.slice(2);
  const allowed = new Set([
    'key-file',
    'environment',
    'database',
    'connection-mode',
    'database-user',
    'pg-dump',
    'psql',
    'output-directory',
    'source-container',
    'backup-file',
    'target-name',
    'image',
    'memory-mb',
    'container-id',
    'session-token',
  ]);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].slice(2);
    requireThat(
      args[i].startsWith('--') && allowed.has(name) && typeof args[i + 1] === 'string',
      'Argumentos inválidos.',
    );
    options[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = args[i + 1];
  }
  let result;
  if (operation === 'init-key') result = await generateKey(options.keyFile);
  else if (operation === 'backup') result = await backup(options);
  else if (operation === 'restore') result = await restore(options);
  else if (operation === 'cleanup')
    result = await cleanupRecovery(options.containerId, options.sessionToken);
  else throw new BackupError('Operación inválida.');
  requireThat(!interrupted, 'Operación interrumpida; se ejecutó la limpieza segura.');
  console.log(JSON.stringify(result));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(
      error instanceof BackupError
        ? error.message
        : 'La operación falló; no se confirmó un backup ni una recuperación correctos.',
    );
    process.exitCode = interrupted ? interruptCode : 1;
  });
}
