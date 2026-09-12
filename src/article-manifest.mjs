import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { ARTICLE_BUNDLE_CONTRACT_VERSION, normalizeArticleBundle } from './article-bundle.mjs';
import { requireConfinedRegularFile, requireRepositoryAssetFile } from './file-confinement.mjs';
import { normalizeProjectionMetadata } from './projection-metadata.mjs';
import { parseStrictJson } from './strict-json.mjs';

export const ARTICLE_MANIFEST_VERSION = 1;

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function requireExactKeys(value, name, requiredKeys) {
  const object = requireObject(value, name);
  const required = new Set(requiredKeys);
  for (const key of Object.keys(object)) {
    if (!required.has(key)) throw new Error(`${name} contains unsupported field: ${key}`);
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(object, key)) throw new Error(`${name} is missing required field: ${key}`);
  }
  return object;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function requirePortableRelativePath(value, name) {
  const ref = requireString(value, name);
  if (ref !== value) throw new Error(`${name} must not contain surrounding whitespace`);
  if (ref.includes('\\') || ref.includes('\0') || ref.includes(':')) {
    throw new Error(`${name} must use portable forward-slash path syntax`);
  }
  if (path.posix.isAbsolute(ref)) throw new Error(`${name} must be repository/article relative`);
  const normalized = path.posix.normalize(ref);
  if (normalized !== ref || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${name} must be a normalized relative path without traversal`);
  }
  return ref;
}

function resolvePortablePath(root, ref) {
  return path.resolve(root, ...ref.split('/'));
}

async function readConfinedUtf8(filePath, rootPath, name) {
  const confined = await requireConfinedRegularFile(filePath, rootPath, name);
  const bytes = await readFile(confined.realPath);
  if (bytes.length !== confined.size) throw new Error(`${name} changed while reading: ${confined.absolutePath}`);
  try {
    return { ...confined, text: UTF8_DECODER.decode(bytes) };
  } catch {
    throw new Error(`${name} must be valid UTF-8: ${confined.absolutePath}`);
  }
}

function assertTranslationCheckpointShape(checkpoint) {
  if (checkpoint == null) return;
  const value = requireObject(checkpoint, 'translationCheckpoint');
  if (value.version !== 1) return;
  requireExactKeys(value, 'translationCheckpoint', ['version', 'fingerprintVersion', 'accepted', 'review']);
  requireObject(value.accepted, 'translationCheckpoint.accepted');
  requireExactKeys(value.review, 'translationCheckpoint.review', ['kind', 'contractVersion']);
}

function assertReadinessCheckpointShape(checkpoint) {
  if (checkpoint == null) return;
  const value = requireObject(checkpoint, 'readiness.checkpoint');
  if (value.version !== 1) return;
  requireExactKeys(value, 'readiness.checkpoint', [
    'version',
    'sourceFingerprintVersion',
    'sourceFingerprint',
    'priorReviewedEpoch',
    'reviewedEpoch',
    'resolvedInvalidationIds',
    'review'
  ]);
  requireExactKeys(value.review, 'readiness.checkpoint.review', ['kind', 'contractVersion']);
}

function assertReadinessInvalidationShape(invalidation, index) {
  const name = `readiness.invalidations[${index}]`;
  const value = requireObject(invalidation, name);
  if (value.version !== 1) return;
  requireExactKeys(value, name, ['version', 'id', 'epoch', 'reason', 'origin', 'reference']);
}

async function normalizePublication(raw, variant, repoRoot, locale) {
  const name = `variants[${locale}].publication`;
  const value = requireExactKeys(raw, name, [
    'tags',
    'featureImage',
    'featureImageAlt',
    'featured',
    'visibility',
    'canonicalUrl'
  ]);

  let featureImage = value.featureImage;
  if (featureImage != null && typeof featureImage === 'string' && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(featureImage)) {
    const ref = requirePortableRelativePath(featureImage, `${name}.featureImage`);
    if (!ref.startsWith('assets/')) {
      throw new Error(`${name}.featureImage local path must be repository-relative under assets/`);
    }
    const confined = await requireRepositoryAssetFile(
      resolvePortablePath(repoRoot, ref),
      repoRoot,
      `${name}.featureImage`
    );
    featureImage = confined.absolutePath;
  }

  const normalized = normalizeProjectionMetadata({
    title: variant.title,
    slug: variant.slug,
    excerpt: variant.excerpt,
    tags: value.tags,
    featureImage,
    featureImageAlt: value.featureImageAlt,
    featured: value.featured,
    visibility: value.visibility,
    canonicalUrl: value.canonicalUrl
  });
  return {
    tags: normalized.tags,
    featureImage: normalized.featureImage,
    featureImageAlt: normalized.featureImageAlt,
    featured: normalized.featured,
    visibility: normalized.visibility,
    canonicalUrl: normalized.canonicalUrl
  };
}

export async function loadArticleManifest({ manifestPath, repoRoot }) {
  const root = path.resolve(requireString(repoRoot, 'repoRoot'));
  const postsRoot = path.resolve(root, 'posts');
  const manifest = await readConfinedUtf8(manifestPath, postsRoot, 'Article manifest');
  if (path.basename(manifest.absolutePath) !== 'article.json') {
    throw new Error('Article manifest filename must be article.json');
  }

  let raw;
  try {
    raw = parseStrictJson(manifest.text);
  } catch (error) {
    throw new Error(`failed to parse Article manifest ${manifest.absolutePath}: ${error.message}`);
  }
  requireObject(raw, 'Article manifest');
  if (raw.version !== ARTICLE_MANIFEST_VERSION) {
    throw new Error(`unsupported Article manifest version: ${raw.version}`);
  }
  requireExactKeys(raw, 'Article manifest', [
    'version',
    'articleId',
    'requiredLocales',
    'variants',
    'translationCheckpoint',
    'readiness'
  ]);
  if (!Array.isArray(raw.variants)) throw new Error('Article manifest variants must be an array');

  const articleDir = path.dirname(manifest.absolutePath);
  const sourceRefs = new Set();
  const variants = [];
  const publicationByLocale = new Map();

  for (let index = 0; index < raw.variants.length; index += 1) {
    const name = `Article manifest variants[${index}]`;
    const descriptor = requireExactKeys(raw.variants[index], name, [
      'variantId',
      'locale',
      'source',
      'title',
      'excerpt',
      'slug',
      'publication'
    ]);
    const locale = requireString(descriptor.locale, `${name}.locale`);
    const sourceRef = requirePortableRelativePath(descriptor.source, `${name}.source`);
    if (path.posix.extname(sourceRef) !== '.md') {
      throw new Error(`${name}.source must use lowercase .md extension`);
    }
    if (sourceRefs.has(sourceRef)) throw new Error(`duplicate Article variant source: ${sourceRef}`);
    sourceRefs.add(sourceRef);

    const source = await readConfinedUtf8(
      resolvePortablePath(articleDir, sourceRef),
      articleDir,
      `${name}.source`
    );
    const variant = {
      variantId: descriptor.variantId,
      locale,
      title: descriptor.title,
      excerpt: descriptor.excerpt,
      slug: descriptor.slug,
      body: source.text,
      sourcePath: source.absolutePath
    };
    variants.push(variant);
    publicationByLocale.set(locale, await normalizePublication(descriptor.publication, variant, root, locale));
  }

  assertTranslationCheckpointShape(raw.translationCheckpoint);
  const readiness = requireExactKeys(raw.readiness, 'Article manifest readiness', [
    'epoch',
    'checkpoint',
    'invalidations'
  ]);
  assertReadinessCheckpointShape(readiness.checkpoint);
  if (!Array.isArray(readiness.invalidations)) {
    throw new Error('Article manifest readiness.invalidations must be an array');
  }
  readiness.invalidations.forEach(assertReadinessInvalidationShape);

  const bundle = normalizeArticleBundle({
    version: ARTICLE_BUNDLE_CONTRACT_VERSION,
    article: {
      articleId: raw.articleId,
      requiredLocales: raw.requiredLocales,
      variants
    },
    translationCheckpoint: raw.translationCheckpoint,
    readinessEpoch: readiness.epoch,
    readinessCheckpoint: readiness.checkpoint,
    readinessInvalidations: readiness.invalidations
  });

  return {
    manifestPath: manifest.absolutePath,
    articleDir,
    bundle,
    publicationByLocale
  };
}
