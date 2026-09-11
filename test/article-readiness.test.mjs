import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createArticleReadinessInvalidation,
  validateArticleReadinessInvalidation
} from '../src/article-readiness-invalidation.mjs';
import { articleSemanticSourceFingerprintV1 } from '../src/article-readiness-source.mjs';
import {
  ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
  createArticleReadinessCheckpoint,
  deriveReviewedArticleReadiness,
  resolveArticleReadinessInvalidations,
  validateArticleReadinessCheckpoint
} from '../src/article-readiness.mjs';

const KO = `sha256:${'a'.repeat(64)}`;
const EN = `sha256:${'b'.repeat(64)}`;
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

function sourceFingerprint(overrides = {}) {
  return articleSemanticSourceFingerprintV1({
    requiredLocales: overrides.requiredLocales ?? ['ko-KR', 'en'],
    translationFingerprints: overrides.translationFingerprints ?? { 'ko-KR': KO, en: EN }
  });
}

function passReview(source, overrides = {}) {
  return {
    result: 'PASS',
    kind: overrides.kind ?? 'agent',
    contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
    reviewedSourceFingerprint: source
  };
}

test('Article semantic source fingerprint is independent from required locale ordering', () => {
  assert.equal(
    sourceFingerprint({ requiredLocales: ['ko-KR', 'en'] }),
    sourceFingerprint({ requiredLocales: ['en', 'ko-KR'] })
  );
});

test('Article semantic source fingerprint changes when any translation-relevant locale fingerprint changes', () => {
  assert.notEqual(
    sourceFingerprint(),
    sourceFingerprint({ translationFingerprints: { 'ko-KR': `sha256:${'e'.repeat(64)}`, en: EN } })
  );
});

test('missing or unexpected locale fingerprint fails closed', () => {
  assert.throws(
    () => articleSemanticSourceFingerprintV1({
      requiredLocales: ['ko-KR', 'en'],
      translationFingerprints: { 'ko-KR': KO }
    }),
    /missing required locales/
  );
  assert.throws(
    () => articleSemanticSourceFingerprintV1({
      requiredLocales: ['ko-KR', 'en'],
      translationFingerprints: { 'ko-KR': KO, en: EN, ja: KO }
    }),
    /unexpected locale/
  );
});

test('READY is recoverable from exact reviewed source and reviewed epoch', () => {
  const source = sourceFingerprint();
  const checkpoint = createArticleReadinessCheckpoint({
    sourceFingerprint: source,
    reviewedEpoch: 0,
    review: passReview(source)
  });

  assert.deepEqual(validateArticleReadinessCheckpoint(checkpoint), checkpoint);
  assert.deepEqual(
    deriveReviewedArticleReadiness({
      currentSourceFingerprint: source,
      currentEpoch: 0,
      checkpoint,
      invalidations: []
    }),
    { state: 'READY' }
  );
});

test('source change invalidates READY without mutating translation or Ghost state', () => {
  const source = sourceFingerprint();
  const changedSource = sourceFingerprint({
    translationFingerprints: { 'ko-KR': KO, en: `sha256:${'f'.repeat(64)}` }
  });
  const checkpoint = createArticleReadinessCheckpoint({ sourceFingerprint: source, review: passReview(source) });

  assert.deepEqual(
    deriveReviewedArticleReadiness({ currentSourceFingerprint: changedSource, checkpoint }),
    { state: 'REVIEW_REQUIRED', reason: 'SOURCE_CHANGED' }
  );
});

test('multiple durable invalidations survive session loss while source remains unchanged', () => {
  const source = sourceFingerprint();
  const checkpoint = createArticleReadinessCheckpoint({ sourceFingerprint: source, review: passReview(source) });
  const invalidations = [
    createArticleReadinessInvalidation({
      id: ID1,
      epoch: 1,
      reason: 'EXTERNAL_EVIDENCE_CHANGED',
      origin: 'rta',
      reference: 'rta:luceat-lux-vestra/research-to-action#22'
    }),
    createArticleReadinessInvalidation({
      id: ID2,
      epoch: 2,
      reason: 'SEMANTIC_REVIEW_REQUESTED',
      origin: 'user'
    })
  ];

  assert.deepEqual(validateArticleReadinessInvalidation(invalidations[0]), invalidations[0]);
  assert.deepEqual(
    deriveReviewedArticleReadiness({
      currentSourceFingerprint: source,
      currentEpoch: 2,
      checkpoint,
      invalidations
    }),
    { state: 'REVIEW_REQUIRED', reason: 'DURABLE_INVALIDATION', invalidations }
  );
});

test('clearing invalidation records without advancing reviewedEpoch cannot restore READY', () => {
  const source = sourceFingerprint();
  const checkpoint = createArticleReadinessCheckpoint({ sourceFingerprint: source, review: passReview(source) });
  assert.deepEqual(
    deriveReviewedArticleReadiness({
      currentSourceFingerprint: source,
      currentEpoch: 1,
      checkpoint,
      invalidations: []
    }),
    {
      state: 'REVIEW_REQUIRED',
      reason: 'UNREVIEWED_INVALIDATION_EPOCH',
      reviewedEpoch: 0,
      currentEpoch: 1
    }
  );
});

test('resolving invalidations records reviewed epoch and all resolved event ids', () => {
  const source = sourceFingerprint();
  const invalidations = [
    createArticleReadinessInvalidation({
      id: ID1,
      epoch: 1,
      reason: 'EXTERNAL_EVIDENCE_CHANGED',
      origin: 'rta'
    }),
    createArticleReadinessInvalidation({
      id: ID2,
      epoch: 2,
      reason: 'PROVENANCE_WEAKENED',
      origin: 'blog-audit'
    })
  ];
  const resolution = resolveArticleReadinessInvalidations({
    currentSourceFingerprint: source,
    currentEpoch: 2,
    invalidations,
    review: passReview(source)
  });
  assert.equal(resolution.checkpoint.reviewedEpoch, 2);
  assert.deepEqual(resolution.checkpoint.resolvedInvalidationIds, [ID1, ID2]);
  assert.deepEqual(resolution.invalidations, []);
  assert.deepEqual(
    deriveReviewedArticleReadiness({
      currentSourceFingerprint: source,
      currentEpoch: 2,
      checkpoint: resolution.checkpoint,
      invalidations: []
    }),
    { state: 'READY' }
  );
});

test('readiness invalidation refuses chat/session/model identifiers as durable references', () => {
  for (const reference of ['chat:123', 'session:abc', 'model:gpt']) {
    assert.throws(
      () => createArticleReadinessInvalidation({
        id: ID1,
        epoch: 1,
        reason: 'SEMANTIC_REVIEW_REQUESTED',
        origin: 'user',
        reference
      }),
      /must not persist chat\/session\/model identifiers/
    );
  }
});

test('no readiness checkpoint never infers READY', () => {
  assert.deepEqual(
    deriveReviewedArticleReadiness({ currentSourceFingerprint: sourceFingerprint() }),
    { state: 'REVIEW_REQUIRED', reason: 'NO_READINESS_CHECKPOINT' }
  );
});

test('checkpoint creation requires PASS over the exact current source fingerprint', () => {
  const source = sourceFingerprint();
  assert.throws(
    () => createArticleReadinessCheckpoint({
      sourceFingerprint: source,
      review: { ...passReview(source), result: 'UNCERTAIN' }
    }),
    /requires review result PASS/
  );
  assert.throws(
    () => createArticleReadinessCheckpoint({
      sourceFingerprint: source,
      review: passReview(`sha256:${'c'.repeat(64)}`)
    }),
    /exact current source fingerprint/
  );
});

test('unsupported readiness contract and invalidation versions fail closed', () => {
  const source = sourceFingerprint();
  assert.throws(
    () => createArticleReadinessCheckpoint({
      sourceFingerprint: source,
      review: { ...passReview(source), contractVersion: 999 }
    }),
    /unsupported Article readiness review contract version/
  );
  assert.throws(
    () => validateArticleReadinessInvalidation({
      version: 999,
      id: ID1,
      epoch: 1,
      reason: 'EXTERNAL_EVIDENCE_CHANGED',
      origin: 'rta',
      reference: null
    }),
    /unsupported Article readiness invalidation version/
  );
});
