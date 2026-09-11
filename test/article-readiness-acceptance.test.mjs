import test from 'node:test';
import assert from 'node:assert/strict';
import { articleSemanticSourceFingerprintV1 } from '../src/article-readiness-source.mjs';
import {
  ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
  createArticleReadinessCheckpoint
} from '../src/article-readiness.mjs';
import {
  ARTICLE_BUNDLE_CONTRACT_VERSION,
  acceptArticleBundleReadinessReview,
  normalizeArticleBundle,
  recoverArticleBundleReviewState
} from '../src/article-bundle.mjs';
import {
  TRANSLATION_REVIEW_CONTRACT_VERSION,
  createTranslationCheckpoint
} from '../src/translation-checkpoint.mjs';

const ID2 = '22222222-2222-4222-8222-222222222222';
const OLD = {
  'ko-KR': `sha256:${'a'.repeat(64)}`,
  en: `sha256:${'b'.repeat(64)}`
};
const CHANGED = {
  'ko-KR': `sha256:${'c'.repeat(64)}`,
  en: `sha256:${'d'.repeat(64)}`
};

function article() {
  return {
    articleId: 'article-1',
    requiredLocales: ['ko-KR', 'en'],
    variants: [
      {
        variantId: 'variant-ko', locale: 'ko-KR', title: '제목', excerpt: '요약',
        slug: 'article-ko', body: '# 본문\n', sourcePath: '/repo/posts/article/ko-KR.md'
      },
      {
        variantId: 'variant-en', locale: 'en', title: 'Title', excerpt: 'Summary',
        slug: 'article-en', body: '# Body\n', sourcePath: '/repo/posts/article/en.md'
      }
    ]
  };
}

function translationCheckpoint(current) {
  return createTranslationCheckpoint({
    requiredLocales: ['ko-KR', 'en'],
    currentFingerprints: current,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION,
      reviewedFingerprints: current
    }
  });
}

function readinessReview(sourceFingerprint, reviewedInvalidationIds = []) {
  return {
    result: 'PASS',
    kind: 'agent',
    contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
    reviewedSourceFingerprint: sourceFingerprint,
    reviewedInvalidationIds
  };
}

function readyBundle() {
  const sourceFingerprint = articleSemanticSourceFingerprintV1({
    requiredLocales: ['ko-KR', 'en'],
    translationFingerprints: OLD
  });
  return {
    version: ARTICLE_BUNDLE_CONTRACT_VERSION,
    article: article(),
    translationCheckpoint: translationCheckpoint(OLD),
    readinessEpoch: 0,
    readinessCheckpoint: createArticleReadinessCheckpoint({
      sourceFingerprint,
      reviewedEpoch: 0,
      review: readinessReview(sourceFingerprint)
    }),
    readinessInvalidations: []
  };
}

test('source edit can become READY again after translations are re-synchronized and exact new source passes readiness review', () => {
  const bundle = normalizeArticleBundle({
    ...readyBundle(),
    translationCheckpoint: translationCheckpoint(CHANGED)
  });
  const before = recoverArticleBundleReviewState(bundle, {
    currentTranslationFingerprints: CHANGED
  });
  assert.deepEqual(before.translation, { state: 'SYNCED' });
  assert.deepEqual(before.readiness, { state: 'REVIEW_REQUIRED', reason: 'SOURCE_CHANGED' });

  const accepted = acceptArticleBundleReadinessReview(bundle, {
    currentTranslationFingerprints: CHANGED,
    review: readinessReview(before.articleSourceFingerprint)
  });
  const after = recoverArticleBundleReviewState(accepted, {
    currentTranslationFingerprints: CHANGED
  });
  assert.deepEqual(after.readiness, { state: 'READY' });
  assert.equal(accepted.readinessCheckpoint.sourceFingerprint, before.articleSourceFingerprint);
  assert.equal(accepted.readinessCheckpoint.reviewedEpoch, 0);
  assert.deepEqual(accepted.readinessCheckpoint.resolvedInvalidationIds, []);
});

test('review cannot skip a missing invalidation epoch even when the remaining active event is explicitly reviewed', () => {
  const corrupt = normalizeArticleBundle({
    ...readyBundle(),
    readinessEpoch: 2,
    readinessInvalidations: [
      {
        version: 1,
        id: ID2,
        epoch: 2,
        reason: 'EXTERNAL_EVIDENCE_CHANGED',
        origin: 'rta',
        reference: 'rta:repo#2'
      }
    ]
  });
  const before = recoverArticleBundleReviewState(corrupt, {
    currentTranslationFingerprints: OLD
  });
  assert.equal(before.readiness.state, 'REVIEW_REQUIRED');

  assert.throws(
    () => acceptArticleBundleReadinessReview(corrupt, {
      currentTranslationFingerprints: OLD,
      review: readinessReview(before.articleSourceFingerprint, [ID2])
    }),
    /does not cover every unreviewed epoch/
  );
});

test('READY cannot be re-accepted without a new review-required transition', () => {
  const bundle = readyBundle();
  const current = recoverArticleBundleReviewState(bundle, {
    currentTranslationFingerprints: OLD
  });
  assert.deepEqual(current.readiness, { state: 'READY' });
  assert.throws(
    () => acceptArticleBundleReadinessReview(bundle, {
      currentTranslationFingerprints: OLD,
      review: readinessReview(current.articleSourceFingerprint)
    }),
    /can be accepted only from REVIEW_REQUIRED/
  );
});
