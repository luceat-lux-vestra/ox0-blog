import path from 'node:path';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.gif', '.png', '.svg']);
const MAX_TITLE_LENGTH = 2000;
const MAX_SLUG_LENGTH = 185;
const MAX_EXCERPT_LENGTH = 300;
const MAX_TAG_LENGTH = 191;
const MAX_FEATURE_IMAGE_URL_LENGTH = 2000;
const MAX_FEATURE_IMAGE_ALT_LENGTH = 65535;
const MAX_CANONICAL_URL_LENGTH = 2000;

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function optionalString(value, name) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${name} must be a string or null`);
  return value.trim() || null;
}

function maxLength(value, name, max) {
  if (value != null && value.length > max) throw new Error(`${name} must be at most ${max} characters`);
  return value;
}

function normalizeTags(value) {
  const tags = value == null ? [] : value;
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
    throw new Error('tags must be a list of non-empty strings');
  }
  const normalized = tags.map((tag) => maxLength(tag.trim(), 'tag', MAX_TAG_LENGTH));
  const keys = normalized.map((tag) => tag.normalize('NFC').toLocaleLowerCase('en-US'));
  if (new Set(keys).size !== keys.length) {
    throw new Error('tags must not contain duplicates (case-insensitive after normalization)');
  }
  if (normalized.some((tag) => tag.toLowerCase().startsWith('#ox0-'))) {
    throw new Error('tags starting with #ox0- are reserved for publisher state');
  }
  return normalized;
}

function isAbsoluteOnAnyPlatform(value) {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function normalizeFeatureImage(value) {
  const image = optionalString(value, 'featureImage');
  if (!image) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(image)) {
    let parsed;
    try { parsed = new URL(image); } catch { throw new Error('remote featureImage must be a valid URL'); }
    if (parsed.protocol !== 'https:') throw new Error('remote featureImage must use https');
    return maxLength(image, 'remote featureImage', MAX_FEATURE_IMAGE_URL_LENGTH);
  }
  if (!isAbsoluteOnAnyPlatform(image)) {
    throw new Error('local featureImage must be an absolute resolved path before projection');
  }
  if (!IMAGE_EXTENSIONS.has(path.extname(image).toLowerCase())) {
    throw new Error('unsupported featureImage extension');
  }
  return image;
}

function normalizeCanonicalUrl(value) {
  const canonicalUrl = maxLength(optionalString(value, 'canonicalUrl'), 'canonicalUrl', MAX_CANONICAL_URL_LENGTH);
  if (!canonicalUrl) return null;
  let parsed;
  try { parsed = new URL(canonicalUrl); } catch { throw new Error('canonicalUrl must be a valid URL'); }
  if (parsed.protocol !== 'https:') throw new Error('canonicalUrl must use https');
  return canonicalUrl;
}

export function normalizeProjectionMetadata(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('projection metadata is required');
  const title = maxLength(requiredString(raw.title, 'title'), 'title', MAX_TITLE_LENGTH);
  const slug = maxLength(requiredString(raw.slug, 'slug'), 'slug', MAX_SLUG_LENGTH);
  if (!SLUG_RE.test(slug)) throw new Error('slug must be lowercase ASCII kebab-case');
  if (raw.featured != null && typeof raw.featured !== 'boolean') throw new Error('featured must be true or false');
  const visibility = raw.visibility == null || raw.visibility === '' ? 'public' : requiredString(raw.visibility, 'visibility');
  if (visibility !== 'public') throw new Error('only public visibility is supported in v1');

  return {
    title,
    slug,
    excerpt: maxLength(optionalString(raw.excerpt, 'excerpt'), 'excerpt', MAX_EXCERPT_LENGTH),
    tags: normalizeTags(raw.tags),
    featureImage: normalizeFeatureImage(raw.featureImage),
    featureImageAlt: maxLength(optionalString(raw.featureImageAlt, 'featureImageAlt'), 'featureImageAlt', MAX_FEATURE_IMAGE_ALT_LENGTH),
    featured: raw.featured ?? false,
    visibility,
    canonicalUrl: normalizeCanonicalUrl(raw.canonicalUrl)
  };
}
