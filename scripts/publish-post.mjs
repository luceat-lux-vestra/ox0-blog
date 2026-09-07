#!/usr/bin/env node
import { GhostAdminClient } from '../src/ghost-client.mjs';
import { renderMarkdown } from '../src/markdown.mjs';
import { loadPost } from '../src/post.mjs';
import { synchronizePost } from '../src/publisher.mjs';

const [postPath, action] = process.argv.slice(2);
if (!postPath || !['draft', 'publish'].includes(action)) {
  throw new Error('usage: node scripts/publish-post.mjs <posts/file.md> <draft|publish>');
}

const url = process.env.GHOST_ADMIN_URL;
const key = process.env.GHOST_ADMIN_API_KEY;
if (!url || !key) throw new Error('GHOST_ADMIN_URL and GHOST_ADMIN_API_KEY are required');

const repoRoot = process.cwd();
const source = await loadPost(postPath, repoRoot);
const client = new GhostAdminClient({ url, key });
const stamped = await synchronizePost({ source, action, client, repoRoot, renderMarkdown });

console.log(JSON.stringify({ id: stamped.id, slug: stamped.slug, status: stamped.status, url: stamped.url }, null, 2));
