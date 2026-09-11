import path from 'node:path';
import {
  assertManagedAndUnchanged,
  replacePublisherTags,
  snapshotHash,
  sourceTagForPath
} from './post.mjs';
import { createHtmlCardLexical } from './lexical.mjs';
import { assertDesiredSlugAvailable, assertMutationApplied } from './publish-guards.mjs';

function desiredStatusForAction(action) {
  if (!['draft', 'publish'].includes(action)) throw new Error('action must be draft or publish');
  return action === 'publish' ? 'published' : 'draft';
}

async function assertExclusiveSourceIdentity(client, sourceTag, postId) {
  const matches = await client.getPostsBySourceTag(sourceTag);
  if (matches.length !== 1 || matches[0]?.id !== postId) {
    throw new Error('Ghost source identity ownership changed during synchronization; refusing sync stamp');
  }
}

async function assertSourceIdentityStableBeforeMutation(client, sourceTag, existing) {
  const matches = await client.getPostsBySourceTag(sourceTag);
  if (!existing) {
    if (matches.length !== 0) {
      throw new Error('Ghost source identity ownership changed before mutation; refusing write');
    }
    return;
  }

  if (matches.length !== 1 || matches[0]?.id !== existing.id) {
    throw new Error('Ghost source identity ownership changed before mutation; refusing write');
  }
  assertManagedAndUnchanged(matches[0], sourceTag);
  if (matches[0]?.updated_at !== existing.updated_at) {
    throw new Error('Ghost managed post changed before mutation; refusing stale write');
  }
}

async function inspectSynchronization({ source, action, client, repoRoot, renderMarkdown }) {
  const desiredStatus = desiredStatusForAction(action);
  if (typeof renderMarkdown !== 'function') throw new Error('renderMarkdown function is required');
  if (source.metadata.status !== desiredStatus) {
    throw new Error(`frontmatter status=${source.metadata.status} does not match requested action=${action}`);
  }

  const html = await renderMarkdown(source.markdown, { postPath: source.postPath, repoRoot });
  const lexical = createHtmlCardLexical(html);
  const sourceTag = sourceTagForPath(source.postPath, repoRoot);
  const identityMatches = await client.getPostsBySourceTag(sourceTag);
  if (identityMatches.length > 1) throw new Error('multiple Ghost posts claim the same ox0 source identity');
  const existing = identityMatches[0] ?? null;

  if (action === 'draft' && existing?.status === 'published') {
    throw new Error('draft sync refuses to unpublish an existing published Ghost post');
  }
  if (existing) assertManagedAndUnchanged(existing, sourceTag);

  await assertDesiredSlugAvailable(client, source.metadata.slug, existing);

  const oldSyncTags = existing
    ? (existing.tags ?? []).map((tag) => typeof tag === 'string' ? tag : tag.name).filter((name) => name?.startsWith('#ox0-sync:'))
    : [];

  const payload = {
    title: source.metadata.title,
    slug: source.metadata.slug,
    lexical,
    custom_excerpt: source.metadata.excerpt,
    tags: [...source.metadata.tags, sourceTag, ...oldSyncTags],
    feature_image: source.metadata.featureImage,
    feature_image_alt: source.metadata.featureImageAlt,
    featured: source.metadata.featured,
    visibility: source.metadata.visibility,
    canonical_url: source.metadata.canonicalUrl,
    status: desiredStatus
  };

  return {
    desiredStatus,
    existing,
    sourceTag,
    payload,
    renderedHtmlBytes: Buffer.byteLength(html, 'utf8')
  };
}

export async function planPostSynchronization(args) {
  const { source, repoRoot } = args;
  const inspected = await inspectSynchronization(args);
  let featureImage;
  if (!source.metadata.featureImage) {
    featureImage = { action: 'none' };
  } else if (/^https:\/\//.test(source.metadata.featureImage)) {
    featureImage = { action: 'reuse', url: source.metadata.featureImage };
  } else {
    featureImage = {
      action: 'upload',
      ref: path.relative(repoRoot, source.metadata.featureImage).replaceAll(path.sep, '/')
    };
  }

  return {
    operation: inspected.existing ? 'update' : 'create',
    existingPostId: inspected.existing?.id ?? null,
    sourceIdentity: inspected.sourceTag,
    title: source.metadata.title,
    slug: source.metadata.slug,
    currentStatus: inspected.existing?.status ?? null,
    desiredStatus: inspected.desiredStatus,
    tags: [...source.metadata.tags],
    featureImage,
    renderedHtmlBytes: inspected.renderedHtmlBytes
  };
}

export async function synchronizePost(args) {
  const { source, client, repoRoot } = args;
  const inspected = await inspectSynchronization(args);
  let featureImage = source.metadata.featureImage;
  if (featureImage && !/^https:\/\//.test(featureImage)) {
    const ref = path.relative(repoRoot, featureImage).replaceAll(path.sep, '/');
    const uploaded = await client.uploadImage(featureImage, ref);
    featureImage = uploaded.url;
    await assertDesiredSlugAvailable(client, source.metadata.slug, inspected.existing);
  }
  await assertSourceIdentityStableBeforeMutation(client, inspected.sourceTag, inspected.existing);

  const payload = { ...inspected.payload, feature_image: featureImage };
  let changed;
  if (inspected.existing) {
    payload.updated_at = inspected.existing.updated_at;
    changed = await client.updatePost(inspected.existing.id, payload);
  } else {
    changed = await client.createPost(payload);
  }

  const fresh = await client.getPostById(changed.id);
  assertMutationApplied(fresh, payload);
  await assertDesiredSlugAvailable(client, source.metadata.slug, fresh);
  await assertExclusiveSourceIdentity(client, inspected.sourceTag, fresh.id);

  const hash = snapshotHash(fresh);
  const stamped = await client.updatePostMetadata(fresh.id, {
    tags: replacePublisherTags(fresh.tags, inspected.sourceTag, hash),
    updated_at: fresh.updated_at
  });
  assertManagedAndUnchanged(stamped, inspected.sourceTag);

  const final = await client.getPostById(fresh.id);
  assertManagedAndUnchanged(final, inspected.sourceTag);
  await assertDesiredSlugAvailable(client, source.metadata.slug, final);
  await assertExclusiveSourceIdentity(client, inspected.sourceTag, final.id);
  return final;
}
