import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatterDocument } from './frontmatter.mjs';

export const SYNC_TAG_PREFIX = '#ox0-sync:';
export const SOURCE_TAG_PREFIX = '#ox0-source-';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_STATUSES = new Set(['draft', 'published']);
const ALLOWED_VISIBILITY = new Set(['public']);
const IMAGE_EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.gif', '.png', '.svg']);
const MAX_TITLE_LENGTH = 2000;
const MAX_SLUG_LENGTH = 185;
const MAX_EXCERPT_LENGTH = 300;
const MAX_TAG_LENGTH = 191;
const MAX_FEATURE_IMAGE_URL_LENGTH = 2000;
const MAX_FEATURE_IMAGE_ALT_LENGTH = 65535;
const MAX_CANONICAL_URL_LENGTH = 2000;

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeOptionalString(value, name) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${name} must be a string or null`);
  return value.trim() || null;
}

function requireMaxLength(value, name, maxLength) {
  if (value != null && value.length > maxLength) {
    throw new Error(`${name} must be at most ${maxLength} characters`);
  }
  return value;
}

function isOutside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function isAbsoluteOnAnyPlatform(value) {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

async function requireConfinedRegularFile(filePath, rootPath, name) {
  const absolute = path.resolve(filePath);
  const root = path.resolve(rootPath);
  if (isOutside(root, absolute)) throw new Error(`${name} must resolve inside ${rootPath}`);

  let rootStat;
  try {
    rootStat = await lstat(root);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${name} root does not exist: ${root}`);
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`${name} root must be a real directory (symlinks are not allowed): ${root}`);
  }

  let realRoot;
  let realFile;
  try {
    [realRoot, realFile] = await Promise.all([realpath(root), realpath(absolute)]);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${name} does not exist: ${absolute}`);
    throw error;
  }

  if (isOutside(realRoot, realFile)) {
    throw new Error(`${name} resolves outside its allowed root: ${absolute}`);
  }

  const lexicalRelative = path.relative(root, absolute);
  const expectedReal = path.resolve(realRoot, lexicalRelative);
  if (realFile !== expectedReal) {
    throw new Error(`${name} path contains a symlink; symlinks are not allowed: ${absolute}`);
  }

  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${name} must be a regular file (symlinks are not allowed): ${absolute}`);
  }
}

export function validateMetadata(raw, { postPath, repoRoot }) {
  const title = requireMaxLength(requireNonEmptyString(raw.title, 'title'), 'title', MAX_TITLE_LENGTH);
  const slug = requireMaxLength(requireNonEmptyString(raw.slug, 'slug'), 'slug', MAX_SLUG_LENGTH);
  if (!SLUG_RE.test(slug)) throw new Error('slug must be lowercase ASCII kebab-case');

  const status = requireNonEmptyString(raw.status, 'status');
  if (!ALLOWED_STATUSES.has(status)) throw new Error('status must be draft or published');

  const visibility = raw.visibility == null || raw.visibility === '' ? 'public' : requireNonEmptyString(raw.visibility, 'visibility');
  if (!ALLOWED_VISIBILITY.has(visibility)) throw new Error('only public visibility is supported in v1');

  if (raw.featured != null && typeof raw.featured !== 'boolean') {
    throw new Error('featured must be true or false');
  }

  const tags = raw.tags == null || raw.tags === '' ? [] : raw.tags;
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
    throw new Error('tags must be a list of non-empty strings');
  }
  const normalizedTags = tags.map((tag) => requireMaxLength(tag.trim(), 'tag', MAX_TAG_LENGTH));
  const normalizedTagKeys = normalizedTags.map((tag) => tag.toLocaleLowerCase('en-US'));
  if (new Set(normalizedTagKeys).size !== normalizedTagKeys.length) {
    throw new Error('tags must not contain duplicates (case-insensitive after trimming)');
  }
  if (normalizedTags.some((tag) => tag.toLowerCase().startsWith('#ox0-'))) {
    throw new Error('tags starting with #ox0- are reserved for publisher state');
  }

  let featureImage = normalizeOptionalString(raw.feature_image, 'feature_image');
  if (featureImage && /^https:\/\//.test(featureImage)) {
    requireMaxLength(featureImage, 'remote feature_image', MAX_FEATURE_IMAGE_URL_LENGTH);
    try {
      const parsed = new URL(featureImage);
      if (parsed.protocol !== 'https:') throw new Error('remote feature_image must use https');
    } catch (error) {
      if (error?.message === 'remote feature_image must use https') throw error;
      throw new Error('remote feature_image must be a valid HTTPS URL');
    }
  } else if (featureImage) {
    if (isAbsoluteOnAnyPlatform(featureImage)) {
      throw new Error('local feature_image must be a relative path under assets/');
    }
    const absolute = path.resolve(path.dirname(postPath), featureImage);
    const assetRoot = path.resolve(repoRoot, 'assets');
    if (isOutside(assetRoot, absolute)) {
      throw new Error('local feature_image must resolve inside assets/');
    }
    if (!IMAGE_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
      throw new Error('unsupported feature_image extension');
    }
    featureImage = absolute;
  }

  const excerpt = requireMaxLength(normalizeOptionalString(raw.excerpt, 'excerpt'), 'excerpt', MAX_EXCERPT_LENGTH);
  const featureImageAlt = requireMaxLength(
    normalizeOptionalString(raw.feature_image_alt, 'feature_image_alt'),
    'feature_image_alt',
    MAX_FEATURE_IMAGE_ALT_LENGTH
  );
  const canonicalUrl = requireMaxLength(
    normalizeOptionalString(raw.canonical_url, 'canonical_url'),
    'canonical_url',
    MAX_CANONICAL_URL_LENGTH
  );
  if (canonicalUrl) {
    let parsed;
    try { parsed = new URL(canonicalUrl); } catch { throw new Error('canonical_url must be a valid URL'); }
    if (parsed.protocol !== 'https:') throw new Error('canonical_url must use https');
  }

  return {
    title,
    slug,
    status,
    excerpt,
    tags: normalizedTags,
    featureImage,
    featureImageAlt,
    featured: raw.featured ?? false,
    visibility,
    canonicalUrl
  };
}

export async function loadPost(postPath, repoRoot = process.cwd()) {
  const absolutePostPath = path.resolve(repoRoot, postPath);
  const postRoot = path.resolve(repoRoot, 'posts');
  if (isOutside(postRoot, absolutePostPath)) {
    throw new Error('post path must resolve inside posts/');
  }
  if (path.extname(absolutePostPath) !== '.md') {
    throw new Error('post path must use the lowercase .md extension');
  }
  await requireConfinedRegularFile(absolutePostPath, postRoot, 'post source');

  const source = await readFile(absolutePostPath, 'utf8');
  const { data, body } = parseFrontmatterDocument(source);
  if (body.trim() === '') throw new Error('post body must not be empty');
  const metadata = validateMetadata(data, { postPath: absolutePostPath, repoRoot });
  if (metadata.featureImage && !/^https:\/\//.test(metadata.featureImage)) {
    await requireConfinedRegularFile(metadata.featureImage, path.resolve(repoRoot, 'assets'), 'local feature_image');
  }
  return { postPath: absolutePostPath, metadata, markdown: body };
}

export function sourceTagForPath(postPath, repoRoot = process.cwd()) {
  const relative = path.relative(path.resolve(repoRoot, 'posts'), path.resolve(postPath));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('post path must resolve inside posts/');
  }
  const canonical = relative.split(path.sep).join('/');
  const hash = createHash('sha256').update(canonical).digest('hex');
  return `${SOURCE_TAG_PREFIX}${hash}`;
}

export function sourceTagSlug(sourceTag) {
  if (!sourceTag.startsWith(SOURCE_TAG_PREFIX)) throw new Error('invalid ox0 source tag');
  return `hash-${sourceTag.slice(1)}`;
}

function tagNames(post) {
  return (post.tags ?? []).map((tag) => typeof tag === 'string' ? tag : tag.name).filter(Boolean);
}

export function getSyncHash(post) {
  const tags = tagNames(post);
  const sync = tags.filter((tag) => tag.startsWith(SYNC_TAG_PREFIX));
  if (sync.length > 1) throw new Error('Ghost post has multiple ox0 sync tags');
  if (sync.length === 0) return null;
  const hash = sync[0].slice(SYNC_TAG_PREFIX.length);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Ghost post has malformed ox0 sync tag');
  return hash;
}

export function managedSnapshot(post) {
  const tags = tagNames(post)
    .filter((tag) => !tag.startsWith(SYNC_TAG_PREFIX) && !tag.startsWith(SOURCE_TAG_PREFIX));
  return {
    title: post.title ?? null,
    slug: post.slug ?? null,
    lexical: post.lexical ?? null,
    custom_excerpt: post.custom_excerpt ?? null,
    feature_image: post.feature_image ?? null,
    feature_image_alt: post.feature_image_alt ?? null,
    featured: Boolean(post.featured),
    visibility: post.visibility ?? 'public',
    status: post.status ?? null,
    canonical_url: post.canonical_url ?? null,
    tags
  };
}

export function snapshotHash(post) {
  return createHash('sha256').update(JSON.stringify(managedSnapshot(post))).digest('hex');
}

export function assertManagedAndUnchanged(post, expectedSourceTag) {
  if (!expectedSourceTag?.startsWith(SOURCE_TAG_PREFIX)) {
    throw new Error('expected ox0 source identity is required');
  }
  const names = tagNames(post);
  const sourceTags = names.filter((tag) => tag.startsWith(SOURCE_TAG_PREFIX));
  if (sourceTags.length !== 1 || sourceTags[0] !== expectedSourceTag) {
    throw new Error(`Ghost post ${post.slug} has invalid ox0 source identity; refusing overwrite`);
  }

  const expected = getSyncHash(post);
  if (!expected) {
    throw new Error(`Ghost post ${post.slug} exists but is not managed by ox0-blog; refusing implicit adoption`);
  }
  if (names.length < 2 || names.at(-2) !== expectedSourceTag || names.at(-1) !== `${SYNC_TAG_PREFIX}${expected}`) {
    throw new Error(`Ghost post ${post.slug} has invalid ox0 publisher tag ordering; refusing overwrite`);
  }

  const actual = snapshotHash(post);
  if (actual !== expected) {
    throw new Error(`Ghost post ${post.slug} changed outside ox0-blog; refusing overwrite`);
  }
}

export function replacePublisherTags(tags, sourceTag, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('sync hash must be sha256 hex');
  if (!sourceTag.startsWith(SOURCE_TAG_PREFIX)) throw new Error('invalid ox0 source tag');
  const names = (tags ?? []).map((tag) => typeof tag === 'string' ? tag : tag.name).filter(Boolean);
  return [
    ...names.filter((tag) => !tag.startsWith(SYNC_TAG_PREFIX) && !tag.startsWith(SOURCE_TAG_PREFIX)),
    sourceTag,
    `${SYNC_TAG_PREFIX}${hash}`
  ];
}
