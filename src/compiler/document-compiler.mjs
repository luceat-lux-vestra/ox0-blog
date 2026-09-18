export function requireLocaleVariant(variant) {
  if (!variant || typeof variant !== 'object') {
    throw new Error('LocaleVariant is required');
  }
  if (typeof variant.locale !== 'string' || variant.locale.trim() === '') {
    throw new Error('LocaleVariant.locale must be a non-empty string');
  }
  if (typeof variant.body !== 'string' || variant.body.trim() === '') {
    throw new Error('LocaleVariant.body must be non-empty Markdown source');
  }
  if (variant.sourcePath != null && (typeof variant.sourcePath !== 'string' || variant.sourcePath.trim() === '')) {
    throw new Error('LocaleVariant.sourcePath must be a non-empty string when provided');
  }
  return variant;
}

export function requireCompiledDocument(document) {
  if (!document || typeof document !== 'object') {
    throw new Error('CompiledDocument is required');
  }
  if (typeof document.htmlFragment !== 'string') {
    throw new Error('CompiledDocument.htmlFragment must be a string');
  }
  if (typeof document.locale !== 'string' || document.locale.trim() === '') {
    throw new Error('CompiledDocument.locale must be a non-empty string');
  }
  if (!Array.isArray(document.referencedAssets)) {
    throw new Error('CompiledDocument.referencedAssets must be an array');
  }
  if (!Array.isArray(document.diagnostics)) {
    throw new Error('CompiledDocument.diagnostics must be an array');
  }
  return document;
}

export function requireDocumentCompiler(compiler) {
  if (!compiler || typeof compiler.compile !== 'function') {
    throw new Error('DocumentCompiler.compile(LocaleVariant, ProjectContext) is required');
  }
  return compiler;
}
