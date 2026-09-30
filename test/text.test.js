import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeRegExp, containsTerm } from '../src/services/text.js';

/**
 * Regression tests for the "unescaped user text goes into a RegExp" defects
 * (see docs/FUNCTIONALITY_UX_SWEEP.md, findings O-01 和 R-04).
 *
 * Two call sites built `new RegExp(`\\b${userValue}\\b`)` straight from user data:
 *   - OralCoach.jsx:163 — a vocabulary entry like `C++` threw "Nothing to repeat" AFTER the
 *     input box had already been cleared, so the user's message vanished with no error;
 *   - SmartReader.jsx:504 — a token like `e.g` matched unrelated sentences, so the word
 *     lookup attached another occurrence's context (and stored it on the card).
 */

test('escapeRegExp neutralises every regex metacharacter', () => {
  const cases = ['C++', '(e.g.', 'a[b', 'a]b', 'a{b', 'a}b', 'a(b)', 'a|b', 'a^b', 'a$b', 'a.b', 'a*b', 'a+b', 'a?b', 'a\\b'];
  for (const value of cases) {
    assert.doesNotThrow(
      () => new RegExp(escapeRegExp(value)),
      `escaping ${JSON.stringify(value)} must produce a valid pattern`,
    );
    // The escaped pattern must match the literal text, not a wildcard expansion.
    assert.ok(
      new RegExp(escapeRegExp(value)).test(value),
      `${JSON.stringify(value)} must match itself`,
    );
  }
});

test('escapeRegExp leaves plain words untouched', () => {
  assert.equal(escapeRegExp('handbag'), 'handbag');
  assert.equal(escapeRegExp("don't"), "don't");
  assert.equal(escapeRegExp(''), '');
  assert.equal(escapeRegExp(null), '');
});

test('containsTerm no longer matches a dotted token against a different word', () => {
  // `\be.g\b` (unescaped) matches "egg"; the escaped version must not.
  assert.equal(containsTerm('I had an egg for breakfast', 'e.g'), false);
  assert.equal(containsTerm('Use a tool, e.g. a hammer', 'e.g'), true);
});

test('containsTerm handles entries that used to throw', () => {
  // These are reachable: the oral coach stores a whole sentence as the "word" when the
  // learner saves a better alternative, and users add tokens like C++ themselves.
  assert.doesNotThrow(() => containsTerm('I write C++ daily', 'C++'));
  assert.equal(containsTerm('I write C++ daily', 'C++'), true);
  assert.equal(containsTerm('nothing relevant here', 'C++'), false);
  assert.doesNotThrow(() => containsTerm('an unmatched ( paren', '(paren'));
  assert.doesNotThrow(() => containsTerm('any text', '['));
});

test('containsTerm is word-bounded and case-insensitive for ordinary words', () => {
  assert.equal(containsTerm('Excuse me, is this your handbag?', 'handbag'), true);
  assert.equal(containsTerm('Excuse me, is this your handbag?', 'HAND'), false);
  assert.equal(containsTerm('', 'handbag'), false);
  assert.equal(containsTerm('handbag', ''), false);
});
