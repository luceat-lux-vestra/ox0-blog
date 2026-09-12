import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { evaluateArticleBundle } from '../src/article-evaluation.mjs';
import { ARTICLE_BUNDLE_CONTRACT_VERSION, normalizeArticleBundle } from '../src/article-bundle.mjs';
import {
  ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
  createArticleReadinessCheckpoint
} from '../src/article-readiness.mjs';
import { MarkedCompiler } from '../src/compiler/marked-compiler.mjs';
import {
  TRANSLATION_REVIEW_CONTRACT_VERSION,
  createTranslationCheckpoint
} from '../src/translation-checkpoint.mjs';
import { translationFingerprintV1 } from '../src/translation-fingerprint.mjs';

function variant(overrides = {}) {
  return {
    variantId: 'variant-ko',
    locale: 'ko-KR',
    title: '제목',
    excerpt: '요약',
    slug: 'article-ko',
    body: '# 본문\n',
    sourcePath: '/repo/posts/article/ko-KR.md',
    ...overrides
  };
}

function publication(featureImage, featureImageAlt) {
  return {
    tags: [],
    featureImage,
    featureImageAlt,
    featured: false,
    visibility: 'public',
    canonicalUrl: null
  };
}

function translationReview(fingerprints) {
  return {
    result: 'PASS',
    kind: 'agent',
    contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION,
    reviewedFingerprints: fingerprints
  };
}

function readinessReview(sourceFingerprint) {
  return {
    result: 'PASS',
    kind: 'agent',
    contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
    reviewedSourceFingerprint: sourceFingerprint,
    reviewedInvalidationIds: []
  };
}

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-semantic-publication-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  const assetDir = path.join(repoRoot, 'assets', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  const koPath = path.join(articleDir, 'ko-KR.md');
  const enPath = path.join(articleDir, 'en.md');
  const coverPath = path.join(assetDir, 'cover.png');
  await writeFile(koPath, '# 본문\n', 'utf8');
  await writeFile(enPath, '# Body\n', 'utf8');
  await writeFile(coverPath, 'cover-v1');

  const bundle = {
    version: ARTICLE_BUNDLE_CONTRACT_VERSION,
    article: {
      articleId: 'article-1',
      requiredLocales: ['ko-KR', 'en'],
      variants: [
        { ...variant(), sourcePath: koPath },
        {
          variantId: 'variant-en', locale: 'en', title: 'Title', excerpt: 'Summary',
          slug: 'article-en', body: '# Body\n', sourcePath: enPath
        }
      ]
    },
    translationCheckpoint: null,
    readinessEpoch: 0,
    readinessCheckpoint: null,
    readinessInvalidations: []
  };
  const publicationByLocale = new Map([
    ['ko-KR', publication(coverPath, '표지 설명')],
    ['en', publication(null, null)]
  ]);
  return { repoRoot, coverPath, bundle, publicationByLocale };
}

async function reviewedFixture() {
  const value = await fixture();
  const initial = await evaluateArticleBundle({
    bundle: value.bundle,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot,
    publicationByLocale: value.publicationByLocale
  });
  const translationCheckpoint = createTranslationCheckpoint({
    requiredLocales: value.bundle.article.requiredLocales,
    currentFingerprints: initial.currentTranslationFingerprints,
    review: translationReview(initial.currentTranslationFingerprints)
  });
  const readinessCheckpoint = createArticleReadinessCheckpoint({
    sourceFingerprint: initial.articleSourceFingerprint,
    reviewedEpoch: 0,
    review: readinessReview(initial.articleSourceFingerprint)
  });
  return {
    ...value,
    bundle: normalizeArticleBundle({
      ...value.bundle,
      translationCheckpoint,
      readinessCheckpoint
    })
  };
}

test('translation fingerprint includes semantic feature image ref, digest and localized alt text', () => {
  const base = translationFingerprintV1(variant(), {
    semanticPublication: {
      featureImageRef: 'assets/article/cover.png',
      featureImageFingerprint: `sha256:${'a'.repeat(64)}`,
      featureImageAlt: '표지 설명'
    }
  });
  assert.notEqual(base, translationFingerprintV1(variant(), {
    semanticPublication: {
      featureImageRef: 'assets/article/cover.png',
      featureImageFingerprint: `sha256:${'a'.repeat(64)}`,
      featureImageAlt: '다른 설명'
    }
  }));
  assert.notEqual(base, translationFingerprintV1(variant(), {
    semanticPublication: {
      featureImageRef: 'assets/article/cover.png',
      featureImageFingerprint: `sha256:${'b'.repeat(64)}`,
      featureImageAlt: '표지 설명'
    }
  }));
});

test('localized feature image alt change invalidates translation and Article readiness', async () => {
  const value = await reviewedFixture();
  value.publicationByLocale.set('ko-KR', publication(value.coverPath, '변경된 표지 설명'));
  const changed = await evaluateArticleBundle({
    bundle: value.bundle,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot,
    publicationByLocale: value.publicationByLocale
  });
  assert.deepEqual(changed.translation, {
    state: 'STALE', changedLocales: ['ko-KR'], staleLocales: ['en']
  });
  assert.deepEqual(changed.readiness, { state: 'REVIEW_REQUIRED', reason: 'SOURCE_CHANGED' });
});

test('local feature image byte change alone invalidates translation and Article readiness', async () => {
  const value = await reviewedFixture();
  await writeFile(value.coverPath, 'cover-v2');
  const changed = await evaluateArticleBundle({
    bundle: value.bundle,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot,
    publicationByLocale: value.publicationByLocale
  });
  assert.deepEqual(changed.translation, {
    state: 'STALE', changedLocales: ['ko-KR'], staleLocales: ['en']
  });
  assert.deepEqual(changed.readiness, { state: 'REVIEW_REQUIRED', reason: 'SOURCE_CHANGED' });
});

test('semantic publication evidence must be complete for every present LocaleVariant when supplied', async () => {
  const value = await fixture();
  value.publicationByLocale.delete('en');
  await assert.rejects(
    evaluateArticleBundle({
      bundle: value.bundle,
      compiler: new MarkedCompiler(),
      repoRoot: value.repoRoot,
      publicationByLocale: value.publicationByLocale
    }),
    /publication metadata is missing for LocaleVariant: en/
  );
});
