import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTION_PUBLISH_MODE,
  productionPublishModeForPlan,
  publicationAuthorizationForDispatchPlan,
  publicationAuthorizationForPlan,
  requireArticleMainPushContext,
  requireArticleWorkflowDispatchContext,
  requireExactCurrentDraftsForProduction,
  requireProductionPublishMode
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

function fingerprint(digit) {
  return `sha256:${digit.repeat(64)}`;
}

function draftVariant(locale, digit, overrides = {}) {
  const sourceFingerprint = fingerprint(digit);
  return {
    locale,
    sourceFingerprint,
    assetPlans: [],
    ghost: {
      operation: 'status-update',
      existingPostId: `post-${locale}`,
      currentStatus: 'draft',
      desiredStatus: 'published',
      projectedSourceFingerprint: sourceFingerprint,
      featureImage: { action: 'none' },
      observed: {
        postId: `post-${locale}`,
        updatedAt: '2026-09-15T00:00:00.000Z',
        status: 'draft',
        projectedSourceFingerprint: sourceFingerprint,
        syncHash: digit.repeat(64)
      }
    },
    ...overrides
  };
}

function publishedVariant(locale, targetDigit, {
  projectedDigit = targetDigit,
  operation = projectedDigit === targetDigit ? 'noop' : 'update',
  assetPlans = [],
  ...overrides
} = {}) {
  const sourceFingerprint = fingerprint(targetDigit);
  const projectedSourceFingerprint = fingerprint(projectedDigit);
  return {
    locale,
    sourceFingerprint,
    assetPlans,
    ghost: {
      operation,
      existingPostId: `post-${locale}`,
      currentStatus: 'published',
      desiredStatus: 'published',
      projectedSourceFingerprint,
      featureImage: operation === 'noop' ? { action: 'none' } : { action: 'reuse', url: 'https://cdn.example/cover.png' },
      observed: {
        postId: `post-${locale}`,
        updatedAt: '2026-09-15T00:00:00.000Z',
        status: 'published',
        projectedSourceFingerprint,
        syncHash: projectedDigit.repeat(64)
      },
      ...overrides
    }
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

test('first production publication uses draft-promotion and keeps assets reuse-only', () => {
  const plan = publishPlan({
    variants: [
      draftVariant('ko-KR', '1', {
        assetPlans: [{ action: 'reuse', ref: 'assets/a.png' }]
      }),
      draftVariant('en', '2')
    ]
  });
  assert.equal(productionPublishModeForPlan(plan), PRODUCTION_PUBLISH_MODE.DRAFT_PROMOTION);
  assert.equal(requireExactCurrentDraftsForProduction(plan).articleId, 'article-1');
});

test('draft-promotion retry accepts exact-current published no-op siblings after partial locale success', () => {
  const plan = publishPlan({
    variants: [
      publishedVariant('ko-KR', '1'),
      draftVariant('en', '2')
    ]
  });
  assert.equal(productionPublishModeForPlan(plan), PRODUCTION_PUBLISH_MODE.DRAFT_PROMOTION);
  assert.throws(
    () => requireExactCurrentDraftsForProduction(plan),
    /exact-current managed draft/
  );
});

test('draft-promotion rejects first-create, stale published sibling, rewrite, unbound or unstaged resource plans', () => {
  const base = draftVariant('en', '2');
  const cases = [
    [draftVariant('en', '2', { ghost: { ...base.ghost, existingPostId: null, observed: null, operation: 'create' } }), /existing managed Ghost post/],
    [publishedVariant('en', '2', { projectedDigit: '3', featureImage: { action: 'none' } }), /draft-promotion retry requires exact-current published no-op/],
    [draftVariant('en', '2', { ghost: { ...base.ghost, projectedSourceFingerprint: fingerprint('3'), operation: 'update', observed: { ...base.ghost.observed, projectedSourceFingerprint: fingerprint('3'), syncHash: '3'.repeat(64) } } }), /draft is not exact-current/],
    [draftVariant('en', '2', { ghost: { ...base.ghost, operation: 'update' } }), /may only promote an exact-current draft/],
    [draftVariant('en', '2', { ghost: { ...base.ghost, observed: null } }), /exact bound managed-post observation/],
    [draftVariant('en', '2', { ghost: { ...base.ghost, observed: { ...base.ghost.observed, syncHash: '' } } }), /exact bound managed-post observation/],
    [draftVariant('en', '2', { ghost: { ...base.ghost, observed: { ...base.ghost.observed, updatedAt: null } } }), /exact bound managed-post observation/],
    [draftVariant('en', '2', { assetPlans: [{ action: 'publish', ref: 'assets/a.png' }] }), /pre-staged\/reuse-only/],
    [draftVariant('en', '2', { ghost: { ...base.ghost, featureImage: { action: 'upload' } } }), /must not upload or replace featureImage/]
  ];

  for (const [variant, pattern] of cases) {
    assert.throws(
      () => productionPublishModeForPlan(publishPlan({ variants: [draftVariant('ko-KR', '1'), variant] })),
      pattern
    );
  }
});

test('published revision updates changed managed public projections in place and permits resource publication', () => {
  const plan = publishPlan({
    variants: [
      publishedVariant('ko-KR', '1'),
      publishedVariant('en', '2', {
        projectedDigit: '3',
        assetPlans: [{ action: 'publish', ref: 'assets/new.png' }]
      })
    ]
  });
  assert.equal(productionPublishModeForPlan(plan), PRODUCTION_PUBLISH_MODE.PUBLISHED_REVISION);
  assert.equal(
    requireProductionPublishMode(plan, PRODUCTION_PUBLISH_MODE.PUBLISHED_REVISION).articleId,
    'article-1'
  );
});

test('published revision rejects create/status transitions, draft states and inconsistent no-op/update fingerprints', () => {
  const cases = [
    [publishedVariant('en', '2', { operation: 'create' }), /may only update or no-op/],
    [publishedVariant('en', '2', { operation: 'status-update' }), /may only update or no-op/],
    [publishedVariant('en', '2', { operation: 'noop', projectedDigit: '3' }), /no-op is not exact-current/],
    [publishedVariant('en', '2', { operation: 'update', projectedDigit: '2' }), /update must represent a changed projection/]
  ];
  for (const [variant, pattern] of cases) {
    assert.throws(
      () => productionPublishModeForPlan(publishPlan({
        variants: [publishedVariant('ko-KR', '1'), variant]
      })),
      pattern
    );
  }

  assert.throws(
    () => productionPublishModeForPlan(publishPlan({
      variants: [publishedVariant('ko-KR', '1'), {
        ...draftVariant('en', '2'),
        ghost: { ...draftVariant('en', '2').ghost, operation: 'noop' }
      }]
    })),
    /draft-promotion/
  );
});

test('production plan rejects malformed managed revision and sync evidence', () => {
  const malformedRevision = publishedVariant('en', '2', { projectedDigit: '3' });
  malformedRevision.ghost.projectedSourceFingerprint = 'sha256:not-valid';
  malformedRevision.ghost.observed.projectedSourceFingerprint = 'sha256:not-valid';
  assert.throws(
    () => productionPublishModeForPlan(publishPlan({
      variants: [publishedVariant('ko-KR', '1'), malformedRevision]
    })),
    /canonical projected source fingerprint/
  );

  const malformedSync = publishedVariant('en', '2');
  malformedSync.ghost.observed.syncHash = 'abc';
  assert.throws(
    () => productionPublishModeForPlan(publishPlan({
      variants: [publishedVariant('ko-KR', '1'), malformedSync]
    })),
    /exact bound managed-post observation/
  );
});

test('production publish mode is pinned across replans', () => {
  const promotion = publishPlan();
  const revision = publishPlan({
    variants: [publishedVariant('ko-KR', '1'), publishedVariant('en', '2', { projectedDigit: '3' })]
  });
  assert.equal(
    requireProductionPublishMode(promotion, PRODUCTION_PUBLISH_MODE.DRAFT_PROMOTION),
    promotion
  );
  assert.throws(
    () => requireProductionPublishMode(revision, PRODUCTION_PUBLISH_MODE.DRAFT_PROMOTION),
    /production publish mode changed after authorization/
  );
});

test('workflow dispatch control binds external publish intent to exact fresh plan fingerprints for both modes', () => {
  const dispatch = requireArticleWorkflowDispatchContext(context());
  for (const plan of [
    publishPlan(),
    publishPlan({ variants: [publishedVariant('ko-KR', '1'), publishedVariant('en', '2', { projectedDigit: '3' })] })
  ]) {
    const authorization = publicationAuthorizationForDispatchPlan(dispatch, plan);
    assert.deepEqual(authorization, {
      version: 1,
      kind: 'explicit-production-publication',
      articleId: 'article-1',
      sourceFingerprints: {
        'ko-KR': fingerprint('1'),
        en: fingerprint('2')
      }
    });
  }
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

test('main-push control binds production intent to exact main push and canonical Article path', () => {
  assert.deepEqual(requireArticleMainPushContext({
    actions: 'true',
    eventName: 'push',
    ref: 'refs/heads/main',
    sha: SHA,
    expectedSha: SHA,
    manifestRef: MANIFEST
  }), {
    sourceSha: SHA,
    manifestRef: MANIFEST,
    action: 'publish',
    productionPublish: true
  });
});

test('main-push control fails closed outside exact main push execution', () => {
  const base = {
    actions: 'true',
    eventName: 'push',
    ref: 'refs/heads/main',
    sha: SHA,
    expectedSha: SHA,
    manifestRef: MANIFEST
  };
  const cases = [
    [{ actions: 'false' }, /requires GitHub Actions/],
    [{ eventName: 'workflow_dispatch' }, /requires push/],
    [{ ref: 'refs/heads/feature' }, /only from refs\/heads\/main/],
    [{ sha: 'b'.repeat(40) }, /exact main push SHA/],
    [{ manifestRef: '../article.json' }, /workflow manifest path/]
  ];
  for (const [overrides, pattern] of cases) {
    assert.throws(() => requireArticleMainPushContext({ ...base, ...overrides }), pattern);
  }
});

test('generic production authorization is plan-bound and reusable by trusted control surfaces', () => {
  assert.deepEqual(publicationAuthorizationForPlan(publishPlan()), {
    version: 1,
    kind: 'explicit-production-publication',
    articleId: 'article-1',
    sourceFingerprints: {
      'ko-KR': fingerprint('1'),
      en: fingerprint('2')
    }
  });
});
