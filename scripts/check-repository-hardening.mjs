#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const fail = (message) => {
  console.error(`HARDENING_REASSESSMENT_FAIL: ${message}`);
  process.exitCode = 1;
};

function topLevelPermissionViolations(source, rel) {
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex((line) => /^permissions:(?:\s.*)?$/.test(line));
  if (index < 0) return [`${rel} lacks explicit workflow permissions`];

  const header = lines[index].trim();
  if (header === 'permissions: {}' || header === 'permissions: read-all') return [];
  if (header !== 'permissions:') {
    return [`${rel} uses unsupported workflow-level permissions form: ${header}`];
  }

  const violations = [];
  let entries = 0;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) break;

    const match = line.match(/^  ([A-Za-z0-9_-]+):\s*(read|none|write)\s*(?:#.*)?$/);
    if (!match) {
      violations.push(`${rel} has unsupported workflow-level permission entry: ${line.trim()}`);
      continue;
    }
    entries += 1;
    if (match[2] === 'write') {
      violations.push(`${rel} grants workflow-level ${match[1]}:write; move write authority to the exact job`);
    }
  }
  if (entries === 0 && violations.length === 0) {
    violations.push(`${rel} has an empty permissions block; use permissions: {} explicitly`);
  }
  return violations;
}

function permissionSelfTest() {
  const cases = [
    ['read-only block', 'permissions:\n  contents: read\n', true],
    ['explicit empty', 'permissions: {}\n', true],
    ['read-all', 'permissions: read-all\n', true],
    ['none block', 'permissions:\n  contents: none\n', true],
    ['workflow write', 'permissions:\n  contents: read\n  issues: write\n', false],
    ['inline write mapping', 'permissions: { contents: read, issues: write }\n', false],
    ['write-all', 'permissions: write-all\n', false],
    ['missing declaration', 'name: fixture\n', false]
  ];
  for (const [name, source, shouldPass] of cases) {
    const observed = topLevelPermissionViolations(source, 'fixture.yml');
    if ((observed.length === 0) !== shouldPass) {
      throw new Error(`permission self-test ${name} failed: ${JSON.stringify(observed)}`);
    }
  }
  console.log('Workflow permission negative controls: PASS');
}

if (process.argv.includes('--self-test')) {
  permissionSelfTest();
  process.exit(0);
}

const policy = JSON.parse(await readFile(path.join(root, '.github/repository-policy.json'), 'utf8'));

if (policy.assessment?.name !== 'Hardening Reassessment') fail('assessment name drifted');
if (policy.repository?.allow_squash_merge !== true) fail('squash merge must be enabled');
if (policy.repository?.allow_merge_commit !== false) fail('merge commits must be disabled');
if (policy.repository?.allow_rebase_merge !== false) fail('rebase merge must be disabled');
if (policy.repository?.allow_update_branch !== true) fail('branch update support must be enabled');
if (JSON.stringify(policy.main?.allowed_merge_methods) !== JSON.stringify(['squash'])) {
  fail('main must be squash-only');
}

const workflowDir = path.join(root, '.github/workflows');
const entries = (await readdir(workflowDir)).filter((name) => /\.ya?ml$/.test(name)).sort();
const prTargetFiles = [];

for (const entry of entries) {
  const rel = `.github/workflows/${entry}`;
  const source = await readFile(path.join(workflowDir, entry), 'utf8');

  for (const violation of topLevelPermissionViolations(source, rel)) fail(violation);

  const checkoutCount = [...source.matchAll(/uses:\s*actions\/checkout@[0-9a-f]{40}/g)].length;
  const persistFalseCount = [...source.matchAll(/persist-credentials:\s*false/g)].length;
  if (checkoutCount !== persistFalseCount) {
    fail(`${rel} must disable persisted credentials on every checkout (${checkoutCount} checkout, ${persistFalseCount} hardened)`);
  }

  const runsOnCount = [...source.matchAll(/^\s{4}runs-on:/gm)].length;
  const timeoutCount = [...source.matchAll(/^\s{4}timeout-minutes:/gm)].length;
  if (runsOnCount !== timeoutCount) {
    fail(`${rel} must bound every runner job with timeout-minutes (${runsOnCount} jobs, ${timeoutCount} timeouts)`);
  }

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*uses:\s*([^#\s]+).*$/);
    if (!match) continue;
    const ref = match[1];
    if (ref.startsWith('./')) continue;
    const at = ref.lastIndexOf('@');
    const pin = at >= 0 ? ref.slice(at + 1) : '';
    if (!/^[0-9a-f]{40}$/.test(pin)) fail(`${rel} has mutable action ref: ${ref}`);
  }

  if (/^\s{2}pull_request_target:/m.test(source)) prTargetFiles.push(rel);
}

const allowed = [...policy.actions.allowed_pull_request_target_workflows].sort();
if (JSON.stringify(prTargetFiles.sort()) !== JSON.stringify(allowed)) {
  fail(`pull_request_target ownership drifted: actual=${JSON.stringify(prTargetFiles)} expected=${JSON.stringify(allowed)}`);
}

const lifecycle = await readFile(path.join(root, '.github/workflows/article-publication-lifecycle.yml'), 'utf8');
for (const invariant of [
  "github.event.pull_request.head.repo.full_name == github.repository",
  'ref: ${{ env.BASE_SHA }}',
  'path: tooling',
  'path: candidate',
  'working-directory: tooling',
  'npm ci --ignore-scripts',
  'Reverify exact PR head before Ghost access'
]) {
  if (!lifecycle.includes(invariant)) fail(`publication trust-boundary invariant missing: ${invariant}`);
}
if (lifecycle.includes('working-directory: candidate\n        run: npm ci')) {
  fail('candidate-controlled dependencies must not execute with Ghost authority');
}

if (process.exitCode) process.exit(process.exitCode);
console.log('Hardening reassessment repository policy: PASS');
