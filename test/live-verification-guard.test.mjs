import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/verify-ghost-live.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

function run(envOverrides = {}) {
  const env = { ...process.env };
  delete env.OX0_GHOST_LIVE_VERIFY;
  delete env.GHOST_ADMIN_URL;
  delete env.GHOST_ADMIN_API_KEY;
  Object.assign(env, envOverrides);
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    timeout: 5000
  });
}

test('live Ghost verifier refuses to start without explicit mutation opt-in', () => {
  const result = run({
    GHOST_ADMIN_URL: 'https://invalid.example',
    GHOST_ADMIN_API_KEY: `test:${'11'.repeat(32)}`
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /OX0_GHOST_LIVE_VERIFY=1 to opt in explicitly/);
  assert.doesNotMatch(result.stderr, /fetch failed|ENOTFOUND|timed out/);
});

test('live Ghost verifier requires credentials after explicit opt-in', () => {
  const result = run({ OX0_GHOST_LIVE_VERIFY: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GHOST_ADMIN_URL and GHOST_ADMIN_API_KEY are required/);
  assert.doesNotMatch(result.stderr, /fetch failed|ENOTFOUND|timed out/);
});
