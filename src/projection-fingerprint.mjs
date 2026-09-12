import { createHash } from 'node:crypto';
import { requireCompiledDocument } from './compiler/document-compiler.mjs';
import { isHttpsUrl } from './projection-metadata.mjs';

export const PROJECTION_FINGERPRINT_VERSION = 1;

function appendField(hash, name, value) {
  const normalized = typeof value === 'string'
    ? value.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    : String(value);
  const bytes = Buffer.from(normalized, 'utf8');
  hash.update(`${name}:${bytes.length}:`, 'utf8');
  hash.update(bytes);
  hash.update('\0', 'utf8');
}

function requireString(value, name, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  if (!allowEmpty && value.trim() === '') throw new Error(`${name} must be non-empty`);
  return value;
}

function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeMaterialAssets(materialAssets) {
  if (materialAssets == null) return [];
  if (!Array.isArray(materialAssets)) throw new Error('materialAssets must be an array');
  const seen = new Set();
  const normalized = materialAssets.map((asset) => {
    if (!asset || typeof asset !== 'object') throw new Error('material asset must be an object');
    const ref = requireString(asset.ref, 'material asset ref').trim();
    const sha256 = requireString(asset.sha256, `material asset sha256 for ${ref}`).trim();
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`material asset sha256 must be lowercase 64-hex for ${ref}`);
    }
    if (seen.has(ref)) throw new Error(`duplicate material asset ref: ${ref}`);
    seen.add(ref);
    return { ref, sha256 };
  });
  return normalized.sort((a, b) => compareCodeUnits(a.ref, b.ref));
}

function normalizeProjection(projection) {
  if (!projection || typeof projection !== 'object') throw new Error('projection descriptor is required');
  if (!Array.isArray(projection.tags) || projection.tags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
    throw new Error('projection.tags must be an array of non-empty strings');
  }
  return {
    locale: requireString(projection.locale, 'projection.locale').trim(),
    title: requireString(projection.title, 'projection.title'),
    slug: requireString(projection.slug, 'projection.slug').trim(),
    excerpt: projection.excerpt == null ? '' : requireString(projection.excerpt, 'projection.excerpt', { allowEmpty: true }),
    tags: [...projection.tags],
    featureImage: projection.featureImage ?? null,
    featureImageAlt: projection.featureImageAlt == null ? '' : requireString(projection.featureImageAlt, 'projection.featureImageAlt', { allowEmpty: true }),
    featured: Boolean(projection.featured),
    visibility: projection.visibility ?? 'public',
    canonicalUrl: projection.canonicalUrl ?? null
  };
}

function appendFeatureImage(hash, featureImage, featureImageFingerprint) {
  if (featureImage == null || featureImage === '') {
    appendField(hash, 'feature-image-kind', 'none');
    return;
  }
  if (typeof featureImage !== 'string') throw new Error('projection.featureImage must be a string or null');
  if (isHttpsUrl(featureImage)) {
    appendField(hash, 'feature-image-kind', 'https');
    appendField(hash, 'feature-image-url', featureImage);
    return;
  }
  if (typeof featureImageFingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(featureImageFingerprint)) {
    throw new Error('local feature image requires featureImageFingerprint=sha256:<64 lowercase hex>');
  }
  appendField(hash, 'feature-image-kind', 'local-content');
  appendField(hash, 'feature-image-fingerprint', featureImageFingerprint);
}

export function projectionSourceFingerprintV1(
  rawProjection,
  rawCompiledDocument,
  { materialAssets = [], featureImageFingerprint = null } = {}
) {
  const projection = normalizeProjection(rawProjection);
  const compiledDocument = requireCompiledDocument(rawCompiledDocument);
  if (compiledDocument.locale !== projection.locale) {
    throw new Error(`CompiledDocument.locale=${compiledDocument.locale} does not match projection.locale=${projection.locale}`);
  }
  const assets = normalizeMaterialAssets(materialAssets);
  const hash = createHash('sha256');

  hash.update(`ox0-projection-source:v${PROJECTION_FINGERPRINT_VERSION}\0`, 'utf8');
  appendField(hash, 'locale', projection.locale);
  appendField(hash, 'title', projection.title);
  appendField(hash, 'slug', projection.slug);
  appendField(hash, 'excerpt', projection.excerpt);
  appendField(hash, 'compiled-html', compiledDocument.htmlFragment);
  appendField(hash, 'tag-count', projection.tags.length);
  for (const tag of projection.tags) appendField(hash, 'tag', tag);
  appendFeatureImage(hash, projection.featureImage, featureImageFingerprint);
  appendField(hash, 'feature-image-alt', projection.featureImageAlt);
  appendField(hash, 'featured', projection.featured ? 'true' : 'false');
  appendField(hash, 'visibility', String(projection.visibility));
  appendField(hash, 'canonical-url', projection.canonicalUrl == null ? '' : String(projection.canonicalUrl));
  for (const asset of assets) {
    appendField(hash, 'asset-ref', asset.ref);
    appendField(hash, 'asset-sha256', asset.sha256);
  }

  return `sha256:${hash.digest('hex')}`;
}
