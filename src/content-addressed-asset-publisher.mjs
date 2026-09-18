import { createHash } from 'node:crypto';
import path from 'node:path';

const CONTENT_TYPES = new Map([
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml']
]);

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new Error(`${name} must be a function`);
  return value;
}

function requireHttpsBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('publicBaseUrl must be a non-empty HTTPS URL');
  }
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw new Error('publicBaseUrl must be a valid HTTPS URL'); }
  if (parsed.protocol !== 'https:') throw new Error('publicBaseUrl must use https');
  if (parsed.username || parsed.password) throw new Error('publicBaseUrl must not contain URL credentials');
  if (parsed.search || parsed.hash) throw new Error('publicBaseUrl must not contain query or fragment');
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
  return parsed;
}

function requireAsset(asset) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
    throw new Error('content-addressed asset descriptor is required');
  }
  if (typeof asset.ref !== 'string' || !asset.ref.startsWith('assets/')) {
    throw new Error('content-addressed asset ref must be under assets/');
  }
  if (typeof asset.fingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(asset.fingerprint)) {
    throw new Error('content-addressed asset fingerprint must be sha256:<64 lowercase hex>');
  }
  if (typeof asset.filename !== 'string' || asset.filename.trim() === '') {
    throw new Error('content-addressed asset filename is required');
  }
  if (!Number.isSafeInteger(asset.size) || asset.size < 0) {
    throw new Error('content-addressed asset size must be a non-negative safe integer');
  }
  const extension = path.extname(asset.filename).toLowerCase();
  const contentType = CONTENT_TYPES.get(extension);
  if (!contentType) throw new Error(`unsupported content-addressed asset extension: ${asset.filename}`);
  return { ...asset, extension, contentType };
}

function objectKey(asset) {
  const hex = asset.fingerprint.slice('sha256:'.length);
  return `sha256/${hex.slice(0, 2)}/${hex}${asset.extension}`;
}

function normalizeStoredObject(value, key) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`headObject must return null or metadata object for ${key}`);
  }
  if (!Number.isSafeInteger(value.size) || value.size < 0) {
    throw new Error(`stored object size is invalid for ${key}`);
  }
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error(`stored object sha256 metadata is invalid for ${key}`);
  }
  return { size: value.size, sha256: value.sha256 };
}

function assertStoredMatches(metadata, asset, key) {
  const expectedSha256 = asset.fingerprint.slice('sha256:'.length);
  if (metadata.size !== asset.size || metadata.sha256 !== expectedSha256) {
    throw new Error(
      `content-addressed object metadata mismatch for ${key}; expected ${asset.size}/${expectedSha256}, got ${metadata.size}/${metadata.sha256}`
    );
  }
}

function requirePlan(plan, asset, baseUrl) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('content-addressed publish plan is required');
  }
  const key = objectKey(asset);
  const expectedUrl = new URL(key, baseUrl).href;
  if (plan.ref !== asset.ref || plan.fingerprint !== asset.fingerprint) {
    throw new Error('content-addressed publish plan does not match exact asset ref/fingerprint');
  }
  if (plan.url !== expectedUrl) {
    throw new Error(`content-addressed publish plan URL mismatch: expected ${expectedUrl}, got ${plan.url}`);
  }
  if (!['publish', 'reuse'].includes(plan.action)) {
    throw new Error('content-addressed publish plan action must be publish or reuse');
  }
  return { key, expectedUrl };
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createContentAddressedAssetPublisher({
  publicBaseUrl,
  headObject,
  putObject
}) {
  const baseUrl = requireHttpsBaseUrl(publicBaseUrl);
  const head = requireFunction(headObject, 'headObject');
  const put = requireFunction(putObject, 'putObject');

  return {
    async planAsset(rawAsset) {
      const asset = requireAsset(rawAsset);
      const key = objectKey(asset);
      const existing = normalizeStoredObject(await head({ key }), key);
      if (existing) assertStoredMatches(existing, asset, key);
      return {
        action: existing ? 'reuse' : 'publish',
        url: new URL(key, baseUrl).href,
        ref: asset.ref,
        fingerprint: asset.fingerprint
      };
    },

    async publishAsset(rawAsset, rawBytes, rawPlan) {
      const asset = requireAsset(rawAsset);
      const { key, expectedUrl } = requirePlan(rawPlan, asset, baseUrl);
      if (rawPlan.action !== 'publish') {
        throw new Error('content-addressed publishAsset may only execute a publish plan');
      }
      if (!Buffer.isBuffer(rawBytes) && !(rawBytes instanceof Uint8Array)) {
        throw new Error('content-addressed asset bytes must be Buffer or Uint8Array');
      }
      const bytes = Buffer.from(rawBytes);
      if (bytes.length !== asset.size) {
        throw new Error(`content-addressed asset size changed: expected ${asset.size}, got ${bytes.length}`);
      }
      const actualSha256 = sha256Hex(bytes);
      const expectedSha256 = asset.fingerprint.slice('sha256:'.length);
      if (actualSha256 !== expectedSha256) {
        throw new Error(
          `content-addressed asset digest changed: expected ${expectedSha256}, got ${actualSha256}`
        );
      }

      await put({
        key,
        bytes,
        contentType: asset.contentType,
        sha256: expectedSha256,
        size: asset.size,
        sourceRef: asset.ref
      });

      const stored = normalizeStoredObject(await head({ key }), key);
      if (!stored) throw new Error(`content-addressed object missing after publish: ${key}`);
      assertStoredMatches(stored, asset, key);
      return { url: expectedUrl };
    }
  };
}
