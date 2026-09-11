import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBilingualMarkdown } from '../src/bilingual.mjs';

test('monolingual markdown is left alone', () => {
  assert.equal(parseBilingualMarkdown('# Hello\n'), null);
});

test('parses exactly one Korean and one English section', () => {
  const sections = parseBilingualMarkdown(`:::lang ko\n# 안녕\n\n본문\n:::\n\n:::lang en\n# Hello\n\nBody\n:::\n`);
  assert.deepEqual(sections.map((x) => x.lang), ['ko', 'en']);
  assert.match(sections[0].markdown, /본문/);
  assert.match(sections[1].markdown, /Body/);
});

test('rejects duplicate language sections', () => {
  assert.throws(() => parseBilingualMarkdown(`:::lang ko\na\n:::\n:::lang ko\nb\n:::\n`), /duplicate bilingual/);
});

test('rejects missing bilingual counterpart', () => {
  assert.throws(() => parseBilingualMarkdown(`:::lang ko\na\n:::\n`), /exactly one ko section and one en section/);
});

test('rejects content outside language sections', () => {
  assert.throws(() => parseBilingualMarkdown(`intro\n:::lang ko\na\n:::\n:::lang en\nb\n:::\n`), /outside/);
});

test('does not treat ::: inside fenced code as section close', () => {
  const sections = parseBilingualMarkdown(`:::lang ko\n\`\`\`text\n:::\n\`\`\`\n한국어\n:::\n:::lang en\nEnglish\n:::\n`);
  assert.match(sections[0].markdown, /```text\n:::\n```/);
});

test('does not treat a fence-like code line with trailing text as a closing fence', () => {
  const sections = parseBilingualMarkdown(`:::lang ko\n\`\`\`text\n\`\`\`not-a-close\n:::\n\`\`\`\n한국어\n:::\n:::lang en\nEnglish\n:::\n`);
  assert.match(sections[0].markdown, /```not-a-close\n:::\n```/);
});

test('ignores language markers inside a monolingual fenced code block', () => {
  const markdown = `# Parser docs\n\n\`\`\`markdown\n:::lang ko\nexample\n:::\n\`\`\`\n`;
  assert.equal(parseBilingualMarkdown(markdown), null);
});
