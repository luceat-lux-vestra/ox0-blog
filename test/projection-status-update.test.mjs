import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHtmlCardLexical } from '../src/lexical.mjs';
import { projectionSourceFingerprintV1 } from '../src/projection-fingerprint.mjs';
import { projectionIdentityTags } from '../src/projection-identity.mjs';
import {
  projectionSnapshotHash,
  replaceProjectionPublisherTags
} from '../src/projection-managed-state.mjs';
import { planProjectionSynchronization, synchronizeProjection } from '../src/publisher.mjs';

function compiled() {
  return {
    htmlFragment: '<h1>Body</h1>',
    locale: 'en',
    referencedAssets: [],
    diagnostics: []
  };
}

function seal(post, identityTags, sourceFingerprint) {
  const hash = projectionSnapshotHash(post);
  post.tags = replaceProjectionPublisherTags(post.tags, identityTags, hash, {
    sourceFingerprint
  }).map((name) => ({ name }));
  return post;
}

class StatusOnlyClient {
  constructor(post) {
    this.current = post;
    this.calls = [];
    this.updatePayloads = [];
  }

  async getPostsBySourceTag(tag) {
    this.calls.push(['identity', tag]);
    return this.current ? [this.current] : [];
  }

  async getPostBySlug(slug) {
    this.calls.push(['slug', slug]);
    return this.current?.slug === slug ? this.current : null;
  }

  async getPageBySlug(slug) {
    this.calls.push(['page', slug]);
    return null;
  }

  async getPostById(id) {
    this.calls.push(['fresh', id]);
    return this.current?.id === id ? this.current : null;
  }

  async updatePost(id, payload) {
    this.calls.push(['update', id]);
    this.updatePayloads.push(structuredClone(payload));
    this.current = {
      ...this.current,
      ...structuredClone(payload),
      id,
      updated_at: '2026-01-02T00:00:00.000Z'
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
      updated_at: '2026-01-03T00:00:00.000Z'
    };
    return this.current;
  }

  async uploadImageBytes() {
    this.calls.push(['upload-bytes']);
    throw new Error('status-only promotion must not upload feature image bytes');
  }

  async uploadImage() {
    this.calls.push(['upload']);
    throw new Error('status-only promotion must not upload feature images');
  }
}

test('exact-current draft publish is status-only and preserves local feature image/content', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-status-only-'));
  const assetDir = path.join(repoRoot, 'assets');
  await mkdir(assetDir, { recursive: true });
  const featureImage = path.join(assetDir, 'cover.png');
  const bytes = Buffer.from('feature-image-v1');
  await writeFile(featureImage, bytes);
  const featureImageFingerprint = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

  const identityTags = projectionIdentityTags({
    articleId: 'article-status-only',
    variantId: 'variant-status-only-en',
    locale: 'en'
  });
  const projection = {
    identityTags,
    locale: 'en',
    title: 'Title',
    slug: 'status-only-en',
    excerpt: 'Summary',
    tags: ['Architecture'],
    featureImage,
    featureImageFingerprint,
    featureImageAlt: 'Cover',
    featured: false,
    visibility: 'public',
    canonicalUrl: null,
    materialAssets: []
  };
  projection.sourceFingerprint = projectionSourceFingerprintV1(projection, compiled(), {
    materialAssets: [],
    featureImageFingerprint
  });

  const lexical = createHtmlCardLexical(compiled().htmlFragment);
  const existingFeatureUrl = 'https://staging.example/content/images/cover.png';
  const post = seal({
    id: 'post-1',
    title: projection.title,
    slug: projection.slug,
    lexical,
    custom_excerpt: projection.excerpt,
    feature_image: existingFeatureUrl,
    feature_image_alt: projection.featureImageAlt,
    featured: projection.featured,
    visibility: projection.visibility,
    status: 'draft',
    canonical_url: projection.canonicalUrl,
    updated_at: '2026-01-01T00:00:00.000Z',
    tags: projection.tags.map((name) => ({ name }))
  }, identityTags, projection.sourceFingerprint);

  const client = new StatusOnlyClient(post);
  const plan = await planProjectionSynchronization({
    projection,
    compiledDocument: compiled(),
    action: 'publish',
    client,
    repoRoot
  });
  assert.equal(plan.operation, 'status-update');
  assert.deepEqual(plan.featureImage, { action: 'preserve', url: existingFeatureUrl });

  const result = await synchronizeProjection({
    projection,
    compiledDocument: compiled(),
    action: 'publish',
    client,
    repoRoot
  });

  assert.equal(result.status, 'published');
  assert.equal(result.feature_image, existingFeatureUrl);
  assert.equal(result.lexical, lexical);
  assert.equal(result.title, projection.title);
  assert.equal(client.calls.some(([kind]) => kind === 'upload' || kind === 'upload-bytes'), false);
  assert.equal(client.updatePayloads.length, 1);
  assert.deepEqual(Object.keys(client.updatePayloads[0]).sort(), ['status', 'updated_at']);
  assert.equal(client.updatePayloads[0].status, 'published');
});
