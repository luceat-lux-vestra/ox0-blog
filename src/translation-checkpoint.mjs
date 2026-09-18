import { requireLocaleToken } from './locale.mjs';
import { TRANSLATION_FINGERPRINT_VERSION } from './translation-fingerprint.mjs';
import { mayAdvanceTranslationCheckpoint } from './translation-state.mjs';

export const TRANSLATION_CHECKPOINT_VERSION = 1;
export const TRANSLATION_REVIEW_CONTRACT_VERSION = 1;

const REVIEW_KINDS = new Set(['agent', 'human']);

function requireLocales(requiredLocales) {
  if (!Array.isArray(requiredLocales) || requiredLocales.length === 0) {
    throw new Error('requiredLocales must be a non-empty array');
  }
  const normalized = requiredLocales.map((locale) => requireLocaleToken(locale, 'required locale'));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('requiredLocales must not contain duplicates');
  }
  return normalized;
}

function toMap(value, name) {
  if (value instanceof Map) return new Map(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be a Map or object`);
  }
  return new Map(Object.entries(value));
}

function requireFingerprint(value, name) {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be sha256:<64 lowercase hex>`);
  }
  return value;
}

function normalizeExactFingerprints(value, requiredLocales, name) {
  const map = toMap(value, name);
  const required = new Set(requiredLocales);
  for (const [locale, fingerprint] of map) {
    if (!required.has(locale)) throw new Error(`${name} contains unexpected locale: ${locale}`);
    requireFingerprint(fingerprint, `${name}.${locale}`);
  }
  const missing = requiredLocales.filter((locale) => !map.has(locale));
  if (missing.length > 0) throw new Error(`${name} is missing required locales: ${missing.join(', ')}`);
  return Object.fromEntries(requiredLocales.map((locale) => [locale, map.get(locale)]));
}

function normalizeReview(review, { requirePass = false } = {}) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    throw new Error('translation review evidence is required');
  }
  if (requirePass && review.result !== 'PASS') {
    throw new Error('translation checkpoint requires review result PASS');
  }
  if (!REVIEW_KINDS.has(review.kind)) {
    throw new Error('translation review kind must be agent or human');
  }
  if (review.contractVersion !== TRANSLATION_REVIEW_CONTRACT_VERSION) {
    throw new Error(`unsupported translation review contract version: ${review.contractVersion}`);
  }
  return {
    kind: review.kind,
    contractVersion: review.contractVersion
  };
}

export function createTranslationCheckpoint({ requiredLocales, currentFingerprints, review }) {
  const required = requireLocales(requiredLocales);
  const current = normalizeExactFingerprints(currentFingerprints, required, 'currentFingerprints');
  const normalizedReview = normalizeReview(review, { requirePass: true });

  if (!mayAdvanceTranslationCheckpoint({
    requiredLocales: required,
    currentFingerprints: current,
    review
  })) {
    throw new Error('translation review does not cover the exact current fingerprints');
  }

  return {
    version: TRANSLATION_CHECKPOINT_VERSION,
    fingerprintVersion: TRANSLATION_FINGERPRINT_VERSION,
    accepted: current,
    review: normalizedReview
  };
}

export function validateTranslationCheckpoint(checkpoint, { requiredLocales }) {
  const required = requireLocales(requiredLocales);
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    throw new Error('translation checkpoint must be an object');
  }
  if (checkpoint.version !== TRANSLATION_CHECKPOINT_VERSION) {
    throw new Error(`unsupported translation checkpoint version: ${checkpoint.version}`);
  }
  if (checkpoint.fingerprintVersion !== TRANSLATION_FINGERPRINT_VERSION) {
    throw new Error(`unsupported translation fingerprint version: ${checkpoint.fingerprintVersion}`);
  }
  const accepted = normalizeExactFingerprints(checkpoint.accepted, required, 'translation checkpoint accepted');
  const review = normalizeReview(checkpoint.review);
  return {
    version: checkpoint.version,
    fingerprintVersion: checkpoint.fingerprintVersion,
    accepted,
    review
  };
}

export function acceptedFingerprintsFromCheckpoint(checkpoint, options) {
  return validateTranslationCheckpoint(checkpoint, options).accepted;
}
