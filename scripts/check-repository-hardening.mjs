#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const fail = (message) => {
  console.error(`HARDENING_REASSESSMENT_FAIL: ${message}`);
  process.exitCode = 1;
};

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

  if (!/^permissions:/m.test(source)) fail(`${rel} lacks explicit workflow permissions`);

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
