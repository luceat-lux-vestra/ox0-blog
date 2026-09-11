import test from 'node:test';
import assert from 'node:assert/strict';
import { articleSemanticSourceFingerprintV1 } from '../src/article-readiness-source.mjs';
import {
  ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
  createArticleReadinessCheckpoint
} from '../src/article-readiness.mjs';
import {
  ARTICLE_BUNDLE_CONTRACT_VERSION,
  invalidateArticleBundleReadiness,
  normalizeArticleBundle,
  recoverArticleBundleReviewState,
  resolveArticleBundleReadinessInvalidations
} from '../src/article-bundle.mjs';
import {
  TRANSLATION_REVIEW_CONTRACT_VERSION,
  createTranslationCheckpoint
} from '../src/translation-checkpoint.mjs';

const KO = `sha256:${'a'.repeat(64)}`;
const EN = `sha256:${'b'.repeat(64)}`;
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

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

function fingerprints() {
  return { 'ko-KR': KO, en: EN };
}

function readinessPass(sourceFingerprint) {
  return {
    result: 'PASS',
    kind: 'agent',
    contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
    reviewedSourceFingerprint: sourceFingerprint
  };
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
    reviewedEpoch: 0,
    review: readinessPass(sourceFingerprint)
  });

  return {
    version: ARTICLE_BUNDLE_CONTRACT_VERSION,
    article: article(),
    translationCheckpoint,
    readinessEpoch: 0,
    readinessCheckpoint,
    readinessInvalidations: [],
    ...overrides
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

test('multiple RTA/user/audit signals increment readiness epoch and survive fresh-session recovery', () => {
  const first = invalidateArticleBundleReadiness(reviewedBundle(), {
    id: ID1,
    reason: 'EXTERNAL_EVIDENCE_CHANGED',
    origin: 'rta',
    reference: 'rta:luceat-lux-vestra/research-to-action#22'
  });
  const second = invalidateArticleBundleReadiness(first, {
    id: ID2,
    reason: 'SEMANTIC_REVIEW_REQUESTED',
    origin: 'user'
  });

  assert.equal(second.readinessEpoch, 2);
  assert.deepEqual(second.readinessInvalidations.map((entry) => entry.epoch), [1, 2]);
  const recovered = recoverArticleBundleReviewState(second, {
    currentTranslationFingerprints: fingerprints()
  });
  assert.deepEqual(recovered.translation, { state: 'SYNCED' });
  assert.equal(recovered.readiness.state, 'REVIEW_REQUIRED');
  assert.equal(recovered.readiness.reason, 'DURABLE_INVALIDATION');
  assert.deepEqual(recovered.readiness.invalidations.map((entry) => entry.id), [ID1, ID2]);
});

test('manually clearing invalidation records cannot restore READY while epoch is unreviewed', () => {
  const invalidated = invalidateArticleBundleReadiness(reviewedBundle(), {
    id: ID1,
    reason: 'PROVENANCE_WEAKENED',
    origin: 'blog-audit'
  });
  const manuallyCleared = normalizeArticleBundle({
    ...invalidated,
    readinessInvalidations: []
  });
  assert.deepEqual(
    recoverArticleBundleReviewState(manuallyCleared, {
      currentTranslationFingerprints: fingerprints()
    }).readiness,
    {
      state: 'REVIEW_REQUIRED',
      reason: 'UNREVIEWED_INVALIDATION_EPOCH',
      reviewedEpoch: 0,
      currentEpoch: 1
    }
  );
});

test('atomic invalidation resolution reviews exact source and records epoch + all event ids', () => {
  let bundle = invalidateArticleBundleReadiness(reviewedBundle(), {
    id: ID1,
    reason: 'EXTERNAL_EVIDENCE_CHANGED',
    origin: 'rta'
  });
  bundle = invalidateArticleBundleReadiness(bundle, {
    id: ID2,
    reason: 'PROVENANCE_WEAKENED',
    origin: 'blog-audit'
  });
  const before = recoverArticleBundleReviewState(bundle, {
    currentTranslationFingerprints: fingerprints()
  });
  const resolved = resolveArticleBundleReadinessInvalidations(bundle, {
    currentTranslationFingerprints: fingerprints(),
    review: readinessPass(before.articleSourceFingerprint)
  });

  assert.equal(resolved.readinessEpoch, 2);
  assert.deepEqual(resolved.readinessInvalidations, []);
  assert.equal(resolved.readinessCheckpoint.reviewedEpoch, 2);
  assert.deepEqual(resolved.readinessCheckpoint.resolvedInvalidationIds, [ID1, ID2]);
  assert.deepEqual(
    recoverArticleBundleReviewState(resolved, {
      currentTranslationFingerprints: fingerprints()
    }).readiness,
    { state: 'READY' }
  );
});

test('invalidation resolution refuses non-SYNCED translation state', () => {
  const bundle = invalidateArticleBundleReadiness(reviewedBundle(), {
    id: ID1,
    reason: 'EXTERNAL_EVIDENCE_CHANGED',
    origin: 'rta'
  });
  const changed = { 'ko-KR': `sha256:${'f'.repeat(64)}`, en: EN };
  const changedSource = articleSemanticSourceFingerprintV1({
    requiredLocales: ['ko-KR', 'en'],
    translationFingerprints: changed
  });
  assert.throws(
    () => resolveArticleBundleReadinessInvalidations(bundle, {
      currentTranslationFingerprints: changed,
      review: readinessPass(changedSource)
    }),
    /cannot resolve while translation state is not SYNCED/
  );
});

test('bundle fails closed on invalid readiness epoch relationships', () => {
  const invalidation = {
    version: 1,
    id: ID1,
    epoch: 2,
    reason: 'EXTERNAL_EVIDENCE_CHANGED',
    origin: 'rta',
    reference: null
  };
  assert.throws(
    () => normalizeArticleBundle({
      ...reviewedBundle(),
      readinessEpoch: 1,
      readinessInvalidations: [invalidation]
    }),
    /cannot exceed bundle readinessEpoch/
  );
});

test('unsupported future bundle version fails closed', () => {
  assert.throws(
    () => normalizeArticleBundle({ ...reviewedBundle(), version: 999 }),
    /unsupported Article bundle contract version/
  );
});
