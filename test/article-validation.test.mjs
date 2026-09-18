import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
  createArticleReadinessCheckpoint
} from '../src/article-readiness.mjs';
import { serializeArticleManifest } from '../src/article-manifest.mjs';
import { normalizeArticleBundle } from '../src/article-bundle.mjs';
import { collectArticleManifestPaths, validateArticleRepository } from '../src/article-validation.mjs';
import {
  TRANSLATION_REVIEW_CONTRACT_VERSION,
  createTranslationCheckpoint
} from '../src/translation-checkpoint.mjs';

function publication() {
  return {
    tags: [],
    featureImage: null,
    featureImageAlt: null,
    featured: false,
    visibility: 'public',
    canonicalUrl: null
  };
}

function rawArticle(name, {
  articleId = `article-${name}`,
  koVariantId = `${name}-ko`,
  enVariantId = `${name}-en`,
  koSlug = `${name}-ko`,
  enSlug = `${name}-en`,
  koTitle = `${name} 제목`,
  enTitle = `${name} title`
} = {}) {
  return {
    version: 1,
    articleId,
    requiredLocales: ['ko-KR', 'en'],
    variants: [
      {
        variantId: koVariantId,
        locale: 'ko-KR',
        source: 'ko-KR.md',
        title: koTitle,
        excerpt: '요약',
        slug: koSlug,
        publication: publication()
      },
      {
        variantId: enVariantId,
        locale: 'en',
        source: 'en.md',
        title: enTitle,
        excerpt: 'Summary',
        slug: enSlug,
        publication: publication()
      }
    ],
    translationCheckpoint: null,
    readiness: { epoch: 0, checkpoint: null, invalidations: [] }
  };
}

async function repoFixture(articles) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-article-validation-'));
  await mkdir(path.join(repoRoot, 'posts'), { recursive: true });
  await mkdir(path.join(repoRoot, 'assets'), { recursive: true });
  for (const [name, raw] of Object.entries(articles)) {
    const articleDir = path.join(repoRoot, 'posts', name);
    await mkdir(articleDir, { recursive: true });
    await writeFile(path.join(articleDir, 'ko-KR.md'), `# ${name} 한국어\n`, 'utf8');
    await writeFile(path.join(articleDir, 'en.md'), `# ${name} English\n`, 'utf8');
    await writeFile(path.join(articleDir, 'article.json'), `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  }
  return repoRoot;
}

test('target repository validation discovers article.json work units and allows DRAFT/UNREVIEWED source', async () => {
  const repoRoot = await repoFixture({ alpha: rawArticle('alpha'), beta: rawArticle('beta') });
  assert.deepEqual(await collectArticleManifestPaths(repoRoot), [
    'posts/alpha/article.json',
    'posts/beta/article.json'
  ]);

  const validated = await validateArticleRepository(repoRoot);
  assert.equal(validated.length, 2);
  assert.deepEqual(validated[0].evaluation.translation, { state: 'UNREVIEWED' });
  assert.deepEqual(validated[0].evaluation.readiness, { state: 'DRAFT' });
});

test('repository-wide stable IDs and public Ghost slugs must be unique', async () => {
  for (const [label, betaOverrides, expected] of [
    ['articleId', { articleId: 'article-alpha' }, /duplicate articleId/],
    ['variantId', { koVariantId: 'alpha-ko' }, /duplicate variantId/],
    ['slug', { koSlug: 'alpha-ko' }, /duplicate slug/]
  ]) {
    const repoRoot = await repoFixture({
      alpha: rawArticle('alpha'),
      beta: rawArticle('beta', betaOverrides)
    });
    await assert.rejects(validateArticleRepository(repoRoot), expected, label);
  }
});

test('titles are presentation content, not repository identity', async () => {
  const repoRoot = await repoFixture({
    alpha: rawArticle('alpha', { koTitle: 'OAuth 2.0', enTitle: 'OAuth 2.0' }),
    beta: rawArticle('beta', { koTitle: 'OAuth 2.0', enTitle: 'OAuth 2.0' })
  });
  const validated = await validateArticleRepository(repoRoot);
  assert.equal(validated.length, 2);
});

test('requireReady is a separate guard and does not redefine ordinary source validation', async () => {
  const repoRoot = await repoFixture({ alpha: rawArticle('alpha') });
  const draft = await validateArticleRepository(repoRoot);
  await assert.rejects(
    validateArticleRepository(repoRoot, { requireReady: true }),
    /translation is not SYNCED/
  );

  const loaded = draft[0];
  const fingerprints = loaded.evaluation.currentTranslationFingerprints;
  const translationCheckpoint = createTranslationCheckpoint({
    requiredLocales: loaded.bundle.article.requiredLocales,
    currentFingerprints: fingerprints,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION,
      reviewedFingerprints: fingerprints
    }
  });
  const readinessCheckpoint = createArticleReadinessCheckpoint({
    sourceFingerprint: loaded.evaluation.articleSourceFingerprint,
    reviewedEpoch: 0,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
      reviewedSourceFingerprint: loaded.evaluation.articleSourceFingerprint,
      reviewedInvalidationIds: []
    }
  });
  const readyBundle = normalizeArticleBundle({
    ...loaded.bundle,
    translationCheckpoint,
    readinessCheckpoint
  });
  const serialized = await serializeArticleManifest({
    bundle: readyBundle,
    publicationByLocale: loaded.publicationByLocale,
    repoRoot,
    articleDir: loaded.articleDir
  });
  await writeFile(loaded.manifestPath, serialized, 'utf8');

  const ready = await validateArticleRepository(repoRoot, { requireReady: true });
  assert.deepEqual(ready[0].evaluation.translation, { state: 'SYNCED' });
  assert.deepEqual(ready[0].evaluation.readiness, { state: 'READY' });
});

test('requested manifest selection preserves full-repository validation', async () => {
  const repoRoot = await repoFixture({ alpha: rawArticle('alpha'), beta: rawArticle('beta') });
  const selected = await validateArticleRepository(repoRoot, {
    requested: ['posts/beta/article.json']
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].bundle.article.articleId, 'article-beta');

  await assert.rejects(
    validateArticleRepository(repoRoot, { requested: ['posts/missing/article.json'] }),
    /requested Article manifest not found/
  );
});

test('case-variant article.json names and symlinks under posts fail closed', async () => {
  const repoRoot = await repoFixture({ alpha: rawArticle('alpha') });
  const caseDir = path.join(repoRoot, 'posts', 'case');
  await mkdir(caseDir);
  await writeFile(path.join(caseDir, 'Article.json'), '{}', 'utf8');
  await assert.rejects(collectArticleManifestPaths(repoRoot), /exact lowercase article\.json/);

  const cleanRoot = await repoFixture({ alpha: rawArticle('alpha') });
  await symlink(
    path.join(cleanRoot, 'posts', 'alpha'),
    path.join(cleanRoot, 'posts', 'alias')
  );
  await assert.rejects(collectArticleManifestPaths(cleanRoot), /symlinks are not allowed/);
});
