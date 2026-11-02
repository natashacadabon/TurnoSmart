import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

function fixture(t, husky) {
  const root = mkdtempSync(join(tmpdir(), 'turnosmart-husky-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
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
  return {
    root,
    run(overrides = {}) {
      return spawnSync(process.execPath, ['.husky/install.mjs'], {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          CI: 'false',
          HUSKY: '1',
          VERCEL: '0',
          RENDER: 'false',
          ...overrides,
        },
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

test('sin Husky instalado prepare finaliza silenciosamente', (t) => {
  const { run } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
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
  for (const command of [vercel.installCommand, root.scripts['build:render']]) {
    assert.match(command, /npm ci --include=dev/);
    assert(!command.includes('--ignore-scripts'));
  }
  const workflow = read('../.github/workflows/frontend-deploy.yml');
  assert(workflow.includes('HUSKY=0 npm ci --include=dev'));
  assert(!workflow.includes('--ignore-scripts'));
  assert.match(root.scripts['build:render'], /npm run prisma:generate/);
  assert(!/migrate|seed|db push/.test(root.scripts['build:render']));
});
