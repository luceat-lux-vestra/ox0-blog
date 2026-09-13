import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MarkedCompiler } from '../src/compiler/marked-compiler.mjs';
import { collectMaterialAssetEvidence } from '../src/material-asset-evidence.mjs';
import {
  planMaterialResourceDelivery,
  publishPlannedMaterialAssets
} from '../src/material-resource-delivery.mjs';

class Publisher {
  constructor() { this.planCalls = []; this.publishCalls = []; }
  async planAsset(asset) {
    this.planCalls.push({ ...asset });
    return {
      action: 'publish',
      url: `https://assets.example/${asset.fingerprint.slice('sha256:'.length)}/${asset.filename}`,
      ref: asset.ref,
      fingerprint: asset.fingerprint
    };
  }
  async publishAsset(asset, bytes, plan) {
    this.publishCalls.push({ asset: { ...asset }, bytes: Buffer.from(bytes), plan: { ...plan } });
    return { url: plan.url };
  }
}

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-resource-delivery-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  const assetDir = path.join(repoRoot, 'assets', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  const sourcePath = path.join(articleDir, 'en.md');
  const assetPath = path.join(assetDir, 'diagram.png');
  const body = '# Body\n\n![diagram](../../assets/article/diagram.png)\n';
  await writeFile(sourcePath, body, 'utf8');
  await writeFile(assetPath, 'asset-v1');
  const variant = {
    variantId: 'variant-en', locale: 'en', title: 'Title', excerpt: 'Summary',
    slug: 'article-en', body, sourcePath
  };
  const compiler = new MarkedCompiler();
  const discovered = await compiler.compile(variant);
  const evidence = await collectMaterialAssetEvidence({
    variant, compiledDocument: discovered, repoRoot
  });
  return { repoRoot, assetPath, variant, compiler, discovered, evidence };
}

test('planned local material URL is injected by host resolver without changing source evidence', async () => {
  const value = await fixture();
  const publisher = new Publisher();
  const delivery = await planMaterialResourceDelivery({
    variant: value.variant,
    compiledDocument: value.discovered,
    materialAssets: value.evidence.materialAssets,
    repoRoot: value.repoRoot,
    assetPublisher: publisher
  });
  assert.equal(delivery.plans.length, 1);
  assert.equal(delivery.plans[0].ref, 'assets/article/diagram.png');
  assert.equal(publisher.planCalls.length, 1);

  const projected = await value.compiler.compile(value.variant, {
    resolveResource: delivery.resolveResource
  });
  assert.match(projected.htmlFragment, /src="https:\/\/assets\.example\//);
  assert.equal(projected.referencedAssets[0].href, '../../assets/article/diagram.png');
  assert.equal(projected.referencedAssets[0].resolvedHref, delivery.plans[0].url);
});

test('publishing re-snapshots exact bytes and preserves the planned URL', async () => {
  const value = await fixture();
  const publisher = new Publisher();
  const delivery = await planMaterialResourceDelivery({
    variant: value.variant,
    compiledDocument: value.discovered,
    materialAssets: value.evidence.materialAssets,
    repoRoot: value.repoRoot,
    assetPublisher: publisher
  });

  const published = await publishPlannedMaterialAssets({
    plans: delivery.plans,
    repoRoot: value.repoRoot,
    assetPublisher: publisher
  });
  assert.equal(publisher.publishCalls.length, 1);
  assert.equal(publisher.publishCalls[0].bytes.toString('utf8'), 'asset-v1');
  assert.equal(published[0].url, delivery.plans[0].url);
});

test('asset byte change after planning fails before provider mutation', async () => {
  const value = await fixture();
  const publisher = new Publisher();
  const delivery = await planMaterialResourceDelivery({
    variant: value.variant,
    compiledDocument: value.discovered,
    materialAssets: value.evidence.materialAssets,
    repoRoot: value.repoRoot,
    assetPublisher: publisher
  });
  await writeFile(value.assetPath, 'asset-v2');

  await assert.rejects(
    publishPlannedMaterialAssets({
      plans: delivery.plans,
      repoRoot: value.repoRoot,
      assetPublisher: publisher
    }),
    /material asset changed after planning/
  );
  assert.equal(publisher.publishCalls.length, 0);
});

test('low-level reuse rejects credentialed planned public URL without provider mutation', async () => {
  const value = await fixture();
  const fingerprint = `sha256:${value.evidence.materialAssets[0].sha256}`;
  await assert.rejects(
    publishPlannedMaterialAssets({
      plans: [{
        ref: 'assets/article/diagram.png',
        fingerprint,
        action: 'reuse',
        url: 'https://user:password@assets.example/content/diagram.png',
        size: Buffer.byteLength('asset-v1'),
        filename: 'diagram.png'
      }],
      repoRoot: value.repoRoot,
      assetPublisher: new Publisher()
    }),
    /must not contain URL credentials/
  );
});
