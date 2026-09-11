import { normalizeArticle } from './article.mjs';
import { requireCompiledDocument, requireDocumentCompiler } from './compiler/document-compiler.mjs';
import { projectionSourceFingerprintV1 } from './projection-fingerprint.mjs';
import { projectionIdentityTags } from './projection-identity.mjs';

function requirePublicationOptions(publication) {
  if (publication == null) return {};
  if (typeof publication !== 'object' || Array.isArray(publication)) {
    throw new Error('publication options must be an object');
  }
  if (Object.hasOwn(publication, 'status')) {
    throw new Error('publication.status is not source state; draft/publish must be an explicit operation');
  }
  if (publication.tags != null && (!Array.isArray(publication.tags) || publication.tags.some((tag) => typeof tag !== 'string' || tag.trim() === ''))) {
    throw new Error('publication.tags must be an array of non-empty strings');
  }
  return publication;
}

export function localeVariantFor(article, locale) {
  const normalized = normalizeArticle(article);
  if (typeof locale !== 'string' || locale.trim() === '') throw new Error('locale is required');
  const wanted = locale.trim();
  if (!normalized.requiredLocales.includes(wanted)) {
    throw new Error(`locale is not required by Article: ${wanted}`);
  }
  const variant = normalized.variants.find((candidate) => candidate.locale === wanted);
  if (!variant) throw new Error(`required LocaleVariant is missing: ${wanted}`);
  return { article: normalized, variant };
}

export function createLocaleProjectionDescriptor({ article: rawArticle, locale, publication: rawPublication = {} }) {
  const { article, variant } = localeVariantFor(rawArticle, locale);
  const publication = requirePublicationOptions(rawPublication);

  return {
    identityTags: projectionIdentityTags({
      articleId: article.articleId,
      variantId: variant.variantId,
      locale: variant.locale
    }),
    locale: variant.locale,
    title: variant.title,
    slug: variant.slug,
    excerpt: variant.excerpt,
    tags: [...(publication.tags ?? [])],
    featureImage: publication.featureImage ?? null,
    featureImageAlt: publication.featureImageAlt ?? null,
    featured: publication.featured ?? false,
    visibility: publication.visibility ?? 'public',
    canonicalUrl: publication.canonicalUrl ?? null
  };
}

export async function compileLocaleProjection({
  article,
  locale,
  publication = {},
  compiler,
  projectContext = {},
  fingerprintEvidence = {}
}) {
  requireDocumentCompiler(compiler);
  const resolved = localeVariantFor(article, locale);
  const baseProjection = createLocaleProjectionDescriptor({ article: resolved.article, locale, publication });
  const compiledDocument = requireCompiledDocument(await compiler.compile(resolved.variant, projectContext));
  if (compiledDocument.locale !== resolved.variant.locale) {
    throw new Error(`compiler returned locale=${compiledDocument.locale} for LocaleVariant.locale=${resolved.variant.locale}`);
  }
  const sourceFingerprint = projectionSourceFingerprintV1(baseProjection, compiledDocument, fingerprintEvidence);
  const projection = { ...baseProjection, sourceFingerprint };
  return { projection, compiledDocument, variant: resolved.variant, sourceFingerprint };
}
