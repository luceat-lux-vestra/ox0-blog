import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateMigrationRepository } from '../src/repository-validation.mjs';

function legacyPost({ title = 'Legacy', slug = 'legacy' } = {}) {
  return `---\ntitle: ${title}\nslug: ${slug}\nstatus: draft\n---\n# Legacy\n`;
}

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

function article(slug) {
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

async function fixture({ legacySlug = 'legacy', articleSlug = 'article' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ox0-repository-validation-'));
  await mkdir(path.join(root, 'posts', 'article'), { recursive: true });
  await mkdir(path.join(root, 'assets'));
  await writeFile(path.join(root, 'posts', 'legacy.md'), legacyPost({ slug: legacySlug }), 'utf8');
  await writeFile(path.join(root, 'posts', 'article', 'en.md'), '# Article\n', 'utf8');
  await writeFile(
    path.join(root, 'posts', 'article', 'article.json'),
    `${JSON.stringify(article(articleSlug), null, 2)}\n`,
    'utf8'
  );
  return root;
}

test('combined migration validation accepts distinct legacy and Article slugs', async () => {
  const root = await fixture();
  const result = await validateMigrationRepository(root);
  assert.equal(result.legacyPosts.length, 1);
  assert.equal(result.articles.length, 1);
});

test('combined migration validation rejects a public slug shared across legacy and Article models', async () => {
  const root = await fixture({ legacySlug: 'same', articleSlug: 'same' });
  await assert.rejects(
    validateMigrationRepository(root),
    /duplicate public slug across legacy\/Article sources same/
  );
});
