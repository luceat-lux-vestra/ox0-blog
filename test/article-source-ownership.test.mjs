import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectArticleManifestPaths, validateArticleRepository } from '../src/article-validation.mjs';

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

function article({ articleId, source = 'en.md', variantId = `${articleId}-en`, slug = articleId }) {
  return {
    version: 1,
    articleId,
    requiredLocales: ['en'],
    variants: [{
      variantId,
      locale: 'en',
      source,
      title: articleId,
      excerpt: 'summary',
      slug,
      publication: publication()
    }],
    translationCheckpoint: null,
    readiness: { epoch: 0, checkpoint: null, invalidations: [] }
  };
}

async function root() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-article-ownership-'));
  await mkdir(path.join(repoRoot, 'posts'));
  await mkdir(path.join(repoRoot, 'assets'));
  return repoRoot;
}

async function writeArticle(repoRoot, relativeDir, raw) {
  const dir = path.join(repoRoot, 'posts', ...relativeDir.split('/'));
  await mkdir(dir, { recursive: true });
  for (const variant of raw.variants) {
    const sourcePath = path.join(dir, ...variant.source.split('/'));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, `# ${variant.locale}\n`, 'utf8');
  }
  await writeFile(path.join(dir, 'article.json'), `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  return dir;
}

test('Article validation rejects unclaimed Markdown inside an Article-owned subtree', async () => {
  const repoRoot = await root();
  const dir = await writeArticle(repoRoot, 'alpha', article({ articleId: 'alpha' }));
  await writeFile(path.join(dir, 'orphan.md'), '# orphan\n', 'utf8');

  await assert.rejects(
    validateArticleRepository(repoRoot),
    /Article bundle contains unclaimed Markdown source: posts[\\/]alpha[\\/]orphan\.md/
  );
});

test('Article validation rejects nested Article bundles with overlapping source ownership', async () => {
  const repoRoot = await root();
  await writeArticle(repoRoot, 'alpha', article({ articleId: 'alpha' }));
  await writeArticle(repoRoot, 'alpha/nested', article({ articleId: 'nested' }));

  await assert.rejects(
    collectArticleManifestPaths(repoRoot),
    /nested Article bundles are not allowed/
  );
});

test('Article validation rejects article.json when it is a directory instead of a manifest file', async () => {
  const repoRoot = await root();
  const dir = path.join(repoRoot, 'posts', 'alpha');
  await mkdir(path.join(dir, 'article.json'), { recursive: true });
  await writeFile(path.join(dir, 'legacy-looking.md'), '# not silently hidden\n', 'utf8');

  await assert.rejects(
    collectArticleManifestPaths(repoRoot),
    /Article manifest must be a regular file/
  );
});

test('Article manifest may intentionally own a normalized nested Markdown source path', async () => {
  const repoRoot = await root();
  await writeArticle(
    repoRoot,
    'alpha',
    article({ articleId: 'alpha', source: 'locales/en.md' })
  );

  const validated = await validateArticleRepository(repoRoot);
  assert.equal(validated.length, 1);
  assert.equal(validated[0].bundle.article.variants[0].locale, 'en');
  assert.match(validated[0].bundle.article.variants[0].sourcePath, /locales[\\/]en\.md$/);
});
