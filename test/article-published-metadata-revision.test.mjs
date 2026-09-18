import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ARTICLE_PUBLICATION_AUTHORIZATION_VERSION,
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
import { writePassingClaimProof } from './helpers/claim-proof-fixture.mjs';
import { TRANSLATION_REVIEW_CONTRACT_VERSION } from '../src/translation-checkpoint.mjs';
import {
  PRODUCTION_PUBLISH_MODE,
  productionPublishModeForPlan,
  requireProductionPublishMode
} from '../src/workflow-dispatch-control.mjs';

class MetadataGhostClient {
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
    this.sequence += 1;
    this.mutations.push(['create', payload.slug]);
    const id = `post-${this.sequence}`;
    const post = {
      ...structuredClone(payload),
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: `2026-09-16T01:00:${String(this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }

  async updatePost(id, payload) {
    this.sequence += 1;
    this.mutations.push(['update', id, structuredClone(payload)]);
    const current = this.posts.get(id);
    const post = {
      ...current,
      ...structuredClone(payload),
      id,
      tags: payload.tags ? payload.tags.map((name) => ({ name })) : current.tags,
      updated_at: `2026-09-16T01:01:${String(this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }

  async getPostById(id) { return this.posts.get(id) ?? null; }

  async updatePostMetadata(id, payload) {
    this.sequence += 1;
    const current = this.posts.get(id);
    const post = {
      ...current,
      ...structuredClone(payload),
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: `2026-09-16T01:02:${String(this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }

  async uploadImageBytes() { throw new Error('feature image not expected'); }
  async uploadImage() { throw new Error('feature image not expected'); }
}

function publication(overrides = {}) {
  return {
    tags: ['Architecture'],
    featureImage: null,
    featureImageAlt: null,
    featured: false,
    visibility: 'public',
    canonicalUrl: null,
    ...overrides
  };
}

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-published-metadata-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(path.join(repoRoot, 'assets'), { recursive: true });
  await writeFile(path.join(articleDir, 'en.md'), '# Stable semantic body\n', 'utf8');
  const manifestPath = path.join(articleDir, 'article.json');
  await writeFile(manifestPath, `${JSON.stringify({
    version: 1,
    articleId: 'metadata-revision',
    requiredLocales: ['en'],
    variants: [{
      variantId: 'metadata-revision-en',
      locale: 'en',
      source: 'en.md',
      title: 'Stable semantic title',
      excerpt: 'Stable semantic summary',
      slug: 'metadata-revision-v1',
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
  const initial = await evaluation(value);
  const translated = await acceptArticleTranslationReview({
    ...value,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION,
      reviewedFingerprints: initial.currentTranslationFingerprints
    }
  });
  await writeFile(value.manifestPath, translated.manifestText, 'utf8');

  const requested = await requestArticleSemanticReview({ ...value });
  const invalidationId = requested.bundle.readinessInvalidations.at(-1).id;
  await writeFile(value.manifestPath, requested.manifestText, 'utf8');

  const beforeReadiness = await evaluation(value);
  const claimProof = await writePassingClaimProof(value);
  const accepted = await acceptArticleSemanticReview({
    ...value,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
      reviewedSourceFingerprint: beforeReadiness.articleSourceFingerprint,
      reviewedClaimProofFingerprint: claimProof.fingerprint,
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
    sourceFingerprints: Object.fromEntries(
      plan.variants.map((variant) => [variant.locale, variant.sourceFingerprint])
    )
  };
}

async function publishWithMode(value, client, expectedMode) {
  const prepared = await prepareArticlePublicationOperation({ ...value, action: 'publish', client });
  assert.equal(productionPublishModeForPlan(prepared.plan), expectedMode);
  return synchronizeArticlePublication({
    ...value,
    action: 'publish',
    client,
    authorization: authorization(prepared.plan),
    publicationPlanGuard(plan) {
      return requireProductionPublishMode(plan, expectedMode);
    }
  });
}

test('projection-only metadata keeps READY and updates an existing published post in place under fresh authorization', async () => {
  const value = await fixture();
  const client = new MetadataGhostClient();
  await makeReady(value);

  const beforeEvaluation = await evaluation(value);
  assert.deepEqual(beforeEvaluation.translation, { state: 'SYNCED' });
  assert.deepEqual(beforeEvaluation.readiness, { state: 'READY' });

  await synchronizeArticlePublication({ ...value, action: 'draft', client });
  await publishWithMode(value, client, PRODUCTION_PUBLISH_MODE.DRAFT_PROMOTION);

  const publishedBefore = [...client.posts.values()][0];
  const publishedId = publishedBefore.id;
  const semanticFingerprint = beforeEvaluation.articleSourceFingerprint;
  const translationFingerprint = beforeEvaluation.currentTranslationFingerprints.en;
  client.mutations.length = 0;

  const manifest = JSON.parse(await readFile(value.manifestPath, 'utf8'));
  manifest.variants[0].slug = 'metadata-revision-v2';
  manifest.variants[0].publication.tags = ['Architecture', 'Rust'];
  manifest.variants[0].publication.featured = true;
  manifest.variants[0].publication.canonicalUrl = 'https://blog.example/metadata-revision-v2';
  await writeFile(value.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const afterEvaluation = await evaluation(value);
  assert.deepEqual(afterEvaluation.translation, { state: 'SYNCED' });
  assert.deepEqual(afterEvaluation.readiness, { state: 'READY' });
  assert.equal(afterEvaluation.articleSourceFingerprint, semanticFingerprint);
  assert.equal(afterEvaluation.currentTranslationFingerprints.en, translationFingerprint);

  const prepared = await prepareArticlePublicationOperation({ ...value, action: 'publish', client });
  assert.equal(productionPublishModeForPlan(prepared.plan), PRODUCTION_PUBLISH_MODE.PUBLISHED_REVISION);
  assert.equal(prepared.plan.variants[0].ghost.operation, 'update');
  assert.equal(prepared.plan.variants[0].ghost.currentStatus, 'published');
  assert.notEqual(
    prepared.plan.variants[0].sourceFingerprint,
    prepared.plan.variants[0].ghost.projectedSourceFingerprint
  );

  const result = await synchronizeArticlePublication({
    ...value,
    action: 'publish',
    client,
    authorization: authorization(prepared.plan),
    publicationPlanGuard(plan) {
      return requireProductionPublishMode(plan, PRODUCTION_PUBLISH_MODE.PUBLISHED_REVISION);
    }
  });

  assert.deepEqual(result.variants.map((entry) => entry.state.state), ['PUBLISHED_CURRENT']);
  const publishedAfter = [...client.posts.values()][0];
  assert.equal(publishedAfter.id, publishedId);
  assert.equal(publishedAfter.status, 'published');
  assert.equal(publishedAfter.slug, 'metadata-revision-v2');
  assert.equal(publishedAfter.featured, true);
  assert.equal(publishedAfter.canonical_url, 'https://blog.example/metadata-revision-v2');
  assert.equal(publishedAfter.tags.some((tag) => tag.name === 'Architecture'), true);
  assert.equal(publishedAfter.tags.some((tag) => tag.name === 'Rust'), true);
  assert.equal(client.mutations.some(([kind]) => kind === 'create'), false);
  assert.equal(client.mutations.some(([kind]) => kind === 'update'), true);
});
