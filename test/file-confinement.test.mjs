import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requireConfinedRegularFile, requireRepositoryAssetFile } from '../src/file-confinement.mjs';

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-confined-'));
  const assets = path.join(repoRoot, 'assets');
  await mkdir(assets, { recursive: true });
  return { repoRoot, assets };
}

test('regular file inside assets is accepted', async () => {
  const { repoRoot, assets } = await fixture();
  const file = path.join(assets, 'cover.png');
  await writeFile(file, 'png');
  const result = await requireRepositoryAssetFile(file, repoRoot, 'local featureImage');
  assert.equal(result.absolutePath, file);
  assert.equal(result.size, 3);
});

test('lexical path escape outside assets is rejected before realpath resolution', async () => {
  const { repoRoot } = await fixture();
  const outside = path.join(repoRoot, 'outside.png');
  await writeFile(outside, 'x');
  await assert.rejects(
    requireRepositoryAssetFile(outside, repoRoot, 'local featureImage'),
    /must resolve inside/
  );
});

test('file symlink inside assets is rejected even when target is also inside assets', async () => {
  const { repoRoot, assets } = await fixture();
  const real = path.join(assets, 'real.png');
  const alias = path.join(assets, 'alias.png');
  await writeFile(real, 'real');
  await symlink(real, alias);
  await assert.rejects(
    requireRepositoryAssetFile(alias, repoRoot, 'local featureImage'),
    /symlink/
  );
});

test('directory symlink component is rejected', async () => {
  const { repoRoot, assets } = await fixture();
  const realDir = path.join(assets, 'real-dir');
  const aliasDir = path.join(assets, 'alias-dir');
  await mkdir(realDir);
  await writeFile(path.join(realDir, 'a.png'), 'x');
  await symlink(realDir, aliasDir, 'dir');
  await assert.rejects(
    requireRepositoryAssetFile(path.join(aliasDir, 'a.png'), repoRoot, 'local featureImage'),
    /symlink/
  );
});

test('symlinked root is rejected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ox0-root-'));
  const realAssets = path.join(root, 'real-assets');
  const linkedAssets = path.join(root, 'linked-assets');
  await mkdir(realAssets);
  const file = path.join(realAssets, 'a.png');
  await writeFile(file, 'x');
  await symlink(realAssets, linkedAssets, 'dir');
  await assert.rejects(
    requireConfinedRegularFile(path.join(linkedAssets, 'a.png'), linkedAssets, 'asset'),
    /root must be a real directory/
  );
});

test('missing file and directory target fail closed', async () => {
  const { repoRoot, assets } = await fixture();
  await assert.rejects(
    requireRepositoryAssetFile(path.join(assets, 'missing.png'), repoRoot, 'local featureImage'),
    /does not exist/
  );
  await mkdir(path.join(assets, 'directory.png'));
  await assert.rejects(
    requireRepositoryAssetFile(path.join(assets, 'directory.png'), repoRoot, 'local featureImage'),
    /regular file/
  );
});
