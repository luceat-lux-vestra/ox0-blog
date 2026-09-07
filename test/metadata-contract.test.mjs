import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMetadata } from '../src/post.mjs';

const context = { postPath: '/repo/posts/example.md', repoRoot: '/repo' };

function metadata(overrides = {}) {
  return { title: 'Example', slug: 'example', status: 'draft', ...overrides };
}

test('source metadata enforces Ghost Admin API length limits before publication', () => {
  const cases = [
    [metadata({ title: 'x'.repeat(2001) }), /title must be at most 2000/],
    [metadata({ slug: 'a'.repeat(186) }), /slug must be at most 185/],
    [metadata({ excerpt: 'x'.repeat(301) }), /excerpt must be at most 300/],
    [metadata({ tags: ['x'.repeat(192)] }), /tag must be at most 191/],
    [metadata({ feature_image_alt: 'x'.repeat(65536) }), /feature_image_alt must be at most 65535/],
    [metadata({ canonical_url: `https://example.com/${'x'.repeat(2000)}` }), /canonical_url must be at most 2000/],
    [metadata({ feature_image: `https://example.com/${'x'.repeat(2000)}` }), /remote feature_image must be at most 2000/]
  ];

  for (const [raw, expected] of cases) {
    assert.throws(() => validateMetadata(raw, context), expected);
  }
});

test('remote feature_image must be a syntactically valid HTTPS URL', () => {
  assert.throws(
    () => validateMetadata(metadata({ feature_image: 'https://' }), context),
    /valid HTTPS URL/
  );
});
