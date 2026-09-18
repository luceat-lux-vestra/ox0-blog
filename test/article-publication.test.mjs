import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ARTICLE_PUBLICATION_AUTHORIZATION_VERSION,
  ArticlePublicationError,
  synchronizeArticlePublication
} from '../src/article-publication.mjs';
import { prepareArticlePublicationOperation } from '../src/article-planning.mjs';
import {
  acceptArticleSemanticReview,
  acceptArticleTranslationReview,
  requestArticleSemanticReview
} from '../src/article-review-operations.mjs';
import { evaluateArticleBundle } from '../src/article-evaluation.mjs';
import { loadArticleManifest } from '../src/article-manifest.mjs';
import { MarkedCompiler } from '../src/compiler/marked-compiler.mjs';
import { writePassingClaimProof } from './helpers/claim-proof-fixture.mjs';
import { ARTICLE_READINESS_REVIEW_CONTRACT_VERSION } from '../src/article-readiness.mjs';
import { TRANSLATION_REVIEW_CONTRACT_VERSION } from '../src/translation-checkpoint.mjs';

class FakeGhostClient {
  constructor({
    failSlug = null,
    failStampSlug = null,
    injectOwnerAtIdentityRead = null,
    log = []
  } = {}) {
    this.posts = new Map();
    this.failSlug = failSlug;
    this.failStampSlug = failStampSlug;
    this.injectOwnerAtIdentityRead = injectOwnerAtIdentityRead;
    this.log = log;
    this.identityReads = 0;
    this.sequence = 0;
  }
  names(post) {
    return (post?.tags ?? []).map((tag) => typeof tag === 'string' ? tag : tag?.name).filter(Boolean);
  }
  async getPostsBySourceTag(tag) {
    this.log.push(['ghost-read-identity', tag]);
    this.identityReads += 1;
    if (this.injectOwnerAtIdentityRead === this.identityReads) {
      const id = `injected-${this.identityReads}`;
      this.posts.set(id, {
        id,
        title: 'external', slug: `external-${this.identityReads}`, lexical: null,
        custom_excerpt: null, feature_image: null, feature_image_alt: null,
        featured: false, visibility: 'public', status: 'draft', canonical_url: null,
        updated_at: `2026-01-01T00:00:${String(this.identityReads).padStart(2, '0')}.000Z`,
        tags: [{ name: tag }]
      });
    }
    return [...this.posts.values()].filter((post) => this.names(post).includes(tag));
  }
  async getPostBySlug(slug) {
    this.log.push(['ghost-read-slug', slug]);
    return [...this.posts.values()].find((post) => post.slug === slug) ?? null;
  }
  async getPageBySlug(slug) {
    this.log.push(['ghost-read-page', slug]);
    return null;
  }
  async createPost(payload) {
    this.log.push(['ghost-create', payload.slug]);
    if (payload.slug === this.failSlug) throw new Error(`injected create failure: ${payload.slug}`);
    this.sequence += 1;
    const id = `post-${this.sequence}`;
    const post = {
      ...structuredClone(payload),
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: `2026-01-02T00:00:${String(this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }
  async updatePost(id, payload) {
    this.log.push(['ghost-update', id]);
    const current = this.posts.get(id);
    const post = {
      ...current,
      ...structuredClone(payload),
      id,
      tags: payload.tags ? payload.tags.map((name) => ({ name })) : current.tags,
      updated_at: `2026-01-03T00:00:${String(++this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }
  async getPostById(id) {
    this.log.push(['ghost-read-id', id]);
    return this.posts.get(id) ?? null;
  }
  async updatePostMetadata(id, payload) {
    this.log.push(['ghost-stamp', id]);
    const current = this.posts.get(id);
    if (current?.slug === this.failStampSlug) {
      throw new Error(`injected metadata stamp failure: ${current.slug}`);
    }
    const post = {
      ...current,
      ...structuredClone(payload),
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: `2026-01-04T00:00:${String(++this.sequence).padStart(2, '0')}.000Z`
    };
    this.posts.set(id, post);
    return post;
  }
  async uploadImageBytes() { throw new Error('feature image not expected in this fixture'); }
  async uploadImage() { throw new Error('feature image not expected in this fixture'); }
}

class FakeAssetPublisher {
  constructor(log = [], afterPublish = null) { this.log = log; this.afterPublish = afterPublish; }
  async planAsset(asset) {
    this.log.push(['asset-plan', asset.ref]);
    return {
      action: 'publish',
      url: `https://assets.example/${asset.fingerprint.slice('sha256:'.length)}/${asset.filename}`,
      ref: asset.ref,
      fingerprint: asset.fingerprint
    };
  }
  async publishAsset(asset, bytes, plan) {
    this.log.push(['asset-publish', asset.ref, Buffer.from(bytes).toString('utf8')]);
    if (this.afterPublish) await this.afterPublish(asset, bytes, plan);
    return { url: plan.url };
  }
}

function publication() {
  return {
    tags: [], featureImage: null, featureImageAlt: null,
    featured: false, visibility: 'public', canonicalUrl: null
  };
}

async function fixture({ englishLocalAsset = false, englishRemoteAsset = false } = {}) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-article-publish-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  const assetDir = path.join(repoRoot, 'assets', 'article');
  const koPath = path.join(articleDir, 'ko-KR.md');
  const enPath = path.join(articleDir, 'en.md');
  await mkdir(articleDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  await writeFile(koPath, '# 본문\n', 'utf8');
  let enBody = '# Body\n';
  if (englishLocalAsset) enBody += '\n![diagram](../../assets/article/diagram.png)\n';
  if (englishRemoteAsset) enBody += '\n![remote](https://cdn.example/content/diagram.png)\n';
  await writeFile(enPath, enBody, 'utf8');
  if (englishLocalAsset) await writeFile(path.join(assetDir, 'diagram.png'), 'diagram-v1');
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
  return { repoRoot, articleDir, manifestPath, koPath, enPath };
}

async function evaluation(value) {
  const loaded = await loadArticleManifest(value);
  return evaluateArticleBundle({
    bundle: loaded.bundle,
    compiler: new MarkedCompiler(),
    repoRoot: value.repoRoot,
    publicationByLocale: loaded.publicationByLocale
  });
}

async function makeReady(value) {
  const current = await evaluation(value);
  const translation = await acceptArticleTranslationReview({
    ...value,
    review: {
      result: 'PASS', kind: 'agent', contractVersion: TRANSLATION_REVIEW_CONTRACT_VERSION,
      reviewedFingerprints: current.currentTranslationFingerprints
    }
  });
  await writeFile(value.manifestPath, translation.manifestText, 'utf8');
  const requested = await requestArticleSemanticReview({ ...value });
  const id = requested.bundle.readinessInvalidations[0].id;
  await writeFile(value.manifestPath, requested.manifestText, 'utf8');
  const before = await evaluation(value);
  const claimProof = await writePassingClaimProof(value);
  const accepted = await acceptArticleSemanticReview({
    ...value,
    review: {
      result: 'PASS', kind: 'agent', contractVersion: ARTICLE_READINESS_REVIEW_CONTRACT_VERSION,
      reviewedSourceFingerprint: before.articleSourceFingerprint,
      reviewedClaimProofFingerprint: claimProof.fingerprint,
      reviewedInvalidationIds: [id]
    }
  });
  await writeFile(value.manifestPath, accepted.manifestText, 'utf8');
}

function authorizationFromPlan(plan) {
  return {
    version: ARTICLE_PUBLICATION_AUTHORIZATION_VERSION,
    kind: 'explicit-production-publication',
    articleId: plan.articleId,
    sourceFingerprints: Object.fromEntries(plan.variants.map((variant) => [variant.locale, variant.sourceFingerprint]))
  };
}

test('Article draft mutation succeeds only after all locale preflight and fresh post-verification', async () => {
  const value = await fixture();
  const client = new FakeGhostClient();
  const result = await synchronizeArticlePublication({ ...value, action: 'draft', client });
  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(result.variants.map((entry) => [entry.locale, entry.state.state]), [
    ['ko-KR', 'DRAFT_CURRENT'],
    ['en', 'DRAFT_CURRENT']
  ]);
  assert.equal([...client.posts.values()].length, 2);
});

test('production publish requires control-owned explicit authorization before planning', async () => {
  const value = await fixture();
  await makeReady(value);
  const client = new FakeGhostClient();
  await assert.rejects(
    synchronizeArticlePublication({ ...value, action: 'publish', client }),
    /explicit task-scoped authorization/
  );
  assert.deepEqual(client.log, []);
});

test('plan-bound production authorization permits exact ready source publication', async () => {
  const value = await fixture();
  await makeReady(value);
  const client = new FakeGhostClient();
  const runtime = await prepareArticlePublicationOperation({ ...value, action: 'publish', client });
  const authorization = authorizationFromPlan(runtime.plan);
  const result = await synchronizeArticlePublication({
    ...value,
    action: 'publish',
    client,
    authorization
  });
  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(result.variants.map((entry) => entry.state.state), [
    'PUBLISHED_CURRENT', 'PUBLISHED_CURRENT'
  ]);
});

test('remote-resource policy evidence drift aborts before every Ghost mutation', async () => {
  const value = await fixture({ englishRemoteAsset: true });
  await makeReady(value);
  const client = new FakeGhostClient();
  const stablePolicy = () => ({ decision: 'ALLOW', evidence: 'trusted-static-v1' });
  const runtime = await prepareArticlePublicationOperation({
    ...value,
    action: 'publish',
    client,
    remoteResourcePolicy: stablePolicy
  });
  const authorization = authorizationFromPlan(runtime.plan);
  client.log.length = 0;

  let policyCalls = 0;
  await assert.rejects(
    synchronizeArticlePublication({
      ...value,
      action: 'publish',
      client,
      authorization,
      remoteResourcePolicy() {
        policyCalls += 1;
        return {
          decision: 'ALLOW',
          evidence: policyCalls === 1 ? 'trusted-static-v1' : 'trusted-static-v2'
        };
      }
    }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'SOURCE_REVALIDATION');
      assert.match(error.cause.message, /remote-resource approval/);
      return true;
    }
  );
  assert.equal(client.log.some(([kind]) => kind === 'ghost-create' || kind === 'ghost-update'), false);
});

test('body assets publish before the first Ghost mutation and use the planned exact bytes', async () => {
  const value = await fixture({ englishLocalAsset: true });
  const log = [];
  const client = new FakeGhostClient({ log });
  const assetPublisher = new FakeAssetPublisher(log);
  const result = await synchronizeArticlePublication({
    ...value,
    action: 'draft',
    client,
    assetPublisher
  });
  assert.equal(result.status, 'SUCCESS');
  const assetIndex = log.findIndex(([kind]) => kind === 'asset-publish');
  const ghostMutationIndex = log.findIndex(([kind]) => kind === 'ghost-create' || kind === 'ghost-update');
  assert.ok(assetIndex >= 0);
  assert.ok(ghostMutationIndex > assetIndex);
  assert.equal(log[assetIndex][2], 'diagram-v1');
});

test('source change after asset side effects aborts before every Ghost mutation', async () => {
  const value = await fixture({ englishLocalAsset: true });
  const log = [];
  const client = new FakeGhostClient({ log });
  const assetPublisher = new FakeAssetPublisher(log, async () => {
    await writeFile(value.enPath, '# Changed after asset publish\n', 'utf8');
  });

  await assert.rejects(
    synchronizeArticlePublication({
      ...value,
      action: 'draft',
      client,
      assetPublisher
    }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'SOURCE_REVALIDATION');
      assert.equal(error.publishedAssets.length, 1);
      return true;
    }
  );
  assert.equal(log.some(([kind]) => kind === 'ghost-create' || kind === 'ghost-update'), false);
});

test('Ghost ownership created after refreshed planning is rejected before the planned projection mutation', async () => {
  const value = await fixture();
  // Initial aggregate plan consumes four identity reads, refreshed source plan consumes
  // four more, and the first mutation checks its planned observation on read nine.
  const client = new FakeGhostClient({ injectOwnerAtIdentityRead: 9 });
  await assert.rejects(
    synchronizeArticlePublication({ ...value, action: 'draft', client }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'GHOST_MUTATION');
      assert.match(error.cause.message, /became owned after planning/);
      return true;
    }
  );
  assert.equal(client.log.some(([kind]) => kind === 'ghost-create'), false);
});

test('second locale create failure never returns aggregate success and recovers mixed actual states', async () => {
  const value = await fixture();
  const client = new FakeGhostClient({ failSlug: 'article-en' });
  await assert.rejects(
    synchronizeArticlePublication({ ...value, action: 'draft', client }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'GHOST_MUTATION');
      assert.deepEqual(error.recovery.map((entry) => [entry.locale, entry.state.state]), [
        ['ko-KR', 'DRAFT_CURRENT'],
        ['en', 'NOT_PROJECTED']
      ]);
      return true;
    }
  );
});

test('post created before second-locale sync-stamp failure is recovered as reconciliation-required, not NOT_PROJECTED', async () => {
  const value = await fixture();
  const client = new FakeGhostClient({ failStampSlug: 'article-en' });
  await assert.rejects(
    synchronizeArticlePublication({ ...value, action: 'draft', client }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'GHOST_MUTATION');
      assert.match(error.cause.message, /metadata stamp failure/);
      assert.deepEqual(error.recovery.map((entry) => [entry.locale, entry.state.state]), [
        ['ko-KR', 'DRAFT_CURRENT'],
        ['en', 'RECONCILIATION_REQUIRED']
      ]);
      assert.match(error.recovery[1].state.diagnostic, /not managed by ox0-blog/);
      return true;
    }
  );
  assert.equal([...client.posts.values()].some((post) => post.slug === 'article-en'), true);
});
