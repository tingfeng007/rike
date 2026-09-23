import React, { useMemo, useState } from 'react';
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
import { buildDailyPlan, getWeeklyReview, saveDailyTaskState } from '../services/studyPlan';

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
  return {
    vocabulary,
    progress,
    stats,
    articles,
    appState: StorageService.getAppState(),
    studyPlan: StorageService.getStudyPlan(),
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

export default function HomeDashboard({ onNavigate }) {
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
  }), [snapshot]);

  const weekly = useMemo(() => getWeeklyReview({
    overview: StorageService.getStudyOverview(7),
    stats: snapshot.stats,
    vocabulary: snapshot.vocabulary,
    nceProgress: snapshot.progress,
  }), [snapshot]);

  const remainingTasks = plan.tasks.filter((task) => !task.done && !task.deferred).length;
  const completedCount = plan.tasks.filter((task) => task.done).length;

  const refresh = () => setSnapshot(readSnapshot());

  const updateDuration = (minutes) => {
    const nextPlan = { ...snapshot.studyPlan, dailyMinutes: minutes };
    StorageService.saveStudyPlan(nextPlan);
    setSnapshot((current) => ({ ...current, studyPlan: nextPlan }));
    setShowDuration(false);
  };

  const markTask = (task, status) => {
    const nextStudyPlan = saveDailyTaskState(snapshot.studyPlan, plan.dateKey, task.id, { status });
    StorageService.saveStudyPlan(nextStudyPlan);
    setSnapshot((current) => ({ ...current, studyPlan: nextStudyPlan }));
  };

  const openTask = (task) => {
    if (task.target === 'vocab') onNavigate('vocab');
    else if (task.target === 'oral') onNavigate('oral');
    else if (task.target === 'reader') onNavigate('reader');
    else if (task.target === 'nce-exam') onNavigate('nce', { entry: 'exam' });
    else if (task.target === 'nce-review') onNavigate('nce', { entry: 'review' });
    else onNavigate('nce', { resume: true });
  };

  return (
    <section className="study-page h-full overflow-y-auto pb-28">
      <div className="relative overflow-hidden px-5 pt-6 pb-8 bg-[#102a43] text-white">
        <div className="absolute -top-16 -right-12 w-48 h-48 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-40 h-24 bg-amber-300/10 blur-2xl" />
        <div className="relative flex items-center justify-between">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-sky-200">LINGOFLOW · TODAY</p>
          <button onClick={() => onNavigate('settings')} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-slate-200" aria-label="打开设置"><Settings className="w-4 h-4" /></button>
        </div>
        <h1 className="editorial-serif relative mt-3 text-[29px] leading-tight font-bold tracking-tight">{getGreeting()}</h1>
        <p className="relative mt-2 text-sm text-slate-300">{remainingTasks > 0 ? `还剩 ${remainingTasks} 个学习动作，按顺序完成就好。` : '今天的学习闭环已完成，可以安心收工。'}</p>
        <div className="relative grid grid-cols-3 gap-2 mt-5">
          <div className="rounded-2xl bg-white/10 border border-white/10 p-3"><Flame className="w-4 h-4 text-amber-300 mb-2" /><p className="text-xl font-bold">{snapshot.stats.streakDays || 0}</p><p className="text-[10px] text-slate-300">连续学习天</p></div>
          <div className="rounded-2xl bg-white/10 border border-white/10 p-3"><Layers className="w-4 h-4 text-sky-300 mb-2" /><p className="text-xl font-bold">{snapshot.dueWords}</p><p className="text-[10px] text-slate-300">今日到期词</p></div>
          <div className="rounded-2xl bg-white/10 border border-white/10 p-3"><GraduationCap className="w-4 h-4 text-emerald-300 mb-2" /><p className="text-xl font-bold">{snapshot.course.reviewItems}</p><p className="text-[10px] text-slate-300">课程待复习</p></div>
        </div>
      </div>

      <div className="px-4 -mt-3 relative z-10 space-y-4">
        <div className="study-card paper-grain rounded-[24px] p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div><p className="text-xs font-semibold tracking-wide text-slate-400">今日学习计划 · {plan.dailyMinutes} 分钟</p><h2 className="font-bold text-slate-900 mt-0.5">{remainingTasks ? '先做最重要的一步' : '今天已经完成'}</h2></div>
            <div className="relative"><button type="button" onClick={() => setShowDuration((value) => !value)} className="inline-flex items-center gap-1 rounded-xl bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800"><Timer className="w-3.5 h-3.5" />时长<ChevronDown className="w-3 h-3" /></button>{showDuration && <div className="absolute right-0 top-9 z-20 flex gap-1 rounded-xl border border-amber-100 bg-white p-1.5 shadow-xl">{[10, 20, 30].map((minutes) => <button type="button" key={minutes} onClick={() => updateDuration(minutes)} className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${plan.dailyMinutes === minutes ? 'bg-[#102a43] text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{minutes}分</button>)}</div>}</div>
          </div>
          <div className="mb-3 flex items-center gap-2" aria-label={`今日计划已完成 ${completedCount} 项，共 ${plan.totalCount} 项`}><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${plan.totalCount ? completedCount / plan.totalCount * 100 : 100}%` }} /></div><span className="text-[10px] font-semibold tabular-nums text-slate-400">{completedCount}/{plan.totalCount}</span></div>
          <div className="space-y-1">
            {plan.tasks.map((task) => (
              <div key={task.id} className={`flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors ${task.done ? 'bg-emerald-50/60' : task.deferred ? 'bg-slate-50 opacity-60' : 'hover:bg-slate-50'}`}>
                <button type="button" onClick={() => openTask(task)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${task.done ? 'bg-emerald-100 text-emerald-700' : taskTone(task)}`}>{task.done ? <Check className="w-4 h-4" /> : taskIcon(task)}</span><span className="min-w-0 flex-1"><span className={`block truncate text-sm font-semibold ${task.done ? 'text-emerald-800 line-through decoration-emerald-300' : 'text-slate-800'}`}>{task.title}</span><span className="mt-0.5 block truncate text-xs text-slate-400">{task.description} · {task.minutes} 分钟</span></span></button>
                {task.done ? <span className="px-1 text-xs font-semibold text-emerald-600">完成</span> : <div className="flex flex-none items-center gap-1"><button type="button" onClick={() => markTask(task, 'completed')} className="rounded-lg px-1.5 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50">完成</button><button type="button" onClick={() => markTask(task, 'deferred')} className="rounded-lg px-1.5 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-100">稍后</button><ArrowRight className="w-4 h-4 text-slate-300" /></div>}
              </div>
            ))}
          </div>
          {plan.totalCount === 0 && <p className="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-500">今天暂时没有安排，去新概念或精读开始一小步吧。</p>}
        </div>

        <div className="study-card rounded-[24px] p-4">
          <button type="button" onClick={() => setShowWeekly((value) => !value)} className="flex w-full items-center justify-between text-left"><div><p className="text-xs font-semibold tracking-wide text-slate-400">近 7 天 · 学习回看</p><h2 className="font-bold text-slate-900 mt-0.5">{weekly.activeDays} 天有学习 · {weekly.totalActions} 个动作</h2></div><ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showWeekly ? 'rotate-180' : ''}`} /></button>
          {showWeekly && <div className="mt-4 nce-reveal"><div className="grid grid-cols-4 gap-2 text-center"><div className="rounded-xl bg-sky-50 p-2.5"><strong className="block text-lg text-sky-700">{weekly.courseSessions}</strong><span className="text-[10px] text-slate-500">课程</span></div><div className="rounded-xl bg-rose-50 p-2.5"><strong className="block text-lg text-rose-600">{weekly.vocabReviews}</strong><span className="text-[10px] text-slate-500">复习词</span></div><div className="rounded-xl bg-emerald-50 p-2.5"><strong className="block text-lg text-emerald-700">{weekly.oralRounds}</strong><span className="text-[10px] text-slate-500">口语轮次</span></div><div className="rounded-xl bg-amber-50 p-2.5"><strong className="block text-lg text-amber-700">{weekly.readerNotes}</strong><span className="text-[10px] text-slate-500">精读摘录</span></div></div><p className="mt-3 rounded-xl bg-[#f7f3ea] px-3 py-2.5 text-xs leading-5 text-slate-600">{weekly.recommendation}</p><div className="mt-3 flex items-center justify-between text-[11px] text-slate-400"><span>连续学习 {weekly.streakDays} 天</span><span>{weekly.totalMinutes ? `记录约 ${weekly.totalMinutes} 分钟` : '从今天开始积累真实记录'}</span></div></div>}
        </div>

        <div><p className="px-1 text-xs font-semibold tracking-wide text-slate-400 mb-2">快速进入</p><div className="grid grid-cols-2 gap-3"><button onClick={() => onNavigate('reader')} className="rounded-2xl bg-[#fffaf0] border border-amber-100 p-4 text-left"><BookOpen className="w-5 h-5 text-amber-600" /><p className="font-semibold text-slate-800 mt-3">精读文库</p><p className="text-xs text-slate-400 mt-1">{snapshot.articles.length} 篇文章</p></button><button onClick={() => onNavigate('vocab')} className="rounded-2xl bg-[#f2f8ff] border border-sky-100 p-4 text-left"><Layers className="w-5 h-5 text-sky-600" /><p className="font-semibold text-slate-800 mt-3">我的词库</p><p className="text-xs text-slate-400 mt-1">{snapshot.totalWords} 个词</p></button></div></div>
        <p className="text-center text-[11px] text-slate-400 pb-2">所有学习记录默认保存在这台设备上 · {weekly.reviewItems ? `还有 ${weekly.reviewItems} 项课程复盘` : '学习状态正常'}</p>
        <button type="button" onClick={refresh} className="mx-auto block text-[11px] text-slate-400 underline">刷新今日计划</button>
      </div>
    </section>
  );
}
