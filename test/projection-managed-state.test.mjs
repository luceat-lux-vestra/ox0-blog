import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTICLE_TAG_PREFIX,
  LOCALE_TAG_PREFIX,
  SOURCE_TAG_PREFIX,
  SYNC_TAG_PREFIX,
  assertProjectionManagedAndUnchanged,
  normalizeProjectionIdentityTags,
  projectionLookupTag,
  projectionSnapshotHash,
  replaceProjectionPublisherTags
} from '../src/projection-managed-state.mjs';

const identity = [
  `${ARTICLE_TAG_PREFIX}${'a'.repeat(64)}`,
  `${LOCALE_TAG_PREFIX}ko-KR`,
  `${SOURCE_TAG_PREFIX}${'b'.repeat(64)}`
];

function post(overrides = {}) {
  return {
    id: 'post-1',
    title: 'Title',
    slug: 'slug',
    lexical: '{"root":{}}',
    custom_excerpt: 'Excerpt',
    feature_image: null,
    feature_image_alt: null,
    featured: false,
    visibility: 'public',
    status: 'published',
    canonical_url: null,
    tags: [{ name: 'Rust' }],
    ...overrides
  };
}

function seal(value, expectedIdentity = identity) {
  const hash = projectionSnapshotHash(value);
  value.tags = replaceProjectionPublisherTags(value.tags, expectedIdentity, hash).map((name) => ({ name }));
  return value;
}

test('projection identity accepts article + locale + stable variant source identity', () => {
  assert.deepEqual(normalizeProjectionIdentityTags(identity), identity);
  assert.equal(projectionLookupTag(identity), identity[2]);
});

test('legacy single source identity remains representable during migration', () => {
  const legacy = [`${SOURCE_TAG_PREFIX}${'c'.repeat(64)}`];
  assert.deepEqual(normalizeProjectionIdentityTags(legacy), legacy);
  assert.equal(projectionLookupTag(legacy), legacy[0]);
});

test('content snapshot excludes projection ownership metadata', () => {
  const base = post();
  const baseHash = projectionSnapshotHash(base);
  const withIdentity = {
    ...base,
    tags: [
      { name: 'Rust' },
      ...identity.map((name) => ({ name })),
      { name: `${SYNC_TAG_PREFIX}${'0'.repeat(64)}` }
    ]
  };
  assert.equal(projectionSnapshotHash(withIdentity), baseHash);
});

test('managed projection validates exact identity and unchanged managed content', () => {
  const managed = seal(post());
  assert.doesNotThrow(() => assertProjectionManagedAndUnchanged(managed, identity));

  managed.title = 'Manual edit';
  assert.throws(
    () => assertProjectionManagedAndUnchanged(managed, identity),
    /changed outside ox0-blog/
  );
});

test('identity mismatch fails even when managed content hash still matches', () => {
  const managed = seal(post());
  const other = [identity[0], `${LOCALE_TAG_PREFIX}en`, identity[2]];
  assert.throws(
    () => assertProjectionManagedAndUnchanged(managed, other),
    /invalid ox0 projection identity/
  );
});

test('unknown reserved publisher tag fails closed', () => {
  const managed = seal(post());
  managed.tags.splice(1, 0, { name: '#ox0-future-unknown' });
  assert.throws(
    () => assertProjectionManagedAndUnchanged(managed, identity),
    /unsupported ox0 publisher tags/
  );
});

test('publisher tags are rewritten as one canonical ordered tail', () => {
  const names = replaceProjectionPublisherTags(
    [
      { name: 'Rust' },
      { name: identity[2] },
      { name: `${SYNC_TAG_PREFIX}${'1'.repeat(64)}` }
    ],
    identity,
    '2'.repeat(64)
  );
  assert.deepEqual(names, ['Rust', ...identity, `${SYNC_TAG_PREFIX}${'2'.repeat(64)}`]);
});

test('duplicate identity dimension fails closed', () => {
  assert.throws(
    () => normalizeProjectionIdentityTags([identity[2], `${SOURCE_TAG_PREFIX}${'d'.repeat(64)}`]),
    /multiple #ox0-source-/
  );
});
