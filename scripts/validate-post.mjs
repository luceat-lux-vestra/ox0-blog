#!/usr/bin/env node
import path from 'node:path';
import { validateRepository } from '../src/validation.mjs';

const repoRoot = process.cwd();
const requested = process.argv.slice(2);
const posts = await validateRepository(repoRoot, requested);
for (const post of posts) {
  console.log(`ok ${path.relative(repoRoot, post.postPath)} (${post.metadata.status})`);
}
