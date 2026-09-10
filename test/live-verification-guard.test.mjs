import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

test('live Ghost verifier claims cleanup ownership only after namespace preflight', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const cleanupGuard = 'if (!ownsTemporaryNamespace) return [];';
  const preflight = 'await assertTemporaryNamespaceUnused();';
  const claim = 'ownsTemporaryNamespace = true;';
  const firstMutation = 'const first = await synchronizePost({';

  assert.match(source, /let ownsTemporaryNamespace = false;/);
  assert.ok(source.includes(cleanupGuard), 'cleanup must be disabled until namespace ownership is established');

  const preflightIndex = source.indexOf(preflight);
  const claimIndex = source.indexOf(claim);
  const mutationIndex = source.indexOf(firstMutation);
  assert.ok(preflightIndex >= 0, 'namespace preflight must exist');
  assert.ok(claimIndex > preflightIndex, 'ownership must be claimed only after preflight succeeds');
  assert.ok(mutationIndex > claimIndex, 'ownership must be claimed before the first Ghost mutation');
});

test('live Ghost verifier never recovers cleanup ownership from slug alone', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const recoverStart = source.indexOf('async function recoverPost()');
  const recoverEnd = source.indexOf('async function ignoreMissingDelete', recoverStart);
  assert.ok(recoverStart >= 0 && recoverEnd > recoverStart, 'recoverPost must remain inspectable');

  const recoverPost = source.slice(recoverStart, recoverEnd);
  assert.doesNotMatch(recoverPost, /getPostBySlug/, 'post cleanup recovery must not adopt a slug-only match');
  assert.match(recoverPost, /post\.title !== postTitle/);
  assert.match(recoverPost, /post\.lexical !== lexical/);
  assert.match(recoverPost, /post\.status !== 'draft'/);

  assert.match(
    source,
    /recoveredPage\.title !== pageTitle \|\| recoveredPage\.lexical !== lexical \|\| recoveredPage\.status !== 'draft'/,
    'page cleanup recovery must verify the exact temporary marker state'
  );
  assert.match(
    source,
    /const recovered = await client\.getPostById\(knownPostId\);/,
    'once a post ID is known, cleanup metadata recovery must stay bound to that ID'
  );
});
