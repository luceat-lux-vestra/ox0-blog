import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ArticlePublicationError,
  synchronizeArticlePublication
} from '../src/article-publication.mjs';

class FailingAfterImageUploadGhostClient {
  constructor({ uploadUrl = 'https://ghost.example/content/images/cover.png' } = {}) {
    this.uploads = [];
    this.uploadUrl = uploadUrl;
    this.createCalls = 0;
  }
  async getPostsBySourceTag() { return []; }
  async getPostBySlug() { return null; }
  async getPageBySlug() { return null; }
  async uploadImageBytes(file, ref) {
    const upload = {
      ref,
      filename: file.filename,
      url: this.uploadUrl
    };
    this.uploads.push(upload);
    return { url: upload.url };
  }
  async createPost() {
    this.createCalls += 1;
    throw new Error('injected post create failure after feature image upload');
  }
}

class TransportRejectingAfterUploadGhostClient extends FailingAfterImageUploadGhostClient {
  async uploadImageBytes(file, ref) {
    this.uploads.push({ ref, filename: file.filename, url: null });
    const error = new Error('Ghost image upload response URL must use https');
    error.name = 'GhostImageUploadResponseError';
    error.ghostImageUploadSideEffect = true;
    error.uploadEvidence = { url: 'http://ghost.example/content/images/cover.png' };
    throw error;
  }
}

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-feature-side-effect-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  const assetDir = path.join(repoRoot, 'assets', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(articleDir, 'ko-KR.md'), '# 본문\n', 'utf8');
  await writeFile(path.join(assetDir, 'cover.png'), 'cover-v1');
  const manifestPath = path.join(articleDir, 'article.json');
  await writeFile(manifestPath, `${JSON.stringify({
    version: 1,
    articleId: 'article-1',
    requiredLocales: ['ko-KR'],
    variants: [
      {
        variantId: 'variant-ko',
        locale: 'ko-KR',
        source: 'ko-KR.md',
        title: '제목',
        excerpt: '요약',
        slug: 'article-ko',
        publication: {
          tags: [],
          featureImage: 'assets/article/cover.png',
          featureImageAlt: '표지',
          featured: false,
          visibility: 'public',
          canonicalUrl: null
        }
      }
    ],
    translationCheckpoint: null,
    readiness: { epoch: 0, checkpoint: null, invalidations: [] }
  }, null, 2)}\n`, 'utf8');
  return { repoRoot, manifestPath };
}

test('Article mutation surfaces successful feature-image upload when later Ghost post creation fails', async () => {
  const value = await fixture();
  const client = new FailingAfterImageUploadGhostClient();

  await assert.rejects(
    synchronizeArticlePublication({ ...value, action: 'draft', client }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'GHOST_MUTATION');
      assert.deepEqual(error.featureImageUploads, [{
        method: 'uploadImageBytes',
        ref: 'assets/article/cover.png',
        url: 'https://ghost.example/content/images/cover.png'
      }]);
      assert.deepEqual(error.recovery.map((entry) => [entry.locale, entry.state.state]), [
        ['ko-KR', 'NOT_PROJECTED']
      ]);
      return true;
    }
  );

  assert.equal(client.uploads.length, 1);
  assert.equal(client.createCalls, 1);
});

test('target Article refuses non-HTTPS Ghost feature-image upload result before post mutation while preserving side-effect evidence', async () => {
  const value = await fixture();
  const client = new FailingAfterImageUploadGhostClient({
    uploadUrl: 'http://ghost.example/content/images/cover.png'
  });

  await assert.rejects(
    synchronizeArticlePublication({ ...value, action: 'draft', client }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'GHOST_MUTATION');
      assert.match(error.cause.message, /feature-image upload result must use https/);
      assert.deepEqual(error.featureImageUploads, [{
        method: 'uploadImageBytes',
        ref: 'assets/article/cover.png',
        url: 'http://ghost.example/content/images/cover.png'
      }]);
      return true;
    }
  );

  assert.equal(client.uploads.length, 1);
  assert.equal(client.createCalls, 0);
});

test('target Article redacts credentials from rejected feature-image upload side-effect evidence', async () => {
  const value = await fixture();
  const client = new FailingAfterImageUploadGhostClient({
    uploadUrl: 'https://user:password@ghost.example/content/images/cover.png'
  });

  await assert.rejects(
    synchronizeArticlePublication({ ...value, action: 'draft', client }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'GHOST_MUTATION');
      assert.match(error.cause.message, /must not contain URL credentials/);
      assert.deepEqual(error.featureImageUploads, [{
        method: 'uploadImageBytes',
        ref: 'assets/article/cover.png',
        url: 'https://ghost.example/content/images/cover.png',
        urlCredentialsRedacted: true
      }]);
      return true;
    }
  );

  assert.equal(client.uploads.length, 1);
  assert.equal(client.createCalls, 0);
});

test('target Article preserves transport-level upload side-effect evidence when Ghost client rejects its response', async () => {
  const value = await fixture();
  const client = new TransportRejectingAfterUploadGhostClient();

  await assert.rejects(
    synchronizeArticlePublication({ ...value, action: 'draft', client }),
    (error) => {
      assert.ok(error instanceof ArticlePublicationError);
      assert.equal(error.stage, 'GHOST_MUTATION');
      assert.deepEqual(error.featureImageUploads, [{
        method: 'uploadImageBytes',
        ref: 'assets/article/cover.png',
        url: 'http://ghost.example/content/images/cover.png'
      }]);
      assert.equal(error.recovery[0].state.state, 'NOT_PROJECTED');
      return true;
    }
  );

  assert.equal(client.uploads.length, 1);
  assert.equal(client.createCalls, 0);
});
