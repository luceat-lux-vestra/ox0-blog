import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const API_VERSION = 'v6.0';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_FEATURE_IMAGE_URL_LENGTH = 2000;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function nqlString(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('NQL string value must be non-empty');
  return `'${value.replace(/(['"])/g, '\\$1')}'`;
}

export function createAdminToken(adminKey, nowSeconds = Math.floor(Date.now() / 1000)) {
  const separator = adminKey.indexOf(':');
  if (separator <= 0 || separator === adminKey.length - 1) {
    throw new Error('GHOST_ADMIN_API_KEY must be in id:hexsecret format');
  }
  const id = adminKey.slice(0, separator);
  const secretHex = adminKey.slice(separator + 1);
  if (!/^[0-9a-fA-F]+$/.test(secretHex) || secretHex.length % 2 !== 0) {
    throw new Error('GHOST_ADMIN_API_KEY secret must be valid hexadecimal');
  }

  const header = base64url(JSON.stringify({ alg: 'HS256', kid: id, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: nowSeconds, exp: nowSeconds + 300, aud: '/admin/' }));
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', Buffer.from(secretHex, 'hex')).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function normalizeAdminUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('GHOST_ADMIN_URL must be a valid absolute URL'); }
  if (parsed.protocol !== 'https:') throw new Error('GHOST_ADMIN_URL must use https');
  if (parsed.username || parsed.password) throw new Error('GHOST_ADMIN_URL must not contain URL credentials');
  if (parsed.search || parsed.hash) throw new Error('GHOST_ADMIN_URL must not contain query or fragment');
  return parsed.toString().replace(/\/$/, '');
}

function mimeType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.webp': return 'image/webp';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.png': return 'image/png';
    case '.svg': return 'image/svg+xml';
    default: throw new Error(`unsupported image extension: ${filePath}`);
  }
}

function uploadUrlEvidence(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_FEATURE_IMAGE_URL_LENGTH) {
    return { url: null };
  }
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return { url: null }; }
  if (parsed.username || parsed.password) {
    parsed.username = '';
    parsed.password = '';
    return { url: parsed.href, urlCredentialsRedacted: true };
  }
  return { url: parsed.href };
}

function imageUploadResponseError(message, image) {
  const error = new Error(message);
  error.name = 'GhostImageUploadResponseError';
  error.ghostImageUploadSideEffect = true;
  error.uploadEvidence = uploadUrlEvidence(image?.url);
  return error;
}

function validateUploadedImage(image) {
  if (!image || typeof image.url !== 'string' || image.url.length === 0) {
    throw imageUploadResponseError(
      'Ghost image upload response did not contain a valid images[0].url string',
      image
    );
  }
  if (image.url.length > MAX_FEATURE_IMAGE_URL_LENGTH) {
    throw imageUploadResponseError(
      `Ghost image upload URL must be at most ${MAX_FEATURE_IMAGE_URL_LENGTH} characters`,
      image
    );
  }

  let parsed;
  try {
    parsed = new URL(image.url);
  } catch {
    throw imageUploadResponseError('Ghost image upload response URL must be a valid absolute URL', image);
  }
  if (parsed.protocol !== 'https:') {
    throw imageUploadResponseError('Ghost image upload response URL must use https', image);
  }
  if (parsed.username || parsed.password) {
    throw imageUploadResponseError('Ghost image upload response URL must not contain URL credentials', image);
  }
  return { ...image, url: parsed.href };
}

export class GhostAdminClient {
  constructor({ url, key, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Ghost request timeout must be a positive integer');
    this.adminUrl = normalizeAdminUrl(url);
    this.key = key;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(resource, { method = 'GET', body, query, headers = {} } = {}) {
    const url = new URL(`${this.adminUrl}/ghost/api/admin/${resource.replace(/^\//, '')}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value != null) url.searchParams.set(key, String(value));
      }
    }

    const requestHeaders = {
      Authorization: `Ghost ${createAdminToken(this.key)}`,
      'Accept-Version': API_VERSION,
      ...headers
    };
    if (body != null && !(body instanceof FormData)) requestHeaders['Content-Type'] = 'application/json';

    const signal = AbortSignal.timeout(this.timeoutMs);
    let response;
    let text;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: requestHeaders,
        body: body == null ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        signal
      });
      text = await response.text();
    } catch (error) {
      if (signal.aborted) {
        const timeoutError = new Error(`Ghost Admin API ${method} ${url.pathname} timed out after ${this.timeoutMs}ms`);
        timeoutError.cause = error;
        throw timeoutError;
      }
      throw error;
    }

    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    }
    if (!response.ok) {
      const message = payload?.errors?.[0]?.message ?? payload?.raw ?? `${response.status} ${response.statusText}`;
      const error = new Error(`Ghost Admin API ${method} ${url.pathname} failed: ${message}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async getPostsByTagSlug(tagSlug) {
    const payload = await this.request('posts/', {
      query: { filter: `tag:${tagSlug}`, limit: 2, formats: 'lexical', include: 'tags' }
    });
    return payload.posts ?? [];
  }

  async getPostsBySourceTag(sourceTag) {
    const payload = await this.request('tags/', {
      query: { filter: `name:${nqlString(sourceTag)}`, limit: 2 }
    });
    const tags = (payload.tags ?? []).filter((tag) => tag?.name === sourceTag);
    if (tags.length > 1) throw new Error('multiple Ghost tags claim the same ox0 source identity');
    if (tags.length === 0) return [];
    if (typeof tags[0].slug !== 'string' || tags[0].slug === '') {
      throw new Error('Ghost source identity tag is missing a slug');
    }
    return this.getPostsByTagSlug(tags[0].slug);
  }

  async getPostBySlug(slug) {
    try {
      const payload = await this.request(`posts/slug/${encodeURIComponent(slug)}/`, {
        query: { formats: 'lexical', include: 'tags' }
      });
      return payload.posts[0];
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async getPageBySlug(slug) {
    try {
      const payload = await this.request(`pages/slug/${encodeURIComponent(slug)}/`, { query: { formats: 'lexical' } });
      return payload.pages[0];
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async getPostById(id) {
    const payload = await this.request(`posts/${encodeURIComponent(id)}/`, {
      query: { formats: 'lexical', include: 'tags' }
    });
    return payload.posts[0];
  }

  async createPost(post) {
    const payload = await this.request('posts/', {
      method: 'POST',
      query: { formats: 'lexical' },
      body: { posts: [post] }
    });
    return payload.posts[0];
  }

  async updatePost(id, post) {
    const payload = await this.request(`posts/${encodeURIComponent(id)}/`, {
      method: 'PUT',
      query: { save_revision: 'true', formats: 'lexical' },
      body: { posts: [post] }
    });
    return payload.posts[0];
  }

  async updatePostMetadata(id, post) {
    const payload = await this.request(`posts/${encodeURIComponent(id)}/`, {
      method: 'PUT',
      query: { formats: 'lexical' },
      body: { posts: [post] }
    });
    return payload.posts[0];
  }

  async uploadImageBytes({ bytes, filename }, ref) {
    if (!(bytes instanceof Uint8Array)) throw new Error('image snapshot bytes must be a Uint8Array');
    if (typeof filename !== 'string' || filename.trim() === '') throw new Error('image snapshot filename is required');
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mimeType(filename) }), path.basename(filename));
    form.append('purpose', 'image');
    if (ref) form.append('ref', ref);
    const payload = await this.request('images/upload/', { method: 'POST', body: form });
    return validateUploadedImage(payload?.images?.[0]);
  }

  async uploadImage(filePath, ref) {
    const bytes = await readFile(filePath);
    return this.uploadImageBytes({ bytes, filename: path.basename(filePath) }, ref);
  }
}
