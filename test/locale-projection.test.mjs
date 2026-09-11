import test from 'node:test';
import assert from 'node:assert/strict';
import { compileLocaleProjection, createLocaleProjectionDescriptor } from '../src/locale-projection.mjs';

function article() {
  return {
    articleId: 'article-1',
    requiredLocales: ['ko-KR', 'en'],
    variants: [
      {
        variantId: 'variant-ko-1',
        locale: 'ko-KR',
        title: '제목',
        excerpt: '요약',
        slug: 'article-ko',
        body: '# 본문\n',
        sourcePath: '/repo/posts/article/ko-KR.md'
      },
      {
        variantId: 'variant-en-1',
        locale: 'en',
        title: 'Title',
        excerpt: 'Summary',
        slug: 'article-en',
        body: '# Body\n',
        sourcePath: '/repo/posts/article/en.md'
      }
    ]
  };
}

test('descriptor derives public content and stable identity from Article + LocaleVariant', () => {
  const descriptor = createLocaleProjectionDescriptor({
    article: article(),
    locale: 'ko-KR',
    publication: { tags: ['Rust'], featured: true }
  });

  assert.equal(descriptor.locale, 'ko-KR');
  assert.equal(descriptor.title, '제목');
  assert.equal(descriptor.slug, 'article-ko');
  assert.equal(descriptor.excerpt, '요약');
  assert.deepEqual(descriptor.tags, ['Rust']);
  assert.equal(descriptor.featured, true);
  assert.equal(descriptor.identityTags.length, 3);
  assert.match(descriptor.identityTags[0], /^#ox0-article-[a-f0-9]{64}$/);
  assert.equal(descriptor.identityTags[1], '#ox0-locale-ko-KR');
  assert.match(descriptor.identityTags[2], /^#ox0-source-[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(descriptor, 'sourceFingerprint'), false);
});

test('publication status is rejected because authorization belongs to the operation', () => {
  assert.throws(
    () => createLocaleProjectionDescriptor({
      article: article(),
      locale: 'ko-KR',
      publication: { status: 'published' }
    }),
    /not source state/
  );
});

test('missing required locale variant fails closed', () => {
  const value = article();
  value.variants = value.variants.filter((variant) => variant.locale !== 'en');
  assert.throws(
    () => createLocaleProjectionDescriptor({ article: value, locale: 'en' }),
    /required LocaleVariant is missing/
  );
});

test('compile boundary is async, validates locale ownership, and attaches source revision', async () => {
  const seen = [];
  const compiler = {
    async compile(variant, projectContext) {
      seen.push({ variant, projectContext });
      return {
        htmlFragment: '<h1>본문</h1>',
        locale: variant.locale,
        referencedAssets: [],
        diagnostics: []
      };
    }
  };

  const result = await compileLocaleProjection({
    article: article(),
    locale: 'ko-KR',
    publication: { tags: ['Rust'] },
    compiler,
    projectContext: { root: '/repo' }
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].variant.variantId, 'variant-ko-1');
  assert.deepEqual(seen[0].projectContext, { root: '/repo' });
  assert.equal(result.compiledDocument.locale, 'ko-KR');
  assert.equal(result.projection.locale, 'ko-KR');
  assert.match(result.sourceFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.projection.sourceFingerprint, result.sourceFingerprint);
});

test('local feature image needs stable content evidence before projection revision can be computed', async () => {
  const compiler = {
    async compile(variant) {
      return {
        htmlFragment: '<h1>본문</h1>',
        locale: variant.locale,
        referencedAssets: [],
        diagnostics: []
      };
    }
  };
  await assert.rejects(
    compileLocaleProjection({
      article: article(),
      locale: 'ko-KR',
      publication: { featureImage: '/repo/assets/cover.png' },
      compiler
    }),
    /requires featureImageFingerprint/
  );

  const result = await compileLocaleProjection({
    article: article(),
    locale: 'ko-KR',
    publication: { featureImage: '/repo/assets/cover.png' },
    compiler,
    fingerprintEvidence: { featureImageFingerprint: `sha256:${'c'.repeat(64)}` }
  });
  assert.match(result.sourceFingerprint, /^sha256:[a-f0-9]{64}$/);
});

test('compiler returning a different locale fails before publisher handoff', async () => {
  const compiler = {
    async compile() {
      return {
        htmlFragment: '<h1>wrong</h1>',
        locale: 'en',
        referencedAssets: [],
        diagnostics: []
      };
    }
  };

  await assert.rejects(
    compileLocaleProjection({ article: article(), locale: 'ko-KR', compiler }),
    /compiler returned locale=en/
  );
});
