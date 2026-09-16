#!/usr/bin/env node
import { validateMigrationRepository } from '../src/repository-validation.mjs';

const result = await validateMigrationRepository(process.cwd());
for (const article of result.articles) {
  console.log(`ok article ${article.repositoryPath}`);
}
