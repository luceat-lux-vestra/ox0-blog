import { createHash } from 'node:crypto';

export const SYNC_TAG_PREFIX = '#ox0-sync:';
export const ARTICLE_TAG_PREFIX = '#ox0-article-';
export const LOCALE_TAG_PREFIX = '#ox0-locale-';
export const SOURCE_TAG_PREFIX = '#ox0-source-';

const IDENTITY_PREFIXES = [ARTICLE_TAG_PREFIX, LOCALE_TAG_PREFIX, SOURCE_TAG_PREFIX];
const SUPPORTED_PUBLISHER_PREFIXES = [...IDENTITY_PREFIXES, SYNC_TAG_PREFIX];

function namesFromTags(tags) {
  return (tags ?? [])
    .map((tag) => typeof tag === 'string' ? tag : tag?.name)
    .filter(Boolean);
}

export function publisherTagNames(tags) {
  return namesFromTags(tags).filter((name) => name.startsWith('#ox0-'));
}

function publisherPrefix(name) {
  return SUPPORTED_PUBLISHER_PREFIXES.find((prefix) => name.startsWith(prefix)) ?? null;
}

function assertNoUnknownPublisherTags(names) {
  const unknown = names.filter((name) => name.startsWith('#ox0-') && publisherPrefix(name) == null);
  if (unknown.length > 0) {
    throw new Error(`Ghost post contains unsupported ox0 publisher tags: ${unknown.join(', ')}`);
  }
}

export function normalizeProjectionIdentityTags(identityTags) {
  if (!Array.isArray(identityTags) || identityTags.length === 0) {
    throw new Error('projection identityTags must be a non-empty array');
  }

  const normalized = identityTags.map((tag) => {
    if (typeof tag !== 'string' || tag.trim() === '') {
      throw new Error('projection identityTags must contain non-empty strings');
    }
    return tag.trim();
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('projection identityTags must not contain duplicates');
  }

  const counts = new Map(IDENTITY_PREFIXES.map((prefix) => [prefix, 0]));
  for (const tag of normalized) {
    const prefix = IDENTITY_PREFIXES.find((candidate) => tag.startsWith(candidate));
    if (!prefix) throw new Error(`unsupported projection identity tag: ${tag}`);
    counts.set(prefix, counts.get(prefix) + 1);
    if (counts.get(prefix) > 1) {
      throw new Error(`projection identityTags contain multiple ${prefix} identities`);
    }
  }
  return normalized;
}

export function projectionLookupTag(identityTags) {
  const normalized = normalizeProjectionIdentityTags(identityTags);
  const sourceTags = normalized.filter((tag) => tag.startsWith(SOURCE_TAG_PREFIX));
  if (sourceTags.length !== 1) {
    throw new Error('projection identity requires exactly one #ox0-source- variant identity for lookup');
  }
  return sourceTags[0];
}

export function getProjectionSyncHash(post) {
  const names = namesFromTags(post?.tags);
  assertNoUnknownPublisherTags(names);
  const sync = names.filter((tag) => tag.startsWith(SYNC_TAG_PREFIX));
  if (sync.length > 1) throw new Error('Ghost post has multiple ox0 sync tags');
  if (sync.length === 0) return null;
  const hash = sync[0].slice(SYNC_TAG_PREFIX.length);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Ghost post has malformed ox0 sync tag');
  return hash;
}

export function projectionManagedSnapshot(post) {
  const names = namesFromTags(post?.tags);
  assertNoUnknownPublisherTags(names);
  const tags = names.filter((tag) => publisherPrefix(tag) == null);
  return {
    title: post?.title ?? null,
    slug: post?.slug ?? null,
    lexical: post?.lexical ?? null,
    custom_excerpt: post?.custom_excerpt ?? null,
    feature_image: post?.feature_image ?? null,
    feature_image_alt: post?.feature_image_alt ?? null,
    featured: Boolean(post?.featured),
    visibility: post?.visibility ?? 'public',
    status: post?.status ?? null,
    canonical_url: post?.canonical_url ?? null,
    tags
  };
}

export function projectionSnapshotHash(post) {
  return createHash('sha256')
    .update(JSON.stringify(projectionManagedSnapshot(post)))
    .digest('hex');
}

export function assertProjectionManagedAndUnchanged(post, identityTags) {
  const expectedIdentity = normalizeProjectionIdentityTags(identityTags);
  const names = namesFromTags(post?.tags);
  assertNoUnknownPublisherTags(names);

  const actualIdentity = names.filter((tag) => IDENTITY_PREFIXES.some((prefix) => tag.startsWith(prefix)));
  if (actualIdentity.length !== expectedIdentity.length || actualIdentity.some((tag, index) => tag !== expectedIdentity[index])) {
    throw new Error(`Ghost post ${post?.slug ?? '<unknown>'} has invalid ox0 projection identity; refusing overwrite`);
  }

  const expectedHash = getProjectionSyncHash(post);
  if (!expectedHash) {
    throw new Error(`Ghost post ${post?.slug ?? '<unknown>'} exists but is not managed by ox0-blog; refusing implicit adoption`);
  }

  const expectedTail = [...expectedIdentity, `${SYNC_TAG_PREFIX}${expectedHash}`];
  const actualTail = names.slice(-expectedTail.length);
  if (actualTail.length !== expectedTail.length || actualTail.some((tag, index) => tag !== expectedTail[index])) {
    throw new Error(`Ghost post ${post?.slug ?? '<unknown>'} has invalid ox0 publisher tag ordering; refusing overwrite`);
  }

  const actualHash = projectionSnapshotHash(post);
  if (actualHash !== expectedHash) {
    throw new Error(`Ghost post ${post?.slug ?? '<unknown>'} changed outside ox0-blog; refusing overwrite`);
  }
}

export function replaceProjectionPublisherTags(tags, identityTags, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('sync hash must be sha256 hex');
  const identity = normalizeProjectionIdentityTags(identityTags);
  const names = namesFromTags(tags);
  assertNoUnknownPublisherTags(names);
  const publicTags = names.filter((tag) => publisherPrefix(tag) == null);
  return [...publicTags, ...identity, `${SYNC_TAG_PREFIX}${hash}`];
}
