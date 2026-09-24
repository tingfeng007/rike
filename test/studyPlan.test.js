import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityCalendar, buildDailyPlan, getWeeklyReview, saveDailyTaskState } from '../src/services/studyPlan.js';
import { getNceMastery, isNceReviewDue } from '../src/services/nceMastery.js';

test('daily plan prioritizes due vocabulary, course review and unfinished oral practice', () => {
  const now = new Date('2026-09-23T09:00:00');
  const plan = buildDailyPlan({
    now,
    dailyMinutes: 20,
    vocabulary: [{ id: 'w1', word: 'handbag', nextReviewDate: now.getTime() - 1 }],
    nceProgress: { '001&002.Excuse Me': { exerciseMistakes: [{ id: 'm1', sentence: 'Is this ___?', answer: 'handbag' }] } },
    stats: { todayOralCount: 1 },
    articles: [{ id: 'article-1' }],
  });

  assert.equal(plan.dateKey, '2026-09-23');
  assert.equal(plan.tasks[0].id, 'vocab-review');
  assert.ok(plan.tasks.some((task) => task.id === 'nce-review'));
  assert.ok(plan.tasks.some((task) => task.id === 'oral-practice'));
  assert.ok(plan.tasks.every((task) => task.minutes >= 3));
});

test('daily plan persists completion and deferral without losing other days', () => {
  const first = saveDailyTaskState({}, '2026-09-23', 'vocab-review', { status: 'completed' });
  const second = saveDailyTaskState(first, '2026-09-23', 'oral-practice', { status: 'deferred' });
  const third = saveDailyTaskState(second, '2026-09-24', 'reader-session', { status: 'completed' });

  assert.deepEqual(third.days['2026-09-23'].completedTaskIds, ['vocab-review']);
  assert.deepEqual(third.days['2026-09-23'].deferredTaskIds, ['oral-practice']);
  assert.deepEqual(third.days['2026-09-24'].completedTaskIds, ['reader-session']);
});

test('NCE mastery combines four learning steps with exam bonus and due review', () => {
  const progress = {
    listenCompleted: true,
    dictationCompleted: true,
    vocabViewed: true,
    exercisesCompleted: true,
    examBest: 86,
    nextReviewAt: 100,
  };
  const mastery = getNceMastery(progress);
  assert.equal(mastery.score, 100);
  assert.equal(mastery.label, '掌握稳定');
  assert.equal(isNceReviewDue(progress, 101), true);
});

test('weekly review exposes real event buckets and an actionable recommendation', () => {
  const review = getWeeklyReview({
    overview: { activeDays: 3, totalActions: 12, totalMinutes: 28, byType: { review: 8, oral: 3, course: 1 } },
    stats: { streakDays: 3 },
    vocabulary: [{ nextReviewDate: 1 }],
    nceProgress: { lesson: { examMistakes: [{ id: 'q1', question: 'Q', answer: 'A' }] } },
  });
  assert.equal(review.activeDays, 3);
  assert.equal(review.vocabReviews, 8);
  assert.equal(review.oralRounds, 3);
  assert.equal(review.activityCalendar.length, 7);
  assert.match(review.recommendation, /复盘/);
});

test('activity calendar fills quiet days and marks the current day', () => {
  const calendar = buildActivityCalendar({
    now: new Date('2026-09-24T09:00:00'),
    days: 3,
    byDay: { '2026-09-22': 1, '2026-09-24': 7 },
    byDayMinutes: { '2026-09-24': 12 },
  });

  assert.deepEqual(calendar.map((day) => day.dateKey), ['2026-09-22', '2026-09-23', '2026-09-24']);
  assert.deepEqual(calendar.map((day) => day.actions), [1, 0, 7]);
  assert.equal(calendar[0].level, 1);
  assert.equal(calendar[1].level, 0);
  assert.equal(calendar[2].isToday, true);
  assert.equal(calendar[2].minutes, 12);
});
