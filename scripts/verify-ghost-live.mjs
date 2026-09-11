#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { GhostAdminClient } from '../src/ghost-client.mjs';
import { createHtmlCardLexical } from '../src/lexical.mjs';
import { renderMarkdown } from '../src/markdown.mjs';
import { snapshotHash, sourceTagForPath, SYNC_TAG_PREFIX } from '../src/post.mjs';
import { synchronizePost } from '../src/publisher.mjs';

if (process.env.OX0_GHOST_LIVE_VERIFY !== '1') {
  throw new Error('live Ghost verification is mutating; set OX0_GHOST_LIVE_VERIFY=1 to opt in explicitly');
}

const url = process.env.GHOST_ADMIN_URL;
const key = process.env.GHOST_ADMIN_API_KEY;
if (!url || !key) throw new Error('GHOST_ADMIN_URL and GHOST_ADMIN_API_KEY are required');

const repoRoot = process.cwd();
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const slug = `ox0-live-verify-${suffix}`;
const renamedSlug = `${slug}-renamed`;
const pageSlug = `${slug}-page-collision`;
const postTitle = `ox0 live verification ${suffix}`;
const pageTitle = `ox0 live page collision ${suffix}`;
const sourcePath = path.join(repoRoot, 'posts', `.ox0-live-verify-${suffix}.md`);
const collisionSourcePath = path.join(repoRoot, 'posts', `.ox0-live-verify-page-${suffix}.md`);
const sourceTag = sourceTagForPath(sourcePath, repoRoot);
const authorTags = [`ox0-live-a-${suffix}`, `ox0-live-b-${suffix}`];
const sourceMarkdown = `# Temporary Ghost integration verification\n\nRun: ${suffix}\n`;
const renderedHtml = renderMarkdown(sourceMarkdown);
const lexical = createHtmlCardLexical(renderedHtml);
const client = new GhostAdminClient({ url, key });

function expectedSyncTagForSlug(publicSlug) {
  const hash = snapshotHash({
    title: postTitle,
    slug: publicSlug,
    lexical,
    custom_excerpt: null,
    feature_image: null,
    feature_image_alt: null,
    featured: false,
    visibility: 'public',
    status: 'draft',
    canonical_url: null,
    tags: authorTags.map((name) => ({ name }))
  });
  return `${SYNC_TAG_PREFIX}${hash}`;
}

const expectedInitialSyncTag = expectedSyncTagForSlug(slug);
const expectedRenamedSyncTag = expectedSyncTagForSlug(renamedSlug);
const ownedTagNames = new Set([
  ...authorTags,
  sourceTag,
  expectedInitialSyncTag,
  expectedRenamedSyncTag
]);
const cleanupTagNames = new Set(ownedTagNames);
const cleanupTagIds = new Map();
let knownPostId = null;
let knownPageId = null;
let primaryError = null;
let successSummary = null;
let ownsTemporaryNamespace = false;

function source(postPath, publicSlug) {
  return {
    postPath,
    markdown: sourceMarkdown,
    metadata: {
      title: postTitle,
      slug: publicSlug,
      status: 'draft',
      excerpt: null,
      tags: [...authorTags],
      featureImage: null,
      featureImageAlt: null,
      featured: false,
      visibility: 'public',
      canonicalUrl: null
    }
  };
}

function rememberTags(post) {
  for (const tag of post?.tags ?? []) {
    const name = typeof tag === 'string' ? tag : tag?.name;
    if (!name) continue;
    if (name.startsWith(SYNC_TAG_PREFIX) && !ownedTagNames.has(name)) {
      throw new Error(`temporary verification post has unexpected sync tag; refusing cleanup ownership: ${name}`);
    }
    if (!ownedTagNames.has(name)) continue;

    cleanupTagNames.add(name);
    const id = typeof tag === 'object' ? tag?.id : null;
    if (!id) continue;
    const knownId = cleanupTagIds.get(name);
    if (knownId && knownId !== id) {
      throw new Error(`temporary verification tag changed identity: ${name}`);
    }
    cleanupTagIds.set(name, id);
  }
}

function nqlString(value) {
  return `'${value.replace(/(['"])/g, '\\$1')}'`;
}

async function findExactTag(name) {
  const payload = await client.request('tags/', {
    query: { filter: `name:${nqlString(name)}`, limit: 2 }
  });
  const matches = (payload?.tags ?? []).filter((tag) => tag?.name === name);
  if (matches.length > 1) throw new Error(`multiple Ghost tags found during cleanup/verification: ${name}`);
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

async function assertOwnedTemporaryPageById(id) {
  let page;
  try {
    const payload = await client.request(`pages/${encodeURIComponent(id)}/`, {
      query: { formats: 'lexical' }
    });
    page = payload?.pages?.[0] ?? null;
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }

  if (
    !page || page.id !== id || page.title !== pageTitle || page.slug !== pageSlug ||
    page.lexical !== lexical || page.status !== 'draft'
  ) {
    throw new Error('temporary page id resolves to unexpected page state; refusing cleanup');
  }
  return page;
}

async function assertOwnedTemporaryPostById(id) {
  let post;
  try {
    post = await client.getPostById(id);
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }

  const tagNames = (post?.tags ?? [])
    .map((tag) => typeof tag === 'string' ? tag : tag?.name)
    .filter(Boolean);
  const allowedTitles = new Set([postTitle, `${postTitle} manual-drift`]);
  const allowedSlugs = new Set([slug, renamedSlug]);
  const sourceClaims = tagNames.filter((name) => name === sourceTag);

  if (
    !post || post.id !== id || !allowedTitles.has(post.title) || !allowedSlugs.has(post.slug) ||
    post.lexical !== lexical || post.status !== 'draft' || sourceClaims.length !== 1
  ) {
    throw new Error('temporary post id resolves to unexpected post state; refusing cleanup');
  }
  return post;
}

async function assertResourceMissingById(resource, id) {
  try {
    await client.request(`${resource}/${encodeURIComponent(id)}/`, {
      query: resource === 'tags' ? undefined : { formats: 'lexical' }
    });
  } catch (error) {
    if (error?.status === 404) return;
    throw error;
  }
  throw new Error(`temporary Ghost ${resource.slice(0, -1)} still exists after cleanup: ${id}`);
}

async function assertTagUnreferenced(tag) {
  if (!tag?.slug) throw new Error('temporary verification tag is missing a slug during cleanup');
  const [posts, pagesPayload] = await Promise.all([
    client.getPostsByTagSlug(tag.slug),
    client.request('pages/', { query: { filter: `tag:${tag.slug}`, limit: 2 } })
  ]);
  const pages = pagesPayload?.pages ?? [];
  if (posts.length || pages.length) {
    throw new Error(`temporary verification tag is still referenced; refusing cleanup: ${tag.name}`);
  }
}

async function assertTemporaryNamespaceUnused() {
  for (const name of cleanupTagNames) {
    assert.equal(await findExactTag(name), null, `temporary verification tag already exists: ${name}`);
  }
  for (const candidateSlug of [slug, renamedSlug, pageSlug]) {
    assert.equal(await client.getPostBySlug(candidateSlug), null, `temporary verification post slug already exists: ${candidateSlug}`);
    assert.equal(await client.getPageBySlug(candidateSlug), null, `temporary verification page slug already exists: ${candidateSlug}`);
  }
}

async function recoverPost() {
  const byIdentity = await client.getPostsBySourceTag(sourceTag);
  if (byIdentity.length > 1) throw new Error('multiple live-verification posts claim the temporary source identity');
  const post = byIdentity[0] ?? null;
  if (!post) return null;
  if (
    post.title !== postTitle || ![slug, renamedSlug].includes(post.slug) ||
    post.lexical !== lexical || post.status !== 'draft'
  ) {
    throw new Error('temporary source identity resolves to unexpected post state; refusing cleanup');
  }
  return post;
}

async function ignoreMissingDelete(resource) {
  try {
    await client.request(resource, { method: 'DELETE' });
  } catch (error) {
    if (error?.status !== 404) throw error;
  }
}

async function cleanup() {
  if (!ownsTemporaryNamespace) return [];

  const errors = [];
  let postCleanupSafeForTags = false;

  if (!knownPageId) {
    try {
      const unresolvedPage = await client.getPageBySlug(pageSlug);
      if (unresolvedPage) {
        throw new Error('temporary page exists without a proven owned id; refusing slug-only cleanup; manual reconciliation required');
      }
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    if (!knownPostId) {
      const recovered = await recoverPost();
      if (recovered) {
        knownPostId = recovered.id;
        rememberTags(recovered);
      } else {
        postCleanupSafeForTags = true;
      }
    }
  } catch (error) {
    errors.push(error);
  }

  if (knownPageId) {
    try {
      const ownedPage = await assertOwnedTemporaryPageById(knownPageId);
      if (ownedPage) {
        await ignoreMissingDelete(`pages/${encodeURIComponent(knownPageId)}/`);
        await assertResourceMissingById('pages', knownPageId);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (knownPostId) {
    try {
      const ownedPost = await assertOwnedTemporaryPostById(knownPostId);
      if (!ownedPost) {
        knownPostId = null;
        postCleanupSafeForTags = true;
      } else {
        rememberTags(ownedPost);
        await ignoreMissingDelete(`posts/${encodeURIComponent(knownPostId)}/`);
        await assertResourceMissingById('posts', knownPostId);
        postCleanupSafeForTags = true;
      }
    } catch (error) {
      errors.push(error);
    }
  }

  if (postCleanupSafeForTags) {
    for (const name of cleanupTagNames) {
      try {
        const tagId = cleanupTagIds.get(name);
        if (!tagId) {
          const unresolved = await findExactTag(name);
          if (unresolved) {
            throw new Error(`temporary verification tag exists without a proven owned id; refusing cleanup: ${name}`);
          }
          continue;
        }

        const tag = await getTagById(tagId);
        if (!tag) continue;
        if (tag.name !== name) {
          throw new Error(`temporary verification tag name changed; refusing cleanup: ${name}`);
        }
        await assertTagUnreferenced(tag);
        await ignoreMissingDelete(`tags/${encodeURIComponent(tagId)}/`);
        await assertResourceMissingById('tags', tagId);
      } catch (error) {
        errors.push(error);
      }
    }
  }
  return errors;
}

try {
  await assertTemporaryNamespaceUnused();
  ownsTemporaryNamespace = true;

  const first = await synchronizePost({
    source: source(sourcePath, slug),
    action: 'draft',
    client,
    repoRoot,
    renderMarkdown
  });
  knownPostId = first.id;
  rememberTags(first);
  assert.equal(first.status, 'draft');
  assert.equal(first.slug, slug);
  assert.equal(first.lexical, lexical);

  const firstNames = first.tags.map((tag) => typeof tag === 'string' ? tag : tag.name);
  assert.deepEqual(firstNames.slice(0, 2), authorTags);
  assert.equal(firstNames.at(-2), sourceTag);
  assert.equal(firstNames.at(-1), expectedInitialSyncTag);

  const sourceIdentityTag = await findExactTag(sourceTag);
  assert.ok(sourceIdentityTag?.id, 'temporary source identity tag was not created');
  const rememberedSourceTagId = cleanupTagIds.get(sourceTag);
  if (rememberedSourceTagId && rememberedSourceTagId !== sourceIdentityTag.id) {
    throw new Error('temporary source identity tag id disagrees with persisted tag');
  }
  cleanupTagIds.set(sourceTag, sourceIdentityTag.id);
  const driftedTagSlug = `ox0-live-source-${suffix}`;
  await client.request(`tags/${encodeURIComponent(sourceIdentityTag.id)}/`, {
    method: 'PUT',
    body: { tags: [{ slug: driftedTagSlug }] }
  });
  const driftedSourceIdentityTag = await findExactTag(sourceTag);
  assert.equal(driftedSourceIdentityTag?.id, sourceIdentityTag.id, 'source identity tag changed identity after slug edit');
  assert.equal(driftedSourceIdentityTag?.slug, driftedTagSlug, 'Ghost did not persist source identity tag slug drift');

  const afterTagSlugDrift = await client.getPostsBySourceTag(sourceTag);
  assert.equal(afterTagSlugDrift.length, 1);
  assert.equal(afterTagSlugDrift[0].id, first.id);

  const renamed = await synchronizePost({
    source: source(sourcePath, renamedSlug),
    action: 'draft',
    client,
    repoRoot,
    renderMarkdown
  });
  rememberTags(renamed);
  assert.equal(renamed.id, first.id);
  assert.equal(renamed.slug, renamedSlug);
  assert.equal(renamed.lexical, lexical);
  const renamedNames = renamed.tags.map((tag) => typeof tag === 'string' ? tag : tag.name);
  assert.deepEqual(renamedNames.slice(0, 2), authorTags);
  assert.equal(renamedNames.at(-2), sourceTag);
  assert.equal(renamedNames.at(-1), expectedRenamedSyncTag);

  const pagePayload = await client.request('pages/', {
    method: 'POST',
    query: { formats: 'lexical' },
    body: {
      pages: [{
        title: pageTitle,
        slug: pageSlug,
        lexical,
        status: 'draft'
      }]
    }
  });
  const createdPage = pagePayload?.pages?.[0] ?? null;
  knownPageId = createdPage?.id ?? null;
  assert.ok(knownPageId, 'temporary Ghost page was not created');
  assert.equal(createdPage.title, pageTitle, 'Ghost changed temporary page title on create');
  assert.equal(createdPage.slug, pageSlug, 'Ghost changed temporary page slug on create');
  assert.equal(createdPage.lexical, lexical, 'Ghost changed temporary page Lexical body on create');
  assert.equal(createdPage.status, 'draft', 'Ghost changed temporary page status on create');

  const persistedPagePayload = await client.request(`pages/${encodeURIComponent(knownPageId)}/`, {
    query: { formats: 'lexical' }
  });
  const persistedPage = persistedPagePayload?.pages?.[0] ?? null;
  assert.ok(persistedPage, 'temporary Ghost page could not be read back by id');
  assert.equal(persistedPage.id, knownPageId);
  assert.equal(persistedPage.title, pageTitle, 'persisted temporary page title changed');
  assert.equal(persistedPage.slug, pageSlug, 'persisted temporary page slug changed');
  assert.equal(persistedPage.lexical, lexical, 'persisted temporary page Lexical body changed');
  assert.equal(persistedPage.status, 'draft', 'persisted temporary page status changed');

  await assert.rejects(
    synchronizePost({
      source: source(collisionSourcePath, pageSlug),
      action: 'draft',
      client,
      repoRoot,
      renderMarkdown
    }),
    /occupied by a page/
  );
  assert.equal(await client.getPostBySlug(pageSlug), null);

  const drifted = await client.updatePost(renamed.id, {
    title: `${renamed.title} manual-drift`,
    updated_at: renamed.updated_at
  });
  rememberTags(drifted);

  await assert.rejects(
    synchronizePost({
      source: source(sourcePath, renamedSlug),
      action: 'draft',
      client,
      repoRoot,
      renderMarkdown
    }),
    /changed outside ox0-blog/
  );

  successSummary = {
    result: 'PASS',
    postId: knownPostId,
    sourceTag,
    checks: [
      'temporary namespace ownership preflight including expected sync tags',
      'pinned Markdown render + draft create + direct Lexical fresh-read verification',
      'author/publisher tag ordering and exact sync stamps',
      'persisted source-tag slug drift resolved by canonical source-tag name',
      'managed public-slug rename',
      'exact page create/fresh-read state + page slug collision rejection',
      'manual managed-field drift rejected before overwrite',
      'ID-bound post/page/tag cleanup ownership with persisted absence checks'
    ]
  };
} catch (error) {
  primaryError = error;
}

const cleanupErrors = await cleanup();
if (primaryError) {
  if (cleanupErrors.length) primaryError.cleanupErrors = cleanupErrors;
  throw primaryError;
}
if (cleanupErrors.length) {
  throw new AggregateError(cleanupErrors, 'live Ghost verification passed but cleanup failed');
}
console.log(JSON.stringify(successSummary, null, 2));