import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { planArticlePublication } from '../src/article-planning.mjs';

class RecordingCompiler {
  constructor() { this.calls = []; }

  async compile(variant, projectContext = {}) {
    this.calls.push({
      locale: variant.locale,
      marker: projectContext.marker ?? null,
      hasResolver: typeof projectContext.resolveResource === 'function'
    });

    const referencedAssets = [];
    let renderedResource = null;
    if (variant.body.includes('![diagram]')) {
      const resource = {
        kind: 'image',
        href: '../../assets/article/diagram.png',
        alt: 'diagram',
        title: null
      };
      if (projectContext.resolveResource) {
        renderedResource = (await projectContext.resolveResource(resource, {
          variant,
          projectContext
        }))?.href ?? null;
      }
      referencedAssets.push({
        ...resource,
        resolvedHref: renderedResource
      });
    }

    return {
      htmlFragment: `<p>${projectContext.marker ?? 'missing'}:${renderedResource ?? 'source'}</p>`,
      locale: variant.locale,
      referencedAssets,
      diagnostics: []
    };
  }
}

class ReadOnlyGhostClient {
  async getPostsBySourceTag() { return []; }
  async getPostBySlug() { return null; }
  async getPageBySlug() { return null; }
}

class PlannedAssetPublisher {
  async planAsset(asset) {
    return {
      action: 'publish',
      url: `https://assets.example/${asset.fingerprint.slice('sha256:'.length)}/${asset.filename}`,
      ref: asset.ref,
      fingerprint: asset.fingerprint
    };
  }
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

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-project-context-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  const assetDir = path.join(repoRoot, 'assets', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(articleDir, 'ko-KR.md'), '# 본문\n', 'utf8');
  await writeFile(
    path.join(articleDir, 'en.md'),
    '# Body\n\n![diagram](../../assets/article/diagram.png)\n',
    'utf8'
  );
  await writeFile(path.join(assetDir, 'diagram.png'), 'diagram-v1');
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
  return { repoRoot, manifestPath };
}

test('Article planning resolves ProjectContext once per variant and preserves it when AssetPublisher overrides resource resolution', async () => {
  const value = await fixture();
  const compiler = new RecordingCompiler();
  const factoryCalls = [];
  const projectContext = (variant) => {
    factoryCalls.push(variant.locale);
    return { marker: `ctx-${variant.locale}` };
  };

  const plan = await planArticlePublication({
    ...value,
    action: 'draft',
    client: new ReadOnlyGhostClient(),
    compiler,
    projectContext,
    assetPublisher: new PlannedAssetPublisher()
  });

  assert.deepEqual(factoryCalls, ['ko-KR', 'en']);
  assert.deepEqual(compiler.calls, [
    { locale: 'ko-KR', marker: 'ctx-ko-KR', hasResolver: false },
    { locale: 'en', marker: 'ctx-en', hasResolver: false },
    { locale: 'en', marker: 'ctx-en', hasResolver: true }
  ]);
  assert.equal(plan.variants[1].assetPlans.length, 1);
  assert.match(plan.variants[1].sourceFingerprint, /^sha256:[a-f0-9]{64}$/);
});
