import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const WORKFLOW = fileURLToPath(new URL('../.github/workflows/article-ghost.yml', import.meta.url));

test('target Article Ghost workflow remains manual-only, exact-main-bound and globally serialized', async () => {
  const source = await readFile(WORKFLOW, 'utf8');

  assert.match(source, /^name: Article Ghost Control Surface$/m);
  assert.match(source, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(source, /^  push:$/m);
  assert.doesNotMatch(source, /^  pull_request:$/m);

  assert.match(source, /^  group: ox0-blog-ghost-control$/m);
  assert.match(source, /^    if: github\.ref == 'refs\/heads\/main'$/m);
  assert.match(source, /^          persist-credentials: false$/m);
  assert.match(source, /source_sha must equal the exact workflow_dispatch main SHA/);
  assert.match(source, /ref: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(source, /node scripts\/workflow-dispatch-article\.mjs "\$MANIFEST_PATH"/);
});

test('target Article workflow fresh-reads canonical main before checkout and immediately before operation', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  const mainRefCalls = source.match(/\/git\/ref\/heads\/main/g) ?? [];

  assert.equal(mainRefCalls.length, 2);
  assert.match(source, /^      - name: Verify dispatch source is still current main$/m);
  assert.match(source, /^      - name: Reverify current main immediately before operation$/m);
  assert.match(source, /source_sha is no longer current main; dispatch a fresh operation/);
  assert.match(source, /main advanced during workflow; refusing stale Article operation/);
  assert.match(source, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
});

test('target Article workflow exposes staged plan, draft and publish operations with explicit publish confirmation', async () => {
  const source = await readFile(WORKFLOW, 'utf8');

  for (const operation of ['plan-draft', 'draft', 'plan-publish', 'publish']) {
    assert.match(source, new RegExp(`^          - ${operation}$`, 'm'));
  }
  assert.match(source, /^      publish_confirmation:$/m);
  assert.match(source, /publish:<manifest_path>@<source_sha>/);
  assert.match(source, /OX0_ARTICLE_PUBLISH_CONFIRMATION: \$\{\{ inputs\.publish_confirmation \}\}/);
});
