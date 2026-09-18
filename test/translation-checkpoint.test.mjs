import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSLATION_CHECKPOINT_VERSION,
  TRANSLATION_REVIEW_CONTRACT_VERSION,
  acceptedFingerprintsFromCheckpoint,
  createTranslationCheckpoint,
  validateTranslationCheckpoint
} from '../src/translation-checkpoint.mjs';
import { TRANSLATION_FINGERPRINT_VERSION } from '../src/translation-fingerprint.mjs';

const REQUIRED = ['ko-KR', 'en'];
const CURRENT = {
  'ko-KR': `sha256:${'a'.repeat(64)}`,
  en: `sha256:${'b'.repeat(64)}`
};

function passingReview(overrides = {}) {
  return {
    result: 'PASS',
    kind: 'agent',
    contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION,
    reviewedFingerprints: CURRENT,
    ...overrides
  };
}

test('checkpoint creation persists only versioned accepted fingerprints and stable review provenance', () => {
  const checkpoint = createTranslationCheckpoint({
    requiredLocales: REQUIRED,
    currentFingerprints: CURRENT,
    review: passingReview({ model: 'must-not-persist', sessionId: 'must-not-persist' })
  });

  assert.deepEqual(checkpoint, {
    version: TRANSLATION_CHECKPOINT_VERSION,
    fingerprintVersion: TRANSLATION_FINGERPRINT_VERSION,
    accepted: CURRENT,
    review: {
      kind: 'agent',
      contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION
    }
  });
});

test('human review provenance is supported without changing checkpoint semantics', () => {
  const checkpoint = createTranslationCheckpoint({
    requiredLocales: REQUIRED,
    currentFingerprints: CURRENT,
    review: passingReview({ kind: 'human' })
  });
  assert.equal(checkpoint.review.kind, 'human');
});

test('review must PASS and cover exact current fingerprints', () => {
  assert.throws(
    () => createTranslationCheckpoint({
      requiredLocales: REQUIRED,
      currentFingerprints: CURRENT,
      review: passingReview({ result: 'UNCERTAIN' })
    }),
    /requires review result PASS/
  );

  assert.throws(
    () => createTranslationCheckpoint({
      requiredLocales: REQUIRED,
      currentFingerprints: CURRENT,
      review: passingReview({ reviewedFingerprints: { ...CURRENT, en: `sha256:${'c'.repeat(64)}` } })
    }),
    /does not cover the exact current fingerprints/
  );
});

test('checkpoint recovery rejects missing or unexpected locales', () => {
  const checkpoint = createTranslationCheckpoint({
    requiredLocales: REQUIRED,
    currentFingerprints: CURRENT,
    review: passingReview()
  });

  assert.throws(
    () => validateTranslationCheckpoint({
      ...checkpoint,
      accepted: { 'ko-KR': CURRENT['ko-KR'] }
    }, { requiredLocales: REQUIRED }),
    /missing required locales/
  );

  assert.throws(
    () => validateTranslationCheckpoint({
      ...checkpoint,
      accepted: { ...CURRENT, ja: `sha256:${'d'.repeat(64)}` }
    }, { requiredLocales: REQUIRED }),
    /unexpected locale/
  );
});

test('unsupported checkpoint, fingerprint, and review contract versions fail closed', () => {
  const checkpoint = createTranslationCheckpoint({
    requiredLocales: REQUIRED,
    currentFingerprints: CURRENT,
    review: passingReview()
  });

  assert.throws(
    () => validateTranslationCheckpoint({ ...checkpoint, version: 999 }, { requiredLocales: REQUIRED }),
    /unsupported translation checkpoint version/
  );
  assert.throws(
    () => validateTranslationCheckpoint({ ...checkpoint, fingerprintVersion: 999 }, { requiredLocales: REQUIRED }),
    /unsupported translation fingerprint version/
  );
  assert.throws(
    () => validateTranslationCheckpoint({
      ...checkpoint,
      review: { ...checkpoint.review, contractVersion: 999 }
    }, { requiredLocales: REQUIRED }),
    /unsupported translation review contract version/
  );
});

test('accepted fingerprint extraction always validates the durable checkpoint first', () => {
  const checkpoint = createTranslationCheckpoint({
    requiredLocales: REQUIRED,
    currentFingerprints: CURRENT,
    review: passingReview()
  });
  assert.deepEqual(
    acceptedFingerprintsFromCheckpoint(checkpoint, { requiredLocales: REQUIRED }),
    CURRENT
  );
});
