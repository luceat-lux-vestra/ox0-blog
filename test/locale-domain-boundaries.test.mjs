import test from 'node:test';
import assert from 'node:assert/strict';
import { articleSemanticSourceFingerprintV1 } from '../src/article-readiness-source.mjs';
import { createTranslationCheckpoint } from '../src/translation-checkpoint.mjs';
import { deriveTranslationState } from '../src/translation-state.mjs';

test('translation/readiness domain APIs reject noncanonical locale aliases independently of Article normalization', () => {
  const requiredLocales = ['EN-us'];

  assert.throws(
    () => deriveTranslationState({ requiredLocales, currentFingerprints: {} }),
    /canonical BCP47 form: en-US/
  );

  assert.throws(
    () => articleSemanticSourceFingerprintV1({ requiredLocales, translationFingerprints: {} }),
    /canonical BCP47 form: en-US/
  );

  assert.throws(
    () => createTranslationCheckpoint({
      requiredLocales,
      currentFingerprints: {},
      review: { result: 'PASS' }
    }),
    /canonical BCP47 form: en-US/
  );
});
