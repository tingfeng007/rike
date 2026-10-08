import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOralTurn, recoverOralMessages, failOralTurn, finishOralTurn, correctionFromFeedback, reviewOralCorrection } from '../src/services/oralSession.js';

test('failed and interrupted oral turns retry in place without duplicate user messages or error history', () => {
  const first = prepareOralTurn([{ id: 'greeting', role: 'assistant', replyText: 'Hello' }], 'I went yesterday.', { now: 100 });
  const failed = recoverOralMessages(first.messages);
  assert.equal(failed.at(-1).failedUserText, 'I went yesterday.');
  assert.equal(failed.at(-1).status, 'failed');
  const retried = prepareOralTurn(failed, 'I went yesterday.', { retryId: first.assistant.id, now: 200 });
  assert.equal(retried.messages.length, 3);
  assert.equal(retried.messages.filter((message) => message.role === 'user').length, 1);
  assert.equal(retried.assistant.id, first.assistant.id);
  assert.deepEqual(retried.history.map((message) => message.id), ['greeting', first.user.id]);
  const failure = failOralTurn(retried.messages, first.assistant.id, { title: 'Network', tip: 'Retry' }, 300);
  assert.equal(failure.at(-1).isStreaming, false);
  assert.equal(failure.at(-1).status, 'failed');
  const completed = finishOralTurn(failure, first.assistant.id, { replyText: 'Great!' }, 400);
  assert.equal(completed.at(-1).isError, false);
  assert.equal(completed.at(-1).status, 'complete');
});

test('corrections schedule tomorrow and recalled reviews move forward without claiming mastery', () => {
  assert.equal(correctionFromFeedback({ hasSlip: false }, { id: 'a', scenarioId: 'daily', now: 1 }), null);
  const item = correctionFromFeedback({ hasSlip: true, userOriginal: 'I go yesterday.', corrected: 'I went yesterday.' }, { id: 'a', scenarioId: 'daily', now: 1 });
  assert.equal(item.nextReviewAt, 86400001);
  assert.equal(item.id, 'correction_a');
  const reviewed = reviewOralCorrection(item, true, 86400001);
  assert.equal(reviewed.nextReviewAt, 345600001);
  assert.equal(reviewed.reviewCount, 1);
  assert.equal(reviewed.status, 'review');
});
