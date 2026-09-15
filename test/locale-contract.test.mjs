import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArticle } from '../src/article.mjs';
import { localeIdentityTag } from '../src/projection-identity.mjs';

function articleWithLocale(locale) {
  return {
    articleId: 'article-1',
    requiredLocales: [locale],
    variants: [{
      variantId: 'variant-1',
      locale,
      title: 'Title',
      excerpt: 'Summary',
      slug: 'article',
      body: '# Body',
      sourcePath: '/repo/posts/article/body.md'
    }]
  };
}

test('Article source and projection identity share one compact locale contract', () => {
  for (const locale of ['en', 'ko-KR', 'zh-Hant-TW']) {
    assert.equal(normalizeArticle(articleWithLocale(locale)).requiredLocales[0], locale);
    assert.equal(localeIdentityTag(locale), `#ox0-locale-${locale}`);
  }
});

test('malformed or object-special locale keys fail at the Article source boundary', () => {
  for (const locale of [
    '__proto__',
    'en_US',
    '../en',
    'en/us',
    'en--US',
    'a'.repeat(65)
  ]) {
    assert.throws(() => normalizeArticle(articleWithLocale(locale)), /compact BCP47-style token/, locale);
    assert.throws(() => localeIdentityTag(locale), /compact BCP47-style token/, locale);
  }
});
