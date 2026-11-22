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
const SOURCE_SHA_RE = /^[a-f0-9]{40}$/;

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requireRepository(value) {
  const repository = requireString(value, 'GITHUB_REPOSITORY');
  if (!REPOSITORY_RE.test(repository)) throw new Error('GITHUB_REPOSITORY must be owner/name');
  return repository;
}

function requireSourceSha(value) {
  const sourceSha = requireString(value, 'OX0_ARTICLE_SOURCE_SHA');
  if (!SOURCE_SHA_RE.test(sourceSha)) {
    throw new Error('OX0_ARTICLE_SOURCE_SHA must be an exact 40-character lowercase commit SHA');
  }
  return sourceSha;
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

function requireFetch(value) {
  if (typeof value !== 'function') throw new Error('fetch implementation is required');
  return value;
}

function normalizeAsset(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('asset descriptor is required');
  const ref = requireString(raw.ref, 'asset.ref');
  if (!ref.startsWith('assets/')) throw new Error('asset.ref must be under assets/');
  if (ref.includes('\\') || ref.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('asset.ref must be a normalized repository path');
  }
  const fingerprint = requireString(raw.fingerprint, 'asset.fingerprint');
  if (!FINGERPRINT_RE.test(fingerprint)) throw new Error('asset.fingerprint must be sha256:<64 lowercase hex>');
  const filename = requireString(raw.filename, 'asset.filename');
  const extension = path.extname(filename).toLowerCase();
  const contentType = CONTENT_TYPES.get(extension);
  if (!contentType) throw new Error(`unsupported raw image extension: ${filename}`);
  if (!Number.isSafeInteger(raw.size) || raw.size < 0) throw new Error('asset.size must be a non-negative safe integer');
  return { ref, fingerprint, filename, size: raw.size, contentType };
}

function appendBasePath(base, suffix) {
  const url = new URL(base.href);
  const root = url.pathname.replace(/\/+$/, '');
  url.pathname = `${root}/${suffix.replace(/^\/+/, '')}`;
  return url;
}

function contentsApiUrl(apiBase, repository, ref, sourceSha) {
  const encodedRef = ref.split('/').map(encodeURIComponent).join('/');
  const url = appendBasePath(apiBase, `repos/${repository}/contents/${encodedRef}`);
  url.searchParams.set('ref', sourceSha);
  return url;
}

function apiHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`
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

function requireImmutableDownloadUrl(value, { sourceSha, ref }) {
  const raw = requireString(value, `GitHub download_url for ${ref}`);
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`GitHub download_url is invalid for ${ref}`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`GitHub download_url must be credential-free immutable HTTPS for ${ref}`);
  }

  let pathname;
  try { pathname = decodeURIComponent(parsed.pathname); } catch {
    throw new Error(`GitHub download_url path is malformed for ${ref}`);
  }
  if (!pathname.includes(`/${sourceSha}/`)) {
    throw new Error(`GitHub download_url is not pinned to exact source SHA for ${ref}`);
  }
  if (!pathname.endsWith(`/${ref}`)) {
    throw new Error(`GitHub download_url does not resolve the exact repository asset ref: ${ref}`);
  }
  return parsed.href;
}

async function validateBrowserDelivery(request, url, asset) {
  let response;
  try {
    response = await request(url, { method: 'HEAD', headers: { Accept: '*/*' } });
  } catch (error) {
    const wrapped = new Error(`GitHub Raw delivery probe failed for ${asset.ref}`);
    wrapped.cause = error;
    throw wrapped;
  }
  if (!response.ok) {
    throw new Error(`GitHub Raw delivery probe failed with HTTP ${response.status} for ${asset.ref}`);
  }
  const rawContentType = response.headers.get('content-type') ?? '';
  const contentType = rawContentType.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== asset.contentType) {
    throw new Error(
      `GitHub Raw delivery content-type mismatch for ${asset.ref}: expected ${asset.contentType}, got ${contentType || '<missing>'}`
    );
  }
}

function validateRepositoryFile(raw, asset, sourceSha) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`GitHub repository content response is invalid for ${asset.ref}`);
  }
  if (raw.type !== 'file') throw new Error(`GitHub repository content is not a file: ${asset.ref}`);
  if (raw.path !== asset.ref) throw new Error(`GitHub repository content path mismatch for ${asset.ref}`);
  if (raw.name !== path.posix.basename(asset.ref)) {
    throw new Error(`GitHub repository content name mismatch for ${asset.ref}`);
  }
  if (raw.size !== asset.size) {
    throw new Error(`GitHub repository content size mismatch for ${asset.ref}: expected ${asset.size}, got ${raw.size}`);
  }
  return requireImmutableDownloadUrl(raw.download_url, { sourceSha, ref: asset.ref });
}

export function createGitHubRawAssetPublisher({
  repository,
  sourceSha,
  token,
  apiBaseUrl,
  fetchImpl = globalThis.fetch
}) {
  const repo = requireRepository(repository);
  const exactSourceSha = requireSourceSha(sourceSha);
  const auth = requireString(token, 'GITHUB_TOKEN');
  const apiBase = requireHttpsBase(apiBaseUrl, 'GITHUB_API_URL');
  const request = requireFetch(fetchImpl);

  return {
    async planAsset(rawAsset) {
      const asset = normalizeAsset(rawAsset);
      const url = contentsApiUrl(apiBase, repo, asset.ref, exactSourceSha);
      const response = await request(url, { headers: apiHeaders(auth) });
      const content = await jsonResponse(response, `read exact GitHub repository asset ${asset.ref}`);
      const downloadUrl = validateRepositoryFile(content, asset, exactSourceSha);
      await validateBrowserDelivery(request, downloadUrl, asset);
      return {
        action: 'reuse',
        url: downloadUrl,
        ref: asset.ref,
        fingerprint: asset.fingerprint
      };
    }
  };
}

export function createGitHubRawAssetPublisherFromEnvironment({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  return createGitHubRawAssetPublisher({
    repository: env.GITHUB_REPOSITORY,
    sourceSha: env.OX0_ARTICLE_SOURCE_SHA,
    token: env.GITHUB_TOKEN,
    apiBaseUrl: env.GITHUB_API_URL,
    fetchImpl
  });
}
