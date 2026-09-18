import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ArticlePublicationError,
  synchronizeArticlePublication
} from '../src/article-publication.mjs';
import { createContentAddressedAssetPublisher } from '../src/content-addressed-asset-publisher.mjs';

class FakeGhostClient {
  constructor() {
    this.posts = new Map();
    this.sequence = 0;
    this.mutations = [];
  }

  names(post) {
    return (post?.tags ?? []).map((tag) => typeof tag === 'string' ? tag : tag?.name).filter(Boolean);
  }

  async getPostsBySourceTag(tag) {
    return [...this.posts.values()].filter((post) => this.names(post).includes(tag));
  }

  async getPostBySlug(slug) {
    return [...this.posts.values()].find((post) => post.slug === slug) ?? null;
  }

  async getPageBySlug() { return null; }

  async createPost(payload) {
    this.mutations.push(['create', payload.slug]);
    const id = `post-${++this.sequence}`;
    const post = {
      ...structuredClone(payload),
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: `2026-01-01T00:00:${String(this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }

  async getPostById(id) {
    return this.posts.get(id) ?? null;
  }

  async updatePostMetadata(id, payload) {
    this.mutations.push(['stamp', id]);
    const current = this.posts.get(id);
    const post = {
      ...current,
      ...structuredClone(payload),
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: `2026-01-02T00:00:${String(++this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }

  async updatePost() {
    throw new Error('updatePost is not expected for a new draft fixture');
  }

  async uploadImageBytes() {
    throw new Error('feature image upload is not expected');
  }
}

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-asset-replan-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  const assetDir = path.join(repoRoot, 'assets', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(assetDir, 'diagram.png'), 'diagram-v1', 'utf8');
  await writeFile(
    path.join(articleDir, 'en.md'),
    '# Body\n\n![diagram](../../assets/article/diagram.png)\n',
    'utf8'
  );
  const manifestPath = path.join(articleDir, 'article.json');
  await writeFile(manifestPath, `${JSON.stringify({
    version: 1,
    articleId: 'article-asset-replan',
    requiredLocales: ['en'],
    variants: [{
      variantId: 'article-asset-replan-en',
      locale: 'en',
      source: 'en.md',
      title: 'Asset replan',
      excerpt: 'summary',
      slug: 'asset-replan',
      publication: {
        tags: [],
        featureImage: null,
        featureImageAlt: null,
        featured: false,
        visibility: 'public',
        canonicalUrl: null
      }
    }],
    translationCheckpoint: null,
    readiness: { epoch: 0, checkpoint: null, invalidations: [] }
  }, null, 2)}\n`, 'utf8');
  return { repoRoot, manifestPath };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('content-addressed asset publish converges to reuse on refreshed plan and draft synchronization succeeds', async () => {
  const value = await fixture();
  const client = new FakeGhostClient();
  const objects = new Map();
  const puts = [];
  const assetPublisher = createContentAddressedAssetPublisher({
    publicBaseUrl: 'https://assets.example/blog/',
    async headObject({ key }) {
      return objects.get(key) ?? null;
    },
    async putObject({ key, bytes, size, sha256: expectedSha256 }) {
      const actual = Buffer.from(bytes);
      puts.push(key);
      objects.set(key, {
        size,
        sha256: sha256(actual)
      });
      assert.equal(sha256(actual), expectedSha256);
    }
  });

  const result = await synchronizeArticlePublication({
    ...value,
    action: 'draft',
    client,
    assetPublisher
  });

  assert.equal(result.status, 'SUCCESS');
  assert.equal(puts.length, 1);
  assert.deepEqual(result.publishedAssets.map((asset) => asset.action), ['publish']);
  assert.deepEqual(result.variants.map((entry) => entry.state.state), ['DRAFT_CURRENT']);
  assert.equal(client.mutations.some(([kind]) => kind === 'create'), true);
});

test('asset replan refuses reuse-to-publish widening before any Ghost mutation', async () => {
  const value = await fixture();
  const client = new FakeGhostClient();
  let plans = 0;
  const assetPublisher = {
    async planAsset(asset) {
      plans += 1;
      return {
        action: plans === 1 ? 'reuse' : 'publish',
        url: `https://assets.example/${asset.fingerprint.slice('sha256:'.length)}.png`,
        ref: asset.ref,
        fingerprint: asset.fingerprint
      };
    },
    async publishAsset() {
      throw new Error('publishAsset must not run for an initial reuse plan');
    }
  };

  await assert.rejects(
    synchronizeArticlePublication({
      ...value,
      action: 'draft',
      client,
      assetPublisher
    }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'SOURCE_REVALIDATION');
      assert.match(error.cause.message, /reuse -> publish/);
      return true;
    }
  );

  assert.deepEqual(client.mutations, []);
});
