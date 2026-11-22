import { Marked } from 'marked';

const ARTICLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RELATED_HEADING = 'Related Articles';

function articleVariants(articles) {
  return articles.flatMap((article) =>
    article.bundle.article.variants.map((variant) => ({
      article,
      variant
    }))
  );
}

export function collectMarkdownLinks(source) {
  const marked = new Marked({ gfm: true, breaks: false });
  const tokens = marked.lexer(String(source));
  const links = [];
  marked.walkTokens(tokens, (token) => {
    if (token.type === 'link') {
      links.push({
        href: String(token.href),
        text: String(token.text ?? '')
      });
    }
  });
  return links;
}

export function managedArticleRoute(href) {
  if (typeof href !== 'string') return null;
  const value = href.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return null;

  const path = value.split(/[?#]/, 1)[0];
  if (path === '/') return null;

  const match = path.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/?)$/);
  if (!match) return null;
  return {
    slug: match[1],
    canonical: match[2] === '/',
    href: value
  };
}

export function relatedArticlesSection(source) {
  const lines = String(source).replace(/\r\n/g, '\n').split('\n');
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === `## ${RELATED_HEADING}`) starts.push(index);
  }
  if (starts.length === 0) return null;
  if (starts.length > 1) throw new Error(`duplicate ## ${RELATED_HEADING} section`);

  const start = starts[0] + 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (/^#{1,2}\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function relatedArticleEntries(source) {
  const section = relatedArticlesSection(source);
  if (section == null) return [];

  const entries = [];
  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    const bullet = line.match(/^-\s+(.+)$/);
    if (!bullet) {
      throw new Error(`## ${RELATED_HEADING} must contain only Markdown bullet links`);
    }
    const links = collectMarkdownLinks(bullet[1]);
    if (links.length !== 1) {
      throw new Error(`## ${RELATED_HEADING} entries must contain exactly one Markdown link`);
    }
    entries.push(links[0]);
  }
  return entries;
}

function ownerLabel(article, variant) {
  return `${article.repositoryPath}#${variant.locale}`;
}

function validateManagedRoute({ route, sourceArticle, sourceVariant, bySlug, relationship }) {
  const source = ownerLabel(sourceArticle, sourceVariant);
  if (!route.canonical) {
    throw new Error(
      `${source}: managed Article link must use canonical trailing-slash route: /${route.slug}/`
    );
  }

  const target = bySlug.get(route.slug);
  if (!target) {
    throw new Error(`${source}: broken managed Article link: /${route.slug}/`);
  }
  if (target.variant.locale !== sourceVariant.locale) {
    throw new Error(
      `${source}: managed Article link locale mismatch: /${route.slug}/ targets ${target.variant.locale}`
    );
  }
  if (relationship === 'related' && target.variant.variantId === sourceVariant.variantId) {
    throw new Error(`${source}: Related Articles must not link to the current variant`);
  }
}

export function validateArticleLinks(articles) {
  if (!Array.isArray(articles)) throw new Error('articles must be an array');

  const bySlug = new Map();
  for (const { article, variant } of articleVariants(articles)) {
    if (bySlug.has(variant.slug)) {
      throw new Error(`duplicate slug while validating Article links: ${variant.slug}`);
    }
    bySlug.set(variant.slug, { article, variant });
  }

  for (const { article, variant } of articleVariants(articles)) {
    for (const link of collectMarkdownLinks(variant.body)) {
      const route = managedArticleRoute(link.href);
      if (!route) continue;
      validateManagedRoute({
        route,
        sourceArticle: article,
        sourceVariant: variant,
        bySlug,
        relationship: 'contextual'
      });
    }

    let related;
    try {
      related = relatedArticleEntries(variant.body);
    } catch (error) {
      throw new Error(`${ownerLabel(article, variant)}: ${error.message}`);
    }
    for (const link of related) {
      const route = managedArticleRoute(link.href);
      if (!route) {
        throw new Error(
          `${ownerLabel(article, variant)}: ## ${RELATED_HEADING} entries must use managed Article routes`
        );
      }
      validateManagedRoute({
        route,
        sourceArticle: article,
        sourceVariant: variant,
        bySlug,
        relationship: 'related'
      });
    }
  }

  return articles;
}
