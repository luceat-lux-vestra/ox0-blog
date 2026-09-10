import test from 'node:test';
import assert from 'node:assert/strict';
import { createHtmlCardLexical } from '../src/lexical.mjs';
import { snapshotHash, SYNC_TAG_PREFIX, sourceTagForPath } from '../src/post.mjs';
import { synchronizePost } from '../src/publisher.mjs';

const ROOT = '/repo';
const POST_PATH = '/repo/posts/example.md';
const HTML = '<h1>body</h1>';

function source() {
  return {
    postPath: POST_PATH,
    markdown: '# body',
    metadata: {
      title: 'Example',
      slug: 'example',
      status: 'draft',
      excerpt: null,
      tags: ['Rust'],
      featureImage: null,
      featureImageAlt: null,
      featured: false,
      visibility: 'public',
      canonicalUrl: null
    }
  };
}

function managedPost() {
  const sourceTag = sourceTagForPath(POST_PATH, ROOT);
  const post = {
    id: 'post-1',
    title: 'Example',
    slug: 'example',
    lexical: createHtmlCardLexical(HTML),
    custom_excerpt: null,
    feature_image: null,
    feature_image_alt: null,
    featured: false,
    visibility: 'public',
    status: 'draft',
    canonical_url: null,
    updated_at: '2026-01-01T00:00:00.000Z',
    tags: [{ name: 'Rust' }, { name: sourceTag }]
  };
  post.tags.push({ name: `${SYNC_TAG_PREFIX}${snapshotHash(post)}` });
  return post;
}

class RacingPageClient {
  constructor(pageAppearsOnRead) {
    this.current = managedPost();
    this.pageAppearsOnRead = pageAppearsOnRead;
    this.pageReads = 0;
    this.calls = [];
  }

  async getPostsBySourceTag() {
    this.calls.push('identity');
    return [this.current];
  }

  async getPostBySlug(slug) {
    this.calls.push('slug');
    return this.current.slug === slug ? this.current : null;
  }

  async getPageBySlug(slug) {
    this.calls.push('page');
    this.pageReads += 1;
    return this.pageReads >= this.pageAppearsOnRead ? { id: 'page-race', slug } : null;
  }

  async updatePost(id, payload) {
    this.calls.push('update');
    this.current = {
      ...this.current,
      ...payload,
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: '2026-01-02T00:00:00.000Z'
    };
    return this.current;
  }

  async getPostById() {
    this.calls.push('fresh');
    return this.current;
  }

  async updatePostMetadata(id, payload) {
    this.calls.push('stamp');
    this.current = {
      ...this.current,
      ...payload,
      id,
      tags: payload.tags.map((name) => ({ name })),
      updated_at: '2026-01-03T00:00:00.000Z'
    };
    return this.current;
  }
}

const render = () => HTML;

test('page slug race observed after content mutation fails before sync stamping', async () => {
  const client = new RacingPageClient(2);
  await assert.rejects(
    synchronizePost({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }),
    /occupied by a page/
  );
  assert.deepEqual(client.calls, ['identity', 'slug', 'page', 'update', 'fresh', 'slug', 'page']);
  assert.ok(!client.calls.includes('stamp'));
});

test('page slug race observed after sync stamping fails before returning success', async () => {
  const client = new RacingPageClient(3);
  await assert.rejects(
    synchronizePost({ source: source(), action: 'draft', client, repoRoot: ROOT, renderMarkdown: render }),
    /occupied by a page/
  );
  assert.deepEqual(client.calls, [
    'identity', 'slug', 'page',
    'update', 'fresh', 'slug', 'page', 'identity',
    'stamp', 'fresh', 'slug', 'page'
  ]);
});
