import test from 'node:test';
import assert from 'node:assert/strict';
import { createHtmlCardLexical } from '../src/lexical.mjs';
import { projectionIdentityTags } from '../src/projection-identity.mjs';
import {
  projectionSnapshotHash,
  replaceProjectionPublisherTags,
  SYNC_TAG_PREFIX
} from '../src/projection-managed-state.mjs';
import { planProjectionSynchronization, synchronizeProjection } from '../src/publisher.mjs';

const identityTags = projectionIdentityTags({
  articleId: 'article-1',
  variantId: 'variant-ko-1',
  locale: 'ko-KR'
});

function projection(overrides = {}) {
  return {
    identityTags,
    locale: 'ko-KR',
    title: '제목',
    slug: 'article-ko',
    excerpt: '요약',
    tags: ['Rust'],
    featureImage: null,
    featureImageAlt: null,
    featured: false,
    visibility: 'public',
    canonicalUrl: null,
    ...overrides
  };
}

function compiled(overrides = {}) {
  return {
    htmlFragment: '<h1>본문</h1>',
    locale: 'ko-KR',
    referencedAssets: [{ kind: 'image', href: '../assets/a.png', resolvedHref: 'https://cdn.example/a.png' }],
    diagnostics: [],
    ...overrides
  };
}

function ghostPost(overrides = {}) {
  return {
    id: 'post-1',
    title: '제목',
    slug: 'article-ko',
    lexical: createHtmlCardLexical('<h1>본문</h1>'),
    custom_excerpt: '요약',
    feature_image: null,
    feature_image_alt: null,
    featured: false,
    visibility: 'public',
    status: 'draft',
    canonical_url: null,
    updated_at: '2026-01-01T00:00:00.000Z',
    tags: [{ name: 'Rust' }],
    ...overrides
  };
}

function seal(value, identity = identityTags) {
  const hash = projectionSnapshotHash(value);
  value.tags = replaceProjectionPublisherTags(value.tags, identity, hash).map((name) => ({ name }));
  return value;
}

class FakeClient {
  constructor({ identity = [], slug = undefined, page = null } = {}) {
    this.identity = identity;
    this.slug = slug;
    this.page = page;
    this.current = identity[0] ?? null;
    this.calls = [];
    this.identityReads = 0;
    this.lastMutationPayload = null;
  }
  async getPostsBySourceTag(tag) {
    this.calls.push(['identity', tag]);
    this.identityReads += 1;
    return this.current ? [this.current] : this.identity;
  }
  async getPostBySlug(slug) {
    this.calls.push(['slug', slug]);
    if (this.slug !== undefined) return this.slug;
    return this.current?.slug === slug ? this.current : null;
  }
  async getPageBySlug(slug) {
    this.calls.push(['page', slug]);
    return this.page;
  }
  async uploadImage() {
    this.calls.push(['upload']);
    return { url: 'https://img.example/cover.png' };
  }
  async createPost(payload) {
    this.calls.push(['create']);
    this.lastMutationPayload = structuredClone(payload);
    this.current = ghostPost({
      ...payload,
      id: 'created',
      tags: payload.tags.map((name) => ({ name }))
    });
    return this.current;
  }
  async updatePost(id, payload) {
    this.calls.push(['update']);
    this.lastMutationPayload = structuredClone(payload);
    this.current = {
      ...this.current,
      ...payload,
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: '2026-01-02T00:00:00.000Z'
    };
    return this.current;
  }
  async getPostById() {
    this.calls.push(['fresh']);
    return this.current;
  }
  async updatePostMetadata(id, payload) {
    this.calls.push(['stamp']);
    this.current = {
      ...this.current,
      ...payload,
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: '2026-01-03T00:00:00.000Z'
    };
    return this.current;
  }
}

test('read-only projection plan carries stable identity and compiler observations', async () => {
  const client = new FakeClient();
  const plan = await planProjectionSynchronization({
    projection: projection(),
    compiledDocument: compiled(),
    action: 'draft',
    client,
    repoRoot: '/repo'
  });

  assert.equal(plan.operation, 'create');
  assert.deepEqual(plan.identityTags, identityTags);
  assert.equal(plan.sourceIdentity, identityTags[2]);
  assert.equal(plan.locale, 'ko-KR');
  assert.deepEqual(plan.referencedAssets, compiled().referencedAssets);
  assert.deepEqual(plan.diagnostics, []);
  assert.ok(client.calls.every(([kind]) => ['identity', 'slug', 'page'].includes(kind)));
});

test('compiled projection create stamps article + locale + variant identity after exact mutation verification', async () => {
  const client = new FakeClient();
  const result = await synchronizeProjection({
    projection: projection(),
    compiledDocument: compiled(),
    action: 'draft',
    client,
    repoRoot: '/repo'
  });

  assert.deepEqual(client.lastMutationPayload.tags, ['Rust', ...identityTags]);
  assert.equal(client.lastMutationPayload.lexical, createHtmlCardLexical('<h1>본문</h1>'));
  const finalNames = result.tags.map((tag) => tag.name);
  assert.deepEqual(finalNames.slice(0, 4), ['Rust', ...identityTags]);
  assert.match(finalNames.at(-1), new RegExp(`^${SYNC_TAG_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-f0-9]{64}$`));
});

test('projection locale mismatch fails before Ghost access', async () => {
  const client = new FakeClient();
  await assert.rejects(
    planProjectionSynchronization({
      projection: projection(),
      compiledDocument: compiled({ locale: 'en' }),
      action: 'draft',
      client,
      repoRoot: '/repo'
    }),
    /does not match projection.locale/
  );
  assert.deepEqual(client.calls, []);
});

test('matching variant source tag without matching article/locale ownership fails closed', async () => {
  const legacyIdentityOnly = [identityTags[2]];
  const existing = seal(ghostPost(), legacyIdentityOnly);
  const client = new FakeClient({ identity: [existing] });

  await assert.rejects(
    synchronizeProjection({
      projection: projection(),
      compiledDocument: compiled(),
      action: 'draft',
      client,
      repoRoot: '/repo'
    }),
    /projection identity/
  );
  assert.ok(!client.calls.some(([kind]) => kind === 'update'));
});

test('draft preparation cannot unpublish an existing published locale projection', async () => {
  const existing = seal(ghostPost({ status: 'published' }));
  const client = new FakeClient({ identity: [existing] });

  await assert.rejects(
    synchronizeProjection({
      projection: projection(),
      compiledDocument: compiled(),
      action: 'draft',
      client,
      repoRoot: '/repo'
    }),
    /refuses to unpublish/
  );
  assert.ok(!client.calls.some(([kind]) => kind === 'update'));
});
