import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProjectionMetadata } from '../src/projection-metadata.mjs';

function metadata(overrides = {}) {
  return {
    title: ' Title ',
    slug: 'article-ko',
    excerpt: ' Summary ',
    tags: ['Rust', 'Compiler'],
    featureImage: null,
    featureImageAlt: null,
    featured: false,
    visibility: 'public',
    canonicalUrl: null,
    ...overrides
  };
}

test('projection metadata is normalized deterministically', () => {
  assert.deepEqual(normalizeProjectionMetadata(metadata()), {
    title: 'Title',
    slug: 'article-ko',
    excerpt: 'Summary',
    tags: ['Rust', 'Compiler'],
    featureImage: null,
    featureImageAlt: null,
    featured: false,
    visibility: 'public',
    canonicalUrl: null
  });
});

test('slug is constrained to lowercase ASCII kebab-case', () => {
  for (const slug of ['Upper', 'has space', '한글', '-leading', 'trailing-', 'double--dash']) {
    assert.throws(() => normalizeProjectionMetadata(metadata({ slug })), /slug must be lowercase ASCII kebab-case/);
  }
});

test('public tags reject normalized duplicates and reserved publisher namespace case-insensitively', () => {
  assert.throws(
    () => normalizeProjectionMetadata(metadata({ tags: ['Rust', ' rust '] })),
    /must not contain duplicates/
  );
  for (const tag of ['#ox0-source-x', '#OX0-source-x', '#Ox0-anything']) {
    assert.throws(
      () => normalizeProjectionMetadata(metadata({ tags: [tag] })),
      /reserved for publisher state/
    );
  }
});

test('remote feature images and canonical URLs are HTTPS-only', () => {
  assert.equal(
    normalizeProjectionMetadata(metadata({ featureImage: 'https://img.example/a.png' })).featureImage,
    'https://img.example/a.png'
  );
  for (const featureImage of ['http://img.example/a.png', 'data:image/png;base64,AA==']) {
    assert.throws(() => normalizeProjectionMetadata(metadata({ featureImage })), /must use https/);
  }
  assert.throws(
    () => normalizeProjectionMetadata(metadata({ featureImage: '//img.example/a.png' })),
    /protocol-relative/
  );
  assert.throws(
    () => normalizeProjectionMetadata(metadata({ canonicalUrl: 'http://example.com/a' })),
    /canonicalUrl must use https/
  );
});

test('local feature image must already be a resolved absolute supported image path', () => {
  assert.throws(
    () => normalizeProjectionMetadata(metadata({ featureImage: '../assets/a.png' })),
    /absolute resolved path/
  );
  assert.throws(
    () => normalizeProjectionMetadata(metadata({ featureImage: '/repo/assets/a.exe' })),
    /unsupported featureImage extension/
  );
  assert.equal(
    normalizeProjectionMetadata(metadata({ featureImage: '/repo/assets/a.png' })).featureImage,
    '/repo/assets/a.png'
  );
});

test('v1 rejects non-public visibility and non-boolean featured', () => {
  assert.throws(() => normalizeProjectionMetadata(metadata({ visibility: 'members' })), /only public visibility/);
  assert.throws(() => normalizeProjectionMetadata(metadata({ featured: 'true' })), /featured must be true or false/);
});
