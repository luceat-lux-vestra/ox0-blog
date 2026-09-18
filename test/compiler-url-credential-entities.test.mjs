import test from 'node:test';
import assert from 'node:assert/strict';
import { MarkedCompiler } from '../src/compiler/marked-compiler.mjs';

function variant(body) {
  return {
    locale: 'en',
    body,
    sourcePath: '/repo/posts/article/en.md'
  };
}

test('MarkedCompiler rejects named-entity-obfuscated URL credentials', async () => {
  const compiler = new MarkedCompiler();
  for (const body of [
    '[unsafe](https://user:password&commat;example.com/private)',
    '![unsafe](https://user:password&commat;images.example/private.png)'
  ]) {
    await assert.rejects(
      compiler.compile(variant(`${body}\n`)),
      /URL credentials|Markdown .* URL is invalid/
    );
  }
});
