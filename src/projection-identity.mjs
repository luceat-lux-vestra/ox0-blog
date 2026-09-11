import { createHash } from 'node:crypto';

const LOCALE_RE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const MAX_LOCALE_LENGTH = 64;

function requireIdentity(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function identityHash(namespace, value) {
  return createHash('sha256')
    .update(`ox0-blog:${namespace}:v1\0${value}`, 'utf8')
    .digest('hex');
}

export function articleIdentityTag(articleId) {
  const id = requireIdentity(articleId, 'articleId');
  return `#ox0-article-${identityHash('article', id)}`;
}

export function variantIdentityTag(variantId) {
  const id = requireIdentity(variantId, 'variantId');
  return `#ox0-source-${identityHash('variant', id)}`;
}

export function localeIdentityTag(locale) {
  const value = requireIdentity(locale, 'locale');
  if (value.length > MAX_LOCALE_LENGTH || !LOCALE_RE.test(value)) {
    throw new Error('locale must be a compact BCP47-style token');
  }
  return `#ox0-locale-${value}`;
}

export function projectionIdentityTags({ articleId, variantId, locale }) {
  return [
    articleIdentityTag(articleId),
    localeIdentityTag(locale),
    variantIdentityTag(variantId)
  ];
}
