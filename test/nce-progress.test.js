import test from 'node:test';
import assert from 'node:assert/strict';
import { commitNceProgress, countCorrectNceAnswers, recordFirstNceAnswer } from '../src/services/nceProgress.js';
import { completeNceRecall, getNceNextReviewAt } from '../src/services/nceMastery.js';

test('failed course saves do not publish progress or completion activity', () => {
  const current = { unit: { status: 'learning' } };
  let recorded = false;
  const next = commitNceProgress(current, 'unit', { status: 'completed' }, { persist: () => false, recordActivity: () => { recorded = true; }, activity: { source: 'nce-lesson' } });
  assert.equal(next, null);
  assert.equal(recorded, false);
  assert.equal(current.unit.status, 'learning');
});

test('course completion returns committed state and rolls progress back when activity cannot save', () => {
  const current = { unit: { status: 'learning' } };
  const writes = [];
  assert.equal(commitNceProgress(current, 'unit', { status: 'completed' }, { persist: (value) => { writes.push(value); return true; }, recordActivity: () => null, activity: {} }), null);
  assert.equal(writes.length, 2);
  assert.equal(writes[1], current);
  const saved = commitNceProgress(current, 'unit', { status: 'completed' }, { persist: () => true, recordActivity: () => ({ id: 'event' }), activity: {}, now: 100 });
  assert.equal(saved.unit.status, 'completed');
  assert.equal(saved.unit.lastStudiedAt, 100);
});

test('answer results are counted once per question, including a repeatedly answered last question', () => {
  const questions = [{ id: 'q1' }, { id: 'q2' }];
  const answers = { q1: true, q2: true, unknown: true };
  assert.equal(countCorrectNceAnswers(questions, answers), 2);
  answers.q2 = false;
  assert.equal(countCorrectNceAnswers(questions, answers), 1);
});

test('retrying after an answer reveal repairs the mistake without changing independent first-answer score', () => {
  const first = recordFirstNceAnswer({}, 'q1', false);
  assert.equal(recordFirstNceAnswer(first, 'q1', true), first);
  assert.equal(countCorrectNceAnswers([{ id: 'q1' }], first), 0);
});

test('explicit successful recall renews an expired date from this attempt and is idempotent', () => {
  const progress = { nextReviewAt: 1, dictationBest: 100, exerciseScore: 5, exerciseTotal: 5, examBest: 100 };
  assert.ok(getNceNextReviewAt(progress, 100) > 100);
  assert.equal(completeNceRecall(progress, { score: 79, now: 100, sessionId: 'one' }), null);
  const recalled = completeNceRecall(progress, { score: 80, now: 100, sessionId: 'one' });
  assert.equal(recalled.nextReviewAt, 100 + 86400000, 'historical 100 must not lengthen an 80-point recall');
  assert.equal(completeNceRecall(recalled, { score: 100, now: 101, sessionId: 'one' }), null);
  assert.equal(completeNceRecall(recalled, { score: 96, now: 200, sessionId: 'two' }).nextReviewAt, 200 + 7 * 86400000);
});
