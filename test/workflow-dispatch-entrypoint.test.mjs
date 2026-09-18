import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/workflow-dispatch-article.mjs', import.meta.url));
const SHA = 'a'.repeat(40);
const MANIFEST = 'posts/missing/article.json';

function run(extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT, MANIFEST], {
    env: {
      ...process.env,
      GHOST_ADMIN_URL: 'https://invalid.example',
      GHOST_ADMIN_API_KEY: `test:${'11'.repeat(32)}`,
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: SHA,
      OX0_ARTICLE_SOURCE_SHA: SHA,
      OX0_ARTICLE_OPERATION: 'plan-draft',
      OX0_ARTICLE_PUBLISH_CONFIRMATION: '',
      ...extraEnv
    },
    encoding: 'utf8',
    timeout: 5000
  });
}

function stderrJson(result) {
  assert.notEqual(result.status, 0);
  return JSON.parse(result.stderr);
}

test('Article workflow dispatch refuses non-Actions execution before source or Ghost work', () => {
  const result = run({ GITHUB_ACTIONS: 'false' });
  const error = stderrJson(result);
  assert.match(error.message, /requires GitHub Actions/);
  assert.doesNotMatch(result.stderr, /ENOTFOUND|fetch failed|invalid\.example|ENOENT.*article\.json/);
});

test('Article workflow dispatch refuses non-main execution before source or Ghost work', () => {
  const result = run({ GITHUB_REF: 'refs/heads/feature' });
  const error = stderrJson(result);
  assert.match(error.message, /only from refs\/heads\/main/);
  assert.doesNotMatch(result.stderr, /ENOTFOUND|fetch failed|invalid\.example|ENOENT.*article\.json/);
});

test('Article workflow dispatch refuses mismatched exact source SHA before source or Ghost work', () => {
  const result = run({ OX0_ARTICLE_SOURCE_SHA: 'b'.repeat(40) });
  const error = stderrJson(result);
  assert.match(error.message, /source_sha must equal/);
  assert.doesNotMatch(result.stderr, /ENOTFOUND|fetch failed|invalid\.example|ENOENT.*article\.json/);
});

test('production dispatch confirmation is checked before source or Ghost work', () => {
  const result = run({
    OX0_ARTICLE_OPERATION: 'publish',
    OX0_ARTICLE_PUBLISH_CONFIRMATION: `publish:${MANIFEST}@${'b'.repeat(40)}`
  });
  const error = stderrJson(result);
  assert.match(error.message, /production workflow confirmation/);
  assert.doesNotMatch(result.stderr, /ENOTFOUND|fetch failed|invalid\.example|ENOENT.*article\.json/);
});
