import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createContentAddressedAssetPublisher } from '../src/content-addressed-asset-publisher.mjs';
import { planAssetDelivery, publishAssetDelivery } from '../src/asset-publisher.mjs';

function descriptor(bytes, overrides = {}) {
  const buffer = Buffer.from(bytes);
  return {
    ref: 'assets/article/diagram.png',
    fingerprint: `sha256:${createHash('sha256').update(buffer).digest('hex')}`,
    filename: 'diagram.png',
    size: buffer.length,
    ...overrides
  };
}

function memoryStore() {
  const objects = new Map();
  const puts = [];
  return {
    objects,
    puts,
    async headObject({ key }) {
      const object = objects.get(key);
      return object ? { size: object.size, sha256: object.sha256 } : null;
    },
    async putObject(value) {
      puts.push({ ...value, bytes: Buffer.from(value.bytes) });
      objects.set(value.key, {
        bytes: Buffer.from(value.bytes),
        size: value.size,
        sha256: value.sha256,
        contentType: value.contentType,
        sourceRef: value.sourceRef
      });
    }
  };
}

test('content-addressed planner deterministically maps digest to HTTPS target and publishes exact verified bytes', async () => {
  const store = memoryStore();
  const publisher = createContentAddressedAssetPublisher({
    publicBaseUrl: 'https://cdn.example/blog-assets',
    headObject: store.headObject,
    putObject: store.putObject
  });
  const bytes = Buffer.from('image-v1');
  const asset = descriptor(bytes);
  const planned = await planAssetDelivery(publisher, asset);

  const hex = asset.fingerprint.slice('sha256:'.length);
  assert.deepEqual(planned.plan, {
    action: 'publish',
    url: `https://cdn.example/blog-assets/sha256/${hex.slice(0, 2)}/${hex}.png`,
    ref: asset.ref,
    fingerprint: asset.fingerprint
  });

  const published = await publishAssetDelivery(publisher, asset, bytes, planned.plan);
  assert.equal(published.url, planned.plan.url);
  assert.equal(store.puts.length, 1);
  assert.equal(store.puts[0].contentType, 'image/png');
  assert.equal(store.puts[0].sourceRef, asset.ref);
  assert.deepEqual(store.puts[0].bytes, bytes);

  const next = await planAssetDelivery(publisher, asset);
  assert.equal(next.plan.action, 'reuse');
  assert.equal(next.plan.url, planned.plan.url);
});

test('reuse requires exact stored size and sha256 metadata rather than path existence alone', async () => {
  const store = memoryStore();
  const bytes = Buffer.from('image-v1');
  const asset = descriptor(bytes);
  const hex = asset.fingerprint.slice('sha256:'.length);
  const key = `sha256/${hex.slice(0, 2)}/${hex}.png`;
  store.objects.set(key, {
    bytes,
    size: bytes.length,
    sha256: 'f'.repeat(64),
    contentType: 'image/png'
  });
  const publisher = createContentAddressedAssetPublisher({
    publicBaseUrl: 'https://cdn.example/assets/',
    headObject: store.headObject,
    putObject: store.putObject
  });

  await assert.rejects(
    planAssetDelivery(publisher, asset),
    /metadata mismatch/
  );
  assert.equal(store.puts.length, 0);
});

test('publish verifies bytes digest and verifies stored metadata after put', async () => {
  const bytes = Buffer.from('image-v1');
  const asset = descriptor(bytes);
  let stored = null;
  const publisher = createContentAddressedAssetPublisher({
    publicBaseUrl: 'https://cdn.example/assets/',
    async headObject() { return stored; },
    async putObject(value) {
      stored = { size: value.size, sha256: '0'.repeat(64) };
    }
  });
  const plan = (await planAssetDelivery(publisher, asset)).plan;

  await assert.rejects(
    publishAssetDelivery(publisher, asset, Buffer.from('IMAGE-v1'), plan),
    /digest changed|size changed/
  );

  await assert.rejects(
    publishAssetDelivery(publisher, asset, bytes, plan),
    /metadata mismatch/
  );
});

test('content-addressed public target rejects insecure base URLs and unsupported extensions', async () => {
  const store = memoryStore();
  assert.throws(
    () => createContentAddressedAssetPublisher({
      publicBaseUrl: 'http://cdn.example/assets/',
      headObject: store.headObject,
      putObject: store.putObject
    }),
    /must use https/
  );

  const publisher = createContentAddressedAssetPublisher({
    publicBaseUrl: 'https://cdn.example/assets/',
    headObject: store.headObject,
    putObject: store.putObject
  });
  const bytes = Buffer.from('payload');
  await assert.rejects(
    planAssetDelivery(publisher, descriptor(bytes, {
      ref: 'assets/article/file.txt',
      filename: 'file.txt'
    })),
    /unsupported content-addressed asset extension/
  );
});
