import test from 'node:test';
import assert from 'node:assert/strict';
import { planAssetDelivery, publishAssetDelivery } from '../src/asset-publisher.mjs';

function descriptor(overrides = {}) {
  return {
    ref: 'assets/article/diagram.png',
    fingerprint: `sha256:${'a'.repeat(64)}`,
    filename: 'diagram.png',
    size: 4,
    ...overrides
  };
}

test('read-only AssetPublisher planning binds exact ref/fingerprint to HTTPS URL', async () => {
  const publisher = {
    async planAsset(asset) {
      return {
        action: 'publish',
        url: `https://assets.example/${asset.fingerprint.slice('sha256:'.length)}/${asset.filename}`,
        ref: asset.ref,
        fingerprint: asset.fingerprint
      };
    }
  };
  const result = await planAssetDelivery(publisher, descriptor());
  assert.equal(result.plan.action, 'publish');
  assert.match(result.plan.url, /^https:\/\/assets\.example\//);
  assert.equal(result.plan.ref, descriptor().ref);
});

test('AssetPublisher plan cannot substitute another asset or non-HTTPS target', async () => {
  await assert.rejects(
    planAssetDelivery({
      async planAsset(asset) {
        return { action: 'reuse', url: 'https://assets.example/a', ref: 'assets/other.png', fingerprint: asset.fingerprint };
      }
    }, descriptor()),
    /does not cover the exact asset ref\/fingerprint/
  );
  await assert.rejects(
    planAssetDelivery({
      async planAsset(asset) {
        return { action: 'reuse', url: 'http://assets.example/a', ref: asset.ref, fingerprint: asset.fingerprint };
      }
    }, descriptor()),
    /must use https/
  );
});

test('mutation must publish exact planned bytes to exact planned URL', async () => {
  const asset = descriptor();
  const plan = {
    action: 'publish',
    url: 'https://assets.example/content/diagram.png',
    ref: asset.ref,
    fingerprint: asset.fingerprint
  };
  const calls = [];
  const publisher = {
    async planAsset() { return plan; },
    async publishAsset(receivedAsset, bytes, receivedPlan) {
      calls.push({ receivedAsset, bytes: Buffer.from(bytes), receivedPlan });
      return { url: receivedPlan.url };
    }
  };
  const result = await publishAssetDelivery(publisher, asset, Buffer.from('data'), plan);
  assert.equal(result.url, plan.url);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bytes.toString('utf8'), 'data');

  await assert.rejects(
    publishAssetDelivery({
      ...publisher,
      async publishAsset() { return { url: 'https://assets.example/other.png' }; }
    }, asset, Buffer.from('data'), plan),
    /changed planned URL/
  );
  await assert.rejects(
    publishAssetDelivery(publisher, asset, Buffer.from('too-long'), plan),
    /size does not match/
  );
});
