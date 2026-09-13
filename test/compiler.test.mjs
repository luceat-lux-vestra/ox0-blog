import test from 'node:test';
import assert from 'node:assert/strict';
import { MarkedCompiler } from '../src/compiler/marked-compiler.mjs';

function variant(overrides = {}) {
  return {
    locale: 'ko-KR',
    body: '# 제목\n\n![diagram](../assets/article/diagram.png)\n',
    sourcePath: '/repo/posts/article/ko-KR.md',
    ...overrides
  };
}

test('MarkedCompiler exposes an always-async LocaleVariant -> CompiledDocument boundary', async () => {
  const compiler = new MarkedCompiler();
  const pending = compiler.compile(variant({ body: '# 제목\n' }));
  assert.equal(typeof pending?.then, 'function');

  const compiled = await pending;
  assert.equal(compiled.locale, 'ko-KR');
  assert.match(compiled.htmlFragment, /<h1>제목<\/h1>/);
  assert.deepEqual(compiled.referencedAssets, []);
  assert.deepEqual(compiled.diagnostics, []);
});

test('MarkedCompiler reports resource observations without owning publication/storage policy', async () => {
  const compiler = new MarkedCompiler();
  const seen = [];
  const compiled = await compiler.compile(variant(), {
    resolveResource(resource, context) {
      seen.push({ resource, locale: context.variant.locale });
      return { href: 'https://cdn.example/content/diagram.png' };
    }
  });

  assert.deepEqual(seen, [{
    resource: {
      kind: 'image',
      href: '../assets/article/diagram.png',
      alt: 'diagram',
      title: null
    },
    locale: 'ko-KR'
  }]);
  assert.match(compiled.htmlFragment, /src="https:\/\/cdn\.example\/content\/diagram\.png"/);
  assert.deepEqual(compiled.referencedAssets, [{
    kind: 'image',
    href: '../assets/article/diagram.png',
    alt: 'diagram',
    title: null,
    resolvedHref: 'https://cdn.example/content/diagram.png'
  }]);
});

test('MarkedCompiler accepts asynchronous host resource resolution', async () => {
  const compiler = new MarkedCompiler();
  const compiled = await compiler.compile(variant(), {
    async resolveResource() {
      return { href: 'https://cdn.example/async.png' };
    }
  });
  assert.match(compiled.htmlFragment, /src="https:\/\/cdn\.example\/async\.png"/);
});

test('MarkedCompiler rejects raw HTML deterministically', async () => {
  const compiler = new MarkedCompiler();
  await assert.rejects(
    compiler.compile(variant({ body: '<div>native</div>\n' })),
    /raw HTML is not supported/
  );
});

test('MarkedCompiler rejects active or ambiguous Markdown link protocols', async () => {
  const compiler = new MarkedCompiler();
  for (const href of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'javascript&#58;alert(1)',
    'javascript&#x3a;alert(1)',
    'java&#9;script:alert(1)',
    'data:text/html,hello',
    'file:///etc/passwd',
    '//evil.example/path',
    '\\\\evil.example\\path',
    '&#92;&#92;evil.example&#92;path'
  ]) {
    await assert.rejects(
      compiler.compile(variant({ body: `[unsafe](${href})\n` })),
      /unsafe Markdown link URL protocol|protocol-relative|control characters|backslashes/,
      href
    );
  }
});

test('MarkedCompiler allows ordinary relative and non-active external link protocols', async () => {
  const compiler = new MarkedCompiler();
  const compiled = await compiler.compile(variant({
    body: [
      '[relative](../other-post)',
      '[fragment](#section)',
      '[https](https://example.com/path)',
      '[http](http://example.com/path)',
      '[mail](mailto:dev@example.com)',
      '[phone](tel:+821012345678)'
    ].join('\n')
  }));
  assert.match(compiled.htmlFragment, /href="https:\/\/example\.com\/path"/);
  assert.match(compiled.htmlFragment, /href="mailto:dev@example\.com"/);
});

test('MarkedCompiler rejects unsafe image protocols before resource resolution', async () => {
  const compiler = new MarkedCompiler();
  for (const href of [
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'http://images.example/a.png',
    '//images.example/a.png',
    '..\\..\\assets\\diagram.png'
  ]) {
    let resolverCalled = false;
    await assert.rejects(
      compiler.compile(variant({ body: `![unsafe](${href})\n` }), {
        resolveResource() {
          resolverCalled = true;
          return { href: 'https://cdn.example/safe.png' };
        }
      }),
      /unsafe Markdown image URL protocol|protocol-relative|backslashes/,
      href
    );
    assert.equal(resolverCalled, false);
  }
});

test('MarkedCompiler rejects an unsafe URL returned by the host image resolver', async () => {
  const compiler = new MarkedCompiler();
  await assert.rejects(
    compiler.compile(variant(), {
      resolveResource() {
        return { href: 'javascript:alert(1)' };
      }
    }),
    /unsafe Markdown image URL protocol/
  );
  await assert.rejects(
    compiler.compile(variant(), {
      resolveResource() {
        return { href: '\\\\cdn.example\\unsafe.png' };
      }
    }),
    /backslashes/
  );
});

test('MarkedCompiler validates the compiler contract inputs and resolver outputs', async () => {
  const compiler = new MarkedCompiler();
  await assert.rejects(compiler.compile({ locale: '', body: '# body' }), /locale/);
  await assert.rejects(compiler.compile({ locale: 'en', body: '' }), /body/);
  await assert.rejects(
    compiler.compile(variant(), { resolveResource: () => ({}) }),
    /resource resolver/
  );
});
