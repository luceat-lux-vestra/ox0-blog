import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const WORKFLOW = fileURLToPath(new URL('../.github/workflows/article-publication-lifecycle.yml', import.meta.url));

test('publication lifecycle separates trusted PR draft staging from main production publication', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  assert.ok(source.includes('name: Article Publication Lifecycle'));
  assert.ok(source.includes('  pull_request_target:'));
  assert.ok(source.includes('  push:'));
  assert.ok(source.includes('    branches: [main]'));
  assert.ok(source.includes("github.event.pull_request.head.repo.full_name == github.repository"));
  assert.ok(source.includes('  group: ox0-blog-ghost-control'));
  assert.ok(source.includes('  cancel-in-progress: false'));
});

test('PR draft staging executes trusted base tooling against candidate data only', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  assert.ok(source.includes('path: tooling'));
  assert.ok(source.includes('path: candidate'));
  assert.ok(source.includes('working-directory: tooling'));
  assert.ok(source.includes('npm ci --ignore-scripts'));
  assert.ok(source.includes('node ../tooling/scripts/validate-repository.mjs'));
  assert.ok(source.includes('node ../tooling/scripts/validate-articles.mjs --ready "$manifest"'));
  assert.ok(source.includes('node ../tooling/scripts/plan-article.mjs "$manifest" draft'));
  assert.ok(source.includes('node ../tooling/scripts/sync-article.mjs "$manifest" draft'));
  assert.ok(!source.includes('working-directory: candidate\n        run: npm ci'));
});

test('PR draft staging selects only newly added canonical manifests and reverifies exact PR head', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  assert.ok(source.includes('$1 == "A"'));
  assert.ok(source.includes('^posts\\/[^/]+\\/article[.]json$'));
  assert.ok(source.includes('pulls/$PR_NUMBER'));
  assert.ok(source.includes('test "$current_head" = "$HEAD_SHA"'));
  assert.ok(source.indexOf('Reverify exact PR head before Ghost access') < source.indexOf('Synchronize READY/SYNCED candidates as drafts'));
});

test('main publication requires a reviewed PR merge, selects only affected Articles and proves source stability', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  assert.ok(source.includes('Prove source is a reviewed PR merge to main'));
  assert.ok(source.includes('commits/$SOURCE_SHA/pulls'));
  assert.ok(source.includes('pr.get("merge_commit_sha") == sha'));
  assert.ok(source.includes('git diff --name-only --find-renames "$BEFORE_SHA" "$SOURCE_SHA" -- posts/'));
  assert.ok(source.includes('git merge-base --is-ancestor "$SOURCE_SHA" "$CURRENT_MAIN_SHA"'));
  assert.ok(source.includes('git diff --quiet "$SOURCE_SHA" "$CURRENT_MAIN_SHA" -- "$article_dir"'));
  assert.ok(source.includes('node scripts/main-push-article.mjs "$manifest" plan-publish'));
  assert.ok(source.includes('node scripts/main-push-article.mjs "$manifest" publish'));
  assert.ok(source.indexOf('- name: Preflight every selected production transition') < source.indexOf('- name: Publish exact merged Articles'));
});

test('profile refresh happens only after successful publication', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  assert.ok(source.includes('Trigger profile Publications refresh'));
  assert.ok(source.includes('PROFILE_REPO_DISPATCH_TOKEN'));
  assert.ok(source.includes('"event_type":"blog-publication"'));
  assert.ok(source.includes('repos/luceat-lux-vestra/luceat-lux-vestra/dispatches'));
  assert.ok(source.indexOf('Publish exact merged Articles') < source.indexOf('Trigger profile Publications refresh'));
});

test('profile dispatch payload stays inside the YAML run block', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  assert.ok(source.includes("python3 -c 'import json, pathlib, sys;"));
  assert.ok(!source.includes("\nimport json, pathlib, sys\n"));
  assert.ok(!source.includes("\nPY\n"));
});
