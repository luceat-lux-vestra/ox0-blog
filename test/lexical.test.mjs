import test from 'node:test';
import assert from 'node:assert/strict';
import { createHtmlCardLexical, htmlFromSingleCardLexical } from '../src/lexical.mjs';

test('serializes rendered HTML as one canonical Ghost HTML card', () => {
  const html = '<div data-ox0-bilingual="true"><section lang="ko">한국어</section><section lang="en">English</section></div>\n';
  const lexical = createHtmlCardLexical(html);
  const parsed = JSON.parse(lexical);

  assert.equal(parsed.root.type, 'root');
  assert.equal(parsed.root.version, 1);
  assert.equal(parsed.root.children.length, 1);
  assert.deepEqual(parsed.root.children[0], {
    type: 'html',
    version: 1,
    html,
    visibility: {
      web: {
        nonMember: true,
        memberSegment: 'status:free,status:-free'
      },
      email: {
        memberSegment: 'status:free,status:-free'
      }
    }
  });
  assert.equal(htmlFromSingleCardLexical(lexical), html);
});

test('rejects malformed or non-single-card Ghost lexical content', () => {
  assert.throws(() => htmlFromSingleCardLexical('{not json'), /not valid JSON/);
  assert.throws(() => htmlFromSingleCardLexical(JSON.stringify({ root: { type: 'root', version: 1, children: [] } })), /exactly one root HTML card/);
  assert.throws(() => htmlFromSingleCardLexical(JSON.stringify({
    root: {
      type: 'root', version: 1,
      children: [{ type: 'paragraph', version: 1 }]
    }
  })), /exactly one valid HTML card/);
  assert.throws(() => htmlFromSingleCardLexical(JSON.stringify({
    root: {
      type: 'root', version: 1,
      children: [{ type: 'html', version: 1, html: '<p>one</p>' }, { type: 'html', version: 1, html: '<p>two</p>' }]
    }
  })), /exactly one root HTML card/);
});
