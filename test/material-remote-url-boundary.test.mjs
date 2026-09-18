import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectMaterialAssetEvidence } from '../src/material-asset-evidence.mjs';

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-remote-boundary-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  await mkdir(articleDir, { recursive: true });
  return { repoRoot, sourcePath: path.join(articleDir, 'en.md') };
}

test('material evidence rejects credentialed remote images from any compiler backend', async () => {
  const value = await fixture();
  const variant = {
    variantId: 'variant-en',
    locale: 'en',
    title: 'Title',
    excerpt: 'Summary',
    slug: 'article-en',
    sourcePath: value.sourcePath,
    body: '# Body'
  };

  await assert.rejects(
    collectMaterialAssetEvidence({
      variant,
      compiledDocument: {
        htmlFragment: '<img src="https://user:password@example.com/image.png">',
        locale: 'en',
        referencedAssets: [{
          kind: 'image',
          href: 'https://user:password@example.com/image.png',
          alt: '',
          title: null,
          resolvedHref: null
        }],
        diagnostics: []
      },
      repoRoot: value.repoRoot
    }),
    /must not contain URL credentials/
  );
});
