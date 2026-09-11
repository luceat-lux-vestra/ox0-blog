import { normalizeArticle } from './article.mjs';
import {
  createArticleReadinessInvalidation,
  validateArticleReadinessInvalidation
} from './article-readiness-invalidation.mjs';
import { articleSemanticSourceFingerprintV1 } from './article-readiness-source.mjs';
import {
  deriveReviewedArticleReadiness,
  resolveArticleReadinessInvalidations,
  validateArticleReadinessCheckpoint
} from './article-readiness.mjs';
import {
  acceptedFingerprintsFromCheckpoint,
  validateTranslationCheckpoint
} from './translation-checkpoint.mjs';
import { deriveTranslationState } from './translation-state.mjs';

export const ARTICLE_BUNDLE_CONTRACT_VERSION = 1;

const FORBIDDEN_DERIVED_FIELDS = [
  'translationState',
  'readinessState',
  'ghostProjectionState',
  'gitState',
  'publicationAuthorization'
];

function requireReadinessEpoch(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Article bundle readinessEpoch must be a non-negative safe integer');
  }
  return value;
}

function normalizeInvalidations(value, readinessEpoch, readinessCheckpoint) {
  if (!Array.isArray(value)) {
    throw new Error('Article bundle readinessInvalidations must be an array');
  }
  const invalidations = value.map(validateArticleReadinessInvalidation);
  const ids = new Set();
  const epochs = new Set();
  let priorEpoch = 0;
  for (const invalidation of invalidations) {
    if (ids.has(invalidation.id)) throw new Error('Article bundle readinessInvalidations contain duplicate ids');
    if (epochs.has(invalidation.epoch)) throw new Error('Article bundle readinessInvalidations contain duplicate epochs');
    if (invalidation.epoch <= priorEpoch) {
      throw new Error('Article bundle readinessInvalidations must be ordered by increasing epoch');
    }
    if (invalidation.epoch > readinessEpoch) {
      throw new Error('Article readiness invalidation epoch cannot exceed bundle readinessEpoch');
    }
    if (readinessCheckpoint && invalidation.epoch <= readinessCheckpoint.reviewedEpoch) {
      throw new Error('Article bundle cannot keep an invalidation active at or below the checkpoint reviewedEpoch');
    }
    ids.add(invalidation.id);
    epochs.add(invalidation.epoch);
    priorEpoch = invalidation.epoch;
  }
  return invalidations;
}

export function normalizeArticleBundle(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Article bundle must be an object');
  }
  if (raw.version !== ARTICLE_BUNDLE_CONTRACT_VERSION) {
    throw new Error(`unsupported Article bundle contract version: ${raw.version}`);
  }
  for (const field of FORBIDDEN_DERIVED_FIELDS) {
    if (Object.hasOwn(raw, field)) {
      throw new Error(`Article bundle must not persist derived/ephemeral field: ${field}`);
    }
  }

  const article = normalizeArticle(raw.article);
  const translationCheckpoint = raw.translationCheckpoint == null
    ? null
    : validateTranslationCheckpoint(raw.translationCheckpoint, {
        requiredLocales: article.requiredLocales
      });
  const readinessEpoch = requireReadinessEpoch(raw.readinessEpoch);
  const readinessCheckpoint = raw.readinessCheckpoint == null
    ? null
    : validateArticleReadinessCheckpoint(raw.readinessCheckpoint);
  if (readinessCheckpoint?.reviewedEpoch > readinessEpoch) {
    throw new Error('Article readiness checkpoint reviewedEpoch cannot exceed bundle readinessEpoch');
  }
  const readinessInvalidations = normalizeInvalidations(
    raw.readinessInvalidations,
    readinessEpoch,
    readinessCheckpoint
  );

  return {
    version: ARTICLE_BUNDLE_CONTRACT_VERSION,
    article,
    translationCheckpoint,
    readinessEpoch,
    readinessCheckpoint,
    readinessInvalidations
  };
}

export function recoverArticleBundleReviewState(rawBundle, { currentTranslationFingerprints }) {
  const bundle = normalizeArticleBundle(rawBundle);
  const acceptedFingerprints = bundle.translationCheckpoint == null
    ? null
    : acceptedFingerprintsFromCheckpoint(bundle.translationCheckpoint, {
        requiredLocales: bundle.article.requiredLocales
      });
  const translation = deriveTranslationState({
    requiredLocales: bundle.article.requiredLocales,
    currentFingerprints: currentTranslationFingerprints,
    acceptedFingerprints
  });

  if (translation.state === 'INCOMPLETE') {
    return {
      bundle,
      translation,
      articleSourceFingerprint: null,
      readiness: { state: 'REVIEW_REQUIRED', reason: 'SOURCE_INCOMPLETE' }
    };
  }

  const articleSourceFingerprint = articleSemanticSourceFingerprintV1({
    requiredLocales: bundle.article.requiredLocales,
    translationFingerprints: currentTranslationFingerprints
  });
  const readiness = deriveReviewedArticleReadiness({
    currentSourceFingerprint: articleSourceFingerprint,
    currentEpoch: bundle.readinessEpoch,
    checkpoint: bundle.readinessCheckpoint,
    invalidations: bundle.readinessInvalidations
  });

  return {
    bundle,
    translation,
    articleSourceFingerprint,
    readiness
  };
}

export function invalidateArticleBundleReadiness(
  rawBundle,
  { id, reason, origin, reference = null }
) {
  const bundle = normalizeArticleBundle(rawBundle);
  const nextEpoch = bundle.readinessEpoch + 1;
  if (!Number.isSafeInteger(nextEpoch)) throw new Error('Article bundle readinessEpoch overflow');
  const invalidation = createArticleReadinessInvalidation({
    id,
    epoch: nextEpoch,
    reason,
    origin,
    reference
  });
  return normalizeArticleBundle({
    ...bundle,
    readinessEpoch: nextEpoch,
    readinessInvalidations: [...bundle.readinessInvalidations, invalidation]
  });
}

export function resolveArticleBundleReadinessInvalidations(
  rawBundle,
  {
    currentTranslationFingerprints,
    review
  }
) {
  const recovered = recoverArticleBundleReviewState(rawBundle, { currentTranslationFingerprints });
  if (recovered.bundle.readinessInvalidations.length === 0) {
    throw new Error('Article bundle has no active readiness invalidations to resolve');
  }
  if (recovered.translation.state !== 'SYNCED') {
    throw new Error('Article readiness invalidations cannot resolve while translation state is not SYNCED');
  }
  const resolution = resolveArticleReadinessInvalidations({
    currentSourceFingerprint: recovered.articleSourceFingerprint,
    currentEpoch: recovered.bundle.readinessEpoch,
    invalidations: recovered.bundle.readinessInvalidations,
    review
  });
  return normalizeArticleBundle({
    ...recovered.bundle,
    readinessCheckpoint: resolution.checkpoint,
    readinessInvalidations: []
  });
}
