import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MAX_INLINE_IMAGE_BYTES } from '../src/markdown-assets.mjs';
import { renderMarkdown } from '../src/markdown.mjs';

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-markdown-'));
  const postDir = path.join(repoRoot, 'posts');
  const assetDir = path.join(repoRoot, 'assets', 'example');
  await mkdir(postDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  return { repoRoot, postPath: path.join(postDir, 'example.md'), assetDir };
}

test('bilingual rendering emits accessible language wrappers', async () => {
  const html = await renderMarkdown(`:::lang ko\n한국어\n:::\n:::lang en\nEnglish\n:::\n`);
  assert.match(html, /class="ox0-bilingual" data-ox0-bilingual="true"/);
  assert.match(html, /class="ox0-lang" lang="ko" data-ox0-lang="ko"/);
  assert.match(html, /class="ox0-lang" lang="en" data-ox0-lang="en"/);
});

test('local Markdown images are embedded as data URIs', async () => {
  const { repoRoot, postPath, assetDir } = await fixture();
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  await writeFile(path.join(assetDir, 'diagram.png'), bytes);

  const html = await renderMarkdown('![diagram](../assets/example/diagram.png)', { postPath, repoRoot });
  assert.match(html, new RegExp(`src="data:image/png;base64,${bytes.toString('base64')}"`));
  assert.doesNotMatch(html, /\.\.\/assets\/example\/diagram\.png/);
});

test('reference-style local images are embedded through marked image tokens', async () => {
  const { repoRoot, postPath, assetDir } = await fixture();
  const bytes = Buffer.from('gif');
  await writeFile(path.join(assetDir, 'diagram.gif'), bytes);

  const html = await renderMarkdown('![diagram][asset]\n\n[asset]: ../assets/example/diagram.gif', { postPath, repoRoot });
  assert.match(html, new RegExp(`src="data:image/gif;base64,${bytes.toString('base64')}"`));
});

test('remote Markdown images keep valid HTTPS URLs', async () => {
  const html = await renderMarkdown('![remote](https://images.example/diagram.webp)');
  assert.match(html, /src="https:\/\/images\.example\/diagram\.webp"/);
});

test('non-HTTPS and protocol-relative remote image URLs fail closed', async () => {
  for (const href of ['http://images.example/a.png', '//images.example/a.png', 'data:image/png;base64,AA==']) {
    await assert.rejects(renderMarkdown(`![bad](${href})`), /https|protocol-relative/);
  }
});

test('local Markdown images must remain under assets', async () => {
  const { repoRoot, postPath } = await fixture();
  await writeFile(path.join(repoRoot, 'outside.png'), 'outside');

  await assert.rejects(
    renderMarkdown('![escape](../outside.png)', { postPath, repoRoot }),
    /inside assets/
  );
});

test('local Markdown image symlinks are rejected', async () => {
  const { repoRoot, postPath, assetDir } = await fixture();
  await writeFile(path.join(assetDir, 'real.png'), 'real');
  await symlink(path.join(assetDir, 'real.png'), path.join(assetDir, 'alias.png'));

  await assert.rejects(
    renderMarkdown('![alias](../assets/example/alias.png)', { postPath, repoRoot }),
    /symlink/
  );
});

test('raw HTML image elements are rejected instead of bypassing asset validation', async () => {
  await assert.rejects(
    renderMarkdown('<img src="../assets/example/diagram.png" alt="diagram">'),
    /use Markdown image syntax/
  );
});

test('an individual embedded image is size bounded', async () => {
  const { repoRoot, postPath, assetDir } = await fixture();
  await writeFile(path.join(assetDir, 'huge.png'), Buffer.alloc(MAX_INLINE_IMAGE_BYTES + 1));

  await assert.rejects(
    renderMarkdown('![huge](../assets/example/huge.png)', { postPath, repoRoot }),
    /exceeds/
  );
});
