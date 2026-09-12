#!/usr/bin/env node
import path from 'node:path';
import { planArticlePublication } from '../src/article-planning.mjs';
import { GhostAdminClient } from '../src/ghost-client.mjs';
import { loadHostRuntime } from '../src/host-runtime.mjs';

const [manifestRef, action, ...extra] = process.argv.slice(2);
if (!manifestRef || !action || extra.length > 0) {
  throw new Error('usage: node scripts/plan-article.mjs <posts/.../article.json> <draft|publish>');
}
if (!['draft', 'publish'].includes(action)) throw new Error('action must be draft or publish');

const url = process.env.GHOST_ADMIN_URL;
const key = process.env.GHOST_ADMIN_API_KEY;
if (!url || !key) throw new Error('GHOST_ADMIN_URL and GHOST_ADMIN_API_KEY are required');

const repoRoot = process.cwd();
const manifestPath = path.resolve(repoRoot, manifestRef);
const hostRuntime = await loadHostRuntime({ repoRoot });
const client = new GhostAdminClient({ url, key });
const plan = await planArticlePublication({
  manifestPath,
  action,
  client,
  repoRoot,
  assetPublisher: hostRuntime.assetPublisher,
  projectContext: hostRuntime.projectContext
});
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
