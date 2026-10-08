import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityCalendar, buildDailyPlan, getWeeklyReview, saveDailyTaskState, activityTypeForTask } from '../src/services/studyPlan.js';
import { getNceMastery, isNceReviewDue } from '../src/services/nceMastery.js';
import { formatDueDate } from '../src/services/studyView.js';

// --- V-07: the vocabulary screens must be able to say *when* a card comes back ---

test('formatDueDate turns a due timestamp into a readable day', () => {
  const now = new Date('2026-09-30T09:00:00').getTime();
  const day = 86400000;

  assert.equal(formatDueDate(now, now), '今天到期');
  assert.equal(formatDueDate(now + day, now), '明天');
  assert.equal(formatDueDate(now + 3 * day, now), '3 天后');
  assert.equal(formatDueDate(now + 30 * day, now), '30 天后', 'within a month stays relative');
  assert.equal(formatDueDate(now + 31 * day, now), '10月31日', 'beyond a month switches to a date');
  assert.equal(formatDueDate(now - day, now), '已到期', 'an overdue card is called out, not hidden');
  assert.equal(formatDueDate(now + 400 * day, now), '2027年11月4日', 'far future keeps the year');
});

test('formatDueDate is day-granular and never throws on junk', () => {
  const now = new Date('2026-09-30T23:30:00').getTime();
  // 40 minutes later is still "today" for the learner, even though it is a different date key
  // only for a moment — the label must not flip to "明天" while the card is due today.
  assert.equal(formatDueDate(now + 20 * 60000, now), '今天到期');

  assert.equal(formatDueDate(undefined, now), '待安排');
  assert.equal(formatDueDate(0, now), '待安排');
  assert.equal(formatDueDate('not-a-date', now), '待安排');
  assert.equal(formatDueDate(null, now), '待安排');
});

// --- Q-05: ticking a plan item must feed the same activity stream as doing the work ---

test('every daily-plan task type maps to an activity type the stats understand', () => {
  // These are the activity types the streak / weekly review / activity calendar consume.
  const known = new Set(['review', 'oral', 'reader', 'course']);
  for (const taskType of ['vocab', 'oral', 'reader', 'nce']) {
    const mapped = activityTypeForTask(taskType);
    assert.ok(known.has(mapped), `${taskType} maps to a known activity type, got ${mapped}`);
  }
  assert.equal(activityTypeForTask('vocab'), 'review', 'the vocab plan item is a review task');
  assert.equal(activityTypeForTask('nce'), 'course');
  assert.equal(activityTypeForTask('unknown-type'), 'review', 'unknown types fall back safely');
});

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

test('daily plan schedules an overdue course recall and verifies only its explicit completion event', () => {
  const now = new Date('2026-10-08T09:00:00');
  const first = buildDailyPlan({ now, hasAiKey: false, nceProgress: { unit: { status: 'completed', nextReviewAt: 1 } } });
  const task = first.tasks.find((item) => item.id === 'nce-course-recall');
  assert.equal(task.entityId, 'unit');
  const studyPlan = { days: { [first.dateKey]: { tasks: first.tasks, createdAt: now.getTime(), completedTaskIds: [], deferredTaskIds: [] } } };
  const events = [{ at: now.getTime() + 1, type: 'course', entityId: 'unit', source: 'nce-exercise' }];
  assert.equal(buildDailyPlan({ now, studyPlan, events }).tasks[0].done, false);
  events.push({ at: now.getTime() + 2, type: 'course', entityId: 'unit', source: 'nce-course-recall' });
  assert.equal(buildDailyPlan({ now, studyPlan, events }).tasks[0].done, true);
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
    dictationBest: 100,
    exerciseScore: 5,
    exerciseTotal: 5,
    nextReviewAt: 100,
  };
  const mastery = getNceMastery(progress);
  assert.equal(mastery.score, 100);
  assert.equal(mastery.label, '掌握稳定');
  assert.equal(isNceReviewDue(progress, 101), true);
});

test('zero-score work and merely viewing vocabulary do not establish mastery', () => {
  const mastery = getNceMastery({ listenCompleted: true, vocabViewed: true, dictationCompleted: true, dictationBest: 0, exercisesCompleted: true, exerciseScore: 0, exerciseTotal: 5 });
  assert.equal(mastery.score, 0);
  assert.equal(mastery.progressPercent, 100);
  assert.ok(mastery.weakAreas.includes('dictationCompleted'));
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


test('frozen daily tasks keep completed work and ignore unrelated course events', () => {
  const now = new Date('2026-09-30T09:00:00');
  const first = buildDailyPlan({ now, vocabulary: [{ id: 'w1', nextReviewDate: 1 }], hasAiKey: false });
  const state = { days: { [first.dateKey]: { tasks: first.tasks, createdAt: now.getTime(), completedTaskIds: [], deferredTaskIds: [] } } };
  const after = buildDailyPlan({ now, vocabulary: [], studyPlan: state, events: [{ type: 'review', entityId: 'w1', at: now.getTime()+1, metadata: {quality:'good'} }] });
  assert.equal(after.tasks[0].id, 'vocab-review');
  assert.equal(after.tasks[0].done, true);
  assert.equal(after.totalCount, first.totalCount);
  assert.ok(!first.tasks.some((task) => task.type === 'oral'));
});
