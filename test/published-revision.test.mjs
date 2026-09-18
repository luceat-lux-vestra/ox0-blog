import test from 'node:test';
import assert from 'node:assert/strict';
import { createHtmlCardLexical } from '../src/lexical.mjs';
import { projectionSourceFingerprintV1 } from '../src/projection-fingerprint.mjs';
import { projectionIdentityTags } from '../src/projection-identity.mjs';
import {
  projectionSnapshotHash,
  replaceProjectionPublisherTags
} from '../src/projection-managed-state.mjs';
import { planProjectionSynchronization, synchronizeProjection } from '../src/publisher.mjs';

const identityTags = projectionIdentityTags({
  articleId: 'article-revision',
  variantId: 'article-revision-en',
  locale: 'en'
});

function compiled(htmlFragment) {
  return {
    htmlFragment,
    locale: 'en',
    referencedAssets: [],
    diagnostics: []
  };
}

function projectionFor(document) {
  const projection = {
    identityTags,
    locale: 'en',
    title: 'Revision article',
    slug: 'revision-article',
    excerpt: 'summary',
    tags: ['Test'],
    featureImage: null,
    featureImageAlt: null,
    featured: false,
    visibility: 'public',
    canonicalUrl: null,
    materialAssets: []
  };
  return {
    ...projection,
    sourceFingerprint: projectionSourceFingerprintV1(projection, document, {
      materialAssets: [],
      featureImageFingerprint: null
    })
  };
}

function managedPublishedPost(projection, document) {
  const post = {
    id: 'post-1',
    title: projection.title,
    slug: projection.slug,
    lexical: createHtmlCardLexical(document.htmlFragment),
    custom_excerpt: projection.excerpt,
    feature_image: null,
    feature_image_alt: null,
    featured: false,
    visibility: 'public',
    status: 'published',
    canonical_url: null,
    updated_at: '2026-09-15T00:00:00.000Z',
    tags: [{ name: 'Test' }]
  };
  const hash = projectionSnapshotHash(post);
  post.tags = replaceProjectionPublisherTags(post.tags, identityTags, hash, {
    sourceFingerprint: projection.sourceFingerprint
  }).map((name) => ({ name }));
  return post;
}

class FakeClient {
  constructor(post) {
    this.current = post;
    this.calls = [];
  }
  names() {
    return this.current.tags.map((tag) => typeof tag === 'string' ? tag : tag.name);
  }
  async getPostsBySourceTag(tag) {
    this.calls.push(['identity', tag]);
    return this.names().includes(tag) ? [this.current] : [];
  }
  async getPostBySlug(slug) {
    this.calls.push(['slug', slug]);
    return this.current.slug === slug ? this.current : null;
  }
  async getPageBySlug() { return null; }
  async getPostById() {
    this.calls.push(['fresh']);
    return this.current;
  }
  async updatePost(id, payload) {
    this.calls.push(['update', id]);
    this.current = {
      ...this.current,
      ...structuredClone(payload),
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: '2026-09-15T00:01:00.000Z'
    };
    return this.current;
  }
  async updatePostMetadata(id, payload) {
    this.calls.push(['stamp', id]);
    this.current = {
      ...this.current,
      ...structuredClone(payload),
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: '2026-09-15T00:02:00.000Z'
    };
    return this.current;
  }
}

test('published stale projection plans and executes an in-place published revision update', async () => {
  const oldDocument = compiled('<h1>Old</h1>');
  const newDocument = compiled('<h1>New</h1>');
  const oldProjection = projectionFor(oldDocument);
  const newProjection = projectionFor(newDocument);
  assert.notEqual(oldProjection.sourceFingerprint, newProjection.sourceFingerprint);

  const client = new FakeClient(managedPublishedPost(oldProjection, oldDocument));
  const plan = await planProjectionSynchronization({
    projection: newProjection,
    compiledDocument: newDocument,
    action: 'publish',
    client,
    repoRoot: '/repo'
  });

  assert.equal(plan.operation, 'update');
  assert.equal(plan.currentStatus, 'published');
  assert.equal(plan.desiredStatus, 'published');
  assert.equal(plan.projectedSourceFingerprint, oldProjection.sourceFingerprint);
  assert.equal(plan.sourceFingerprint, newProjection.sourceFingerprint);

  const result = await synchronizeProjection({
    projection: newProjection,
    compiledDocument: newDocument,
    action: 'publish',
    client,
    repoRoot: '/repo'
  });

  assert.equal(result.status, 'published');
  assert.equal(result.lexical, createHtmlCardLexical('<h1>New</h1>'));
  assert.equal(client.calls.some(([kind]) => kind === 'update'), true);
  assert.equal(client.calls.some(([kind]) => kind === 'create'), false);
});
