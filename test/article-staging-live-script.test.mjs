import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/verify-article-staging-live.mjs', import.meta.url));

test('staging verifier uses canonical review evidence and conservative cleanup postconditions', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /import \{ randomBytes, randomUUID \} from 'node:crypto';/);
  assert.match(source, /const reviewId = randomUUID\(\);/);
  assert.match(source, /origin: 'blog-audit'/);
  assert.match(source, /reviewedInvalidationIds: \[reviewId\]/);

  assert.match(source, /async function recoverOwnedPost\(/);
  assert.match(source, /async function assertNamespaceRemoved\(/);
  assert.match(source, /await assertNamespaceRemoved\(\);/);
  assert.match(source, /await deletePostById\(id\);/);
  assert.doesNotMatch(source, /DELETE.*slug|delete.*BySlug/i);
});

test('staging verifier keeps production promotion behind the exact-current draft core guard', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /requireExactCurrentDraftsForProduction\(publishRuntime\.plan\);/);
  assert.match(source, /authorization: authorizationFromPlan\(publishRuntime\.plan\)/);
  assert.match(source, /publicationPlanGuard: requireExactCurrentDraftsForProduction/);
  assert.match(source, /\['PUBLISHED_CURRENT', 'PUBLISHED_CURRENT'\]/);
});
