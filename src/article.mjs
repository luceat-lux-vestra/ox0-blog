function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, name) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${name} must be a string or null`);
  return value.trim() || null;
}

function requireLocales(requiredLocales) {
  if (!Array.isArray(requiredLocales) || requiredLocales.length === 0) {
    throw new Error('Article.requiredLocales must be a non-empty array');
  }
  const locales = requiredLocales.map((locale) => requireString(locale, 'required locale'));
  if (new Set(locales).size !== locales.length) {
    throw new Error('Article.requiredLocales must not contain duplicates');
  }
  return locales;
}

export function normalizeLocaleVariant(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('LocaleVariant is required');
  return {
    variantId: requireString(raw.variantId, 'LocaleVariant.variantId'),
    locale: requireString(raw.locale, 'LocaleVariant.locale'),
    title: requireString(raw.title, 'LocaleVariant.title'),
    excerpt: optionalString(raw.excerpt, 'LocaleVariant.excerpt'),
    slug: requireString(raw.slug, 'LocaleVariant.slug'),
    body: requireString(raw.body, 'LocaleVariant.body'),
    sourcePath: raw.sourcePath == null ? null : requireString(raw.sourcePath, 'LocaleVariant.sourcePath')
  };
}

export function normalizeArticle(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Article is required');
  const articleId = requireString(raw.articleId, 'Article.articleId');
  const requiredLocales = requireLocales(raw.requiredLocales);
  if (!Array.isArray(raw.variants)) throw new Error('Article.variants must be an array');

  const variants = raw.variants.map(normalizeLocaleVariant);
  const ids = new Set();
  const locales = new Set();
  for (const variant of variants) {
    if (ids.has(variant.variantId)) {
      throw new Error(`duplicate LocaleVariant.variantId: ${variant.variantId}`);
    }
    if (locales.has(variant.locale)) {
      throw new Error(`duplicate LocaleVariant.locale: ${variant.locale}`);
    }
    ids.add(variant.variantId);
    locales.add(variant.locale);
  }

  const required = new Set(requiredLocales);
  for (const locale of locales) {
    if (!required.has(locale)) {
      throw new Error(`LocaleVariant locale is not configured in Article.requiredLocales: ${locale}`);
    }
  }

  return { articleId, requiredLocales, variants };
}

export function variantsByLocale(article) {
  const normalized = normalizeArticle(article);
  return new Map(normalized.variants.map((variant) => [variant.locale, variant]));
}

export function missingRequiredLocales(article) {
  const normalized = normalizeArticle(article);
  const present = new Set(normalized.variants.map((variant) => variant.locale));
  return normalized.requiredLocales.filter((locale) => !present.has(locale));
}
