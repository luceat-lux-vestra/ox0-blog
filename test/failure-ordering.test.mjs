import test from 'node:test';
import assert from 'node:assert/strict';
import { synchronizePost } from '../src/publisher.mjs';

const source = {
  postPath: '/repo/posts/example.md',
  markdown: '# body',
  metadata: {
    title: 'Example',
    slug: 'example',
    status: 'draft',
    excerpt: null,
    tags: ['Rust'],
    featureImage: '/repo/assets/cover.png',
    featureImageAlt: null,
    featured: false,
    visibility: 'public',
    canonicalUrl: null
  }
};

class SideEffectProbeClient {
  constructor() { this.calls = []; }
  async getPostsBySourceTag() { this.calls.push('identity'); return []; }
  async getPostBySlug() { this.calls.push('slug'); return null; }
  async getPageBySlug() { this.calls.push('page'); return null; }
  async uploadImage() { this.calls.push('upload'); throw new Error('upload must not run'); }
  async createPost() { this.calls.push('create'); throw new Error('create must not run'); }
  async updatePost() { this.calls.push('update'); throw new Error('update must not run'); }
  async getPostById() { this.calls.push('fresh'); throw new Error('fresh read must not run'); }
  async updatePostMetadata() { this.calls.push('stamp'); throw new Error('stamp must not run'); }
}

test('render failure occurs before Ghost access and image upload side effects', async () => {
  const client = new SideEffectProbeClient();
  const renderMarkdown = () => { throw new Error('render failed'); };

  await assert.rejects(
    synchronizePost({ source, action: 'draft', client, repoRoot: '/repo', renderMarkdown }),
    /render failed/
  );
  assert.deepEqual(client.calls, []);
});
