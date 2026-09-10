import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const API_VERSION = 'v6.0';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

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
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('GHOST_ADMIN_URL must use https');
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
      query: { filter: `tag:${tagSlug}`, limit: 2, formats: 'lexical' }
    });
    return payload.posts ?? [];
  }

  async getPostsBySourceTag(sourceTag) {
    const payload = await this.request('tags/', {
      query: { filter: `tags.name:${nqlString(sourceTag)}`, limit: 2 }
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
      const payload = await this.request(`posts/slug/${encodeURIComponent(slug)}/`, { query: { formats: 'lexical' } });
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
    const payload = await this.request(`posts/${encodeURIComponent(id)}/`, { query: { formats: 'lexical' } });
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

  async uploadImage(filePath, ref) {
    const bytes = await readFile(filePath);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mimeType(filePath) }), path.basename(filePath));
    form.append('purpose', 'image');
    if (ref) form.append('ref', ref);
    const payload = await this.request('images/upload/', { method: 'POST', body: form });
    if (!payload?.images?.[0]?.url) throw new Error('Ghost image upload response did not contain images[0].url');
    return payload.images[0];
  }
}
