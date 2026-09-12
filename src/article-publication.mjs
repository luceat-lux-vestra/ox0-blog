import { prepareArticlePublicationOperation } from './article-planning.mjs';
import { publishPlannedMaterialAssets } from './material-resource-delivery.mjs';
import { synchronizePlannedProjection } from './planned-projection-sync.mjs';
import { projectionLookupTag } from './projection-managed-state.mjs';
import { deriveProjectionState } from './projection-state.mjs';

export const ARTICLE_PUBLICATION_AUTHORIZATION_VERSION = 1;

export class ArticlePublicationError extends Error {
  constructor(message, { stage, cause = null, recovery = null, publishedAssets = [] } = {}) {
    super(message);
    this.name = 'ArticlePublicationError';
    this.stage = stage ?? 'UNKNOWN';
    this.cause = cause;
    this.recovery = recovery;
    this.publishedAssets = publishedAssets;
  }
}

function requireAuthorizationShape(authorization) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    throw new Error('production publication requires explicit task-scoped authorization');
  }
  if (authorization.version !== ARTICLE_PUBLICATION_AUTHORIZATION_VERSION) {
    throw new Error(`unsupported Article publication authorization version: ${authorization.version}`);
  }
  if (authorization.kind !== 'explicit-production-publication') {
    throw new Error('production publication authorization kind must be explicit-production-publication');
  }
  if (typeof authorization.articleId !== 'string' || authorization.articleId.trim() === '') {
    throw new Error('production publication authorization articleId is required');
  }
  if (
    !authorization.sourceFingerprints
    || typeof authorization.sourceFingerprints !== 'object'
    || Array.isArray(authorization.sourceFingerprints)
  ) {
    throw new Error('production publication authorization sourceFingerprints are required');
  }
  return authorization;
}

function validateAuthorizationForPlan(authorization, plan) {
  const value = requireAuthorizationShape(authorization);
  if (value.articleId !== plan.articleId) {
    throw new Error('production publication authorization targets another Article');
  }
  const expected = new Map(plan.variants.map((variant) => [variant.locale, variant.sourceFingerprint]));
  const supplied = Object.entries(value.sourceFingerprints);
  if (supplied.length !== expected.size) {
    throw new Error('production publication authorization must cover every required locale exactly');
  }
  for (const [locale, fingerprint] of supplied) {
    if (!expected.has(locale) || expected.get(locale) !== fingerprint) {
      throw new Error(`production publication authorization does not cover exact source fingerprint for locale: ${locale}`);
    }
  }
  return value;
}

function sameAssetPlan(left, right) {
  return left.ref === right.ref
    && left.fingerprint === right.fingerprint
    && left.url === right.url
    && left.action === right.action
    && left.size === right.size
    && left.filename === right.filename;
}

function uniqueAssetPlans(plan) {
  const byRef = new Map();
  for (const variant of plan.variants) {
    for (const asset of variant.assetPlans ?? []) {
      const prior = byRef.get(asset.ref);
      if (prior && !sameAssetPlan(prior, asset)) {
        throw new Error(`required locales produced conflicting AssetPublisher plans for ${asset.ref}`);
      }
      byRef.set(asset.ref, asset);
    }
  }
  return [...byRef.values()].sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
}

async function recoverProjectionStates(runtime, client, successfulLocales = new Set()) {
  const states = [];
  for (let index = 0; index < runtime.prepared.length; index += 1) {
    const prepared = runtime.prepared[index];
    const variantPlan = runtime.plan.variants[index];
    const locale = prepared.variant.locale;
    const sourceIdentity = projectionLookupTag(prepared.projection.identityTags);
    try {
      const matches = await client.getPostsBySourceTag(sourceIdentity);
      if (matches.length > 1) {
        states.push({
          locale,
          state: {
            state: 'RECONCILIATION_REQUIRED',
            reason: 'IDENTITY_AMBIGUITY',
            diagnostic: `multiple Ghost posts claim ${sourceIdentity}`
          }
        });
        continue;
      }
      const observedPost = matches[0] ?? null;
      const hadManagedMapping = variantPlan.ghost.observed != null || successfulLocales.has(locale);
      states.push({
        locale,
        postId: observedPost?.id ?? null,
        state: deriveProjectionState({
          observedPost,
          expectedIdentityTags: prepared.projection.identityTags,
          hadManagedMapping,
          currentSourceFingerprint: prepared.sourceFingerprint
        })
      });
    } catch (error) {
      states.push({
        locale,
        state: {
          state: 'RECONCILIATION_REQUIRED',
          reason: 'RECOVERY_READ_FAILED',
          diagnostic: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }
  return states;
}

function expectedFinalState(action) {
  return action === 'publish' ? 'PUBLISHED_CURRENT' : 'DRAFT_CURRENT';
}

function allCurrent(states, action) {
  const expected = expectedFinalState(action);
  return states.every((entry) => entry.state.state === expected);
}

export async function synchronizeArticlePublication({
  manifestPath,
  action,
  client,
  repoRoot,
  compiler,
  assetPublisher = null,
  authorization = null
}) {
  if (action === 'publish') requireAuthorizationShape(authorization);

  let runtime;
  try {
    runtime = await prepareArticlePublicationOperation({
      manifestPath,
      action,
      client,
      repoRoot,
      ...(compiler ? { compiler } : {}),
      assetPublisher
    });
  } catch (cause) {
    throw new ArticlePublicationError('Article publication preflight failed', {
      stage: 'PREFLIGHT',
      cause
    });
  }

  if (action === 'publish') {
    try {
      validateAuthorizationForPlan(authorization, runtime.plan);
    } catch (cause) {
      throw new ArticlePublicationError('Article publication authorization does not match the prepared source', {
        stage: 'AUTHORIZATION',
        cause,
        recovery: await recoverProjectionStates(runtime, client)
      });
    }
  }

  const assetPlans = uniqueAssetPlans(runtime.plan);
  const publishedAssets = [];
  try {
    for (const assetPlan of assetPlans) {
      const [result] = await publishPlannedMaterialAssets({
        plans: [assetPlan],
        repoRoot,
        assetPublisher
      });
      publishedAssets.push(result);
    }
  } catch (cause) {
    throw new ArticlePublicationError('Article material asset publication failed before Ghost mutation', {
      stage: 'ASSET_PUBLICATION',
      cause,
      publishedAssets,
      recovery: await recoverProjectionStates(runtime, client)
    });
  }

  const successfulLocales = new Set();
  for (let index = 0; index < runtime.prepared.length; index += 1) {
    const prepared = runtime.prepared[index];
    const variantPlan = runtime.plan.variants[index];
    try {
      await synchronizePlannedProjection({
        prepared,
        variantPlan,
        action: runtime.action,
        client,
        repoRoot
      });
      successfulLocales.add(prepared.variant.locale);
    } catch (cause) {
      throw new ArticlePublicationError(
        `Article projection mutation failed for locale ${prepared.variant.locale}`,
        {
          stage: 'GHOST_MUTATION',
          cause,
          publishedAssets,
          recovery: await recoverProjectionStates(runtime, client, successfulLocales)
        }
      );
    }
  }

  const recovery = await recoverProjectionStates(runtime, client, successfulLocales);
  if (!allCurrent(recovery, runtime.action)) {
    throw new ArticlePublicationError('Article publication post-verification did not recover every locale as current', {
      stage: 'POST_VERIFY',
      publishedAssets,
      recovery
    });
  }

  return {
    status: 'SUCCESS',
    articleId: runtime.plan.articleId,
    action: runtime.action,
    publishedAssets,
    variants: recovery
  };
}
