import { validateArticleReadinessInvalidation } from './article-readiness-invalidation.mjs';
import { ARTICLE_SOURCE_FINGERPRINT_VERSION } from './article-readiness-source.mjs';

export const ARTICLE_READINESS_CHECKPOINT_VERSION = 1;
export const ARTICLE_READINESS_REVIEW_CONTRACT_VERSION = 1;

const REVIEW_KINDS = new Set(['agent', 'human']);

function requireFingerprint(value, name) {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be sha256:<64 lowercase hex>`);
  }
  return value;
}

function normalizeReview(review, { requirePass = false } = {}) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    throw new Error('Article readiness review evidence is required');
  }
  if (requirePass && review.result !== 'PASS') {
    throw new Error('Article readiness checkpoint requires review result PASS');
  }
  if (!REVIEW_KINDS.has(review.kind)) {
    throw new Error('Article readiness review kind must be agent or human');
  }
  if (review.contractVersion !== ARTICLE_READINESS_REVIEW_CONTRACT_VERSION) {
    throw new Error(`unsupported Article readiness review contract version: ${review.contractVersion}`);
  }
  return {
    kind: review.kind,
    contractVersion: review.contractVersion
  };
}

export function createArticleReadinessCheckpoint({ sourceFingerprint, review }) {
  const source = requireFingerprint(sourceFingerprint, 'sourceFingerprint');
  const normalizedReview = normalizeReview(review, { requirePass: true });
  const reviewedSource = requireFingerprint(review.reviewedSourceFingerprint, 'review.reviewedSourceFingerprint');

  if (reviewedSource !== source) {
    throw new Error('Article readiness review does not cover the exact current source fingerprint');
  }

  return {
    version: ARTICLE_READINESS_CHECKPOINT_VERSION,
    sourceFingerprintVersion: ARTICLE_SOURCE_FINGERPRINT_VERSION,
    sourceFingerprint: source,
    review: normalizedReview
  };
}

export function validateArticleReadinessCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    throw new Error('Article readiness checkpoint must be an object');
  }
  if (checkpoint.version !== ARTICLE_READINESS_CHECKPOINT_VERSION) {
    throw new Error(`unsupported Article readiness checkpoint version: ${checkpoint.version}`);
  }
  if (checkpoint.sourceFingerprintVersion !== ARTICLE_SOURCE_FINGERPRINT_VERSION) {
    throw new Error(`unsupported Article source fingerprint version: ${checkpoint.sourceFingerprintVersion}`);
  }
  const sourceFingerprint = requireFingerprint(checkpoint.sourceFingerprint, 'Article readiness checkpoint sourceFingerprint');
  const review = normalizeReview(checkpoint.review);
  return {
    version: checkpoint.version,
    sourceFingerprintVersion: checkpoint.sourceFingerprintVersion,
    sourceFingerprint,
    review
  };
}

export function deriveReviewedArticleReadiness({
  currentSourceFingerprint,
  checkpoint = null,
  invalidation = null
}) {
  const source = requireFingerprint(currentSourceFingerprint, 'currentSourceFingerprint');

  if (checkpoint == null) {
    return { state: 'REVIEW_REQUIRED', reason: 'NO_READINESS_CHECKPOINT' };
  }
  const accepted = validateArticleReadinessCheckpoint(checkpoint);
  if (invalidation != null) {
    const durable = validateArticleReadinessInvalidation(invalidation);
    return {
      state: 'REVIEW_REQUIRED',
      reason: 'DURABLE_INVALIDATION',
      invalidation: durable
    };
  }
  if (accepted.sourceFingerprint !== source) {
    return { state: 'REVIEW_REQUIRED', reason: 'SOURCE_CHANGED' };
  }
  return { state: 'READY' };
}
