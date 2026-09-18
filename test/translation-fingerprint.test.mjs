import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSLATION_FINGERPRINT_VERSION, translationFingerprintV1 } from '../src/translation-fingerprint.mjs';

function variant(overrides = {}) {
  return {
    variantId: 'variant-ko-1',
    locale: 'ko-KR',
    title: '제목',
    excerpt: '요약',
    slug: 'slug-a',
    body: '# 본문\n\n문장  \n다음 줄\n',
    sourcePath: '/repo/posts/a/ko-KR.md',
    ...overrides
  };
}

test('translation fingerprint contract is explicitly versioned', () => {
  assert.equal(TRANSLATION_FINGERPRINT_VERSION, 1);
  assert.match(translationFingerprintV1(variant()), /^sha256:[a-f0-9]{64}$/);
});

test('path, slug, and stable identity changes are excluded from translation meaning', () => {
  const first = translationFingerprintV1(variant());
  const second = translationFingerprintV1(variant({
    variantId: 'variant-ko-moved',
    slug: 'renamed-slug',
    sourcePath: '/repo/posts/moved/ko-KR.md'
  }));
  assert.equal(second, first);
});

test('title, excerpt, and body semantic source changes affect translation fingerprint', () => {
  const base = translationFingerprintV1(variant());
  assert.notEqual(translationFingerprintV1(variant({ title: '다른 제목' })), base);
  assert.notEqual(translationFingerprintV1(variant({ excerpt: '다른 요약' })), base);
  assert.notEqual(translationFingerprintV1(variant({ body: '# 다른 본문\n' })), base);
});

test('Markdown-significant body whitespace is preserved by the fingerprint contract', () => {
  const hardBreak = translationFingerprintV1(variant({ body: 'line  \nnext\n' }));
  const softBreak = translationFingerprintV1(variant({ body: 'line\nnext\n' }));
  assert.notEqual(hardBreak, softBreak);
});

test('line ending normalization avoids OS-only fingerprint drift', () => {
  const lf = translationFingerprintV1(variant({ body: '# body\n\ntext\n' }));
  const crlf = translationFingerprintV1(variant({ body: '# body\r\n\r\ntext\r\n' }));
  assert.equal(crlf, lf);
});

test('material asset content participates while asset ordering does not', () => {
  const a = { ref: '../assets/a.png', sha256: 'a'.repeat(64) };
  const b = { ref: '../assets/b.png', sha256: 'b'.repeat(64) };
  const first = translationFingerprintV1(variant(), { materialAssets: [a, b] });
  const reordered = translationFingerprintV1(variant(), { materialAssets: [b, a] });
  const changed = translationFingerprintV1(variant(), {
    materialAssets: [a, { ...b, sha256: 'c'.repeat(64) }]
  });
  assert.equal(reordered, first);
  assert.notEqual(changed, first);
});

test('duplicate or malformed material asset evidence fails closed', () => {
  assert.throws(
    () => translationFingerprintV1(variant(), {
      materialAssets: [
        { ref: '../assets/a.png', sha256: 'a'.repeat(64) },
        { ref: '../assets/a.png', sha256: 'b'.repeat(64) }
      ]
    }),
    /duplicate material asset/
  );
  assert.throws(
    () => translationFingerprintV1(variant(), {
      materialAssets: [{ ref: '../assets/a.png', sha256: 'ABC' }]
    }),
    /sha256/
  );
});
