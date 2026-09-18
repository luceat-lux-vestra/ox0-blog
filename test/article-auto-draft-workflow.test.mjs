import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const WORKFLOW = fileURLToPath(new URL('../.github/workflows/article-auto-draft.yml', import.meta.url));

test('new Article auto-draft workflow is main-push-only and shares the Ghost mutation lock', async () => {
  const source = await readFile(WORKFLOW, 'utf8');

  assert.match(source, /^name: Auto Draft New Articles$/m);
  assert.match(source, /^  push:$/m);
  assert.match(source, /^    branches: \[main\]$/m);
  assert.match(source, /^      - 'posts\/\*\*'$/m);
  assert.doesNotMatch(source, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(source, /^  pull_request:$/m);

  assert.match(source, /^  group: ox0-blog-ghost-control$/m);
  assert.match(source, /^  cancel-in-progress: false$/m);
});

test('new Article auto-draft workflow binds discovery to the exact pushed main source', async () => {
  const source = await readFile(WORKFLOW, 'utf8');

  assert.match(source, /BEFORE_SHA: \$\{\{ github\.event\.before \}\}/);
  assert.match(source, /SOURCE_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(source, /^          fetch-depth: 0$/m);
  assert.match(source, /^          ref: \$\{\{ env\.SOURCE_SHA \}\}$/m);
  assert.match(source, /test "\$\(git rev-parse HEAD\)" = "\$SOURCE_SHA"/);
  assert.match(source, /git merge-base --is-ancestor "\$BEFORE_SHA" "\$SOURCE_SHA"/);
});

test('new Article auto-draft workflow selects only newly added canonical Article manifests', async () => {
  const source = await readFile(WORKFLOW, 'utf8');

  assert.match(source, /git diff --name-status --find-renames "\$BEFORE_SHA" "\$SOURCE_SHA" -- posts\//);
  assert.match(source, /\$1 == "A"/);
  assert.match(source, /\^posts\\\/\[\^\/\]\+\\\/article\[\.\]json\$/);
  assert.doesNotMatch(source, /--no-renames/);
});

test('new Article auto-draft workflow proves READY\/SYNCED before draft mutation and never publishes', async () => {
  const source = await readFile(WORKFLOW, 'utf8');

  assert.match(source, /npm test/);
  assert.match(source, /npm run validate/);
  assert.match(source, /npm run validate:articles -- --ready "\$manifest"/);
  assert.match(source, /npm run sync:article -- "\$manifest" draft/);

  assert.doesNotMatch(source, /sync:article -- "\$manifest" publish/);
  assert.doesNotMatch(source, /publish_confirmation/);
  assert.doesNotMatch(source, /OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON/);
});
