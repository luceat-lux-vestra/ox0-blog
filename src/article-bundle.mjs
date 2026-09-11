import { normalizeArticle } from './article.mjs';
import { validateArticleReadinessInvalidation } from './article-readiness-invalidation.mjs';
import { articleSemanticSourceFingerprintV1 } from './article-readiness-source.mjs';
import {
  deriveReviewedArticleReadiness,
  resolveArticleReadinessInvalidation,
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
  const readinessCheckpoint = raw.readinessCheckpoint == null
    ? null
    : validateArticleReadinessCheckpoint(raw.readinessCheckpoint);
  const readinessInvalidation = raw.readinessInvalidation == null
    ? null
    : validateArticleReadinessInvalidation(raw.readinessInvalidation);

  if (
    readinessInvalidation != null
    && readinessCheckpoint?.resolvedInvalidationId === readinessInvalidation.id
  ) {
    throw new Error('Article bundle cannot keep an invalidation active after the readiness checkpoint resolves that event');
  }

  return {
    version: ARTICLE_BUNDLE_CONTRACT_VERSION,
    article,
    translationCheckpoint,
    readinessCheckpoint,
    readinessInvalidation
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
    checkpoint: bundle.readinessCheckpoint,
    invalidation: bundle.readinessInvalidation
  });

  return {
    bundle,
    translation,
    articleSourceFingerprint,
    readiness
  };
}

export function resolveArticleBundleReadinessInvalidation(
  rawBundle,
  {
    currentTranslationFingerprints,
    review
  }
) {
  const recovered = recoverArticleBundleReviewState(rawBundle, { currentTranslationFingerprints });
  if (recovered.bundle.readinessInvalidation == null) {
    throw new Error('Article bundle has no active readiness invalidation to resolve');
  }
  if (recovered.translation.state !== 'SYNCED') {
    throw new Error('Article readiness invalidation cannot resolve while translation state is not SYNCED');
  }
  const resolution = resolveArticleReadinessInvalidation({
    currentSourceFingerprint: recovered.articleSourceFingerprint,
    invalidation: recovered.bundle.readinessInvalidation,
    review
  });
  return normalizeArticleBundle({
    ...recovered.bundle,
    readinessCheckpoint: resolution.checkpoint,
    readinessInvalidation: null
  });
}
