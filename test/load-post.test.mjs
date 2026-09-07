import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPost } from '../src/post.mjs';

async function repo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ox0-blog-'));
  await mkdir(path.join(root, 'posts'));
  await mkdir(path.join(root, 'assets'));
  return root;
}

function document(featureImage = null) {
  return `---\ntitle: Example\nslug: example\nstatus: draft\n${featureImage ? `feature_image: ${featureImage}\n` : ''}---\n# Body\n`;
}

test('loads a regular post source', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'example.md'), document());
  const loaded = await loadPost('posts/example.md', root);
  assert.equal(loaded.metadata.slug, 'example');
});

test('rejects case-variant Markdown extensions', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'example.MD'), document());
  await assert.rejects(loadPost('posts/example.MD', root), /lowercase \.md extension/);
});

test('rejects a symlinked post source', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'target.md'), document());
  await symlink('target.md', path.join(root, 'posts', 'example.md'));
  await assert.rejects(loadPost('posts/example.md', root), /symlink|regular file/);
});

test('rejects a post reached through a symlinked parent directory', async () => {
  const root = await repo();
  await mkdir(path.join(root, 'real-posts'));
  await writeFile(path.join(root, 'real-posts', 'example.md'), document());
  await symlink('../real-posts', path.join(root, 'posts', 'linked'));
  await assert.rejects(loadPost('posts/linked/example.md', root), /outside|symlink/);
});

test('rejects a missing local feature image during validation', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'example.md'), document('../assets/missing.png'));
  await assert.rejects(loadPost('posts/example.md', root), /local feature_image does not exist/);
});

test('rejects a symlinked local feature image', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'assets', 'target.png'), 'image');
  await symlink('target.png', path.join(root, 'assets', 'cover.png'));
  await writeFile(path.join(root, 'posts', 'example.md'), document('../assets/cover.png'));
  await assert.rejects(loadPost('posts/example.md', root), /symlink|regular file/);
});

test('rejects a feature image reached through a symlinked parent directory', async () => {
  const root = await repo();
  await mkdir(path.join(root, 'real-assets'));
  await writeFile(path.join(root, 'real-assets', 'cover.png'), 'image');
  await symlink('../real-assets', path.join(root, 'assets', 'linked'));
  await writeFile(path.join(root, 'posts', 'example.md'), document('../assets/linked/cover.png'));
  await assert.rejects(loadPost('posts/example.md', root), /outside|symlink/);
});
