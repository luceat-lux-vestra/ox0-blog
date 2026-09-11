import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const IMAGE_MIME_TYPES = new Map([
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml']
]);

export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_INLINE_ASSET_BYTES = 15 * 1024 * 1024;
const MAX_REMOTE_IMAGE_URL_LENGTH = 2000;

function isOutside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function isAbsoluteOnAnyPlatform(value) {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function parseImageHref(href) {
  if (typeof href !== 'string' || href.trim() === '') {
    throw new Error('Markdown image URL must be a non-empty string');
  }
  const value = href.trim();

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error(`Markdown image URL is invalid: ${value}`); }
    if (parsed.protocol !== 'https:') {
      throw new Error(`remote Markdown images must use https: ${value}`);
    }
    if (value.length > MAX_REMOTE_IMAGE_URL_LENGTH) {
      throw new Error(`remote Markdown image URL must be at most ${MAX_REMOTE_IMAGE_URL_LENGTH} characters`);
    }
    return { kind: 'remote', value };
  }

  if (value.startsWith('//')) {
    throw new Error(`protocol-relative Markdown image URLs are not allowed: ${value}`);
  }
  if (isAbsoluteOnAnyPlatform(value)) {
    throw new Error(`local Markdown image must use a relative path under assets/: ${value}`);
  }
  if (value.includes('?') || value.includes('#')) {
    throw new Error(`local Markdown image paths must not contain query strings or fragments: ${value}`);
  }

  let decoded;
  try { decoded = decodeURIComponent(value); } catch {
    throw new Error(`local Markdown image path contains invalid percent encoding: ${value}`);
  }
  if (decoded.includes('\\')) {
    throw new Error(`local Markdown image paths must use forward slashes: ${value}`);
  }
  if (decoded.includes('\0')) {
    throw new Error('local Markdown image path must not contain NUL bytes');
  }
  return { kind: 'local', value: decoded };
}

async function requireAssetRoot(assetRoot) {
  let stat;
  try { stat = await lstat(assetRoot); } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`assets/ root does not exist: ${assetRoot}`);
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`assets/ root must be a real directory (symlinks are not allowed): ${assetRoot}`);
  }
  return realpath(assetRoot);
}

async function readConfinedImage(candidate, assetRoot, realAssetRoot) {
  if (isOutside(assetRoot, candidate)) {
    throw new Error(`local Markdown image must resolve inside assets/: ${candidate}`);
  }

  const extension = path.extname(candidate).toLowerCase();
  const mime = IMAGE_MIME_TYPES.get(extension);
  if (!mime) throw new Error(`unsupported Markdown image extension: ${candidate}`);

  let realFile;
  try { realFile = await realpath(candidate); } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`local Markdown image does not exist: ${candidate}`);
    throw error;
  }
  if (isOutside(realAssetRoot, realFile)) {
    throw new Error(`local Markdown image resolves outside assets/: ${candidate}`);
  }

  const lexicalRelative = path.relative(assetRoot, candidate);
  const expectedReal = path.resolve(realAssetRoot, lexicalRelative);
  if (realFile !== expectedReal) {
    throw new Error(`local Markdown image path contains a symlink; symlinks are not allowed: ${candidate}`);
  }

  const stat = await lstat(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`local Markdown image must be a regular file: ${candidate}`);
  }
  if (stat.size > MAX_INLINE_IMAGE_BYTES) {
    throw new Error(`local Markdown image exceeds ${MAX_INLINE_IMAGE_BYTES} bytes: ${candidate}`);
  }

  const bytes = await readFile(candidate);
  if (bytes.length !== stat.size) {
    throw new Error(`local Markdown image changed while being read: ${candidate}`);
  }
  return { bytes, mime };
}

export function createMarkdownAssetWalker({ postPath, repoRoot } = {}) {
  const cache = new Map();
  let totalEmbeddedBytes = 0;
  let realAssetRootPromise;

  async function loadLocalImage(href) {
    if (!postPath || !repoRoot) {
      throw new Error('postPath and repoRoot are required to inline local Markdown images');
    }
    const assetRoot = path.resolve(repoRoot, 'assets');
    const candidate = path.resolve(path.dirname(postPath), href);
    realAssetRootPromise ??= requireAssetRoot(assetRoot);
    const realAssetRoot = await realAssetRootPromise;
    let pending = cache.get(candidate);
    if (!pending) {
      pending = readConfinedImage(candidate, assetRoot, realAssetRoot);
      cache.set(candidate, pending);
    }
    return pending;
  }

  return function walkAssetToken(token) {
    if (token.type === 'html') {
      throw new Error('raw HTML is not supported in canonical Markdown; use Markdown syntax so content and assets stay within the validated authoring contract');
    }
    if (token.type !== 'image') return undefined;

    const parsed = parseImageHref(token.href);
    if (parsed.kind === 'remote') return undefined;

    return loadLocalImage(parsed.value).then(({ bytes, mime }) => {
      totalEmbeddedBytes += bytes.length;
      if (totalEmbeddedBytes > MAX_INLINE_ASSET_BYTES) {
        throw new Error(`Markdown embedded image total exceeds ${MAX_INLINE_ASSET_BYTES} bytes`);
      }
      token.href = `data:${mime};base64,${bytes.toString('base64')}`;
    });
  };
}
