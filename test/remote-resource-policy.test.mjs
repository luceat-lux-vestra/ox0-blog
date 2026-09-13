import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approveRemoteResource,
  approveRemoteResources
} from '../src/remote-resource-policy.mjs';

function resource(overrides = {}) {
  return {
    kind: 'body-image',
    href: 'https://cdn.example/content/diagram.png',
    articleId: 'article-1',
    locale: 'en',
    variantId: 'variant-en',
    ...overrides
  };
}

test('remote resource ALLOW requires stable explicit evidence', async () => {
  const approved = await approveRemoteResource(
    async (value) => ({
      decision: 'ALLOW',
      evidence: `trusted-cdn-v1:${value.kind}`
    }),
    resource()
  );
  assert.deepEqual(approved, {
    kind: 'body-image',
    href: 'https://cdn.example/content/diagram.png',
    evidence: 'trusted-cdn-v1:body-image'
  });

  await assert.rejects(
    approveRemoteResource(() => ({ decision: 'ALLOW' }), resource()),
    /allow evidence/
  );
});

test('remote resource DENY fails closed with host reason', async () => {
  await assert.rejects(
    approveRemoteResource(
      () => ({ decision: 'DENY', reason: 'mutable external host is not trusted' }),
      resource()
    ),
    /mutable external host is not trusted/
  );
});

test('remote resource descriptors require supported kind and HTTPS', async () => {
  await assert.rejects(
    approveRemoteResource(() => ({ decision: 'ALLOW', evidence: 'x' }), resource({ href: 'http://cdn.example/a.png' })),
    /must use https/
  );
  await assert.rejects(
    approveRemoteResource(() => ({ decision: 'ALLOW', evidence: 'x' }), resource({ kind: 'script' })),
    /unsupported remote resource kind/
  );
});

test('remote resource approvals are deterministic and bounded', async () => {
  const approvals = await approveRemoteResources(
    (value) => ({ decision: 'ALLOW', evidence: `policy-v1:${value.href}` }),
    [
      resource({ kind: 'feature-image', href: 'https://cdn.example/z.png' }),
      resource({ kind: 'body-image', href: 'https://cdn.example/a.png' })
    ]
  );
  assert.deepEqual(approvals.map((entry) => [entry.kind, entry.href]), [
    ['body-image', 'https://cdn.example/a.png'],
    ['feature-image', 'https://cdn.example/z.png']
  ]);

  await assert.rejects(
    approveRemoteResource(
      () => ({ decision: 'ALLOW', evidence: 'x'.repeat(257) }),
      resource()
    ),
    /at most 256/
  );
});
