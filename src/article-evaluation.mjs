import path from 'node:path';
import { recoverArticleBundleReviewState, normalizeArticleBundle } from './article-bundle.mjs';
import { requireCompiledDocument, requireDocumentCompiler } from './compiler/document-compiler.mjs';
import { readRepositoryAssetSnapshot } from './file-confinement.mjs';
import { collectMaterialAssetEvidence } from './material-asset-evidence.mjs';
import { isHttpsUrl } from './projection-metadata.mjs';
import { resolveProjectContext } from './project-context.mjs';
import { translationFingerprintV1 } from './translation-fingerprint.mjs';

function requireRepoRoot(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') throw new Error('repoRoot is required');
  return path.resolve(repoRoot);
}

function publicationEntries(publicationByLocale) {
  if (publicationByLocale == null) return null;
  if (publicationByLocale instanceof Map) return [...publicationByLocale.entries()];
  if (typeof publicationByLocale === 'object' && !Array.isArray(publicationByLocale)) {
    return Object.entries(publicationByLocale);
  }
  throw new Error('publicationByLocale must be a Map or object when provided');
}

function exactPublicationMap(publicationByLocale, variants) {
  const entries = publicationEntries(publicationByLocale);
  if (entries == null) return null;
  const expected = new Set(variants.map((variant) => variant.locale));
  const map = new Map();
  for (const [locale, publication] of entries) {
    if (typeof locale !== 'string' || locale.trim() === '') {
      throw new Error('publicationByLocale keys must be non-empty locale strings');
    }
    if (!expected.has(locale)) throw new Error(`publication metadata contains unexpected locale: ${locale}`);
    if (map.has(locale)) throw new Error(`duplicate publication metadata locale: ${locale}`);
    if (!publication || typeof publication !== 'object' || Array.isArray(publication)) {
      throw new Error(`publication metadata must be an object for locale: ${locale}`);
    }
    map.set(locale, publication);
  }
  const missing = [...expected].filter((locale) => !map.has(locale));
  if (missing.length > 0) {
    throw new Error(`publication metadata is missing for LocaleVariant: ${missing.join(', ')}`);
  }
  return map;
}

function repositoryRef(repoRoot, absolutePath) {
  const relative = path.relative(repoRoot, absolutePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`semantic publication asset resolved outside repository: ${absolutePath}`);
  }
  return relative.split(path.sep).join('/');
}

async function semanticPublicationEvidence(publication, repoRoot) {
  if (publication == null) return null;
  const featureImageAlt = publication.featureImageAlt ?? null;
  if (!publication.featureImage) {
    return {
      featureImageRef: null,
      featureImageFingerprint: null,
      featureImageAlt
    };
  }
  if (isHttpsUrl(publication.featureImage)) {
    return {
      featureImageRef: new URL(publication.featureImage).href,
      featureImageFingerprint: null,
      featureImageAlt
    };
  }

  const snapshot = await readRepositoryAssetSnapshot(
    publication.featureImage,
    repoRoot,
    'semantic featureImage'
  );
  const featureImageRef = repositoryRef(repoRoot, snapshot.absolutePath);
  if (!featureImageRef.startsWith('assets/')) {
    throw new Error(`semantic featureImage must resolve under repository assets/: ${snapshot.absolutePath}`);
  }
  return {
    featureImageRef,
    featureImageFingerprint: snapshot.fingerprint,
    featureImageAlt
  };
}

export async function evaluateArticleBundle({
  bundle: rawBundle,
  compiler,
  repoRoot,
  projectContext = {},
  publicationByLocale = null
}) {
  const bundle = normalizeArticleBundle(rawBundle);
  requireDocumentCompiler(compiler);
  const root = requireRepoRoot(repoRoot);
  const publications = exactPublicationMap(publicationByLocale, bundle.article.variants);

  const variantEvidence = new Map();
  const currentTranslationFingerprints = {};

  for (const variant of bundle.article.variants) {
    const resolvedProjectContext = resolveProjectContext(projectContext, variant);
    const compiledDocument = requireCompiledDocument(
      await compiler.compile(variant, resolvedProjectContext)
    );
    if (compiledDocument.locale !== variant.locale) {
      throw new Error(`CompiledDocument.locale=${compiledDocument.locale} does not match LocaleVariant.locale=${variant.locale}`);
    }

    const resourceEvidence = await collectMaterialAssetEvidence({
      variant,
      compiledDocument,
      repoRoot: root
    });
    const semanticPublication = await semanticPublicationEvidence(
      publications?.get(variant.locale) ?? null,
      root
    );
    const translationFingerprint = translationFingerprintV1(variant, {
      materialAssets: resourceEvidence.materialAssets,
      semanticPublication
    });
    currentTranslationFingerprints[variant.locale] = translationFingerprint;
    variantEvidence.set(variant.locale, {
      compiledDocument,
      materialAssets: resourceEvidence.materialAssets,
      remoteResources: resourceEvidence.remoteResources,
      semanticPublication,
      translationFingerprint,
      resolvedProjectContext
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
