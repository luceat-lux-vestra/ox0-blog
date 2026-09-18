#!/usr/bin/env node
import { validateRepository } from '../src/repository-validation.mjs';

const result = await validateRepository(process.cwd());
for (const article of result.articles) {
  console.log(`ok article ${article.repositoryPath}`);
}
