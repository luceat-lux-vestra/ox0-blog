import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateRepository } from '../src/repository-validation.mjs';

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

function article(slug = 'article') {
  return {
    version: 1,
    articleId: 'article-one',
    requiredLocales: ['en'],
    variants: [{
      variantId: 'article-one-en',
      locale: 'en',
      source: 'en.md',
      title: 'Article',
      excerpt: 'summary',
      slug,
      publication: publication()
    }],
    translationCheckpoint: null,
    readiness: { epoch: 0, checkpoint: null, invalidations: [] }
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ox0-repository-validation-'));
  await mkdir(path.join(root, 'posts', 'article'), { recursive: true });
  await mkdir(path.join(root, 'assets'));
  await writeFile(path.join(root, 'posts', 'article', 'en.md'), '# Article\n', 'utf8');
  await writeFile(
    path.join(root, 'posts', 'article', 'article.json'),
    `${JSON.stringify(article(), null, 2)}\n`,
    'utf8'
  );
  return root;
}

test('repository validation accepts Article-owned Markdown only', async () => {
  const root = await fixture();
  const result = await validateRepository(root);
  assert.equal(result.articles.length, 1);
});

test('repository validation rejects one-file Markdown outside an Article manifest', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'posts', 'legacy.md'), '# Legacy\n', 'utf8');
  await assert.rejects(
    validateRepository(root),
    /posts\/ Markdown must belong to an Article manifest: posts\/legacy\.md/
  );
});
