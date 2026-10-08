const MASTERY_KEYS = ['listenCompleted', 'dictationCompleted', 'vocabViewed', 'exercisesCompleted'];

export function getNceMastery(progress = {}) {
  const steps = MASTERY_KEYS.map((key) => Boolean(progress[key]));
  const examBonus = Number(progress.examBest || 0) >= 80;
  const completedSteps = steps.filter(Boolean).length;
  const dictation = Math.min(100, Math.max(0, Number(progress.dictationBest) || 0));
  const exercises = progress.exerciseTotal > 0 ? Math.min(100, 100 * (Number(progress.exerciseScore) || 0) / progress.exerciseTotal) : 0;
  const score = Math.round(dictation * 0.4 + exercises * 0.4 + (examBonus ? 20 : 0));
  const weakAreas = [];
  if (dictation < 80) weakAreas.push('dictationCompleted');
  if (exercises < 80) weakAreas.push('exercisesCompleted');
  if (!examBonus) weakAreas.push('exam');
  if ((progress.dictationMistakes?.length || 0) + (progress.exerciseMistakes?.length || 0) + (progress.examMistakes?.length || 0) > 0) weakAreas.push('mistakes');
  return {
    score,
    progressPercent: Math.round(completedSteps / MASTERY_KEYS.length * 100),
    steps,
    completedSteps,
    totalSteps: 5,
    examBonus,
    weakAreas,
    label: score >= 90 ? '掌握稳定' : score >= 60 ? '正在形成' : score > 0 ? '刚刚开始' : '未开始',
  };
}

export function getNceNextReviewAt(progress = {}, now = Date.now()) {
  const mastery = getNceMastery(progress);
  if (mastery.score >= 90) return now + 7 * 24 * 60 * 60 * 1000;
  if (mastery.score >= 60) return now + 3 * 24 * 60 * 60 * 1000;
  if (mastery.score > 0) return now + 24 * 60 * 60 * 1000;
  return 0;
}

// A completed recall uses this session's evidence, never the historical best score.
export function completeNceRecall(progress = {}, { score, now = Date.now(), sessionId = '' } = {}) {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore) || numericScore < 80 || !sessionId || progress.lastRecallSessionId === sessionId) return null;
  const intervalDays = numericScore >= 95 ? 7 : numericScore >= 90 ? 3 : 1;
  return {
    ...progress,
    lastReviewAt: now,
    lastRecallScore: Math.min(100, numericScore),
    lastRecallSessionId: sessionId,
    nextReviewAt: now + intervalDays * 86400000,
  };
}

export function isNceReviewDue(progress = {}, now = Date.now()) {
  return Boolean(progress.nextReviewAt && progress.nextReviewAt <= now);
}

