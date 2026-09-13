import path from 'node:path';
import { ARTICLE_PUBLICATION_AUTHORIZATION_VERSION } from './article-publication.mjs';

const SHA_RE = /^[a-f0-9]{40}$/;
const SOURCE_FINGERPRINT_RE = /^sha256:[a-f0-9]{64}$/;
const OPERATIONS = new Set(['plan-draft', 'plan-publish', 'draft', 'publish']);

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeManifestRef(value) {
  const ref = requireString(value, 'workflow manifest path');
  if (ref.includes('\\')) throw new Error('workflow manifest path must use forward slashes');
  if (path.posix.isAbsolute(ref) || path.win32.isAbsolute(ref)) {
    throw new Error('workflow manifest path must be repository-relative');
  }
  const normalized = path.posix.normalize(ref);
  if (
    normalized !== ref
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.startsWith('./')
    || !normalized.startsWith('posts/')
    || path.posix.basename(normalized) !== 'article.json'
  ) {
    throw new Error('workflow manifest path must identify posts/.../article.json without traversal or aliases');
  }
  return normalized;
}

function normalizeOperation(value) {
  const operation = requireString(value, 'workflow operation');
  if (!OPERATIONS.has(operation)) {
    throw new Error('workflow operation must be plan-draft, plan-publish, draft, or publish');
  }
  return operation;
}

function actionForOperation(operation) {
  return operation === 'plan-publish' || operation === 'publish' ? 'publish' : 'draft';
}

export function requireArticleWorkflowDispatchContext({
  actions,
  eventName,
  ref,
  sha,
  expectedSha,
  manifestRef,
  operation,
  publishConfirmation = ''
}) {
  if (actions !== 'true') throw new Error('Article Ghost control surface requires GitHub Actions');
  if (eventName !== 'workflow_dispatch') {
    throw new Error('Article Ghost control surface requires workflow_dispatch');
  }
  if (ref !== 'refs/heads/main') {
    throw new Error('Article Ghost control surface may run only from refs/heads/main');
  }

  const sourceSha = requireString(sha, 'GITHUB_SHA');
  const requestedSha = requireString(expectedSha, 'workflow source_sha');
  if (!SHA_RE.test(sourceSha) || !SHA_RE.test(requestedSha)) {
    throw new Error('Article Ghost control surface requires lowercase 40-hex source SHAs');
  }
  if (sourceSha !== requestedSha) {
    throw new Error('workflow source_sha must equal the exact workflow_dispatch main SHA');
  }

  const normalizedManifestRef = normalizeManifestRef(manifestRef);
  const normalizedOperation = normalizeOperation(operation);
  const confirmation = typeof publishConfirmation === 'string' ? publishConfirmation : '';
  if (normalizedOperation === 'publish') {
    const expected = `publish:${normalizedManifestRef}@${sourceSha}`;
    if (confirmation !== expected) {
      throw new Error(`production workflow confirmation must equal ${expected}`);
    }
  } else if (confirmation !== '') {
    throw new Error('publish confirmation must be empty for non-publish workflow operations');
  }

  return {
    sourceSha,
    manifestRef: normalizedManifestRef,
    operation: normalizedOperation,
    action: actionForOperation(normalizedOperation),
    mutatesGhost: normalizedOperation === 'draft' || normalizedOperation === 'publish',
    productionPublish: normalizedOperation === 'publish'
  };
}

export function publicationAuthorizationForDispatchPlan(context, plan) {
  if (!context || context.productionPublish !== true || context.operation !== 'publish') {
    throw new Error('production publication authorization requires an exact publish workflow_dispatch context');
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('publication plan is required');
  }
  if (plan.action !== 'publish') {
    throw new Error('workflow dispatch publication authorization requires a publish plan');
  }
  const articleId = requireString(plan.articleId, 'publication plan articleId');
  if (!Array.isArray(plan.variants) || plan.variants.length === 0) {
    throw new Error('publication plan must contain required LocaleVariant plans');
  }

  const sourceFingerprints = {};
  for (const variant of plan.variants) {
    const locale = requireString(variant?.locale, 'publication plan locale');
    if (Object.hasOwn(sourceFingerprints, locale)) {
      throw new Error(`publication plan contains duplicate locale: ${locale}`);
    }
    if (!SOURCE_FINGERPRINT_RE.test(variant?.sourceFingerprint ?? '')) {
      throw new Error(`publication plan source fingerprint is invalid for locale: ${locale}`);
    }
    sourceFingerprints[locale] = variant.sourceFingerprint;
  }

  return {
    version: ARTICLE_PUBLICATION_AUTHORIZATION_VERSION,
    kind: 'explicit-production-publication',
    articleId,
    sourceFingerprints
  };
}
