import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = new URL('./dev.mjs', import.meta.url);
for (const [name, overrides, message] of [
  [
    'remote Windows pipe',
    { DOCKER_HOST: 'npipe:////remote-host/pipe/docker_engine', DOCKER_CONTEXT: '' },
    /Docker local/,
  ],
  [
    'remote reset daemon',
    { DOCKER_HOST: 'tcp://remote.invalid:2375', DOCKER_CONTEXT: '' },
    /Docker local/,
  ],
  ['invalid port', { TS_POSTGRES_PORT: '5432;echo unsafe' }, /Puerto invalido/],
  [
    'overlapping ports',
    { TS_POSTGRES_PORT: '54325', TS_AUTH_PORT: '54325' },
    /puertos locales deben ser distintos/,
  ],
]) {
  test(`rejects ${name} before reset can touch data`, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(script), 'reset'], {
      env: { ...process.env, ...overrides },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  });
}
