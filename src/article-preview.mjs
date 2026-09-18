import path from 'node:path';
import { loadArticleManifest } from './article-manifest.mjs';
import { MarkedCompiler } from './compiler/marked-compiler.mjs';
import { requireCompiledDocument, requireDocumentCompiler } from './compiler/document-compiler.mjs';
import { readRepositoryAssetSnapshot } from './file-confinement.mjs';
import { resolveMaterialImageReference } from './material-asset-evidence.mjs';

export const ARTICLE_PREVIEW_BUNDLE_VERSION = 1;

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeResourceBaseUrl(value) {
  if (value == null || value === '') return null;
  let parsed;
  try {
    parsed = new URL(requireString(value, 'resourceBaseUrl'));
  } catch {
    throw new Error('resourceBaseUrl must be a valid absolute URL');
  }
  if (parsed.protocol !== 'https:') throw new Error('resourceBaseUrl must use https:');
  if (parsed.username || parsed.password) throw new Error('resourceBaseUrl must not contain credentials');
  if (parsed.search || parsed.hash) throw new Error('resourceBaseUrl must not contain query or fragment');
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
  return parsed;
}

function repositoryPath(repoRoot, absolutePath, name) {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(absolutePath));
  if (
    relative === ''
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error(`${name} must resolve inside repository root`);
  }
  return relative.split(path.sep).join('/');
}

function encodedRepositoryUrl(baseUrl, repositoryRef) {
  const encoded = repositoryRef.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return new URL(encoded, baseUrl).href;
}

function previewProjectContext({ repoRoot, resourceBaseUrl, materialAssets }) {
  return {
    async resolveResource(resource, context) {
      if (resource?.kind !== 'image') return null;
      const resolved = resolveMaterialImageReference({
        variant: context.variant,
        href: resource.href,
        repoRoot
      });
      if (resolved.kind === 'remote') return null;
      if (!resourceBaseUrl) {
        throw new Error(
          `preview resourceBaseUrl is required for local material asset: ${resolved.ref}`
        );
      }
      const snapshot = await readRepositoryAssetSnapshot(
        resolved.absolutePath,
        repoRoot,
        'Article preview material asset'
      );
      materialAssets.set(resolved.ref, snapshot.fingerprint);
      return { href: encodedRepositoryUrl(resourceBaseUrl, resolved.ref) };
    }
  };
}

function normalizeManifestPaths(manifestPaths) {
  if (!Array.isArray(manifestPaths) || manifestPaths.length === 0) {
    throw new Error('at least one Article manifest path is required');
  }
  return manifestPaths.map((value, index) => requireString(value, `manifestPaths[${index}]`));
}

export async function buildArticlePreviewBundle({
  repoRoot,
  manifestPaths,
  resourceBaseUrl = null,
  sourceRevision = null,
  compiler = new MarkedCompiler()
}) {
  const root = path.resolve(requireString(repoRoot, 'repoRoot'));
  const manifests = normalizeManifestPaths(manifestPaths);
  const resourceBase = normalizeResourceBaseUrl(resourceBaseUrl);
  requireDocumentCompiler(compiler);

  const articles = [];
  const seenArticleIds = new Set();

  for (const manifestPath of manifests) {
    const loaded = await loadArticleManifest({
      manifestPath: path.resolve(root, manifestPath),
      repoRoot: root
    });
    const articleId = loaded.bundle.article.articleId;
    if (seenArticleIds.has(articleId)) {
      throw new Error(`duplicate Article preview articleId: ${articleId}`);
    }
    seenArticleIds.add(articleId);

    const materialAssets = new Map();
    const variants = [];
    for (const variant of loaded.bundle.article.variants) {
      const compiled = requireCompiledDocument(await compiler.compile(
        variant,
        previewProjectContext({ repoRoot: root, resourceBaseUrl: resourceBase, materialAssets })
      ));
      if (compiled.locale !== variant.locale) {
        throw new Error(
          `CompiledDocument.locale=${compiled.locale} does not match LocaleVariant.locale=${variant.locale}`
        );
      }
      variants.push({
        variantId: variant.variantId,
        locale: variant.locale,
        title: variant.title,
        excerpt: variant.excerpt,
        htmlFragment: compiled.htmlFragment,
        diagnostics: compiled.diagnostics
      });
    }

    articles.push({
      articleId,
      manifest: repositoryPath(root, loaded.manifestPath, 'Article preview manifest'),
      variants,
      materialAssets: [...materialAssets.entries()]
        .map(([ref, fingerprint]) => ({ ref, fingerprint }))
        .sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)
    });
  }

  return {
    version: ARTICLE_PREVIEW_BUNDLE_VERSION,
    sourceRevision: sourceRevision == null ? null : requireString(sourceRevision, 'sourceRevision'),
    resourceCspSource: resourceBase?.href ?? null,
    articles
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function diagnosticList(diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return '';
  const items = diagnostics.map((entry) => `<li><code>${escapeHtml(JSON.stringify(entry))}</code></li>`).join('');
  return `<aside class="diagnostics"><strong>Compiler diagnostics</strong><ul>${items}</ul></aside>`;
}

export function renderArticlePreviewHtml(bundle) {
  if (!bundle || bundle.version !== ARTICLE_PREVIEW_BUNDLE_VERSION || !Array.isArray(bundle.articles)) {
    throw new Error('valid ArticlePreviewBundle v1 is required');
  }

  const toc = [];
  const bodies = [];
  bundle.articles.forEach((article, articleIndex) => {
    const articleAnchor = `article-${articleIndex + 1}`;
    const displayTitle = article.variants[0]?.title ?? article.articleId;
    toc.push(
      `<li><a href="#${articleAnchor}">${escapeHtml(displayTitle)}</a> <small>${escapeHtml(article.articleId)}</small></li>`
    );

    const localeNav = article.variants.map((variant, variantIndex) => {
      const anchor = `${articleAnchor}-locale-${variantIndex + 1}`;
      return `<a href="#${anchor}">${escapeHtml(variant.locale)}</a>`;
    }).join(' · ');

    const variants = article.variants.map((variant, variantIndex) => {
      const anchor = `${articleAnchor}-locale-${variantIndex + 1}`;
      return `
<section class="variant" id="${anchor}" lang="${escapeHtml(variant.locale)}">
  <header class="variant-header">
    <div>
      <p class="eyebrow">${escapeHtml(variant.locale)}</p>
      <h2>${escapeHtml(variant.title)}</h2>
      ${variant.excerpt ? `<p class="excerpt">${escapeHtml(variant.excerpt)}</p>` : ''}
    </div>
    <a class="top-link" href="#top">Top</a>
  </header>
  ${diagnosticList(variant.diagnostics)}
  <div class="article-body">${variant.htmlFragment}</div>
</section>`;
    }).join('\n');

    bodies.push(`
<section class="article" id="${articleAnchor}">
  <header class="article-header">
    <p class="eyebrow">Article</p>
    <h1>${escapeHtml(displayTitle)}</h1>
    <p><code>${escapeHtml(article.manifest)}</code></p>
    <nav class="locale-nav" aria-label="Locale previews">${localeNav}</nav>
  </header>
  ${variants}
</section>`);
  });

  const revision = bundle.sourceRevision
    ? `<p>Exact source: <code>${escapeHtml(bundle.sourceRevision)}</code></p>`
    : '';
  const imageSource = bundle.resourceCspSource
    ? ` ${escapeHtml(bundle.resourceCspSource)}`
    : " 'none'";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src${imageSource}; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>ox0-blog PR Article Preview</title>
<style>
:root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; }
body { margin: 0; background: Canvas; color: CanvasText; }
main { width: min(920px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 96px; }
.preview-header, .article-header, .variant { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 14px; padding: 24px; margin: 0 0 28px; }
.preview-header { background: color-mix(in srgb, CanvasText 4%, Canvas); }
.preview-header h1, .article-header h1, .variant h2 { line-height: 1.25; margin-top: 0; }
.preview-header ul { margin-bottom: 0; }
.article { margin-top: 56px; }
.article-header { border-style: dashed; }
.variant { overflow-wrap: anywhere; }
.variant-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 1px solid color-mix(in srgb, CanvasText 14%, transparent); margin-bottom: 24px; padding-bottom: 18px; }
.eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: .76rem; opacity: .65; margin: 0 0 8px; }
.excerpt { opacity: .75; }
.locale-nav { margin-top: 12px; }
.top-link { white-space: nowrap; }
.article-body { font-family: Georgia, "Times New Roman", serif; font-size: 1.05rem; }
.article-body pre, .article-body code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.article-body pre { overflow-x: auto; padding: 16px; border-radius: 10px; background: color-mix(in srgb, CanvasText 7%, Canvas); }
.article-body code { font-size: .9em; }
.article-body img { display: block; max-width: 100%; height: auto; margin: 24px auto; }
.article-body table { display: block; overflow-x: auto; border-collapse: collapse; }
.article-body th, .article-body td { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); padding: 8px 10px; }
.article-body blockquote { margin-left: 0; padding-left: 18px; border-left: 4px solid color-mix(in srgb, CanvasText 25%, transparent); opacity: .88; }
.diagnostics { border: 1px solid #b86b00; border-radius: 10px; padding: 12px 16px; margin-bottom: 20px; }
small, code { overflow-wrap: anywhere; }
a { color: LinkText; }
</style>
</head>
<body id="top">
<main>
<header class="preview-header">
  <p class="eyebrow">Generated review artifact · no Ghost mutation</p>
  <h1>PR Article Preview</h1>
  ${revision}
  <p>This file is derived from the pull request's exact Article source through the repository compiler boundary.</p>
  <ul>${toc.join('')}</ul>
</header>
${bodies.join('\n')}
</main>
</body>
</html>
`;
}
