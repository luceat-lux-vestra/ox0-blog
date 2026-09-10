#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { GhostAdminClient } from '../src/ghost-client.mjs';
import { createHtmlCardLexical } from '../src/lexical.mjs';
import { renderMarkdown } from '../src/markdown.mjs';
import { sourceTagForPath, SYNC_TAG_PREFIX } from '../src/post.mjs';
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
const cleanupTagNames = new Set([...authorTags, sourceTag]);
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
    if (name && (authorTags.includes(name) || name === sourceTag || name.startsWith(SYNC_TAG_PREFIX))) {
      cleanupTagNames.add(name);
    }
  }
}

function nqlString(value) {
  return `'${value.replace(/(['"])/g, '\\$1')}'`;
}

async function findExactTag(name) {
  const payload = await client.request('tags/', {
    query: { filter: `tags.name:${nqlString(name)}`, limit: 2 }
  });
  const matches = (payload?.tags ?? []).filter((tag) => tag?.name === name);
  if (matches.length > 1) throw new Error(`multiple Ghost tags found during cleanup/verification: ${name}`);
  return matches[0] ?? null;
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
  if (post.title !== postTitle || post.lexical !== lexical || post.status !== 'draft') {
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

  try {
    if (!knownPageId) {
      const recoveredPage = await client.getPageBySlug(pageSlug);
      if (recoveredPage?.id) {
        if (recoveredPage.title !== pageTitle || recoveredPage.lexical !== lexical || recoveredPage.status !== 'draft') {
          throw new Error('temporary page slug resolves to unexpected page state; refusing cleanup');
        }
        knownPageId = recoveredPage.id;
      }
    }
  } catch (error) {
    errors.push(error);
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
    } else {
      try {
        const recovered = await client.getPostById(knownPostId);
        if (recovered) rememberTags(recovered);
      } catch (error) {
        if (error?.status === 404) {
          knownPostId = null;
          postCleanupSafeForTags = true;
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    errors.push(error);
  }

  if (knownPageId) {
    try { await ignoreMissingDelete(`pages/${encodeURIComponent(knownPageId)}/`); } catch (error) { errors.push(error); }
  }
  if (knownPostId) {
    try {
      await ignoreMissingDelete(`posts/${encodeURIComponent(knownPostId)}/`);
      postCleanupSafeForTags = true;
    } catch (error) {
      errors.push(error);
    }
  }

  if (postCleanupSafeForTags) {
    for (const name of cleanupTagNames) {
      try {
        const tag = await findExactTag(name);
        if (tag?.id) await ignoreMissingDelete(`tags/${encodeURIComponent(tag.id)}/`);
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
  assert.match(firstNames.at(-1), /^#ox0-sync:[a-f0-9]{64}$/);

  const sourceIdentityTag = await findExactTag(sourceTag);
  assert.ok(sourceIdentityTag?.id, 'temporary source identity tag was not created');
  const driftedTagSlug = `ox0-live-source-${suffix}`;
  await client.request(`tags/${encodeURIComponent(sourceIdentityTag.id)}/`, {
    method: 'PUT',
    body: { tags: [{ slug: driftedTagSlug }] }
  });

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
  assert.match(renamedNames.at(-1), /^#ox0-sync:[a-f0-9]{64}$/);

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
  knownPageId = pagePayload?.pages?.[0]?.id ?? null;
  assert.ok(knownPageId, 'temporary Ghost page was not created');

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
      'temporary namespace ownership preflight',
      'pinned Markdown render + draft create + direct Lexical fresh-read verification',
      'author/publisher tag ordering and sync stamp',
      'source-tag slug drift resolved by canonical source-tag name',
      'managed public-slug rename',
      'page slug collision rejected before post creation',
      'manual managed-field drift rejected before overwrite'
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
