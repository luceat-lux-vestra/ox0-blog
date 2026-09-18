import test from 'node:test';
import assert from 'node:assert/strict';
import { missingRequiredLocales, normalizeArticle, variantsByLocale } from '../src/article.mjs';
import { projectionIdentityTags } from '../src/projection-identity.mjs';

function article(overrides = {}) {
  return {
    articleId: 'article-immutable-1',
    requiredLocales: ['ko-KR', 'en'],
    variants: [
      {
        variantId: 'variant-ko-immutable-1',
        locale: 'ko-KR',
        title: '제목',
        excerpt: '요약',
        slug: 'old-ko-slug',
        body: '# 본문',
        sourcePath: '/repo/posts/example/ko-KR.md'
      },
      {
        variantId: 'variant-en-immutable-1',
        locale: 'en',
        title: 'Title',
        excerpt: 'Summary',
        slug: 'old-en-slug',
        body: '# Body',
        sourcePath: '/repo/posts/example/en.md'
      }
    ],
    ...overrides
  };
}

test('Article keeps stable identities separate from path and slug', () => {
  const original = normalizeArticle(article());
  const moved = normalizeArticle(article({
    variants: article().variants.map((variant) => ({
      ...variant,
      slug: `new-${variant.locale.toLowerCase()}-slug`,
      sourcePath: `/repo/posts/moved/${variant.locale}.md`
    }))
  }));

  assert.equal(moved.articleId, original.articleId);
  assert.deepEqual(
    moved.variants.map((variant) => variant.variantId),
    original.variants.map((variant) => variant.variantId)
  );

  const originalTags = projectionIdentityTags({
    articleId: original.articleId,
    variantId: original.variants[0].variantId,
    locale: original.variants[0].locale
  });
  const movedTags = projectionIdentityTags({
    articleId: moved.articleId,
    variantId: moved.variants[0].variantId,
    locale: moved.variants[0].locale
  });
  assert.deepEqual(movedTags, originalTags);
});

test('Article allows an incomplete required-locale set so INCOMPLETE can be derived', () => {
  const incomplete = article({ variants: [article().variants[0]] });
  assert.deepEqual(missingRequiredLocales(incomplete), ['en']);
  assert.equal(variantsByLocale(incomplete).get('ko-KR').variantId, 'variant-ko-immutable-1');
});

test('Article rejects duplicate variant IDs and duplicate locale ownership', () => {
  const base = article();
  assert.throws(
    () => normalizeArticle({
      ...base,
      variants: [base.variants[0], { ...base.variants[1], variantId: base.variants[0].variantId }]
    }),
    /duplicate LocaleVariant.variantId/
  );
  assert.throws(
    () => normalizeArticle({
      ...base,
      variants: [base.variants[0], { ...base.variants[1], locale: 'ko-KR' }]
    }),
    /duplicate LocaleVariant.locale/
  );
});

test('Article rejects locale variants outside the configured required locales', () => {
  assert.throws(
    () => normalizeArticle({
      ...article(),
      variants: [...article().variants, {
        variantId: 'variant-ja-1',
        locale: 'ja',
        title: 'Title',
        excerpt: null,
        slug: 'ja',
        body: '# body',
        sourcePath: '/repo/posts/example/ja.md'
      }]
    }),
    /not configured/
  );
});

test('projection identity contains article, locale, and stable variant tags', () => {
  const tags = projectionIdentityTags({
    articleId: 'article-1',
    variantId: 'variant-1',
    locale: 'ko-KR'
  });
  assert.equal(tags.length, 3);
  assert.match(tags[0], /^#ox0-article-[a-f0-9]{64}$/);
  assert.equal(tags[1], '#ox0-locale-ko-KR');
  assert.match(tags[2], /^#ox0-source-[a-f0-9]{64}$/);
});
