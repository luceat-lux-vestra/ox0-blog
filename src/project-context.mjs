function requireContextObject(value, label) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

export function resolveProjectContext(projectContext, variant) {
  if (projectContext == null) return {};
  if (typeof projectContext === 'function') {
    return requireContextObject(projectContext(variant), 'projectContext factory result');
  }
  return requireContextObject(projectContext, 'projectContext');
}

export function withProjectResourceResolver(resolvedProjectContext, resolveResource) {
  const base = requireContextObject(resolvedProjectContext, 'resolved ProjectContext');
  if (typeof resolveResource !== 'function') {
    throw new Error('resolveResource must be a function');
  }
  return {
    ...base,
    resolveResource
  };
}
