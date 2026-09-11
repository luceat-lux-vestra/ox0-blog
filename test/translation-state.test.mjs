import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTranslationState, mayAdvanceTranslationCheckpoint } from '../src/translation-state.mjs';

const REQUIRED = ['ko-KR', 'en'];
const ACCEPTED = { 'ko-KR': 'sha256:ko-a', en: 'sha256:en-a' };

function state(currentFingerprints, acceptedFingerprints = ACCEPTED) {
  return deriveTranslationState({
    requiredLocales: REQUIRED,
    currentFingerprints,
    acceptedFingerprints
  });
}

test('missing required locale takes precedence over checkpoint state', () => {
  assert.deepEqual(
    state({ 'ko-KR': 'sha256:ko-a' }),
    { state: 'INCOMPLETE', missingLocales: ['en'] }
  );
});

test('complete variants with no accepted checkpoint remain UNREVIEWED', () => {
  assert.deepEqual(
    state({ 'ko-KR': 'sha256:ko-a', en: 'sha256:en-a' }, null),
    { state: 'UNREVIEWED' }
  );
});

test('exact checkpoint match is SYNCED', () => {
  assert.deepEqual(state(ACCEPTED), { state: 'SYNCED' });
});

test('one changed locale derives a set-based STALE state', () => {
  assert.deepEqual(
    state({ 'ko-KR': 'sha256:ko-b', en: 'sha256:en-a' }),
    {
      state: 'STALE',
      changedLocales: ['ko-KR'],
      staleLocales: ['en']
    }
  );
});

test('all required locale fingerprints changed derives REVIEW_REQUIRED', () => {
  assert.deepEqual(
    state({ 'ko-KR': 'sha256:ko-b', en: 'sha256:en-b' }),
    {
      state: 'REVIEW_REQUIRED',
      changedLocales: ['ko-KR', 'en']
    }
  );
});

test('generalized stale sets work for more than two locales', () => {
  assert.deepEqual(
    deriveTranslationState({
      requiredLocales: ['ko-KR', 'en', 'ja'],
      currentFingerprints: { 'ko-KR': 'ko-b', en: 'en-a', ja: 'ja-a' },
      acceptedFingerprints: { 'ko-KR': 'ko-a', en: 'en-a', ja: 'ja-a' }
    }),
    {
      state: 'STALE',
      changedLocales: ['ko-KR'],
      staleLocales: ['en', 'ja']
    }
  );
});

test('malformed accepted checkpoint fails closed instead of becoming synchronized', () => {
  assert.throws(
    () => deriveTranslationState({
      requiredLocales: REQUIRED,
      currentFingerprints: ACCEPTED,
      acceptedFingerprints: { 'ko-KR': 'sha256:ko-a' }
    }),
    /malformed/
  );
});

test('checkpoint advancement requires PASS for the exact current fingerprints', () => {
  const current = { 'ko-KR': 'sha256:ko-b', en: 'sha256:en-b' };

  assert.equal(mayAdvanceTranslationCheckpoint({
    requiredLocales: REQUIRED,
    currentFingerprints: current,
    review: {
      result: 'PASS',
      reviewedFingerprints: current
    }
  }), true);

  assert.equal(mayAdvanceTranslationCheckpoint({
    requiredLocales: REQUIRED,
    currentFingerprints: current,
    review: {
      result: 'PASS',
      reviewedFingerprints: { 'ko-KR': 'sha256:ko-b', en: 'sha256:en-a' }
    }
  }), false);

  assert.equal(mayAdvanceTranslationCheckpoint({
    requiredLocales: REQUIRED,
    currentFingerprints: current,
    review: {
      result: 'UNCERTAIN',
      reviewedFingerprints: current
    }
  }), false);
});

test('unexpected locales fail closed instead of being ignored', () => {
  assert.throws(
    () => deriveTranslationState({
      requiredLocales: REQUIRED,
      currentFingerprints: { ...ACCEPTED, ja: 'sha256:ja' },
      acceptedFingerprints: ACCEPTED
    }),
    /unexpected locale/
  );
});
