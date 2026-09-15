import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ARTICLE_PUBLICATION_AUTHORIZATION_VERSION,
  ArticlePublicationError,
  synchronizeArticlePublication
} from '../src/article-publication.mjs';
import { prepareArticlePublicationOperation } from '../src/article-planning.mjs';
import {
  acceptArticleSemanticReview,
  acceptArticleTranslationReview,
  requestArticleSemanticReview
} from '../src/article-review-operations.mjs';
import { evaluateArticleBundle } from '../src/article-evaluation.mjs';
import { loadArticleManifest } from '../src/article-manifest.mjs';
import { ARTICLE_READINESS_REVIEW_CONTRACT_VERSION } from '../src/article-readiness.mjs';
import { MarkedCompiler } from '../src/compiler/marked-compiler.mjs';
import { TRANSLATION_REVIEW_CONTRACT_VERSION } from '../src/translation-checkpoint.mjs';
import {
  PRODUCTION_PUBLISH_MODE,
  productionPublishModeForPlan,
  requireProductionPublishMode
} from '../src/workflow-dispatch-control.mjs';

class FeatureRevisionGhostClient {
  constructor() {
    this.posts = new Map();
    this.sequence = 0;
    this.uploads = [];
    this.failPublishedUpdate = false;
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
    const id = `post-${++this.sequence}`;
    const post = {
      ...structuredClone(payload),
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: `2026-09-16T02:00:${String(this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }

  async updatePost(id, payload) {
    const current = this.posts.get(id);
    if (this.failPublishedUpdate && current?.status === 'published') {
      throw new Error('injected published post update failure after feature image upload');
    }
    const post = {
      ...current,
      ...structuredClone(payload),
      id,
      tags: payload.tags ? payload.tags.map((name) => ({ name })) : current.tags,
      updated_at: `2026-09-16T02:01:${String(++this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }

  async getPostById(id) { return this.posts.get(id) ?? null; }

  async updatePostMetadata(id, payload) {
    const current = this.posts.get(id);
    const post = {
      ...current,
      ...structuredClone(payload),
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: `2026-09-16T02:02:${String(++this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }

  async uploadImageBytes(file, ref) {
    const result = {
      ref,
      filename: file.filename,
      url: 'https://ghost.example/content/images/revision-cover.png'
    };
    this.uploads.push(result);
    return { url: result.url };
  }

  async uploadImage() { throw new Error('path upload is not expected'); }
}

function publication(overrides = {}) {
  return {
    tags: [],
    featureImage: null,
    featureImageAlt: null,
    featured: false,
    visibility: 'public',
    canonicalUrl: null,
    ...overrides
  };
}

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-published-feature-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  const assetDir = path.join(repoRoot, 'assets', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(articleDir, 'en.md'), '# Stable body\n', 'utf8');
  await writeFile(path.join(assetDir, 'cover.png'), 'cover-v2', 'utf8');
  const manifestPath = path.join(articleDir, 'article.json');
  await writeFile(manifestPath, `${JSON.stringify({
    version: 1,
    articleId: 'feature-revision',
    requiredLocales: ['en'],
    variants: [{
      variantId: 'feature-revision-en',
      locale: 'en',
      source: 'en.md',
      title: 'Feature revision',
      excerpt: 'Summary',
      slug: 'feature-revision',
      publication: publication()
    }],
    translationCheckpoint: null,
    readiness: { epoch: 0, checkpoint: null, invalidations: [] }
  }, null, 2)}\n`, 'utf8');
  return { repoRoot, manifestPath };
}

async function evaluation(value) {
  const loaded = await loadArticleManifest(value);
  return evaluateArticleBundle({
    bundle: loaded.bundle,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot,
    publicationByLocale: loaded.publicationByLocale
  });
}

async function makeReady(value) {
  const beforeTranslation = await evaluation(value);
  const translated = await acceptArticleTranslationReview({
    ...value,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION,
      reviewedFingerprints: beforeTranslation.currentTranslationFingerprints
    }
  });
  await writeFile(value.manifestPath, translated.manifestText, 'utf8');

  const requested = await requestArticleSemanticReview({ ...value });
  const invalidationId = requested.bundle.readinessInvalidations.at(-1).id;
  await writeFile(value.manifestPath, requested.manifestText, 'utf8');

  const beforeReadiness = await evaluation(value);
  const accepted = await acceptArticleSemanticReview({
    ...value,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
      reviewedSourceFingerprint: beforeReadiness.articleSourceFingerprint,
      reviewedInvalidationIds: [invalidationId]
    }
  });
  await writeFile(value.manifestPath, accepted.manifestText, 'utf8');
}

function authorization(plan) {
  return {
    version: ARTICLE_PUBLICATION_AUTHORIZATION_VERSION,
    kind: 'explicit-production-publication',
    articleId: plan.articleId,
    sourceFingerprints: Object.fromEntries(plan.variants.map((variant) => [variant.locale, variant.sourceFingerprint]))
  };
}

async function publishWithMode(value, client, mode) {
  const prepared = await prepareArticlePublicationOperation({ ...value, action: 'publish', client });
  assert.equal(productionPublishModeForPlan(prepared.plan), mode);
  return synchronizeArticlePublication({
    ...value,
    action: 'publish',
    client,
    authorization: authorization(prepared.plan),
    publicationPlanGuard(plan) {
      return requireProductionPublishMode(plan, mode);
    }
  });
}

test('published revision keeps the old public revision when feature image upload succeeds but post update fails', async () => {
  const value = await fixture();
  const client = new FeatureRevisionGhostClient();
  await makeReady(value);
  await synchronizeArticlePublication({ ...value, action: 'draft', client });
  await publishWithMode(value, client, PRODUCTION_PUBLISH_MODE.DRAFT_PROMOTION);

  const existing = [...client.posts.values()][0];
  const postId = existing.id;
  const oldLexical = existing.lexical;
  const oldRevisionTags = client.names(existing).filter((name) => name.startsWith('#ox0-revision-'));
  assert.equal(existing.status, 'published');
  assert.equal(existing.feature_image, null);

  const manifest = JSON.parse(await readFile(value.manifestPath, 'utf8'));
  manifest.variants[0].publication.featureImage = 'assets/article/cover.png';
  manifest.variants[0].publication.featureImageAlt = 'Revision cover';
  await writeFile(value.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await makeReady(value);

  const prepared = await prepareArticlePublicationOperation({ ...value, action: 'publish', client });
  assert.equal(productionPublishModeForPlan(prepared.plan), PRODUCTION_PUBLISH_MODE.PUBLISHED_REVISION);
  assert.equal(prepared.plan.variants[0].ghost.operation, 'update');
  assert.equal(prepared.plan.variants[0].ghost.featureImage.action, 'upload');

  client.failPublishedUpdate = true;
  await assert.rejects(
    synchronizeArticlePublication({
      ...value,
      action: 'publish',
      client,
      authorization: authorization(prepared.plan),
      publicationPlanGuard(plan) {
        return requireProductionPublishMode(plan, PRODUCTION_PUBLISH_MODE.PUBLISHED_REVISION);
      }
    }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'GHOST_MUTATION');
      assert.deepEqual(error.featureImageUploads, [{
        method: 'uploadImageBytes',
        ref: 'assets/article/cover.png',
        url: 'https://ghost.example/content/images/revision-cover.png'
      }]);
      assert.equal(error.recovery[0].state.state, 'OUTDATED');
      assert.equal(error.recovery[0].state.visibility, 'PUBLISHED');
      return true;
    }
  );

  assert.equal(client.uploads.length, 1);
  const afterFailure = client.posts.get(postId);
  assert.equal(afterFailure.status, 'published');
  assert.equal(afterFailure.feature_image, null);
  assert.equal(afterFailure.lexical, oldLexical);
  assert.deepEqual(
    client.names(afterFailure).filter((name) => name.startsWith('#ox0-revision-')),
    oldRevisionTags
  );
});
