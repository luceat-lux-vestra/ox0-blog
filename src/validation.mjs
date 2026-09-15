import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { renderMarkdown } from './markdown.mjs';
import { loadPost } from './post.mjs';

async function collectMarkdownFiles(dir, repoRoot) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  // Article bundles own their whole source subtree. The target Article validator
  // validates article.json plus every Markdown source below it; the legacy
  // one-file validator must not reinterpret LocaleVariant Markdown as old
  // frontmatter posts during the migration.
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      const absolute = path.join(dir, entry.name);
      throw new Error(`symlinks are not allowed under posts/: ${path.relative(repoRoot, absolute)}`);
    }
  }
  if (entries.some((entry) => entry.name.toLowerCase() === 'article.json')) {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(absolute, repoRoot));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      if (!entry.name.endsWith('.md')) {
        throw new Error(`Markdown source extension must be lowercase .md: ${path.relative(repoRoot, absolute)}`);
      }
      files.push(path.relative(repoRoot, absolute));
    }
  }
  return files;
}

export async function collectPostPaths(repoRoot = process.cwd()) {
  const postRoot = path.join(repoRoot, 'posts');
  let stat;
  try {
    stat = await lstat(postRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`posts/ root does not exist: ${postRoot}`);
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`posts/ root must be a real directory (symlinks are not allowed): ${postRoot}`);
  }
  return collectMarkdownFiles(postRoot, repoRoot);
}

function normalizedTitle(title) {
  return title.trim().normalize('NFC').toLocaleLowerCase('en-US');
}

export async function validateRepository(repoRoot = process.cwd(), requested = []) {
  const paths = await collectPostPaths(repoRoot);
  const posts = [];
  for (const postPath of paths) {
    const post = await loadPost(postPath, repoRoot);
    await renderMarkdown(post.markdown, { postPath: post.postPath, repoRoot });
    if (post.metadata.status === 'published' && !post.metadata.excerpt) {
      throw new Error(`published post must have excerpt: ${postPath}`);
    }
    posts.push(post);
  }

  const slugs = new Map();
  const titles = new Map();
  for (const post of posts) {
    const relative = path.relative(repoRoot, post.postPath);
    const priorSlug = slugs.get(post.metadata.slug);
    if (priorSlug) throw new Error(`duplicate slug ${post.metadata.slug}: ${priorSlug} and ${relative}`);
    slugs.set(post.metadata.slug, relative);

    const titleKey = normalizedTitle(post.metadata.title);
    const priorTitle = titles.get(titleKey);
    if (priorTitle) throw new Error(`duplicate title ${post.metadata.title}: ${priorTitle} and ${relative}`);
    titles.set(titleKey, relative);
  }
  if (requested.length === 0) return posts;
  const wanted = new Set(requested.map((item) => path.normalize(item)));
  const selected = posts.filter((post) => wanted.has(path.normalize(path.relative(repoRoot, post.postPath))));
  if (selected.length !== wanted.size) {
    const found = new Set(selected.map((post) => path.normalize(path.relative(repoRoot, post.postPath))));
    const missing = [...wanted].filter((item) => !found.has(item));
    throw new Error(`requested post not found in posts/: ${missing.join(', ')}`);
  }
  return selected;
}
