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

test('live Ghost verifier filters the tags resource by its own name field', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  assert.match(source, /filter: `name:\$\{nqlString\(name\)\}`/);
  assert.doesNotMatch(source, /filter: `tags\.name:/);
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

test('live Ghost verifier re-proves exact page ownership by id before destructive cleanup', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const helperStart = source.indexOf('async function assertOwnedTemporaryPageById(id)');
  const helperEnd = source.indexOf('async function assertResourceMissingById', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'page ownership helper must remain inspectable');

  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /pages\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(helper, /page\.id !== id/);
  assert.match(helper, /page\.title !== pageTitle/);
  assert.match(helper, /page\.slug !== pageSlug/);
  assert.match(helper, /page\.lexical !== lexical/);
  assert.match(helper, /page\.status !== 'draft'/);
  assert.match(helper, /refusing cleanup/);

  const cleanupBlock = source.indexOf('if (knownPageId) {');
  const ownershipCheck = source.indexOf('const ownedPage = await assertOwnedTemporaryPageById(knownPageId);', cleanupBlock);
  const pageDelete = source.indexOf('await ignoreMissingDelete(`pages/${encodeURIComponent(knownPageId)}/`);', ownershipCheck);
  const absenceCheck = source.indexOf("await assertResourceMissingById('pages', knownPageId);", pageDelete);

  assert.ok(cleanupBlock >= 0, 'page cleanup block must remain present');
  assert.ok(ownershipCheck > cleanupBlock, 'page ownership must be reread by exact id before deletion');
  assert.ok(pageDelete > ownershipCheck, 'page deletion must occur only after exact ownership is proven');
  assert.ok(absenceCheck > pageDelete, 'page deletion must be followed by persisted absence verification');
});

test('live Ghost verifier retains publisher tags unless post cleanup is proven complete', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const postDelete = source.indexOf('await ignoreMissingDelete(`posts/${encodeURIComponent(knownPostId)}/`);');
  const postAbsence = source.indexOf("await assertResourceMissingById('posts', knownPostId);", postDelete);
  const safeFlag = source.indexOf('postCleanupSafeForTags = true;', postAbsence);
  const tagCleanup = source.indexOf('if (postCleanupSafeForTags) {', safeFlag);

  assert.match(source, /let postCleanupSafeForTags = false;/);
  assert.ok(postDelete >= 0, 'post cleanup must issue an ID-bound delete');
  assert.ok(postAbsence > postDelete, 'post cleanup must prove persisted absence after delete');
  assert.ok(safeFlag > postAbsence, 'tag cleanup may become safe only after post absence is proven');
  assert.ok(tagCleanup > safeFlag, 'tag deletion must remain gated by proven post cleanup');
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

test('live Ghost verifier proves the source tag slug actually drifted before identity lookup', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const tagUpdate = source.indexOf("await client.request(`tags/${encodeURIComponent(sourceIdentityTag.id)}/`");
  const persistedTagRead = source.indexOf('const driftedSourceIdentityTag = await findExactTag(sourceTag);');
  const slugCheck = source.indexOf("assert.equal(driftedSourceIdentityTag?.slug, driftedTagSlug, 'Ghost did not persist source identity tag slug drift');");
  const identityLookup = source.indexOf('const afterTagSlugDrift = await client.getPostsBySourceTag(sourceTag);');

  assert.ok(tagUpdate >= 0, 'source-tag slug update must remain present');
  assert.ok(persistedTagRead > tagUpdate, 'updated source tag must be reread by canonical name');
  assert.ok(slugCheck > persistedTagRead, 'persisted source-tag slug must equal the requested drift slug');
  assert.ok(identityLookup > slugCheck, 'canonical source identity lookup must run only after drift is proven');
  assert.match(source, /assert\.equal\(driftedSourceIdentityTag\?\.id, sourceIdentityTag\.id/);
});

test('live Ghost verifier deletes only ID-bound unreferenced tags and proves absence', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  assert.match(source, /const cleanupTagIds = new Map\(\);/);
  assert.match(source, /cleanupTagIds\.set\(name, id\);/);

  const tagIdRead = source.indexOf('const tagId = cleanupTagIds.get(name);');
  const exactTagRead = source.indexOf('const tag = await getTagById(tagId);', tagIdRead);
  const nameCheck = source.indexOf('if (tag.name !== name)', exactTagRead);
  const refCheck = source.indexOf('await assertTagUnreferenced(tag);', nameCheck);
  const tagDelete = source.indexOf('await ignoreMissingDelete(`tags/${encodeURIComponent(tagId)}/`);', refCheck);
  const absenceCheck = source.indexOf("await assertResourceMissingById('tags', tagId);", tagDelete);

  assert.ok(tagIdRead >= 0, 'tag cleanup must use an observed owned tag id');
  assert.ok(exactTagRead > tagIdRead, 'tag cleanup must refetch the exact id');
  assert.ok(nameCheck > exactTagRead, 'tag cleanup must reject an externally renamed tag');
  assert.ok(refCheck > nameCheck, 'post/page references must be checked before tag deletion');
  assert.ok(tagDelete > refCheck, 'tag deletion must occur only after reference checks');
  assert.ok(absenceCheck > tagDelete, 'tag deletion must be followed by an ID-based absence check');
  assert.match(source, /client\.getPostsByTagSlug\(tag\.slug\)/);
  assert.match(source, /client\.request\('pages\/', \{ query: \{ filter: `tag:\$\{tag\.slug\}`, limit: 2 \} \}\)/);
});
