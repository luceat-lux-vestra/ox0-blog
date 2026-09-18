import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadArticleManifest, serializeArticleManifest } from '../src/article-manifest.mjs';
import { parseStrictJson } from '../src/strict-json.mjs';

function publication(overrides = {}) {
  return {
    tags: [],
    featureImage: null,
    featureImageAlt: null,
    featured: false,
    visibility: 'public',
    canonicalUrl: null,
    ...overrides
  };
}

function manifest(overrides = {}) {
  return {
    version: 1,
    articleId: 'article-1',
    requiredLocales: ['ko-KR', 'en'],
    variants: [
      {
        variantId: 'variant-ko',
        locale: 'ko-KR',
        source: 'ko-KR.md',
        title: '제목',
        excerpt: '요약',
        slug: 'article-ko',
        publication: publication()
      },
      {
        variantId: 'variant-en',
        locale: 'en',
        source: 'en.md',
        title: 'Title',
        excerpt: 'Summary',
        slug: 'article-en',
        publication: publication()
      }
    ],
    translationCheckpoint: null,
    readiness: { epoch: 0, checkpoint: null, invalidations: [] },
    ...overrides
  };
}

async function fixture(raw = manifest()) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-manifest-write-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(path.join(repoRoot, 'assets'), { recursive: true });
  await writeFile(path.join(articleDir, 'ko-KR.md'), '# 본문\n', 'utf8');
  await writeFile(path.join(articleDir, 'en.md'), '# Body\n', 'utf8');
  const manifestPath = path.join(articleDir, 'article.json');
  await writeFile(manifestPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return { repoRoot, articleDir, manifestPath };
}

test('load -> serialize -> reload preserves canonical Article/bundle/publication semantics', async () => {
  const value = await fixture();
  const loaded = await loadArticleManifest(value);
  const serialized = await serializeArticleManifest({
    bundle: loaded.bundle,
    publicationByLocale: loaded.publicationByLocale,
    repoRoot: value.repoRoot,
    articleDir: value.articleDir
  });

  assert.equal(serialized.endsWith('\n'), true);
  const raw = parseStrictJson(serialized);
  assert.equal(raw.version, 1);
  assert.deepEqual(raw.requiredLocales, ['ko-KR', 'en']);
  assert.deepEqual(raw.variants.map((variant) => variant.source), ['ko-KR.md', 'en.md']);
  assert.equal(Object.hasOwn(raw, 'translationState'), false);
  assert.equal(Object.hasOwn(raw, 'readinessState'), false);

  await writeFile(value.manifestPath, serialized, 'utf8');
  const reloaded = await loadArticleManifest(value);
  assert.deepEqual(reloaded.bundle, loaded.bundle);
  assert.deepEqual(
    [...reloaded.publicationByLocale.entries()],
    [...loaded.publicationByLocale.entries()]
  );
});

test('local feature image serializes back to canonical repo-relative assets/ reference', async () => {
  const raw = manifest();
  raw.variants[0].publication.featureImage = 'assets/cover.png';
  const value = await fixture(raw);
  await writeFile(path.join(value.repoRoot, 'assets', 'cover.png'), 'png');
  const loaded = await loadArticleManifest(value);

  const serialized = await serializeArticleManifest({
    bundle: loaded.bundle,
    publicationByLocale: loaded.publicationByLocale,
    repoRoot: value.repoRoot,
    articleDir: value.articleDir
  });
  const written = parseStrictJson(serialized);
  assert.equal(written.variants[0].publication.featureImage, 'assets/cover.png');
});

test('uppercase HTTPS source URLs canonicalize as remote instead of becoming local filesystem paths', async () => {
  const raw = manifest();
  raw.variants[0].publication.featureImage = 'HTTPS://EXAMPLE.COM/cover.png';
  raw.variants[0].publication.canonicalUrl = 'HTTPS://EXAMPLE.COM/Article';
  const value = await fixture(raw);
  const loaded = await loadArticleManifest(value);

  assert.equal(loaded.publicationByLocale.get('ko-KR').featureImage, 'https://example.com/cover.png');
  assert.equal(loaded.publicationByLocale.get('ko-KR').canonicalUrl, 'https://example.com/Article');

  const serialized = await serializeArticleManifest({
    bundle: loaded.bundle,
    publicationByLocale: loaded.publicationByLocale,
    repoRoot: value.repoRoot,
    articleDir: value.articleDir
  });
  const written = parseStrictJson(serialized);
  assert.equal(written.variants[0].publication.featureImage, 'https://example.com/cover.png');
});

test('serializer requires exactly one publication metadata entry per present LocaleVariant', async () => {
  const value = await fixture();
  const loaded = await loadArticleManifest(value);

  const missing = new Map(loaded.publicationByLocale);
  missing.delete('en');
  await assert.rejects(
    serializeArticleManifest({
      bundle: loaded.bundle,
      publicationByLocale: missing,
      repoRoot: value.repoRoot,
      articleDir: value.articleDir
    }),
    /exactly one entry per present LocaleVariant/
  );

  const extra = new Map(loaded.publicationByLocale);
  extra.set('ja', publication());
  await assert.rejects(
    serializeArticleManifest({
      bundle: loaded.bundle,
      publicationByLocale: extra,
      repoRoot: value.repoRoot,
      articleDir: value.articleDir
    }),
    /exactly one entry per present LocaleVariant|unexpected locale/
  );
});

test('serializer rejects LocaleVariant sourcePath outside its Article directory', async () => {
  const value = await fixture();
  const loaded = await loadArticleManifest(value);
  const outside = path.join(value.repoRoot, 'posts', 'outside.md');
  await writeFile(outside, '# outside\n', 'utf8');
  loaded.bundle.article.variants[0].sourcePath = outside;

  await assert.rejects(
    serializeArticleManifest({
      bundle: loaded.bundle,
      publicationByLocale: loaded.publicationByLocale,
      repoRoot: value.repoRoot,
      articleDir: value.articleDir
    }),
    /must resolve inside/
  );
});

test('serializer rejects an Article directory outside repository posts/', async () => {
  const value = await fixture();
  const loaded = await loadArticleManifest(value);
  const outsideDir = path.join(value.repoRoot, 'outside-article');
  await mkdir(outsideDir);
  for (const variant of loaded.bundle.article.variants) {
    variant.sourcePath = path.join(outsideDir, path.basename(variant.sourcePath));
    await writeFile(variant.sourcePath, variant.body, 'utf8');
  }

  await assert.rejects(
    serializeArticleManifest({
      bundle: loaded.bundle,
      publicationByLocale: loaded.publicationByLocale,
      repoRoot: value.repoRoot,
      articleDir: outsideDir
    }),
    /Article directory must resolve inside repository posts/
  );
});
