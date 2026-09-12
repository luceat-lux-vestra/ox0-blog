import { evaluateArticleBundle } from './article-evaluation.mjs';
import { loadArticleManifest } from './article-manifest.mjs';
import { MarkedCompiler } from './compiler/marked-compiler.mjs';
import { createLocaleProjectionFromCompiledDocument } from './locale-projection.mjs';
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

function prepareLocaleProjection({ loaded, evaluation, locale }) {
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
  const featureFingerprint = variantEvidence.semanticPublication?.featureImageFingerprint ?? null;
  return createLocaleProjectionFromCompiledDocument({
    article: loaded.bundle.article,
    locale,
    publication,
    compiledDocument: variantEvidence.compiledDocument,
    fingerprintEvidence: {
      materialAssets: variantEvidence.materialAssets,
      ...(featureFingerprint ? { featureImageFingerprint: featureFingerprint } : {})
    }
  });
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
    ghost: boundGhost
  };
}

export async function planArticleProjection({
  manifestPath,
  locale,
  action,
  client,
  repoRoot,
  compiler = new MarkedCompiler()
}) {
  const context = await loadPlanningContext({ manifestPath, action, repoRoot, compiler });
  const prepared = prepareLocaleProjection({
    loaded: context.loaded,
    evaluation: context.evaluation,
    locale
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
    ghost: planned.ghost
  };
}

export async function planArticlePublication({
  manifestPath,
  action,
  client,
  repoRoot,
  compiler = new MarkedCompiler()
}) {
  const context = await loadPlanningContext({ manifestPath, action, repoRoot, compiler });

  // Preflight every required locale before the first Ghost read. PREPARE_PUBLISH
  // must not produce a partial plan merely because one sibling projection cannot
  // be represented by the current host policy.
  const prepared = context.loaded.bundle.article.requiredLocales.map((locale) =>
    prepareLocaleProjection({
      loaded: context.loaded,
      evaluation: context.evaluation,
      locale
    })
  );

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
