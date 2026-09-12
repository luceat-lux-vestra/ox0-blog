import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  acceptArticleSemanticReview,
  acceptArticleTranslationReview,
  requestArticleSemanticReview
} from '../src/article-review-operations.mjs';
import { evaluateArticleBundle } from '../src/article-evaluation.mjs';
import { loadArticleManifest } from '../src/article-manifest.mjs';
import { MarkedCompiler } from '../src/compiler/marked-compiler.mjs';
import { ARTICLE_READINESS_REVIEW_CONTRACT_VERSION } from '../src/article-readiness.mjs';
import { TRANSLATION_REVIEW_CONTRACT_VERSION } from '../src/translation-checkpoint.mjs';

function publication() {
  return {
    tags: [], featureImage: null, featureImageAlt: null,
    featured: false, visibility: 'public', canonicalUrl: null
  };
}

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-article-review-op-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(path.join(repoRoot, 'assets'), { recursive: true });
  await writeFile(path.join(articleDir, 'ko-KR.md'), '# 본문\n', 'utf8');
  await writeFile(path.join(articleDir, 'en.md'), '# Body\n', 'utf8');
  const manifestPath = path.join(articleDir, 'article.json');
  await writeFile(manifestPath, `${JSON.stringify({
    version: 1,
    articleId: 'article-1',
    requiredLocales: ['ko-KR', 'en'],
    variants: [
      {
        variantId: 'variant-ko', locale: 'ko-KR', source: 'ko-KR.md',
        title: '제목', excerpt: '요약', slug: 'article-ko', publication: publication()
      },
      {
        variantId: 'variant-en', locale: 'en', source: 'en.md',
        title: 'Title', excerpt: 'Summary', slug: 'article-en', publication: publication()
      }
    ],
    translationCheckpoint: null,
    readiness: { epoch: 0, checkpoint: null, invalidations: [] }
  }, null, 2)}\n`, 'utf8');
  return { repoRoot, articleDir, manifestPath };
}

async function currentEvaluation(value) {
  const loaded = await loadArticleManifest(value);
  return evaluateArticleBundle({
    bundle: loaded.bundle,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot,
    publicationByLocale: loaded.publicationByLocale
  });
}

function translationPass(fingerprints) {
  return {
    result: 'PASS',
    kind: 'agent',
    contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION,
    reviewedFingerprints: fingerprints
  };
}

function readinessPass(sourceFingerprint, reviewedInvalidationIds) {
  return {
    result: 'PASS',
    kind: 'agent',
    contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
    reviewedSourceFingerprint: sourceFingerprint,
    reviewedInvalidationIds
  };
}

test('translation review acceptance persists exact checkpoint without auto-advancing Article readiness', async () => {
  const value = await fixture();
  const current = await currentEvaluation(value);
  const accepted = await acceptArticleTranslationReview({
    ...value,
    review: translationPass(current.currentTranslationFingerprints)
  });
  assert.deepEqual(accepted.translation, { state: 'SYNCED' });
  assert.deepEqual(accepted.readiness, { state: 'DRAFT' });
  assert.match(accepted.manifestText, /"translationCheckpoint": \{/);

  await writeFile(value.manifestPath, accepted.manifestText, 'utf8');
  const recovered = await currentEvaluation(value);
  assert.deepEqual(recovered.translation, { state: 'SYNCED' });
  assert.deepEqual(recovered.readiness, { state: 'DRAFT' });
});

test('translation review cannot accept fingerprints other than exact current source', async () => {
  const value = await fixture();
  const current = await currentEvaluation(value);
  const reviewed = {
    ...current.currentTranslationFingerprints,
    en: `sha256:${'f'.repeat(64)}`
  };
  await assert.rejects(
    acceptArticleTranslationReview({ ...value, review: translationPass(reviewed) }),
    /does not cover the exact current fingerprints/
  );
});

test('readiness request and acceptance remain separate durable operations', async () => {
  const value = await fixture();
  const current = await currentEvaluation(value);
  const translation = await acceptArticleTranslationReview({
    ...value,
    review: translationPass(current.currentTranslationFingerprints)
  });
  await writeFile(value.manifestPath, translation.manifestText, 'utf8');

  const requested = await requestArticleSemanticReview({
    ...value,
    origin: 'blog-audit',
    reference: 'article-review:initial'
  });
  assert.equal(requested.readiness.state, 'REVIEW_REQUIRED');
  assert.equal(requested.bundle.readinessEpoch, 1);
  assert.equal(requested.bundle.readinessInvalidations.length, 1);
  const invalidationId = requested.bundle.readinessInvalidations[0].id;
  await writeFile(value.manifestPath, requested.manifestText, 'utf8');

  const before = await currentEvaluation(value);
  const accepted = await acceptArticleSemanticReview({
    ...value,
    review: readinessPass(before.articleSourceFingerprint, [invalidationId])
  });
  assert.deepEqual(accepted.translation, { state: 'SYNCED' });
  assert.deepEqual(accepted.readiness, { state: 'READY' });
  assert.equal(accepted.bundle.readinessCheckpoint.reviewedEpoch, 1);
  assert.deepEqual(accepted.bundle.readinessCheckpoint.resolvedInvalidationIds, [invalidationId]);
});

test('Article semantic review cannot be accepted before translation is SYNCED', async () => {
  const value = await fixture();
  const current = await currentEvaluation(value);
  await assert.rejects(
    acceptArticleSemanticReview({
      ...value,
      review: readinessPass(current.articleSourceFingerprint, [])
    }),
    /translation state is not SYNCED|can be accepted only from REVIEW_REQUIRED/
  );
});
