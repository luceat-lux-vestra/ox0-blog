#!/usr/bin/env node
import path from 'node:path';
import {
  ArticlePublicationError,
  synchronizeArticlePublication
} from '../src/article-publication.mjs';
import {
  planArticlePublication,
  prepareArticlePublicationOperation
} from '../src/article-planning.mjs';
import { GhostAdminClient } from '../src/ghost-client.mjs';
import { loadHostRuntime } from '../src/host-runtime.mjs';
import {
  productionPublishModeForPlan,
  publicationAuthorizationForPlan,
  requireArticleMainPushContext,
  requireProductionPublishMode
} from '../src/workflow-dispatch-control.mjs';

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
  const [manifestRef, operation, ...extra] = process.argv.slice(2);
  if (!manifestRef || !['plan-publish', 'publish'].includes(operation) || extra.length > 0) {
    throw new Error('usage: node scripts/main-push-article.mjs <posts/.../article.json> <plan-publish|publish>');
  }

  const context = requireArticleMainPushContext({
    actions: process.env.GITHUB_ACTIONS,
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA,
    expectedSha: process.env.OX0_ARTICLE_SOURCE_SHA,
    manifestRef
  });

  const url = process.env.GHOST_ADMIN_URL;
  const key = process.env.GHOST_ADMIN_API_KEY;
  if (!url || !key) throw new Error('GHOST_ADMIN_URL and GHOST_ADMIN_API_KEY are required');

  const repoRoot = process.cwd();
  const manifestPath = path.resolve(repoRoot, context.manifestRef);
  const hostRuntime = await loadHostRuntime({ repoRoot });
  const client = new GhostAdminClient({ url, key });
  const common = {
    manifestPath,
    action: 'publish',
    client,
    repoRoot,
    assetPublisher: hostRuntime.assetPublisher,
    projectContext: hostRuntime.projectContext,
    remoteResourcePolicy: hostRuntime.remoteResourcePolicy
  };

  if (operation === 'plan-publish') {
    const plan = await planArticlePublication(common);
    const productionMode = productionPublishModeForPlan(plan);
    process.stdout.write(`${JSON.stringify({
      status: 'PLANNED',
      sourceSha: context.sourceSha,
      operation,
      productionMode,
      plan
    }, null, 2)}\n`);
    return;
  }

  const prepared = await prepareArticlePublicationOperation(common);
  const productionMode = productionPublishModeForPlan(prepared.plan);
  const authorization = publicationAuthorizationForPlan(prepared.plan);
  const result = await synchronizeArticlePublication({
    ...common,
    authorization,
    publicationPlanGuard(plan) {
      return requireProductionPublishMode(plan, productionMode);
    }
  });

  process.stdout.write(`${JSON.stringify({
    status: result.status,
    sourceSha: context.sourceSha,
    operation,
    productionMode,
    articleId: result.articleId,
    action: result.action,
    publishedAssets: result.publishedAssets,
    variants: result.variants
  }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify(errorReport(error), null, 2)}\n`);
  process.exitCode = 1;
}
