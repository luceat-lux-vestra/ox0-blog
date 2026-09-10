import path from 'node:path';
import {
  assertManagedAndUnchanged,
  replacePublisherTags,
  snapshotHash,
  sourceTagForPath
} from './post.mjs';
import { createHtmlCardLexical } from './lexical.mjs';
import { assertDesiredSlugAvailable, assertMutationApplied } from './publish-guards.mjs';

async function assertExclusiveSourceIdentity(client, sourceTag, postId) {
  const matches = await client.getPostsBySourceTag(sourceTag);
  if (matches.length !== 1 || matches[0]?.id !== postId) {
    throw new Error('Ghost source identity ownership changed during synchronization; refusing sync stamp');
  }
}

export async function synchronizePost({ source, action, client, repoRoot, renderMarkdown }) {
  if (!['draft', 'publish'].includes(action)) throw new Error('action must be draft or publish');
  if (typeof renderMarkdown !== 'function') throw new Error('renderMarkdown function is required');

  const desiredStatus = action === 'publish' ? 'published' : 'draft';
  if (source.metadata.status !== desiredStatus) {
    throw new Error(`frontmatter status=${source.metadata.status} does not match requested action=${action}`);
  }

  const html = renderMarkdown(source.markdown);
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

  let featureImage = source.metadata.featureImage;
  if (featureImage && !/^https:\/\//.test(featureImage)) {
    const ref = path.relative(repoRoot, featureImage).replaceAll(path.sep, '/');
    const uploaded = await client.uploadImage(featureImage, ref);
    featureImage = uploaded.url;
  }

  const publicTags = source.metadata.tags;
  const oldSyncTags = existing
    ? (existing.tags ?? []).map((tag) => typeof tag === 'string' ? tag : tag.name).filter((name) => name?.startsWith('#ox0-sync:'))
    : [];

  const payload = {
    title: source.metadata.title,
    slug: source.metadata.slug,
    lexical,
    custom_excerpt: source.metadata.excerpt,
    tags: [...publicTags, sourceTag, ...oldSyncTags],
    feature_image: featureImage,
    feature_image_alt: source.metadata.featureImageAlt,
    featured: source.metadata.featured,
    visibility: source.metadata.visibility,
    canonical_url: source.metadata.canonicalUrl,
    status: desiredStatus
  };

  let changed;
  if (existing) {
    payload.updated_at = existing.updated_at;
    changed = await client.updatePost(existing.id, payload);
  } else {
    changed = await client.createPost(payload);
  }

  const fresh = await client.getPostById(changed.id);
  assertMutationApplied(fresh, payload);
  await assertDesiredSlugAvailable(client, source.metadata.slug, fresh);
  await assertExclusiveSourceIdentity(client, sourceTag, fresh.id);

  const hash = snapshotHash(fresh);
  const stamped = await client.updatePostMetadata(fresh.id, {
    tags: replacePublisherTags(fresh.tags, sourceTag, hash),
    updated_at: fresh.updated_at
  });
  assertManagedAndUnchanged(stamped, sourceTag);

  const final = await client.getPostById(fresh.id);
  assertManagedAndUnchanged(final, sourceTag);
  await assertDesiredSlugAvailable(client, source.metadata.slug, final);
  await assertExclusiveSourceIdentity(client, sourceTag, final.id);
  return final;
}
