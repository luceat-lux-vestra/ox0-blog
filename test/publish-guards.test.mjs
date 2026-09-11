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

test('same-slug preflight rechecks managed post ownership and page availability', async () => {
  const calls = [];
  const client = {
    async getPostBySlug() { calls.push('post'); return { id: 'post-1', slug: 'example' }; },
    async getPageBySlug() { calls.push('page'); return null; }
  };
  await assert.doesNotReject(assertDesiredSlugAvailable(client, 'example', { id: 'post-1', slug: 'example' }));
  assert.deepEqual(calls, ['post', 'page']);
});

test('same-slug preflight rejects when slug no longer resolves to expected managed post', async () => {
  for (const occupyingPost of [null, { id: 'other', slug: 'example' }]) {
    const calls = [];
    const client = {
      async getPostBySlug() { calls.push('post'); return occupyingPost; },
      async getPageBySlug() { calls.push('page'); return null; }
    };
    await assert.rejects(
      assertDesiredSlugAvailable(client, 'example', { id: 'post-1', slug: 'example' }),
      /no longer resolves to the expected managed post/
    );
    assert.deepEqual(calls, ['post']);
  }
});

test('same-slug preflight still rejects a page collision', async () => {
  const calls = [];
  const client = {
    async getPostBySlug() { calls.push('post'); return { id: 'post-1', slug: 'example' }; },
    async getPageBySlug() { calls.push('page'); return { id: 'page-1', slug: 'example' }; }
  };
  await assert.rejects(
    assertDesiredSlugAvailable(client, 'example', { id: 'post-1', slug: 'example' }),
    /occupied by a page/
  );
  assert.deepEqual(calls, ['post', 'page']);
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

test('mutation postcondition accepts exact managed metadata, tag order, and direct Lexical representation', () => {
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

test('mutation postcondition rejects any change to the direct Lexical representation', () => {
  assert.throws(() => assertMutationApplied(
    basePost({ lexical: createHtmlCardLexical('<h1>changed</h1>') }),
    payload()
  ), /direct Lexical representation exactly/);

  const changedVisibility = JSON.parse(LEXICAL);
  changedVisibility.root.children[0].visibility.web.nonMember = false;
  assert.throws(() => assertMutationApplied(
    basePost({ lexical: JSON.stringify(changedVisibility) }),
    payload()
  ), /direct Lexical representation exactly/);
});
