const SHA_RE = /^[a-f0-9]{40}$/;
const PRODUCTION_HOST = 'blog.ox0.uk';

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

function normalizeGhostBase(value, name) {
  const raw = requireString(value, name);
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`${name} must be a valid absolute URL`); }
  if (parsed.protocol !== 'https:') throw new Error(`${name} must use https`);
  if (parsed.username || parsed.password) throw new Error(`${name} must not contain URL credentials`);
  if (parsed.search || parsed.hash) throw new Error(`${name} must not contain query or fragment`);
  return parsed.toString().replace(/\/$/, '');
}

function canonicalHostname(value) {
  return new URL(value).hostname.toLowerCase().replace(/\.$/, '');
}

export function requireArticleStagingLiveContext({
  verifyOptIn,
  promoteOptIn,
  expectedSourceSha,
  actualHeadSha,
  worktreeStatus,
  ghostAdminUrl,
  expectedStagingUrl,
  hostRuntimeModule = null
}) {
  if (verifyOptIn !== '1') {
    throw new Error('staging Article verification is mutating; set OX0_ARTICLE_STAGING_VERIFY=1 to opt in');
  }
  if (promoteOptIn !== '1') {
    throw new Error('staging Article verification publishes temporary staging posts; set OX0_ARTICLE_STAGING_PROMOTE=1 to opt in');
  }

  const expectedSha = requireString(expectedSourceSha, 'OX0_ARTICLE_STAGING_SOURCE_SHA');
  const actualSha = requireString(actualHeadSha, 'current git HEAD');
  if (!SHA_RE.test(expectedSha) || !SHA_RE.test(actualSha)) {
    throw new Error('staging Article verification requires lowercase 40-hex source SHAs');
  }
  if (expectedSha !== actualSha) {
    throw new Error('OX0_ARTICLE_STAGING_SOURCE_SHA must equal the exact current git HEAD');
  }

  if (typeof worktreeStatus !== 'string') throw new Error('git worktree status is required');
  if (worktreeStatus !== '') {
    throw new Error('staging Article verification requires a clean exact-candidate worktree');
  }

  if (hostRuntimeModule != null && String(hostRuntimeModule).trim() !== '') {
    throw new Error('base staging Article verifier forbids OX0_HOST_RUNTIME_MODULE; verify deployment resource adapters separately');
  }

  const actualBase = normalizeGhostBase(ghostAdminUrl, 'GHOST_ADMIN_URL');
  const expectedBase = normalizeGhostBase(expectedStagingUrl, 'OX0_ARTICLE_STAGING_EXPECTED_URL');
  if (actualBase !== expectedBase) {
    throw new Error('GHOST_ADMIN_URL must exactly match OX0_ARTICLE_STAGING_EXPECTED_URL');
  }
  if (canonicalHostname(actualBase) === PRODUCTION_HOST) {
    throw new Error(`staging Article verifier refuses production Ghost host: ${PRODUCTION_HOST}`);
  }

  return { sourceSha: actualSha, stagingUrl: actualBase };
}
