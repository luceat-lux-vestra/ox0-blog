import test from 'node:test';
import assert from 'node:assert/strict';
import { articleSemanticSourceFingerprintV1 } from '../src/article-readiness-source.mjs';
import {
  ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
  createArticleReadinessCheckpoint,
  deriveReviewedArticleReadiness,
  validateArticleReadinessCheckpoint
} from '../src/article-readiness.mjs';

const KO = `sha256:${'a'.repeat(64)}`;
const EN = `sha256:${'b'.repeat(64)}`;
const EVIDENCE_A = `sha256:${'c'.repeat(64)}`;
const EVIDENCE_B = `sha256:${'d'.repeat(64)}`;

function sourceFingerprint(overrides = {}) {
  return articleSemanticSourceFingerprintV1({
    requiredLocales: overrides.requiredLocales ?? ['ko-KR', 'en'],
    translationFingerprints: overrides.translationFingerprints ?? {
      'ko-KR': KO,
      en: EN
    }
  });
}

function passReview(source, evidence = null, overrides = {}) {
  return {
    result: 'PASS',
    kind: overrides.kind ?? 'agent',
    contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
    reviewedSourceFingerprint: source,
    reviewedEvidenceFingerprint: evidence
  };
}

test('Article semantic source fingerprint is independent from required locale ordering', () => {
  const first = sourceFingerprint({ requiredLocales: ['ko-KR', 'en'] });
  const second = sourceFingerprint({ requiredLocales: ['en', 'ko-KR'] });
  assert.equal(second, first);
});

test('Article semantic source fingerprint changes when any translation-relevant locale fingerprint changes', () => {
  const first = sourceFingerprint();
  const second = sourceFingerprint({
    translationFingerprints: {
      'ko-KR': `sha256:${'e'.repeat(64)}`,
      en: EN
    }
  });
  assert.notEqual(second, first);
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

test('READY is recoverable only when source and evidence exactly match reviewed checkpoint', () => {
  const source = sourceFingerprint();
  const checkpoint = createArticleReadinessCheckpoint({
    sourceFingerprint: source,
    evidenceFingerprint: EVIDENCE_A,
    review: passReview(source, EVIDENCE_A)
  });

  assert.deepEqual(validateArticleReadinessCheckpoint(checkpoint), checkpoint);
  assert.deepEqual(
    deriveReviewedArticleReadiness({
      currentSourceFingerprint: source,
      currentEvidenceFingerprint: EVIDENCE_A,
      checkpoint
    }),
    { state: 'READY' }
  );
});

test('source change invalidates READY without mutating translation or Ghost state', () => {
  const source = sourceFingerprint();
  const changedSource = sourceFingerprint({
    translationFingerprints: {
      'ko-KR': KO,
      en: `sha256:${'f'.repeat(64)}`
    }
  });
  const checkpoint = createArticleReadinessCheckpoint({
    sourceFingerprint: source,
    review: passReview(source)
  });

  assert.deepEqual(
    deriveReviewedArticleReadiness({
      currentSourceFingerprint: changedSource,
      checkpoint
    }),
    { state: 'REVIEW_REQUIRED', reason: 'SOURCE_CHANGED' }
  );
});

test('evidence change invalidates READY even when Article source is unchanged', () => {
  const source = sourceFingerprint();
  const checkpoint = createArticleReadinessCheckpoint({
    sourceFingerprint: source,
    evidenceFingerprint: EVIDENCE_A,
    review: passReview(source, EVIDENCE_A)
  });

  assert.deepEqual(
    deriveReviewedArticleReadiness({
      currentSourceFingerprint: source,
      currentEvidenceFingerprint: EVIDENCE_B,
      checkpoint
    }),
    { state: 'REVIEW_REQUIRED', reason: 'EVIDENCE_CHANGED' }
  );
});

test('external review signal invalidates READY without requiring a source fingerprint change', () => {
  const source = sourceFingerprint();
  const checkpoint = createArticleReadinessCheckpoint({
    sourceFingerprint: source,
    evidenceFingerprint: EVIDENCE_A,
    review: passReview(source, EVIDENCE_A)
  });

  assert.deepEqual(
    deriveReviewedArticleReadiness({
      currentSourceFingerprint: source,
      currentEvidenceFingerprint: EVIDENCE_A,
      checkpoint,
      reviewRequiredSignal: true
    }),
    { state: 'REVIEW_REQUIRED', reason: 'EXTERNAL_REVIEW_SIGNAL' }
  );
});

test('no readiness checkpoint never infers READY', () => {
  assert.deepEqual(
    deriveReviewedArticleReadiness({ currentSourceFingerprint: sourceFingerprint() }),
    { state: 'REVIEW_REQUIRED', reason: 'NO_READINESS_CHECKPOINT' }
  );
});

test('checkpoint creation requires PASS over the exact source and evidence fingerprints', () => {
  const source = sourceFingerprint();
  assert.throws(
    () => createArticleReadinessCheckpoint({
      sourceFingerprint: source,
      evidenceFingerprint: EVIDENCE_A,
      review: {
        ...passReview(source, EVIDENCE_A),
        result: 'UNCERTAIN'
      }
    }),
    /requires review result PASS/
  );

  assert.throws(
    () => createArticleReadinessCheckpoint({
      sourceFingerprint: source,
      evidenceFingerprint: EVIDENCE_A,
      review: passReview(source, EVIDENCE_B)
    }),
    /exact current evidence fingerprint/
  );
});

test('unsupported readiness contract versions fail closed', () => {
  const source = sourceFingerprint();
  assert.throws(
    () => createArticleReadinessCheckpoint({
      sourceFingerprint: source,
      review: {
        ...passReview(source),
        contractVersion: 999
      }
    }),
    /unsupported Article readiness review contract version/
  );
});
