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
import { evaluateArticleBundle } from '../src/article-evaluation.mjs';
import { loadArticleManifest } from '../src/article-manifest.mjs';
import { planArticlePublication } from '../src/article-planning.mjs';
import {
  acceptArticleSemanticReview,
  acceptArticleTranslationReview,
  requestArticleSemanticReview
} from '../src/article-review-operations.mjs';
import { ARTICLE_READINESS_REVIEW_CONTRACT_VERSION } from '../src/article-readiness.mjs';
import { MarkedCompiler } from '../src/compiler/marked-compiler.mjs';
import { TRANSLATION_REVIEW_CONTRACT_VERSION } from '../src/translation-checkpoint.mjs';

class ReadOnlyGhostClient {
  constructor() { this.calls = []; }
  async getPostsBySourceTag(tag) { this.calls.push(['identity', tag]); return []; }
  async getPostBySlug(slug) { this.calls.push(['post-slug', slug]); return null; }
  async getPageBySlug(slug) { this.calls.push(['page-slug', slug]); return null; }
  async createPost() { throw new Error('mutation must not occur with stale authorization'); }
  async updatePost() { throw new Error('mutation must not occur with stale authorization'); }
  async updatePostMetadata() { throw new Error('mutation must not occur with stale authorization'); }
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
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-readiness-projection-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(path.join(repoRoot, 'assets'), { recursive: true });
  await writeFile(path.join(articleDir, 'ko-KR.md'), '# 의미 본문\n', 'utf8');
  const manifestPath = path.join(articleDir, 'article.json');
  await writeFile(manifestPath, `${JSON.stringify({
    version: 1,
    articleId: 'article-1',
    requiredLocales: ['ko-KR'],
    variants: [{
      variantId: 'variant-ko',
      locale: 'ko-KR',
      source: 'ko-KR.md',
      title: '의미 제목',
      excerpt: '의미 요약',
      slug: 'semantic-article',
      publication: publication()
    }],
    translationCheckpoint: null,
    readiness: { epoch: 0, checkpoint: null, invalidations: [] }
  }, null, 2)}\n`, 'utf8');
  return { repoRoot, articleDir, manifestPath };
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
  const translation = await acceptArticleTranslationReview({
    ...value,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION,
      reviewedFingerprints: initial.currentTranslationFingerprints
    }
  });
  await writeFile(value.manifestPath, translation.manifestText, 'utf8');

  const requested = await requestArticleSemanticReview({ ...value });
  const invalidationId = requested.bundle.readinessInvalidations[0].id;
  await writeFile(value.manifestPath, requested.manifestText, 'utf8');

  const before = await evaluation(value);
  const ready = await acceptArticleSemanticReview({
    ...value,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
      reviewedSourceFingerprint: before.articleSourceFingerprint,
      reviewedInvalidationIds: [invalidationId]
    }
  });
  await writeFile(value.manifestPath, ready.manifestText, 'utf8');
}

async function mutateProjectionOnlyMetadata(value) {
  const raw = JSON.parse(await readFile(value.manifestPath, 'utf8'));
  const variant = raw.variants[0];
  variant.slug = 'semantic-article-renamed';
  variant.publication.tags = ['Architecture', 'Rust'];
  variant.publication.featured = true;
  variant.publication.canonicalUrl = 'https://blog.example/semantic-article';
  await writeFile(value.manifestPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
}

function authorizationFromPlan(plan) {
  return {
    version: ARTICLE_PUBLICATION_AUTHORIZATION_VERSION,
    kind: 'explicit-production-publication',
    articleId: plan.articleId,
    sourceFingerprints: Object.fromEntries(
      plan.variants.map((variant) => [variant.locale, variant.sourceFingerprint])
    )
  };
}

test('projection-only metadata does not invalidate semantic READY but does invalidate projection fingerprint and old publish authorization', async () => {
  const value = await fixture();
  await makeReady(value);

  const client = new ReadOnlyGhostClient();
  const beforeEvaluation = await evaluation(value);
  assert.deepEqual(beforeEvaluation.translation, { state: 'SYNCED' });
  assert.deepEqual(beforeEvaluation.readiness, { state: 'READY' });
  const beforePlan = await planArticlePublication({
    ...value,
    action: 'publish',
    client
  });
  const staleAuthorization = authorizationFromPlan(beforePlan);
  const beforeProjectionFingerprint = beforePlan.variants[0].sourceFingerprint;

  await mutateProjectionOnlyMetadata(value);

  const afterEvaluation = await evaluation(value);
  assert.deepEqual(afterEvaluation.translation, { state: 'SYNCED' });
  assert.deepEqual(afterEvaluation.readiness, { state: 'READY' });
  assert.equal(
    afterEvaluation.currentTranslationFingerprints['ko-KR'],
    beforeEvaluation.currentTranslationFingerprints['ko-KR']
  );
  assert.equal(afterEvaluation.articleSourceFingerprint, beforeEvaluation.articleSourceFingerprint);

  const afterPlan = await planArticlePublication({
    ...value,
    action: 'publish',
    client
  });
  assert.notEqual(afterPlan.variants[0].sourceFingerprint, beforeProjectionFingerprint);

  await assert.rejects(
    synchronizeArticlePublication({
      ...value,
      action: 'publish',
      client,
      authorization: staleAuthorization
    }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'AUTHORIZATION');
      assert.match(error.cause.message, /exact source fingerprint/);
      return true;
    }
  );
});
