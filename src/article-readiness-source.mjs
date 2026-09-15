import { createHash } from 'node:crypto';
import { requireLocaleToken } from './locale.mjs';

export const ARTICLE_SOURCE_FINGERPRINT_VERSION = 1;

function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function requireLocales(requiredLocales) {
  if (!Array.isArray(requiredLocales) || requiredLocales.length === 0) {
    throw new Error('requiredLocales must be a non-empty array');
  }
  const locales = requiredLocales.map((locale) => requireLocaleToken(locale, 'required locale'));
  if (new Set(locales).size !== locales.length) {
    throw new Error('requiredLocales must not contain duplicates');
  }
  return locales.sort(compareCodeUnits);
}

function toMap(value) {
  if (value instanceof Map) return new Map(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('translationFingerprints must be a Map or object');
  }
  return new Map(Object.entries(value));
}

function requireFingerprint(value, name) {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be sha256:<64 lowercase hex>`);
  }
  return value;
}

function appendField(hash, name, value) {
  const bytes = Buffer.from(value, 'utf8');
  hash.update(`${name}:${bytes.length}:`, 'utf8');
  hash.update(bytes);
  hash.update('\0', 'utf8');
}

export function articleSemanticSourceFingerprintV1({ requiredLocales, translationFingerprints }) {
  const locales = requireLocales(requiredLocales);
  const fingerprints = toMap(translationFingerprints);
  const required = new Set(locales);

  for (const [locale, fingerprint] of fingerprints) {
    if (!required.has(locale)) {
      throw new Error(`translationFingerprints contains unexpected locale: ${locale}`);
    }
    requireFingerprint(fingerprint, `translationFingerprints.${locale}`);
  }
  const missing = locales.filter((locale) => !fingerprints.has(locale));
  if (missing.length > 0) {
    throw new Error(`translationFingerprints is missing required locales: ${missing.join(', ')}`);
  }

  const hash = createHash('sha256');
  hash.update(`ox0-article-semantic-source:v${ARTICLE_SOURCE_FINGERPRINT_VERSION}\0`, 'utf8');
  appendField(hash, 'locale-count', String(locales.length));
  for (const locale of locales) {
    appendField(hash, 'locale', locale);
    appendField(hash, 'translation-fingerprint', fingerprints.get(locale));
  }
  return `sha256:${hash.digest('hex')}`;
}
