import { createHash } from 'node:crypto';
import { requireLocaleToken } from './locale.mjs';

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
  const value = requireLocaleToken(locale);
  return `#ox0-locale-${value}`;
}

export function projectionIdentityTags({ articleId, variantId, locale }) {
  return [
    articleIdentityTag(articleId),
    localeIdentityTag(locale),
    variantIdentityTag(variantId)
  ];
}
