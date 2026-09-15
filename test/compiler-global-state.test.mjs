import test from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';
import { MarkedCompiler } from '../src/compiler/marked-compiler.mjs';

function variant(body) {
  return {
    locale: 'en',
    body,
    sourcePath: '/repo/posts/article/en.md'
  };
}

test('MarkedCompiler is isolated from mutations of the global Marked singleton', async () => {
  marked.use({ breaks: true });
  assert.match(marked.parse('line one\nline two\n'), /<br>/);

  const compiler = new MarkedCompiler();
  const compiled = await compiler.compile(variant('line one\nline two\n'));
  assert.doesNotMatch(compiled.htmlFragment, /<br\s*\/?/);
  assert.match(compiled.htmlFragment, /line one\nline two/);
});
