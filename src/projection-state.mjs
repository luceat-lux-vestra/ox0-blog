import { assertProjectionManagedAndUnchanged } from './projection-managed-state.mjs';

function validFingerprint(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function reconciliation(reason, diagnostic = null) {
  return {
    state: 'RECONCILIATION_REQUIRED',
    reason,
    ...(diagnostic ? { diagnostic } : {})
  };
}

export function deriveProjectionState({
  observedPost = null,
  expectedIdentityTags,
  hadManagedMapping = false,
  currentSourceFingerprint = null,
  projectedSourceFingerprint = null
}) {
  if (typeof hadManagedMapping !== 'boolean') {
    throw new Error('hadManagedMapping must be boolean');
  }

  if (observedPost == null) {
    return hadManagedMapping
      ? reconciliation('MISSING_MANAGED_TARGET')
      : { state: 'NOT_PROJECTED' };
  }

  try {
    assertProjectionManagedAndUnchanged(observedPost, expectedIdentityTags);
  } catch (error) {
    return reconciliation('DRIFT_OR_IDENTITY_AMBIGUITY', error instanceof Error ? error.message : String(error));
  }

  const visibility = observedPost.status === 'published'
    ? 'PUBLISHED'
    : observedPost.status === 'draft'
      ? 'DRAFT'
      : null;
  if (visibility == null) {
    return reconciliation('UNSUPPORTED_GHOST_STATUS', `status=${observedPost.status ?? '<missing>'}`);
  }

  if (!validFingerprint(currentSourceFingerprint) || !validFingerprint(projectedSourceFingerprint)) {
    return reconciliation('SOURCE_FINGERPRINT_UNAVAILABLE');
  }

  if (currentSourceFingerprint !== projectedSourceFingerprint) {
    return { state: 'OUTDATED', visibility };
  }

  return visibility === 'PUBLISHED'
    ? { state: 'PUBLISHED_CURRENT' }
    : { state: 'DRAFT_CURRENT' };
}
