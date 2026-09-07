#!/usr/bin/env node
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadPost } from '../src/post.mjs';

const repoRoot = process.cwd();
const requested = process.argv.slice(2);
const postRoot = path.join(repoRoot, 'posts');

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`symlinks are not allowed under posts/: ${path.relative(repoRoot, absolute)}`);
    }
    if (entry.isDirectory()) {
      files.push(...await collect(absolute));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      if (!entry.name.endsWith('.md')) {
        throw new Error(`Markdown source extension must be lowercase .md: ${path.relative(repoRoot, absolute)}`);
      }
      files.push(path.relative(repoRoot, absolute));
    }
  }
  return files;
}

let postRootStat;
try {
  postRootStat = await lstat(postRoot);
} catch (error) {
  if (error?.code === 'ENOENT') throw new Error(`posts/ root does not exist: ${postRoot}`);
  throw error;
}
if (!postRootStat.isDirectory() || postRootStat.isSymbolicLink()) {
  throw new Error(`posts/ root must be a real directory (symlinks are not allowed): ${postRoot}`);
}

const targets = requested.length > 0 ? requested : await collect(postRoot);
for (const target of targets) {
  const post = await loadPost(target, repoRoot);
  console.log(`ok ${path.relative(repoRoot, post.postPath)} (${post.metadata.status})`);
}
