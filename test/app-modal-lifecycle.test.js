import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createServer } from 'vite';
import { installRenderEnv } from './helpers/renderEnv.mjs';

installRenderEnv();
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
test.after(() => server.close());
const { default: App } = await server.ssrLoadModule('/src/App.jsx');
const { Modal } = await server.ssrLoadModule('/src/components/ui/Modal.jsx');

// Execute the real hook callbacks without a browser. This exercises event ordering and
// cleanup; visible keyboard/DOM behavior remains covered by the browser acceptance suite.
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
    useId() { return slot(() => ({ value: `test-hook-${cursor}` })).value; },
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
    dispose() { cells.forEach((cell) => cell.cleanup?.()); pending = []; },
  };
}

function findElement(tree, predicate) {
  if (Array.isArray(tree)) return tree.map((child) => findElement(child, predicate)).find(Boolean);
  if (!tree || typeof tree !== 'object') return null;
  return predicate(tree) ? tree : findElement(tree.props?.children, predicate);
}

function navigationEnvironment(hash) {
  installRenderEnv();
  const listeners = new Map();
  const entries = [{ hash, state: { lingoflow: true } }];
  let position = 0;
  let backCalls = 0;
  let pendingBack = 0;
  window.location.hash = hash;
  window.addEventListener = (name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); };
  window.removeEventListener = (name, callback) => listeners.get(name)?.delete(callback);
  const dispatch = (name) => listeners.get(name)?.forEach((callback) => callback({ type: name }));
  window.history = {
    get state() { return entries[position].state; },
    pushState(state, _title, nextHash) { entries.splice(position + 1); entries.push({ hash: nextHash, state }); position += 1; window.location.hash = nextHash; },
    replaceState(state, _title, nextHash) { entries[position] = { hash: nextHash, state }; window.location.hash = nextHash; },
    back() { pendingBack += 1; backCalls += 1; },
  };
  return {
    dispatch,
    get backCalls() { return backCalls; },
    finishBack() { assert.ok(pendingBack > 0); pendingBack -= 1; position = Math.max(0, position - 1); window.location.hash = entries[position].hash; dispatch('popstate'); dispatch('hashchange'); },
  };
}

const navigation = (tree) => findElement(tree, (element) => element.type?.name === 'AppNavigation').props.onNavigate;
const dictionary = (tree) => findElement(tree, (element) => element.type === Modal).props;
const oralIntent = (tree) => findElement(tree, (element) => element.props?.onNavigateToVocab).props.intent;

test('dictionary Back and duplicate route events retain the mounted oral intent', () => {
  const env = navigationEnvironment('#/oral?scenarioId=cafe');
  const app = hookHarness(App);
  try {
    let tree = app.render(); app.flush();
    const original = oralIntent(tree);
    navigation(tree)('dictionary'); tree = app.render(); app.flush();
    assert.equal(dictionary(tree).open, true);
    // Browser Back is asynchronous; both popstate and hashchange are emitted.
    window.history.back(); env.finishBack(); tree = app.render(); app.flush();
    assert.equal(dictionary(tree).open, false);
    assert.equal(oralIntent(tree), original);
  } finally { app.dispose(); }
});

test('a queued dictionary hash event cannot reopen a closing sheet and rapid close only backs once', () => {
  const env = navigationEnvironment('#/oral?scenarioId=cafe');
  const app = hookHarness(App);
  try {
    let tree = app.render(); app.flush();
    navigation(tree)('dictionary'); tree = app.render(); app.flush();
    const close = dictionary(tree).onClose;
    close(); close();
    env.dispatch('hashchange'); tree = app.render(); app.flush();
    assert.equal(dictionary(tree).open, false);
    assert.equal(env.backCalls, 1);
    // A subsequent user request must win after the older history traversal completes.
    navigation(tree)('dictionary', { query: 'coffee' });
    env.finishBack(); tree = app.render(); app.flush();
    assert.equal(dictionary(tree).open, true);
    assert.equal(dictionary(tree).children.props.children.props.intent.query, 'coffee');
    assert.equal(window.location.hash, '#/dictionary?query=coffee');
  } finally { app.dispose(); }
});

test('the dictionary returns to a restored learning page when the initial URL had no hash', () => {
  const env = navigationEnvironment('');
  localStorage.setItem('lingoflow_app_state', JSON.stringify({ activeTab: 'oral' }));
  const app = hookHarness(App);
  try {
    let tree = app.render(); app.flush();
    assert.equal(oralIntent(tree), null);
    navigation(tree)('dictionary'); tree = app.render(); app.flush();
    dictionary(tree).onClose(); env.finishBack(); tree = app.render(); app.flush();
    assert.equal(window.location.hash, '#/oral');
    assert.equal(dictionary(tree).open, false);
    assert.equal(oralIntent(tree), null);
  } finally { app.dispose(); }
});

test('changing a deep link creates one new intent even when both route events arrive', () => {
  const env = navigationEnvironment('#/oral?scenarioId=cafe');
  const app = hookHarness(App);
  try {
    let tree = app.render(); app.flush();
    const original = oralIntent(tree);
    window.location.hash = '#/oral?scenarioId=airport'; env.dispatch('popstate');
    tree = app.render(); app.flush();
    const changed = oralIntent(tree);
    assert.equal(changed.scenarioId, 'airport');
    assert.notEqual(changed, original);
    env.dispatch('hashchange'); tree = app.render(); app.flush();
    assert.equal(oralIntent(tree), changed);
  } finally { app.dispose(); }
});

test('reading metadata writes finite numeric IDs to the URL and does not stringify arbitrary objects', () => {
  const env = navigationEnvironment('#/reader');
  const app = hookHarness(App);
  try {
    app.render(); app.flush();
    localStorage.setItem('lingoflow_app_state', JSON.stringify({ activeTab: 'reader', lastReaderArticleId: 42 }));
    env.dispatch('lingoflow:storage');
    assert.equal(window.location.hash, '#/reader?articleId=42');
    localStorage.setItem('lingoflow_app_state', JSON.stringify({ activeTab: 'reader', lastReaderArticleId: { id: 100 } }));
    env.dispatch('lingoflow:storage');
    assert.equal(window.location.hash, '#/reader?articleId=42');
  } finally { app.dispose(); }
});

test('dictionary queries survive deep link restoration without new intents, and vocabulary navigation records its effective section', () => {
  const env = navigationEnvironment('#/oral?scenarioId=cafe');
  const app = hookHarness(App);
  try {
    let tree = app.render(); app.flush();
    const originalOral = oralIntent(tree);
    navigation(tree)('dictionary'); tree = app.render(); app.flush();
    const props = dictionary(tree).children.props.children.props;
    const intent = props.intent;
    const overlayState = window.history.state;
    props.onQueryChange('coffee');
    assert.equal(window.location.hash, '#/dictionary?query=coffee');
    assert.equal(window.history.state, overlayState);
    assert.equal(env.backCalls, 0);
    env.dispatch('hashchange'); tree = app.render(); app.flush();
    assert.equal(dictionary(tree).children.props.children.props.intent, intent);
    const restoredApp = hookHarness(App);
    try {
      const restored = restoredApp.render();
      assert.equal(dictionary(restored).open, true);
      assert.equal(dictionary(restored).children.props.children.props.intent.query, 'coffee');
    } finally { restoredApp.dispose(); }
    dictionary(tree).onClose();
    props.onQueryChange('late-query');
    assert.equal(window.location.hash, '#/dictionary?query=coffee');
    env.finishBack(); tree = app.render(); app.flush();
    assert.equal(window.location.hash, '#/oral?scenarioId=cafe');
    assert.equal(oralIntent(tree), originalOral);
    props.onQueryChange('after-close');
    assert.equal(window.location.hash, '#/oral?scenarioId=cafe');
    localStorage.setItem('lingoflow_app_state', JSON.stringify({ wordGrammarSection: 'grammar' }));
    navigation(tree)('vocab'); tree = app.render(); app.flush();
    assert.equal(window.location.hash, '#/vocab?section=grammar');
    assert.equal(findElement(tree, (element) => element.props?.onOpenSource).props.intent.section, 'grammar');
  } finally { app.dispose(); }
});

function modalEnvironment() {
  installRenderEnv();
  const nodes = [];
  const node = (name, parent = null, role = '') => {
    const result = { name, role, tagName: 'DIV', parentElement: parent, children: [], inert: false, style: {},
      get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); },
      contains(target) { for (let item = target; item; item = item.parentElement) if (item === this) return true; return false; },
      closest(selector) { for (let item = this; item; item = item.parentElement) if ((selector === '[inert]' && item.inert) || (selector === '[role="dialog"]' && item.role === 'dialog')) return item; return null; },
      querySelector() { return null; },
      focus() { if (this.isConnected && !this.closest('[inert]')) document.activeElement = this; },
    };
    parent?.children.push(result); nodes.push(result); return result;
  };
  document.body = node('body'); document.body.style.overflow = 'auto';
  document.querySelectorAll = () => nodes.filter((entry) => entry.role === 'dialog' && entry.isConnected);
  const shell = node('shell', document.body);
  const main = node('main', shell);
  const trigger = node('trigger', main);
  trigger.focus();
  const mount = (name) => {
    const wrapper = node(`${name}-wrapper`, shell);
    const panel = node(name, wrapper, 'dialog');
    const modal = hookHarness(Modal);
    const tree = modal.render({ open: true, title: name });
    findElement(tree, (element) => element.props?.role === 'dialog').props.ref.current = panel;
    modal.flush();
    return { panel, close() { wrapper.parentElement.children = wrapper.parentElement.children.filter((entry) => entry !== wrapper); wrapper.parentElement = null; modal.dispose(); } };
  };
  return { node, main, trigger, mount };
}

test('overlapping modals keep scroll and background locked until the last closes, then restore the original trigger', () => {
  const env = modalEnvironment();
  const first = env.mount('first');
  const nestedTrigger = env.node('nested-trigger', first.panel); nestedTrigger.focus();
  const second = env.mount('second');
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(env.main.inert, true);
  first.close();
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(env.main.inert, true);
  assert.equal(document.activeElement, second.panel);
  second.close();
  assert.equal(document.body.style.overflow, 'auto');
  assert.equal(env.main.inert, false);
  assert.equal(document.activeElement, env.trigger);
});
