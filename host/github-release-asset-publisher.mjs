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

const FINGERPRINT_RE = /^sha256:[a-f0-9]{64}$/;
const REPOSITORY_RE = /^[^/\s]+\/[^/\s]+$/;
const REPOSITORY_ID_RE = /^[1-9][0-9]*$/;
const RELEASE_CONTRACT_VERSION = 1;

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requireHttpsBase(value, name) {
  const raw = requireString(value, name);
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`${name} must be a valid URL`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must be a credential-free HTTPS base URL without query/fragment`);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed;
}

function requireRepository(value) {
  const repository = requireString(value, 'GITHUB_REPOSITORY');
  if (!REPOSITORY_RE.test(repository)) throw new Error('GITHUB_REPOSITORY must be owner/name');
  return repository;
}

function requireRepositoryId(value) {
  const id = requireString(value, 'GITHUB_REPOSITORY_ID');
  if (!REPOSITORY_ID_RE.test(id)) throw new Error('GITHUB_REPOSITORY_ID must be a positive integer string');
  return id;
}

function requireFetch(value) {
  if (typeof value !== 'function') throw new Error('fetch implementation is required');
  return value;
}

function normalizeAsset(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('asset descriptor is required');
  const ref = requireString(raw.ref, 'asset.ref');
  if (!ref.startsWith('assets/')) throw new Error('asset.ref must be under assets/');
  const fingerprint = requireString(raw.fingerprint, 'asset.fingerprint');
  if (!FINGERPRINT_RE.test(fingerprint)) throw new Error('asset.fingerprint must be sha256:<64 lowercase hex>');
  const filename = requireString(raw.filename, 'asset.filename');
  if (!Number.isSafeInteger(raw.size) || raw.size < 0) throw new Error('asset.size must be a non-negative safe integer');
  const extension = path.extname(filename).toLowerCase();
  const contentType = CONTENT_TYPES.get(extension);
  if (!contentType) throw new Error(`unsupported release asset extension: ${filename}`);
  const digest = fingerprint.slice('sha256:'.length);
  return {
    ref,
    fingerprint,
    filename,
    size: raw.size,
    extension,
    contentType,
    digest,
    objectName: `${digest}${extension}`
  };
}

function releaseTag(repositoryId) {
  return `ox0-article-assets-v${RELEASE_CONTRACT_VERSION}-${repositoryId}`;
}

function appendBasePath(base, suffix) {
  const url = new URL(base.href);
  const root = url.pathname.replace(/\/+$/, '');
  url.pathname = `${root}/${suffix.replace(/^\/+/, '')}`;
  return url;
}

function releaseAssetUrl(serverBase, repository, tag, objectName) {
  return appendBasePath(
    serverBase,
    `${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(objectName)}`
  ).href;
}

function apiHeaders(token, extra = {}) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    ...extra
  };
}

async function jsonResponse(response, label) {
  let value = null;
  try { value = await response.json(); } catch {}
  if (!response.ok) {
    const message = value?.message ? `: ${value.message}` : '';
    throw new Error(`${label} failed with HTTP ${response.status}${message}`);
  }
  return value;
}

function releaseApiUrl(apiBase, repository, suffix) {
  return appendBasePath(apiBase, `repos/${repository}/releases${suffix}`).href;
}

function validateRelease(raw, tag) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('GitHub release response is invalid');
  if (!Number.isSafeInteger(raw.id) || raw.id <= 0) throw new Error('GitHub release id is invalid');
  if (raw.tag_name !== tag) throw new Error(`GitHub release tag mismatch: expected ${tag}, got ${raw.tag_name}`);
  const uploadUrl = requireString(raw.upload_url, 'GitHub release upload_url');
  return { ...raw, upload_url: uploadUrl };
}

function validateStoredAsset(raw, { objectName, expectedUrl }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('GitHub release asset response is invalid');
  if (raw.name !== objectName) throw new Error(`GitHub release asset name mismatch: expected ${objectName}, got ${raw.name}`);
  if (raw.state !== 'uploaded') throw new Error(`GitHub release asset is not uploaded: ${objectName}`);
  if (!Number.isSafeInteger(raw.size) || raw.size < 0) throw new Error(`GitHub release asset size is invalid: ${objectName}`);
  if (typeof raw.digest !== 'string' || !FINGERPRINT_RE.test(raw.digest)) {
    throw new Error(`GitHub release asset digest is missing or invalid: ${objectName}`);
  }
  const downloadUrl = requireString(raw.browser_download_url, 'GitHub release asset browser_download_url');
  if (downloadUrl !== expectedUrl) {
    throw new Error(`GitHub release asset URL mismatch: expected ${expectedUrl}, got ${downloadUrl}`);
  }
  return { size: raw.size, sha256: raw.digest.slice('sha256:'.length) };
}

export function createGitHubReleaseAssetPublisher({
  repository,
  repositoryId,
  token,
  apiBaseUrl,
  serverBaseUrl,
  fetchImpl = globalThis.fetch
}) {
  const repo = requireRepository(repository);
  const repoId = requireRepositoryId(repositoryId);
  const auth = requireString(token, 'GITHUB_TOKEN');
  const apiBase = requireHttpsBase(apiBaseUrl, 'GITHUB_API_URL');
  const serverBase = requireHttpsBase(serverBaseUrl, 'GITHUB_SERVER_URL');
  const request = requireFetch(fetchImpl);
  const tag = releaseTag(repoId);

  async function getRelease() {
    const url = releaseApiUrl(apiBase, repo, `/tags/${encodeURIComponent(tag)}`);
    const response = await request(url, { headers: apiHeaders(auth) });
    if (response.status === 404) return null;
    return validateRelease(await jsonResponse(response, 'get GitHub asset release'), tag);
  }

  async function listAssets(release) {
    const values = [];
    for (let page = 1; ; page += 1) {
      const url = new URL(releaseApiUrl(apiBase, repo, `/${release.id}/assets`));
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const response = await request(url, { headers: apiHeaders(auth) });
      const batch = await jsonResponse(response, 'list GitHub release assets');
      if (!Array.isArray(batch)) throw new Error('list GitHub release assets returned non-array payload');
      values.push(...batch);
      if (batch.length < 100) break;
    }
    return values;
  }

  async function findStored(release, asset) {
    if (!release) return null;
    const expectedUrl = releaseAssetUrl(serverBase, repo, tag, asset.objectName);
    const matches = (await listAssets(release)).filter((item) => item?.name === asset.objectName);
    if (matches.length === 0) return null;
    if (matches.length !== 1) throw new Error(`duplicate GitHub release assets for ${asset.objectName}`);
    return validateStoredAsset(matches[0], { objectName: asset.objectName, expectedUrl });
  }

  async function ensureRelease() {
    const current = await getRelease();
    if (current) return current;

    const url = releaseApiUrl(apiBase, repo, '');
    const response = await request(url, {
      method: 'POST',
      headers: apiHeaders(auth, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        tag_name: tag,
        name: 'Ox0 Blog content-addressed Article assets',
        body: 'Managed by the trusted ox0-blog AssetPublisher. Asset names are SHA-256 content addresses.',
        draft: false,
        prerelease: true,
        generate_release_notes: false,
        make_latest: 'false'
      })
    });
    if (response.status === 422) {
      const raced = await getRelease();
      if (raced) return raced;
    }
    return validateRelease(await jsonResponse(response, 'create GitHub asset release'), tag);
  }

  async function upload(release, asset, bytes, expectedUrl) {
    const uploadBase = release.upload_url.split('{', 1)[0];
    const uploadUrl = new URL(uploadBase);
    uploadUrl.searchParams.set('name', asset.objectName);
    const response = await request(uploadUrl, {
      method: 'POST',
      headers: apiHeaders(auth, { 'Content-Type': asset.contentType }),
      body: bytes
    });

    if (response.status === 422) {
      const stored = await findStored(await getRelease(), asset);
      if (stored && stored.size === asset.size && stored.sha256 === asset.digest) return;
    }

    const created = await jsonResponse(response, 'upload GitHub release asset');
    const stored = validateStoredAsset(created, { objectName: asset.objectName, expectedUrl });
    if (stored.size !== asset.size || stored.sha256 !== asset.digest) {
      throw new Error(`uploaded GitHub release asset metadata mismatch for ${asset.objectName}`);
    }
  }

  return {
    async planAsset(rawAsset) {
      const asset = normalizeAsset(rawAsset);
      const url = releaseAssetUrl(serverBase, repo, tag, asset.objectName);
      const stored = await findStored(await getRelease(), asset);
      if (stored && (stored.size !== asset.size || stored.sha256 !== asset.digest)) {
        throw new Error(`GitHub release asset metadata mismatch for ${asset.objectName}`);
      }
      return {
        action: stored ? 'reuse' : 'publish',
        url,
        ref: asset.ref,
        fingerprint: asset.fingerprint
      };
    },

    async publishAsset(rawAsset, rawBytes, rawPlan) {
      const asset = normalizeAsset(rawAsset);
      if (!rawPlan || typeof rawPlan !== 'object' || Array.isArray(rawPlan)) throw new Error('AssetPublisher plan is required');
      const expectedUrl = releaseAssetUrl(serverBase, repo, tag, asset.objectName);
      if (
        rawPlan.action !== 'publish'
        || rawPlan.ref !== asset.ref
        || rawPlan.fingerprint !== asset.fingerprint
        || rawPlan.url !== expectedUrl
      ) {
        throw new Error('GitHub release publish plan does not match exact asset evidence');
      }
      if (!Buffer.isBuffer(rawBytes) && !(rawBytes instanceof Uint8Array)) {
        throw new Error('GitHub release asset bytes must be Buffer or Uint8Array');
      }
      const bytes = Buffer.from(rawBytes);
      if (bytes.length !== asset.size) {
        throw new Error(`GitHub release asset size changed: expected ${asset.size}, got ${bytes.length}`);
      }
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== asset.digest) {
        throw new Error(`GitHub release asset digest changed: expected ${asset.digest}, got ${digest}`);
      }

      const release = await ensureRelease();
      const before = await findStored(release, asset);
      if (before) {
        if (before.size !== asset.size || before.sha256 !== asset.digest) {
          throw new Error(`GitHub release asset metadata mismatch for ${asset.objectName}`);
        }
        return { url: expectedUrl };
      }

      await upload(release, asset, bytes, expectedUrl);
      const after = await findStored(await getRelease(), asset);
      if (!after || after.size !== asset.size || after.sha256 !== asset.digest) {
        throw new Error(`GitHub release asset missing or mismatched after upload: ${asset.objectName}`);
      }
      return { url: expectedUrl };
    }
  };
}

export function createGitHubReleaseAssetPublisherFromEnvironment({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return createGitHubReleaseAssetPublisher({
    repository: env.GITHUB_REPOSITORY,
    repositoryId: env.GITHUB_REPOSITORY_ID,
    token: env.GITHUB_TOKEN,
    apiBaseUrl: env.GITHUB_API_URL,
    serverBaseUrl: env.GITHUB_SERVER_URL,
    fetchImpl
  });
}
