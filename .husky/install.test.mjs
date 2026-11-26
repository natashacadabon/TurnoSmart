import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

function fixture(t, husky) {
  const tempBase = realpathSync(tmpdir());
  const root = mkdtempSync(join(tempBase, 'turnosmart-husky-'));
  t.after(() => {
    assert.equal(dirname(realpathSync(root)), tempBase);
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, '.husky'));
  copyFileSync(new URL('./install.mjs', import.meta.url), join(root, '.husky/install.mjs'));
  if (husky) {
    const module = join(root, 'node_modules/husky');
    mkdirSync(module, { recursive: true });
    writeFileSync(
      join(module, 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    writeFileSync(join(module, 'index.js'), husky);
  }
  function environment(overrides) {
    return {
      ...process.env,
      NODE_ENV: 'development',
      CI: 'false',
      HUSKY: '1',
      VERCEL: '0',
      RENDER: 'false',
      ...overrides,
    };
  }
  return {
    root,
    run(overrides = {}) {
      return spawnSync(process.execPath, ['.husky/install.mjs'], {
        cwd: root,
        env: environment(overrides),
        encoding: 'utf8',
      });
    },
    install(overrides = {}) {
      const name = 'husky-install-fixture';
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name,
          version: '1.0.0',
          private: true,
          scripts: { prepare: 'node .husky/install.mjs' },
        }),
      );
      writeFileSync(
        join(root, 'package-lock.json'),
        JSON.stringify({
          name,
          version: '1.0.0',
          lockfileVersion: 3,
          requires: true,
          packages: { '': { name, version: '1.0.0', hasInstallScript: true } },
        }),
      );
      const npm =
        process.env.npm_execpath ??
        (process.platform === 'win32'
          ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
          : realpathSync(join(dirname(process.execPath), 'npm')));
      return spawnSync(process.execPath, [npm, 'ci', '--include=dev', '--offline'], {
        cwd: root,
        env: environment(overrides),
        encoding: 'utf8',
      });
    },
  };
}

for (const overrides of [
  { NODE_ENV: 'production' },
  { CI: 'true' },
  { CI: '1' },
  { HUSKY: '0' },
  { VERCEL: '1' },
  { RENDER: 'true' },
])
  test(`omite inicializacion antes de importar: ${JSON.stringify(overrides)}`, (t) => {
    const { run } = fixture(t, 'throw new Error("Husky no debe importarse");');
    const result = run(overrides);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });

test('sin Husky local prepare falla con una instruccion de reparacion', (t) => {
  const { run } = fixture(t);
  const result = run();
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Faltan dependencias locales \(husky\)/);
  assert.match(result.stderr, /npm ci --include=dev/);
});

for (const hosting of [{ VERCEL: '1' }, { CI: 'true' }, { NODE_ENV: 'production' }])
  test(`npm ci real sin Husky en hosting: ${JSON.stringify(hosting)}`, (t) => {
    const { root, install } = fixture(t);
    const result = install(hosting);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert(result.stdout.includes('node .husky/install.mjs'), 'prepare debe ejecutarse');
    assert(!existsSync(join(root, 'node_modules/husky')));
  });

test('npm ci local sin devDependencies detecta el problema sin omitir prepare', (t) => {
  const { install } = fixture(t);
  const result = install();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Faltan dependencias locales/);
});

test('desarrollo invoca Husky conservando hooks locales', (t) => {
  const { root, run } = fixture(
    t,
    `import {writeFileSync} from 'node:fs';
    export default () => { writeFileSync('.husky/initialized', 'yes'); return ''; };`,
  );
  writeFileSync(join(root, '.husky/pre-commit'), 'npm run lint\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert(existsSync(join(root, '.husky/initialized')));
  assert.equal(readFileSync(join(root, '.husky/pre-commit'), 'utf8'), 'npm run lint\n');
});

test('no oculta errores de una instalacion de Husky rota', (t) => {
  const { run } = fixture(t, 'import "dependency-that-does-not-exist";');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dependency-that-does-not-exist/);
});

test('hosting incluye devDependencies y permite lifecycle scripts npm', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const root = JSON.parse(read('../package.json'));
  const vercel = JSON.parse(read('../apps/frontend/vercel.json'));
  assert.equal(root.scripts.prepare, 'node .husky/install.mjs');
  for (const path of [
    '../package.json',
    '../apps/frontend/package.json',
    '../apps/backend/package.json',
    '../packages/shared/package.json',
  ])
    assert.equal(JSON.parse(read(path)).engines.node, '22.x');
  assert.equal(read('../.nvmrc').trim(), '22.23.4');
  const lock = JSON.parse(read('../package-lock.json'));
  for (const path of ['', 'apps/frontend', 'apps/backend', 'packages/shared'])
    assert.equal(lock.packages[path].engines.node, '22.x');
  assert(!('nodeVersion' in vercel), 'Node se configura con engines/Settings, no vercel.json');
  for (const command of [vercel.installCommand, root.scripts['build:render']]) {
    assert.match(command, /npm ci --include=dev/);
    assert(!command.includes('--ignore-scripts'));
  }
  const workflow = read('../.github/workflows/frontend-deploy.yml');
  // Vercel CLI instala con vercel.installCommand. CI instala desde la raiz.
  assert.match(read('../.github/workflows/ci.yml'), /^\s*run: npm ci\s*$/m);
  assert(!workflow.includes('--ignore-scripts'));
  assert.match(root.scripts['build:render'], /npm run prisma:generate/);
  assert(!/migrate|seed|db push/.test(root.scripts['build:render']));
});
