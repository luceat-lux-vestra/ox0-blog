export const ARTICLE_READINESS_INVALIDATION_VERSION = 1;

const REASONS = new Set([
  'EXTERNAL_EVIDENCE_CHANGED',
  'PROVENANCE_WEAKENED',
  'SEMANTIC_REVIEW_REQUESTED'
]);
const ORIGINS = new Set(['rta', 'blog-audit', 'user', 'external']);

function optionalReference(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Article readiness invalidation reference must be a non-empty string or null');
  }
  const reference = value.trim();
  if (/^(?:chat|session|model):/i.test(reference)) {
    throw new Error('Article readiness invalidation must not persist chat/session/model identifiers');
  }
  return reference;
}

export function createArticleReadinessInvalidation({ reason, origin, reference = null }) {
  if (!REASONS.has(reason)) {
    throw new Error(`unsupported Article readiness invalidation reason: ${reason}`);
  }
  if (!ORIGINS.has(origin)) {
    throw new Error(`unsupported Article readiness invalidation origin: ${origin}`);
  }
  return {
    version: ARTICLE_READINESS_INVALIDATION_VERSION,
    reason,
    origin,
    reference: optionalReference(reference)
  };
}

export function validateArticleReadinessInvalidation(invalidation) {
  if (!invalidation || typeof invalidation !== 'object' || Array.isArray(invalidation)) {
    throw new Error('Article readiness invalidation must be an object');
  }
  if (invalidation.version !== ARTICLE_READINESS_INVALIDATION_VERSION) {
    throw new Error(`unsupported Article readiness invalidation version: ${invalidation.version}`);
  }
  return createArticleReadinessInvalidation({
    reason: invalidation.reason,
    origin: invalidation.origin,
    reference: invalidation.reference ?? null
  });
}
