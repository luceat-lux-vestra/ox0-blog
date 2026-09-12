import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireAssetPublisher } from './asset-publisher.mjs';

function isOutside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function requireModuleRef(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('OX0_HOST_RUNTIME_MODULE must be a non-empty repository-relative .mjs path');
  }
  const ref = value.trim();
  if (ref.includes('\\')) throw new Error('OX0_HOST_RUNTIME_MODULE must use forward slashes');
  if (path.posix.isAbsolute(ref) || path.win32.isAbsolute(ref)) {
    throw new Error('OX0_HOST_RUNTIME_MODULE must be repository-relative');
  }
  if (path.posix.extname(ref) !== '.mjs') {
    throw new Error('OX0_HOST_RUNTIME_MODULE must reference a .mjs module');
  }
  const normalized = path.posix.normalize(ref);
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('./')) {
    throw new Error('OX0_HOST_RUNTIME_MODULE must not traverse or alias its repository path');
  }
  if (!normalized.startsWith('host/')) {
    throw new Error('OX0_HOST_RUNTIME_MODULE must live under repository host/');
  }
  return normalized;
}

async function requireRealDirectory(candidate, label) {
  const stat = await lstat(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory; symlinks are not allowed`);
  }
  return realpath(candidate);
}

async function confinedHostModule(repoRoot, moduleRef) {
  const root = path.resolve(repoRoot);
  const hostRoot = path.resolve(root, 'host');
  const realHostRoot = await requireRealDirectory(hostRoot, 'host/ root');
  const candidate = path.resolve(root, ...moduleRef.split('/'));
  if (isOutside(hostRoot, candidate)) {
    throw new Error('host runtime module must resolve inside repository host/');
  }
  const stat = await lstat(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('host runtime module must be a regular .mjs file; symlinks are not allowed');
  }
  const realFile = await realpath(candidate);
  if (isOutside(realHostRoot, realFile)) {
    throw new Error('host runtime module resolves outside repository host/');
  }
  const lexicalRelative = path.relative(hostRoot, candidate);
  const expectedReal = path.resolve(realHostRoot, lexicalRelative);
  if (realFile !== expectedReal) {
    throw new Error('host runtime module path contains a symlink; symlinks are not allowed');
  }
  return realFile;
}

function normalizeProjectContextExport(value) {
  if (value == null) return {};
  if (typeof value === 'function') return value;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  throw new Error('host runtime projectContext must be an object or function when exported');
}

export async function loadHostRuntime({
  repoRoot = process.cwd(),
  moduleRef = process.env.OX0_HOST_RUNTIME_MODULE ?? null
} = {}) {
  if (moduleRef == null || moduleRef === '') {
    return { assetPublisher: null, projectContext: {} };
  }
  const ref = requireModuleRef(moduleRef);
  const absolute = await confinedHostModule(repoRoot, ref);
  const loaded = await import(pathToFileURL(absolute).href);

  const assetPublisher = loaded.assetPublisher == null
    ? null
    : requireAssetPublisher(loaded.assetPublisher);
  const projectContext = normalizeProjectContextExport(loaded.projectContext);

  if (assetPublisher == null && Object.keys(loaded).every((key) => key !== 'projectContext')) {
    throw new Error('host runtime module must export assetPublisher and/or projectContext');
  }

  return { assetPublisher, projectContext };
}
