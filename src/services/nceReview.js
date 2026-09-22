import { scoreDictation } from './nce.js';

const SOURCES = [
  ['dictationMistakes', 'dictation', '听写'],
  ['exerciseMistakes', 'exercise', '课后练习'],
  ['examMistakes', 'exam', '单元试题'],
];

export function buildNceReviewQueue(progress, unitId = '') {
  const queue = [];
  Object.entries(progress || {}).forEach(([filename, record]) => {
    if (!record || typeof record !== 'object' || (unitId && filename !== unitId)) return;
    SOURCES.forEach(([field, kind, label]) => {
      if (!Array.isArray(record[field])) return;
      record[field].forEach((mistake) => {
        if (!mistake?.id) return;
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
          prompt: kind === 'dictation' ? '' : (mistake.question || mistake.sentence || ''),
          answer,
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

export function resolveNceReviewMistake(progress, item) {
  if (!SOURCES.some(([field]) => field === item?.field)) return progress;
  const record = progress?.[item.unitId];
  const mistakes = record?.[item.field];
  if (!Array.isArray(mistakes) || !mistakes.some((mistake) => mistake.id === item.mistakeId)) return progress;
  return {
    ...progress,
    [item.unitId]: {
      ...record,
      [item.field]: mistakes.filter((mistake) => mistake.id !== item.mistakeId),
      lastStudiedAt: Date.now(),
    },
  };
}
