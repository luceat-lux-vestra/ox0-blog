#!/usr/bin/env node
import path from 'node:path';
import {
  ARTICLE_PUBLICATION_AUTHORIZATION_VERSION,
  ArticlePublicationError,
  synchronizeArticlePublication
} from '../src/article-publication.mjs';
import { prepareArticlePublicationOperation } from '../src/article-planning.mjs';
import { GhostAdminClient } from '../src/ghost-client.mjs';
import { loadHostRuntime } from '../src/host-runtime.mjs';
import { parseStrictJson } from '../src/strict-json.mjs';
import {
  productionPublishModeForPlan,
  requireProductionPublishMode
} from '../src/workflow-dispatch-control.mjs';

const SOURCE_FINGERPRINT_RE = /^sha256:[a-f0-9]{64}$/;

function requireAuthorizationEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON must contain one authorization object');
  }
  if (value.version !== ARTICLE_PUBLICATION_AUTHORIZATION_VERSION) {
    throw new Error(`unsupported Article publication authorization version: ${value.version}`);
  }
  if (value.kind !== 'explicit-production-publication') {
    throw new Error('production publication authorization kind must be explicit-production-publication');
  }
  if (typeof value.articleId !== 'string' || value.articleId.trim() === '') {
    throw new Error('production publication authorization articleId is required');
  }
  if (
    !value.sourceFingerprints
    || typeof value.sourceFingerprints !== 'object'
    || Array.isArray(value.sourceFingerprints)
  ) {
    throw new Error('production publication authorization sourceFingerprints are required');
  }
  const entries = Object.entries(value.sourceFingerprints);
  if (entries.length === 0) {
    throw new Error('production publication authorization sourceFingerprints must not be empty');
  }
  for (const [locale, fingerprint] of entries) {
    if (locale.trim() === '' || !SOURCE_FINGERPRINT_RE.test(fingerprint)) {
      throw new Error(`production publication authorization contains invalid source fingerprint for locale: ${locale}`);
    }
  }
  return value;
}

function authorizationForAction(action) {
  const raw = process.env.OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON;
  if (action === 'draft') {
    if (raw != null && raw.trim() !== '') {
      throw new Error('OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON is only valid for publish');
    }
    return null;
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(
      'publish requires OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON from an explicit external control-surface authorization'
    );
  }
  let parsed;
  try { parsed = parseStrictJson(raw); } catch (error) {
    throw new Error(`failed to parse OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON: ${error.message}`);
  }
  return requireAuthorizationEnvelope(parsed);
}

function errorReport(error) {
  if (!(error instanceof ArticlePublicationError)) {
    return {
      name: error?.name ?? 'Error',
      message: error instanceof Error ? error.message : String(error)
    };
  }
  return {
    name: error.name,
    message: error.message,
    stage: error.stage,
    cause: error.cause instanceof Error ? error.cause.message : error.cause ?? null,
    publishedAssets: error.publishedAssets,
    featureImageUploads: error.featureImageUploads,
    recovery: error.recovery
  };
}

async function main() {
  const [manifestRef, action, ...extra] = process.argv.slice(2);
  if (!manifestRef || !action || extra.length > 0) {
    throw new Error('usage: node scripts/sync-article.mjs <posts/.../article.json> <draft|publish>');
  }
  if (!['draft', 'publish'].includes(action)) throw new Error('action must be draft or publish');

  const authorization = authorizationForAction(action);
  const url = process.env.GHOST_ADMIN_URL;
  const key = process.env.GHOST_ADMIN_API_KEY;
  if (!url || !key) throw new Error('GHOST_ADMIN_URL and GHOST_ADMIN_API_KEY are required');

  const repoRoot = process.cwd();
  const manifestPath = path.resolve(repoRoot, manifestRef);
  const hostRuntime = await loadHostRuntime({ repoRoot });
  const client = new GhostAdminClient({ url, key });
  const common = {
    manifestPath,
    action,
    client,
    repoRoot,
    assetPublisher: hostRuntime.assetPublisher,
    projectContext: hostRuntime.projectContext,
    remoteResourcePolicy: hostRuntime.remoteResourcePolicy
  };

  let publicationPlanGuard = null;
  let productionMode = null;
  if (action === 'publish') {
    const prepared = await prepareArticlePublicationOperation(common);
    productionMode = productionPublishModeForPlan(prepared.plan);
    publicationPlanGuard = (plan) => requireProductionPublishMode(plan, productionMode);
  }

  const result = await synchronizeArticlePublication({
    ...common,
    authorization,
    publicationPlanGuard
  });
  process.stdout.write(`${JSON.stringify({
    ...result,
    ...(productionMode ? { productionMode } : {})
  }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify(errorReport(error), null, 2)}\n`);
  process.exitCode = 1;
}
