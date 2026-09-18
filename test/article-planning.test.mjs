import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { evaluateArticleBundle } from '../src/article-evaluation.mjs';
import { loadArticleManifest, serializeArticleManifest } from '../src/article-manifest.mjs';
import { planArticleProjection } from '../src/article-planning.mjs';
import { normalizeArticleBundle } from '../src/article-bundle.mjs';
import {
  ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
  createArticleReadinessCheckpoint
} from '../src/article-readiness.mjs';
import { MarkedCompiler } from '../src/compiler/marked-compiler.mjs';
import { writePassingClaimProof } from './helpers/claim-proof-fixture.mjs';
import {
  TRANSLATION_REVIEW_CONTRACT_VERSION,
  createTranslationCheckpoint
} from '../src/translation-checkpoint.mjs';

class ReadOnlyGhostClient {
  constructor() { this.calls = []; }
  async getPostsBySourceTag(tag) { this.calls.push(['identity', tag]); return []; }
  async getPostBySlug(slug) { this.calls.push(['post-slug', slug]); return null; }
  async getPageBySlug(slug) { this.calls.push(['page-slug', slug]); return null; }
  async createPost() { throw new Error('planning must not mutate Ghost'); }
  async updatePost() { throw new Error('planning must not mutate Ghost'); }
  async updatePostMetadata() { throw new Error('planning must not mutate Ghost'); }
  async uploadImage() { throw new Error('planning must not upload'); }
  async uploadImageBytes() { throw new Error('planning must not upload'); }
}

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

function rawManifest({ featureImage = null, featureImageAlt = null } = {}) {
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
        publication: publication({ featureImage, featureImageAlt })
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
    readiness: { epoch: 0, checkpoint: null, invalidations: [] }
  };
}

async function fixture({
  localBodyAsset = false,
  remoteBodyAsset = false,
  featureImage = null,
  featureImageAlt = null
} = {}) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-article-plan-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(path.join(repoRoot, 'assets', 'article'), { recursive: true });
  let koBody = '# 본문\n';
  if (localBodyAsset) koBody += '\n![diagram](../../assets/article/diagram.png)\n';
  if (remoteBodyAsset) koBody += '\n![remote](https://cdn.example/content/diagram.png)\n';
  await writeFile(path.join(articleDir, 'ko-KR.md'), koBody, 'utf8');
  await writeFile(path.join(articleDir, 'en.md'), '# Body\n', 'utf8');
  if (localBodyAsset) await writeFile(path.join(repoRoot, 'assets', 'article', 'diagram.png'), 'diagram');
  if (featureImage && !/^https:\/\//.test(featureImage)) {
    await writeFile(path.join(repoRoot, 'assets', 'article', 'cover.png'), 'cover');
  }

  const raw = rawManifest({ featureImage, featureImageAlt });
  const manifestPath = path.join(articleDir, 'article.json');
  await writeFile(manifestPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return { repoRoot, articleDir, manifestPath, coverPath: path.join(repoRoot, 'assets', 'article', 'cover.png') };
}

async function makeReady(value) {
  const loaded = await loadArticleManifest(value);
  const evaluation = await evaluateArticleBundle({
    bundle: loaded.bundle,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot,
    publicationByLocale: loaded.publicationByLocale
  });
  const translationCheckpoint = createTranslationCheckpoint({
    requiredLocales: loaded.bundle.article.requiredLocales,
    currentFingerprints: evaluation.currentTranslationFingerprints,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION,
      reviewedFingerprints: evaluation.currentTranslationFingerprints
    }
  });
  const claimProof = await writePassingClaimProof(value);
  const readinessCheckpoint = createArticleReadinessCheckpoint({
    sourceFingerprint: evaluation.articleSourceFingerprint,
    claimProofFingerprint: claimProof.fingerprint,
    reviewedEpoch: 0,
    review: {
      result: 'PASS',
      kind: 'agent',
      contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
      reviewedSourceFingerprint: evaluation.articleSourceFingerprint,
      reviewedClaimProofFingerprint: claimProof.fingerprint,
      reviewedInvalidationIds: []
    }
  });
  const bundle = normalizeArticleBundle({
    ...loaded.bundle,
    translationCheckpoint,
    readinessCheckpoint
  });
  const text = await serializeArticleManifest({
    bundle,
    publicationByLocale: loaded.publicationByLocale,
    repoRoot: value.repoRoot,
    articleDir: value.articleDir
  });
  await writeFile(value.manifestPath, text, 'utf8');
}

test('draft planning accepts structurally valid DRAFT/UNREVIEWED Article and performs Ghost reads only', async () => {
  const value = await fixture();
  const client = new ReadOnlyGhostClient();
  const plan = await planArticleProjection({
    ...value,
    locale: 'ko-KR',
    action: 'draft',
    client
  });

  assert.deepEqual(plan.translation, { state: 'UNREVIEWED' });
  assert.deepEqual(plan.readiness, { state: 'DRAFT' });
  assert.equal(plan.ghost.operation, 'create');
  assert.equal(plan.ghost.desiredStatus, 'draft');
  assert.ok(client.calls.some(([kind]) => kind === 'identity'));
  assert.ok(client.calls.some(([kind]) => kind === 'post-slug'));
  assert.ok(client.calls.some(([kind]) => kind === 'page-slug'));
});

test('publish planning requires SYNCED + READY before any Ghost access', async () => {
  const value = await fixture();
  const client = new ReadOnlyGhostClient();
  await assert.rejects(
    planArticleProjection({
      ...value,
      locale: 'ko-KR',
      action: 'publish',
      client
    }),
    /requires translation SYNCED/
  );
  assert.deepEqual(client.calls, []);

  await makeReady(value);
  const plan = await planArticleProjection({
    ...value,
    locale: 'ko-KR',
    action: 'publish',
    client
  });
  assert.deepEqual(plan.translation, { state: 'SYNCED' });
  assert.deepEqual(plan.readiness, { state: 'READY' });
  assert.equal(plan.ghost.desiredStatus, 'published');
});

test('draft planning permits remote HTTPS images without granting production trust', async () => {
  const value = await fixture({
    remoteBodyAsset: true,
    featureImage: 'https://cdn.example/content/cover.png',
    featureImageAlt: 'remote cover'
  });
  const client = new ReadOnlyGhostClient();
  const plan = await planArticleProjection({
    ...value,
    locale: 'ko-KR',
    action: 'draft',
    client
  });
  assert.deepEqual(plan.remoteResourceApprovals, []);
  assert.ok(client.calls.length > 0);
});

test('production planning rejects remote resources without host approval before Ghost access', async () => {
  const value = await fixture({
    remoteBodyAsset: true,
    featureImage: 'https://cdn.example/content/cover.png',
    featureImageAlt: 'remote cover'
  });
  await makeReady(value);
  const client = new ReadOnlyGhostClient();
  await assert.rejects(
    planArticleProjection({
      ...value,
      locale: 'ko-KR',
      action: 'publish',
      client
    }),
    /requires host remoteResourcePolicy/
  );
  assert.deepEqual(client.calls, []);
});

test('production planning binds explicit remote-resource approval evidence into the plan', async () => {
  const value = await fixture({
    remoteBodyAsset: true,
    featureImage: 'https://cdn.example/content/cover.png',
    featureImageAlt: 'remote cover'
  });
  await makeReady(value);
  const client = new ReadOnlyGhostClient();
  const seen = [];
  const plan = await planArticleProjection({
    ...value,
    locale: 'ko-KR',
    action: 'publish',
    client,
    remoteResourcePolicy(resource) {
      seen.push(resource);
      return { decision: 'ALLOW', evidence: `trusted-static-v1:${resource.kind}` };
    }
  });
  assert.deepEqual(plan.remoteResourceApprovals, [
    {
      kind: 'body-image',
      href: 'https://cdn.example/content/diagram.png',
      evidence: 'trusted-static-v1:body-image'
    },
    {
      kind: 'feature-image',
      href: 'https://cdn.example/content/cover.png',
      evidence: 'trusted-static-v1:feature-image'
    }
  ]);
  assert.deepEqual(seen.map(({ kind, href, articleId, locale, variantId }) => ({
    kind, href, articleId, locale, variantId
  })), [
    {
      kind: 'body-image',
      href: 'https://cdn.example/content/diagram.png',
      articleId: 'article-1',
      locale: 'ko-KR',
      variantId: 'variant-ko'
    },
    {
      kind: 'feature-image',
      href: 'https://cdn.example/content/cover.png',
      articleId: 'article-1',
      locale: 'ko-KR',
      variantId: 'variant-ko'
    }
  ]);
  assert.ok(client.calls.length > 0);
});

test('production planning propagates host remote-resource denial before Ghost access', async () => {
  const value = await fixture({ remoteBodyAsset: true });
  await makeReady(value);
  const client = new ReadOnlyGhostClient();
  await assert.rejects(
    planArticleProjection({
      ...value,
      locale: 'ko-KR',
      action: 'publish',
      client,
      remoteResourcePolicy() {
        return { decision: 'DENY', reason: 'mutable external image' };
      }
    }),
    /mutable external image/
  );
  assert.deepEqual(client.calls, []);
});

test('local body assets fail before Ghost planning until target AssetPublisher exists', async () => {
  const value = await fixture({ localBodyAsset: true });
  const client = new ReadOnlyGhostClient();
  await assert.rejects(
    planArticleProjection({
      ...value,
      locale: 'ko-KR',
      action: 'draft',
      client
    }),
    /requires a host AssetPublisher/
  );
  assert.deepEqual(client.calls, []);
});

test('local feature image is allowed in read-only planning and reported as upload without mutation', async () => {
  const value = await fixture({
    featureImage: 'assets/article/cover.png',
    featureImageAlt: '표지 설명'
  });
  const client = new ReadOnlyGhostClient();
  const plan = await planArticleProjection({
    ...value,
    locale: 'ko-KR',
    action: 'draft',
    client
  });
  assert.equal(plan.ghost.featureImage.action, 'upload');
  assert.equal(plan.ghost.featureImage.ref, 'assets/article/cover.png');
  assert.match(plan.ghost.featureImage.fingerprint, /^sha256:[a-f0-9]{64}$/);
});

test('feature image bytes changed after READY checkpoint block publish planning before Ghost access', async () => {
  const value = await fixture({
    featureImage: 'assets/article/cover.png',
    featureImageAlt: '표지 설명'
  });
  await makeReady(value);
  await writeFile(value.coverPath, 'changed-cover');
  const client = new ReadOnlyGhostClient();
  await assert.rejects(
    planArticleProjection({
      ...value,
      locale: 'ko-KR',
      action: 'publish',
      client
    }),
    /requires translation SYNCED/
  );
  assert.deepEqual(client.calls, []);
});

test('requested locale must be configured and present', async () => {
  const value = await fixture();
  const client = new ReadOnlyGhostClient();
  await assert.rejects(
    planArticleProjection({ ...value, locale: 'ja', action: 'draft', client }),
    /locale is not required/
  );
  assert.deepEqual(client.calls, []);
});
