import React, { useMemo, useState, useEffect } from 'react';
import HomeTodayView from './HomeTodayView';
import { StorageService } from '../services/storage';
import { buildNceReviewQueue } from '../services/nceReview';
import {
  buildDailyPlan,
  getWeeklyReview,
  saveDailyTaskState,
  activityTypeForTask,
} from '../services/studyPlan';
import { hasApiKey } from '../services/ai';
import { useToast } from './ui/toastContext';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了，学一点就好';
  if (hour < 11) return '早上好，先完成最重要的一小步';
  if (hour < 14) return '中午好，来一段轻量练习';
  if (hour < 18) return '下午好，把今天的学习接上';
  return '晚上好，用十分钟收好今天';
}

function readSnapshot() {
  const vocabulary = StorageService.getVocabulary();
  const progress = StorageService.getNceProgress();
  const stats = StorageService.getStudyStats();
  const articles = StorageService.getArticles();
  const courseEntries = Object.entries(progress)
    .filter(([, value]) => value && typeof value === 'object')
    .sort((a, b) => (b[1].lastStudiedAt || 0) - (a[1].lastStudiedAt || 0));
  const now = Date.now();
  const studyPlan = StorageService.getStudyPlan();
  const planInput = {
    vocabulary,
    nceProgress: progress,
    nceExams: StorageService.getNceExams(),
    appState: StorageService.getAppState(),
    stats,
    articles,
    studyPlan,
    dailyMinutes: studyPlan.dailyMinutes || 20,
    hasAiKey: hasApiKey(),
    courseUnits: StorageService.getNceCache().book?.units || [],
    events: StorageService.getStudyEvents(),
  };
  const generated = buildDailyPlan(planInput);
  if (!Array.isArray(studyPlan.days?.[generated.dateKey]?.tasks)) {
    const state = {
      ...generated.state,
      tasks: generated.tasks,
      createdAt: Date.now(),
    };
    const frozen = {
      ...studyPlan,
      days: { ...(studyPlan.days || {}), [generated.dateKey]: state },
    };
    if (StorageService.saveStudyPlan(frozen)) Object.assign(studyPlan, frozen);
  }
  return {
    vocabulary,
    progress,
    stats,
    articles,
    appState: StorageService.getAppState(),
    studyPlan,
    events: StorageService.getStudyEvents(),
    dueWords: vocabulary.filter(
      (word) =>
        !word.nextReviewDate || word.nextReviewDate <= now + 60 * 60 * 1000,
    ).length,
    totalWords: vocabulary.length,
    course: {
      started: courseEntries.length,
      completed: courseEntries.filter(
        ([, value]) => value.status === 'completed',
      ).length,
      latest: courseEntries[0] || null,
      reviewItems: buildNceReviewQueue(progress).length,
      examDraft: StorageService.getNceExams().draft,
    },
  };
}

export default function HomeDashboard({ onNavigate }) {
  const toast = useToast();
  const [snapshot, setSnapshot] = useState(readSnapshot);
  const [showWeekly, setShowWeekly] = useState(false);
  const [showDuration, setShowDuration] = useState(false);

  const plan = useMemo(
    () =>
      buildDailyPlan({
        now: new Date(),
        dailyMinutes: snapshot.studyPlan.dailyMinutes || 20,
        vocabulary: snapshot.vocabulary,
        nceProgress: snapshot.progress,
        nceExams: StorageService.getNceExams(),
        stats: snapshot.stats,
        articles: snapshot.articles,
        appState: snapshot.appState,
        studyPlan: snapshot.studyPlan,
        events: snapshot.events,
        hasAiKey: hasApiKey(),
        courseUnits: StorageService.getNceCache().book?.units || [],
      }),
    [snapshot],
  );

  const weekly = useMemo(
    () =>
      getWeeklyReview({
        overview: StorageService.getStudyOverview(7),
        stats: snapshot.stats,
        vocabulary: snapshot.vocabulary,
        nceProgress: snapshot.progress,
      }),
    [snapshot],
  );

  const remainingTasks = plan.tasks.filter(
    (task) => !task.done && !task.deferred,
  ).length;
  const completedCount = plan.tasks.filter((task) => task.done).length;
  const deferredCount = plan.tasks.filter(
    (task) => task.deferred && !task.done,
  ).length;
  // "Done" must mean done: deferring every task used to fall through to the same
  // remainingTasks === 0 branch and announce the day as finished while the progress bar
  // still read 0/3.
  const dayIsFinished =
    remainingTasks === 0 && deferredCount === 0 && plan.totalCount > 0;

  // First-run facts: is this still the built-in demo content, and can AI run at all?
  const usingSampleData = StorageService.isUsingSampleVocabulary();
  const [showDemoNotice, setShowDemoNotice] = useState(
    () =>
      StorageService.isUsingSampleVocabulary() &&
      !StorageService.hasSeenOnboarding('demoNoticeSeen'),
  );
  const hasKey = hasApiKey();

  const refresh = () => setSnapshot(readSnapshot());
  useEffect(() => {
    const refreshView = () => setSnapshot(readSnapshot());
    window.addEventListener('lingoflow:storage', refreshView);
    const timer = setInterval(refreshView, 30000);
    return () => {
      window.removeEventListener('lingoflow:storage', refreshView);
      clearInterval(timer);
    };
  }, []);

  const dismissDemoNotice = () => {
    StorageService.markOnboardingSeen('demoNoticeSeen');
    setShowDemoNotice(false);
  };

  const startWithMyOwnDeck = () => {
    if (
      !confirm(
        '清空示例生词与示例文章，从零开始建立你自己的词库？此操作不影响你的学习记录。',
      )
    )
      return;
    const cleared = StorageService.clearSampleData();
    StorageService.markOnboardingSeen('demoNoticeSeen');
    StorageService.markOnboardingSeen('sampleDataCleared');
    setShowDemoNotice(false);
    if (!cleared) {
      toast.error('清空失败（可能是浏览器存储不可写），请稍后重试。');
      return;
    }
    toast.success('示例数据已清空，现在收录的每一个词都是你自己的。');
    refresh();
  };

  const updateDuration = (minutes) => {
    const nextPlan = { ...snapshot.studyPlan, dailyMinutes: minutes };
    const dayKey = plan.dateKey;
    nextPlan.days = {
      ...nextPlan.days,
      [dayKey]: { ...nextPlan.days?.[dayKey], tasks: undefined },
    };
    if (!StorageService.saveStudyPlan(nextPlan)) {
      toast.error('学习时长没有保存成功。');
      return;
    }
    refresh();
    setShowDuration(false);
  };

  // Ticking a plan item is a real study action, so it must also feed the activity stream
  // that drives the streak, the weekly review and the activity calendar. Previously the
  // checkbox only wrote plan state, so a fully ticked day still showed "0 天有学习".
  const markTask = (task, status) => {
    const nextStudyPlan = saveDailyTaskState(
      snapshot.studyPlan,
      plan.dateKey,
      task.id,
      { status },
    );
    if (!StorageService.saveStudyPlan(nextStudyPlan)) {
      toast.error('任务状态没有保存成功，请重试。');
      return;
    }
    if (status === 'completed' && !task.done) {
      StorageService.recordStudyActivity({
        type: 'manual',
        metadata: {
          taskType: activityTypeForTask(task.type),
          selfReported: true,
        },
        count: 1,
        source: 'daily-plan',
        entityId: task.id,
        label: task.title,
      });
    }
    setSnapshot((current) => ({
      ...current,
      studyPlan: nextStudyPlan,
      stats: StorageService.getStudyStats(),
    }));
  };

  const openTask = (task) => {
    if (task.target === 'vocab')
      onNavigate('vocab', {
        section: 'vocab',
        wordIds: task.wordIds,
        taskId: task.id,
      });
    else if (task.target === 'oral') onNavigate('oral');
    else if (task.target === 'reader')
      onNavigate('reader', { articleId: task.entityId });
    else if (task.target === 'nce-exam') onNavigate('nce', { entry: 'exam' });
    else if (task.target === 'nce-review')
      onNavigate('nce', { entry: 'review', reviewIds: task.reviewIds });
    // Pass the lesson the plan actually picked: without it the module fell back to
    // `lastNceLesson` (written whenever a lesson is merely opened), so the card could say
    // "继续：第 9–10 课" and open a different lesson.
    else onNavigate('nce', { resume: true, lesson: task.entityId || '' });
  };

  return (
    <HomeTodayView
      snapshot={snapshot}
      plan={plan}
      weekly={weekly}
      greeting={getGreeting()}
      remainingTasks={remainingTasks}
      completedCount={completedCount}
      deferredCount={deferredCount}
      dayIsFinished={dayIsFinished}
      usingSampleData={usingSampleData}
      showDemoNotice={showDemoNotice}
      hasKey={hasKey}
      showWeekly={showWeekly}
      setShowWeekly={setShowWeekly}
      showDuration={showDuration}
      setShowDuration={setShowDuration}
      updateDuration={updateDuration}
      openTask={openTask}
      markTask={markTask}
      onNavigate={onNavigate}
      dismissDemoNotice={dismissDemoNotice}
      startWithMyOwnDeck={startWithMyOwnDeck}
      refresh={refresh}
    />
  );
}
