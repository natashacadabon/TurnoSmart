import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const [source, production, artifact] = process.argv.slice(2);
if (process.platform !== 'linux' || process.versions.node.split('.')[0] !== '22')
  throw new Error('El artefacto requiere Linux/Node 22');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
// Materializar shared elimina enlaces workspace y rutas fuera del ZIP.
const modules = join(artifact, 'node_modules');
mkdirSync(modules, { recursive: true });
const backend = read(join(source, 'apps/backend/package.json'));
const shared = read(join(source, 'packages/shared/package.json'));
// npm puede retener Prisma CLI como peer opcional aun con --omit=dev.
// Copiar solo el cierre runtime evita CLI y dependencias huerfanas de tooling.
const packages = new Set();
function locate(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) return null;
  }
}
function visitDependencies(manifest, from) {
  const required = { ...manifest.dependencies };
  for (const [name, version] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!manifest.peerDependenciesMeta?.[name]?.optional) required[name] ??= version;
  }
  const optional = manifest.optionalDependencies ?? {};
  for (const name of Object.keys({ ...required, ...optional })) {
    if (name === '@turnosmart/shared') {
      visitDependencies(shared, join(production, 'packages/shared'));
      continue;
    }
    const path = locate(name, from);
    if (!path && name in optional) continue;
    if (!path) throw new Error(`Dependencia runtime ausente: ${name}`);
    if (packages.has(path)) continue;
    packages.add(path);
    visitDependencies(read(join(path, 'package.json')), path);
  }
}
visitDependencies(backend, join(production, 'apps/backend'));
for (const path of packages) {
  const target = relative(production, path);
  if (!target.startsWith('node_modules/'))
    throw new Error('Workspace inesperado en cierre runtime');
  cpSync(path, join(artifact, target), {
    recursive: true,
    dereference: true,
    filter: (file) => file === path || !relative(path, file).split('/').includes('node_modules'),
  });
}
cpSync(join(production, 'node_modules/.prisma/client'), join(modules, '.prisma/client'), {
  recursive: true,
});
writeFileSync(
  join(artifact, 'package.json'),
  JSON.stringify(
    {
      name: backend.name,
      version: backend.version,
      private: true,
      type: 'module',
      engines: { node: '>=22 <23' },
      scripts: { start: 'node dist/index.js' },
      dependencies: backend.dependencies,
    },
    null,
    2,
  ),
);
writeFileSync(
  join(modules, '@turnosmart/shared/package.json'),
  JSON.stringify(
    {
      name: shared.name,
      version: shared.version,
      type: shared.type,
      main: shared.main,
      exports: { '.': './dist/index.js' },
      dependencies: shared.dependencies,
    },
    null,
    2,
  ),
);
// Las distribuciones npm pueden incluir tests o CLIs de generacion no usados en runtime.
function clean(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['test', 'tests', '__tests__', 'coverage', '.github', '.bin'].includes(entry.name))
        rmSync(path, { recursive: true });
      else clean(path);
    } else if (
      /\.(map|d\.ts)$/.test(entry.name) ||
      /(?:^|[.-])(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
    )
      rmSync(path);
  }
}
clean(artifact);
for (const name of ['generator-build', 'scripts']) {
  const path = join(modules, '@prisma/client', name);
  if (existsSync(path)) rmSync(path, { recursive: true });
}
writeFileSync(
  join(artifact, 'build-info.json'),
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      prisma: read(join(modules, '@prisma/client/package.json')).version,
      lockSha256: createHash('sha256')
        .update(readFileSync(join(source, 'package-lock.json')))
        .digest('hex'),
    },
    null,
    2,
  ),
);
