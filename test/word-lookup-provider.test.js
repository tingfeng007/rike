import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createServer } from 'vite';
import { installRenderEnv } from './helpers/renderEnv.mjs';

installRenderEnv();
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const { default: WordLookupProvider } = await server.ssrLoadModule('/src/components/WordLookupProvider.jsx');
const { Modal } = await server.ssrLoadModule('/src/components/ui/Modal.jsx');
test.after(() => server.close());

// Exercise the real callbacks and effect cleanup; DOM geometry is supplied only
// for the clicked word, so these tests cannot accidentally scan hidden answers.
function hookHarness(component) {
  const cells = [];
  let cursor = 0;
  let pending = [];
  const same = (before, after) => before && after && before.length === after.length && before.every((value, index) => Object.is(value, after[index]));
  const slot = (initialize) => { const index = cursor++; cells[index] ||= initialize(); return cells[index]; };
  const dispatcher = {
    useState(initial) {
      const cell = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [cell.value, (value) => { cell.value = typeof value === 'function' ? value(cell.value) : value; }];
    },
    useRef(initial) { return slot(() => ({ current: initial })); },
    useCallback(callback, deps) {
      const cell = slot(() => ({}));
      if (!same(cell.deps, deps)) { cell.value = callback; cell.deps = deps; }
      return cell.value;
    },
    useEffect(effect, deps) {
      const cell = slot(() => ({}));
      if (!same(cell.deps, deps)) { pending.push(() => { cell.cleanup?.(); cell.cleanup = effect(); }); cell.deps = deps; }
    },
  };
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  return {
    render(props = {}) {
      cursor = 0;
      const previous = internals.H;
      internals.H = dispatcher;
      try { return component(props); } finally { internals.H = previous; }
    },
    flush() { const effects = pending; pending = []; effects.forEach((effect) => effect()); },
    dispose() { cells.forEach((cell) => cell.cleanup?.()); },
  };
}

function findElement(tree, predicate) {
  if (Array.isArray(tree)) return tree.map((child) => findElement(child, predicate)).find(Boolean);
  if (!tree || typeof tree !== 'object') return null;
  return predicate(tree) ? tree : findElement(tree.props?.children, predicate);
}
const request = (tree) => findElement(tree, (node) => Boolean(node.props?.request))?.props.request;
const scope = (tree) => tree.props.children.props;

function historyEnvironment() {
  installRenderEnv();
  const listeners = new Map();
  const entries = [{ state: { lingoflow: true } }];
  let position = 0;
  let backCalls = 0;
  window.location.href = 'http://localhost/#/reader';
  window.getSelection = () => ({ isCollapsed: true, toString: () => '' });
  window.addEventListener = (name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); };
  window.removeEventListener = (name, callback) => listeners.get(name)?.delete(callback);
  const dispatch = () => listeners.get('popstate')?.forEach((callback) => callback());
  window.history = {
    get state() { return entries[position].state; },
    pushState(state) { entries.splice(position + 1); entries.push({ state }); position += 1; },
    replaceState(state) { entries[position] = { state }; },
    back() { backCalls += 1; },
  };
  return {
    get backCalls() { return backCalls; },
    finishBack() { position = Math.max(0, position - 1); dispatch(); },
    forward() { position = Math.min(entries.length - 1, position + 1); dispatch(); },
    restore(state) { window.history.replaceState(state); dispatch(); },
  };
}

function element(tagName, attributes = {}) {
  return {
    nodeType: 1, tagName, childNodes: [], style: {}, parentElement: null,
    getAttribute(name) { return attributes[name] ?? null; },
    hasAttribute(name) { return Object.hasOwn(attributes, name); },
    contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; },
    closest(selector) { const tags = selector.split(',').map((tag) => tag.trim().toUpperCase()); for (let current = this; current; current = current.parentElement) if (tags.includes(current.tagName)) return current; return null; },
  };
}
function append(parent, child) { child.parentElement = parent; child.ownerDocument = parent.ownerDocument; parent.childNodes.push(child); return child; }
function text(value) { return { nodeType: 3, data: value, textContent: value, parentElement: null }; }

function readingSurface() {
  const root = element('DIV');
  const paragraph = append(root, element('P'));
  const clicked = append(paragraph, text('Coffee helps me wake up.'));
  const document = {
    defaultView: { getComputedStyle: (node) => node.style },
    caretPositionFromPoint: () => ({ offsetNode: clicked, offset: 2 }),
    createRange: () => ({ setStart() {}, setEnd() {}, getClientRects: () => [{ left: 0, right: 48, top: 0, bottom: 18 }] }),
  };
  root.ownerDocument = document;
  paragraph.ownerDocument = document;
  clicked.ownerDocument = document;
  const nativeEvent = { target: paragraph, clientX: 16, clientY: 9, button: 0 };
  const event = { ...nativeEvent, nativeEvent, detail: 1, preventDefault() {}, stopPropagation() {} };
  return { root, paragraph, event };
}

test('Back/Forward preserves bilingual context and the current-session exploration callback', () => {
  const env = historyEnvironment();
  const provider = hookHarness(WordLookupProvider);
  let explored = 0;
  try {
    let tree = provider.render(); provider.flush();
    tree.props.value.openWordLookup({ word: 'coffee', context: 'Coffee helps me wake up.', contextCn: '咖啡让我清醒。', onExplore: () => { explored += 1; } });
    tree = provider.render(); provider.flush();
    const serialized = JSON.parse(JSON.stringify(window.history.state));
    assert.equal(serialized.lingoflowWordLookup.context, 'Coffee helps me wake up.');
    assert.equal(serialized.lingoflowWordLookup.contextCn, '咖啡让我清醒。');
    const modal = findElement(tree, (node) => node.type === Modal).props;
    modal.onClose(); modal.onClose();
    assert.equal(env.backCalls, 1);
    assert.equal(request(provider.render()), undefined);
    env.finishBack(); tree = provider.render(); provider.flush();
    assert.equal(request(tree), undefined);
    env.forward(); tree = provider.render(); provider.flush();
    assert.equal(request(tree).context, 'Coffee helps me wake up.');
    assert.equal(request(tree).contextCn, '咖啡让我清醒。');
    findElement(tree, (node) => Boolean(node.props?.request)).props.onExplore();
    assert.equal(explored, 0, 'the underlying action waits until asynchronous Back completes');
    env.finishBack(); provider.render(); provider.flush();
    assert.equal(explored, 1);
  } finally { provider.dispose(); }
});

test('restoring a serialized popup keeps its text context without requiring callback functions', () => {
  historyEnvironment();
  window.history.replaceState({ lingoflowWordLookup: { word: 'coffee', context: 'Coffee helps.', contextCn: '咖啡有帮助。', token: 'previous-session:1' } });
  const provider = hookHarness(WordLookupProvider);
  try {
    const tree = provider.render(); provider.flush();
    assert.equal(request(tree).context, 'Coffee helps.');
    assert.equal(request(tree).contextCn, '咖啡有帮助。');
    assert.equal(request(tree).onExplore, undefined);
  } finally { provider.dispose(); }
});

test('callback history is bounded while old entries retain their serialized context', () => {
  const env = historyEnvironment();
  const provider = hookHarness(WordLookupProvider);
  try {
    let tree = provider.render(); provider.flush();
    const open = tree.props.value.openWordLookup;
    open({ word: 'coffee', context: 'The oldest sentence.', onExplore() {} });
    const oldest = window.history.state;
    for (let index = 0; index < 32; index += 1) {
      window.history.pushState({ lingoflow: true });
      open({ word: 'coffee', context: `Sentence ${index}.`, onExplore() {} });
    }
    const newest = window.history.state;
    env.restore(oldest); tree = provider.render(); provider.flush();
    assert.equal(request(tree).context, 'The oldest sentence.');
    assert.equal(request(tree).onExplore, undefined);
    env.restore(newest); tree = provider.render(); provider.flush();
    assert.equal(typeof request(tree).onExplore, 'function');
  } finally { provider.dispose(); }
});

test('ordinary paragraph lookup keeps only visible local context, excluding hidden answers and controls', () => {
  historyEnvironment();
  const provider = hookHarness(WordLookupProvider);
  const surface = readingSurface();
  for (const [attributes, style] of [[{ hidden: '' }, {}], [{ inert: '' }, {}], [{ 'aria-hidden': 'true' }, {}], [{ 'data-word-lookup': 'off' }, {}], [{ class: 'sr-only' }, {}], [{}, { display: 'none' }]]) {
    const hidden = append(surface.paragraph, element('SPAN', attributes));
    hidden.style = style;
    append(hidden, text(' SECRET ANSWER'));
  }
  const input = append(surface.paragraph, element('INPUT'));
  append(input, text(' INPUT ANSWER'));
  append(surface.root, text(' UNRELATED PAGE CONTENT'));
  try {
    let tree = provider.render(); provider.flush();
    scope(tree).ref.current = surface.root;
    scope(tree).onClickCapture(surface.event);
    tree = provider.render(); provider.flush();
    assert.equal(request(tree).word, 'Coffee');
    assert.equal(request(tree).context, 'Coffee helps me wake up.');
  } finally { provider.dispose(); }
});

test('long visible context stays bounded and still includes the clicked occurrence', () => {
  historyEnvironment();
  const provider = hookHarness(WordLookupProvider);
  const surface = readingSurface();
  const clicked = surface.paragraph.childNodes[0];
  clicked.data = `${'Before. '.repeat(900)}Coffee helps me wake up.`;
  surface.paragraph.ownerDocument.caretPositionFromPoint = () => ({ offsetNode: clicked, offset: clicked.data.indexOf('Coffee') + 2 });
  try {
    let tree = provider.render(); provider.flush();
    scope(tree).ref.current = surface.root;
    scope(tree).onClickCapture(surface.event);
    tree = provider.render(); provider.flush();
    assert.ok(request(tree).context.length <= 2000);
    assert.ok(request(tree).context.includes('Coffee helps me wake up.'));
  } finally { provider.dispose(); }
});

test('a standalone word title does not replace an existing dictionary example', () => {
  historyEnvironment();
  const provider = hookHarness(WordLookupProvider);
  const surface = readingSurface();
  surface.paragraph.tagName = 'H2';
  surface.paragraph.childNodes[0].data = 'Coffee';
  try {
    let tree = provider.render(); provider.flush();
    scope(tree).ref.current = surface.root;
    scope(tree).onClickCapture(surface.event);
    tree = provider.render(); provider.flush();
    assert.equal(request(tree).word, 'Coffee');
    assert.equal(request(tree).context, '');
  } finally { provider.dispose(); }
});

test('programmatic scrolling after mouse down does not suppress word lookup; touch and pen scrolls do', () => {
  for (const pointerType of ['mouse', 'touch', 'pen']) {
    historyEnvironment();
    const provider = hookHarness(WordLookupProvider);
    const surface = readingSurface();
    try {
      let tree = provider.render(); provider.flush();
      scope(tree).ref.current = surface.root;
      scope(tree).onPointerDownCapture({ pointerId: 1, pointerType, clientX: 16, clientY: 9 });
      scope(tree).onScrollCapture();
      scope(tree).onClickCapture(surface.event);
      tree = provider.render(); provider.flush();
      assert.equal(Boolean(request(tree)), pointerType === 'mouse', pointerType);
    } finally { provider.dispose(); }
  }
});
