import { normalizeArticle } from './article.mjs';
import { articleSemanticSourceFingerprintV1 } from './article-readiness-source.mjs';
import { deriveReviewedArticleReadiness, validateArticleReadinessCheckpoint } from './article-readiness.mjs';
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

  return {
    version: ARTICLE_BUNDLE_CONTRACT_VERSION,
    article,
    translationCheckpoint,
    readinessCheckpoint
  };
}

export function recoverArticleBundleReviewState(
  rawBundle,
  {
    currentTranslationFingerprints,
    currentEvidenceFingerprint = null,
    reviewRequiredSignal = false
  }
) {
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
    currentEvidenceFingerprint,
    checkpoint: bundle.readinessCheckpoint,
    reviewRequiredSignal
  });

  return {
    bundle,
    translation,
    articleSourceFingerprint,
    readiness
  };
}
