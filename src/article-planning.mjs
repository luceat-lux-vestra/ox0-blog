import { evaluateArticleBundle } from './article-evaluation.mjs';
import { loadArticleManifest } from './article-manifest.mjs';
import { MarkedCompiler } from './compiler/marked-compiler.mjs';
import { requireCompiledDocument } from './compiler/document-compiler.mjs';
import { createLocaleProjectionFromCompiledDocument } from './locale-projection.mjs';
import { planMaterialResourceDelivery } from './material-resource-delivery.mjs';
import {
  assertProjectionManagedAndUnchanged,
  getProjectionSourceFingerprint,
  getProjectionSyncHash
} from './projection-managed-state.mjs';
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

async function loadPlanningContext({ manifestPath, action, repoRoot, compiler }) {
  const desiredAction = requireAction(action);
  const loaded = await loadArticleManifest({ manifestPath, repoRoot });
  const evaluation = await evaluateArticleBundle({
    bundle: loaded.bundle,
    compiler,
    repoRoot,
    publicationByLocale: loaded.publicationByLocale
  });
  if (desiredAction === 'publish') assertPublishReady(evaluation, loaded.manifestPath);
  return { desiredAction, loaded, evaluation };
}

async function prepareLocaleProjection({
  loaded,
  evaluation,
  locale,
  compiler,
  repoRoot,
  assetPublisher
}) {
  const variantEvidence = evaluation.variantEvidence.get(locale);
  if (!variantEvidence) {
    if (loaded.bundle.article.requiredLocales.includes(locale)) {
      throw new Error(`required LocaleVariant is missing: ${locale}`);
    }
    throw new Error(`locale is not required by Article: ${locale}`);
  }
  const variant = loaded.bundle.article.variants.find((candidate) => candidate.locale === locale);
  if (!variant) throw new Error(`required LocaleVariant is missing: ${locale}`);

  let compiledDocument = variantEvidence.compiledDocument;
  let assetPlans = [];
  if (variantEvidence.materialAssets.length > 0) {
    if (!assetPublisher) {
      throw new Error(
        `target Article projection with local body assets requires a host AssetPublisher before Ghost planning: ${locale}`
      );
    }
    const delivery = await planMaterialResourceDelivery({
      variant,
      compiledDocument: variantEvidence.compiledDocument,
      materialAssets: variantEvidence.materialAssets,
      repoRoot,
      assetPublisher
    });
    compiledDocument = requireCompiledDocument(await compiler.compile(variant, {
      resolveResource: delivery.resolveResource
    }));
    if (compiledDocument.locale !== variant.locale) {
      throw new Error(`compiler returned locale=${compiledDocument.locale} for LocaleVariant.locale=${variant.locale}`);
    }
    assetPlans = delivery.plans;
  }

  const publication = loaded.publicationByLocale.get(locale);
  if (!publication) throw new Error(`publication metadata is missing for LocaleVariant: ${locale}`);
  const featureFingerprint = variantEvidence.semanticPublication?.featureImageFingerprint ?? null;
  const prepared = createLocaleProjectionFromCompiledDocument({
    article: loaded.bundle.article,
    locale,
    publication,
    compiledDocument,
    fingerprintEvidence: {
      materialAssets: variantEvidence.materialAssets,
      ...(featureFingerprint ? { featureImageFingerprint: featureFingerprint } : {})
    }
  });
  return { ...prepared, assetPlans };
}

function tagNames(tags) {
  return (tags ?? [])
    .map((tag) => typeof tag === 'string' ? tag : tag?.name)
    .filter((tag) => typeof tag === 'string' && tag !== '');
}

async function bindObservedGhostState({ prepared, ghost, client }) {
  const matches = await client.getPostsBySourceTag(ghost.sourceIdentity);
  if (matches.length > 1) {
    throw new Error('Ghost projection identity became ambiguous while binding publication plan');
  }
  const existing = matches[0] ?? null;
  if (ghost.existingPostId == null) {
    if (existing) {
      throw new Error('Ghost projection identity became owned while binding publication plan; recompute plan');
    }
    return { ...ghost, observed: null };
  }
  if (!existing || existing.id !== ghost.existingPostId) {
    throw new Error('Ghost projection identity owner changed while binding publication plan; recompute plan');
  }

  assertProjectionManagedAndUnchanged(existing, prepared.projection.identityTags, {
    requireSourceFingerprint: true
  });
  const projectedSourceFingerprint = getProjectionSourceFingerprint(existing);
  if (existing.status !== ghost.currentStatus || projectedSourceFingerprint !== ghost.projectedSourceFingerprint) {
    throw new Error('Ghost managed projection changed while binding publication plan; recompute plan');
  }

  return {
    ...ghost,
    observed: {
      postId: existing.id,
      updatedAt: existing.updated_at ?? null,
      status: existing.status ?? null,
      slug: existing.slug ?? null,
      tags: tagNames(existing.tags),
      projectedSourceFingerprint,
      syncHash: getProjectionSyncHash(existing)
    }
  };
}

async function planPreparedProjection({ prepared, action, client, repoRoot }) {
  const ghost = await planProjectionSynchronization({
    projection: prepared.projection,
    compiledDocument: prepared.compiledDocument,
    action,
    client,
    repoRoot
  });
  const boundGhost = await bindObservedGhostState({ prepared, ghost, client });
  return {
    locale: prepared.variant.locale,
    variantId: prepared.variant.variantId,
    sourceFingerprint: prepared.sourceFingerprint,
    assetPlans: prepared.assetPlans.map((plan) => ({ ...plan })),
    ghost: boundGhost
  };
}

export async function planArticleProjection({
  manifestPath,
  locale,
  action,
  client,
  repoRoot,
  compiler = new MarkedCompiler(),
  assetPublisher = null
}) {
  const context = await loadPlanningContext({ manifestPath, action, repoRoot, compiler });
  const prepared = await prepareLocaleProjection({
    loaded: context.loaded,
    evaluation: context.evaluation,
    locale,
    compiler,
    repoRoot,
    assetPublisher
  });
  const planned = await planPreparedProjection({
    prepared,
    action: context.desiredAction,
    client,
    repoRoot
  });

  return {
    articleId: context.loaded.bundle.article.articleId,
    manifestPath: context.loaded.manifestPath,
    locale,
    action: context.desiredAction,
    translation: context.evaluation.translation,
    readiness: context.evaluation.readiness,
    sourceFingerprint: planned.sourceFingerprint,
    assetPlans: planned.assetPlans,
    ghost: planned.ghost
  };
}

export async function planArticlePublication({
  manifestPath,
  action,
  client,
  repoRoot,
  compiler = new MarkedCompiler(),
  assetPublisher = null
}) {
  const context = await loadPlanningContext({ manifestPath, action, repoRoot, compiler });

  // Preflight every required locale before the first Ghost read. PREPARE_PUBLISH
  // must not produce a partial plan merely because one sibling projection cannot
  // be represented by the current host policy.
  const prepared = [];
  for (const locale of context.loaded.bundle.article.requiredLocales) {
    prepared.push(await prepareLocaleProjection({
      loaded: context.loaded,
      evaluation: context.evaluation,
      locale,
      compiler,
      repoRoot,
      assetPublisher
    }));
  }

  const variants = [];
  for (const projection of prepared) {
    variants.push(await planPreparedProjection({
      prepared: projection,
      action: context.desiredAction,
      client,
      repoRoot
    }));
  }

  return {
    articleId: context.loaded.bundle.article.articleId,
    manifestPath: context.loaded.manifestPath,
    action: context.desiredAction,
    translation: context.evaluation.translation,
    readiness: context.evaluation.readiness,
    variants
  };
}
