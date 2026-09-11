import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const script = path.join(process.cwd(), 'scripts', 'verify-body-image-live.mjs');

function run(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.OX0_GHOST_LIVE_VERIFY;
  delete env.GHOST_ADMIN_URL;
  delete env.GHOST_ADMIN_API_KEY;
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8'
  });
}

test('body-image live verifier requires explicit mutation opt-in', () => {
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /OX0_GHOST_LIVE_VERIFY=1/);
});

test('body-image live verifier requires Ghost credentials after opt-in', () => {
  const result = run({ OX0_GHOST_LIVE_VERIFY: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GHOST_ADMIN_URL and GHOST_ADMIN_API_KEY are required/);
});
