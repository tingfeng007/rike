import { getNceMastery, getNceNextReviewAt } from './nceMastery.js';

/** Write progress and its completion event before publishing the next UI state. */
export function commitNceProgress(current, filename, patch, { persist, recordActivity, activity, now = Date.now() } = {}) {
  if (!filename || typeof persist !== 'function') return null;
  const previous = current || {};
  const merged = { ...(previous[filename] || {}), ...patch };
  const mastery = getNceMastery(merged);
  const next = {
    ...previous,
    [filename]: {
      ...merged,
      masteryScore: mastery.score,
      nextReviewAt: merged.nextReviewAt || (mastery.score > 0 ? getNceNextReviewAt(merged, now) : 0),
      lastStudiedAt: now,
    },
  };
  if (!persist(next)) return null;
  if (activity && !recordActivity?.(activity)) {
    persist(previous);
    return null;
  }
  return next;
}

// A question contributes at most once, even when the last question is retried.
export function countCorrectNceAnswers(questions, answers = {}) {
  return questions.filter((question) => answers[question.id] === true).length;
}

export function recordFirstNceAnswer(answers, questionId, correct) {
  return Object.hasOwn(answers, questionId) ? answers : { ...answers, [questionId]: Boolean(correct) };
}
