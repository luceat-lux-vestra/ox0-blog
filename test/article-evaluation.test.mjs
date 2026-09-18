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

async function fixture({ includeEnglish = true } = {}) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-article-eval-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  const assetDir = path.join(repoRoot, 'assets', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  const koPath = path.join(articleDir, 'ko-KR.md');
  const enPath = path.join(articleDir, 'en.md');
  const assetPath = path.join(assetDir, 'diagram.png');
  await writeFile(assetPath, 'asset-v1');
  await writeFile(koPath, '# 제목\n\n![diagram](../../assets/article/diagram.png)\n', 'utf8');
  if (includeEnglish) await writeFile(enPath, '# Title\n', 'utf8');

  const variants = [
    {
      variantId: 'variant-ko',
      locale: 'ko-KR',
      title: '제목',
      excerpt: '요약',
      slug: 'article-ko',
      body: '# 제목\n\n![diagram](../../assets/article/diagram.png)\n',
      sourcePath: koPath
    }
  ];
  if (includeEnglish) {
    variants.push({
      variantId: 'variant-en',
      locale: 'en',
      title: 'Title',
      excerpt: 'Summary',
      slug: 'article-en',
      body: '# Title\n',
      sourcePath: enPath
    });
  }

  return {
    repoRoot,
    assetPath,
    bundle: {
      version: ARTICLE_BUNDLE_CONTRACT_VERSION,
      article: {
        articleId: 'article-1',
        requiredLocales: ['ko-KR', 'en'],
        variants
      },
      translationCheckpoint: null,
      readinessEpoch: 0,
      readinessCheckpoint: null,
      readinessInvalidations: []
    }
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

test('fresh evaluation compiles present variants, hashes local assets and derives UNREVIEWED + DRAFT', async () => {
  const value = await fixture();
  const evaluated = await evaluateArticleBundle({
    bundle: value.bundle,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot
  });

  assert.deepEqual(evaluated.translation, { state: 'UNREVIEWED' });
  assert.deepEqual(evaluated.readiness, { state: 'DRAFT' });
  assert.match(evaluated.currentTranslationFingerprints['ko-KR'], /^sha256:[a-f0-9]{64}$/);
  assert.match(evaluated.currentTranslationFingerprints.en, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(evaluated.variantEvidence.get('ko-KR').materialAssets.map((asset) => asset.ref), [
    'assets/article/diagram.png'
  ]);
});

test('asset-byte change alone makes the reviewed locale stale and Article readiness SOURCE_CHANGED', async () => {
  const value = await fixture();
  const initial = await evaluateArticleBundle({
    bundle: value.bundle,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot
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
  const reviewed = normalizeArticleBundle({
    ...value.bundle,
    translationCheckpoint,
    readinessCheckpoint
  });

  const current = await evaluateArticleBundle({
    bundle: reviewed,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot
  });
  assert.deepEqual(current.translation, { state: 'SYNCED' });
  assert.deepEqual(current.readiness, { state: 'READY' });

  await writeFile(value.assetPath, 'asset-v2');
  const changed = await evaluateArticleBundle({
    bundle: reviewed,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot
  });
  assert.deepEqual(changed.translation, {
    state: 'STALE',
    changedLocales: ['ko-KR'],
    staleLocales: ['en']
  });
  assert.deepEqual(changed.readiness, {
    state: 'REVIEW_REQUIRED',
    reason: 'SOURCE_CHANGED'
  });
});

test('remote resource observations remain non-material while their authored URL remains in body fingerprint', async () => {
  const value = await fixture();
  const ko = value.bundle.article.variants[0];
  ko.body = '# 제목\n\n![remote](HTTPS://EXAMPLE.COM/diagram.png)\n';
  const evaluated = await evaluateArticleBundle({
    bundle: value.bundle,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot
  });
  assert.deepEqual(evaluated.variantEvidence.get('ko-KR').materialAssets, []);
  assert.deepEqual(evaluated.variantEvidence.get('ko-KR').remoteResources, [{
    kind: 'image',
    href: 'https://example.com/diagram.png'
  }]);
});

test('missing required LocaleVariant derives INCOMPLETE without inventing a fingerprint', async () => {
  const value = await fixture({ includeEnglish: false });
  const evaluated = await evaluateArticleBundle({
    bundle: value.bundle,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot
  });
  assert.deepEqual(evaluated.translation, {
    state: 'INCOMPLETE',
    missingLocales: ['en']
  });
  assert.deepEqual(evaluated.readiness, { state: 'DRAFT' });
  assert.equal(Object.hasOwn(evaluated.currentTranslationFingerprints, 'en'), false);
  assert.equal(evaluated.articleSourceFingerprint, null);
});

test('compiler/source validation failures abort Article evaluation', async () => {
  const value = await fixture();
  value.bundle.article.variants[0].body = '<img src="../../assets/article/diagram.png">\n';
  await assert.rejects(
    evaluateArticleBundle({
      bundle: value.bundle,
      compiler: new MarkedCompiler(),
      repoRoot: value.repoRoot
    }),
    /raw HTML is not supported/
  );
});
