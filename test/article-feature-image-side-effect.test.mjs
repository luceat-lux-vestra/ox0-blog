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
  constructor() { this.uploads = []; }
  async getPostsBySourceTag() { return []; }
  async getPostBySlug() { return null; }
  async getPageBySlug() { return null; }
  async uploadImageBytes(file, ref) {
    const upload = {
      ref,
      filename: file.filename,
      url: 'https://ghost.example/content/images/cover.png'
    };
    this.uploads.push(upload);
    return { url: upload.url };
  }
  async createPost() {
    throw new Error('injected post create failure after feature image upload');
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
});
