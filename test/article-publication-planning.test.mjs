import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { planArticlePublication } from '../src/article-planning.mjs';

class ReadOnlyGhostClient {
  constructor() { this.calls = []; }
  async getPostsBySourceTag(tag) { this.calls.push(['identity', tag]); return []; }
  async getPostBySlug(slug) { this.calls.push(['post-slug', slug]); return null; }
  async getPageBySlug(slug) { this.calls.push(['page-slug', slug]); return null; }
}

class DeterministicAssetPublisher {
  constructor() { this.calls = []; }
  async planAsset(asset) {
    this.calls.push({ ...asset });
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
    tags: [], featureImage: null, featureImageAlt: null,
    featured: false, visibility: 'public', canonicalUrl: null
  };
}

async function fixture({ englishLocalAsset = false } = {}) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-article-publication-plan-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  const assetDir = path.join(repoRoot, 'assets', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(articleDir, 'ko-KR.md'), '# 본문\n', 'utf8');
  await writeFile(
    path.join(articleDir, 'en.md'),
    englishLocalAsset ? '# Body\n\n![diagram](../../assets/article/diagram.png)\n' : '# Body\n',
    'utf8'
  );
  if (englishLocalAsset) await writeFile(path.join(assetDir, 'diagram.png'), 'diagram');

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

test('aggregate draft planning returns one bound read-only plan per required locale', async () => {
  const value = await fixture();
  const client = new ReadOnlyGhostClient();
  const plan = await planArticlePublication({ ...value, action: 'draft', client });
  assert.equal(plan.articleId, 'article-1');
  assert.deepEqual(plan.variants.map((entry) => entry.locale), ['ko-KR', 'en']);
  assert.ok(plan.variants.every((entry) => entry.ghost.operation === 'create'));
  assert.ok(plan.variants.every((entry) => entry.ghost.observed === null));
  assert.ok(plan.variants.every((entry) => entry.assetPlans.length === 0));
  assert.equal(client.calls.filter(([kind]) => kind === 'identity').length, 4);
});

test('aggregate planning preflights every locale before the first Ghost read when AssetPublisher is absent', async () => {
  const value = await fixture({ englishLocalAsset: true });
  const client = new ReadOnlyGhostClient();
  await assert.rejects(
    planArticlePublication({ ...value, action: 'draft', client }),
    /requires a host AssetPublisher before Ghost planning: en/
  );
  assert.deepEqual(client.calls, []);
});

test('AssetPublisher enables local body asset dry-run with planned HTTPS compiled projection', async () => {
  const value = await fixture({ englishLocalAsset: true });
  const client = new ReadOnlyGhostClient();
  const assetPublisher = new DeterministicAssetPublisher();
  const plan = await planArticlePublication({
    ...value,
    action: 'draft',
    client,
    assetPublisher
  });

  const english = plan.variants.find((entry) => entry.locale === 'en');
  assert.equal(assetPublisher.calls.length, 1);
  assert.equal(assetPublisher.calls[0].ref, 'assets/article/diagram.png');
  assert.equal(english.assetPlans.length, 1);
  assert.equal(english.assetPlans[0].ref, 'assets/article/diagram.png');
  assert.match(english.assetPlans[0].url, /^https:\/\/assets\.example\//);
  assert.deepEqual(english.ghost.referencedAssets, [{
    kind: 'image',
    href: '../../assets/article/diagram.png',
    alt: 'diagram',
    title: null,
    resolvedHref: english.assetPlans[0].url
  }]);
  assert.ok(client.calls.length > 0);
});

test('aggregate publish planning enforces Article readiness before AssetPublisher or Ghost reads', async () => {
  const value = await fixture({ englishLocalAsset: true });
  const client = new ReadOnlyGhostClient();
  const assetPublisher = new DeterministicAssetPublisher();
  await assert.rejects(
    planArticlePublication({ ...value, action: 'publish', client, assetPublisher }),
    /requires translation SYNCED/
  );
  assert.deepEqual(assetPublisher.calls, []);
  assert.deepEqual(client.calls, []);
});
