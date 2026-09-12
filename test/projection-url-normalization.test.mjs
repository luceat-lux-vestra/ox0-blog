import test from 'node:test';
import assert from 'node:assert/strict';
import { compileLocaleProjection } from '../src/locale-projection.mjs';
import { normalizeProjectionMetadata } from '../src/projection-metadata.mjs';

function article() {
  return {
    articleId: 'article-1',
    requiredLocales: ['en'],
    variants: [
      {
        variantId: 'variant-en',
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

const compiler = {
  async compile(variant) {
    return {
      htmlFragment: '<h1>Body</h1>',
      locale: variant.locale,
      referencedAssets: [],
      diagnostics: []
    };
  }
};

test('remote feature/canonical URLs are canonicalized through WHATWG URL semantics', () => {
  const metadata = normalizeProjectionMetadata({
    title: 'Title',
    slug: 'article-en',
    excerpt: 'Summary',
    tags: [],
    featureImage: 'HTTPS://EXAMPLE.COM:443/cover.png',
    canonicalUrl: 'HTTPS://EXAMPLE.COM:443/Article',
    visibility: 'public'
  });

  assert.equal(metadata.featureImage, 'https://example.com/cover.png');
  assert.equal(metadata.canonicalUrl, 'https://example.com/Article');
});

test('canonicalized remote feature image never requires local feature-image fingerprint evidence', async () => {
  const result = await compileLocaleProjection({
    article: article(),
    locale: 'en',
    publication: {
      featureImage: 'HTTPS://EXAMPLE.COM/cover.png'
    },
    compiler,
    fingerprintEvidence: {}
  });

  assert.equal(result.projection.featureImage, 'https://example.com/cover.png');
  assert.equal(Object.hasOwn(result.projection, 'featureImageFingerprint'), false);
  assert.match(result.sourceFingerprint, /^sha256:[a-f0-9]{64}$/);
});
