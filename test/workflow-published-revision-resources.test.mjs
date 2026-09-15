import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTION_PUBLISH_MODE,
  productionPublishModeForPlan
} from '../src/workflow-dispatch-control.mjs';

const TARGET = `sha256:${'1'.repeat(64)}`;
const OLD = `sha256:${'2'.repeat(64)}`;

function variant({
  operation = 'update',
  projectedSourceFingerprint = OLD,
  assetPlans = [],
  featureImage = { action: 'none' }
} = {}) {
  return {
    locale: 'en',
    sourceFingerprint: TARGET,
    assetPlans,
    ghost: {
      operation,
      existingPostId: 'post-en',
      currentStatus: 'published',
      desiredStatus: 'published',
      projectedSourceFingerprint,
      featureImage,
      observed: {
        postId: 'post-en',
        updatedAt: '2026-09-16T00:00:00.000Z',
        status: 'published',
        slug: 'article-en',
        tags: ['#ox0-test'],
        projectedSourceFingerprint,
        syncHash: '3'.repeat(64)
      }
    }
  };
}

function plan(item = variant()) {
  return {
    articleId: 'article-1',
    action: 'publish',
    variants: [item]
  };
}

test('published revision accepts only bounded resource actions produced by the planner contract', () => {
  for (const item of [
    variant({ assetPlans: [{ action: 'publish' }] }),
    variant({ assetPlans: [{ action: 'reuse' }], featureImage: { action: 'upload' } }),
    variant({ featureImage: { action: 'reuse' } }),
    variant({
      operation: 'noop',
      projectedSourceFingerprint: TARGET,
      featureImage: { action: 'preserve' }
    }),
    variant({
      operation: 'noop',
      projectedSourceFingerprint: TARGET,
      featureImage: { action: 'none' }
    })
  ]) {
    assert.equal(productionPublishModeForPlan(plan(item)), PRODUCTION_PUBLISH_MODE.PUBLISHED_REVISION);
  }
});

test('published revision rejects malformed or semantically incompatible resource actions', () => {
  const cases = [
    [variant({ assetPlans: [{ action: 'delete' }] }), /publish\/reuse local body asset plans/],
    [variant({ assetPlans: {} }), /asset plans must be an array/],
    [variant({ featureImage: { action: 'preserve' } }), /featureImage plan is incompatible with update/],
    [variant({
      operation: 'noop',
      projectedSourceFingerprint: TARGET,
      featureImage: { action: 'upload' }
    }), /featureImage plan is incompatible with noop/],
    [variant({
      operation: 'noop',
      projectedSourceFingerprint: TARGET,
      featureImage: { action: 'reuse' }
    }), /featureImage plan is incompatible with noop/]
  ];

  for (const [item, expected] of cases) {
    assert.throws(() => productionPublishModeForPlan(plan(item)), expected);
  }
});
