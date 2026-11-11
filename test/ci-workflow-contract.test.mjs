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
    'name: PR Article Preview', 'name: CodeQL Runtime', 'name: Merge Gate',
    'needs: [validate, security, dependency-review, preview, codeql-runtime]', 'if: always()',
    "needs[job]?.result !== 'success'",
    "const required = ['validate', 'security', 'dependency-review', 'codeql-runtime'];",
    "process.env.IS_DRAFT === 'true' ? 'skipped' : 'success'",
    'npm test', 'npm run validate', 'actionlint', 'zizmorcore/zizmor-action@',
    'actions/dependency-review-action@'
  ]) assert.ok(yaml.includes(expected), `required semantic check missing: ${expected}`);

  for (const removed of ['fast-evidence', 'runs?event=pull_request', 'for _ in $(seq 1 60', 'actions/runs/$run_id/jobs']) {
    assert.ok(!yaml.includes(removed), `retired control reappeared: ${removed}`);
  }
  assert.deepEqual(JSON.parse(policy).main.required_context_targets, ['Merge Gate']);
  assert.equal(JSON.parse(policy).main.strict_required_status_checks, false);
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

const codeqlPins = (source) => {
  const found = { init: [], analyze: [] };
  for (const match of source.matchAll(/github\/codeql-action\/(init|analyze)@([0-9a-f]{40})/g)) {
    found[match[1]].push(match[2]);
  }
  return found;
};

const jobBlock = (source, job) => {
  const header = '  ' + job + ':\n';
  const start = source.indexOf(header);
  if (start < 0) return '';
  const tailStart = start + header.length;
  const tail = source.slice(tailStart);
  const next = tail.search(/^  [A-Za-z0-9_-]+:\n/m);
  return next < 0 ? source.slice(start) : source.slice(start, tailStart + next);
};

const runtimeProblems = (validate, production) => {
  const problems = [];
  const runtime = jobBlock(validate, 'codeql-runtime');
  if (!runtime) return ['missing runtime job'];

  const productionPins = codeqlPins(production);
  const runtimePins = codeqlPins(runtime);
  if (productionPins.init.length !== 1 ||
      productionPins.analyze.length !== 1 ||
      productionPins.init[0] !== productionPins.analyze[0]) {
    problems.push('production pin pair');
  }
  if (runtimePins.init.length !== 1 ||
      runtimePins.analyze.length !== 1 ||
      runtimePins.init[0] !== runtimePins.analyze[0] ||
      runtimePins.init[0] !== productionPins.init[0]) {
    problems.push('runtime pin parity');
  }

  const checkoutName = '      - name: Check out exact PR head for CodeQL runtime\n';
  const start = runtime.indexOf(checkoutName);
  const tail = start < 0 ? '' : runtime.slice(start + checkoutName.length);
  const next = tail.search(/^      - name:/m);
  const checkout = start < 0 ? '' : checkoutName + (next < 0 ? tail : tail.slice(0, next));
  for (const fragment of [
    'repository: ${{ github.event.pull_request.head.repo.full_name }}',
    'ref: ${{ github.event.pull_request.head.sha }}',
    'persist-credentials: false'
  ]) {
    if (!checkout.includes(fragment)) problems.push('exact checkout ' + fragment);
  }

  for (const fragment of [
    'contents: read',
    'pull-requests: read',
    'languages: actions',
    'build-mode: none',
    'upload: never',
    'runner.temp'
  ]) {
    if (!runtime.includes(fragment)) problems.push('runtime fragment ' + fragment);
  }
  for (const forbidden of [
    'security-events: write',
    'GHOST_ADMIN_API_KEY',
    'upload-artifact@',
    'upload: always'
  ]) {
    if (runtime.includes(forbidden)) problems.push('forbidden ' + forbidden);
  }
  if (/^    if:/m.test(runtime)) problems.push('job-level if');
  return problems;
};

test('bounded PR CodeQL runtime matches production pin without production authority', async () => {
  const [validate, production, policy, helper] = await Promise.all([
    get('.github/workflows/validate.yml'),
    get('.github/workflows/codeql.yml'),
    get('.github/repository-policy.json'),
    get('.github/scripts/trusted-codeql-runtime-validation.py')
  ]);
  assert.deepEqual(runtimeProblems(validate, production), []);
  assert.match(validate, /echo 'required=true'/);
  assert.match(validate, /trusted-codeql-runtime-validation[.]py[?]ref=\$BASE_SHA/);
  assert.match(validate, /files[?]per_page=100&page=\$page/);
  assert.match(helper, /"production_evidence": False/);
  assert.deepEqual(JSON.parse(policy).security_analysis.codeql_pr_runtime, {
    workflow: '.github/workflows/validate.yml',
    job: 'codeql-runtime',
    language: 'actions',
    build_mode: 'none',
    upload: 'never',
    production_evidence: false,
    production_authority: '.github/workflows/codeql.yml',
    trust_domain: 'untrusted-pr-codeql-runtime'
  });
});

test('PR CodeQL runtime negative controls reject checkout, upload and pin drift', async () => {
  const [validate, production] = await Promise.all([
    get('.github/workflows/validate.yml'),
    get('.github/workflows/codeql.yml')
  ]);

  const synthetic = validate.replace(
    '          ref: ${{ github.event.pull_request.head.sha }}',
    '          ref: ${{ github.sha }}'
  );
  assert.ok(runtimeProblems(synthetic, production).some((problem) => problem.startsWith('exact checkout ref:')));

  const uploaded = validate.replace('          upload: never', '          upload: always');
  assert.ok(runtimeProblems(uploaded, production).some((problem) => problem.includes('upload')));

  const drifted = validate.replace(
    'github/codeql-action/init@9b3254085494b55a0f7c4c2b3d2d52cc712ce370',
    'github/codeql-action/init@ffffffffffffffffffffffffffffffffffffffff'
  );
  assert.ok(runtimeProblems(drifted, production).includes('runtime pin parity'));
});

