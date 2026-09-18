import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ArticlePublicationError,
  synchronizeArticlePublication
} from '../src/article-publication.mjs';

class PlanningGhostClient {
  constructor() {
    this.mutations = [];
  }
  async getPostsBySourceTag() { return []; }
  async getPostBySlug() { return null; }
  async getPageBySlug() { return null; }
  async createPost(payload) {
    this.mutations.push(['create', payload.slug]);
    throw new Error('unexpected Ghost create');
  }
  async updatePost(id) {
    this.mutations.push(['update', id]);
    throw new Error('unexpected Ghost update');
  }
}

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-publication-plan-guard-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  await mkdir(articleDir, { recursive: true });
  await writeFile(path.join(articleDir, 'en.md'), '# Body\n', 'utf8');
  const manifestPath = path.join(articleDir, 'article.json');
  await writeFile(manifestPath, `${JSON.stringify({
    version: 1,
    articleId: 'article-1',
    requiredLocales: ['en'],
    variants: [{
      variantId: 'variant-en',
      locale: 'en',
      source: 'en.md',
      title: 'Title',
      excerpt: 'Summary',
      slug: 'article-en',
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

test('publicationPlanGuard failure on first internal plan aborts at PREFLIGHT before mutation', async () => {
  const value = await fixture();
  const client = new PlanningGhostClient();
  let guardCalls = 0;

  await assert.rejects(
    synchronizeArticlePublication({
      ...value,
      action: 'draft',
      client,
      publicationPlanGuard() {
        guardCalls += 1;
        throw new Error('control-surface transition no longer allowed');
      }
    }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'PREFLIGHT');
      assert.match(error.cause.message, /transition no longer allowed/);
      return true;
    }
  );

  assert.equal(guardCalls, 1);
  assert.deepEqual(client.mutations, []);
});

test('publicationPlanGuard is rerun after preflight and aborts refreshed drift before Ghost mutation', async () => {
  const value = await fixture();
  const client = new PlanningGhostClient();
  let guardCalls = 0;

  await assert.rejects(
    synchronizeArticlePublication({
      ...value,
      action: 'draft',
      client,
      publicationPlanGuard() {
        guardCalls += 1;
        if (guardCalls === 2) throw new Error('refreshed transition is no longer allowed');
      }
    }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'SOURCE_REVALIDATION');
      assert.match(error.cause.message, /refreshed transition is no longer allowed/);
      return true;
    }
  );

  assert.equal(guardCalls, 2);
  assert.deepEqual(client.mutations, []);
});
