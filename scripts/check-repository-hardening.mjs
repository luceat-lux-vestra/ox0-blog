#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
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

const drift = policy.live_drift;
if (drift?.workflow !== '.github/workflows/repository-drift.yml') {
  fail('recurring live-drift workflow ownership is missing');
} else {
  const driftWorkflow = await readFile(path.join(root, drift.workflow), 'utf8');
  for (const fragment of [
    'schedule:',
    'workflow_dispatch:',
    'permissions:\n  contents: read',
    'persist-credentials: false',
    'node scripts/check-repository-hardening.mjs --live'
  ]) {
    if (!driftWorkflow.includes(fragment)) fail(`repository drift workflow missing contract fragment: ${fragment}`);
  }
}

function ghApi(endpoint) {
  try {
    return JSON.parse(execFileSync('gh', ['api', endpoint], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }));
  } catch (error) {
    const detail = error?.stderr?.toString?.().trim() || error?.message || String(error);
    fail(`live readback failed for ${endpoint}: ${detail}`);
    return null;
  }
}

function sameSet(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

if (process.argv.includes('--live')) {
  const fullName = policy.repository?.full_name;
  const repository = ghApi(`repos/${fullName}`);
  if (repository) {
    for (const [key, expected] of [
      ['visibility', policy.repository.visibility],
      ['default_branch', policy.repository.default_branch],
      ['archived', false]
    ]) {
      if (!(key in repository)) fail(`live repository readback omitted ${key}; evidence is insufficient`);
      else if (repository[key] !== expected) fail(`live repository ${key}=${JSON.stringify(repository[key])}; expected ${JSON.stringify(expected)}`);
    }
  }

  const summaries = ghApi(`repos/${fullName}/rulesets?includes_parents=false`);
  let ruleset = null;
  if (Array.isArray(summaries)) {
    const matches = summaries.filter((entry) => entry.name === 'Protect main' && entry.target === 'branch');
    if (matches.length !== 1) fail(`expected exactly one repository branch ruleset named Protect main; found ${matches.length}`);
    else ruleset = ghApi(`repos/${fullName}/rulesets/${matches[0].id}?includes_parents=false`);
  }

  if (ruleset) {
    if (ruleset.enforcement !== 'active') fail(`Protect main enforcement=${ruleset.enforcement}; expected active`);
    const refs = ruleset.conditions?.ref_name;
    if (!refs || !sameSet(refs.include || [], ['~DEFAULT_BRANCH']) || (refs.exclude || []).length !== 0) {
      fail('Protect main must target only the default branch');
    }

    const byType = new Map((ruleset.rules || []).map((rule) => [rule.type, rule.parameters || {}]));
    const requiredTypes = ['deletion', 'non_fast_forward', 'required_linear_history', 'pull_request', 'required_status_checks'];
    for (const type of requiredTypes) if (!byType.has(type)) fail(`Protect main is missing ${type}`);

    const pr = byType.get('pull_request');
    if (pr) {
      if (!sameSet(pr.allowed_merge_methods || [], policy.main.allowed_merge_methods || [])) {
        fail(`Protect main merge methods drifted: ${JSON.stringify(pr.allowed_merge_methods)}`);
      }
      if (pr.required_review_thread_resolution !== policy.main.required_review_thread_resolution) {
        fail('Protect main review-thread resolution drifted');
      }
    }

    const checks = byType.get('required_status_checks');
    if (checks) {
      if (checks.strict_required_status_checks_policy !== policy.main.strict_required_status_checks) {
        fail('Protect main strict required-status policy drifted');
      }
      const observed = (checks.required_status_checks || []).map((item) => item.context);
      if (!sameSet(observed, policy.main.required_context_targets || [])) {
        fail(`Protect main required contexts drifted: actual=${JSON.stringify(observed)} expected=${JSON.stringify(policy.main.required_context_targets)}`);
      }
    }

    if ('bypass_actors' in ruleset) {
      if (!Array.isArray(ruleset.bypass_actors) || ruleset.bypass_actors.length !== 0) {
        fail('Protect main has a live bypass actor');
      }
    } else {
      console.log('MANUAL_READBACK_REQUIRED: main.routine_bypass_actors (GitHub hides this field without ruleset write access)');
    }
  }

  const sbom = ghApi(`repos/${fullName}/dependency-graph/sbom`);
  if (sbom && !sbom.sbom) fail('Dependency Graph SBOM response is missing sbom');

  const pvr = ghApi(`repos/${fullName}/private-vulnerability-reporting`);
  if (pvr && pvr.enabled !== true) fail('private vulnerability reporting is not enabled');

  for (const control of drift?.manual_readback || []) {
    console.log(`MANUAL_READBACK_REQUIRED: ${control}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(process.argv.includes('--live')
  ? 'Hardening reassessment repository + readable live policy: PASS (manual assertions remain explicit)'
  : 'Hardening reassessment repository policy: PASS');
