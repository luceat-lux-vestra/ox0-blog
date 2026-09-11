import { normalizeArticle } from './article.mjs';
import { requireCompiledDocument, requireDocumentCompiler } from './compiler/document-compiler.mjs';
import { projectionSourceFingerprintV1 } from './projection-fingerprint.mjs';
import { projectionIdentityTags } from './projection-identity.mjs';
import { normalizeProjectionMetadata } from './projection-metadata.mjs';

function requirePublicationOptions(publication) {
  if (publication == null) return {};
  if (typeof publication !== 'object' || Array.isArray(publication)) {
    throw new Error('publication options must be an object');
  }
  if (Object.hasOwn(publication, 'status')) {
    throw new Error('publication.status is not source state; draft/publish must be an explicit operation');
  }
  return publication;
}

function localFeatureImageFingerprint(projection, fingerprintEvidence) {
  if (!projection.featureImage || /^https:\/\//.test(projection.featureImage)) return null;
  return fingerprintEvidence.featureImageFingerprint ?? null;
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
  const metadata = normalizeProjectionMetadata({
    title: variant.title,
    slug: variant.slug,
    excerpt: variant.excerpt,
    tags: publication.tags,
    featureImage: publication.featureImage,
    featureImageAlt: publication.featureImageAlt,
    featured: publication.featured,
    visibility: publication.visibility,
    canonicalUrl: publication.canonicalUrl
  });

  return {
    identityTags: projectionIdentityTags({
      articleId: article.articleId,
      variantId: variant.variantId,
      locale: variant.locale
    }),
    locale: variant.locale,
    ...metadata
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
  const featureImageFingerprint = localFeatureImageFingerprint(baseProjection, fingerprintEvidence);
  const projection = {
    ...baseProjection,
    sourceFingerprint,
    ...(featureImageFingerprint ? { featureImageFingerprint } : {})
  };
  return { projection, compiledDocument, variant: resolved.variant, sourceFingerprint };
}
