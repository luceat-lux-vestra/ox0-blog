import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertManagedAndUnchanged,
  replacePublisherTags,
  snapshotHash,
  sourceTagForPath,
  sourceTagSlug,
  validateMetadata,
  SOURCE_TAG_PREFIX,
  SYNC_TAG_PREFIX
} from '../src/post.mjs';

const SOURCE_TAG = `${SOURCE_TAG_PREFIX}${'c'.repeat(64)}`;

function basePost() {
  return {
    title: 'Example', slug: 'example', lexical: '{"root":{}}', custom_excerpt: null,
    feature_image: null, feature_image_alt: null, featured: false,
    visibility: 'public', status: 'draft', canonical_url: null,
    tags: [{ name: 'Rust' }]
  };
}

function seal(post, sourceTag = SOURCE_TAG) {
  const hash = snapshotHash(post);
  post.tags.push({ name: sourceTag }, { name: `${SYNC_TAG_PREFIX}${hash}` });
  return post;
}

test('managed snapshot ignores publisher state tags themselves', () => {
  const post = basePost();
  const before = snapshotHash(post);
  seal(post);
  assert.equal(snapshotHash(post), before);
  assert.doesNotThrow(() => assertManagedAndUnchanged(post, SOURCE_TAG));
});

test('manual managed-field edit is detected', () => {
  const post = seal(basePost());
  post.title = 'Changed in Ghost';
  assert.throws(() => assertManagedAndUnchanged(post, SOURCE_TAG), /changed outside ox0-blog/);
});

test('unmanaged existing post is rejected', () => {
  const post = basePost();
  post.tags.push({ name: SOURCE_TAG });
  assert.throws(() => assertManagedAndUnchanged(post, SOURCE_TAG), /not managed/);
});

test('public tag reordering is managed drift because Ghost tag order is semantic', () => {
  const post = basePost();
  post.tags.push({ name: 'Payments' });
  seal(post);
  [post.tags[0], post.tags[1]] = [post.tags[1], post.tags[0]];
  assert.throws(() => assertManagedAndUnchanged(post, SOURCE_TAG), /changed outside ox0-blog/);
});

test('publisher state tags must remain after author tags', () => {
  const post = seal(basePost());
  const sync = post.tags.pop();
  post.tags.unshift(sync);
  assert.throws(() => assertManagedAndUnchanged(post, SOURCE_TAG), /invalid ox0 publisher tag ordering/);
});

test('multiple source identities fail closed even when sync hash is otherwise valid', () => {
  const post = seal(basePost());
  post.tags.push({ name: `${SOURCE_TAG_PREFIX}${'d'.repeat(64)}` });
  assert.throws(() => assertManagedAndUnchanged(post, SOURCE_TAG), /invalid ox0 source identity/);
});

test('publisher tags preserve author tag order and append identity/state tags', () => {
  const hash = 'a'.repeat(64);
  assert.deepEqual(
    replacePublisherTags([{ name: 'Rust' }, { name: 'Payments' }, { name: `${SYNC_TAG_PREFIX}${'b'.repeat(64)}` }, { name: `${SOURCE_TAG_PREFIX}${'d'.repeat(64)}` }], SOURCE_TAG, hash),
    ['Rust', 'Payments', SOURCE_TAG, `${SYNC_TAG_PREFIX}${hash}`]
  );
});

test('source identity is deterministic from repository-relative post path', () => {
  const tag = sourceTagForPath('/repo/posts/nested/example.md', '/repo');
  assert.match(tag, /^#ox0-source-[a-f0-9]{64}$/);
  assert.equal(sourceTagSlug(tag), `hash-${tag.slice(1)}`);
  assert.equal(tag, sourceTagForPath('/repo/posts/nested/example.md', '/repo'));
});

test('reserved publisher tags are rejected case-insensitively', () => {
  assert.throws(() => validateMetadata({
    title: 'Example', slug: 'example', status: 'draft', tags: ['#Ox0-Source-user']
  }, {
    postPath: '/repo/posts/example.md', repoRoot: '/repo'
  }), /reserved for publisher state/);
});

test('author tags reject duplicates after trimming and case folding', () => {
  assert.throws(() => validateMetadata({
    title: 'Example', slug: 'example', status: 'draft', tags: ['Rust', ' rust ']
  }, {
    postPath: '/repo/posts/example.md', repoRoot: '/repo'
  }), /must not contain duplicates/);
});

test('local feature image must use a repository-portable relative path', () => {
  for (const featureImage of ['/repo/assets/cover.png', 'C:\\repo\\assets\\cover.png']) {
    assert.throws(() => validateMetadata({
      title: 'Example', slug: 'example', status: 'draft', feature_image: featureImage
    }, {
      postPath: '/repo/posts/example.md', repoRoot: '/repo'
    }), /must be a relative path under assets/);
  }
});
