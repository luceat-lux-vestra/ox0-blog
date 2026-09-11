#!/usr/bin/env node
import { GhostAdminClient } from '../src/ghost-client.mjs';
import { renderMarkdown } from '../src/markdown.mjs';
import { planPostSynchronization } from '../src/publisher.mjs';
import { validateRepository } from '../src/validation.mjs';

const [postPath] = process.argv.slice(2);
if (!postPath) throw new Error('usage: node scripts/plan-post.mjs <posts/file.md>');

const url = process.env.GHOST_ADMIN_URL;
const key = process.env.GHOST_ADMIN_API_KEY;
if (!url || !key) throw new Error('GHOST_ADMIN_URL and GHOST_ADMIN_API_KEY are required');

const repoRoot = process.cwd();
const [source] = await validateRepository(repoRoot, [postPath]);
const action = source.metadata.status === 'published' ? 'publish' : 'draft';
const client = new GhostAdminClient({ url, key });
const plan = await planPostSynchronization({ source, action, client, repoRoot, renderMarkdown });
console.log(JSON.stringify(plan, null, 2));
