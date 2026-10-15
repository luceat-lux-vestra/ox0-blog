import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const get = (name) => readFile(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

test('direct PR DAG retains all semantic checks and no remote polling', async () => {
  const [yaml, policy] = await Promise.all([
    get('.github/workflows/validate.yml'),
    get('.github/repository-policy.json')
  ]);
  for (const expected of [
    'name: Validate source', 'name: Workflow Security', 'name: Dependency Review',
    'name: PR Article Preview', 'name: Merge Gate',
    'needs: [validate, security, dependency-review, preview]', 'if: always()',
    "needs[job]?.result !== 'success'",
    "process.env.IS_DRAFT === 'true' ? 'skipped' : 'success'",
    'npm test', 'npm run validate', 'actionlint', 'zizmorcore/zizmor-action@',
    'actions/dependency-review-action@'
  ]) assert.ok(yaml.includes(expected), `required semantic check missing: ${expected}`);

  for (const removed of ['fast-evidence', 'runs?event=pull_request', 'for _ in $(seq 1 60', 'actions/runs/$run_id/jobs']) {
    assert.ok(!yaml.includes(removed), `retired control reappeared: ${removed}`);
  }
  assert.deepEqual(JSON.parse(policy).main.required_context_targets, ['Merge Gate']);
});

test('CodeQL remains weekly and manual exact-main only, not on PR or Ghost publication', async () => {
  const [yaml, publication, manualGhost] = await Promise.all([
    get('.github/workflows/codeql.yml'),
    get('.github/workflows/article-publication-lifecycle.yml'),
    get('.github/workflows/article-ghost.yml')
  ]);
  assert.match(yaml, /^  schedule:$/m);
  assert.match(yaml, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(yaml, /^  pull_request:$/m);
  assert.doesNotMatch(yaml, /^  push:$/m);
  assert.ok(yaml.includes("inputs.candidate_sha || github.sha"));
  assert.ok(yaml.includes('remote_main'));
  assert.ok(yaml.includes('- javascript-typescript'));
  assert.ok(yaml.includes('- actions'));
  assert.doesNotMatch(publication, /CodeQL|codeql/);
  assert.doesNotMatch(manualGhost, /CodeQL|codeql/);
});
