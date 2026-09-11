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
  validateArticleReadinessCheckpoint
} from '../src/article-readiness.mjs';

const KO = `sha256:${'a'.repeat(64)}`;
const EN = `sha256:${'b'.repeat(64)}`;

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

test('READY is recoverable from exact reviewed source with no active invalidation', () => {
  const source = sourceFingerprint();
  const checkpoint = createArticleReadinessCheckpoint({
    sourceFingerprint: source,
    review: passReview(source)
  });

  assert.deepEqual(validateArticleReadinessCheckpoint(checkpoint), checkpoint);
  assert.deepEqual(
    deriveReviewedArticleReadiness({ currentSourceFingerprint: source, checkpoint }),
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

test('durable RTA evidence invalidation survives session loss even when Article source is unchanged', () => {
  const source = sourceFingerprint();
  const checkpoint = createArticleReadinessCheckpoint({ sourceFingerprint: source, review: passReview(source) });
  const invalidation = createArticleReadinessInvalidation({
    reason: 'EXTERNAL_EVIDENCE_CHANGED',
    origin: 'rta',
    reference: 'rta:luceat-lux-vestra/research-to-action#22'
  });

  assert.deepEqual(validateArticleReadinessInvalidation(invalidation), invalidation);
  assert.deepEqual(
    deriveReviewedArticleReadiness({ currentSourceFingerprint: source, checkpoint, invalidation }),
    { state: 'REVIEW_REQUIRED', reason: 'DURABLE_INVALIDATION', invalidation }
  );
});

test('readiness invalidation refuses chat/session/model identifiers as durable references', () => {
  for (const reference of ['chat:123', 'session:abc', 'model:gpt']) {
    assert.throws(
      () => createArticleReadinessInvalidation({
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
      reason: 'EXTERNAL_EVIDENCE_CHANGED',
      origin: 'rta',
      reference: null
    }),
    /unsupported Article readiness invalidation version/
  );
});
