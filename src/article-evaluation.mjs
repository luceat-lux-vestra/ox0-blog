import { recoverArticleBundleReviewState, normalizeArticleBundle } from './article-bundle.mjs';
import { requireCompiledDocument, requireDocumentCompiler } from './compiler/document-compiler.mjs';
import { collectMaterialAssetEvidence } from './material-asset-evidence.mjs';
import { translationFingerprintV1 } from './translation-fingerprint.mjs';

function requireRepoRoot(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') throw new Error('repoRoot is required');
  return repoRoot;
}

function projectContextFor(projectContext, variant) {
  if (projectContext == null) return {};
  if (typeof projectContext === 'function') {
    const resolved = projectContext(variant);
    if (resolved == null) return {};
    if (typeof resolved !== 'object' || Array.isArray(resolved)) {
      throw new Error('projectContext factory must return an object');
    }
    return resolved;
  }
  if (typeof projectContext !== 'object' || Array.isArray(projectContext)) {
    throw new Error('projectContext must be an object or function');
  }
  return projectContext;
}

export async function evaluateArticleBundle({
  bundle: rawBundle,
  compiler,
  repoRoot,
  projectContext = {}
}) {
  const bundle = normalizeArticleBundle(rawBundle);
  requireDocumentCompiler(compiler);
  requireRepoRoot(repoRoot);

  const variantEvidence = new Map();
  const currentTranslationFingerprints = {};

  for (const variant of bundle.article.variants) {
    const compiledDocument = requireCompiledDocument(
      await compiler.compile(variant, projectContextFor(projectContext, variant))
    );
    if (compiledDocument.locale !== variant.locale) {
      throw new Error(`CompiledDocument.locale=${compiledDocument.locale} does not match LocaleVariant.locale=${variant.locale}`);
    }

    const resourceEvidence = await collectMaterialAssetEvidence({
      variant,
      compiledDocument,
      repoRoot
    });
    const translationFingerprint = translationFingerprintV1(variant, {
      materialAssets: resourceEvidence.materialAssets
    });
    currentTranslationFingerprints[variant.locale] = translationFingerprint;
    variantEvidence.set(variant.locale, {
      compiledDocument,
      materialAssets: resourceEvidence.materialAssets,
      remoteResources: resourceEvidence.remoteResources,
      translationFingerprint
    });
  }

  const recovered = recoverArticleBundleReviewState(bundle, {
    currentTranslationFingerprints
  });
  return {
    ...recovered,
    currentTranslationFingerprints,
    variantEvidence
  };
}
