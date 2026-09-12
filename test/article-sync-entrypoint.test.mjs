import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SYNC_SCRIPT = fileURLToPath(new URL('../scripts/sync-article.mjs', import.meta.url));

function run(args, extraEnv = {}) {
  return spawnSync(process.execPath, [SYNC_SCRIPT, ...args], {
    env: {
      ...process.env,
      GHOST_ADMIN_URL: 'https://invalid.example',
      GHOST_ADMIN_API_KEY: `test:${'11'.repeat(32)}`,
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

test('target publish CLI requires external authorization before source or Ghost work', () => {
  const result = run(['posts/missing/article.json', 'publish'], {
    OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON: ''
  });
  const error = stderrJson(result);
  assert.match(error.message, /requires OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON/);
  assert.doesNotMatch(result.stderr, /ENOTFOUND|fetch failed|invalid\.example/);
});

test('target publish CLI parses authorization with strict duplicate-key rejection', () => {
  const result = run(['posts/missing/article.json', 'publish'], {
    OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON: '{"version":1,"version":1}'
  });
  const error = stderrJson(result);
  assert.match(error.message, /duplicate JSON object key: version/);
  assert.doesNotMatch(result.stderr, /ENOTFOUND|fetch failed|invalid\.example/);
});

test('draft CLI rejects a production authorization envelope instead of silently ignoring it', () => {
  const result = run(['posts/missing/article.json', 'draft'], {
    OX0_ARTICLE_PUBLICATION_AUTHORIZATION_JSON: '{}'
  });
  const error = stderrJson(result);
  assert.match(error.message, /only valid for publish/);
  assert.doesNotMatch(result.stderr, /ENOTFOUND|fetch failed|invalid\.example/);
});
