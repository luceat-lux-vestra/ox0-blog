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

test('live Ghost verifier retains publisher tags unless post cleanup is safe', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  assert.match(source, /let postCleanupSafeForTags = false;/);
  assert.match(
    source,
    /await ignoreMissingDelete\(`posts\/\$\{encodeURIComponent\(knownPostId\)\}\/`\);\s*postCleanupSafeForTags = true;/,
    'successful or already-missing post deletion must establish tag-cleanup safety'
  );
  assert.match(
    source,
    /if \(postCleanupSafeForTags\) \{\s*for \(const name of cleanupTagNames\)/,
    'temporary tags must not be deleted when post cleanup failed or ownership could not be resolved'
  );
});

test('live Ghost verifier proves exact page persistence before collision check', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const createPage = source.indexOf("const pagePayload = await client.request('pages/'");
  const createSlugCheck = source.indexOf("assert.equal(createdPage.slug, pageSlug, 'Ghost changed temporary page slug on create');");
  const freshRead = source.indexOf('const persistedPagePayload = await client.request(`pages/${encodeURIComponent(knownPageId)}/`');
  const persistedSlugCheck = source.indexOf("assert.equal(persistedPage.slug, pageSlug, 'persisted temporary page slug changed');");
  const collisionCheck = source.indexOf('await assert.rejects(', persistedSlugCheck);

  assert.ok(createPage >= 0, 'temporary page creation must remain present');
  assert.ok(createSlugCheck > createPage, 'create response must prove the requested page slug was preserved');
  assert.ok(freshRead > createSlugCheck, 'page must be fetched again by id after creation');
  assert.ok(persistedSlugCheck > freshRead, 'fresh persisted page slug must be verified');
  assert.ok(collisionCheck > persistedSlugCheck, 'page persistence must be proven before the collision assertion');
  assert.match(source, /assert\.equal\(persistedPage\.lexical, lexical/);
  assert.match(source, /assert\.equal\(persistedPage\.status, 'draft'/);
});
