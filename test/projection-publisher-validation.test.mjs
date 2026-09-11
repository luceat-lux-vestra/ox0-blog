import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectionIdentityTags } from '../src/projection-identity.mjs';
import { planProjectionSynchronization } from '../src/publisher.mjs';

const IDENTITY = projectionIdentityTags({
  articleId: 'article-1',
  variantId: 'variant-ko-1',
  locale: 'ko-KR'
});
const SOURCE_FP = `sha256:${'a'.repeat(64)}`;

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

const compiledDocument = {
  htmlFragment: '<h1>본문</h1>',
  locale: 'ko-KR',
  referencedAssets: [],
  diagnostics: []
};

class ProbeClient {
  constructor() { this.calls = []; }
  async getPostsBySourceTag() { this.calls.push('identity'); return []; }
  async getPostBySlug() { this.calls.push('slug'); return null; }
  async getPageBySlug() { this.calls.push('page'); return null; }
}

async function repoFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-projection-'));
  await mkdir(path.join(repoRoot, 'assets'));
  return repoRoot;
}

test('malformed slug fails before Ghost access', async () => {
  const client = new ProbeClient();
  await assert.rejects(
    planProjectionSynchronization({
      projection: projection({ slug: 'Bad Slug' }),
      compiledDocument,
      action: 'draft',
      client,
      repoRoot: '/repo'
    }),
    /slug must be lowercase ASCII kebab-case/
  );
  assert.deepEqual(client.calls, []);
});

test('reserved public tag casing fails before Ghost access', async () => {
  const client = new ProbeClient();
  await assert.rejects(
    planProjectionSynchronization({
      projection: projection({ tags: ['#OX0-source-user'] }),
      compiledDocument,
      action: 'draft',
      client,
      repoRoot: '/repo'
    }),
    /reserved for publisher state/
  );
  assert.deepEqual(client.calls, []);
});

test('missing local feature image fails before Ghost access', async () => {
  const repoRoot = await repoFixture();
  const client = new ProbeClient();
  await assert.rejects(
    planProjectionSynchronization({
      projection: projection({ featureImage: path.join(repoRoot, 'assets', 'missing.png') }),
      compiledDocument,
      action: 'draft',
      client,
      repoRoot
    }),
    /does not exist/
  );
  assert.deepEqual(client.calls, []);
});

test('local feature image outside assets fails before Ghost access', async () => {
  const repoRoot = await repoFixture();
  const outside = path.join(repoRoot, 'outside.png');
  await writeFile(outside, 'x');
  const client = new ProbeClient();
  await assert.rejects(
    planProjectionSynchronization({
      projection: projection({ featureImage: outside }),
      compiledDocument,
      action: 'draft',
      client,
      repoRoot
    }),
    /must resolve inside/
  );
  assert.deepEqual(client.calls, []);
});

test('valid confined local feature image permits GET-only dry-run planning', async () => {
  const repoRoot = await repoFixture();
  const cover = path.join(repoRoot, 'assets', 'cover.png');
  await writeFile(cover, 'png');
  const client = new ProbeClient();
  const plan = await planProjectionSynchronization({
    projection: projection({ featureImage: cover }),
    compiledDocument,
    action: 'draft',
    client,
    repoRoot
  });
  assert.deepEqual(client.calls, ['identity', 'slug', 'page']);
  assert.deepEqual(plan.featureImage, { action: 'upload', ref: 'assets/cover.png' });
});
