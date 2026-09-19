import path from 'node:path';
import { ARTICLE_PUBLICATION_AUTHORIZATION_VERSION } from './article-publication.mjs';

const SHA_RE = /^[a-f0-9]{40}$/;
const SOURCE_FINGERPRINT_RE = /^sha256:[a-f0-9]{64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const OPERATIONS = new Set(['plan-draft', 'plan-publish', 'draft', 'publish']);

export const PRODUCTION_PUBLISH_MODE = Object.freeze({
  DRAFT_PROMOTION: 'draft-promotion',
  PUBLISHED_REVISION: 'published-revision'
});

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeManifestRef(value) {
  const ref = requireString(value, 'workflow manifest path');
  if (ref.includes('\\')) throw new Error('workflow manifest path must use forward slashes');
  if (path.posix.isAbsolute(ref) || path.win32.isAbsolute(ref)) {
    throw new Error('workflow manifest path must be repository-relative');
  }
  const normalized = path.posix.normalize(ref);
  if (
    normalized !== ref
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.startsWith('./')
    || !normalized.startsWith('posts/')
    || path.posix.basename(normalized) !== 'article.json'
  ) {
    throw new Error('workflow manifest path must identify posts/.../article.json without traversal or aliases');
  }
  return normalized;
}

function normalizeOperation(value) {
  const operation = requireString(value, 'workflow operation');
  if (!OPERATIONS.has(operation)) {
    throw new Error('workflow operation must be plan-draft, plan-publish, draft, or publish');
  }
  return operation;
}

function actionForOperation(operation) {
  return operation === 'plan-publish' || operation === 'publish' ? 'publish' : 'draft';
}

function requirePublishPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('publication plan is required');
  }
  if (plan.action !== 'publish') {
    throw new Error('workflow dispatch production checks require a publish plan');
  }
  if (!Array.isArray(plan.variants) || plan.variants.length === 0) {
    throw new Error('publication plan must contain required LocaleVariant plans');
  }
  const locales = new Set();
  for (const variant of plan.variants) {
    const locale = requireString(variant?.locale, 'publication plan locale');
    if (locales.has(locale)) throw new Error(`publication plan contains duplicate locale: ${locale}`);
    locales.add(locale);
  }
  return plan;
}

function requireSourceFingerprint(variant, locale) {
  const sourceFingerprint = variant?.sourceFingerprint;
  if (!SOURCE_FINGERPRINT_RE.test(sourceFingerprint ?? '')) {
    throw new Error(`publication plan source fingerprint is invalid for locale: ${locale}`);
  }
  return sourceFingerprint;
}

function requireGhostPlan(variant, locale) {
  const ghost = variant?.ghost;
  if (!ghost || typeof ghost !== 'object' || Array.isArray(ghost)) {
    throw new Error(`production workflow requires Ghost plan evidence for locale: ${locale}`);
  }
  if (typeof ghost.existingPostId !== 'string' || ghost.existingPostId === '') {
    throw new Error(`production workflow requires an existing managed Ghost post for locale: ${locale}`);
  }
  if (ghost.desiredStatus !== 'published') {
    throw new Error(`production workflow requires desired Ghost status=published for locale: ${locale}`);
  }
  if (!SOURCE_FINGERPRINT_RE.test(ghost.projectedSourceFingerprint ?? '')) {
    throw new Error(`production workflow requires canonical projected source fingerprint for locale: ${locale}`);
  }
  const observed = ghost.observed;
  if (
    !observed
    || observed.postId !== ghost.existingPostId
    || observed.status !== ghost.currentStatus
    || observed.projectedSourceFingerprint !== ghost.projectedSourceFingerprint
    || typeof observed.updatedAt !== 'string'
    || observed.updatedAt === ''
    || !HASH_RE.test(observed.syncHash ?? '')
  ) {
    throw new Error(`production workflow requires exact bound managed-post observation for locale: ${locale}`);
  }
  return ghost;
}

function requireReuseOnlyAssets(variant, locale) {
  for (const assetPlan of variant?.assetPlans ?? []) {
    if (!assetPlan || assetPlan.action !== 'reuse') {
      throw new Error(`draft-promotion workflow requires every local body asset to be pre-staged/reuse-only for locale: ${locale}`);
    }
  }
}

function requireNonMutatingFeatureImagePlan(ghost, locale) {
  const action = ghost.featureImage?.action ?? 'none';
  if (!['none', 'preserve'].includes(action)) {
    throw new Error(`draft-promotion workflow must not upload or replace featureImage for locale: ${locale}`);
  }
}

function requirePublishedRevisionAssets(variant, locale) {
  const assetPlans = variant?.assetPlans ?? [];
  if (!Array.isArray(assetPlans)) {
    throw new Error(`published-revision asset plans must be an array for locale: ${locale}`);
  }
  for (const assetPlan of assetPlans) {
    if (!assetPlan || !['publish', 'reuse'].includes(assetPlan.action)) {
      throw new Error(`published-revision workflow permits only publish/reuse local body asset plans for locale: ${locale}`);
    }
  }
}

function requirePublishedRevisionFeatureImagePlan(ghost, locale) {
  const action = ghost.featureImage?.action ?? 'none';
  const allowed = ghost.operation === 'noop'
    ? ['none', 'preserve']
    : ['none', 'reuse', 'upload'];
  if (!allowed.includes(action)) {
    throw new Error(`published-revision featureImage plan is incompatible with ${ghost.operation} for locale: ${locale}`);
  }
}

function requireDraftPromotionVariant(variant) {
  const locale = requireString(variant?.locale, 'publication plan locale');
  const sourceFingerprint = requireSourceFingerprint(variant, locale);
  const ghost = requireGhostPlan(variant, locale);
  requireReuseOnlyAssets(variant, locale);
  requireNonMutatingFeatureImagePlan(ghost, locale);

  if (ghost.currentStatus === 'draft') {
    if (ghost.projectedSourceFingerprint !== sourceFingerprint) {
      throw new Error(`production workflow draft is not exact-current for locale: ${locale}`);
    }
    if (ghost.operation !== 'status-update') {
      throw new Error(`draft-promotion workflow may only promote an exact-current draft for locale: ${locale}`);
    }
    return 'draft';
  }

  // A retry after a partial multi-locale publish may observe an already-promoted
  // sibling. Accept only an exact-current published no-op; never widen the retry
  // into a content rewrite.
  if (ghost.currentStatus === 'published') {
    if (ghost.projectedSourceFingerprint !== sourceFingerprint || ghost.operation !== 'noop') {
      throw new Error(`draft-promotion retry requires exact-current published no-op for locale: ${locale}`);
    }
    return 'published';
  }

  throw new Error(`draft-promotion workflow requires managed draft/published recovery state for locale: ${locale}`);
}

function requirePublishedRevisionVariant(variant) {
  const locale = requireString(variant?.locale, 'publication plan locale');
  const sourceFingerprint = requireSourceFingerprint(variant, locale);
  const ghost = requireGhostPlan(variant, locale);

  if (ghost.currentStatus !== 'published') {
    throw new Error(`published-revision workflow requires current Ghost status=published for locale: ${locale}`);
  }
  if (!['update', 'noop'].includes(ghost.operation)) {
    throw new Error(`published-revision workflow may only update or no-op a managed published post for locale: ${locale}`);
  }
  requirePublishedRevisionAssets(variant, locale);
  requirePublishedRevisionFeatureImagePlan(ghost, locale);
  if (ghost.operation === 'noop' && ghost.projectedSourceFingerprint !== sourceFingerprint) {
    throw new Error(`published-revision no-op is not exact-current for locale: ${locale}`);
  }
  if (ghost.operation === 'update' && ghost.projectedSourceFingerprint === sourceFingerprint) {
    throw new Error(`published-revision update must represent a changed projection for locale: ${locale}`);
  }
  return ghost.operation;
}

export function requireArticleWorkflowDispatchContext({
  actions,
  eventName,
  ref,
  sha,
  expectedSha,
  manifestRef,
  operation,
  publishConfirmation = ''
}) {
  if (actions !== 'true') throw new Error('Article Ghost control surface requires GitHub Actions');
  if (eventName !== 'workflow_dispatch') {
    throw new Error('Article Ghost control surface requires workflow_dispatch');
  }
  if (ref !== 'refs/heads/main') {
    throw new Error('Article Ghost control surface may run only from refs/heads/main');
  }

  const sourceSha = requireString(sha, 'GITHUB_SHA');
  const requestedSha = requireString(expectedSha, 'workflow source_sha');
  if (!SHA_RE.test(sourceSha) || !SHA_RE.test(requestedSha)) {
    throw new Error('Article Ghost control surface requires lowercase 40-hex source SHAs');
  }
  if (sourceSha !== requestedSha) {
    throw new Error('workflow source_sha must equal the exact workflow_dispatch main SHA');
  }

  const normalizedManifestRef = normalizeManifestRef(manifestRef);
  const normalizedOperation = normalizeOperation(operation);
  const confirmation = typeof publishConfirmation === 'string' ? publishConfirmation : '';
  if (normalizedOperation === 'publish') {
    const expected = `publish:${normalizedManifestRef}@${sourceSha}`;
    if (confirmation !== expected) {
      throw new Error(`production workflow confirmation must equal ${expected}`);
    }
  } else if (confirmation !== '') {
    throw new Error('publish confirmation must be empty for non-publish workflow operations');
  }

  return {
    sourceSha,
    manifestRef: normalizedManifestRef,
    operation: normalizedOperation,
    action: actionForOperation(normalizedOperation),
    mutatesGhost: normalizedOperation === 'draft' || normalizedOperation === 'publish',
    productionPublish: normalizedOperation === 'publish'
  };
}

export function requireArticleMainPushContext({
  actions,
  eventName,
  ref,
  sha,
  expectedSha,
  manifestRef
}) {
  if (actions !== 'true') throw new Error('Article main-push control surface requires GitHub Actions');
  if (eventName !== 'push') {
    throw new Error('Article main-push control surface requires push');
  }
  if (ref !== 'refs/heads/main') {
    throw new Error('Article main-push control surface may run only from refs/heads/main');
  }

  const sourceSha = requireString(sha, 'GITHUB_SHA');
  const requestedSha = requireString(expectedSha, 'workflow source_sha');
  if (!SHA_RE.test(sourceSha) || !SHA_RE.test(requestedSha)) {
    throw new Error('Article main-push control surface requires lowercase 40-hex source SHAs');
  }
  if (sourceSha !== requestedSha) {
    throw new Error('workflow source_sha must equal the exact main push SHA');
  }

  return {
    sourceSha,
    manifestRef: normalizeManifestRef(manifestRef),
    action: 'publish',
    productionPublish: true
  };
}

export function productionPublishModeForPlan(plan) {
  requirePublishPlan(plan);
  const statuses = [];
  for (const variant of plan.variants) {
    const locale = requireString(variant?.locale, 'publication plan locale');
    requireSourceFingerprint(variant, locale);
    statuses.push(requireGhostPlan(variant, locale).currentStatus);
  }

  if (statuses.includes('draft')) {
    for (const variant of plan.variants) requireDraftPromotionVariant(variant);
    return PRODUCTION_PUBLISH_MODE.DRAFT_PROMOTION;
  }

  if (statuses.every((status) => status === 'published')) {
    for (const variant of plan.variants) requirePublishedRevisionVariant(variant);
    return PRODUCTION_PUBLISH_MODE.PUBLISHED_REVISION;
  }

  throw new Error('production workflow requires either draft-promotion recovery or managed published revision state for every locale');
}

export function requireProductionPublishMode(plan, expectedMode) {
  if (!Object.values(PRODUCTION_PUBLISH_MODE).includes(expectedMode)) {
    throw new Error(`unsupported production publish mode: ${expectedMode}`);
  }
  const actualMode = productionPublishModeForPlan(plan);
  if (actualMode !== expectedMode) {
    throw new Error(`production publish mode changed after authorization: expected ${expectedMode}, got ${actualMode}`);
  }
  return plan;
}

// Kept as the strict first-publication predicate for callers/tests that need to
// prove every locale is still an exact-current draft before promotion begins.
export function requireExactCurrentDraftsForProduction(plan) {
  requirePublishPlan(plan);
  for (const variant of plan.variants) {
    if (requireDraftPromotionVariant(variant) !== 'draft') {
      throw new Error(`production workflow requires an exact-current managed draft for locale: ${variant.locale}`);
    }
  }
  return plan;
}

export function publicationAuthorizationForPlan(plan) {
  productionPublishModeForPlan(plan);
  const articleId = requireString(plan.articleId, 'publication plan articleId');

  const sourceFingerprints = {};
  for (const variant of plan.variants) {
    const locale = requireString(variant?.locale, 'publication plan locale');
    sourceFingerprints[locale] = variant.sourceFingerprint;
  }

  return {
    version: ARTICLE_PUBLICATION_AUTHORIZATION_VERSION,
    kind: 'explicit-production-publication',
    articleId,
    sourceFingerprints
  };
}

export function publicationAuthorizationForDispatchPlan(context, plan) {
  if (!context || context.productionPublish !== true || context.operation !== 'publish') {
    throw new Error('production publication authorization requires an exact publish workflow_dispatch context');
  }
  return publicationAuthorizationForPlan(plan);
}
