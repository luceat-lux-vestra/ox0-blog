import { marked } from 'marked';
import { requireCompiledDocument, requireLocaleVariant } from './document-compiler.mjs';

marked.use({
  gfm: true,
  breaks: false
});

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const IMAGE_PROTOCOLS = new Set(['https:']);

function isPromiseLike(value) {
  return value != null && typeof value.then === 'function';
}

function decodeSchemeRelevantEntities(value) {
  return value
    .replace(/&#([0-9]{1,7});?/gi, (match, decimal) => {
      const codePoint = Number.parseInt(decimal, 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      try { return String.fromCodePoint(codePoint); } catch { return match; }
    })
    .replace(/&#x([0-9a-f]{1,6});?/gi, (match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      try { return String.fromCodePoint(codePoint); } catch { return match; }
    })
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n');
}

function requireSafeHref(rawHref, kind) {
  if (typeof rawHref !== 'string' || rawHref.trim() === '') {
    throw new Error(`Markdown ${kind} href must be a non-empty string`);
  }
  const value = decodeSchemeRelevantEntities(rawHref).trim();
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Markdown ${kind} href must not contain control characters`);
  }
  if (value.startsWith('//')) {
    throw new Error(`protocol-relative Markdown ${kind} hrefs are not allowed: ${rawHref}`);
  }

  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value)?.[1]?.toLowerCase();
  if (!scheme) return rawHref;

  const protocol = `${scheme}:`;
  const allowed = kind === 'image' ? IMAGE_PROTOCOLS : LINK_PROTOCOLS;
  if (!allowed.has(protocol)) {
    throw new Error(`unsafe Markdown ${kind} URL protocol ${protocol}`);
  }
  try { new URL(value); } catch {
    throw new Error(`Markdown ${kind} URL is invalid: ${rawHref}`);
  }
  return rawHref;
}

function requireResolvedHref(result, originalHref) {
  if (result == null) return originalHref;
  if (typeof result !== 'object' || typeof result.href !== 'string' || result.href.trim() === '') {
    throw new Error('resource resolver must return null/undefined or an object with a non-empty href');
  }
  requireSafeHref(result.href, 'image');
  return result.href;
}

export class MarkedCompiler {
  async compile(variant, projectContext = {}) {
    requireLocaleVariant(variant);
    const resolveResource = projectContext.resolveResource;
    if (resolveResource != null && typeof resolveResource !== 'function') {
      throw new Error('ProjectContext.resolveResource must be a function when provided');
    }

    const tokens = marked.lexer(variant.body);
    const referencedAssets = [];
    const pending = marked.walkTokens(tokens, (token) => {
      if (token.type === 'html') {
        throw new Error('raw HTML is not supported in canonical Markdown');
      }
      if (token.type === 'link') {
        requireSafeHref(token.href, 'link');
        return undefined;
      }
      if (token.type !== 'image') return undefined;

      requireSafeHref(token.href, 'image');
      const observation = {
        kind: 'image',
        href: token.href,
        alt: token.text ?? '',
        title: token.title ?? null,
        resolvedHref: null
      };
      referencedAssets.push(observation);
      if (!resolveResource) return undefined;

      const result = resolveResource(
        { kind: 'image', href: token.href, alt: observation.alt, title: observation.title },
        { variant, projectContext }
      );
      const apply = (resolved) => {
        const href = requireResolvedHref(resolved, token.href);
        token.href = href;
        observation.resolvedHref = href;
      };
      if (isPromiseLike(result)) return Promise.resolve(result).then(apply);
      apply(result);
      return undefined;
    }).filter(isPromiseLike);

    if (pending.length > 0) await Promise.all(pending);

    return requireCompiledDocument({
      htmlFragment: marked.parser(tokens),
      locale: variant.locale,
      referencedAssets,
      diagnostics: []
    });
  }
}
