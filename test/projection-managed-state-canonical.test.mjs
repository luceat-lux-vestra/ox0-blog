import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTICLE_TAG_PREFIX,
  LOCALE_TAG_PREFIX,
  SOURCE_TAG_PREFIX,
  normalizeProjectionIdentityTags,
  projectionSnapshotHash
} from '../src/projection-managed-state.mjs';

const article = `${ARTICLE_TAG_PREFIX}${'a'.repeat(64)}`;
const locale = `${LOCALE_TAG_PREFIX}ko-KR`;
const source = `${SOURCE_TAG_PREFIX}${'b'.repeat(64)}`;

test('projection identity order is canonical regardless of caller input order', () => {
  assert.deepEqual(
    normalizeProjectionIdentityTags([source, article, locale]),
    [article, locale, source]
  );
});

test('reserved ox0 namespace is case-insensitive and unknown casing fails closed', () => {
  assert.throws(
    () => projectionSnapshotHash({
      title: 'T',
      slug: 's',
      lexical: '{}',
      status: 'draft',
      tags: [{ name: '#OX0-source-not-allowed' }]
    }),
    /unsupported ox0 publisher tags/
  );
});
