import React, { useMemo, useState, useEffect } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Flame,
  GraduationCap,
  Headphones,
  FileText,
  Layers,
  MessageSquare,
  Settings,
  Sparkles,
  Timer,
} from 'lucide-react';
import { StorageService } from '../services/storage';
import { buildNceReviewQueue } from '../services/nceReview';
import { buildDailyPlan, getWeeklyReview, saveDailyTaskState, activityTypeForTask } from '../services/studyPlan';
import { hasApiKey } from '../services/ai';
import { useToast } from './ui/toastContext';
import { ApiKeyNotice } from './ui/ApiKeyNotice';

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
  const planInput = { vocabulary, nceProgress: progress, nceExams: StorageService.getNceExams(), appState: StorageService.getAppState(), stats, articles, studyPlan, dailyMinutes: studyPlan.dailyMinutes || 20, hasAiKey: hasApiKey(), courseUnits: StorageService.getNceCache().book?.units || [], events: StorageService.getStudyEvents() };
  const generated = buildDailyPlan(planInput);
  if (!Array.isArray(studyPlan.days?.[generated.dateKey]?.tasks)) {
    const state = { ...generated.state, tasks: generated.tasks, createdAt: Date.now() };
    const frozen = { ...studyPlan, days: { ...(studyPlan.days || {}), [generated.dateKey]: state } };
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
    dueWords: vocabulary.filter((word) => !word.nextReviewDate || word.nextReviewDate <= now + 60 * 60 * 1000).length,
    totalWords: vocabulary.length,
    course: {
      started: courseEntries.length,
      completed: courseEntries.filter(([, value]) => value.status === 'completed').length,
      latest: courseEntries[0] || null,
      reviewItems: buildNceReviewQueue(progress).length,
      examDraft: StorageService.getNceExams().draft,
    },
  };
}

function taskIcon(task) {
  if (task.type === 'vocab') return <Layers className="w-4 h-4" />;
  if (task.type === 'oral') return <MessageSquare className="w-4 h-4" />;
  if (task.type === 'reader') return <BookOpen className="w-4 h-4" />;
  if (task.id === 'nce-exam-draft') return <FileText className="w-4 h-4" />;
  if (task.id === 'nce-review') return <Sparkles className="w-4 h-4" />;
  return <Headphones className="w-4 h-4" />;
}

function taskTone(task) {
  if (task.type === 'vocab') return 'bg-rose-50 text-rose-600';
  if (task.type === 'oral') return 'bg-emerald-50 text-emerald-600';
  if (task.type === 'reader') return 'bg-amber-50 text-amber-600';
  return 'bg-sky-50 text-sky-600';
}

function activityTone(level, isToday) {
  const tones = [
    'bg-slate-100 text-slate-300',
    'bg-sky-100 text-sky-700',
    'bg-sky-300 text-[#102a43]',
    'bg-[#102a43] text-white',
  ];
  return `${tones[level] || tones[0]} ${isToday ? 'ring-2 ring-amber-300 ring-offset-2' : ''}`;
}

export default function HomeDashboard({ onNavigate }) {
  const toast = useToast();
  const [snapshot, setSnapshot] = useState(readSnapshot);
  const [showWeekly, setShowWeekly] = useState(false);
  const [showDuration, setShowDuration] = useState(false);

  const plan = useMemo(() => buildDailyPlan({
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
  }), [snapshot]);

  const weekly = useMemo(() => getWeeklyReview({
    overview: StorageService.getStudyOverview(7),
    stats: snapshot.stats,
    vocabulary: snapshot.vocabulary,
    nceProgress: snapshot.progress,
  }), [snapshot]);

  const remainingTasks = plan.tasks.filter((task) => !task.done && !task.deferred).length;
  const completedCount = plan.tasks.filter((task) => task.done).length;
  const deferredCount = plan.tasks.filter((task) => task.deferred && !task.done).length;
  // "Done" must mean done: deferring every task used to fall through to the same
  // remainingTasks === 0 branch and announce the day as finished while the progress bar
  // still read 0/3.
  const dayIsFinished = remainingTasks === 0 && deferredCount === 0 && plan.totalCount > 0;

  // First-run facts: is this still the built-in demo content, and can AI run at all?
  const usingSampleData = StorageService.isUsingSampleVocabulary();
  const [showDemoNotice, setShowDemoNotice] = useState(() => (
    StorageService.isUsingSampleVocabulary() && !StorageService.hasSeenOnboarding('demoNoticeSeen')
  ));
  const hasKey = hasApiKey();

  const refresh = () => setSnapshot(readSnapshot());
  useEffect(() => {
    const refreshView = () => setSnapshot(readSnapshot());
    window.addEventListener('lingoflow:storage', refreshView);
    const timer = setInterval(refreshView, 30000);
    return () => { window.removeEventListener('lingoflow:storage', refreshView); clearInterval(timer); };
  }, []);

  const dismissDemoNotice = () => {
    StorageService.markOnboardingSeen('demoNoticeSeen');
    setShowDemoNotice(false);
  };

  const startWithMyOwnDeck = () => {
    if (!confirm('清空示例生词与示例文章，从零开始建立你自己的词库？此操作不影响你的学习记录。')) return;
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
    nextPlan.days = { ...nextPlan.days, [dayKey]: { ...nextPlan.days?.[dayKey], tasks: undefined } };
    if (!StorageService.saveStudyPlan(nextPlan)) { toast.error('学习时长没有保存成功。'); return; }
    refresh();
    setShowDuration(false);
  };

  // Ticking a plan item is a real study action, so it must also feed the activity stream
  // that drives the streak, the weekly review and the activity calendar. Previously the
  // checkbox only wrote plan state, so a fully ticked day still showed "0 天有学习".
  const markTask = (task, status) => {
    const nextStudyPlan = saveDailyTaskState(snapshot.studyPlan, plan.dateKey, task.id, { status });
    if (!StorageService.saveStudyPlan(nextStudyPlan)) { toast.error('任务状态没有保存成功，请重试。'); return; }
    if (status === 'completed' && !task.done) {
      StorageService.recordStudyActivity({
        type: 'manual',
        metadata: { taskType: activityTypeForTask(task.type), selfReported: true },
        count: 1,
        source: 'daily-plan',
        entityId: task.id,
        label: task.title,
      });
    }
    setSnapshot((current) => ({ ...current, studyPlan: nextStudyPlan, stats: StorageService.getStudyStats() }));
  };

  const openTask = (task) => {
    if (task.target === 'vocab') onNavigate('vocab', { section: 'vocab', wordIds: task.wordIds, taskId: task.id });
    else if (task.target === 'oral') onNavigate('oral');
    else if (task.target === 'reader') onNavigate('reader', { articleId: task.entityId });
    else if (task.target === 'nce-exam') onNavigate('nce', { entry: 'exam' });
    else if (task.target === 'nce-review') onNavigate('nce', { entry: 'review', reviewIds: task.reviewIds });
    // Pass the lesson the plan actually picked: without it the module fell back to
    // `lastNceLesson` (written whenever a lesson is merely opened), so the card could say
    // "继续：第 9–10 课" and open a different lesson.
    else onNavigate('nce', { resume: true, lesson: task.entityId || '' });
  };

  return (
    <section className="study-page h-full overflow-y-auto pb-8">
      <div className="relative overflow-hidden px-5 pt-6 pb-8 bg-[#102a43] text-white">
        <div className="absolute -top-16 -right-12 w-48 h-48 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-40 h-24 bg-amber-300/10 blur-2xl" />
        <div className="relative flex items-center justify-between">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-sky-200">LINGOFLOW · TODAY</p>
          <button onClick={() => onNavigate('settings')} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-slate-200" aria-label="打开设置"><Settings className="w-4 h-4" /></button>
        </div>
        <h1 className="editorial-serif relative mt-3 text-[29px] leading-tight font-bold tracking-tight">{getGreeting()}</h1>
        <p className="relative mt-2 text-sm text-slate-300">
          {remainingTasks > 0
            ? `还剩 ${remainingTasks} 个学习动作，按顺序完成就好。${deferredCount ? `另有 ${deferredCount} 项已推迟。` : ''}`
            : deferredCount > 0
              ? `今天还有 ${deferredCount} 项被推迟到明天，已完成 ${completedCount}/${plan.totalCount} 项。`
              : '今天的学习闭环已完成，可以安心收工。'}
        </p>
        <div className="relative grid grid-cols-3 gap-2 mt-5">
          <div className="rounded-2xl bg-white/10 border border-white/10 p-3"><Flame className="w-4 h-4 text-amber-300 mb-2" /><p className="text-xl font-bold">{snapshot.stats.streakDays || 0}</p><p className="text-[10px] text-slate-300">连续学习天</p></div>
          <div className="rounded-2xl bg-white/10 border border-white/10 p-3"><Layers className="w-4 h-4 text-sky-300 mb-2" /><p className="text-xl font-bold">{snapshot.dueWords}</p><p className="text-[10px] text-slate-300">{usingSampleData ? '示例词到期' : '今日到期词'}</p></div>
          <div className="rounded-2xl bg-white/10 border border-white/10 p-3"><GraduationCap className="w-4 h-4 text-emerald-300 mb-2" /><p className="text-xl font-bold">{snapshot.course.reviewItems}</p><p className="text-[10px] text-slate-300">课程待复习</p></div>
        </div>
      </div>

      <div className="home-content px-4 -mt-3 relative z-10 space-y-4">
        {/* First run: the deck is demo content, so say so instead of presenting 30 due cards as
            the learner's own progress. */}
        {showDemoNotice && usingSampleData && (
          <div className="home-notice study-card paper-grain rounded-[24px] border border-amber-200 bg-amber-50/70 p-4">
            <p className="text-xs font-bold text-amber-900">👋 你现在看到的是示例内容</p>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
              内置换好了 <strong>30 个演示生词</strong> 与 <strong>8 篇示例文章</strong>，方便你先体验流程——它们不是你的学习记录。
              从「精读伴读」或「口语对练」里收藏的词才会进入你自己的词库。
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={startWithMyOwnDeck}
                className="flex-1 rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-amber-600"
              >
                清空示例，从零开始
              </button>
              <button
                type="button"
                onClick={dismissDemoNotice}
                className="flex-1 rounded-xl bg-white px-3 py-2 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200 transition-colors hover:bg-amber-100"
              >
                先保留，我看看
              </button>
            </div>
          </div>
        )}

        {/* The very first plan item is usually an AI task, so ask for the key up front instead of
            letting each module fail in its own way. */}
        {!hasKey && <ApiKeyNotice className="home-notice" onOpenSettings={() => onNavigate('settings')} />}
        <div className="home-plan study-card paper-grain rounded-[24px] p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div><p className="text-xs font-semibold tracking-wide text-slate-400">今日学习计划 · {plan.dailyMinutes} 分钟</p><h2 className="font-bold text-slate-900 mt-0.5">{remainingTasks ? '先做最重要的一步' : dayIsFinished ? '今天已经完成' : '今天还有推迟的项'}</h2></div>
            <div className="relative"><button type="button" onClick={() => setShowDuration((value) => !value)} className="inline-flex items-center gap-1 rounded-xl bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800"><Timer className="w-3.5 h-3.5" />时长<ChevronDown className="w-3 h-3" /></button>{showDuration && <div className="absolute right-0 top-9 z-20 flex gap-1 rounded-xl border border-amber-100 bg-white p-1.5 shadow-xl">{[10, 20, 30].map((minutes) => <button type="button" key={minutes} onClick={() => updateDuration(minutes)} className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${plan.dailyMinutes === minutes ? 'bg-[#102a43] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{minutes}分</button>)}</div>}</div>
          </div>
          <div className="mb-3 flex items-center gap-2" aria-label={`今日计划已完成 ${completedCount} 项，共 ${plan.totalCount} 项`}><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${plan.totalCount ? completedCount / plan.totalCount * 100 : 100}%` }} /></div><span className="text-[10px] font-semibold tabular-nums text-slate-400">{completedCount}/{plan.totalCount}</span></div>
          <div className="space-y-1">
            {plan.tasks.map((task) => (
              <div key={task.id} className={`home-task ${task.done ? 'opacity-75' : task.deferred ? 'opacity-60' : ''}`}>
                <button type="button" onClick={() => openTask(task)} className="flex min-w-0 items-start gap-3 text-left"><span className={`mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-xl ${task.done ? 'bg-emerald-100 text-emerald-700' : taskTone(task)}`}>{task.done ? <Check className="w-4 h-4" /> : taskIcon(task)}</span><span className="min-w-0 flex-1"><span className={`block text-sm font-semibold leading-6 ${task.done ? 'text-emerald-800' : 'text-slate-800'}`}>{task.title}</span><span className="home-task-description mt-1 block text-xs text-slate-500">{task.description}</span><span className="mt-2 block text-[11px] font-medium text-stone-500">约 {task.minutes} 分钟</span></span></button>
                {task.done ? <span className="text-xs font-semibold text-emerald-700">已完成</span> : <div className="flex flex-col items-end gap-2"><button type="button" onClick={() => openTask(task)} aria-label={`开始：${task.title}`} className="flex items-center gap-1 rounded-lg bg-[#102a43] px-3 py-2 text-xs font-semibold text-white">开始<ArrowRight className="w-3 h-3" /></button><button type="button" onClick={() => markTask(task, 'deferred')} aria-label={`稍后：${task.title}`} className="px-2 py-1.5 text-xs text-slate-500">稍后</button><button type="button" onClick={() => markTask(task, 'completed')} aria-label={`手动完成：${task.title}`} className="px-2 py-1.5 text-[11px] text-teal-700">手动完成</button></div>}
              </div>
            ))}
          </div>
          {plan.totalCount === 0 && <p className="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-500">今天暂时没有安排，去新概念或精读开始一小步吧。</p>}
        </div>

        <div className="study-card rounded-[24px] p-4">
          <button type="button" onClick={() => setShowWeekly((value) => !value)} className="flex w-full items-center justify-between text-left"><div><p className="text-xs font-semibold tracking-wide text-slate-400">近 7 天 · 学习回看</p><h2 className="font-bold text-slate-900 mt-0.5">{weekly.activeDays} 天有学习 · {weekly.totalActions} 个动作</h2></div><ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showWeekly ? 'rotate-180' : ''}`} /></button>
          {showWeekly && (
            <div className="mt-4 nce-reveal">
              <div className="mb-3 flex items-end justify-between">
                <div>
                  <p className="text-[10px] font-bold tracking-[0.14em] text-slate-400">STUDY RHYTHM</p>
                  <p className="mt-1 text-xs font-semibold text-slate-700">每天留下一点痕迹，比偶尔冲刺更有效</p>
                </div>
                <span className="text-[10px] text-slate-400">今天用金色圈出</span>
              </div>
              <div className="grid grid-cols-7 gap-1.5" aria-label="近七天学习节奏">
                {weekly.activityCalendar.map((day) => (
                  <div key={day.dateKey} className="flex min-w-0 flex-col items-center gap-1" title={`${day.dateKey} · ${day.actions} 个动作${day.minutes ? ` · ${day.minutes} 分钟` : ''}`}>
                    <span className={`flex h-9 w-full items-center justify-center rounded-xl text-[11px] font-bold transition-transform ${activityTone(day.level, day.isToday)}`}>
                      {day.actions || '·'}
                    </span>
                    <span className="text-[9px] text-slate-400">周{day.weekday}</span>
                    <span className={`text-[10px] tabular-nums ${day.isToday ? 'font-bold text-amber-700' : 'text-slate-400'}`}>{day.day}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                <div className="rounded-xl bg-sky-50 p-2.5"><strong className="block text-lg text-sky-700">{weekly.courseSessions}</strong><span className="text-[10px] text-slate-500">课程</span></div>
                <div className="rounded-xl bg-rose-50 p-2.5"><strong className="block text-lg text-rose-600">{weekly.vocabReviews}</strong><span className="text-[10px] text-slate-500">复习词</span></div>
                <div className="rounded-xl bg-emerald-50 p-2.5"><strong className="block text-lg text-emerald-700">{weekly.oralRounds}</strong><span className="text-[10px] text-slate-500">口语轮次</span></div>
                <div className="rounded-xl bg-amber-50 p-2.5"><strong className="block text-lg text-amber-700">{weekly.readerNotes}</strong><span className="text-[10px] text-slate-500">精读摘录</span></div>
              </div>
              <p className="mt-3 rounded-xl bg-[#f7f3ea] px-3 py-2.5 text-xs leading-5 text-slate-600">{weekly.recommendation}</p>
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400"><span>连续学习 {weekly.streakDays} 天</span><span>{weekly.totalMinutes ? `记录约 ${weekly.totalMinutes} 分钟` : '从今天开始积累真实记录'}</span></div>
            </div>
          )}
        </div>

        <div><p className="px-1 text-xs font-semibold tracking-wide text-slate-400 mb-2">快速进入</p><div className="grid grid-cols-2 gap-3"><button onClick={() => onNavigate('reader')} className="rounded-2xl bg-[#fffaf0] border border-amber-100 p-4 text-left"><BookOpen className="w-5 h-5 text-amber-600" /><p className="font-semibold text-slate-800 mt-3">精读文库</p><p className="text-xs text-slate-400 mt-1">{snapshot.articles.length} 篇文章</p></button><button onClick={() => onNavigate('vocab')} className="rounded-2xl bg-[#f2f8ff] border border-sky-100 p-4 text-left"><Layers className="w-5 h-5 text-sky-600" /><p className="font-semibold text-slate-800 mt-3">我的词库</p><p className="text-xs text-slate-400 mt-1">{snapshot.totalWords} 个词</p></button></div></div>
        <button type="button" onClick={() => onNavigate('vocab', { section: 'grammar' })} className="study-card flex items-center gap-3 rounded-2xl p-4 text-left"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-800"><Sparkles className="h-5 w-5" /></span><span className="min-w-0 flex-1"><strong className="block text-sm text-slate-800">语法实验室</strong><span className="mt-1 block text-xs leading-5 text-slate-500">从句子骨架，到方式、地点和时间的完整表达</span></span><ArrowRight className="h-4 w-4 shrink-0 text-slate-400" /></button>
        <p className="text-center text-[11px] text-slate-400 pb-2">所有学习记录默认保存在这台设备上 · {weekly.reviewItems ? `还有 ${weekly.reviewItems} 项课程复盘` : '学习状态正常'}</p>
        {snapshot.events.filter((event) => event.at > (snapshot.appState.lastExportAt || 0)).length >= 20 && <button type="button" onClick={() => onNavigate('settings')} className="block w-full rounded-xl bg-amber-50 p-3 text-xs text-amber-800">最近积累了新的学习记录，点此导出备份。</button>}
        <button type="button" onClick={refresh} className="mx-auto block text-[11px] text-slate-400 underline">刷新今日计划</button>
      </div>
    </section>
  );
}
