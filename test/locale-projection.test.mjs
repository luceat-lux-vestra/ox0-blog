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

function compiler() {
  return {
    async compile(variant, projectContext) {
      return {
        htmlFragment: '<h1>본문</h1>',
        locale: variant.locale,
        referencedAssets: [],
        diagnostics: [],
        projectContext
      };
    }
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
  const observedCompiler = {
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
    compiler: observedCompiler,
    projectContext: { root: '/repo' }
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].variant.variantId, 'variant-ko-1');
  assert.deepEqual(seen[0].projectContext, { root: '/repo' });
  assert.equal(result.compiledDocument.locale, 'ko-KR');
  assert.equal(result.projection.locale, 'ko-KR');
  assert.match(result.sourceFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.projection.sourceFingerprint, result.sourceFingerprint);
  assert.deepEqual(result.projection.materialAssets, []);
  assert.deepEqual(result.fingerprintEvidence, {
    materialAssets: [],
    featureImageFingerprint: null
  });
  assert.equal(Object.hasOwn(result.projection, 'featureImageFingerprint'), false);
});

test('material asset fingerprint evidence is copied into publisher handoff and affects source revision', async () => {
  const materialAssets = [
    { ref: '../assets/diagram.png', sha256: 'a'.repeat(64) }
  ];
  const first = await compileLocaleProjection({
    article: article(),
    locale: 'ko-KR',
    compiler: compiler(),
    fingerprintEvidence: { materialAssets }
  });

  assert.deepEqual(first.projection.materialAssets, materialAssets);
  assert.deepEqual(first.fingerprintEvidence.materialAssets, materialAssets);
  assert.notEqual(first.projection.materialAssets, materialAssets);
  assert.notEqual(first.projection.materialAssets[0], materialAssets[0]);

  const changed = await compileLocaleProjection({
    article: article(),
    locale: 'ko-KR',
    compiler: compiler(),
    fingerprintEvidence: {
      materialAssets: [
        { ref: '../assets/diagram.png', sha256: 'b'.repeat(64) }
      ]
    }
  });
  assert.notEqual(changed.sourceFingerprint, first.sourceFingerprint);
});

test('local feature image needs stable content evidence and carries it into publisher handoff', async () => {
  await assert.rejects(
    compileLocaleProjection({
      article: article(),
      locale: 'ko-KR',
      publication: { featureImage: '/repo/assets/cover.png' },
      compiler: compiler()
    }),
    /requires featureImageFingerprint/
  );

  const featureImageFingerprint = `sha256:${'c'.repeat(64)}`;
  const result = await compileLocaleProjection({
    article: article(),
    locale: 'ko-KR',
    publication: { featureImage: '/repo/assets/cover.png' },
    compiler: compiler(),
    fingerprintEvidence: { featureImageFingerprint }
  });
  assert.match(result.sourceFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.projection.featureImageFingerprint, featureImageFingerprint);
  assert.equal(result.fingerprintEvidence.featureImageFingerprint, featureImageFingerprint);
});

test('compiler returning a different locale fails before publisher handoff', async () => {
  const wrongCompiler = {
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
    compileLocaleProjection({ article: article(), locale: 'ko-KR', compiler: wrongCompiler }),
    /compiler returned locale=en/
  );
});
