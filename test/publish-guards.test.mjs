import test from 'node:test';
import assert from 'node:assert/strict';
import { createHtmlCardLexical } from '../src/lexical.mjs';
import { assertDesiredSlugAvailable, assertMutationApplied } from '../src/publish-guards.mjs';

const LEXICAL = createHtmlCardLexical('<h1>body</h1>');

function basePost(overrides = {}) {
  return {
    id: 'post-1',
    title: 'Example',
    slug: 'example',
    lexical: LEXICAL,
    custom_excerpt: null,
    feature_image: null,
    feature_image_alt: null,
    featured: false,
    visibility: 'public',
    status: 'draft',
    canonical_url: null,
    tags: [{ name: 'Rust' }, { name: '#ox0-source-a' }],
    ...overrides
  };
}

function payload(overrides = {}) {
  return {
    title: 'Example',
    slug: 'example',
    lexical: LEXICAL,
    custom_excerpt: null,
    feature_image: null,
    feature_image_alt: null,
    featured: false,
    visibility: 'public',
    status: 'draft',
    canonical_url: null,
    tags: ['Rust', '#ox0-source-a'],
    ...overrides
  };
}

test('slug preflight skips reads when existing post already owns desired slug', async () => {
  const client = {
    getPostBySlug() { throw new Error('must not read'); },
    getPageBySlug() { throw new Error('must not read'); }
  };
  await assert.doesNotReject(assertDesiredSlugAvailable(client, 'example', { id: 'post-1', slug: 'example' }));
});

test('slug preflight rejects an occupied post slug', async () => {
  const calls = [];
  const client = {
    async getPostBySlug() { calls.push('post'); return { id: 'other' }; },
    async getPageBySlug() { calls.push('page'); return null; }
  };
  await assert.rejects(assertDesiredSlugAvailable(client, 'renamed', { id: 'post-1', slug: 'example' }), /occupied by a post/);
  assert.deepEqual(calls, ['post']);
});

test('slug preflight rejects an occupied page slug', async () => {
  const calls = [];
  const client = {
    async getPostBySlug() { calls.push('post'); return null; },
    async getPageBySlug() { calls.push('page'); return { id: 'page-1' }; }
  };
  await assert.rejects(assertDesiredSlugAvailable(client, 'renamed', { id: 'post-1', slug: 'example' }), /occupied by a page/);
  assert.deepEqual(calls, ['post', 'page']);
});

test('mutation postcondition accepts exact managed metadata, tag order, and HTML-card content', () => {
  assert.doesNotThrow(() => assertMutationApplied(basePost(), payload()));
});

test('mutation postcondition rejects Ghost slug uniquification', () => {
  assert.throws(() => assertMutationApplied(basePost({ slug: 'example-2' }), payload()), /managed field slug/);
});

test('mutation postcondition rejects Ghost tag reordering', () => {
  assert.throws(() => assertMutationApplied(
    basePost({ tags: [{ name: '#ox0-source-a' }, { name: 'Rust' }] }),
    payload()
  ), /tag order/);
});

test('mutation postcondition rejects changed or non-HTML-card lexical body', () => {
  assert.throws(() => assertMutationApplied(
    basePost({ lexical: createHtmlCardLexical('<h1>changed</h1>') }),
    payload()
  ), /HTML card content differs/);
  assert.throws(() => assertMutationApplied(basePost({ lexical: '{"root":{"children":[]}}' }), payload()), /root HTML card/);
});
