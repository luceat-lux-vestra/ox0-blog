import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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

class RevisionGhostClient {
  constructor() {
    this.posts = new Map();
    this.sequence = 0;
    this.log = [];
    this.failUpdateSlug = null;
  }

  names(post) {
    return (post?.tags ?? []).map((tag) => typeof tag === 'string' ? tag : tag?.name).filter(Boolean);
  }

  async getPostsBySourceTag(tag) {
    this.log.push(['read-identity', tag]);
    return [...this.posts.values()].filter((post) => this.names(post).includes(tag));
  }

  async getPostBySlug(slug) {
    this.log.push(['read-slug', slug]);
    return [...this.posts.values()].find((post) => post.slug === slug) ?? null;
  }

  async getPageBySlug(slug) {
    this.log.push(['read-page', slug]);
    return null;
  }

  async createPost(payload) {
    this.log.push(['create', payload.slug]);
    this.sequence += 1;
    const id = `post-${this.sequence}`;
    const post = {
      ...structuredClone(payload),
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: `2026-09-16T00:00:${String(this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }

  async updatePost(id, payload) {
    const current = this.posts.get(id);
    this.log.push(['update', current?.slug, Object.keys(payload).sort()]);
    if (current?.slug === this.failUpdateSlug) {
      throw new Error(`injected published revision failure: ${current.slug}`);
    }
    this.sequence += 1;
    const post = {
      ...current,
      ...structuredClone(payload),
      id,
      tags: payload.tags ? payload.tags.map((name) => ({ name })) : current.tags,
      updated_at: `2026-09-16T00:01:${String(this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }

  async getPostById(id) {
    this.log.push(['read-id', id]);
    return this.posts.get(id) ?? null;
  }

  async updatePostMetadata(id, payload) {
    const current = this.posts.get(id);
    this.log.push(['stamp', current?.slug]);
    this.sequence += 1;
    const post = {
      ...current,
      ...structuredClone(payload),
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: `2026-09-16T00:02:${String(this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }

  async uploadImageBytes() { throw new Error('feature image not expected'); }
  async uploadImage() { throw new Error('feature image not expected'); }
}

function publication() {
  return {
    tags: [],
    featureImage: null,
    featureImageAlt: null,
    featured: false,
    visibility: 'public',
    canonicalUrl: null
  };
}

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-published-revision-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(path.join(repoRoot, 'assets'), { recursive: true });
  const koPath = path.join(articleDir, 'ko-KR.md');
  const enPath = path.join(articleDir, 'en.md');
  const manifestPath = path.join(articleDir, 'article.json');
  await writeFile(koPath, '# 한국어 v1\n', 'utf8');
  await writeFile(enPath, '# English v1\n', 'utf8');
  await writeFile(manifestPath, `${JSON.stringify({
    version: 1,
    articleId: 'article-revision',
    requiredLocales: ['ko-KR', 'en'],
    variants: [
      {
        variantId: 'revision-ko', locale: 'ko-KR', source: 'ko-KR.md',
        title: '제목', excerpt: '요약', slug: 'revision-ko', publication: publication()
      },
      {
        variantId: 'revision-en', locale: 'en', source: 'en.md',
        title: 'Title', excerpt: 'Summary', slug: 'revision-en', publication: publication()
      }
    ],
    translationCheckpoint: null,
    readiness: { epoch: 0, checkpoint: null, invalidations: [] }
  }, null, 2)}\n`, 'utf8');
  return { repoRoot, articleDir, manifestPath, koPath, enPath };
}

async function currentEvaluation(value) {
  const loaded = await loadArticleManifest(value);
  return evaluateArticleBundle({
    bundle: loaded.bundle,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot,
    publicationByLocale: loaded.publicationByLocale
  });
}

async function makeReady(value) {
  const beforeTranslation = await currentEvaluation(value);
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

  let beforeReadiness = await currentEvaluation(value);
  if (beforeReadiness.readiness.state === 'DRAFT') {
    const requested = await requestArticleSemanticReview({ ...value });
    await writeFile(value.manifestPath, requested.manifestText, 'utf8');
    beforeReadiness = await currentEvaluation(value);
  }
  assert.equal(beforeReadiness.readiness.state, 'REVIEW_REQUIRED');
  const reviewedInvalidationIds = beforeReadiness.bundle.readinessInvalidations.map((entry) => entry.id);

  const accepted = await acceptArticleSemanticReview({
    ...value,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
      reviewedSourceFingerprint: beforeReadiness.articleSourceFingerprint,
      reviewedInvalidationIds
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

async function publishWithPinnedMode(value, client, expectedMode) {
  const prepared = await prepareArticlePublicationOperation({ ...value, action: 'publish', client });
  assert.equal(productionPublishModeForPlan(prepared.plan), expectedMode);
  return synchronizeArticlePublication({
    ...value,
    action: 'publish',
    client,
    authorization: authorization(prepared.plan),
    publicationPlanGuard(nextPlan) {
      return requireProductionPublishMode(nextPlan, expectedMode);
    }
  });
}

async function seedPublishedV1(value, client) {
  await makeReady(value);
  await synchronizeArticlePublication({ ...value, action: 'draft', client });
  const result = await publishWithPinnedMode(
    value,
    client,
    PRODUCTION_PUBLISH_MODE.DRAFT_PROMOTION
  );
  assert.deepEqual(result.variants.map((entry) => entry.state.state), [
    'PUBLISHED_CURRENT',
    'PUBLISHED_CURRENT'
  ]);
}

test('published revision partial failure recovers OUTDATED(PUBLISHED) and retry converges via noop plus update', async () => {
  const value = await fixture();
  const client = new RevisionGhostClient();
  await seedPublishedV1(value, client);

  await writeFile(value.koPath, '# 한국어 v2\n', 'utf8');
  await writeFile(value.enPath, '# English v2\n', 'utf8');
  await makeReady(value);

  const initial = await prepareArticlePublicationOperation({ ...value, action: 'publish', client });
  assert.equal(productionPublishModeForPlan(initial.plan), PRODUCTION_PUBLISH_MODE.PUBLISHED_REVISION);
  assert.deepEqual(initial.plan.variants.map((variant) => variant.ghost.operation), ['update', 'update']);

  client.failUpdateSlug = 'revision-en';
  await assert.rejects(
    synchronizeArticlePublication({
      ...value,
      action: 'publish',
      client,
      authorization: authorization(initial.plan),
      publicationPlanGuard(nextPlan) {
        return requireProductionPublishMode(nextPlan, PRODUCTION_PUBLISH_MODE.PUBLISHED_REVISION);
      }
    }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'GHOST_MUTATION');
      assert.deepEqual(error.recovery.map((entry) => [entry.locale, entry.state.state]), [
        ['ko-KR', 'PUBLISHED_CURRENT'],
        ['en', 'OUTDATED']
      ]);
      assert.equal(error.recovery[1].state.visibility, 'PUBLISHED');
      return true;
    }
  );

  client.failUpdateSlug = null;
  client.log.length = 0;
  const retryPlan = await prepareArticlePublicationOperation({ ...value, action: 'publish', client });
  assert.equal(productionPublishModeForPlan(retryPlan.plan), PRODUCTION_PUBLISH_MODE.PUBLISHED_REVISION);
  assert.deepEqual(retryPlan.plan.variants.map((variant) => variant.ghost.operation), ['noop', 'update']);

  const retried = await synchronizeArticlePublication({
    ...value,
    action: 'publish',
    client,
    authorization: authorization(retryPlan.plan),
    publicationPlanGuard(nextPlan) {
      return requireProductionPublishMode(nextPlan, PRODUCTION_PUBLISH_MODE.PUBLISHED_REVISION);
    }
  });

  assert.deepEqual(retried.variants.map((entry) => entry.state.state), [
    'PUBLISHED_CURRENT',
    'PUBLISHED_CURRENT'
  ]);
  const mutationSlugs = client.log
    .filter(([kind]) => kind === 'create' || kind === 'update')
    .map(([, slug]) => slug);
  assert.equal(mutationSlugs.includes('revision-ko'), false);
  assert.equal(mutationSlugs.includes('revision-en'), true);
});
