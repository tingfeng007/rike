export function applyGrammarAnswer(progress, { patternId, correct, questionId = '', sentence = '', at = Date.now() } = {}) {
  const base = progress && typeof progress === 'object' ? progress : {};
  const answers = { ...(base.answers || {}) };
  const key = patternId || 'unknown';
  const current = answers[key] || { correct: 0, total: 0 };
  answers[key] = {
    correct: current.correct + (correct ? 1 : 0),
    total: current.total + 1,
  };

  const missed = Array.isArray(base.missed) ? [...base.missed] : [];
  if (!correct && questionId) {
    const existingIndex = missed.findIndex((item) => item.questionId === questionId);
    const entry = { questionId, sentence, patternId: key, at };
    if (existingIndex >= 0) missed[existingIndex] = entry;
    else missed.unshift(entry);
  } else if (correct && questionId) {
    const index = missed.findIndex((item) => item.questionId === questionId);
    if (index >= 0) missed.splice(index, 1);
  }

  const totalAnswered = Object.values(answers).reduce((sum, item) => sum + item.total, 0);
  const totalCorrect = Object.values(answers).reduce((sum, item) => sum + item.correct, 0);

  return {
    answers,
    missed: missed.slice(0, 50),
    totalAnswered,
    totalCorrect,
    accuracy: totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0,
    updatedAt: at,
  };
}
