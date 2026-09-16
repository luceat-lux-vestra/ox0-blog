import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { validateArticleRepository } from './article-validation.mjs';

async function collectMarkdownFiles(dir, repoRoot) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`symlinks are not allowed under posts/: ${path.relative(repoRoot, absolute)}`);
    }
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(absolute, repoRoot));
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    if (!entry.name.endsWith('.md')) {
      throw new Error(`Markdown source extension must be lowercase .md: ${path.relative(repoRoot, absolute)}`);
    }
    files.push(path.resolve(absolute));
  }
  return files;
}

export async function validateMigrationRepository(repoRoot = process.cwd()) {
  const root = path.resolve(repoRoot);
  const articles = await validateArticleRepository(root);
  const claimed = new Set(
    articles.flatMap((article) => article.bundle.article.variants.map((variant) => path.resolve(variant.sourcePath)))
  );
  const markdownFiles = await collectMarkdownFiles(path.join(root, 'posts'), root);
  for (const file of markdownFiles) {
    if (!claimed.has(file)) {
      throw new Error(`posts/ Markdown must belong to an Article manifest: ${path.relative(root, file)}`);
    }
  }
  return { articles };
}
