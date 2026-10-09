import test from 'node:test';
import assert from 'node:assert/strict';
import { englishWordAtOffset, findWordAtPoint, normalizeLookupWord } from '../src/services/wordHitTest.js';

function element(tagName = 'P', attributes = {}, parentElement = null) {
  return {
    nodeType: 1,
    tagName,
    parentElement,
    style: {},
    getAttribute(name) { return Object.hasOwn(attributes, name) ? attributes[name] : null; },
    hasAttribute(name) { return Object.hasOwn(attributes, name); },
    contains(node) {
      for (let current = node; current; current = current.parentElement) {
        if (current === this) return true;
      }
      return false;
    },
  };
}

/** Simulates real caret rounding; geometry is independently computed per glyph. */
function readingSurface(text, { parent = element(), api = 'position', caretOffset, geometry } = {}) {
  const textNode = { nodeType: 3, data: text, textContent: text, parentElement: parent };
  let rangeCalls = 0;
  const document = {
    defaultView: { getComputedStyle: (target) => target.style },
    createRange() {
      rangeCalls += 1;
      let start;
      let end;
      return {
        setStart(node, offset) { assert.equal(node, textNode); start = offset; },
        setEnd(node, offset) { assert.equal(node, textNode); end = offset; },
        getClientRects() {
          return geometry ? geometry(start, end) : [{ left: start * 8, right: end * 8, top: 0, bottom: 18 }];
        },
      };
    },
  };
  const offsetAt = (x) => caretOffset === undefined ? Math.max(0, Math.min(text.length, Math.round(x / 8))) : caretOffset;
  if (api === 'position' || api === 'both') document.caretPositionFromPoint = (x) => ({ offsetNode: textNode, offset: offsetAt(x) });
  if (api === 'range' || api === 'both') document.caretRangeFromPoint = (x) => ({ startContainer: textNode, startOffset: offsetAt(x) });
  parent.ownerDocument = document;
  textNode.ownerDocument = document;
  return {
    document, textNode, parent,
    click(x, y = 9, target = parent, options = {}) {
      return findWordAtPoint({ target, clientX: x, clientY: y, button: 0 }, { document, ...options });
    },
    get rangeCalls() { return rangeCalls; },
  };
}

test('normalization accepts a complete word, contractions, compounds and single letters', () => {
  for (const [raw, expected] of [
    ['I', 'I'], ['a', 'a'], [' coffee ', 'coffee'], ["don't", "don't"],
    ['we’re', "we're"], ['mother-in-law', 'mother-in-law'], ['well‑known', 'well-known'],
    ['café', 'café'], ['nai\u0308ve', 'nai\u0308ve'],
  ]) assert.equal(normalizeLookupWord(raw), expected);
  for (const invalid of [null, '', ' ', 'two words', '<script>', 'coffee!', 'word2', '_name', 'C++', 'foo/bar', '--', 'a—b']) {
    assert.equal(normalizeLookupWord(invalid), '', String(invalid));
  }
});

test('word boundaries handle Chinese context, punctuation and rounded end offsets', () => {
  const text = '我读 coffee，然后 don’t 和 state-of-the-art。';
  assert.deepEqual(englishWordAtOffset(text, text.indexOf('coffee') + 6), { word: 'coffee', start: 3, end: 9 });
  assert.equal(englishWordAtOffset(text, text.indexOf('don’t') + 3)?.word, "don't");
  assert.equal(englishWordAtOffset(text, text.indexOf('state') + 8)?.word, 'state-of-the-art');
  assert.equal(englishWordAtOffset(text, 0), null);
  assert.equal(englishWordAtOffset(text, -1), null);
  assert.equal(englishWordAtOffset(text, 0.5), null);
  assert.equal(englishWordAtOffset(text, text.length + 1), null);
  assert.equal(englishWordAtOffset('name123', 2), null);
  assert.equal(englishWordAtOffset('_name', 2), null);
});

test('both halves of the final glyph resolve the same word without swallowing punctuation', () => {
  const surface = readingSurface('hello, world!');
  for (const x of [1, 5, 33, 39]) assert.equal(surface.click(x)?.word, 'hello');
  assert.equal(surface.click(60)?.word, 'world');
  for (const x of [40, 44, 48, 52, 55, 96, 100]) assert.equal(surface.click(x), null, `x=${x}`);
  assert.deepEqual(surface.click(39)?.rect, { left: 0, top: 0, right: 40, bottom: 18, width: 40, height: 18 });
});

test('nearby text is never mistaken for a click in whitespace or the rest of a paragraph', () => {
  const surface = readingSurface('one two');
  assert.equal(surface.click(25), null);
  assert.equal(surface.click(31), null);
  assert.equal(surface.click(160), null);
  assert.equal(surface.click(1, 25), null);
  assert.equal(surface.click(1, 18), null);
  assert.equal(readingSurface(' word').click(3), null);
});

test('uses each wrapped line rectangle rather than a bounding box that includes empty space', () => {
  const surface = readingSurface('well-known', {
    caretOffset: 5,
    geometry: () => [
      { left: 64, right: 104, top: 0, bottom: 18 },
      { left: 0, right: 40, top: 24, bottom: 42 },
    ],
  });
  assert.equal(surface.click(70)?.word, 'well-known');
  assert.equal(surface.click(5, 30)?.word, 'well-known');
  assert.equal(surface.click(5), null);
  assert.equal(surface.click(70, 30), null);
  assert.equal(surface.click(70, 21), null);
});

test('WebKit caret ranges work and an unusable modern API falls back safely', () => {
  assert.equal(readingSurface('coffee', { api: 'range' }).click(5)?.word, 'coffee');
  const throwing = readingSurface('coffee', { api: 'both' });
  throwing.document.caretPositionFromPoint = () => { throw new Error('unavailable target'); };
  assert.equal(throwing.click(5)?.word, 'coffee');
  const elementCaret = readingSurface('coffee', { api: 'both' });
  elementCaret.document.caretPositionFromPoint = () => ({ offsetNode: elementCaret.parent, offset: 0 });
  assert.equal(elementCaret.click(5)?.word, 'coffee');
  assert.equal(readingSurface('coffee', { api: 'none' }).click(5), null);
});

test('ordinary control labels and controls enclosing text keep their own interactions', () => {
  for (const tag of ['A', 'BUTTON', 'NAV', 'LABEL', 'SUMMARY', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION']) {
    const control = element(tag);
    const surface = readingSurface('coffee', { parent: element('SPAN', {}, control) });
    assert.equal(surface.click(5), null, tag);
  }
  for (const role of ['button', 'link', 'tab', 'menuitem', 'textbox', 'checkbox', 'navigation']) {
    const surface = readingSurface('coffee', { parent: element('SPAN', {}, element('DIV', { role })) });
    assert.equal(surface.click(5), null, role);
  }
});

test('explicit lesson text can override its enclosing button but not a closer control', () => {
  const button = element('BUTTON');
  for (const mode of ['text', 'word']) {
    const surface = readingSurface('coffee', { parent: element('SPAN', { 'data-word-lookup': mode }, button) });
    assert.equal(surface.click(5)?.word, 'coffee', mode);
  }
  const outer = element('DIV', { 'data-word-lookup': 'text' });
  const innerControl = readingSurface('coffee', { parent: element('SPAN', {}, element('BUTTON', {}, outer)) });
  assert.equal(innerControl.click(5), null);
  const linkText = readingSurface('coffee', { parent: element('SPAN', { 'data-word-lookup': 'text' }, element('A')) });
  assert.equal(linkText.click(5), null);
  const roleButton = readingSurface('coffee', { parent: element('SPAN', { 'data-word-lookup': 'text' }, element('DIV', { role: 'button' })) });
  assert.equal(roleButton.click(5)?.word, 'coffee');
});

test('off, editing areas, hidden text and inert ancestry always take precedence', () => {
  for (const attributes of [
    { 'data-word-lookup': 'off' }, { contenteditable: 'true' }, { contenteditable: '' },
    { contenteditable: 'plaintext-only' }, { inert: '' }, { hidden: '' }, { 'aria-hidden': 'true' },
  ]) {
    const ancestor = element('DIV', attributes);
    const surface = readingSurface('coffee', { parent: element('SPAN', { 'data-word-lookup': 'text' }, ancestor) });
    assert.equal(surface.click(5), null, JSON.stringify(attributes));
    assert.equal(surface.rangeCalls, 0);
  }
  for (const style of [{ display: 'none' }, { visibility: 'hidden' }, { contentVisibility: 'hidden' }, { opacity: '0' }]) {
    const ancestor = element(); ancestor.style = style;
    const surface = readingSurface('coffee', { parent: element('SPAN', {}, ancestor) });
    assert.equal(surface.click(5), null, JSON.stringify(style));
  }
  const editable = element(); editable.isContentEditable = true;
  assert.equal(readingSurface('coffee', { parent: editable }).click(5), null);
  assert.equal(readingSurface('coffee', { parent: element('P', { contenteditable: 'false' }) }).click(5)?.word, 'coffee');
});

test('a data-word must match a complete visible word and cannot activate blank padding', () => {
  assert.equal(readingSurface('I', { parent: element('SPAN', { 'data-word': 'I', 'data-word-lookup': 'word' }) }).click(5)?.word, 'I');
  assert.equal(readingSurface('we’re', { parent: element('SPAN', { 'data-word': "we're" }) }).click(5)?.word, "we're");
  assert.equal(readingSurface('coffee', { parent: element('SPAN', { 'data-word': 'Coffee' }) }).click(5)?.word, 'coffee');
  for (const word of ['coffee bean', '<script>', 'unrelated']) {
    assert.equal(readingSurface('coffee', { parent: element('SPAN', { 'data-word': word }) }).click(5), null, word);
  }
  const surface = readingSurface('coffee', { parent: element('SPAN', { 'data-word': 'coffee' }) });
  assert.equal(surface.click(100), null);
});

test('root and target containment reject unrelated carets without reading behind controls', () => {
  const surface = readingSurface('coffee');
  assert.equal(surface.click(5, 9, surface.parent, { root: element() }), null);
  assert.equal(surface.click(5, 9, surface.parent, { root: surface.parent })?.word, 'coffee');
  const unrelated = element(); unrelated.ownerDocument = surface.document;
  assert.equal(surface.click(5, 9, unrelated), null);
  const behindInput = element('INPUT'); behindInput.ownerDocument = surface.document;
  assert.equal(surface.click(5, 9, behindInput), null);
});

test('invalid events, missing geometry and detached text fail closed without throwing', () => {
  assert.equal(findWordAtPoint(null), null);
  const surface = readingSurface('coffee');
  for (const patch of [{ clientX: NaN }, { clientY: undefined }, { button: 2 }, { target: null }]) {
    assert.equal(findWordAtPoint({ target: surface.parent, clientX: 5, clientY: 9, button: 0, ...patch }, { document: surface.document }), null);
  }
  surface.document.createRange = () => { throw new Error('node removed'); };
  assert.equal(surface.click(5), null);
  assert.equal(readingSurface('coffee', { geometry: () => [{ left: 0, right: 0, top: 0, bottom: 18 }] }).click(0), null);
});
