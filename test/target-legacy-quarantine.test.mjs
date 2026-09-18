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
  '../src/publisher.mjs',
  '../src/repository-validation.mjs'
];

const REMOVED_LEGACY_FILES = [
  '../.github/workflows/ghost-publish.yml',
  '../scripts/plan-post.mjs',
  '../scripts/publish-post.mjs',
  '../scripts/validate-post.mjs',
  '../scripts/verify-ghost-live.mjs',
  '../scripts/verify-body-image-live.mjs',
  '../src/bilingual.mjs',
  '../src/frontmatter.mjs',
  '../src/legacy-publisher.mjs',
  '../src/markdown-assets.mjs',
  '../src/markdown.mjs',
  '../src/post.mjs',
  '../src/validation.mjs',
  '../templates/technical-post.md'
];

const LEGACY_MARKERS = [
  ':::lang',
  'sourceTagForPath',
  'createLegacyInlineImageResolver',
  'planPostSynchronization',
  'synchronizePost',
  'validate:legacy',
  'dry-run:legacy',
  'verify:ghost-live:legacy'
];

async function source(ref) {
  return readFile(new URL(ref, import.meta.url), 'utf8');
}

test('Article runtime does not reintroduce removed one-file source mechanics', async () => {
  for (const ref of TARGET_FILES) {
    const text = await source(ref);
    for (const marker of LEGACY_MARKERS) {
      assert.equal(text.includes(marker), false, `${ref} must not contain removed marker ${marker}`);
    }
  }
});

test('removed one-file runtime and source files stay absent', async () => {
  for (const ref of REMOVED_LEGACY_FILES) {
    await assert.rejects(
      access(new URL(ref, import.meta.url)),
      (error) => error?.code === 'ENOENT',
      `${ref} must remain absent`
    );
  }
});

test('package scripts expose only Article validation/planning/synchronization surfaces', async () => {
  const pkg = JSON.parse(await source('../package.json'));
  for (const scriptName of ['validate:legacy', 'dry-run:legacy', 'verify:ghost-live:legacy']) {
    assert.equal(Object.hasOwn(pkg.scripts, scriptName), false, `${scriptName} must remain removed`);
  }
  assert.equal(pkg.scripts.validate, 'node scripts/validate-repository.mjs');
  assert.equal(pkg.scripts['dry-run'], 'node scripts/plan-article.mjs');
  assert.equal(pkg.scripts['sync:article'], 'node scripts/sync-article.mjs');
  assert.equal(pkg.scripts['verify:article-live-draft'], 'node scripts/verify-article-live-draft.mjs');
});

test('target manual workflow invokes only Article control surfaces', async () => {
  const workflow = await source('../.github/workflows/article-ghost.yml');
  assert.match(workflow, /workflow-dispatch-article\.mjs/);
  for (const marker of ['plan-post.mjs', 'publish-post.mjs', 'legacy']) {
    assert.equal(workflow.includes(marker), false, `target workflow must not invoke ${marker}`);
  }
});
