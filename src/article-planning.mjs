import { evaluateArticleBundle } from './article-evaluation.mjs';
import { loadArticleManifest } from './article-manifest.mjs';
import { MarkedCompiler } from './compiler/marked-compiler.mjs';
import { readRepositoryAssetSnapshot } from './file-confinement.mjs';
import { createLocaleProjectionFromCompiledDocument } from './locale-projection.mjs';
import { isHttpsUrl } from './projection-metadata.mjs';
import { planProjectionSynchronization } from './publisher.mjs';

function requireAction(action) {
  if (!['draft', 'publish'].includes(action)) throw new Error('action must be draft or publish');
  return action;
}

function assertPublishReady(evaluation, manifestPath) {
  if (evaluation.translation.state !== 'SYNCED') {
    throw new Error(`production publish planning requires translation SYNCED: ${manifestPath} (${evaluation.translation.state})`);
  }
  if (evaluation.readiness.state !== 'READY') {
    throw new Error(`production publish planning requires Article READY: ${manifestPath} (${evaluation.readiness.state})`);
  }
}

async function featureImageFingerprint(publication, repoRoot) {
  if (!publication.featureImage || isHttpsUrl(publication.featureImage)) return null;
  return (await readRepositoryAssetSnapshot(
    publication.featureImage,
    repoRoot,
    'Article featureImage'
  )).fingerprint;
}

export async function planArticleProjection({
  manifestPath,
  locale,
  action,
  client,
  repoRoot,
  compiler = new MarkedCompiler()
}) {
  const desiredAction = requireAction(action);
  const loaded = await loadArticleManifest({ manifestPath, repoRoot });
  const evaluation = await evaluateArticleBundle({
    bundle: loaded.bundle,
    compiler,
    repoRoot
  });

  if (desiredAction === 'publish') assertPublishReady(evaluation, loaded.manifestPath);

  const variantEvidence = evaluation.variantEvidence.get(locale);
  if (!variantEvidence) {
    if (loaded.bundle.article.requiredLocales.includes(locale)) {
      throw new Error(`required LocaleVariant is missing: ${locale}`);
    }
    throw new Error(`locale is not required by Article: ${locale}`);
  }
  if (variantEvidence.materialAssets.length > 0) {
    throw new Error(
      `target Article projection with local body assets requires a host AssetPublisher before Ghost planning: ${locale}`
    );
  }

  const publication = loaded.publicationByLocale.get(locale);
  if (!publication) throw new Error(`publication metadata is missing for LocaleVariant: ${locale}`);
  const featureFingerprint = await featureImageFingerprint(publication, repoRoot);
  const prepared = createLocaleProjectionFromCompiledDocument({
    article: loaded.bundle.article,
    locale,
    publication,
    compiledDocument: variantEvidence.compiledDocument,
    fingerprintEvidence: {
      materialAssets: variantEvidence.materialAssets,
      ...(featureFingerprint ? { featureImageFingerprint: featureFingerprint } : {})
    }
  });

  const ghostPlan = await planProjectionSynchronization({
    projection: prepared.projection,
    compiledDocument: prepared.compiledDocument,
    action: desiredAction,
    client,
    repoRoot
  });

  return {
    articleId: loaded.bundle.article.articleId,
    manifestPath: loaded.manifestPath,
    locale,
    action: desiredAction,
    translation: evaluation.translation,
    readiness: evaluation.readiness,
    sourceFingerprint: prepared.sourceFingerprint,
    ghost: ghostPlan
  };
}
