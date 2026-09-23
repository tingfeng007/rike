const MASTERY_KEYS = ['listenCompleted', 'dictationCompleted', 'vocabViewed', 'exercisesCompleted'];

export function getNceMastery(progress = {}) {
  const steps = MASTERY_KEYS.map((key) => Boolean(progress[key]));
  const examBonus = Number(progress.examBest || 0) >= 80;
  const completedSteps = steps.filter(Boolean).length;
  const score = Math.round(((completedSteps + (examBonus ? 1 : 0)) / 5) * 100);
  const weakAreas = MASTERY_KEYS.filter((key, index) => !steps[index]);
  if (progress.status === 'completed' && score >= 80) weakAreas.splice(0, weakAreas.length);
  return {
    score,
    steps,
    completedSteps,
    totalSteps: 5,
    examBonus,
    weakAreas,
    label: score >= 90 ? '掌握稳定' : score >= 60 ? '正在形成' : score > 0 ? '刚刚开始' : '未开始',
  };
}

export function getNceNextReviewAt(progress = {}, now = Date.now()) {
  if (progress.nextReviewAt) return progress.nextReviewAt;
  const mastery = getNceMastery(progress);
  if (mastery.score >= 90) return now + 7 * 24 * 60 * 60 * 1000;
  if (mastery.score >= 60) return now + 3 * 24 * 60 * 60 * 1000;
  if (mastery.score > 0) return now + 24 * 60 * 60 * 1000;
  return 0;
}

export function isNceReviewDue(progress = {}, now = Date.now()) {
  return Boolean(progress.nextReviewAt && progress.nextReviewAt <= now);
}

