import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

function isOutside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

export async function requireConfinedRegularFile(filePath, rootPath, name = 'file') {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new Error(`${name} path must be a non-empty string`);
  if (typeof rootPath !== 'string' || rootPath.trim() === '') throw new Error(`${name} root must be a non-empty string`);

  const absolute = path.resolve(filePath);
  const root = path.resolve(rootPath);
  if (isOutside(root, absolute)) throw new Error(`${name} must resolve inside ${root}`);

  let rootStat;
  try {
    rootStat = await lstat(root);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${name} root does not exist: ${root}`);
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`${name} root must be a real directory (symlinks are not allowed): ${root}`);
  }

  let realRoot;
  let realFile;
  try {
    [realRoot, realFile] = await Promise.all([realpath(root), realpath(absolute)]);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${name} does not exist: ${absolute}`);
    throw error;
  }

  if (isOutside(realRoot, realFile)) {
    throw new Error(`${name} resolves outside its allowed root: ${absolute}`);
  }

  const lexicalRelative = path.relative(root, absolute);
  const expectedReal = path.resolve(realRoot, lexicalRelative);
  if (realFile !== expectedReal) {
    throw new Error(`${name} path contains a symlink; symlinks are not allowed: ${absolute}`);
  }

  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${name} must be a regular file (symlinks are not allowed): ${absolute}`);
  }

  return { absolutePath: absolute, realPath: realFile, size: stat.size };
}

export async function requireRepositoryAssetFile(filePath, repoRoot, name = 'local asset') {
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') {
    throw new Error(`repoRoot is required to validate ${name}`);
  }
  return requireConfinedRegularFile(filePath, path.resolve(repoRoot, 'assets'), name);
}
