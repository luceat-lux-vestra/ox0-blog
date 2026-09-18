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

test('new Article auto-draft workflow preflights every selected Article before any draft mutation', async () => {
  const source = await readFile(WORKFLOW, 'utf8');

  assert.match(source, /npm test/);
  assert.match(source, /npm run validate/);
  assert.match(source, /^      - name: Prove every selected Article is READY\/SYNCED$/m);
  assert.match(source, /npm run validate:articles -- --ready "\$manifest"/);
  assert.match(source, /^      - name: Preflight every selected Ghost draft plan$/m);
  assert.match(source, /npm run dry-run -- "\$manifest" draft > \/dev\/null/);
  assert.match(source, /^      - name: Synchronize READY\/SYNCED Articles as drafts$/m);
  assert.match(source, /npm run sync:article -- "\$manifest" draft/);

  assert.ok(
    source.indexOf('Prove every selected Article is READY/SYNCED')
      < source.indexOf('Preflight every selected Ghost draft plan')
  );
  assert.ok(
    source.indexOf('Preflight every selected Ghost draft plan')
      < source.indexOf('Synchronize READY/SYNCED Articles as drafts')
  );
  assert.doesNotMatch(source, /sync:article -- "\$manifest" publish/);
  assert.doesNotMatch(source, /publish_confirmation/);
  assert.doesNotMatch(source, /OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON/);
});

test('new Article auto-draft workflow refuses stale pushed source before Ghost mutation', async () => {
  const source = await readFile(WORKFLOW, 'utf8');

  assert.match(source, /^      - name: Reverify pushed source is still current main$/m);
  assert.match(source, /\/git\/ref\/heads\/main/);
  assert.match(source, /test "\$CURRENT_MAIN_SHA" = "\$SOURCE_SHA"/);
  assert.match(source, /refusing stale automatic draft projection/);
  assert.ok(
    source.indexOf('Reverify pushed source is still current main')
      < source.indexOf('Synchronize READY/SYNCED Articles as drafts')
  );
});
