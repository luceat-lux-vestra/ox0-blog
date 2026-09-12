import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { evaluateArticleBundle } from './article-evaluation.mjs';
import { loadArticleManifest } from './article-manifest.mjs';
import { MarkedCompiler } from './compiler/marked-compiler.mjs';

async function requirePostsRoot(repoRoot) {
  const postsRoot = path.resolve(repoRoot, 'posts');
  let stat;
  try { stat = await lstat(postsRoot); } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`posts/ root does not exist: ${postsRoot}`);
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`posts/ root must be a real directory (symlinks are not allowed): ${postsRoot}`);
  }
  return postsRoot;
}

async function collectManifestFiles(dir, repoRoot) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const manifests = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`symlinks are not allowed under posts/: ${path.relative(repoRoot, absolute)}`);
    }
    if (entry.isDirectory()) {
      manifests.push(...await collectManifestFiles(absolute, repoRoot));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.toLowerCase() === 'article.json' && entry.name !== 'article.json') {
      throw new Error(`Article manifest filename must use exact lowercase article.json: ${path.relative(repoRoot, absolute)}`);
    }
    if (entry.name === 'article.json') manifests.push(absolute);
  }
  return manifests;
}

export async function collectArticleManifestPaths(repoRoot = process.cwd()) {
  const root = path.resolve(repoRoot);
  const postsRoot = await requirePostsRoot(root);
  const manifests = await collectManifestFiles(postsRoot, root);
  return manifests.map((absolute) => path.relative(root, absolute).split(path.sep).join('/'));
}

function titleKey(title) {
  return title.trim().normalize('NFC').toLocaleLowerCase('en-US');
}

function rememberUnique(map, value, owner, label) {
  const prior = map.get(value);
  if (prior) throw new Error(`duplicate ${label} ${value}: ${prior} and ${owner}`);
  map.set(value, owner);
}

function normalizeRequested(requested) {
  if (requested == null) return [];
  if (!Array.isArray(requested) || requested.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error('requested Article manifests must be an array of non-empty repository-relative paths');
  }
  return requested.map((item) => item.replaceAll('\\', '/'));
}

export async function validateArticleRepository(
  repoRoot = process.cwd(),
  {
    requested = [],
    compiler = new MarkedCompiler(),
    projectContext = {},
    requireReady = false
  } = {}
) {
  if (typeof requireReady !== 'boolean') throw new Error('requireReady must be boolean');
  const root = path.resolve(repoRoot);
  const manifestPaths = await collectArticleManifestPaths(root);
  const articles = [];

  for (const manifestPath of manifestPaths) {
    const loaded = await loadArticleManifest({
      manifestPath: path.resolve(root, ...manifestPath.split('/')),
      repoRoot: root
    });
    const evaluation = await evaluateArticleBundle({
      bundle: loaded.bundle,
      compiler,
      repoRoot: root,
      projectContext
    });
    articles.push({ ...loaded, evaluation, repositoryPath: manifestPath });
  }

  const articleIds = new Map();
  const variantIds = new Map();
  const slugs = new Map();
  const titles = new Map();
  for (const article of articles) {
    rememberUnique(articleIds, article.bundle.article.articleId, article.repositoryPath, 'articleId');
    for (const variant of article.bundle.article.variants) {
      const owner = `${article.repositoryPath}#${variant.locale}`;
      rememberUnique(variantIds, variant.variantId, owner, 'variantId');
      rememberUnique(slugs, variant.slug, owner, 'slug');
      rememberUnique(titles, titleKey(variant.title), owner, 'title');
    }

    if (requireReady) {
      if (article.evaluation.translation.state !== 'SYNCED') {
        throw new Error(`Article translation is not SYNCED: ${article.repositoryPath} (${article.evaluation.translation.state})`);
      }
      if (article.evaluation.readiness.state !== 'READY') {
        throw new Error(`Article readiness is not READY: ${article.repositoryPath} (${article.evaluation.readiness.state})`);
      }
    }
  }

  const wanted = normalizeRequested(requested);
  if (wanted.length === 0) return articles;
  if (new Set(wanted).size !== wanted.length) throw new Error('requested Article manifests must not contain duplicates');
  const byPath = new Map(articles.map((article) => [article.repositoryPath, article]));
  const missing = wanted.filter((item) => !byPath.has(item));
  if (missing.length > 0) throw new Error(`requested Article manifest not found under posts/: ${missing.join(', ')}`);
  return wanted.map((item) => byPath.get(item));
}
