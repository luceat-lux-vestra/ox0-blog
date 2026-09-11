import { ARTICLE_SOURCE_FINGERPRINT_VERSION } from './article-readiness-source.mjs';

export const ARTICLE_READINESS_CHECKPOINT_VERSION = 1;
export const ARTICLE_READINESS_REVIEW_CONTRACT_VERSION = 1;

const REVIEW_KINDS = new Set(['agent', 'human']);

function requireFingerprint(value, name, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be sha256:<64 lowercase hex>${nullable ? ' or null' : ''}`);
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

export function createArticleReadinessCheckpoint({
  sourceFingerprint,
  evidenceFingerprint = null,
  review
}) {
  const source = requireFingerprint(sourceFingerprint, 'sourceFingerprint');
  const evidence = requireFingerprint(evidenceFingerprint, 'evidenceFingerprint', { nullable: true });
  const normalizedReview = normalizeReview(review, { requirePass: true });
  const reviewedSource = requireFingerprint(review.reviewedSourceFingerprint, 'review.reviewedSourceFingerprint');
  const reviewedEvidence = requireFingerprint(
    review.reviewedEvidenceFingerprint ?? null,
    'review.reviewedEvidenceFingerprint',
    { nullable: true }
  );

  if (reviewedSource !== source) {
    throw new Error('Article readiness review does not cover the exact current source fingerprint');
  }
  if (reviewedEvidence !== evidence) {
    throw new Error('Article readiness review does not cover the exact current evidence fingerprint');
  }

  return {
    version: ARTICLE_READINESS_CHECKPOINT_VERSION,
    sourceFingerprintVersion: ARTICLE_SOURCE_FINGERPRINT_VERSION,
    sourceFingerprint: source,
    evidenceFingerprint: evidence,
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
  const evidenceFingerprint = requireFingerprint(
    checkpoint.evidenceFingerprint ?? null,
    'Article readiness checkpoint evidenceFingerprint',
    { nullable: true }
  );
  const review = normalizeReview(checkpoint.review);
  return {
    version: checkpoint.version,
    sourceFingerprintVersion: checkpoint.sourceFingerprintVersion,
    sourceFingerprint,
    evidenceFingerprint,
    review
  };
}

export function deriveReviewedArticleReadiness({
  currentSourceFingerprint,
  currentEvidenceFingerprint = null,
  checkpoint = null,
  reviewRequiredSignal = false
}) {
  const source = requireFingerprint(currentSourceFingerprint, 'currentSourceFingerprint');
  const evidence = requireFingerprint(currentEvidenceFingerprint, 'currentEvidenceFingerprint', { nullable: true });
  if (typeof reviewRequiredSignal !== 'boolean') {
    throw new Error('reviewRequiredSignal must be boolean');
  }

  if (checkpoint == null) {
    return { state: 'REVIEW_REQUIRED', reason: 'NO_READINESS_CHECKPOINT' };
  }
  const accepted = validateArticleReadinessCheckpoint(checkpoint);
  if (reviewRequiredSignal) {
    return { state: 'REVIEW_REQUIRED', reason: 'EXTERNAL_REVIEW_SIGNAL' };
  }
  if (accepted.sourceFingerprint !== source) {
    return { state: 'REVIEW_REQUIRED', reason: 'SOURCE_CHANGED' };
  }
  if (accepted.evidenceFingerprint !== evidence) {
    return { state: 'REVIEW_REQUIRED', reason: 'EVIDENCE_CHANGED' };
  }
  return { state: 'READY' };
}
