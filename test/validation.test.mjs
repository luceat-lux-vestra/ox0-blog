import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateRepository } from '../src/validation.mjs';

async function repo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ox0-authoring-'));
  await mkdir(path.join(root, 'posts'));
  await mkdir(path.join(root, 'assets'));
  return root;
}

function doc({ title = 'Example', slug = 'example', status = 'draft', excerpt = null, body = '# Body' } = {}) {
  return `---\ntitle: ${title}\nslug: ${slug}\nstatus: ${status}\n${excerpt ? `excerpt: ${excerpt}\n` : ''}---\n${body}\n`;
}

test('validates a well-formed bilingual draft', async () => {
  const root = await repo();
  const body = ':::lang ko\n# 한국어\n:::\n:::lang en\n# English\n:::';
  await writeFile(path.join(root, 'posts', 'one.md'), doc({ body }));
  const posts = await validateRepository(root);
  assert.equal(posts.length, 1);
});

test('legacy validation skips Article bundle Markdown owned by article.json', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'legacy.md'), doc({ title: 'Legacy', slug: 'legacy' }));
  const articleDir = path.join(root, 'posts', 'article');
  await mkdir(articleDir);
  await writeFile(path.join(articleDir, 'article.json'), '{}\n', 'utf8');
  await writeFile(path.join(articleDir, 'ko-KR.md'), '# target Article source without legacy frontmatter\n', 'utf8');
  await writeFile(path.join(articleDir, 'en.md'), '# target Article source without legacy frontmatter\n', 'utf8');

  const posts = await validateRepository(root);
  assert.equal(posts.length, 1);
  assert.equal(path.relative(root, posts[0].postPath), path.join('posts', 'legacy.md'));
});

test('repository validation renders and validates local body images', async () => {
  const root = await repo();
  await mkdir(path.join(root, 'assets', 'one'));
  await writeFile(path.join(root, 'assets', 'one', 'diagram.png'), 'png');
  await writeFile(path.join(root, 'posts', 'one.md'), doc({ body: '![diagram](../assets/one/diagram.png)' }));
  const posts = await validateRepository(root);
  assert.equal(posts.length, 1);
});

test('repository validation rejects missing local body images before Ghost access', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'one.md'), doc({ body: '![missing](../assets/one/missing.png)' }));
  await assert.rejects(validateRepository(root), /does not exist/);
});

test('rejects case-variant Markdown extensions instead of silently ignoring them', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'one.MD'), doc());
  await assert.rejects(validateRepository(root), /extension must be lowercase \.md/);
});

test('rejects duplicate slugs across repository', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'one.md'), doc({ title: 'One', slug: 'same' }));
  await writeFile(path.join(root, 'posts', 'two.md'), doc({ title: 'Two', slug: 'same' }));
  await assert.rejects(validateRepository(root), /duplicate slug same/);
});

test('rejects duplicate titles case-insensitively', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'one.md'), doc({ title: 'Same Title', slug: 'one' }));
  await writeFile(path.join(root, 'posts', 'two.md'), doc({ title: 'same title', slug: 'two' }));
  await assert.rejects(validateRepository(root), /duplicate title/);
});

test('rejects canonically equivalent Unicode titles', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'one.md'), doc({ title: 'Café', slug: 'one' }));
  await writeFile(path.join(root, 'posts', 'two.md'), doc({ title: 'Cafe\u0301', slug: 'two' }));
  await assert.rejects(validateRepository(root), /duplicate title/);
});

test('published posts require an excerpt', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'one.md'), doc({ status: 'published' }));
  await assert.rejects(validateRepository(root), /published post must have excerpt/);
});

test('malformed bilingual grammar fails repository validation', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'one.md'), doc({ body: ':::lang ko\n한국어\n:::' }));
  await assert.rejects(validateRepository(root), /exactly one ko section and one en section/);
});

test('selected-file validation still enforces repository-wide duplicates', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'one.md'), doc({ title: 'One', slug: 'same' }));
  await writeFile(path.join(root, 'posts', 'two.md'), doc({ title: 'Two', slug: 'same' }));
  await assert.rejects(validateRepository(root, ['posts/one.md']), /duplicate slug same/);
});

test('repository validation rejects a symlinked Markdown post instead of ignoring it', async () => {
  const root = await repo();
  await writeFile(path.join(root, 'posts', 'target.md'), doc());
  await symlink('target.md', path.join(root, 'posts', 'linked.md'));
  await assert.rejects(validateRepository(root), /symlinks are not allowed under posts/);
});

test('repository validation rejects a symlinked directory instead of ignoring it', async () => {
  const root = await repo();
  await mkdir(path.join(root, 'real-posts'));
  await writeFile(path.join(root, 'real-posts', 'outside.md'), doc());
  await symlink('../real-posts', path.join(root, 'posts', 'linked'));
  await assert.rejects(validateRepository(root), /symlinks are not allowed under posts/);
});

test('repository validation rejects a symlinked posts root even when it is empty', async () => {
  const root = await repo();
  await rm(path.join(root, 'posts'), { recursive: true });
  await mkdir(path.join(root, 'real-posts'));
  await symlink('real-posts', path.join(root, 'posts'));
  await assert.rejects(validateRepository(root), /posts\/ root must be a real directory/);
});
