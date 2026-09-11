import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHtmlCardLexical } from '../src/lexical.mjs';
import { projectionIdentityTags } from '../src/projection-identity.mjs';
import {
  getProjectionSourceFingerprint,
  projectionSnapshotHash,
  replaceProjectionPublisherTags
} from '../src/projection-managed-state.mjs';
import { planProjectionSynchronization, synchronizeProjection } from '../src/publisher.mjs';

const IDENTITY = projectionIdentityTags({
  articleId: 'article-1',
  variantId: 'variant-ko-1',
  locale: 'ko-KR'
});
const SOURCE_FP = `sha256:${'a'.repeat(64)}`;

function compiled() {
  return {
    htmlFragment: '<h1>본문</h1>',
    locale: 'ko-KR',
    referencedAssets: [],
    diagnostics: []
  };
}

function projection(overrides = {}) {
  return {
    identityTags: IDENTITY,
    sourceFingerprint: SOURCE_FP,
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

function seal(post, sourceFingerprint = SOURCE_FP) {
  const hash = projectionSnapshotHash(post);
  post.tags = replaceProjectionPublisherTags(post.tags, IDENTITY, hash, { sourceFingerprint })
    .map((name) => ({ name }));
  return post;
}

class FakeClient {
  constructor(current, { mutateStatusSideEffect = null } = {}) {
    this.current = current;
    this.calls = [];
    this.lastUpdatePayload = null;
    this.mutateStatusSideEffect = mutateStatusSideEffect;
  }

  async getPostsBySourceTag() {
    this.calls.push('identity');
    return this.current ? [this.current] : [];
  }

  async getPostBySlug(slug) {
    this.calls.push('slug');
    return this.current?.slug === slug ? this.current : null;
  }

  async getPageBySlug() {
    this.calls.push('page');
    return null;
  }

  async getPostById() {
    this.calls.push('fresh');
    return this.current;
  }

  async updatePost(id, payload) {
    this.calls.push('update');
    this.lastUpdatePayload = structuredClone(payload);
    this.current = {
      ...this.current,
      ...payload,
      id,
      updated_at: '2026-01-02T00:00:00.000Z'
    };
    if (this.mutateStatusSideEffect) this.current = this.mutateStatusSideEffect(this.current);
    return this.current;
  }

  async updatePostMetadata(id, payload) {
    this.calls.push('stamp');
    this.current = {
      ...this.current,
      ...payload,
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: '2026-01-03T00:00:00.000Z'
    };
    return this.current;
  }

  async uploadImageBytes() {
    this.calls.push('upload-bytes');
    throw new Error('current revision must not re-upload feature image bytes');
  }

  async uploadImage() {
    this.calls.push('upload-path');
    throw new Error('current revision must not re-upload feature image path');
  }
}

test('same revision + same desired status plans and verifies a true no-op', async () => {
  const existing = seal(ghostPost());
  const client = new FakeClient(existing);

  const plan = await planProjectionSynchronization({
    projection: projection(),
    compiledDocument: compiled(),
    action: 'draft',
    client,
    repoRoot: '/repo'
  });
  assert.equal(plan.operation, 'noop');

  const result = await synchronizeProjection({
    projection: projection(),
    compiledDocument: compiled(),
    action: 'draft',
    client,
    repoRoot: '/repo'
  });

  assert.equal(result.id, existing.id);
  assert.equal(result.status, 'draft');
  assert.ok(!client.calls.includes('update'));
  assert.ok(!client.calls.includes('stamp'));
  assert.ok(!client.calls.includes('upload-bytes'));
  assert.ok(!client.calls.includes('upload-path'));
});

test('same revision draft -> publish performs status-only promotion and preserves revision', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-current-revision-'));
  await mkdir(path.join(repoRoot, 'assets'));
  const cover = path.join(repoRoot, 'assets', 'cover.png');
  const bytes = Buffer.from('stable-cover-bytes');
  await writeFile(cover, bytes);
  const featureImageFingerprint = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

  const existing = seal(ghostPost({ feature_image: 'https://ghost.example/content/images/cover.png' }));
  const client = new FakeClient(existing);
  const source = projection({ featureImage: cover, featureImageFingerprint });

  const plan = await planProjectionSynchronization({
    projection: source,
    compiledDocument: compiled(),
    action: 'publish',
    client,
    repoRoot
  });
  assert.equal(plan.operation, 'status-update');
  assert.deepEqual(plan.featureImage, {
    action: 'preserve',
    url: 'https://ghost.example/content/images/cover.png'
  });

  const result = await synchronizeProjection({
    projection: source,
    compiledDocument: compiled(),
    action: 'publish',
    client,
    repoRoot
  });

  assert.deepEqual(Object.keys(client.lastUpdatePayload).sort(), ['status', 'updated_at']);
  assert.equal(client.lastUpdatePayload.status, 'published');
  assert.equal(result.status, 'published');
  assert.equal(getProjectionSourceFingerprint(result), SOURCE_FP);
  assert.equal(client.calls.filter((call) => call === 'update').length, 1);
  assert.equal(client.calls.filter((call) => call === 'stamp').length, 1);
  assert.ok(!client.calls.includes('upload-bytes'));
  assert.ok(!client.calls.includes('upload-path'));
});

test('status-only promotion fails before sync stamp if Ghost changes another managed field', async () => {
  const existing = seal(ghostPost());
  const client = new FakeClient(existing, {
    mutateStatusSideEffect: (post) => ({ ...post, title: 'Unexpected mutation' })
  });

  await assert.rejects(
    synchronizeProjection({
      projection: projection(),
      compiledDocument: compiled(),
      action: 'publish',
      client,
      repoRoot: '/repo'
    }),
    /changed another managed field/
  );
  assert.ok(client.calls.includes('update'));
  assert.ok(!client.calls.includes('stamp'));
});
