import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../scripts/verify-article-live-draft.mjs', import.meta.url), 'utf8');

test('live Article verifier is draft-only and uses durable review contracts', () => {
  assert.match(source, /randomUUID\(\)/);
  assert.match(source, /origin: 'blog-audit'/);
  assert.match(source, /action: 'draft'/);
  assert.match(source, /DRAFT_CURRENT/);
  assert.doesNotMatch(source, /action:\s*'publish'/);
  assert.doesNotMatch(source, /PUBLISHED_CURRENT/);
  assert.doesNotMatch(source, /ARTICLE_PUBLICATION_AUTHORIZATION_VERSION/);
});

test('live Article verifier verifies cleanup residue instead of assuming deletion succeeded', () => {
  assert.match(source, /assertTemporaryNamespaceAbsent/);
  assert.match(source, /temporary verifier source identity residue remains/);
  assert.match(source, /temporary verifier identity-tag residue remains/);
  assert.match(source, /git\('status', '--porcelain', '--untracked-files=all'\)/);
});
