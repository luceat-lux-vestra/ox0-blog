const SHA_RE = /^[a-f0-9]{40}$/;

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

export function requireArticleLiveDraftContext({
  verifyOptIn,
  expectedSourceSha,
  actualHeadSha,
  worktreeStatus,
  ghostAdminUrl,
  expectedGhostUrl,
  hostRuntimeModule = null
}) {
  if (verifyOptIn !== '1') {
    throw new Error('live Article draft verification is mutating; set OX0_ARTICLE_DRAFT_VERIFY=1 to opt in');
  }

  const expectedSha = requireString(expectedSourceSha, 'OX0_ARTICLE_SOURCE_SHA');
  const actualSha = requireString(actualHeadSha, 'current git HEAD');
  if (!SHA_RE.test(expectedSha) || !SHA_RE.test(actualSha)) {
    throw new Error('live Article draft verification requires lowercase 40-hex source SHAs');
  }
  if (expectedSha !== actualSha) {
    throw new Error('OX0_ARTICLE_SOURCE_SHA must equal the exact current git HEAD');
  }

  if (typeof worktreeStatus !== 'string') throw new Error('git worktree status is required');
  if (worktreeStatus !== '') {
    throw new Error('live Article draft verification requires a clean exact-candidate worktree');
  }

  if (hostRuntimeModule != null && String(hostRuntimeModule).trim() !== '') {
    throw new Error('base live Article draft verifier forbids OX0_HOST_RUNTIME_MODULE; verify deployment resource adapters separately');
  }

  const actualBase = normalizeGhostBase(ghostAdminUrl, 'GHOST_ADMIN_URL');
  const expectedBase = normalizeGhostBase(expectedGhostUrl, 'OX0_ARTICLE_EXPECTED_URL');
  if (actualBase !== expectedBase) {
    throw new Error('GHOST_ADMIN_URL must exactly match OX0_ARTICLE_EXPECTED_URL');
  }

  return { sourceSha: actualSha, ghostUrl: actualBase };
}
