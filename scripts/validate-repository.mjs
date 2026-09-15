#!/usr/bin/env node
import path from 'node:path';
import { validateMigrationRepository } from '../src/repository-validation.mjs';

const repoRoot = process.cwd();
const result = await validateMigrationRepository(repoRoot);

for (const post of result.legacyPosts) {
  console.log(`ok legacy ${path.relative(repoRoot, post.postPath)}`);
}
for (const article of result.articles) {
  console.log(`ok article ${article.repositoryPath}`);
}
