import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MarkedCompiler } from '../src/compiler/marked-compiler.mjs';
import { collectMaterialAssetEvidence } from '../src/material-asset-evidence.mjs';

async function fixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'ox0-material-assets-'));
  const articleDir = path.join(repoRoot, 'posts', 'article');
  const assetDir = path.join(repoRoot, 'assets', 'article');
  await mkdir(articleDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  return {
    repoRoot,
    articleDir,
    assetDir,
    sourcePath: path.join(articleDir, 'ko-KR.md')
  };
}

function variant(sourcePath, body) {
  return {
    variantId: 'variant-ko',
    locale: 'ko-KR',
    title: '제목',
    excerpt: '요약',
    slug: 'article-ko',
    sourcePath,
    body
  };
}

async function compile(value) {
  return new MarkedCompiler().compile(value);
}

test('local compiler-observed images become stable repo-relative content hashes', async () => {
  const value = await fixture();
  const bytes = Buffer.from('png-bytes');
  await writeFile(path.join(value.assetDir, 'diagram.png'), bytes);
  const input = variant(value.sourcePath, '![diagram](../../assets/article/diagram.png)\n');
  const compiledDocument = await compile(input);

  const evidence = await collectMaterialAssetEvidence({
    variant: input,
    compiledDocument,
    repoRoot: value.repoRoot
  });

  assert.deepEqual(evidence.materialAssets, [{
    ref: 'assets/article/diagram.png',
    sha256: createHash('sha256').update(bytes).digest('hex')
  }]);
  assert.deepEqual(evidence.remoteResources, []);
});

test('duplicate local references deduplicate by canonical repository asset ref', async () => {
  const value = await fixture();
  await writeFile(path.join(value.assetDir, 'diagram.png'), 'png');
  const input = variant(
    value.sourcePath,
    '![one](../../assets/article/diagram.png)\n![two](../../assets/article/%64iagram.png)\n'
  );
  const compiledDocument = await compile(input);
  const evidence = await collectMaterialAssetEvidence({
    variant: input,
    compiledDocument,
    repoRoot: value.repoRoot
  });
  assert.equal(evidence.materialAssets.length, 1);
  assert.equal(evidence.materialAssets[0].ref, 'assets/article/diagram.png');
});

test('remote HTTPS images are validated/canonicalized but not content-hashed', async () => {
  const value = await fixture();
  const input = variant(value.sourcePath, '![remote](HTTPS://EXAMPLE.COM:443/image.png)\n');
  const compiledDocument = await compile(input);
  const evidence = await collectMaterialAssetEvidence({
    variant: input,
    compiledDocument,
    repoRoot: value.repoRoot
  });
  assert.deepEqual(evidence.materialAssets, []);
  assert.deepEqual(evidence.remoteResources, [{
    kind: 'image',
    href: 'https://example.com/image.png'
  }]);
});

test('non-HTTPS, protocol-relative, query/fragment local and malformed percent URLs fail closed', async () => {
  const value = await fixture();
  for (const href of [
    'http://example.com/image.png',
    '//example.com/image.png',
    '../../assets/article/image.png?x=1',
    '../../assets/article/image.png#fragment',
    '../../assets/article/%zz.png'
  ]) {
    const input = variant(value.sourcePath, `![bad](${href})\n`);
    const compiledDocument = await compile(input);
    await assert.rejects(
      collectMaterialAssetEvidence({ variant: input, compiledDocument, repoRoot: value.repoRoot }),
      /https|protocol-relative|query strings|fragments|percent encoding/
    );
  }
});

test('local image escape and symlink fail through repository asset confinement', async () => {
  const value = await fixture();
  await writeFile(path.join(value.repoRoot, 'outside.png'), 'outside');
  const escape = variant(value.sourcePath, '![escape](../../outside.png)\n');
  await assert.rejects(
    collectMaterialAssetEvidence({
      variant: escape,
      compiledDocument: await compile(escape),
      repoRoot: value.repoRoot
    }),
    /inside|under repository assets/
  );

  await writeFile(path.join(value.assetDir, 'real.png'), 'real');
  await symlink(path.join(value.assetDir, 'real.png'), path.join(value.assetDir, 'alias.png'));
  const alias = variant(value.sourcePath, '![alias](../../assets/article/alias.png)\n');
  await assert.rejects(
    collectMaterialAssetEvidence({
      variant: alias,
      compiledDocument: await compile(alias),
      repoRoot: value.repoRoot
    }),
    /symlink/
  );
});

test('collector refuses locale mismatch and unsupported resource kinds', async () => {
  const value = await fixture();
  const input = variant(value.sourcePath, '# body\n');
  await assert.rejects(
    collectMaterialAssetEvidence({
      variant: input,
      compiledDocument: {
        htmlFragment: '<p>body</p>',
        locale: 'en',
        referencedAssets: [],
        diagnostics: []
      },
      repoRoot: value.repoRoot
    }),
    /does not match/
  );

  await assert.rejects(
    collectMaterialAssetEvidence({
      variant: input,
      compiledDocument: {
        htmlFragment: '<p>body</p>',
        locale: 'ko-KR',
        referencedAssets: [{ kind: 'video', href: '../../assets/article/video.mp4' }],
        diagnostics: []
      },
      repoRoot: value.repoRoot
    }),
    /unsupported material resource kind/
  );
});
