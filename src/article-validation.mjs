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
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const manifests = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`symlinks are not allowed under posts/: ${path.relative(repoRoot, absolute)}`);
    }
    if (entry.name.toLowerCase() === 'article.json') {
      if (entry.name !== 'article.json') {
        throw new Error(`Article manifest filename must use exact lowercase article.json: ${path.relative(repoRoot, absolute)}`);
      }
      if (!entry.isFile()) {
        throw new Error(`Article manifest must be a regular file: ${path.relative(repoRoot, absolute)}`);
      }
      manifests.push(absolute);
      continue;
    }
    if (entry.isDirectory()) {
      manifests.push(...await collectManifestFiles(absolute, repoRoot));
    }
  }
  return manifests;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function assertNonOverlappingArticleDirectories(manifests, repoRoot) {
  const directories = manifests.map((manifest) => path.dirname(manifest));
  for (let outer = 0; outer < directories.length; outer += 1) {
    for (let inner = outer + 1; inner < directories.length; inner += 1) {
      const left = directories[outer];
      const right = directories[inner];
      if (isInside(left, right) || isInside(right, left)) {
        throw new Error(
          `nested Article bundles are not allowed: ${path.relative(repoRoot, left)} and ${path.relative(repoRoot, right)}`
        );
      }
    }
  }
}

async function collectArticleMarkdownFiles(dir, repoRoot) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`symlinks are not allowed under posts/: ${path.relative(repoRoot, absolute)}`);
    }
    if (entry.isDirectory()) {
      files.push(...await collectArticleMarkdownFiles(absolute, repoRoot));
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    if (!entry.name.endsWith('.md')) {
      throw new Error(`Article Markdown source extension must be lowercase .md: ${path.relative(repoRoot, absolute)}`);
    }
    files.push(path.resolve(absolute));
  }
  return files;
}

async function assertArticleMarkdownOwnership(article, repoRoot) {
  const markdownFiles = await collectArticleMarkdownFiles(article.articleDir, repoRoot);
  const claimed = new Set(
    article.bundle.article.variants.map((variant) => path.resolve(variant.sourcePath))
  );
  for (const file of markdownFiles) {
    if (!claimed.has(file)) {
      throw new Error(`Article bundle contains unclaimed Markdown source: ${path.relative(repoRoot, file)}`);
    }
  }
}

export async function collectArticleManifestPaths(repoRoot = process.cwd()) {
  const root = path.resolve(repoRoot);
  const postsRoot = await requirePostsRoot(root);
  const manifests = await collectManifestFiles(postsRoot, root);
  assertNonOverlappingArticleDirectories(manifests, root);
  return manifests.map((absolute) => path.relative(root, absolute).split(path.sep).join('/'));
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
    await assertArticleMarkdownOwnership(loaded, root);
    const evaluation = await evaluateArticleBundle({
      bundle: loaded.bundle,
      compiler,
      repoRoot: root,
      projectContext,
      publicationByLocale: loaded.publicationByLocale,
      claimProof: loaded.claimProof
    });
    articles.push({ ...loaded, evaluation, repositoryPath: manifestPath });
  }

  const articleIds = new Map();
  const variantIds = new Map();
  const slugs = new Map();
  for (const article of articles) {
    rememberUnique(articleIds, article.bundle.article.articleId, article.repositoryPath, 'articleId');
    for (const variant of article.bundle.article.variants) {
      const owner = `${article.repositoryPath}#${variant.locale}`;
      rememberUnique(variantIds, variant.variantId, owner, 'variantId');
      rememberUnique(slugs, variant.slug, owner, 'slug');
    }

    if (requireReady) {
      if (article.evaluation.translation.state !== 'SYNCED') {
        throw new Error(`Article translation is not SYNCED: ${article.repositoryPath} (${article.evaluation.translation.state})`);
      }
      if (article.evaluation.readiness.state !== 'READY') {
        const reason = article.evaluation.readiness.reason
          ? `:${article.evaluation.readiness.reason}`
          : '';
        throw new Error(
          `Article readiness is not READY: ${article.repositoryPath} (${article.evaluation.readiness.state}${reason})`
        );
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
