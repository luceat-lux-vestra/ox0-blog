import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createAdminToken, GhostAdminClient } from '../src/ghost-client.mjs';

function decode(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

test('creates Ghost-compatible five-minute HS256 token', () => {
  const key = `abc123:${'11'.repeat(32)}`;
  const token = createAdminToken(key, 1_700_000_000);
  const [headerPart, payloadPart, signature] = token.split('.');
  assert.deepEqual(decode(headerPart), { alg: 'HS256', kid: 'abc123', typ: 'JWT' });
  assert.deepEqual(decode(payloadPart), { iat: 1_700_000_000, exp: 1_700_000_300, aud: '/admin/' });
  const expected = createHmac('sha256', Buffer.from('11'.repeat(32), 'hex'))
    .update(`${headerPart}.${payloadPart}`).digest('base64url');
  assert.equal(signature, expected);
});

test('GET by slug turns 404 into null and pins API version header', async () => {
  let seen;
  const client = new GhostAdminClient({
    url: 'https://blog.example',
    key: `abc:${'22'.repeat(32)}`,
    fetchImpl: async (url, options) => {
      seen = { url: String(url), options };
      return new Response(JSON.stringify({ errors: [{ message: 'Not found' }] }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  assert.equal(await client.getPostBySlug('some-post'), null);
  assert.match(seen.url, /\/ghost\/api\/admin\/posts\/slug\/some-post\//);
  assert.equal(seen.options.headers['Accept-Version'], 'v6.0');
  assert.match(seen.options.headers.Authorization, /^Ghost /);
  assert.ok(seen.options.signal instanceof AbortSignal);
});

test('Ghost Admin requests fail closed when the request timeout expires', async () => {
  const client = new GhostAdminClient({
    url: 'https://blog.example',
    key: `abc:${'77'.repeat(32)}`,
    timeoutMs: 10,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      if (options.signal.aborted) {
        reject(options.signal.reason);
        return;
      }
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    })
  });

  await assert.rejects(client.getPostBySlug('slow-post'), /timed out after 10ms/);
});

test('Ghost Admin response-body reads use the same request timeout contract', async () => {
  const client = new GhostAdminClient({
    url: 'https://blog.example',
    key: `abc:${'99'.repeat(32)}`,
    timeoutMs: 10,
    fetchImpl: async (_url, options) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => new Promise((_resolve, reject) => {
        if (options.signal.aborted) {
          reject(options.signal.reason);
          return;
        }
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      })
    })
  });

  await assert.rejects(client.request('slow-body/'), /timed out after 10ms/);
});

test('Ghost Admin request timeout must be a positive integer', () => {
  for (const timeoutMs of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => new GhostAdminClient({
      url: 'https://blog.example',
      key: `abc:${'88'.repeat(32)}`,
      timeoutMs,
      fetchImpl: async () => new Response('{}')
    }), /request timeout must be a positive integer/);
  }
});

test('browse by internal source tag uses a bounded exact tag filter', async () => {
  let seen;
  const client = new GhostAdminClient({
    url: 'https://blog.example',
    key: `abc:${'33'.repeat(32)}`,
    fetchImpl: async (url) => {
      seen = String(url);
      return new Response(JSON.stringify({ posts: [{ id: '1' }] }), { status: 200 });
    }
  });
  const posts = await client.getPostsByTagSlug('hash-ox0-source-abc');
  assert.equal(posts.length, 1);
  const parsed = new URL(seen);
  assert.equal(parsed.searchParams.get('filter'), 'tag:hash-ox0-source-abc');
  assert.equal(parsed.searchParams.get('limit'), '2');
});

test('source identity resolves its current Ghost tag slug by exact tag name', async () => {
  const sourceTag = `#ox0-source-${'a'.repeat(64)}`;
  const seen = [];
  const client = new GhostAdminClient({
    url: 'https://blog.example',
    key: `abc:${'44'.repeat(32)}`,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      seen.push(parsed);
      if (parsed.pathname.endsWith('/tags/')) {
        return new Response(JSON.stringify({ tags: [{ name: sourceTag, slug: 'manually-renamed-source-tag' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ posts: [{ id: 'post-1' }] }), { status: 200 });
    }
  });

  const posts = await client.getPostsBySourceTag(sourceTag);
  assert.equal(posts.length, 1);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].searchParams.get('filter'), `tags.name:'${sourceTag}'`);
  assert.equal(seen[0].searchParams.get('limit'), '2');
  assert.equal(seen[1].searchParams.get('filter'), 'tag:manually-renamed-source-tag');
  assert.equal(seen[1].searchParams.get('limit'), '2');
});

test('source identity lookup ignores non-exact tag-name results and does not browse posts', async () => {
  const sourceTag = `#ox0-source-${'b'.repeat(64)}`;
  let calls = 0;
  const client = new GhostAdminClient({
    url: 'https://blog.example',
    key: `abc:${'55'.repeat(32)}`,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ tags: [{ name: `${sourceTag}-other`, slug: 'other' }] }), { status: 200 });
    }
  });

  assert.deepEqual(await client.getPostsBySourceTag(sourceTag), []);
  assert.equal(calls, 1);
});
