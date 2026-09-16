import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const TARGET_FILES = [
  '../scripts/plan-article.mjs',
  '../scripts/sync-article.mjs',
  '../scripts/workflow-dispatch-article.mjs',
  '../scripts/verify-article-live-draft.mjs',
  '../src/article-evaluation.mjs',
  '../src/article-manifest.mjs',
  '../src/article-planning.mjs',
  '../src/article-publication.mjs',
  '../src/locale-projection.mjs',
  '../src/publisher.mjs'
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

const REMOVED_RUNTIME_SURFACES = [
  '../.github/workflows/ghost-publish.yml',
  '../scripts/plan-post.mjs',
  '../scripts/publish-post.mjs',
  '../scripts/validate-post.mjs',
  '../scripts/verify-ghost-live.mjs',
  '../scripts/verify-body-image-live.mjs'
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function source(ref) {
  return readFile(new URL(ref, import.meta.url), 'utf8');
}

test('target Article entrypoints and orchestration do not statically import legacy one-file modules', async () => {
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
  for (const ref of TARGET_FILES.filter((ref) => ref !== '../src/publisher.mjs')) {
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

test('target manual workflow never invokes removed legacy publishing entrypoints', async () => {
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

test('legacy runtime control surfaces stay removed', async () => {
  for (const ref of REMOVED_RUNTIME_SURFACES) {
    await assert.rejects(
      access(new URL(ref, import.meta.url)),
      (error) => error?.code === 'ENOENT',
      `${ref} must remain absent`
    );
  }

  const pkg = JSON.parse(await source('../package.json'));
  for (const scriptName of ['validate:legacy', 'dry-run:legacy', 'verify:ghost-live:legacy']) {
    assert.equal(Object.hasOwn(pkg.scripts, scriptName), false, `${scriptName} must remain removed`);
  }
});
