import test from 'node:test';
import assert from 'node:assert/strict';
import { projectionIdentityTags } from '../src/projection-identity.mjs';
import { projectionSnapshotHash, replaceProjectionPublisherTags } from '../src/projection-managed-state.mjs';
import { deriveProjectionState } from '../src/projection-state.mjs';

const identityTags = projectionIdentityTags({
  articleId: 'article-1',
  variantId: 'variant-ko-1',
  locale: 'ko-KR'
});
const CURRENT = `sha256:${'a'.repeat(64)}`;
const OLD = `sha256:${'b'.repeat(64)}`;

function post(overrides = {}) {
  return {
    id: 'post-1',
    title: '제목',
    slug: 'article-ko',
    lexical: '{"root":{}}',
    custom_excerpt: '요약',
    feature_image: null,
    feature_image_alt: null,
    featured: false,
    visibility: 'public',
    status: 'draft',
    canonical_url: null,
    tags: [{ name: 'Rust' }],
    ...overrides
  };
}

function seal(value, sourceFingerprint = CURRENT) {
  const hash = projectionSnapshotHash(value);
  value.tags = replaceProjectionPublisherTags(value.tags, identityTags, hash, { sourceFingerprint }).map((name) => ({ name }));
  return value;
}

test('no observed post and no prior managed mapping is NOT_PROJECTED', () => {
  assert.deepEqual(
    deriveProjectionState({ expectedIdentityTags: identityTags }),
    { state: 'NOT_PROJECTED' }
  );
});

test('missing target after prior managed mapping requires reconciliation', () => {
  assert.deepEqual(
    deriveProjectionState({ expectedIdentityTags: identityTags, hadManagedMapping: true }),
    { state: 'RECONCILIATION_REQUIRED', reason: 'MISSING_MANAGED_TARGET' }
  );
});

test('managed draft and published projections recover CURRENT from Ghost revision evidence', () => {
  assert.deepEqual(
    deriveProjectionState({
      observedPost: seal(post(), CURRENT),
      expectedIdentityTags: identityTags,
      currentSourceFingerprint: CURRENT
    }),
    { state: 'DRAFT_CURRENT' }
  );

  assert.deepEqual(
    deriveProjectionState({
      observedPost: seal(post({ status: 'published' }), CURRENT),
      expectedIdentityTags: identityTags,
      currentSourceFingerprint: CURRENT
    }),
    { state: 'PUBLISHED_CURRENT' }
  );
});

test('outdated state preserves current Ghost visibility', () => {
  assert.deepEqual(
    deriveProjectionState({
      observedPost: seal(post(), OLD),
      expectedIdentityTags: identityTags,
      currentSourceFingerprint: CURRENT
    }),
    { state: 'OUTDATED', visibility: 'DRAFT' }
  );

  assert.deepEqual(
    deriveProjectionState({
      observedPost: seal(post({ status: 'published' }), OLD),
      expectedIdentityTags: identityTags,
      currentSourceFingerprint: CURRENT
    }),
    { state: 'OUTDATED', visibility: 'PUBLISHED' }
  );
});

test('missing current canonical fingerprint never becomes CURRENT by inference', () => {
  assert.deepEqual(
    deriveProjectionState({
      observedPost: seal(post(), CURRENT),
      expectedIdentityTags: identityTags
    }),
    { state: 'RECONCILIATION_REQUIRED', reason: 'CURRENT_SOURCE_FINGERPRINT_UNAVAILABLE' }
  );
});

test('missing persisted projected revision never becomes CURRENT by inference', () => {
  const value = post();
  const hash = projectionSnapshotHash(value);
  value.tags = replaceProjectionPublisherTags(value.tags, identityTags, hash).map((name) => ({ name }));
  assert.deepEqual(
    deriveProjectionState({
      observedPost: value,
      expectedIdentityTags: identityTags,
      currentSourceFingerprint: CURRENT
    }),
    { state: 'RECONCILIATION_REQUIRED', reason: 'PROJECTED_SOURCE_FINGERPRINT_UNAVAILABLE' }
  );
});

test('conflicting externally supplied projection revision and Ghost revision fails closed', () => {
  assert.deepEqual(
    deriveProjectionState({
      observedPost: seal(post(), OLD),
      expectedIdentityTags: identityTags,
      currentSourceFingerprint: CURRENT,
      projectedSourceFingerprint: CURRENT
    }),
    { state: 'RECONCILIATION_REQUIRED', reason: 'SOURCE_FINGERPRINT_CONFLICT' }
  );
});

test('managed drift or identity mismatch maps to reconciliation-required', () => {
  const changed = seal(post(), CURRENT);
  changed.title = 'Manual Ghost edit';
  const result = deriveProjectionState({
    observedPost: changed,
    expectedIdentityTags: identityTags,
    currentSourceFingerprint: CURRENT
  });
  assert.equal(result.state, 'RECONCILIATION_REQUIRED');
  assert.equal(result.reason, 'DRIFT_OR_IDENTITY_AMBIGUITY');
  assert.match(result.diagnostic, /changed outside ox0-blog/);
});

test('unsupported Ghost status fails closed instead of pretending to be draft or published', () => {
  const result = deriveProjectionState({
    observedPost: seal(post({ status: 'scheduled' }), CURRENT),
    expectedIdentityTags: identityTags,
    currentSourceFingerprint: CURRENT
  });
  assert.deepEqual(result, {
    state: 'RECONCILIATION_REQUIRED',
    reason: 'UNSUPPORTED_GHOST_STATUS',
    diagnostic: 'status=scheduled'
  });
});
