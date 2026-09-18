import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadArticleManifest } from '../src/article-manifest.mjs';
import { recoverArticleBundleReviewState } from '../src/article-bundle.mjs';
import { translationFingerprintV1 } from '../src/translation-fingerprint.mjs';

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
    readiness: {
      epoch: 0,
      checkpoint: null,
      invalidations: []
    },
    ...overrides
  };
}

async function fixture(raw = manifest()) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-article-manifest-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(path.join(repoRoot, 'assets'), { recursive: true });
  await writeFile(path.join(articleDir, 'ko-KR.md'), '# 본문  \r\n', 'utf8');
  await writeFile(path.join(articleDir, 'en.md'), '# Body\n', 'utf8');
  const manifestPath = path.join(articleDir, 'article.json');
  await writeFile(manifestPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return { repoRoot, articleDir, manifestPath };
}

function currentFingerprints(bundle) {
  return Object.fromEntries(
    bundle.article.variants.map((variant) => [variant.locale, translationFingerprintV1(variant)])
  );
}

test('article.json hydrates Article bundle and source-owned publication metadata', async () => {
  const { repoRoot, articleDir, manifestPath } = await fixture();
  const loaded = await loadArticleManifest({ manifestPath, repoRoot });

  assert.equal(loaded.manifestPath, manifestPath);
  assert.equal(loaded.articleDir, articleDir);
  assert.equal(loaded.bundle.article.articleId, 'article-1');
  assert.deepEqual(loaded.bundle.article.requiredLocales, ['ko-KR', 'en']);
  assert.equal(loaded.bundle.article.variants[0].body, '# 본문  \r\n');
  assert.equal(loaded.bundle.article.variants[0].sourcePath, path.join(articleDir, 'ko-KR.md'));
  assert.deepEqual(loaded.publicationByLocale.get('ko-KR'), publication());

  const recovered = recoverArticleBundleReviewState(loaded.bundle, {
    currentTranslationFingerprints: currentFingerprints(loaded.bundle)
  });
  assert.deepEqual(recovered.translation, { state: 'UNREVIEWED' });
  assert.deepEqual(recovered.readiness, { state: 'DRAFT' });
});

test('repo-relative feature image is confined under assets and resolved only at runtime', async () => {
  const raw = manifest();
  raw.variants[0].publication.featureImage = 'assets/article-cover.png';
  const { repoRoot, manifestPath } = await fixture(raw);
  await writeFile(path.join(repoRoot, 'assets', 'article-cover.png'), 'png');

  const loaded = await loadArticleManifest({ manifestPath, repoRoot });
  assert.equal(
    loaded.publicationByLocale.get('ko-KR').featureImage,
    path.join(repoRoot, 'assets', 'article-cover.png')
  );
});

test('manifest rejects unsupported fields instead of silently discarding them', async () => {
  const rootExtra = manifest({ readinessState: 'READY' });
  const rootFixture = await fixture(rootExtra);
  await assert.rejects(
    loadArticleManifest(rootFixture),
    /Article manifest contains unsupported field: readinessState/
  );

  const publicationExtra = manifest();
  publicationExtra.variants[0].publication.status = 'published';
  const publicationFixture = await fixture(publicationExtra);
  await assert.rejects(
    loadArticleManifest(publicationFixture),
    /publication contains unsupported field: status/
  );
});

test('strict manifest parsing rejects duplicate JSON keys including escaped aliases', async () => {
  const { repoRoot, manifestPath } = await fixture();
  const source = `{
    "version": 1,
    "articleId": "article-1",
    "\\u0061rticleId": "article-2",
    "requiredLocales": ["ko-KR", "en"],
    "variants": [],
    "translationCheckpoint": null,
    "readiness": {"epoch": 0, "checkpoint": null, "invalidations": []}
  }`;
  await writeFile(manifestPath, source, 'utf8');
  await assert.rejects(
    loadArticleManifest({ manifestPath, repoRoot }),
    /duplicate JSON object key: articleId/
  );
});

test('variant source must be normalized lowercase-.md path confined to the Article directory', async () => {
  for (const source of ['../escape.md', './ko-KR.md', 'KO.MD', 'nested\\ko-KR.md', 'drive:ko-KR.md']) {
    const raw = manifest();
    raw.variants[0].source = source;
    const value = await fixture(raw);
    await assert.rejects(loadArticleManifest(value));
  }
});

test('two LocaleVariants cannot claim the same Markdown source file', async () => {
  const raw = manifest();
  raw.variants[1].source = 'ko-KR.md';
  const value = await fixture(raw);
  await assert.rejects(
    loadArticleManifest(value),
    /duplicate Article variant source: ko-KR\.md/
  );
});

test('invalid UTF-8 locale source fails closed', async () => {
  const value = await fixture();
  await writeFile(path.join(value.articleDir, 'ko-KR.md'), Buffer.from([0xc3, 0x28]));
  await assert.rejects(
    loadArticleManifest(value),
    /must be valid UTF-8/
  );
});

test('local feature image must use repo-relative assets/ path and remote feature image must use HTTPS', async () => {
  const local = manifest();
  local.variants[0].publication.featureImage = 'cover.png';
  const localFixture = await fixture(local);
  await assert.rejects(
    loadArticleManifest(localFixture),
    /local path must be repository-relative under assets\//
  );

  const remote = manifest();
  remote.variants[0].publication.featureImage = 'http://example.test/cover.png';
  const remoteFixture = await fixture(remote);
  await assert.rejects(
    loadArticleManifest(remoteFixture),
    /remote featureImage must use https/
  );
});

test('manifest itself must be article.json under repository posts/', async () => {
  const { repoRoot } = await fixture();
  const outsideDir = path.join(repoRoot, 'outside');
  await mkdir(outsideDir);
  const outside = path.join(outsideDir, 'article.json');
  await writeFile(outside, `${JSON.stringify(manifest())}\n`, 'utf8');
  await assert.rejects(
    loadArticleManifest({ manifestPath: outside, repoRoot }),
    /must resolve inside/
  );

  const wrongNameDir = path.join(repoRoot, 'posts', 'wrong-name');
  await mkdir(wrongNameDir);
  const wrongName = path.join(wrongNameDir, 'manifest.json');
  await writeFile(wrongName, `${JSON.stringify(manifest())}\n`, 'utf8');
  await assert.rejects(
    loadArticleManifest({ manifestPath: wrongName, repoRoot }),
    /filename must be article\.json/
  );
});

test('future manifest and checkpoint versions fail closed', async () => {
  const futureManifest = await fixture(manifest({ version: 999 }));
  await assert.rejects(
    loadArticleManifest(futureManifest),
    /unsupported Article manifest version: 999/
  );

  const raw = manifest();
  raw.translationCheckpoint = { version: 999 };
  const futureCheckpoint = await fixture(raw);
  await assert.rejects(
    loadArticleManifest(futureCheckpoint),
    /unsupported translation checkpoint version: 999/
  );
});
