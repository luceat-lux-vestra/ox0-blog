import { createHash } from 'node:crypto';
import { normalizeLocaleVariant } from './article.mjs';

export const TRANSLATION_FINGERPRINT_VERSION = 1;

function normalizeLineEndings(value) {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function encodeField(name, value) {
  const bytes = Buffer.from(value, 'utf8');
  return `${name}:${bytes.length}:`;
}

function appendField(hash, name, value) {
  const normalized = normalizeLineEndings(value);
  hash.update(encodeField(name, normalized), 'utf8');
  hash.update(normalized, 'utf8');
  hash.update('\0', 'utf8');
}

function compareCodeUnits(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeAssets(materialAssets) {
  if (materialAssets == null) return [];
  if (!Array.isArray(materialAssets)) throw new Error('materialAssets must be an array');

  const seen = new Set();
  const assets = materialAssets.map((asset) => {
    if (!asset || typeof asset !== 'object') throw new Error('material asset must be an object');
    if (typeof asset.ref !== 'string' || asset.ref.trim() === '') {
      throw new Error('material asset ref must be a non-empty string');
    }
    if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error(`material asset sha256 must be lowercase hex for ${asset.ref}`);
    }
    const ref = asset.ref.trim();
    if (seen.has(ref)) throw new Error(`duplicate material asset ref: ${ref}`);
    seen.add(ref);
    return { ref, sha256: asset.sha256 };
  });

  return assets.sort((a, b) => compareCodeUnits(a.ref, b.ref));
}

function optionalString(value, name) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new Error(`${name} must be a string or null`);
  return value;
}

function normalizeSemanticPublication(value) {
  if (value == null) {
    return { featureImageRef: '', featureImageFingerprint: '', featureImageAlt: '' };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('semanticPublication must be an object when provided');
  }

  const featureImageRef = optionalString(value.featureImageRef, 'semanticPublication.featureImageRef');
  const featureImageAlt = optionalString(value.featureImageAlt, 'semanticPublication.featureImageAlt');
  const featureImageFingerprint = optionalString(
    value.featureImageFingerprint,
    'semanticPublication.featureImageFingerprint'
  );

  if (featureImageFingerprint !== '' && !/^sha256:[a-f0-9]{64}$/.test(featureImageFingerprint)) {
    throw new Error('semanticPublication.featureImageFingerprint must be sha256:<64 lowercase hex>');
  }
  if (featureImageRef === '') {
    if (featureImageFingerprint !== '') {
      throw new Error('feature image fingerprint requires a feature image ref');
    }
  } else if (featureImageRef.startsWith('assets/')) {
    if (featureImageFingerprint === '') {
      throw new Error('local semantic feature image requires content fingerprint evidence');
    }
  } else if (/^https:\/\//.test(featureImageRef)) {
    if (featureImageFingerprint !== '') {
      throw new Error('remote semantic feature image must not carry local content fingerprint evidence');
    }
  } else {
    throw new Error('semantic feature image ref must be repository assets/... or canonical https URL');
  }

  return { featureImageRef, featureImageFingerprint, featureImageAlt };
}

export function translationFingerprintV1(
  rawVariant,
  { materialAssets = [], semanticPublication = null } = {}
) {
  const variant = normalizeLocaleVariant(rawVariant);
  const assets = normalizeAssets(materialAssets);
  const publication = normalizeSemanticPublication(semanticPublication);
  const hash = createHash('sha256');

  hash.update(`ox0-translation-fingerprint:v${TRANSLATION_FINGERPRINT_VERSION}\0`, 'utf8');
  appendField(hash, 'title', variant.title);
  appendField(hash, 'excerpt', variant.excerpt ?? '');
  appendField(hash, 'body', variant.body);
  appendField(hash, 'feature-image-ref', publication.featureImageRef);
  appendField(hash, 'feature-image-fingerprint', publication.featureImageFingerprint);
  appendField(hash, 'feature-image-alt', publication.featureImageAlt);
  for (const asset of assets) {
    appendField(hash, 'asset-ref', asset.ref);
    appendField(hash, 'asset-sha256', asset.sha256);
  }

  return `sha256:${hash.digest('hex')}`;
}
