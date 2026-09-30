import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { installRenderEnv } from './helpers/renderEnv.mjs';

/**
 * 页面级渲染冒烟测试。
 *
 * 用 Vite 的 SSR loader 加载**真实组件**并渲染一次，任何渲染期异常都会让测试失败。
 *
 * 为什么需要它：把弹层迁移到共享 `<Modal>` 时，形如 `{state && (<div>…{state.word}…</div>)}`
 * 的条件渲染被换成了 `<Modal open={Boolean(state)}>…</Modal>` —— 而 React 会**先求值子节点**
 * 再交给 Modal，所以弹层关闭时 `state.word` 依然会被读取并抛错，整个页面变成
 * “这个页面刚刚卡住了”。构建与 lint 都不会发现，只有真实渲染能。
 */

installRenderEnv();

const { createServer } = await import('vite');
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

test.after(async () => {
  await server.close();
});

const PAGES = [
  ['HomeDashboard', '/src/components/HomeDashboard.jsx', { onNavigate: () => {} }],
  ['OralCoach', '/src/components/OralCoach.jsx', { onNavigateToVocab: () => {}, intent: null }],
  ['SmartReader', '/src/components/SmartReader.jsx', { intent: null }],
  ['VocabularySRS', '/src/components/VocabularySRS.jsx', { onOpenSource: () => {} }],
  ['NewConcept', '/src/components/NewConcept.jsx', { intent: null }],
  ['GrammarLab', '/src/components/GrammarLab.jsx', { onOpenSettings: () => {} }],
  ['Settings', '/src/components/Settings.jsx', {}],
];

for (const [name, path, props] of PAGES) {
  test(`${name} 能在空数据下完成首次渲染`, async () => {
    const mod = await server.ssrLoadModule(path);
    const Component = mod.default;
    assert.equal(typeof Component, 'function', `${name} 应有默认导出`);

    let html = '';
    assert.doesNotThrow(() => {
      html = renderToString(React.createElement(Component, props));
    }, `${name} 首次渲染不应抛错`);

    assert.ok(html.length > 0, `${name} 应输出内容`);
  });
}

test('页面在「已有数据 + 弹层关闭」状态下渲染不抛错', async () => {
  // 这条专门盯住上文的弹层求值问题：有历史数据时，弹层内部读到的是真实对象而不是 null。
  const { localStorageShim } = installRenderEnv();
  localStorageShim.setItem('lingoflow_vocabulary', JSON.stringify([
    { id: 'w1', word: 'handbag', translation: '手提包', step: 1, intervalDays: 1, easeFactor: 2.5, status: 'learning', tags: [] },
  ]));
  localStorageShim.setItem('lingoflow_articles', JSON.stringify([
    { id: 'a1', title: 'Sample', content: 'Birds fly. The soup tastes good.', level: '初级', createdAt: 1 },
  ]));

  for (const [name, path, props] of PAGES) {
    const mod = await server.ssrLoadModule(path);
    const Component = mod.default;
    assert.doesNotThrow(() => {
      renderToString(React.createElement(Component, props));
    }, `${name} 在有数据时首次渲染不应抛错`);
  }
});
