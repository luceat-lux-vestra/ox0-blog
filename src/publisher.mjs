import path from 'node:path';
import { requireCompiledDocument } from './compiler/document-compiler.mjs';
import { readRepositoryAssetSnapshot } from './file-confinement.mjs';
import { createHtmlCardLexical } from './lexical.mjs';
import { sourceTagForPath } from './post.mjs';
import { projectionSourceFingerprintV1 } from './projection-fingerprint.mjs';
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

function tagNames(tags) {
  return (tags ?? []).map((tag) => typeof tag === 'string' ? tag : tag?.name).filter(Boolean);
}

function sameTagNames(left, right) {
  const a = tagNames(left);
  const b = tagNames(right);
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
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
  const localFeatureImage = metadata.featureImage && !/^https:\/\//.test(metadata.featureImage);
  const featureImageFingerprint = projection.featureImageFingerprint == null
    ? null
    : normalizeSourceFingerprint(projection.featureImageFingerprint, 'projection.featureImageFingerprint');
  if (identityTags.length === 3 && localFeatureImage && featureImageFingerprint == null) {
    throw new Error('stable local featureImage requires projection.featureImageFingerprint');
  }
  if (!localFeatureImage && featureImageFingerprint != null) {
    throw new Error('projection.featureImageFingerprint is only valid for a local featureImage');
  }

  const materialAssets = projection.materialAssets ?? [];
  if (!Array.isArray(materialAssets)) throw new Error('projection.materialAssets must be an array');
  if (identityTags.length === 1 && materialAssets.length > 0) {
    throw new Error('legacy source-only projection cannot carry stable material asset fingerprint evidence');
  }

  return {
    identityTags,
    sourceFingerprint,
    featureImageFingerprint,
    materialAssets: materialAssets.map((asset) => ({ ...asset })),
    locale: projection.locale ?? null,
    ...metadata
  };
}

function assertProjectionFingerprintIntegrity(projection, compiledDocument) {
  if (projection.identityTags.length === 1) return;
  const recomputed = projectionSourceFingerprintV1(projection, compiledDocument, {
    materialAssets: projection.materialAssets,
    featureImageFingerprint: projection.featureImageFingerprint
  });
  if (recomputed !== projection.sourceFingerprint) {
    throw new Error(`projection.sourceFingerprint does not match current compiled projection: expected ${recomputed}, got ${projection.sourceFingerprint}`);
  }
}

async function snapshotStableLocalFeatureImage(projection, repoRoot) {
  if (projection.identityTags.length === 1) return null;
  if (!projection.featureImage || /^https:\/\//.test(projection.featureImage)) return null;
  const snapshot = await readRepositoryAssetSnapshot(projection.featureImage, repoRoot, 'local featureImage');
  if (snapshot.fingerprint !== projection.featureImageFingerprint) {
    throw new Error(`local featureImage changed since projection compilation: expected ${projection.featureImageFingerprint}, got ${snapshot.fingerprint}`);
  }
  return snapshot;
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

function synchronizationOperation(inspected) {
  if (!inspected.existing) return 'create';
  const sameRevision = inspected.projection.sourceFingerprint != null
    && inspected.projectedSourceFingerprint === inspected.projection.sourceFingerprint;
  if (!sameRevision) return 'update';
  return inspected.existing.status === inspected.desiredStatus ? 'noop' : 'status-update';
}

async function inspectProjectionSynchronization({ projection: rawProjection, compiledDocument: rawDocument, action, client, repoRoot }) {
  const desiredStatus = desiredStatusForAction(action);
  const projection = requireProjectionDescriptor(rawProjection);
  const compiledDocument = requireCompiledDocument(rawDocument);
  if (projection.locale != null && compiledDocument.locale !== projection.locale) {
    throw new Error(`CompiledDocument.locale=${compiledDocument.locale} does not match projection.locale=${projection.locale}`);
  }
  assertProjectionFingerprintIntegrity(projection, compiledDocument);

  const featureImageSnapshot = await snapshotStableLocalFeatureImage(projection, repoRoot);

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
    featureImageSnapshot,
    existing,
    lookupTag,
    projectedSourceFingerprint: oldSourceFingerprint,
    payload,
    renderedHtmlBytes: Buffer.byteLength(compiledDocument.htmlFragment, 'utf8')
  };
}

function plannedFeatureImage(inspected, repoRoot, operation) {
  const featureImageValue = inspected.projection.featureImage;
  if (!featureImageValue) return { action: 'none' };
  if (operation === 'noop' || operation === 'status-update') {
    return { action: 'preserve', url: inspected.existing?.feature_image ?? null };
  }
  if (/^https:\/\//.test(featureImageValue)) {
    return { action: 'reuse', url: featureImageValue };
  }
  return {
    action: 'upload',
    ref: path.relative(repoRoot, featureImageValue).replaceAll(path.sep, '/'),
    fingerprint: inspected.featureImageSnapshot?.fingerprint ?? inspected.projection.featureImageFingerprint
  };
}

export async function planProjectionSynchronization(args) {
  const { repoRoot } = args;
  const inspected = await inspectProjectionSynchronization(args);
  const operation = synchronizationOperation(inspected);

  return {
    operation,
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
    featureImage: plannedFeatureImage(inspected, repoRoot, operation),
    renderedHtmlBytes: inspected.renderedHtmlBytes,
    referencedAssets: [...inspected.compiledDocument.referencedAssets],
    diagnostics: [...inspected.compiledDocument.diagnostics]
  };
}

async function verifyNoopProjection(client, inspected) {
  await assertProjectionIdentityStableBeforeMutation(
    client,
    inspected.lookupTag,
    inspected.projection,
    inspected.existing
  );
  const fresh = await client.getPostById(inspected.existing.id);
  assertProjectionManagedAndUnchanged(fresh, inspected.projection.identityTags, {
    requireSourceFingerprint: true
  });
  if (fresh.updated_at !== inspected.existing.updated_at) {
    throw new Error('Ghost managed projection changed during no-op verification; refusing stale success');
  }
  await assertDesiredSlugAvailable(client, inspected.projection.slug, fresh);
  await assertExclusiveProjectionIdentity(client, inspected.lookupTag, inspected.projection, fresh.id);
  return fresh;
}

async function synchronizeStatusOnly(client, inspected) {
  await assertProjectionIdentityStableBeforeMutation(
    client,
    inspected.lookupTag,
    inspected.projection,
    inspected.existing
  );

  const expectedManagedHash = projectionSnapshotHash({
    ...inspected.existing,
    status: inspected.desiredStatus
  });
  const changed = await client.updatePost(inspected.existing.id, {
    status: inspected.desiredStatus,
    updated_at: inspected.existing.updated_at
  });
  const fresh = await client.getPostById(changed.id);
  if (fresh.status !== inspected.desiredStatus) {
    throw new Error('Ghost status-only projection mutation did not apply requested status');
  }
  if (projectionSnapshotHash(fresh) !== expectedManagedHash) {
    throw new Error('Ghost status-only projection mutation changed another managed field; refusing sync stamp');
  }
  if (!sameTagNames(fresh.tags, inspected.existing.tags)) {
    throw new Error('Ghost status-only projection mutation changed publisher/author tags; refusing sync stamp');
  }

  await assertDesiredSlugAvailable(client, inspected.projection.slug, fresh);
  const ownershipMatches = await client.getPostsBySourceTag(inspected.lookupTag);
  if (ownershipMatches.length !== 1 || ownershipMatches[0]?.id !== fresh.id) {
    throw new Error('Ghost source identity ownership changed after status mutation; projection identity owner changed; refusing sync stamp');
  }

  const hash = projectionSnapshotHash(fresh);
  const stamped = await client.updatePostMetadata(fresh.id, {
    tags: replaceProjectionPublisherTags(fresh.tags, inspected.projection.identityTags, hash, {
      sourceFingerprint: inspected.projection.sourceFingerprint
    }),
    updated_at: fresh.updated_at
  });
  assertProjectionManagedAndUnchanged(stamped, inspected.projection.identityTags, {
    requireSourceFingerprint: true
  });

  const final = await client.getPostById(fresh.id);
  assertProjectionManagedAndUnchanged(final, inspected.projection.identityTags, {
    requireSourceFingerprint: true
  });
  await assertDesiredSlugAvailable(client, inspected.projection.slug, final);
  await assertExclusiveProjectionIdentity(client, inspected.lookupTag, inspected.projection, final.id);
  return final;
}

export async function synchronizeProjection(args) {
  const { client, repoRoot } = args;
  const inspected = await inspectProjectionSynchronization(args);
  const operation = synchronizationOperation(inspected);

  if (operation === 'noop') return verifyNoopProjection(client, inspected);
  if (operation === 'status-update') return synchronizeStatusOnly(client, inspected);

  let featureImage = inspected.projection.featureImage;
  if (featureImage && !/^https:\/\//.test(featureImage)) {
    const ref = path.relative(repoRoot, featureImage).replaceAll(path.sep, '/');
    let uploaded;
    if (inspected.featureImageSnapshot) {
      if (typeof client.uploadImageBytes !== 'function') {
        throw new Error('Ghost client must support uploadImageBytes for stable local featureImage publication');
      }
      uploaded = await client.uploadImageBytes({
        bytes: inspected.featureImageSnapshot.bytes,
        filename: inspected.featureImageSnapshot.filename
      }, ref);
    } else {
      uploaded = await client.uploadImage(featureImage, ref);
    }
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
