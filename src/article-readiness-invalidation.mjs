import { randomUUID } from 'node:crypto';

export const ARTICLE_READINESS_INVALIDATION_VERSION = 1;

const REASONS = new Set([
  'EXTERNAL_EVIDENCE_CHANGED',
  'PROVENANCE_WEAKENED',
  'SEMANTIC_REVIEW_REQUESTED'
]);
const ORIGINS = new Set(['rta', 'blog-audit', 'user', 'external']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requireInvalidationId(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new Error('Article readiness invalidation id must be a lowercase UUID v4');
  }
  return value;
}

function requireEpoch(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Article readiness invalidation epoch must be a positive safe integer');
  }
  return value;
}

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

function normalizeArticleReadinessInvalidation({ id, epoch, reason, origin, reference = null }) {
  if (!REASONS.has(reason)) {
    throw new Error(`unsupported Article readiness invalidation reason: ${reason}`);
  }
  if (!ORIGINS.has(origin)) {
    throw new Error(`unsupported Article readiness invalidation origin: ${origin}`);
  }
  return {
    version: ARTICLE_READINESS_INVALIDATION_VERSION,
    id: requireInvalidationId(id),
    epoch: requireEpoch(epoch),
    reason,
    origin,
    reference: optionalReference(reference)
  };
}

export function createArticleReadinessInvalidation({
  id = randomUUID(),
  epoch,
  reason,
  origin,
  reference = null
}) {
  return normalizeArticleReadinessInvalidation({ id, epoch, reason, origin, reference });
}

export function validateArticleReadinessInvalidation(invalidation) {
  if (!invalidation || typeof invalidation !== 'object' || Array.isArray(invalidation)) {
    throw new Error('Article readiness invalidation must be an object');
  }
  if (invalidation.version !== ARTICLE_READINESS_INVALIDATION_VERSION) {
    throw new Error(`unsupported Article readiness invalidation version: ${invalidation.version}`);
  }
  return normalizeArticleReadinessInvalidation({
    id: invalidation.id,
    epoch: invalidation.epoch,
    reason: invalidation.reason,
    origin: invalidation.origin,
    reference: invalidation.reference ?? null
  });
}

export function isArticleReadinessInvalidationId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}
