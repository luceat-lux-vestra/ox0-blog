import path from 'node:path';
import { validateArticleRepository } from './article-validation.mjs';

function rememberSlug(slugs, slug, owner) {
  const prior = slugs.get(slug);
  if (prior) {
    throw new Error(`duplicate public slug across Article variants ${slug}: ${prior} and ${owner}`);
  }
  slugs.set(slug, owner);
}

export async function validateMigrationRepository(repoRoot = process.cwd()) {
  const root = path.resolve(repoRoot);
  const articles = await validateArticleRepository(root);

  const slugs = new Map();
  for (const article of articles) {
    for (const variant of article.bundle.article.variants) {
      rememberSlug(
        slugs,
        variant.slug,
        `${article.repositoryPath}#${variant.locale}`
      );
    }
  }

  return { articles };
}
