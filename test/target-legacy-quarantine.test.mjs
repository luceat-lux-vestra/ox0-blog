import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const TARGET_FILES = [
  '../scripts/plan-article.mjs',
  '../scripts/sync-article.mjs',
  '../scripts/workflow-dispatch-article.mjs',
  '../scripts/verify-article-live-draft.mjs',
  '../src/article-evaluation.mjs',
  '../src/article-manifest.mjs',
  '../src/article-planning.mjs',
  '../src/article-publication.mjs',
  '../src/locale-projection.mjs'
];

const LEGACY_MODULES = [
  'bilingual.mjs',
  'markdown.mjs',
  'markdown-assets.mjs',
  'post.mjs',
  'validation.mjs'
];

const LEGACY_MARKERS = [
  ':::lang',
  'sourceTagForPath',
  'createLegacyInlineImageResolver'
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function source(ref) {
  return readFile(new URL(ref, import.meta.url), 'utf8');
}

test('target Article entrypoints and orchestration do not import legacy one-file modules', async () => {
  for (const ref of TARGET_FILES) {
    const text = await source(ref);
    for (const moduleName of LEGACY_MODULES) {
      const pattern = new RegExp(
        `(?:from\\s+|import\\s*\\()['\"](?:\\.\\.\\/src\\/|\\.\\/)[^'\"]*${escapeRegex(moduleName)}['\"]`
      );
      assert.doesNotMatch(text, pattern, `${ref} must not import legacy module ${moduleName}`);
    }
  }
});

test('target Article path does not reintroduce legacy source-model markers', async () => {
  for (const ref of TARGET_FILES) {
    const text = await source(ref);
    for (const marker of LEGACY_MARKERS) {
      assert.equal(
        text.includes(marker),
        false,
        `${ref} must not depend on legacy marker ${marker}`
      );
    }
  }
});

test('target manual workflow never invokes legacy publishing entrypoints', async () => {
  const workflow = await source('../.github/workflows/article-ghost.yml');
  for (const marker of [
    'plan-post.mjs',
    'publish-post.mjs',
    'dry-run:legacy',
    'verify:ghost-live:legacy'
  ]) {
    assert.equal(workflow.includes(marker), false, `target workflow must not invoke ${marker}`);
  }
  assert.match(workflow, /workflow-dispatch-article\.mjs/);
});

test('target and legacy Ghost workflows share one mutation concurrency lock', async () => {
  const targetWorkflow = await source('../.github/workflows/article-ghost.yml');
  const legacyWorkflow = await source('../.github/workflows/ghost-publish.yml');
  const expected = /concurrency:\s*\n\s*group:\s*ox0-blog-ghost-control\s*\n\s*cancel-in-progress:\s*false/;
  assert.match(targetWorkflow, expected);
  assert.match(legacyWorkflow, expected);
});

test('legacy Ghost workflow refuses stale main before compatibility operation', async () => {
  const workflow = await source('../.github/workflows/ghost-publish.yml');
  assert.match(workflow, /OX0_LEGACY_SOURCE_SHA:\s*\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /ref:\s*\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /git rev-parse HEAD/);
  const mainReads = workflow.match(/git\/ref\/heads\/main/g) ?? [];
  assert.equal(mainReads.length, 2, 'legacy workflow must check current main before checkout and before Ghost operation');
  assert.match(workflow, /main advanced during legacy workflow; refusing stale Ghost operation/);
});
