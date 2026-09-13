import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicationAuthorizationForDispatchPlan,
  requireArticleWorkflowDispatchContext,
  requireExactCurrentDraftsForProduction
} from '../src/workflow-dispatch-control.mjs';

const SHA = 'a'.repeat(40);
const MANIFEST = 'posts/example/article.json';

function context(overrides = {}) {
  const operation = overrides.operation ?? 'publish';
  return {
    actions: 'true',
    eventName: 'workflow_dispatch',
    ref: 'refs/heads/main',
    sha: SHA,
    expectedSha: SHA,
    manifestRef: MANIFEST,
    operation,
    publishConfirmation: operation === 'publish' ? `publish:${MANIFEST}@${SHA}` : '',
    ...overrides
  };
}

function draftVariant(locale, digit, overrides = {}) {
  const sourceFingerprint = `sha256:${digit.repeat(64)}`;
  return {
    locale,
    sourceFingerprint,
    ghost: {
      operation: 'status-update',
      existingPostId: `post-${locale}`,
      currentStatus: 'draft',
      desiredStatus: 'published',
      projectedSourceFingerprint: sourceFingerprint,
      observed: {
        postId: `post-${locale}`,
        status: 'draft',
        projectedSourceFingerprint: sourceFingerprint,
        syncHash: digit.repeat(64)
      }
    },
    ...overrides
  };
}

function publishPlan(overrides = {}) {
  return {
    articleId: 'article-1',
    action: 'publish',
    variants: [draftVariant('ko-KR', '1'), draftVariant('en', '2')],
    ...overrides
  };
}

test('workflow dispatch context binds production publish to main, exact SHA, Article path and explicit confirmation', () => {
  assert.deepEqual(requireArticleWorkflowDispatchContext(context()), {
    sourceSha: SHA,
    manifestRef: MANIFEST,
    operation: 'publish',
    action: 'publish',
    mutatesGhost: true,
    productionPublish: true
  });
});

test('workflow dispatch context distinguishes read-only plans, draft mutation and publish mutation', () => {
  assert.deepEqual(
    ['plan-draft', 'plan-publish', 'draft', 'publish'].map((operation) => {
      const value = requireArticleWorkflowDispatchContext(context({
        operation,
        publishConfirmation: operation === 'publish' ? `publish:${MANIFEST}@${SHA}` : ''
      }));
      return [value.operation, value.action, value.mutatesGhost, value.productionPublish];
    }),
    [
      ['plan-draft', 'draft', false, false],
      ['plan-publish', 'publish', false, false],
      ['draft', 'draft', true, false],
      ['publish', 'publish', true, true]
    ]
  );
});

test('workflow dispatch context fails closed outside exact main workflow_dispatch execution', () => {
  const cases = [
    [{ actions: 'false' }, /requires GitHub Actions/],
    [{ eventName: 'push' }, /requires workflow_dispatch/],
    [{ ref: 'refs/heads/feature' }, /only from refs\/heads\/main/],
    [{ sha: 'b'.repeat(40) }, /source_sha must equal/],
    [{ expectedSha: 'ABC' }, /lowercase 40-hex/],
    [{ operation: 'delete', publishConfirmation: '' }, /workflow operation/]
  ];
  for (const [overrides, pattern] of cases) {
    assert.throws(() => requireArticleWorkflowDispatchContext(context(overrides)), pattern);
  }
});

test('workflow manifest path cannot escape or alias the Article source root', () => {
  for (const manifestRef of [
    '../article.json',
    './posts/example/article.json',
    '/tmp/article.json',
    'posts/example/../article.json',
    'posts/example/post.json',
    'assets/example/article.json',
    'posts\\example\\article.json'
  ]) {
    assert.throws(
      () => requireArticleWorkflowDispatchContext(context({
        manifestRef,
        publishConfirmation: `publish:${manifestRef}@${SHA}`
      })),
      /workflow manifest path/
    );
  }
});

test('production publish confirmation binds exact normalized manifest and source SHA', () => {
  for (const publishConfirmation of [
    '',
    `publish:${MANIFEST}@${'b'.repeat(40)}`,
    `publish:posts/other/article.json@${SHA}`,
    `draft:${MANIFEST}@${SHA}`
  ]) {
    assert.throws(
      () => requireArticleWorkflowDispatchContext(context({ publishConfirmation })),
      /production workflow confirmation/
    );
  }

  for (const operation of ['plan-draft', 'plan-publish', 'draft']) {
    assert.throws(
      () => requireArticleWorkflowDispatchContext(context({
        operation,
        publishConfirmation: 'unexpected'
      })),
      /must be empty for non-publish/
    );
  }
});

test('production workflow accepts only exact-current managed drafts for every locale', () => {
  assert.equal(requireExactCurrentDraftsForProduction(publishPlan()).articleId, 'article-1');
});

test('production workflow rejects first-publish, stale, already-published, rewrite and unbound draft plans', () => {
  const cases = [
    [draftVariant('en', '2', { ghost: { ...draftVariant('en', '2').ghost, existingPostId: null, observed: null, operation: 'create' } }), /existing managed draft/],
    [draftVariant('en', '2', { ghost: { ...draftVariant('en', '2').ghost, currentStatus: 'published', observed: { ...draftVariant('en', '2').ghost.observed, status: 'published' }, operation: 'noop' } }), /status=draft/],
    [draftVariant('en', '2', { ghost: { ...draftVariant('en', '2').ghost, projectedSourceFingerprint: `sha256:${'3'.repeat(64)}`, operation: 'update' } }), /not exact-current/],
    [draftVariant('en', '2', { ghost: { ...draftVariant('en', '2').ghost, operation: 'update' } }), /draft-to-published status update/],
    [draftVariant('en', '2', { ghost: { ...draftVariant('en', '2').ghost, observed: null } }), /exact bound managed-draft observation/],
    [draftVariant('en', '2', { ghost: { ...draftVariant('en', '2').ghost, observed: { ...draftVariant('en', '2').ghost.observed, syncHash: '' } } }), /exact bound managed-draft observation/]
  ];

  for (const [variant, pattern] of cases) {
    assert.throws(
      () => requireExactCurrentDraftsForProduction(publishPlan({ variants: [draftVariant('ko-KR', '1'), variant] })),
      pattern
    );
  }
});

test('workflow dispatch control binds external publish intent to exact fresh draft-plan fingerprints', () => {
  const dispatch = requireArticleWorkflowDispatchContext(context());
  const authorization = publicationAuthorizationForDispatchPlan(dispatch, publishPlan());

  assert.deepEqual(authorization, {
    version: 1,
    kind: 'explicit-production-publication',
    articleId: 'article-1',
    sourceFingerprints: {
      'ko-KR': `sha256:${'1'.repeat(64)}`,
      en: `sha256:${'2'.repeat(64)}`
    }
  });
});

test('workflow dispatch authorization rejects non-publish contexts and malformed plans', () => {
  const publish = requireArticleWorkflowDispatchContext(context());
  const draft = requireArticleWorkflowDispatchContext(context({
    operation: 'draft',
    publishConfirmation: ''
  }));

  assert.throws(
    () => publicationAuthorizationForDispatchPlan(draft, publishPlan()),
    /requires an exact publish workflow_dispatch context/
  );
  assert.throws(
    () => publicationAuthorizationForDispatchPlan(publish, publishPlan({ action: 'draft' })),
    /require a publish plan/
  );
  assert.throws(
    () => publicationAuthorizationForDispatchPlan(publish, publishPlan({
      variants: [draftVariant('en', '1'), draftVariant('en', '2')]
    })),
    /duplicate locale/
  );
  assert.throws(
    () => publicationAuthorizationForDispatchPlan(publish, publishPlan({
      variants: [draftVariant('en', '2', { sourceFingerprint: 'not-a-fingerprint' })]
    })),
    /source fingerprint is invalid/
  );
});
