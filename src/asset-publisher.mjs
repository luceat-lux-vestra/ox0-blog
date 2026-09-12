function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requireFingerprint(value, name) {
  const fingerprint = requireString(value, name);
  if (!/^sha256:[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error(`${name} must be sha256:<64 lowercase hex>`);
  }
  return fingerprint;
}

function requireHttpsUrl(value, name) {
  const source = requireString(value, name);
  let parsed;
  try { parsed = new URL(source); } catch { throw new Error(`${name} must be a valid URL`); }
  if (parsed.protocol !== 'https:') throw new Error(`${name} must use https`);
  return parsed.href;
}

function requireAssetDescriptor(raw) {
  const value = requireObject(raw, 'asset descriptor');
  const ref = requireString(value.ref, 'asset.ref');
  if (!ref.startsWith('assets/')) throw new Error('asset.ref must be repository-relative under assets/');
  const fingerprint = requireFingerprint(value.fingerprint, 'asset.fingerprint');
  const filename = requireString(value.filename, 'asset.filename');
  if (!Number.isSafeInteger(value.size) || value.size < 0) {
    throw new Error('asset.size must be a non-negative safe integer');
  }
  return { ref, fingerprint, filename, size: value.size };
}

function normalizePlan(raw, asset) {
  const value = requireObject(raw, 'AssetPublisher plan');
  const action = value.action;
  if (!['publish', 'reuse'].includes(action)) {
    throw new Error('AssetPublisher plan.action must be publish or reuse');
  }
  const url = requireHttpsUrl(value.url, 'AssetPublisher plan.url');
  const ref = requireString(value.ref, 'AssetPublisher plan.ref');
  const fingerprint = requireFingerprint(value.fingerprint, 'AssetPublisher plan.fingerprint');
  if (ref !== asset.ref || fingerprint !== asset.fingerprint) {
    throw new Error('AssetPublisher plan does not cover the exact asset ref/fingerprint');
  }
  return { action, url, ref, fingerprint };
}

export function requireAssetPublisher(publisher) {
  if (!publisher || typeof publisher !== 'object') throw new Error('AssetPublisher is required');
  if (typeof publisher.planAsset !== 'function') {
    throw new Error('AssetPublisher.planAsset(asset) is required');
  }
  if (publisher.publishAsset != null && typeof publisher.publishAsset !== 'function') {
    throw new Error('AssetPublisher.publishAsset must be a function when provided');
  }
  return publisher;
}

export async function planAssetDelivery(publisher, rawAsset) {
  const target = requireAssetPublisher(publisher);
  const asset = requireAssetDescriptor(rawAsset);
  const plan = normalizePlan(await target.planAsset({ ...asset }), asset);
  return { asset, plan };
}

export async function publishAssetDelivery(publisher, rawAsset, bytes, rawPlan) {
  const target = requireAssetPublisher(publisher);
  if (typeof target.publishAsset !== 'function') {
    throw new Error('AssetPublisher.publishAsset(asset, bytes, plan) is required for mutation');
  }
  const asset = requireAssetDescriptor(rawAsset);
  const plan = normalizePlan(rawPlan, asset);
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new Error('asset bytes must be Buffer or Uint8Array');
  }
  if (bytes.byteLength !== asset.size) {
    throw new Error(`asset bytes size does not match planned snapshot: expected ${asset.size}, got ${bytes.byteLength}`);
  }
  const result = requireObject(
    await target.publishAsset({ ...asset }, bytes, { ...plan }),
    'AssetPublisher publish result'
  );
  const url = requireHttpsUrl(result.url, 'AssetPublisher publish result.url');
  if (url !== plan.url) {
    throw new Error(`AssetPublisher publish result changed planned URL: expected ${plan.url}, got ${url}`);
  }
  return { url, asset, plan };
}
