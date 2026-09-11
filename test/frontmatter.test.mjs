import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatterDocument } from '../src/frontmatter.mjs';

test('parses constrained frontmatter and body', () => {
  const parsed = parseFrontmatterDocument(`---\ntitle: "Example"\nslug: example\nstatus: draft\ntags:\n  - Rust\n  - "Spring Batch"\nfeatured: false\nexcerpt: >-\n  one line\n  two line\n---\n# Hello\n`);
  assert.deepEqual(parsed.data.tags, ['Rust', 'Spring Batch']);
  assert.equal(parsed.data.featured, false);
  assert.equal(parsed.data.excerpt, 'one line two line');
  assert.equal(parsed.body, '# Hello\n');
});

test('parses YAML-style doubled single-quote escapes', () => {
  const parsed = parseFrontmatterDocument(`---\ntitle: 'It''s constrained'\nslug: example\nstatus: draft\n---\nbody`);
  assert.equal(parsed.data.title, "It's constrained");
});

test('quoted and block scalars may contain hash characters literally', () => {
  const quoted = parseFrontmatterDocument(`---\ntitle: "C# notes"\nslug: example\nstatus: draft\n---\nbody`);
  assert.equal(quoted.data.title, 'C# notes');

  const block = parseFrontmatterDocument(`---\ntitle: Example\nslug: example\nstatus: draft\nexcerpt: |-\n  line # literal content\n---\nbody`);
  assert.equal(block.data.excerpt, 'line # literal content');
});

test('rejects inline YAML comments instead of silently changing canonical metadata', () => {
  for (const frontmatter of [
    'title: Example # temporary note',
    'title: # missing title',
    'tags:\n  - Rust # primary tag'
  ]) {
    assert.throws(
      () => parseFrontmatterDocument(`---\n${frontmatter}\nslug: example\nstatus: draft\n---\nbody`),
      /inline YAML comments are not supported/
    );
  }
});

test('rejects malformed single-quoted scalars instead of treating them as plain strings', () => {
  for (const title of ["'unclosed", "'closed' trailing", "'it\\'s not yaml'"]) {
    assert.throws(
      () => parseFrontmatterDocument(`---\ntitle: ${title}\nslug: example\nstatus: draft\n---\nbody`),
      /invalid single-quoted string/
    );
  }
});

test('rejects unknown keys', () => {
  assert.throws(() => parseFrontmatterDocument('---\ntitle: x\nunknown: y\n---\nbody'), /unknown frontmatter key/);
});
