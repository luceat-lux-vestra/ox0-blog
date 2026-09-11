import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAN_SCRIPT = fileURLToPath(new URL('../scripts/plan-post.mjs', import.meta.url));
const PUBLISH_SCRIPT = fileURLToPath(new URL('../scripts/publish-post.mjs', import.meta.url));
const GHOST_ENV = {
  GHOST_ADMIN_URL: 'https://invalid.example',
  GHOST_ADMIN_API_KEY: `test:${'11'.repeat(32)}`
};

function doc({ title, slug }) {
  return `---\ntitle: ${title}\nslug: ${slug}\nstatus: draft\n---\n# Body\n`;
}

async function repoWithDuplicateSlugs() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ox0-entrypoint-'));
  await mkdir(path.join(root, 'posts'));
  await writeFile(path.join(root, 'posts', 'one.md'), doc({ title: 'One', slug: 'same' }));
  await writeFile(path.join(root, 'posts', 'two.md'), doc({ title: 'Two', slug: 'same' }));
  return root;
}

function run(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, ...GHOST_ENV },
    encoding: 'utf8',
    timeout: 5000
  });
}

test('dry-run entrypoint enforces repository-wide validation before Ghost inspection', async () => {
  const root = await repoWithDuplicateSlugs();
  const result = run(PLAN_SCRIPT, ['posts/one.md'], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate slug same/);
  assert.doesNotMatch(result.stderr, /fetch failed|ENOTFOUND|invalid\.example/);
});

test('publish entrypoint enforces repository-wide validation before Ghost mutation', async () => {
  const root = await repoWithDuplicateSlugs();
  const result = run(PUBLISH_SCRIPT, ['posts/one.md', 'draft'], root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate slug same/);
  assert.doesNotMatch(result.stderr, /fetch failed|ENOTFOUND|invalid\.example/);
});
