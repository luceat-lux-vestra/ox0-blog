import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildArticlePreviewBundle, renderArticlePreviewHtml } from '../src/article-preview.mjs';

async function fixture(body = '# Hello\n') {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-preview-'));
  const articleDir = path.join(repoRoot, 'posts', 'example');
  await mkdir(articleDir, { recursive: true });
  await writeFile(path.join(articleDir, 'en.md'), body, 'utf8');
  await writeFile(path.join(articleDir, 'article.json'), `${JSON.stringify({
    version: 1,
    articleId: 'example',
    requiredLocales: ['en'],
    variants: [{
      variantId: 'example-en',
      locale: 'en',
      source: 'en.md',
      title: 'Example',
      excerpt: 'Preview example',
      slug: 'example',
      publication: {
        tags: [],
        featureImage: null,
        featureImageAlt: null,
        featured: false,
        visibility: 'public',
        canonicalUrl: null
      }
    }],
    translationCheckpoint: null,
    readiness: { epoch: 0, checkpoint: null, invalidations: [] }
  }, null, 2)}\n`, 'utf8');
  return { repoRoot, manifest: 'posts/example/article.json' };
}

test('Article preview uses the injected compiler boundary and emits one review document', async () => {
  const value = await fixture();
  const compiler = {
    async compile(variant) {
      return {
        locale: variant.locale,
        htmlFragment: '<p>adapter-output</p>',
        referencedAssets: [],
        diagnostics: []
      };
    }
  };

  const bundle = await buildArticlePreviewBundle({
    repoRoot: value.repoRoot,
    manifestPaths: [value.manifest],
    sourceRevision: 'abc123',
    compiler
  });

  assert.equal(bundle.version, 1);
  assert.equal(bundle.sourceRevision, 'abc123');
  assert.equal(bundle.articles[0].manifest, value.manifest);
  assert.equal(bundle.articles[0].variants[0].htmlFragment, '<p>adapter-output</p>');

  const html = renderArticlePreviewHtml(bundle);
  assert.match(html, /adapter-output/);
  assert.match(html, /abc123/);
  assert.match(html, /no Ghost mutation/);
  assert.match(html, /Content-Security-Policy/);
});

test('Article preview resolves local images to exact host URLs after repository asset validation', async () => {
  const value = await fixture('![diagram](../../assets/example/diagram.png)\n');
  const assetDir = path.join(value.repoRoot, 'assets', 'example');
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(assetDir, 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const bundle = await buildArticlePreviewBundle({
    repoRoot: value.repoRoot,
    manifestPaths: [value.manifest],
    resourceBaseUrl: 'https://raw.githubusercontent.com/example/blog/deadbeef/',
    sourceRevision: 'deadbeef'
  });

  const article = bundle.articles[0];
  assert.equal(article.materialAssets.length, 1);
  assert.equal(article.materialAssets[0].ref, 'assets/example/diagram.png');
  assert.match(article.materialAssets[0].fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.match(
    article.variants[0].htmlFragment,
    /https:\/\/raw\.githubusercontent\.com\/example\/blog\/deadbeef\/assets\/example\/diagram\.png/
  );
});

test('Article preview fails closed when local assets have no review resource host', async () => {
  const value = await fixture('![diagram](../../assets/example/diagram.png)\n');
  const assetDir = path.join(value.repoRoot, 'assets', 'example');
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(assetDir, 'diagram.png'), 'png');

  await assert.rejects(
    buildArticlePreviewBundle({
      repoRoot: value.repoRoot,
      manifestPaths: [value.manifest]
    }),
    /resourceBaseUrl is required/
  );
});

test('Article preview HTML escapes source metadata while preserving compiled HTML', async () => {
  const value = await fixture();
  const compiler = {
    async compile(variant) {
      return {
        locale: variant.locale,
        htmlFragment: '<p><strong>compiled</strong></p>',
        referencedAssets: [],
        diagnostics: []
      };
    }
  };
  const manifestPath = path.join(value.repoRoot, value.manifest);
  const raw = JSON.parse(await readFile(manifestPath, 'utf8'));
  raw.variants[0].title = '<script>alert(1)</script>';
  await writeFile(manifestPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');

  const bundle = await buildArticlePreviewBundle({
    repoRoot: value.repoRoot,
    manifestPaths: [value.manifest],
    compiler
  });
  const html = renderArticlePreviewHtml(bundle);

  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<strong>compiled<\/strong>/);
});
