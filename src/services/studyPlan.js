import { buildNceReviewQueue } from './nceReview.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function lessonLabel(filename = '') {
  return String(filename).replace(/^\d+&\d+\./, '') || '下一课';
}

function clampMinutes(value, minimum = 3) {
  return Math.max(minimum, Math.round(Number(value) || minimum));
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * Turn the event buckets into a compact, deterministic seven-day rhythm view.
 * Keeping this calculation outside the UI lets the dashboard stay presentational
 * and makes the local-first activity history easy to test and reuse.
 */
export function buildActivityCalendar({ now = new Date(), days = 7, byDay = {}, byDayMinutes = {} } = {}) {
  const totalDays = Math.max(1, Math.round(Number(days) || 7));
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (totalDays - index - 1));
    const dateKey = getDateKey(date);
    const actions = Math.max(0, Number(byDay[dateKey]) || 0);
    const minutes = Math.max(0, Number(byDayMinutes[dateKey]) || 0);

    return {
      dateKey,
      day: date.getDate(),
      weekday: WEEKDAY_LABELS[date.getDay()],
      actions,
      minutes,
      isToday: index === totalDays - 1,
      level: actions === 0 ? 0 : actions <= 2 ? 1 : actions <= 5 ? 2 : 3,
    };
  });
}

export function getDailyPlanState(studyPlan = {}, dateKey = getDateKey()) {
  const day = studyPlan.days?.[dateKey];
  return day && typeof day === 'object'
    ? day
    : { completedTaskIds: [], deferredTaskIds: [], createdAt: Date.now() };
}

export function saveDailyTaskState(studyPlan = {}, dateKey, taskId, patch = {}) {
  const current = getDailyPlanState(studyPlan, dateKey);
  const nextDay = {
    ...current,
    ...patch,
    completedTaskIds: Array.from(new Set(patch.completedTaskIds || current.completedTaskIds || [])),
    deferredTaskIds: Array.from(new Set(patch.deferredTaskIds || current.deferredTaskIds || [])),
    updatedAt: Date.now(),
  };
  if (patch.status === 'completed') {
    nextDay.completedTaskIds = Array.from(new Set([...nextDay.completedTaskIds, taskId]));
    nextDay.deferredTaskIds = nextDay.deferredTaskIds.filter((id) => id !== taskId);
  }
  if (patch.status === 'deferred') {
    nextDay.deferredTaskIds = Array.from(new Set([...nextDay.deferredTaskIds, taskId]));
    nextDay.completedTaskIds = nextDay.completedTaskIds.filter((id) => id !== taskId);
  }
  return {
    ...studyPlan,
    version: 1,
    days: { ...(studyPlan.days || {}), [dateKey]: nextDay },
  };
}

export function buildDailyPlan({
  now = new Date(),
  dailyMinutes = 20,
  vocabulary = [],
  nceProgress = {},
  nceExams = {},
  stats = {},
  articles = [],
  appState = {},
  studyPlan = {},
} = {}) {
  const dateKey = getDateKey(now);
  const state = getDailyPlanState(studyPlan, dateKey);
  const nowMs = now.getTime();
  const dueWords = vocabulary.filter((word) => !word.nextReviewDate || word.nextReviewDate <= nowMs + 60 * 60 * 1000);
  const reviewItems = buildNceReviewQueue(nceProgress);
  const lessonEntries = Object.entries(nceProgress)
    .filter(([, item]) => item && typeof item === 'object')
    .sort((a, b) => (b[1].lastStudiedAt || 0) - (a[1].lastStudiedAt || 0));
  const latestLesson = lessonEntries[0]?.[0] || '';
  const oralDone = (stats.todayOralCount || 0) >= 3;
  const courseDone = (stats.todayCourseCount || 0) > 0;
  const planMinutes = clampMinutes(dailyMinutes, 10);

  const tasks = [];
  if (dueWords.length > 0) {
    tasks.push({
      id: 'vocab-review',
      type: 'vocab',
      title: `复习 ${Math.min(dueWords.length, 12)} 个到期词`,
      description: dueWords.length > 12 ? `${dueWords.length} 个到期词，先完成最需要复习的一组` : '把今天到期的词重新想起来',
      minutes: clampMinutes(Math.min(8, Math.max(4, dueWords.length * 0.7))),
      target: 'vocab',
      count: dueWords.length,
    });
  }
  if (nceExams.draft) {
    tasks.push({
      id: 'nce-exam-draft',
      type: 'nce',
      title: '继续未交卷试题',
      description: `${nceExams.draft.title || '第一册单元测验'} · 答案已自动保留`,
      minutes: 8,
      target: 'nce-exam',
      count: 1,
    });
  } else if (reviewItems.length > 0) {
    tasks.push({
      id: 'nce-review',
      type: 'nce',
      title: `复盘 ${Math.min(reviewItems.length, 6)} 项课程薄弱内容`,
      description: '把听写、练习和试题错题重新答对',
      minutes: clampMinutes(Math.min(8, Math.max(5, reviewItems.length * 0.8))),
      target: 'nce-review',
      count: reviewItems.length,
    });
  } else {
    const nextLesson = latestLesson || Object.keys(nceProgress).find((id) => nceProgress[id]?.status !== 'completed') || '';
    tasks.push({
      id: 'nce-lesson',
      type: 'nce',
      title: nextLesson ? `继续：${lessonLabel(nextLesson)}` : '开始新概念第一册',
      description: '听一遍课文，再完成一小段主动练习',
      minutes: 8,
      target: 'nce',
      entityId: nextLesson,
      count: 1,
    });
  }
  if (!oralDone) {
    tasks.push({
      id: 'oral-practice',
      type: 'oral',
      title: `口语练习 ${Math.max(1, 3 - (stats.todayOralCount || 0))} 轮`,
      description: '把今天遇到的词放进真实表达里',
      minutes: 5,
      target: 'oral',
      count: Math.max(1, 3 - (stats.todayOralCount || 0)),
    });
  }
  if (tasks.length < 3 && articles.length > 0) {
    tasks.push({
      id: 'reader-session',
      type: 'reader',
      title: appState.lastReaderArticleId ? '继续精读文章' : '精读一段英文',
      description: '读完一段，收藏一个值得复用的句子',
      minutes: 6,
      target: 'reader',
      entityId: appState.lastReaderArticleId || articles[0]?.id || '',
      count: 1,
    });
  }

  const visibleTasks = [];
  let usedMinutes = 0;
  tasks.forEach((task) => {
    if (visibleTasks.length === 0 || usedMinutes + task.minutes <= planMinutes) {
      visibleTasks.push(task);
      usedMinutes += task.minutes;
    }
  });
  const adjustedTasks = visibleTasks.map((task, index) => ({
    ...task,
    order: index + 1,
    done: state.completedTaskIds.includes(task.id)
      || (task.id === 'vocab-review' && dueWords.length === 0)
      || (task.id === 'nce-review' && reviewItems.length === 0)
      || (task.id === 'oral-practice' && oralDone)
      || (task.id === 'nce-lesson' && courseDone),
    deferred: state.deferredTaskIds.includes(task.id),
  }));

  return {
    version: 1,
    dateKey,
    dailyMinutes: planMinutes,
    tasks: adjustedTasks,
    completedCount: adjustedTasks.filter((task) => task.done).length,
    totalCount: adjustedTasks.length,
    plannedMinutes: Math.min(planMinutes, usedMinutes),
    generatedAt: Date.now(),
    source: 'local-first',
    state,
    nextDayRefreshAt: new Date(nowMs + DAY_MS).setHours(0, 5, 0, 0),
  };
}

export function getWeeklyReview({ overview = {}, stats = {}, vocabulary = [], nceProgress = {}, now = new Date() } = {}) {
  const allProgress = Object.values(nceProgress).filter((item) => item && typeof item === 'object');
  const dueWords = vocabulary.filter((word) => !word.nextReviewDate || word.nextReviewDate <= now.getTime()).length;
  const reviewItems = buildNceReviewQueue(nceProgress).length;
  const byType = overview.byType || {};
  return {
    activeDays: overview.activeDays || 0,
    totalActions: overview.totalActions || 0,
    totalMinutes: overview.totalMinutes || 0,
    vocabReviews: byType.review || 0,
    vocabAdded: byType.vocab || 0,
    courseSessions: byType.course || 0,
    oralRounds: byType.oral || 0,
    readerNotes: byType.annotation || 0,
    nceCompleted: allProgress.filter((item) => item.status === 'completed').length,
    dueWords,
    reviewItems,
    activityCalendar: buildActivityCalendar({
      now,
      days: 7,
      byDay: overview.byDay || {},
      byDayMinutes: overview.byDayMinutes || {},
    }),
    streakDays: stats.streakDays || 0,
    recommendation: reviewItems > 0
      ? '先复盘新概念错题，再开始新课。'
      : dueWords > 0
        ? '先完成到期词复习，再用口语把它们说出来。'
        : '保持今天的节奏，继续完成一课听读和一轮口语。',
  };
}
