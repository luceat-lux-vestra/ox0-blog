import test from 'node:test';
import assert from 'node:assert/strict';
import { GhostAdminClient } from '../src/ghost-client.mjs';
import { createHtmlCardLexical } from '../src/lexical.mjs';

test('create/update request direct lexical explicitly without source=html conversion', async () => {
  const seen = [];
  const lexical = createHtmlCardLexical('<p>body</p>');
  const client = new GhostAdminClient({
    url: 'https://blog.example',
    key: `abc:${'77'.repeat(32)}`,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      const body = JSON.parse(options.body);
      seen.push({
        method: options.method,
        source: parsed.searchParams.get('source'),
        formats: parsed.searchParams.get('formats'),
        saveRevision: parsed.searchParams.get('save_revision'),
        body
      });
      return new Response(JSON.stringify({ posts: [{ id: 'post-1', ...body.posts[0] }] }), { status: 200 });
    }
  });

  await client.createPost({ title: 'Example', lexical });
  await client.updatePost('post-1', { title: 'Example 2', lexical, updated_at: '2026-01-01T00:00:00.000Z' });
  await client.updatePostMetadata('post-1', { tags: ['Rust'], updated_at: '2026-01-02T00:00:00.000Z' });

  assert.equal(seen.length, 3);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].source, null);
  assert.equal(seen[0].formats, 'lexical');
  assert.equal(seen[0].body.posts[0].lexical, lexical);
  assert.equal(seen[1].method, 'PUT');
  assert.equal(seen[1].source, null);
  assert.equal(seen[1].formats, 'lexical');
  assert.equal(seen[1].saveRevision, 'true');
  assert.equal(seen[1].body.posts[0].lexical, lexical);
  assert.equal(seen[2].method, 'PUT');
  assert.equal(seen[2].source, null);
  assert.equal(seen[2].formats, 'lexical');
  assert.equal(seen[2].saveRevision, null);
});
