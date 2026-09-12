import { evaluateArticleBundle } from './article-evaluation.mjs';
import {
  acceptArticleBundleReadinessReview,
  invalidateArticleBundleReadiness,
  recoverArticleBundleReviewState,
  requestArticleBundleReadinessReview
} from './article-bundle.mjs';
import { loadArticleManifest, serializeArticleManifest } from './article-manifest.mjs';
import { MarkedCompiler } from './compiler/marked-compiler.mjs';
import { createTranslationCheckpoint } from './translation-checkpoint.mjs';

async function loadEvaluatedArticle({ manifestPath, repoRoot, compiler }) {
  const loaded = await loadArticleManifest({ manifestPath, repoRoot });
  const evaluation = await evaluateArticleBundle({
    bundle: loaded.bundle,
    compiler,
    repoRoot,
    publicationByLocale: loaded.publicationByLocale
  });
  return { loaded, evaluation };
}

async function serializeBundle({ loaded, bundle, repoRoot }) {
  return serializeArticleManifest({
    bundle,
    publicationByLocale: loaded.publicationByLocale,
    repoRoot,
    articleDir: loaded.articleDir
  });
}

async function serializedResult({ loaded, bundle, repoRoot, currentTranslationFingerprints }) {
  const manifestText = await serializeBundle({ loaded, bundle, repoRoot });
  const recovered = recoverArticleBundleReviewState(bundle, { currentTranslationFingerprints });
  return {
    manifestPath: loaded.manifestPath,
    manifestText,
    bundle,
    translation: recovered.translation,
    readiness: recovered.readiness,
    articleSourceFingerprint: recovered.articleSourceFingerprint
  };
}

export async function acceptArticleTranslationReview({
  manifestPath,
  repoRoot,
  review,
  compiler = new MarkedCompiler()
}) {
  const { loaded, evaluation } = await loadEvaluatedArticle({ manifestPath, repoRoot, compiler });
  const translationCheckpoint = createTranslationCheckpoint({
    requiredLocales: loaded.bundle.article.requiredLocales,
    currentFingerprints: evaluation.currentTranslationFingerprints,
    review
  });
  const bundle = {
    ...loaded.bundle,
    translationCheckpoint
  };
  return serializedResult({
    loaded,
    bundle,
    repoRoot,
    currentTranslationFingerprints: evaluation.currentTranslationFingerprints
  });
}

export async function requestArticleSemanticReview({
  manifestPath,
  repoRoot,
  id,
  origin = 'blog-audit',
  reference = null,
  compiler = new MarkedCompiler()
}) {
  const { loaded, evaluation } = await loadEvaluatedArticle({ manifestPath, repoRoot, compiler });
  const bundle = requestArticleBundleReadinessReview(loaded.bundle, {
    currentTranslationFingerprints: evaluation.currentTranslationFingerprints,
    id,
    origin,
    reference
  });
  return serializedResult({
    loaded,
    bundle,
    repoRoot,
    currentTranslationFingerprints: evaluation.currentTranslationFingerprints
  });
}

export async function recordArticleReadinessInvalidation({
  manifestPath,
  repoRoot,
  id,
  reason,
  origin,
  reference = null
}) {
  const loaded = await loadArticleManifest({ manifestPath, repoRoot });
  const bundle = invalidateArticleBundleReadiness(loaded.bundle, {
    id,
    reason,
    origin,
    reference
  });
  const manifestText = await serializeBundle({ loaded, bundle, repoRoot });
  return {
    manifestPath: loaded.manifestPath,
    manifestText,
    bundle,
    invalidation: bundle.readinessInvalidations.at(-1)
  };
}

export async function acceptArticleSemanticReview({
  manifestPath,
  repoRoot,
  review,
  compiler = new MarkedCompiler()
}) {
  const { loaded, evaluation } = await loadEvaluatedArticle({ manifestPath, repoRoot, compiler });
  const bundle = acceptArticleBundleReadinessReview(loaded.bundle, {
    currentTranslationFingerprints: evaluation.currentTranslationFingerprints,
    review
  });
  return serializedResult({
    loaded,
    bundle,
    repoRoot,
    currentTranslationFingerprints: evaluation.currentTranslationFingerprints
  });
}
