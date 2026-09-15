import path from 'node:path';
import { requireCompiledDocument } from './compiler/document-compiler.mjs';
import { readRepositoryAssetSnapshot } from './file-confinement.mjs';

const IMAGE_EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.gif', '.png', '.svg']);
const MAX_REMOTE_IMAGE_URL_LENGTH = 2000;

function requireVariant(variant) {
  if (!variant || typeof variant !== 'object') throw new Error('LocaleVariant is required');
  if (typeof variant.locale !== 'string' || variant.locale.trim() === '') {
    throw new Error('LocaleVariant.locale must be a non-empty string');
  }
  if (typeof variant.sourcePath !== 'string' || variant.sourcePath.trim() === '') {
    throw new Error('LocaleVariant.sourcePath is required to resolve local material assets');
  }
  if (!path.isAbsolute(variant.sourcePath)) {
    throw new Error('LocaleVariant.sourcePath must be an absolute runtime path');
  }
  return variant;
}

function parseImageHref(href) {
  if (typeof href !== 'string' || href.trim() === '') {
    throw new Error('compiled image href must be a non-empty string');
  }
  const value = href.trim();
  if (value.startsWith('//')) {
    throw new Error(`protocol-relative Markdown image URLs are not allowed: ${value}`);
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error(`Markdown image URL is invalid: ${value}`); }
    if (parsed.protocol !== 'https:') {
      throw new Error(`remote Markdown images must use https: ${value}`);
    }
    if (parsed.username || parsed.password) {
      throw new Error('remote Markdown image URL must not contain URL credentials');
    }
    if (parsed.href.length > MAX_REMOTE_IMAGE_URL_LENGTH) {
      throw new Error(`remote Markdown image URL must be at most ${MAX_REMOTE_IMAGE_URL_LENGTH} characters`);
    }
    return { kind: 'remote', href: parsed.href };
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
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
  return { kind: 'local', href: value, decodedPath: decoded };
}

function repositoryRef(repoRoot, absolutePath) {
  const relative = path.relative(path.resolve(repoRoot), absolutePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`material asset resolved outside repository: ${absolutePath}`);
  }
  return relative.split(path.sep).join('/');
}

export function resolveMaterialImageReference({ variant: rawVariant, href, repoRoot }) {
  const variant = requireVariant(rawVariant);
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') throw new Error('repoRoot is required');
  const root = path.resolve(repoRoot);
  const parsed = parseImageHref(href);
  if (parsed.kind === 'remote') return parsed;

  const absolutePath = path.resolve(path.dirname(variant.sourcePath), parsed.decodedPath);
  const extension = path.extname(absolutePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`unsupported Markdown image extension: ${absolutePath}`);
  }
  const ref = repositoryRef(root, absolutePath);
  if (!ref.startsWith('assets/')) {
    throw new Error(`material Markdown image must resolve under repository assets/: ${absolutePath}`);
  }
  return {
    kind: 'local',
    href: parsed.href,
    ref,
    absolutePath
  };
}

export async function collectMaterialAssetEvidence({ variant: rawVariant, compiledDocument: rawDocument, repoRoot }) {
  const variant = requireVariant(rawVariant);
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') throw new Error('repoRoot is required');
  const root = path.resolve(repoRoot);
  const compiledDocument = requireCompiledDocument(rawDocument);
  if (compiledDocument.locale !== variant.locale) {
    throw new Error(`CompiledDocument.locale=${compiledDocument.locale} does not match LocaleVariant.locale=${variant.locale}`);
  }

  const localByRef = new Map();
  const remoteByUrl = new Map();

  for (const resource of compiledDocument.referencedAssets) {
    if (!resource || typeof resource !== 'object') throw new Error('compiled resource observation must be an object');
    if (resource.kind !== 'image') {
      throw new Error(`unsupported material resource kind: ${resource.kind ?? '<missing>'}`);
    }
    const resolved = resolveMaterialImageReference({ variant, href: resource.href, repoRoot: root });
    if (resolved.kind === 'remote') {
      remoteByUrl.set(resolved.href, { kind: 'image', href: resolved.href });
      continue;
    }

    const snapshot = await readRepositoryAssetSnapshot(resolved.absolutePath, root, 'material Markdown image');
    const sha256 = snapshot.fingerprint.slice('sha256:'.length);
    const prior = localByRef.get(resolved.ref);
    if (prior && prior.sha256 !== sha256) {
      throw new Error(`material asset changed while collecting evidence: ${resolved.ref}`);
    }
    localByRef.set(resolved.ref, { ref: resolved.ref, sha256 });
  }

  return {
    materialAssets: [...localByRef.values()].sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
    remoteResources: [...remoteByUrl.values()].sort((a, b) => a.href < b.href ? -1 : a.href > b.href ? 1 : 0)
  };
}
