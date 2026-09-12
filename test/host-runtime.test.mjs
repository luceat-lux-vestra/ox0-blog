import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadHostRuntime } from '../src/host-runtime.mjs';

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-host-runtime-'));
  await mkdir(path.join(repoRoot, 'host'), { recursive: true });
  return repoRoot;
}

test('host runtime loads repository-confined AssetPublisher and ProjectContext exports', async () => {
  const repoRoot = await fixture();
  await writeFile(path.join(repoRoot, 'host', 'runtime.mjs'), `
export const assetPublisher = {
  async planAsset(asset) {
    return {
      action: 'reuse',
      url: 'https://assets.example/' + asset.fingerprint.slice('sha256:'.length) + '.png',
      ref: asset.ref,
      fingerprint: asset.fingerprint
    };
  }
};
export const projectContext = (variant) => ({ marker: 'ctx-' + variant.locale });
`, 'utf8');

  const runtime = await loadHostRuntime({
    repoRoot,
    moduleRef: 'host/runtime.mjs'
  });
  assert.equal(typeof runtime.assetPublisher.planAsset, 'function');
  assert.equal(typeof runtime.projectContext, 'function');
  assert.deepEqual(runtime.projectContext({ locale: 'en' }), { marker: 'ctx-en' });
});

test('missing host runtime configuration produces no implicit publisher and empty context', async () => {
  const repoRoot = await fixture();
  const runtime = await loadHostRuntime({ repoRoot, moduleRef: null });
  assert.equal(runtime.assetPublisher, null);
  assert.deepEqual(runtime.projectContext, {});
});

test('host runtime rejects traversal, absolute paths, wrong extension and modules outside host', async () => {
  const repoRoot = await fixture();
  await writeFile(path.join(repoRoot, 'outside.mjs'), 'export const projectContext = {};\n', 'utf8');

  for (const ref of [
    '../outside.mjs',
    './host/runtime.mjs',
    'outside.mjs',
    'host/runtime.js',
    path.join(repoRoot, 'host', 'runtime.mjs')
  ]) {
    await assert.rejects(loadHostRuntime({ repoRoot, moduleRef: ref }), /repository-relative|traverse|host\/|\.mjs/);
  }
});

test('host runtime rejects symlinked module files', async () => {
  const repoRoot = await fixture();
  await writeFile(path.join(repoRoot, 'outside.mjs'), 'export const projectContext = {};\n', 'utf8');
  await symlink(path.join(repoRoot, 'outside.mjs'), path.join(repoRoot, 'host', 'runtime.mjs'));

  await assert.rejects(
    loadHostRuntime({ repoRoot, moduleRef: 'host/runtime.mjs' }),
    /regular \.mjs file|symlink/
  );
});

test('host runtime rejects modules that provide neither supported host dependency', async () => {
  const repoRoot = await fixture();
  await writeFile(path.join(repoRoot, 'host', 'runtime.mjs'), 'export const unrelated = 1;\n', 'utf8');
  await assert.rejects(
    loadHostRuntime({ repoRoot, moduleRef: 'host/runtime.mjs' }),
    /must export assetPublisher and\/or projectContext/
  );
});
