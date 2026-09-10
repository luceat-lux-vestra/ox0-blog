import test from 'node:test';
import assert from 'node:assert/strict';
import { GhostAdminClient } from '../src/ghost-client.mjs';
import { createHtmlCardLexical } from '../src/lexical.mjs';
import { synchronizePost } from '../src/publisher.mjs';
import { snapshotHash, SOURCE_TAG_PREFIX, SYNC_TAG_PREFIX, sourceTagForPath } from '../src/post.mjs';

const ROOT = '/repo';
const POST_PATH = '/repo/posts/example.md';

function source(overrides = {}) {
  return {
    postPath: POST_PATH,
    markdown: '# body',
    metadata: {
      title: 'Example', slug: 'example', status: 'draft', excerpt: null, tags: ['Rust'],
      featureImage: null, featureImageAlt: null, featured: false, visibility: 'public', canonicalUrl: null,
      ...overrides
    }
  };
}

function ghostPost(overrides = {}) {
  return {
    id: 'post-1', title: 'Example', slug: 'example', lexical: '{"root":{}}', custom_excerpt: null,
    feature_image: null, feature_image_alt: null, featured: false, visibility: 'public',
    status: 'draft', canonical_url: null, updated_at: '2026-01-01T00:00:00.000Z',
    tags: [{ name: 'Rust' }], ...overrides
  };
}

function seal(post, sourceTag = sourceTagForPath(POST_PATH, ROOT)) {
  post.tags = [
    ...post.tags.filter((tag) => !tag.name.startsWith('#ox0-')),
    { name: sourceTag },
    { name: `${SYNC_TAG_PREFIX}${snapshotHash(post)}` }
  ];
  return post;
}

class FakeClient {
  constructor({ identity = [], slug = undefined, page = null, updateError = null, stampTransform = null, identityAfterMutation = null, mutationTransform = null, finalReadTransform = null } = {}) {
    this.identity = identity;
    this.slug = slug;
    this.page = page;
    this.updateError = updateError;
    this.stampTransform = stampTransform;
    this.identityAfterMutation = identityAfterMutation;
    this.mutationTransform = mutationTransform;
    this.finalReadTransform = finalReadTransform;
    this.calls = [];
    this.current = identity[0] ?? null;
    this.lastMutationTags = null;
    this.lastMutationPayload = null;
    this.identityReads = 0;
    this.postReads = 0;
  }
  async getPostsBySourceTag() {
    this.identityReads += 1;
    if (this.identityReads === 1) {
      this.calls.push('identity');
      return this.identity;
    }
    if (this.identityAfterMutation) return this.identityAfterMutation(this.current);
    return this.current ? [this.current] : [];
  }
  async getPostBySlug(requestedSlug) {
    this.calls.push('slug');
    if (this.slug !== undefined) return this.slug;
    return this.current?.slug === requestedSlug ? this.current : null;
  }
  async getPageBySlug() { this.calls.push('page'); return this.page; }
  async uploadImage() { this.calls.push('upload'); return { url: 'https://img.example/cover.png' }; }
  async createPost(payload) {
    this.calls.push('create');
    this.lastMutationTags = [...payload.tags];
    this.lastMutationPayload = structuredClone(payload);
    this.current = ghostPost({ ...payload, tags: payload.tags.map((name) => ({ name })), id: 'created' });
    if (this.mutationTransform) this.current = this.mutationTransform(this.current);
    return this.current;
  }
  async updatePost(id, payload) {
    this.calls.push('update');
    this.lastMutationTags = [...payload.tags];
    this.lastMutationPayload = structuredClone(payload);
    if (this.updateError) throw this.updateError;
    this.current = { ...this.current, ...payload, id, tags: payload.tags.map((name) => ({ name })), updated_at: '2026-01-02T00:00:00.000Z' };
    if (this.mutationTransform) this.current = this.mutationTransform(this.current);
    return this.current;
  }
  async getPostById() {
    this.calls.push('fresh');
    this.postReads += 1;
    if (this.postReads > 1 && this.finalReadTransform) return this.finalReadTransform(this.current);
    return this.current;
  }
  async updatePostMetadata(id, payload) {
    this.calls.push('stamp');
    this.current = { ...this.current, ...payload, id, tags: payload.tags.map((name) => ({ name })), updated_at: '2026-01-03T00:00:00.000Z' };
    if (this.stampTransform) this.current = this.stampTransform(this.current);
    return this.current;
  }
}

const render = () => '<h1>body</h1>';

test('creates a new draft as one Lexical HTML card and stamps source identity plus snapshot hash', async () => {
  const client = new FakeClient();
  const result = await synchronizePost({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render });
  assert.deepEqual(client.calls, ['identity', 'slug', 'page', 'create', 'fresh', 'slug', 'page', 'stamp', 'fresh', 'slug', 'page']);
  assert.equal(client.identityReads, 3);
  const sourceTag = sourceTagForPath(POST_PATH, ROOT);
  assert.deepEqual(client.lastMutationTags, ['Rust', sourceTag]);
  assert.equal(client.lastMutationPayload.lexical, createHtmlCardLexical('<h1>body</h1>'));
  assert.ok(!Object.hasOwn(client.lastMutationPayload, 'html'));
  const names = result.tags.map((tag) => tag.name);
  assert.deepEqual(names.slice(0, 2), ['Rust', sourceTag]);
  const sync = names.find((name) => name.startsWith(SYNC_TAG_PREFIX));
  assert.equal(sync, `${SYNC_TAG_PREFIX}${snapshotHash(result)}`);
});

test('same slug without source identity fails before any write', async () => {
  const client = new FakeClient({ slug: ghostPost() });
  await assert.rejects(synchronizePost({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }), /occupied by a post/);
  assert.deepEqual(client.calls, ['identity', 'slug']);
});

test('page slug collision fails before any write', async () => {
  const client = new FakeClient({ page: { id: 'page-1', slug: 'example' } });
  await assert.rejects(synchronizePost({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }), /occupied by a page/);
  assert.deepEqual(client.calls, ['identity', 'slug', 'page']);
});

test('same-slug managed update rechecks page collision before image upload or write', async () => {
  const existing = seal(ghostPost());
  const client = new FakeClient({ identity: [existing], page: { id: 'page-1', slug: 'example' } });
  await assert.rejects(
    synchronizePost({ source: source({ featureImage: '/repo/assets/cover.png' }), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }),
    /occupied by a page/
  );
  assert.deepEqual(client.calls, ['identity', 'slug', 'page']);
  assert.ok(!client.calls.includes('upload'));
  assert.ok(!client.calls.includes('update'));
});

test('draft action refuses to unpublish an existing published post', async () => {
  const existing = seal(ghostPost({ status: 'published' }));
  const client = new FakeClient({ identity: [existing] });
  await assert.rejects(synchronizePost({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }), /refuses to unpublish/);
  assert.deepEqual(client.calls, ['identity']);
});

test('external managed-field edit fails before image upload or content write', async () => {
  const existing = seal(ghostPost());
  existing.title = 'Manual edit';
  const client = new FakeClient({ identity: [existing] });
  await assert.rejects(synchronizePost({ source: source({ featureImage: '/repo/assets/cover.png' }), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }), /changed outside ox0-blog/);
  assert.deepEqual(client.calls, ['identity']);
});

test('multiple source identities fail before any write', async () => {
  const existing = seal(ghostPost());
  existing.tags.push({ name: `${SOURCE_TAG_PREFIX}${'f'.repeat(64)}` });
  const client = new FakeClient({ identity: [existing] });
  await assert.rejects(synchronizePost({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }), /invalid ox0 source identity/);
  assert.deepEqual(client.calls, ['identity']);
});

test('source identity permits a public slug change and keeps author tags before publisher state during update', async () => {
  const existing = seal(ghostPost());
  const sourceTag = sourceTagForPath(POST_PATH, ROOT);
  const oldSync = existing.tags.find((tag) => tag.name.startsWith(SYNC_TAG_PREFIX)).name;
  const client = new FakeClient({ identity: [existing] });
  const result = await synchronizePost({ source: source({ slug: 'renamed' }), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render });
  assert.deepEqual(client.calls, ['identity', 'slug', 'page', 'update', 'fresh', 'slug', 'page', 'stamp', 'fresh', 'slug', 'page']);
  assert.equal(client.identityReads, 3);
  assert.deepEqual(client.lastMutationTags, ['Rust', sourceTag, oldSync]);
  assert.equal(result.slug, 'renamed');
});

test('occupied target slug blocks managed slug rename before update', async () => {
  const existing = seal(ghostPost());
  const client = new FakeClient({ identity: [existing], slug: ghostPost({ id: 'post-2', slug: 'renamed' }) });
  await assert.rejects(synchronizePost({ source: source({ slug: 'renamed' }), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }), /occupied by a post/);
  assert.deepEqual(client.calls, ['identity', 'slug']);
});

test('changed Ghost HTML-card body fails before identity recheck or sync stamping', async () => {
  const existing = seal(ghostPost());
  const client = new FakeClient({
    identity: [existing],
    mutationTransform: (post) => ({ ...post, lexical: createHtmlCardLexical('<h1>changed</h1>') })
  });
  await assert.rejects(
    synchronizePost({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }),
    /HTML card content differs/
  );
  assert.equal(client.identityReads, 1);
  assert.deepEqual(client.calls, ['identity', 'slug', 'page', 'update', 'fresh']);
  assert.ok(!client.calls.includes('stamp'));
});

test('source identity race after mutation fails before sync stamping', async () => {
  const existing = seal(ghostPost());
  const client = new FakeClient({
    identity: [existing],
    identityAfterMutation: (current) => [current, ghostPost({ id: 'post-2' })]
  });
  await assert.rejects(
    synchronizePost({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }),
    /source identity ownership changed/
  );
  assert.equal(client.identityReads, 2);
  assert.deepEqual(client.calls, ['identity', 'slug', 'page', 'update', 'fresh', 'slug', 'page']);
  assert.ok(!client.calls.includes('stamp'));
});

test('final persisted sync stamp is re-read and managed drift fails closed', async () => {
  const existing = seal(ghostPost());
  const client = new FakeClient({
    identity: [existing],
    finalReadTransform: (post) => ({ ...post, title: 'Concurrent Ghost edit' })
  });
  await assert.rejects(
    synchronizePost({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }),
    /changed outside ox0-blog/
  );
  assert.equal(client.identityReads, 2);
  assert.deepEqual(client.calls, ['identity', 'slug', 'page', 'update', 'fresh', 'slug', 'page', 'stamp', 'fresh']);
});

test('source identity race after sync stamping fails before returning success', async () => {
  const existing = seal(ghostPost());
  let postMutationIdentityReads = 0;
  const client = new FakeClient({
    identity: [existing],
    identityAfterMutation: (current) => {
      postMutationIdentityReads += 1;
      return postMutationIdentityReads === 1 ? [current] : [current, ghostPost({ id: 'post-2' })];
    }
  });
  await assert.rejects(
    synchronizePost({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }),
    /source identity ownership changed/
  );
  assert.equal(client.identityReads, 3);
  assert.deepEqual(client.calls, ['identity', 'slug', 'page', 'update', 'fresh', 'slug', 'page', 'stamp', 'fresh', 'slug', 'page']);
});

test('source-tag slug drift plus public slug drift still updates the existing post without source=html conversion', async () => {
  const sourceTag = sourceTagForPath(POST_PATH, ROOT);
  let current = seal(ghostPost({ slug: 'old-public-slug' }), sourceTag);
  let createCount = 0;
  const requests = [];
  const client = new GhostAdminClient({
    url: 'https://blog.example',
    key: `abc:${'66'.repeat(32)}`,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      const method = options.method ?? 'GET';
      requests.push({ method, pathname: parsed.pathname, filter: parsed.searchParams.get('filter'), source: parsed.searchParams.get('source') });

      if (method === 'GET' && parsed.pathname.endsWith('/tags/')) {
        return new Response(JSON.stringify({ tags: [{ name: sourceTag, slug: 'manually-renamed-source-tag' }] }), { status: 200 });
      }
      if (method === 'GET' && parsed.pathname.endsWith('/posts/')) {
        assert.equal(parsed.searchParams.get('filter'), 'tag:manually-renamed-source-tag');
        return new Response(JSON.stringify({ posts: [current] }), { status: 200 });
      }
      if (method === 'GET' && parsed.pathname.includes('/posts/slug/')) {
        const requestedSlug = decodeURIComponent(parsed.pathname.split('/posts/slug/')[1].replace(/\/$/, ''));
        if (current.slug === requestedSlug) {
          return new Response(JSON.stringify({ posts: [current] }), { status: 200 });
        }
        return new Response(JSON.stringify({ errors: [{ message: 'Not found' }] }), { status: 404 });
      }
      if (method === 'GET' && parsed.pathname.includes('/pages/slug/')) {
        return new Response(JSON.stringify({ errors: [{ message: 'Not found' }] }), { status: 404 });
      }
      if (method === 'GET' && parsed.pathname.endsWith(`/posts/${current.id}/`)) {
        return new Response(JSON.stringify({ posts: [current] }), { status: 200 });
      }
      if (method === 'POST' && parsed.pathname.endsWith('/posts/')) {
        createCount += 1;
        throw new Error('duplicate create must not be attempted');
      }
      if (method === 'PUT' && parsed.pathname.endsWith(`/posts/${current.id}/`)) {
        const incoming = JSON.parse(options.body).posts[0];
        const tags = incoming.tags
          ? incoming.tags.map((tag) => typeof tag === 'string' ? { name: tag } : tag)
          : current.tags;
        current = {
          ...current,
          ...incoming,
          tags,
          updated_at: current.updated_at === '2026-01-01T00:00:00.000Z'
            ? '2026-01-02T00:00:00.000Z'
            : '2026-01-03T00:00:00.000Z'
        };
        return new Response(JSON.stringify({ posts: [current] }), { status: 200 });
      }
      throw new Error(`unexpected Ghost request: ${method} ${parsed.pathname}`);
    }
  });

  const result = await synchronizePost({
    source: source({ slug: 'renamed-public-slug' }),
    action: 'draft',
    client,
    repoRoot: ROOT,
    renderMarkdown: render
  });

  assert.equal(createCount, 0);
  assert.equal(result.id, 'post-1');
  assert.equal(result.slug, 'renamed-public-slug');
  assert.equal(requests.filter((request) => request.method === 'PUT').length, 2);
  assert.ok(requests.filter((request) => request.method === 'PUT').every((request) => request.source === null));
});

test('final sync stamp is verified and fails closed on publisher tag reordering', async () => {
  const existing = seal(ghostPost());
  const client = new FakeClient({
    identity: [existing],
    stampTransform: (post) => ({ ...post, tags: [post.tags.at(-1), ...post.tags.slice(0, -1)] })
  });
  await assert.rejects(
    synchronizePost({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }),
    /invalid ox0 publisher tag ordering/
  );
  assert.deepEqual(client.calls, ['identity', 'slug', 'page', 'update', 'fresh', 'slug', 'page', 'stamp']);
});

test('Ghost optimistic-concurrency failure stops before sync stamping', async () => {
  const existing = seal(ghostPost());
  const error = new Error('Update collision');
  const client = new FakeClient({ identity: [existing], updateError: error });
  await assert.rejects(synchronizePost({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }), /Update collision/);
  assert.deepEqual(client.calls, ['identity', 'slug', 'page', 'update']);
});

test('frontmatter/action disagreement fails before Ghost access', async () => {
  const client = new FakeClient();
  await assert.rejects(synchronizePost({ source: source({ status: 'published' }), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }), /does not match requested action/);
  assert.deepEqual(client.calls, []);
});
