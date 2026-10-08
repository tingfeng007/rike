import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { installRenderEnv } from './helpers/renderEnv.mjs';

installRenderEnv();
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const { StorageService } = await server.ssrLoadModule('/src/services/storage.js');
const { default: GrammarLab } = await server.ssrLoadModule('/src/components/GrammarLab.jsx');
const { default: GrammarWorkbench } = await server.ssrLoadModule('/src/components/GrammarWorkbench.jsx');
const { buildGrammarLessonQuiz } = await server.ssrLoadModule('/src/services/grammarLessons.js');
const originalGetSession = StorageService.getLearningSession;
let sessions = {};
StorageService.getLearningSession = (scope) => sessions[scope];
const render = (Component) => renderToString(React.createElement(Component, { onOpenSettings() {}, onPractice() {}, onShowPatterns() {} })).replace(/<!--.*?-->/g, '');
const makeQuestion = () => buildGrammarLessonQuiz({ topicIds: ['expansion'], count: 1, seed: 'saved-session' })[0];

test.after(async () => {
  StorageService.getLearningSession = originalGetSession;
  await server.close();
});

test('grammar pages recover safely from malformed or obsolete session shapes', () => {
  for (const invalid of [null, [], 'invalid', 12, true, {
    topicId: 'removed-topic', slots: [], drafts: { expansion: { sentence: {}, checks: [] } }, notes: [null, {}],
    activeTab: 'removed-tab', questions: [null, { id: 'bad', patternId: 'toString', prompt: 'bad', options: [] }],
    aiSentence: {}, analysis: [],
  }]) {
    sessions = { 'grammar-lab': invalid, 'grammar-workbench': invalid };
    assert.doesNotThrow(() => render(GrammarLab));
    assert.match(render(GrammarWorkbench), /第 1 \/ 8 节/);
  }
});

test('workbench restores selected chapter, authored draft, reflection and saved evidence', () => {
  sessions = { 'grammar-workbench': {
    topicId: 'frequency',
    drafts: { frequency: { sentence: 'I often read at home.', reflection: 'Often precedes read.', checks: { core: true, structure: true, meaning: false } } },
    notes: [{ id: 'one', topicId: 'frequency', sentence: 'She is always ready.', checks: { core: true }, createdAt: 1 }],
  } };
  const html = render(GrammarWorkbench);
  assert.match(html, /第 3 \/ 8 节/);
  assert.match(html, /I often read at home\./);
  assert.match(html, /Often precedes read\./);
  assert.match(html, /She is always ready\./);
  assert.match(html, /已保存造句 1 \/ 8 节/);
  assert.match(html, /自评 1 \/ 3 项/);
});

test('workbench rejects wrong types, invalid builder choices and unknown evidence topics', () => {
  sessions = { 'grammar-workbench': {
    topicId: 'expansion', slots: { frequency: 'not-a-choice', manner: {}, place: 3, time: 'on Sunday mornings' }, timeFirst: true,
    drafts: { expansion: { sentence: ['unsafe'], reflection: { text: 'unsafe' }, checks: { core: 'true' } } },
    notes: [
      { id: 'bad-topic', topicId: 'removed-topic', sentence: 'SHOULD_NOT_APPEAR' },
      { id: 'bad-sentence', topicId: 'expansion', sentence: { text: 'SHOULD_NOT_APPEAR' } },
      { id: 'valid', topicId: 'expansion', sentence: 'I read a book.', checks: { core: 'true', structure: true } },
    ],
  } };
  const html = render(GrammarWorkbench);
  assert.match(html, /On Sunday mornings, I read a book\./);
  assert.match(html, /自评 1 \/ 3 项/);
  assert.doesNotMatch(html, /not-a-choice|SHOULD_NOT_APPEAR|\[object Object\]/);
});

test('restored quiz clamps its position and requires complete valid answers to show completion', () => {
  const question = makeQuestion();
  sessions = { 'grammar-lab': { activeTab: 'practice', questions: [question], answers: { [question.id]: question.answer }, questionIndex: 999, quizRunId: 'saved-run' } };
  assert.match(render(GrammarLab), /1 \/ 1/);
  assert.match(render(GrammarLab), /答对了/);
  sessions['grammar-lab'].answers = [];
  sessions['grammar-lab'].finished = true;
  assert.doesNotMatch(render(GrammarLab), /本组完成|答对了/);
  sessions['grammar-lab'].answers = { [question.id]: question.answer };
  assert.match(render(GrammarLab), /本组完成：1 \/ 1 正确/);
});

test('quiz recovery rejects prototype names and choices with duplicated identity', () => {
  const question = makeQuestion();
  sessions = { 'grammar-lab': { activeTab: 'practice', questions: [
    { ...question, patternId: '__proto__', prompt: 'INVALID_PROTOTYPE_QUESTION' },
    { ...question, id: 'duplicate-choice', prompt: 'INVALID_DUPLICATE_QUESTION', options: [{ label: 'A', value: '0' }, { label: 'B', value: '0' }] },
  ], answers: {} } };
  const html = render(GrammarLab);
  assert.match(html, /开始练习/);
  assert.doesNotMatch(html, /INVALID_PROTOTYPE_QUESTION|INVALID_DUPLICATE_QUESTION/);
});

test('sentence analysis recovery drops results for a different sentence and normalizes malformed fields', () => {
  sessions = { 'grammar-lab': { activeTab: 'analyze', aiSentence: 'New sentence.', analysis: { sentence: 'Old sentence.', structureSummary: 'STALE_ANALYSIS', clauses: [] } } };
  assert.doesNotMatch(render(GrammarLab), /STALE_ANALYSIS/);
  sessions['grammar-lab'].analysis = { sentence: 'New sentence.', structureSummary: 'VALID_ANALYSIS', translation: {}, clauses: [null, { type: {}, text: 'New sentence.', explanation: {} }], grammarPoints: [null, {}, 'A useful point.'] };
  const html = render(GrammarLab);
  assert.match(html, /VALID_ANALYSIS|A useful point\./);
  assert.doesNotMatch(html, /\[object Object\]/);
});

test('restored text inputs are bounded and title-like objects are never rendered as strings', () => {
  sessions = { 'grammar-lab': { activeTab: 'analyze', aiSentence: 'x'.repeat(5000) }, 'grammar-workbench': { drafts: { expansion: { sentence: 'z'.repeat(1000), reflection: 'r'.repeat(2000) } } } };
  const lab = render(GrammarLab);
  assert.match(lab, /x{3000}/);
  assert.doesNotMatch(lab, /x{3001}/);
  const workbench = render(GrammarWorkbench);
  assert.match(workbench, /z{500}/);
  assert.doesNotMatch(workbench, /z{501}/);
  assert.match(workbench, /r{1000}/);
  assert.doesNotMatch(workbench, /r{1001}/);
});
