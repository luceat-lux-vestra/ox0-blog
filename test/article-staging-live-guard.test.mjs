import test from 'node:test';
import assert from 'node:assert/strict';
import { requireArticleStagingLiveContext } from '../src/article-staging-live-guard.mjs';

const SHA = 'a'.repeat(40);

function input(overrides = {}) {
  return {
    verifyOptIn: '1',
    promoteOptIn: '1',
    expectedSourceSha: SHA,
    actualHeadSha: SHA,
    worktreeStatus: '',
    ghostAdminUrl: 'https://staging-blog.example',
    expectedStagingUrl: 'https://staging-blog.example',
    hostRuntimeModule: null,
    ...overrides
  };
}

test('staging verifier accepts only explicit clean exact-candidate staging context', () => {
  assert.deepEqual(requireArticleStagingLiveContext(input()), {
    sourceSha: SHA,
    stagingUrl: 'https://staging-blog.example'
  });
});

test('staging verifier requires independent mutation and promotion opt-ins', () => {
  assert.throws(
    () => requireArticleStagingLiveContext(input({ verifyOptIn: '' })),
    /OX0_ARTICLE_STAGING_VERIFY=1/
  );
  assert.throws(
    () => requireArticleStagingLiveContext(input({ promoteOptIn: '' })),
    /OX0_ARTICLE_STAGING_PROMOTE=1/
  );
});

test('staging verifier rejects stale SHA, dirty tree and deployment host module', () => {
  assert.throws(
    () => requireArticleStagingLiveContext(input({ expectedSourceSha: 'b'.repeat(40) })),
    /must equal the exact current git HEAD/
  );
  assert.throws(
    () => requireArticleStagingLiveContext(input({ worktreeStatus: ' M src/a.mjs\n' })),
    /clean exact-candidate worktree/
  );
  assert.throws(
    () => requireArticleStagingLiveContext(input({ hostRuntimeModule: 'host/runtime.mjs' })),
    /forbids OX0_HOST_RUNTIME_MODULE/
  );
});

test('staging verifier requires exact credential-free HTTPS staging origin and refuses production aliases', () => {
  assert.throws(
    () => requireArticleStagingLiveContext(input({ ghostAdminUrl: 'http://staging-blog.example' })),
    /must use https/
  );
  assert.throws(
    () => requireArticleStagingLiveContext(input({ ghostAdminUrl: 'https://user:pass@staging-blog.example' })),
    /must not contain URL credentials/
  );
  assert.throws(
    () => requireArticleStagingLiveContext(input({ expectedStagingUrl: 'https://other.example' })),
    /must exactly match/
  );

  for (const productionUrl of ['https://blog.ox0.uk', 'https://BLOG.OX0.UK', 'https://blog.ox0.uk.']) {
    assert.throws(
      () => requireArticleStagingLiveContext(input({
        ghostAdminUrl: productionUrl,
        expectedStagingUrl: productionUrl
      })),
      /refuses production Ghost host/
    );
  }
});
