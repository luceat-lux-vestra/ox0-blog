const MAX_EVIDENCE_LENGTH = 256;
const MAX_REASON_LENGTH = 256;
const REMOTE_KINDS = new Set(['body-image', 'feature-image']);

function requireString(value, name, maxLength) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${name} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function requireHttpsHref(value) {
  const source = requireString(value, 'remote resource href', 2000);
  let parsed;
  try { parsed = new URL(source); } catch {
    throw new Error(`remote resource href must be a valid URL: ${source}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`remote resource href must use https: ${source}`);
  }
  return parsed.href;
}

export function requireRemoteResourcePolicy(policy) {
  if (typeof policy !== 'function') {
    throw new Error('remoteResourcePolicy(resource) must be a function');
  }
  return policy;
}

function normalizeResource(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('remote resource descriptor must be an object');
  }
  if (!REMOTE_KINDS.has(raw.kind)) {
    throw new Error(`unsupported remote resource kind: ${raw.kind ?? '<missing>'}`);
  }
  return {
    kind: raw.kind,
    href: requireHttpsHref(raw.href),
    articleId: requireString(raw.articleId, 'remote resource articleId', 200),
    locale: requireString(raw.locale, 'remote resource locale', 64),
    variantId: requireString(raw.variantId, 'remote resource variantId', 200)
  };
}

function normalizeDecision(raw, resource) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`remoteResourcePolicy must return a decision object for ${resource.href}`);
  }
  const decision = raw.decision;
  if (!['ALLOW', 'DENY'].includes(decision)) {
    throw new Error(`remoteResourcePolicy decision must be ALLOW or DENY for ${resource.href}`);
  }
  if (decision === 'DENY') {
    const reason = raw.reason == null
      ? 'host policy denied remote resource'
      : requireString(raw.reason, 'remote resource denial reason', MAX_REASON_LENGTH);
    return { decision, reason };
  }
  const evidence = requireString(raw.evidence, 'remote resource allow evidence', MAX_EVIDENCE_LENGTH);
  return { decision, evidence };
}

export async function approveRemoteResource(policy, rawResource) {
  const target = requireRemoteResourcePolicy(policy);
  const resource = normalizeResource(rawResource);
  const decision = normalizeDecision(await target({ ...resource }), resource);
  if (decision.decision === 'DENY') {
    throw new Error(`remote resource denied by host policy: ${resource.href} (${decision.reason})`);
  }
  return {
    kind: resource.kind,
    href: resource.href,
    evidence: decision.evidence
  };
}

export async function approveRemoteResources(policy, resources) {
  if (!Array.isArray(resources)) throw new Error('remote resources must be an array');
  const approvals = [];
  for (const resource of resources) {
    approvals.push(await approveRemoteResource(policy, resource));
  }
  approvals.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.href !== b.href) return a.href < b.href ? -1 : 1;
    return a.evidence < b.evidence ? -1 : a.evidence > b.evidence ? 1 : 0;
  });
  return approvals;
}
