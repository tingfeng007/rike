import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeLookupText, lookupQueryForWord } from '../src/services/wordTokens.js';

test('lookup tokens preserve bilingual text, punctuation, spaces and line breaks', () => {
  const source = '我说：“I’m ready.”\n  A well-known café,hello,world!';
  const tokens = tokenizeLookupText(source);
  assert.equal(tokens.map((token) => token.text).join(''), source);
  assert.deepEqual(tokens.filter((token) => token.word).map((token) => token.word), ["I'm", 'ready', 'A', 'well-known', 'café', 'hello', 'world']);
  for (const token of tokens) assert.equal(source.slice(token.index, token.index + token.text.length), token.text);
});

test('identifiers and numbers do not become misleading partial dictionary words', () => {
  const tokens = tokenizeLookupText('v2 foo_bar 3D hello');
  assert.deepEqual(tokens.filter((token) => token.word).map((token) => token.word), ['hello']);
});

test('accented English words resolve their dictionary spelling without changing displayed text', () => {
  assert.equal(lookupQueryForWord('café'), 'cafe');
  assert.equal(lookupQueryForWord('naïve'), 'naive');
  assert.equal(lookupQueryForWord('I’m'), "i'm");
  assert.equal(lookupQueryForWord('not a word'), '');
});

test('empty or non-English text produces no lookup controls', () => {
  assert.deepEqual(tokenizeLookupText(null), []);
  assert.deepEqual(tokenizeLookupText(''), []);
  const source = '中文！123\n';
  assert.equal(tokenizeLookupText(source).map((token) => token.text).join(''), source);
  assert.equal(tokenizeLookupText(source).filter((token) => token.word).length, 0);
});
