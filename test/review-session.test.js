import test from 'node:test';
import assert from 'node:assert/strict';
import { selectReviewSession } from '../src/services/reviewSession.js';

test('review session honours the plan targets and prioritises overdue vocabulary', () => {
  const words = [{ id: 'new', nextReviewDate: 100 }, { id: 'old', nextReviewDate: 1 }, { id: 'future', nextReviewDate: 99999999 }];
  assert.deepEqual(selectReviewSession(words, { size: 1, now: 100 }).map((word) => word.id), ['old']);
  assert.deepEqual(selectReviewSession(words, { wordIds: ['new', 'old'], size: 20 }).map((word) => word.id), ['new', 'old']);
});
