#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { synchronizeArticlePublication } from '../src/article-publication.mjs';
import { evaluateArticleBundle } from '../src/article-evaluation.mjs';
import { loadArticleManifest } from '../src/article-manifest.mjs';
import { ARTICLE_READINESS_REVIEW_CONTRACT_VERSION } from '../src/article-readiness.mjs';
import {
  acceptArticleSemanticReview,
  acceptArticleTranslationReview,
  requestArticleSemanticReview
} from '../src/article-review-operations.mjs';
import { requireArticleLiveDraftContext } from '../src/article-live-draft-guard.mjs';
import { MarkedCompiler } from '../src/compiler/marked-compiler.mjs';
import { GhostAdminClient } from '../src/ghost-client.mjs';
import { projectionIdentityTags } from '../src/projection-identity.mjs';
import { projectionLookupTag } from '../src/projection-managed-state.mjs';
import { TRANSLATION_REVIEW_CONTRACT_VERSION } from '../src/translation-checkpoint.mjs';

const repoRoot = process.cwd();

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

const context = requireArticleLiveDraftContext({
  verifyOptIn: process.env.OX0_ARTICLE_DRAFT_VERIFY,
  expectedSourceSha: process.env.OX0_ARTICLE_SOURCE_SHA,
  actualHeadSha: git('rev-parse', 'HEAD'),
  worktreeStatus: git('status', '--porcelain', '--untracked-files=all'),
  ghostAdminUrl: process.env.GHOST_ADMIN_URL,
  expectedGhostUrl: process.env.OX0_ARTICLE_EXPECTED_URL,
  hostRuntimeModule: process.env.OX0_HOST_RUNTIME_MODULE ?? null
});

const key = process.env.GHOST_ADMIN_API_KEY;
if (!key) throw new Error('GHOST_ADMIN_API_KEY is required');

const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const articleId = `ox0-live-draft-verify-${suffix}`;
const reviewId = randomUUID();
const articleDir = path.join(repoRoot, 'posts', `ox0-live-draft-verify-${suffix}`);
const manifestPath = path.join(articleDir, 'article.json');
const variants = [
  {
    variantId: `ox0-live-draft-verify-ko-${suffix}`,
    locale: 'ko-KR',
    source: 'ko-KR.md',
    title: `ox0 live draft verification ko ${suffix}`,
    excerpt: 'temporary live draft verification',
    slug: `ox0-live-draft-verify-${suffix}-ko`
  },
  {
    variantId: `ox0-live-draft-verify-en-${suffix}`,
    locale: 'en',
    source: 'en.md',
    title: `ox0 live draft verification en ${suffix}`,
    excerpt: 'temporary live draft verification',
    slug: `ox0-live-draft-verify-${suffix}-en`
  }
];
const client = new GhostAdminClient({ url: context.ghostUrl, key });
const knownPostIds = new Map();
const cleanupTagIds = new Map();
let ownsTemporaryNamespace = false;
let primaryError = null;
let successSummary = null;

function publication() {
  return {
    tags: [],
    featureImage: null,
    featureImageAlt: null,
    featured: false,
    visibility: 'public',
    canonicalUrl: null
  };
}

function manifest() {
  return {
    version: 1,
    articleId,
    requiredLocales: variants.map((variant) => variant.locale),
    variants: variants.map((variant) => ({ ...variant, publication: publication() })),
    translationCheckpoint: null,
    readiness: { epoch: 0, checkpoint: null, invalidations: [] }
  };
}

async function currentEvaluation() {
  const loaded = await loadArticleManifest({ manifestPath, repoRoot });
  return evaluateArticleBundle({
    bundle: loaded.bundle,
    compiler: new MarkedCompiler(),
    repoRoot,
    publicationByLocale: loaded.publicationByLocale
  });
}

async function makeFixtureReady() {
  const initial = await currentEvaluation();
  const translation = await acceptArticleTranslationReview({
    manifestPath,
    repoRoot,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION,
      reviewedFingerprints: initial.currentTranslationFingerprints
    }
  });
  await writeFile(manifestPath, translation.manifestText, 'utf8');

  const requested = await requestArticleSemanticReview({
    manifestPath,
    repoRoot,
    id: reviewId,
    origin: 'blog-audit',
    reference: context.sourceSha
  });
  await writeFile(manifestPath, requested.manifestText, 'utf8');

  const beforeAcceptance = await currentEvaluation();
  const accepted = await acceptArticleSemanticReview({
    manifestPath,
    repoRoot,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
      reviewedSourceFingerprint: beforeAcceptance.articleSourceFingerprint,
      reviewedInvalidationIds: [reviewId]
    }
  });
  await writeFile(manifestPath, accepted.manifestText, 'utf8');

  const ready = await currentEvaluation();
  assert.equal(ready.translation.state, 'SYNCED');
  assert.equal(ready.readiness.state, 'READY');
}

function nqlString(value) {
  return `'${value.replace(/(['"])/g, '\\$1')}'`;
}

async function findExactTag(name) {
  const payload = await client.request('tags/', {
    query: { filter: `name:${nqlString(name)}`, limit: 2 }
  });
  const matches = (payload?.tags ?? []).filter((tag) => tag?.name === name);
  if (matches.length > 1) throw new Error(`multiple Ghost tags have exact name: ${name}`);
  return matches[0] ?? null;
}

async function getTagById(id) {
  try {
    const payload = await client.request(`tags/${encodeURIComponent(id)}/`);
    return payload?.tags?.[0] ?? null;
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function postByIdOrNull(id) {
  try {
    return await client.getPostById(id);
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

function tagNames(post) {
  return (post?.tags ?? [])
    .map((tag) => typeof tag === 'string' ? tag : tag?.name)
    .filter(Boolean);
}

function expectedIdentity(variant) {
  return projectionIdentityTags({
    articleId,
    variantId: variant.variantId,
    locale: variant.locale
  });
}

function rememberCleanupTag(name, id) {
  if (!id) return;
  const prior = cleanupTagIds.get(name);
  if (prior && prior !== id) throw new Error(`temporary verifier tag changed identity: ${name}`);
  cleanupTagIds.set(name, id);
}

async function assertOwnedPost(id, variant, allowedStatuses) {
  const post = await postByIdOrNull(id);
  if (!post) return null;
  const names = tagNames(post);
  const expected = expectedIdentity(variant);
  if (
    post.id !== id
    || post.title !== variant.title
    || post.slug !== variant.slug
    || !allowedStatuses.includes(post.status)
    || expected.some((name) => !names.includes(name))
  ) {
    throw new Error(`temporary live-draft post no longer matches verifier ownership for locale ${variant.locale}; refusing cleanup`);
  }
  return post;
}

async function recoverOwnedPost(variant, allowedStatuses = ['draft', 'published']) {
  const lookupTag = projectionLookupTag(expectedIdentity(variant));
  const matches = await client.getPostsBySourceTag(lookupTag);
  if (matches.length > 1) {
    throw new Error(`multiple posts claim verifier identity for locale ${variant.locale}; refusing cleanup`);
  }
  if (matches.length === 0) return null;
  return assertOwnedPost(matches[0].id, variant, allowedStatuses);
}

async function rememberCleanupTags(post) {
  for (const name of tagNames(post)) {
    if (!name.startsWith('#ox0-') || name.startsWith('#ox0-locale-')) continue;
    const tag = await findExactTag(name);
    rememberCleanupTag(name, tag?.id);
  }
}

async function rememberExpectedIdentityTags() {
  for (const variant of variants) {
    for (const name of expectedIdentity(variant)) {
      if (name.startsWith('#ox0-locale-')) continue;
      const tag = await findExactTag(name);
      rememberCleanupTag(name, tag?.id);
    }
  }
}

async function assertNamespaceUnused() {
  for (const variant of variants) {
    assert.equal(await client.getPostBySlug(variant.slug), null, `temporary post slug already exists: ${variant.slug}`);
    assert.equal(await client.getPageBySlug(variant.slug), null, `temporary page slug already exists: ${variant.slug}`);
    for (const name of expectedIdentity(variant)) {
      if (name.startsWith('#ox0-locale-')) continue;
      assert.equal(await findExactTag(name), null, `temporary verifier identity tag already exists: ${name}`);
    }
  }
}

async function deletePostById(id) {
  try {
    await client.request(`posts/${encodeURIComponent(id)}/`, { method: 'DELETE' });
  } catch (error) {
    if (error?.status !== 404) throw error;
  }
  assert.equal(await postByIdOrNull(id), null, `temporary post still exists after cleanup: ${id}`);
}

async function tagReferenceCount(tag) {
  if (!tag?.slug) throw new Error(`temporary tag is missing slug: ${tag?.name ?? '<unknown>'}`);
  const [posts, pagesPayload] = await Promise.all([
    client.getPostsByTagSlug(tag.slug),
    client.request('pages/', { query: { filter: `tag:${tag.slug}`, limit: 2 } })
  ]);
  return posts.length + (pagesPayload?.pages ?? []).length;
}

async function deleteTagIfVerifierOwnedAndUnreferenced(name, id) {
  const tag = await getTagById(id);
  if (!tag) return;
  if (tag.name !== name) throw new Error(`temporary verifier tag name changed; refusing cleanup: ${name}`);
  if (await tagReferenceCount(tag) !== 0) return;
  try {
    await client.request(`tags/${encodeURIComponent(id)}/`, { method: 'DELETE' });
  } catch (error) {
    if (error?.status !== 404) throw error;
  }
  assert.equal(await getTagById(id), null, `temporary verifier tag still exists after cleanup: ${name}`);
}

async function cleanupGhost() {
  if (!ownsTemporaryNamespace) return [];
  const errors = [];
  let postsClean = true;

  for (const variant of variants) {
    try {
      let id = knownPostIds.get(variant.locale) ?? null;
      let owned = id ? await assertOwnedPost(id, variant, ['draft', 'published']) : null;
      if (!id) {
        owned = await recoverOwnedPost(variant);
        id = owned?.id ?? null;
        if (id) knownPostIds.set(variant.locale, id);
      }
      if (owned && id) {
        await rememberCleanupTags(owned);
        await deletePostById(id);
      }
    } catch (error) {
      postsClean = false;
      errors.push(error);
    }
  }

  if (postsClean) {
    try {
      await rememberExpectedIdentityTags();
    } catch (error) {
      errors.push(error);
      return errors;
    }

    for (const [name, id] of cleanupTagIds) {
      try {
        await deleteTagIfVerifierOwnedAndUnreferenced(name, id);
      } catch (error) {
        errors.push(error);
      }
    }
  }
  return errors;
}

async function assertTemporaryNamespaceAbsent() {
  for (const variant of variants) {
    assert.equal(await client.getPostBySlug(variant.slug), null, `temporary verifier slug residue remains: ${variant.slug}`);
    const lookupTag = projectionLookupTag(expectedIdentity(variant));
    assert.deepEqual(
      await client.getPostsBySourceTag(lookupTag),
      [],
      `temporary verifier source identity residue remains: ${lookupTag}`
    );
    for (const name of expectedIdentity(variant)) {
      if (name.startsWith('#ox0-locale-')) continue;
      assert.equal(await findExactTag(name), null, `temporary verifier identity-tag residue remains: ${name}`);
    }
  }
}

try {
  await mkdir(articleDir, { recursive: false });
  await writeFile(path.join(articleDir, 'ko-KR.md'), `# 임시 드래프트 검증\n\n검증 실행: ${suffix}\n`, 'utf8');
  await writeFile(path.join(articleDir, 'en.md'), `# Temporary draft verification\n\nVerification run: ${suffix}\n`, 'utf8');
  await writeFile(manifestPath, `${JSON.stringify(manifest(), null, 2)}\n`, 'utf8');
  await makeFixtureReady();

  await assertNamespaceUnused();
  ownsTemporaryNamespace = true;

  const draft = await synchronizeArticlePublication({
    manifestPath,
    action: 'draft',
    client,
    repoRoot
  });
  assert.equal(draft.status, 'SUCCESS');
  assert.deepEqual(draft.variants.map((entry) => entry.state.state), ['DRAFT_CURRENT', 'DRAFT_CURRENT']);
  for (const entry of draft.variants) {
    assert.ok(entry.postId, `draft result missing post id for ${entry.locale}`);
    knownPostIds.set(entry.locale, entry.postId);
  }

  for (const variant of variants) {
    const post = await assertOwnedPost(knownPostIds.get(variant.locale), variant, ['draft']);
    assert.ok(post, `draft post missing for ${variant.locale}`);
    await rememberCleanupTags(post);
  }

  successSummary = {
    result: 'PASS',
    exactHead: context.sourceSha,
    ghostOrigin: context.ghostUrl,
    articleId,
    checks: [
      'explicit live-draft mutation opt-in',
      'clean exact-candidate git HEAD binding',
      'exact Ghost origin double-entry binding',
      'temporary Article translation checkpoint and readiness review to SYNCED + READY',
      'two-locale managed Ghost draft creation with fresh DRAFT_CURRENT recovery',
      'no publish operation executed',
      'ID/recovered-identity-bound temporary post cleanup and safe unreferenced verifier-tag cleanup',
      'fresh post-cleanup namespace absence verification'
    ]
  };
} catch (error) {
  primaryError = error;
}

const cleanupErrors = await cleanupGhost();
if (ownsTemporaryNamespace) {
  try {
    await assertTemporaryNamespaceAbsent();
  } catch (error) {
    cleanupErrors.push(error);
  }
}
try {
  await rm(articleDir, { recursive: true, force: true });
} catch (error) {
  cleanupErrors.push(error);
}

try {
  const finalStatus = git('status', '--porcelain', '--untracked-files=all');
  if (finalStatus !== '') cleanupErrors.push(new Error('live Article draft verifier left the exact-candidate worktree dirty'));
} catch (error) {
  cleanupErrors.push(error);
}

if (primaryError) {
  if (cleanupErrors.length) primaryError.cleanupErrors = cleanupErrors;
  throw primaryError;
}
if (cleanupErrors.length) {
  throw new AggregateError(cleanupErrors, 'live Article draft verification passed but cleanup failed');
}
console.log(JSON.stringify(successSummary, null, 2));
