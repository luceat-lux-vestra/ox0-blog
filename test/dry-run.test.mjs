import test from 'node:test';
import assert from 'node:assert/strict';
import { planPostSynchronization } from '../src/publisher.mjs';
import { snapshotHash, SYNC_TAG_PREFIX, sourceTagForPath } from '../src/post.mjs';

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

function seal(post) {
  const sourceTag = sourceTagForPath(POST_PATH, ROOT);
  post.tags = [
    ...post.tags.filter((tag) => !tag.name.startsWith('#ox0-')),
    { name: sourceTag },
    { name: `${SYNC_TAG_PREFIX}${snapshotHash(post)}` }
  ];
  return post;
}

class ReadOnlyProbeClient {
  constructor({ identity = [], slug = null, page = null } = {}) {
    this.identity = identity;
    this.slug = slug;
    this.page = page;
    this.calls = [];
  }
  async getPostsBySourceTag() { this.calls.push('identity'); return this.identity; }
  async getPostBySlug() { this.calls.push('slug'); return this.slug; }
  async getPageBySlug() { this.calls.push('page'); return this.page; }
  async uploadImage() { this.calls.push('upload'); throw new Error('dry-run must not upload'); }
  async createPost() { this.calls.push('create'); throw new Error('dry-run must not create'); }
  async updatePost() { this.calls.push('update'); throw new Error('dry-run must not update'); }
  async updatePostMetadata() { this.calls.push('stamp'); throw new Error('dry-run must not stamp'); }
}

const render = () => '<h1>body</h1>';

test('dry-run plans create using GET-only Ghost access', async () => {
  const client = new ReadOnlyProbeClient();
  const plan = await planPostSynchronization({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render });
  assert.deepEqual(client.calls, ['identity', 'slug', 'page']);
  assert.equal(plan.operation, 'create');
  assert.equal(plan.desiredStatus, 'draft');
  assert.equal(plan.renderedHtmlBytes, Buffer.byteLength('<h1>body</h1>'));
  assert.deepEqual(plan.featureImage, { action: 'none' });
});

test('dry-run passes post path and repository root into the renderer', async () => {
  const client = new ReadOnlyProbeClient();
  let seen;
  const contextualRender = async (markdown, context) => {
    seen = { markdown, context };
    return '<h1>body</h1>';
  };

  await planPostSynchronization({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: contextualRender });
  assert.deepEqual(seen, {
    markdown: '# body',
    context: { postPath: POST_PATH, repoRoot: ROOT }
  });
});

test('dry-run reports local feature image as upload without uploading', async () => {
  const client = new ReadOnlyProbeClient();
  const plan = await planPostSynchronization({ source: source({ featureImage: '/repo/assets/cover.png' }), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render });
  assert.deepEqual(client.calls, ['identity', 'slug', 'page']);
  assert.deepEqual(plan.featureImage, { action: 'upload', ref: 'assets/cover.png' });
});

test('dry-run refuses a page slug collision using GET-only access', async () => {
  const client = new ReadOnlyProbeClient({ page: { id: 'page-1', slug: 'example' } });
  await assert.rejects(
    planPostSynchronization({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }),
    /occupied by a page/
  );
  assert.deepEqual(client.calls, ['identity', 'slug', 'page']);
});

test('dry-run refuses externally changed managed post before mutation', async () => {
  const existing = seal(ghostPost());
  existing.title = 'Manual edit';
  const client = new ReadOnlyProbeClient({ identity: [existing] });
  await assert.rejects(planPostSynchronization({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }), /changed outside ox0-blog/);
  assert.deepEqual(client.calls, ['identity']);
});
