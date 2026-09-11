import {
  isArticleReadinessInvalidationId,
  validateArticleReadinessInvalidation
} from './article-readiness-invalidation.mjs';
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

function requireEpoch(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function normalizeInvalidationIds(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  const ids = value.map((id) => {
    if (!isArticleReadinessInvalidationId(id)) {
      throw new Error(`${name} must contain lowercase UUID v4 values`);
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${name} must not contain duplicates`);
  }
  return ids;
}

function sameOrderedValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

export function createArticleReadinessCheckpoint({
  sourceFingerprint,
  review,
  reviewedEpoch = 0,
  resolvedInvalidationIds = []
}) {
  const source = requireFingerprint(sourceFingerprint, 'sourceFingerprint');
  const normalizedReview = normalizeReview(review, { requirePass: true });
  const reviewedSource = requireFingerprint(review.reviewedSourceFingerprint, 'review.reviewedSourceFingerprint');
  const epoch = requireEpoch(reviewedEpoch, 'reviewedEpoch');
  const resolvedIds = normalizeInvalidationIds(resolvedInvalidationIds, 'resolvedInvalidationIds');
  const reviewedInvalidationIds = normalizeInvalidationIds(
    review.reviewedInvalidationIds,
    'review.reviewedInvalidationIds'
  );

  if (reviewedSource !== source) {
    throw new Error('Article readiness review does not cover the exact current source fingerprint');
  }
  if (!sameOrderedValues(reviewedInvalidationIds, resolvedIds)) {
    throw new Error('Article readiness review does not cover the exact resolved invalidation id set');
  }

  return {
    version: ARTICLE_READINESS_CHECKPOINT_VERSION,
    sourceFingerprintVersion: ARTICLE_SOURCE_FINGERPRINT_VERSION,
    sourceFingerprint: source,
    reviewedEpoch: epoch,
    resolvedInvalidationIds: resolvedIds,
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
  const reviewedEpoch = requireEpoch(checkpoint.reviewedEpoch, 'Article readiness checkpoint reviewedEpoch');
  const resolvedInvalidationIds = normalizeInvalidationIds(
    checkpoint.resolvedInvalidationIds,
    'Article readiness checkpoint resolvedInvalidationIds'
  );
  const review = normalizeReview(checkpoint.review);
  return {
    version: checkpoint.version,
    sourceFingerprintVersion: checkpoint.sourceFingerprintVersion,
    sourceFingerprint,
    reviewedEpoch,
    resolvedInvalidationIds,
    review
  };
}

export function resolveArticleReadinessInvalidations({
  currentSourceFingerprint,
  currentEpoch,
  invalidations,
  review
}) {
  const epoch = requireEpoch(currentEpoch, 'currentEpoch');
  if (!Array.isArray(invalidations) || invalidations.length === 0) {
    throw new Error('at least one Article readiness invalidation is required to resolve');
  }
  const durableInvalidations = invalidations.map(validateArticleReadinessInvalidation);
  if (durableInvalidations.some((entry) => entry.epoch > epoch)) {
    throw new Error('Article readiness invalidation epoch cannot exceed current readiness epoch');
  }
  const ids = durableInvalidations.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Article readiness invalidations must not contain duplicate ids');
  }

  const checkpoint = createArticleReadinessCheckpoint({
    sourceFingerprint: currentSourceFingerprint,
    review,
    reviewedEpoch: epoch,
    resolvedInvalidationIds: ids
  });
  return {
    checkpoint,
    invalidations: [],
    resolvedInvalidationIds: ids
  };
}

export function deriveReviewedArticleReadiness({
  currentSourceFingerprint,
  currentEpoch = 0,
  checkpoint = null,
  invalidations = []
}) {
  const source = requireFingerprint(currentSourceFingerprint, 'currentSourceFingerprint');
  const epoch = requireEpoch(currentEpoch, 'currentEpoch');
  if (!Array.isArray(invalidations)) throw new Error('invalidations must be an array');
  const active = invalidations.map(validateArticleReadinessInvalidation);

  if (checkpoint == null) {
    if (epoch === 0 && active.length === 0) return { state: 'DRAFT' };
    return {
      state: 'REVIEW_REQUIRED',
      reason: 'NO_READINESS_CHECKPOINT',
      ...(active.length > 0 ? { invalidations: active } : {}),
      currentEpoch: epoch
    };
  }
  const accepted = validateArticleReadinessCheckpoint(checkpoint);
  if (accepted.sourceFingerprint !== source) {
    return { state: 'REVIEW_REQUIRED', reason: 'SOURCE_CHANGED' };
  }
  if (active.length > 0) {
    return {
      state: 'REVIEW_REQUIRED',
      reason: 'DURABLE_INVALIDATION',
      invalidations: active
    };
  }
  if (accepted.reviewedEpoch !== epoch) {
    return {
      state: 'REVIEW_REQUIRED',
      reason: 'UNREVIEWED_INVALIDATION_EPOCH',
      reviewedEpoch: accepted.reviewedEpoch,
      currentEpoch: epoch
    };
  }
  return { state: 'READY' };
}
