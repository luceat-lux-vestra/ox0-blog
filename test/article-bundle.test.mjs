import test from 'node:test';
import assert from 'node:assert/strict';
import { createArticleReadinessInvalidation } from '../src/article-readiness-invalidation.mjs';
import { articleSemanticSourceFingerprintV1 } from '../src/article-readiness-source.mjs';
import {
  ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
  createArticleReadinessCheckpoint
} from '../src/article-readiness.mjs';
import {
  ARTICLE_BUNDLE_CONTRACT_VERSION,
  normalizeArticleBundle,
  recoverArticleBundleReviewState,
  resolveArticleBundleReadinessInvalidation
} from '../src/article-bundle.mjs';
import {
  TRANSLATION_REVIEW_CONTRACT_VERSION,
  createTranslationCheckpoint
} from '../src/translation-checkpoint.mjs';

const KO = `sha256:${'a'.repeat(64)}`;
const EN = `sha256:${'b'.repeat(64)}`;

function article() {
  return {
    articleId: 'article-1',
    requiredLocales: ['ko-KR', 'en'],
    variants: [
      {
        variantId: 'variant-ko',
        locale: 'ko-KR',
        title: '제목',
        excerpt: '요약',
        slug: 'article-ko',
        body: '# 본문\n',
        sourcePath: '/repo/posts/article/ko-KR.md'
      },
      {
        variantId: 'variant-en',
        locale: 'en',
        title: 'Title',
        excerpt: 'Summary',
        slug: 'article-en',
        body: '# Body\n',
        sourcePath: '/repo/posts/article/en.md'
      }
    ]
  };
}

function fingerprints() {
  return { 'ko-KR': KO, en: EN };
}

function reviewedBundle(overrides = {}) {
  const current = fingerprints();
  const translationCheckpoint = createTranslationCheckpoint({
    requiredLocales: ['ko-KR', 'en'],
    currentFingerprints: current,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION,
      reviewedFingerprints: current
    }
  });
  const sourceFingerprint = articleSemanticSourceFingerprintV1({
    requiredLocales: ['ko-KR', 'en'],
    translationFingerprints: current
  });
  const readinessCheckpoint = createArticleReadinessCheckpoint({
    sourceFingerprint,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
      reviewedSourceFingerprint: sourceFingerprint
    }
  });

  return {
    version: ARTICLE_BUNDLE_CONTRACT_VERSION,
    article: article(),
    translationCheckpoint,
    readinessCheckpoint,
    readinessInvalidation: null,
    ...overrides
  };
}

function readinessPass(sourceFingerprint) {
  return {
    result: 'PASS',
    kind: 'agent',
    contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
    reviewedSourceFingerprint: sourceFingerprint
  };
}

test('fresh session recovers SYNCED + READY from durable facts only', () => {
  const recovered = recoverArticleBundleReviewState(reviewedBundle(), {
    currentTranslationFingerprints: fingerprints()
  });
  assert.deepEqual(recovered.translation, { state: 'SYNCED' });
  assert.deepEqual(recovered.readiness, { state: 'READY' });
  assert.match(recovered.articleSourceFingerprint, /^sha256:[a-f0-9]{64}$/);
});

test('bundle refuses persisted derived workflow state and publication authorization', () => {
  for (const field of ['translationState', 'readinessState', 'ghostProjectionState', 'gitState', 'publicationAuthorization']) {
    assert.throws(
      () => normalizeArticleBundle({ ...reviewedBundle(), [field]: 'SHOULD_NOT_PERSIST' }),
      new RegExp(`must not persist derived/ephemeral field: ${field}`)
    );
  }
});

test('ambiguous LocaleVariant.status is rejected instead of becoming publish authorization', () => {
  const value = reviewedBundle();
  value.article.variants[0].status = 'published';
  assert.throws(() => normalizeArticleBundle(value), /LocaleVariant.status is not v1 source state/);
});

test('missing current locale derives INCOMPLETE and cannot recover READY', () => {
  const recovered = recoverArticleBundleReviewState(reviewedBundle(), {
    currentTranslationFingerprints: { 'ko-KR': KO }
  });
  assert.deepEqual(recovered.translation, { state: 'INCOMPLETE', missingLocales: ['en'] });
  assert.equal(recovered.articleSourceFingerprint, null);
  assert.deepEqual(recovered.readiness, { state: 'REVIEW_REQUIRED', reason: 'SOURCE_INCOMPLETE' });
});

test('one locale semantic change makes translation STALE and invalidates readiness independently', () => {
  const recovered = recoverArticleBundleReviewState(reviewedBundle(), {
    currentTranslationFingerprints: { 'ko-KR': `sha256:${'d'.repeat(64)}`, en: EN }
  });
  assert.deepEqual(recovered.translation, {
    state: 'STALE',
    changedLocales: ['ko-KR'],
    staleLocales: ['en']
  });
  assert.deepEqual(recovered.readiness, { state: 'REVIEW_REQUIRED', reason: 'SOURCE_CHANGED' });
});

test('durable RTA invalidation survives fresh-session recovery while translation remains SYNCED', () => {
  const invalidation = createArticleReadinessInvalidation({
    reason: 'EXTERNAL_EVIDENCE_CHANGED',
    origin: 'rta',
    reference: 'rta:luceat-lux-vestra/research-to-action#22'
  });
  const recovered = recoverArticleBundleReviewState(
    reviewedBundle({ readinessInvalidation: invalidation }),
    { currentTranslationFingerprints: fingerprints() }
  );
  assert.deepEqual(recovered.translation, { state: 'SYNCED' });
  assert.deepEqual(recovered.readiness, {
    state: 'REVIEW_REQUIRED',
    reason: 'DURABLE_INVALIDATION',
    invalidation
  });
});

test('readiness invalidation resolves only through exact-source PASS and records resolved event id', () => {
  const invalidation = createArticleReadinessInvalidation({
    reason: 'PROVENANCE_WEAKENED',
    origin: 'blog-audit',
    reference: 'article-audit:claim-set-1'
  });
  const invalidated = reviewedBundle({ readinessInvalidation: invalidation });
  const before = recoverArticleBundleReviewState(invalidated, {
    currentTranslationFingerprints: fingerprints()
  });

  const resolved = resolveArticleBundleReadinessInvalidation(invalidated, {
    currentTranslationFingerprints: fingerprints(),
    review: readinessPass(before.articleSourceFingerprint)
  });
  assert.equal(resolved.readinessInvalidation, null);
  assert.equal(resolved.readinessCheckpoint.resolvedInvalidationId, invalidation.id);
  assert.deepEqual(
    recoverArticleBundleReviewState(resolved, { currentTranslationFingerprints: fingerprints() }).readiness,
    { state: 'READY' }
  );
});

test('manual invalidation removal without a resolving checkpoint leaves no false persisted proof', () => {
  const invalidation = createArticleReadinessInvalidation({
    reason: 'SEMANTIC_REVIEW_REQUESTED',
    origin: 'user'
  });
  const value = reviewedBundle({ readinessInvalidation: invalidation });
  const manuallyCleared = normalizeArticleBundle({ ...value, readinessInvalidation: null });
  assert.notEqual(manuallyCleared.readinessCheckpoint.resolvedInvalidationId, invalidation.id);
});

test('bundle rejects keeping an invalidation active after its event id was resolved', () => {
  const invalidation = createArticleReadinessInvalidation({
    reason: 'EXTERNAL_EVIDENCE_CHANGED',
    origin: 'rta',
    reference: 'rta:repo#1'
  });
  const base = reviewedBundle();
  const sourceFingerprint = base.readinessCheckpoint.sourceFingerprint;
  const resolvedCheckpoint = createArticleReadinessCheckpoint({
    sourceFingerprint,
    resolvedInvalidationId: invalidation.id,
    review: readinessPass(sourceFingerprint)
  });
  assert.throws(
    () => normalizeArticleBundle({
      ...base,
      readinessCheckpoint: resolvedCheckpoint,
      readinessInvalidation: invalidation
    }),
    /cannot keep an invalidation active after the readiness checkpoint resolves that event/
  );
});

test('invalidation resolution refuses non-SYNCED translation state', () => {
  const invalidation = createArticleReadinessInvalidation({
    reason: 'EXTERNAL_EVIDENCE_CHANGED',
    origin: 'rta'
  });
  assert.throws(
    () => resolveArticleBundleReadinessInvalidation(
      reviewedBundle({ readinessInvalidation: invalidation }),
      {
        currentTranslationFingerprints: { 'ko-KR': `sha256:${'f'.repeat(64)}`, en: EN },
        review: readinessPass(articleSemanticSourceFingerprintV1({
          requiredLocales: ['ko-KR', 'en'],
          translationFingerprints: { 'ko-KR': `sha256:${'f'.repeat(64)}`, en: EN }
        }))
      }
    ),
    /cannot resolve while translation state is not SYNCED/
  );
});

test('unsupported future bundle version fails closed', () => {
  assert.throws(
    () => normalizeArticleBundle({ ...reviewedBundle(), version: 999 }),
    /unsupported Article bundle contract version/
  );
});
