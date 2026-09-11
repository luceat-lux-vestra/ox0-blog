import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECTION_FINGERPRINT_VERSION, projectionSourceFingerprintV1 } from '../src/projection-fingerprint.mjs';

function projection(overrides = {}) {
  return {
    identityTags: ['#ox0-source-placeholder'],
    locale: 'ko-KR',
    title: '제목',
    slug: 'article-ko',
    excerpt: '요약',
    tags: ['Rust', 'Compiler'],
    featureImage: null,
    featureImageAlt: null,
    featured: false,
    visibility: 'public',
    canonicalUrl: null,
    ...overrides
  };
}

function compiled(overrides = {}) {
  return {
    htmlFragment: '<h1>본문</h1>\n<p>text</p>\n',
    locale: 'ko-KR',
    referencedAssets: [],
    diagnostics: [],
    ...overrides
  };
}

test('projection source fingerprint contract is explicitly versioned', () => {
  assert.equal(PROJECTION_FINGERPRINT_VERSION, 1);
  assert.match(projectionSourceFingerprintV1(projection(), compiled()), /^sha256:[a-f0-9]{64}$/);
});

test('projection identity metadata is not part of source currentness fingerprint', () => {
  const first = projectionSourceFingerprintV1(projection(), compiled());
  const second = projectionSourceFingerprintV1(
    projection({ identityTags: ['#ox0-source-other'] }),
    compiled()
  );
  assert.equal(second, first);
});

test('managed public source changes invalidate projection fingerprint', () => {
  const base = projectionSourceFingerprintV1(projection(), compiled());
  assert.notEqual(projectionSourceFingerprintV1(projection({ title: '다른 제목' }), compiled()), base);
  assert.notEqual(projectionSourceFingerprintV1(projection({ slug: 'renamed' }), compiled()), base);
  assert.notEqual(projectionSourceFingerprintV1(projection({ tags: ['Compiler', 'Rust'] }), compiled()), base);
  assert.notEqual(projectionSourceFingerprintV1(projection({ featured: true }), compiled()), base);
  assert.notEqual(projectionSourceFingerprintV1(projection(), compiled({ htmlFragment: '<h1>changed</h1>' })), base);
});

test('line ending differences in compiled HTML do not create OS-only drift', () => {
  const lf = projectionSourceFingerprintV1(projection(), compiled({ htmlFragment: '<p>a</p>\n<p>b</p>\n' }));
  const crlf = projectionSourceFingerprintV1(projection(), compiled({ htmlFragment: '<p>a</p>\r\n<p>b</p>\r\n' }));
  assert.equal(crlf, lf);
});

test('material asset evidence is deterministic and content-sensitive', () => {
  const a = { ref: '../assets/a.png', sha256: 'a'.repeat(64) };
  const b = { ref: '../assets/b.png', sha256: 'b'.repeat(64) };
  const first = projectionSourceFingerprintV1(projection(), compiled(), { materialAssets: [a, b] });
  const reordered = projectionSourceFingerprintV1(projection(), compiled(), { materialAssets: [b, a] });
  const changed = projectionSourceFingerprintV1(projection(), compiled(), {
    materialAssets: [a, { ...b, sha256: 'c'.repeat(64) }]
  });
  assert.equal(reordered, first);
  assert.notEqual(changed, first);
});

test('remote feature image uses its URL while local feature image requires content evidence', () => {
  const remoteA = projectionSourceFingerprintV1(
    projection({ featureImage: 'https://img.example/a.png' }),
    compiled()
  );
  const remoteB = projectionSourceFingerprintV1(
    projection({ featureImage: 'https://img.example/b.png' }),
    compiled()
  );
  assert.notEqual(remoteA, remoteB);

  assert.throws(
    () => projectionSourceFingerprintV1(projection({ featureImage: '/repo/assets/a.png' }), compiled()),
    /requires featureImageFingerprint/
  );
  const local = projectionSourceFingerprintV1(
    projection({ featureImage: '/repo/assets/a.png' }),
    compiled(),
    { featureImageFingerprint: `sha256:${'d'.repeat(64)}` }
  );
  assert.match(local, /^sha256:[a-f0-9]{64}$/);
});

test('draft/publish authorization is absent from fingerprint input by construction', () => {
  const value = projectionSourceFingerprintV1(projection(), compiled());
  const withIgnoredExtraOperationField = projectionSourceFingerprintV1(
    projection({ operation: 'publish' }),
    compiled()
  );
  assert.equal(withIgnoredExtraOperationField, value);
});

test('compiler locale mismatch fails closed', () => {
  assert.throws(
    () => projectionSourceFingerprintV1(projection(), compiled({ locale: 'en' })),
    /does not match projection.locale/
  );
});
