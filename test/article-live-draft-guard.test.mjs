import test from 'node:test';
import assert from 'node:assert/strict';
import { requireArticleLiveDraftContext } from '../src/article-live-draft-guard.mjs';

const SHA = 'a'.repeat(40);

function input(overrides = {}) {
  return {
    verifyOptIn: '1',
    expectedSourceSha: SHA,
    actualHeadSha: SHA,
    worktreeStatus: '',
    ghostAdminUrl: 'https://blog.ox0.uk',
    expectedGhostUrl: 'https://blog.ox0.uk',
    hostRuntimeModule: null,
    ...overrides
  };
}

test('live draft verifier accepts explicit clean exact-candidate production Ghost context', () => {
  assert.deepEqual(requireArticleLiveDraftContext(input()), {
    sourceSha: SHA,
    ghostUrl: 'https://blog.ox0.uk'
  });
});

test('live draft verifier canonicalizes an equivalent trailing slash for double-entry matching', () => {
  assert.deepEqual(requireArticleLiveDraftContext(input({
    ghostAdminUrl: 'https://blog.ox0.uk/',
    expectedGhostUrl: 'https://blog.ox0.uk'
  })), {
    sourceSha: SHA,
    ghostUrl: 'https://blog.ox0.uk'
  });
});

test('live draft verifier requires explicit mutation opt-in', () => {
  assert.throws(
    () => requireArticleLiveDraftContext(input({ verifyOptIn: '' })),
    /OX0_ARTICLE_DRAFT_VERIFY=1/
  );
});

test('live draft verifier rejects stale SHA, dirty tree and deployment host module', () => {
  assert.throws(
    () => requireArticleLiveDraftContext(input({ expectedSourceSha: 'b'.repeat(40) })),
    /must equal the exact current git HEAD/
  );
  assert.throws(
    () => requireArticleLiveDraftContext(input({ worktreeStatus: ' M src/a.mjs\n' })),
    /clean exact-candidate worktree/
  );
  assert.throws(
    () => requireArticleLiveDraftContext(input({ hostRuntimeModule: 'host/runtime.mjs' })),
    /forbids OX0_HOST_RUNTIME_MODULE/
  );
});

test('live draft verifier requires exact credential-free HTTPS Ghost origin', () => {
  assert.throws(
    () => requireArticleLiveDraftContext(input({ ghostAdminUrl: 'http://blog.ox0.uk' })),
    /must use https/
  );
  assert.throws(
    () => requireArticleLiveDraftContext(input({ ghostAdminUrl: 'https://user:pass@blog.ox0.uk' })),
    /must not contain URL credentials/
  );
  assert.throws(
    () => requireArticleLiveDraftContext(input({ ghostAdminUrl: 'https://blog.ox0.uk?x=1' })),
    /must not contain query or fragment/
  );
  assert.throws(
    () => requireArticleLiveDraftContext(input({ expectedGhostUrl: 'https://blog.ox0.uk#verify' })),
    /must not contain query or fragment/
  );
  assert.throws(
    () => requireArticleLiveDraftContext(input({ expectedGhostUrl: 'https://other.example' })),
    /must exactly match/
  );
});
