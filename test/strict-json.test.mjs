import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictJson } from '../src/strict-json.mjs';

test('strict JSON parses nested canonical values and keeps __proto__ as data', () => {
  const value = parseStrictJson('{"a":1,"nested":{"ok":true},"items":[null,"x"],"__proto__":{"polluted":true}}');
  assert.equal(value.a, 1);
  assert.equal(value.nested.ok, true);
  assert.deepEqual(value.items, [null, 'x']);
  assert.equal(Object.hasOwn(value, '__proto__'), true);
  assert.equal(value.__proto__.polluted, true);
  assert.equal({}.polluted, undefined);
});

test('strict JSON rejects duplicate object keys including escaped aliases', () => {
  assert.throws(() => parseStrictJson('{"a":1,"a":2}'), /duplicate JSON object key: a/);
  assert.throws(() => parseStrictJson('{"a":1,"\\u0061":2}'), /duplicate JSON object key: a/);
});

test('strict JSON rejects trailing commas, trailing content, leading-zero numbers and non-finite results', () => {
  assert.throws(() => parseStrictJson('{"a":1,}'), /invalid JSON/);
  assert.throws(() => parseStrictJson('[1,]'), /invalid JSON/);
  assert.throws(() => parseStrictJson('{"a":1}x'), /unexpected trailing content/);
  assert.throws(() => parseStrictJson('01'), /unexpected trailing content/);
  assert.throws(() => parseStrictJson('1e400'), /JSON number must be finite/);
});

test('strict JSON decodes normal JSON string escapes', () => {
  assert.equal(parseStrictJson('"line\\ntext\\u0021"'), 'line\ntext!');
});
