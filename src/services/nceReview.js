import { scoreDictation } from './nce.js';

const SOURCES = [
  ['dictationMistakes', 'dictation', '听写'],
  ['exerciseMistakes', 'exercise', '课后练习'],
  ['examMistakes', 'exam', '单元试题'],
];

export function buildNceReviewQueue(progress, unitId = '', now = Date.now()) {
  const queue = [];
  Object.entries(progress || {}).forEach(([filename, record]) => {
    if (!record || typeof record !== 'object' || (unitId && filename !== unitId)) return;
    SOURCES.forEach(([field, kind, label]) => {
      if (!Array.isArray(record[field])) return;
      record[field].forEach((mistake) => {
        if (!mistake?.id || mistake.recheckAt > now) return;
        const answer = kind === 'dictation' ? mistake.text : mistake.answer;
        if (!answer) return;
        queue.push({
          id: `${filename}:${kind}:${mistake.id}`,
          mistakeId: mistake.id,
          unitId: filename,
          unitTitle: filename.replace(/^\d+&\d+\./, ''),
          kind,
          field,
          label,
          // For dictation the prompt stays empty on purpose: showing the sentence would give
          // the answer away before the retry. Use `sourceText` only for "回到该句".
          prompt: kind === 'dictation' ? '' : (mistake.question || mistake.sentence || ''),
          answer,
          // Traceability back to the exact lesson line (older records have neither field).
          lineId: mistake.lineId || '',
          sourceText: mistake.sourceText || mistake.text || '',
          lastAttempt: mistake.submitted || mistake.attempt || '',
          updatedAt: mistake.updatedAt || record.lastStudiedAt || 0,
        });
      });
    });
  });
  return queue.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export function gradeNceReview(item, attempt) {
  const result = scoreDictation(item.answer, attempt);
  return { ...result, correct: Boolean(result.attemptWords.length) && result.score >= 90 };
}

export function resolveNceReviewMistake(progress, item, now = Date.now()) {
  if (!SOURCES.some(([field]) => field === item?.field)) return progress;
  const record = progress?.[item.unitId];
  const mistakes = record?.[item.field];
  if (!Array.isArray(mistakes) || !mistakes.some((mistake) => mistake.id === item.mistakeId)) return progress;
  if (mistakes.find((mistake) => mistake.id === item.mistakeId)?.recheckAt > now) return progress;
  return {
    ...progress,
    [item.unitId]: {
      ...record,
      [item.field]: mistakes.flatMap((mistake) => {
        if (mistake.id !== item.mistakeId) return [mistake];
        const successes = (mistake.recallSuccesses || 0) + 1;
        if (successes >= 3) return [];
        return [{ ...mistake, recallSuccesses: successes, resolvedAt: now, recheckAt: now + (successes === 1 ? 1 : 3) * 86400000 }];
      }),
      lastStudiedAt: Date.now(),
    },
  };
}
