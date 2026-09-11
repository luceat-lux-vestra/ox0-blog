import { marked } from 'marked';
import { requireCompiledDocument, requireLocaleVariant } from './document-compiler.mjs';

marked.use({
  gfm: true,
  breaks: false
});

function isPromiseLike(value) {
  return value != null && typeof value.then === 'function';
}

function requireResolvedHref(result, originalHref) {
  if (result == null) return originalHref;
  if (typeof result !== 'object' || typeof result.href !== 'string' || result.href.trim() === '') {
    throw new Error('resource resolver must return null/undefined or an object with a non-empty href');
  }
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
      if (token.type !== 'image') return undefined;

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
