import path from 'node:path';
import { requireCompiledDocument } from './compiler/document-compiler.mjs';
import { requireRepositoryAssetFile } from './file-confinement.mjs';
import { createHtmlCardLexical } from './lexical.mjs';
import { sourceTagForPath } from './post.mjs';
import {
  REVISION_TAG_PREFIX,
  assertProjectionManagedAndUnchanged,
  getProjectionSourceFingerprint,
  getProjectionSyncHash,
  normalizeProjectionIdentityTags,
  normalizeSourceFingerprint,
  projectionLookupTag,
  projectionSnapshotHash,
  replaceProjectionPublisherTags
} from './projection-managed-state.mjs';
import { normalizeProjectionMetadata } from './projection-metadata.mjs';
import { assertDesiredSlugAvailable, assertMutationApplied } from './publish-guards.mjs';

function desiredStatusForAction(action) {
  if (!['draft', 'publish'].includes(action)) throw new Error('action must be draft or publish');
  return action === 'publish' ? 'published' : 'draft';
}

function requireProjectionDescriptor(projection) {
  if (!projection || typeof projection !== 'object') throw new Error('projection descriptor is required');
  const identityTags = normalizeProjectionIdentityTags(projection.identityTags);
  if (identityTags.length !== 1 && identityTags.length !== 3) {
    throw new Error('projection identity must be legacy source-only or complete article + locale + variant identity');
  }
  const sourceFingerprint = projection.sourceFingerprint == null
    ? null
    : normalizeSourceFingerprint(projection.sourceFingerprint, 'projection.sourceFingerprint');
  if (identityTags.length === 3 && sourceFingerprint == null) {
    throw new Error('stable Article/LocaleVariant projection requires projection.sourceFingerprint');
  }

  const metadata = normalizeProjectionMetadata({
    title: projection.title,
    slug: projection.slug,
    excerpt: projection.excerpt,
    tags: projection.tags,
    featureImage: projection.featureImage,
    featureImageAlt: projection.featureImageAlt,
    featured: projection.featured,
    visibility: projection.visibility,
    canonicalUrl: projection.canonicalUrl
  });

  return {
    identityTags,
    sourceFingerprint,
    locale: projection.locale ?? null,
    ...metadata
  };
}

async function validateProjectionFilesystem(projection, repoRoot) {
  if (!projection.featureImage || /^https:\/\//.test(projection.featureImage)) return;
  await requireRepositoryAssetFile(projection.featureImage, repoRoot, 'local featureImage');
}

async function assertExclusiveProjectionIdentity(client, lookupTag, projection, postId) {
  const matches = await client.getPostsBySourceTag(lookupTag);
  if (matches.length !== 1 || matches[0]?.id !== postId) {
    throw new Error('Ghost source identity ownership changed during synchronization; projection identity is no longer exclusive; refusing sync stamp');
  }
  assertProjectionManagedAndUnchanged(matches[0], projection.identityTags, {
    requireSourceFingerprint: projection.sourceFingerprint != null
  });
}

async function assertProjectionIdentityStableBeforeMutation(client, lookupTag, projection, existing) {
  const matches = await client.getPostsBySourceTag(lookupTag);
  if (!existing) {
    if (matches.length !== 0) {
      throw new Error('Ghost source identity ownership changed before mutation; projection identity is no longer unowned; refusing write');
    }
    return;
  }

  if (matches.length !== 1 || matches[0]?.id !== existing.id) {
    throw new Error('Ghost source identity ownership changed before mutation; projection identity owner changed; refusing write');
  }
  assertProjectionManagedAndUnchanged(matches[0], projection.identityTags, {
    requireSourceFingerprint: projection.sourceFingerprint != null
  });
  if (matches[0]?.updated_at !== existing.updated_at) {
    throw new Error('Ghost managed projection changed before mutation; refusing stale write');
  }
}

async function inspectProjectionSynchronization({ projection: rawProjection, compiledDocument: rawDocument, action, client, repoRoot }) {
  const desiredStatus = desiredStatusForAction(action);
  const projection = requireProjectionDescriptor(rawProjection);
  const compiledDocument = requireCompiledDocument(rawDocument);
  if (projection.locale != null && compiledDocument.locale !== projection.locale) {
    throw new Error(`CompiledDocument.locale=${compiledDocument.locale} does not match projection.locale=${projection.locale}`);
  }

  await validateProjectionFilesystem(projection, repoRoot);

  const lexical = createHtmlCardLexical(compiledDocument.htmlFragment);
  const lookupTag = projectionLookupTag(projection.identityTags);
  const identityMatches = await client.getPostsBySourceTag(lookupTag);
  if (identityMatches.length > 1) throw new Error('multiple Ghost posts claim the same ox0 source identity / projection identity');
  const existing = identityMatches[0] ?? null;

  if (action === 'draft' && existing?.status === 'published') {
    throw new Error('draft sync refuses to unpublish an existing published Ghost post');
  }
  if (existing) {
    assertProjectionManagedAndUnchanged(existing, projection.identityTags, {
      requireSourceFingerprint: projection.sourceFingerprint != null
    });
  }

  await assertDesiredSlugAvailable(client, projection.slug, existing);

  const oldSourceFingerprint = existing == null ? null : getProjectionSourceFingerprint(existing);
  const oldSyncTag = existing == null ? null : getProjectionSyncHash(existing);
  const tags = [
    ...projection.tags,
    ...projection.identityTags,
    ...(oldSourceFingerprint ? [`${REVISION_TAG_PREFIX}${oldSourceFingerprint.slice('sha256:'.length)}`] : []),
    ...(oldSyncTag ? [`#ox0-sync:${oldSyncTag}`] : [])
  ];

  const payload = {
    title: projection.title,
    slug: projection.slug,
    lexical,
    custom_excerpt: projection.excerpt,
    tags,
    feature_image: projection.featureImage,
    feature_image_alt: projection.featureImageAlt,
    featured: projection.featured,
    visibility: projection.visibility,
    canonical_url: projection.canonicalUrl,
    status: desiredStatus
  };

  return {
    desiredStatus,
    projection,
    compiledDocument,
    existing,
    lookupTag,
    projectedSourceFingerprint: oldSourceFingerprint,
    payload,
    renderedHtmlBytes: Buffer.byteLength(compiledDocument.htmlFragment, 'utf8')
  };
}

export async function planProjectionSynchronization(args) {
  const { repoRoot } = args;
  const inspected = await inspectProjectionSynchronization(args);
  const featureImageValue = inspected.projection.featureImage;
  let featureImage;
  if (!featureImageValue) {
    featureImage = { action: 'none' };
  } else if (/^https:\/\//.test(featureImageValue)) {
    featureImage = { action: 'reuse', url: featureImageValue };
  } else {
    featureImage = {
      action: 'upload',
      ref: path.relative(repoRoot, featureImageValue).replaceAll(path.sep, '/')
    };
  }

  return {
    operation: inspected.existing ? 'update' : 'create',
    existingPostId: inspected.existing?.id ?? null,
    sourceIdentity: inspected.lookupTag,
    identityTags: [...inspected.projection.identityTags],
    locale: inspected.compiledDocument.locale,
    sourceFingerprint: inspected.projection.sourceFingerprint,
    projectedSourceFingerprint: inspected.projectedSourceFingerprint,
    title: inspected.projection.title,
    slug: inspected.projection.slug,
    currentStatus: inspected.existing?.status ?? null,
    desiredStatus: inspected.desiredStatus,
    tags: [...inspected.projection.tags],
    featureImage,
    renderedHtmlBytes: inspected.renderedHtmlBytes,
    referencedAssets: [...inspected.compiledDocument.referencedAssets],
    diagnostics: [...inspected.compiledDocument.diagnostics]
  };
}

export async function synchronizeProjection(args) {
  const { client, repoRoot } = args;
  const inspected = await inspectProjectionSynchronization(args);
  let featureImage = inspected.projection.featureImage;
  if (featureImage && !/^https:\/\//.test(featureImage)) {
    const ref = path.relative(repoRoot, featureImage).replaceAll(path.sep, '/');
    const uploaded = await client.uploadImage(featureImage, ref);
    featureImage = uploaded.url;
    await assertDesiredSlugAvailable(client, inspected.projection.slug, inspected.existing);
  }
  await assertProjectionIdentityStableBeforeMutation(
    client,
    inspected.lookupTag,
    inspected.projection,
    inspected.existing
  );

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
  await assertDesiredSlugAvailable(client, inspected.projection.slug, fresh);

  const ownershipMatches = await client.getPostsBySourceTag(inspected.lookupTag);
  if (ownershipMatches.length !== 1 || ownershipMatches[0]?.id !== fresh.id) {
    throw new Error('Ghost source identity ownership changed after mutation; projection identity owner changed; refusing sync stamp');
  }

  const hash = projectionSnapshotHash(fresh);
  const stamped = await client.updatePostMetadata(fresh.id, {
    tags: replaceProjectionPublisherTags(fresh.tags, inspected.projection.identityTags, hash, {
      sourceFingerprint: inspected.projection.sourceFingerprint
    }),
    updated_at: fresh.updated_at
  });
  assertProjectionManagedAndUnchanged(stamped, inspected.projection.identityTags, {
    requireSourceFingerprint: inspected.projection.sourceFingerprint != null
  });

  const final = await client.getPostById(fresh.id);
  assertProjectionManagedAndUnchanged(final, inspected.projection.identityTags, {
    requireSourceFingerprint: inspected.projection.sourceFingerprint != null
  });
  await assertDesiredSlugAvailable(client, inspected.projection.slug, final);
  await assertExclusiveProjectionIdentity(client, inspected.lookupTag, inspected.projection, final.id);
  return final;
}

async function legacyProjectionArgs({ source, action, client, repoRoot, renderMarkdown }) {
  const desiredStatus = desiredStatusForAction(action);
  if (typeof renderMarkdown !== 'function') throw new Error('renderMarkdown function is required');
  if (source.metadata.status !== desiredStatus) {
    throw new Error(`frontmatter status=${source.metadata.status} does not match requested action=${action}`);
  }

  const html = await renderMarkdown(source.markdown, { postPath: source.postPath, repoRoot });
  const sourceTag = sourceTagForPath(source.postPath, repoRoot);
  return {
    projection: {
      identityTags: [sourceTag],
      title: source.metadata.title,
      slug: source.metadata.slug,
      excerpt: source.metadata.excerpt,
      tags: [...source.metadata.tags],
      featureImage: source.metadata.featureImage,
      featureImageAlt: source.metadata.featureImageAlt,
      featured: source.metadata.featured,
      visibility: source.metadata.visibility,
      canonicalUrl: source.metadata.canonicalUrl
    },
    compiledDocument: {
      htmlFragment: html,
      locale: 'legacy',
      referencedAssets: [],
      diagnostics: []
    },
    action,
    client,
    repoRoot
  };
}

export async function planPostSynchronization(args) {
  return planProjectionSynchronization(await legacyProjectionArgs(args));
}

export async function synchronizePost(args) {
  return synchronizeProjection(await legacyProjectionArgs(args));
}
