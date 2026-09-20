import React, { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Flame,
  GraduationCap,
  Headphones,
  Layers,
  MessageSquare,
  Settings,
  Sparkles,
} from 'lucide-react';
import { StorageService } from '../services/storage';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了，学一点就好';
  if (hour < 11) return '早上好，先完成最重要的一小步';
  if (hour < 14) return '中午好，来一段轻量练习';
  if (hour < 18) return '下午好，把今天的学习接上';
  return '晚上好，用十分钟收好今天';
}

function readCourseSnapshot() {
  const progress = StorageService.getNceProgress();
  const entries = Object.entries(progress)
    .filter(([, value]) => value && typeof value === 'object')
    .sort((a, b) => (b[1].lastStudiedAt || 0) - (a[1].lastStudiedAt || 0));
  return {
    started: entries.length,
    completed: entries.filter(([, value]) => value.status === 'completed').length,
    latest: entries[0] || null,
  };
}

export default function HomeDashboard({ onNavigate }) {
  const [snapshot] = useState(() => {
    const words = StorageService.getVocabulary();
    const now = Date.now();
    const dueWords = words.filter((word) => !word.nextReviewDate || word.nextReviewDate <= now).length;
    return {
      stats: StorageService.getStudyStats(),
      dueWords,
      totalWords: words.length,
      articles: StorageService.getArticles().length,
      course: readCourseSnapshot(),
    };
  });

  const taskCount = [
    snapshot.dueWords > 0,
    (snapshot.stats.todayCourseCount || 0) === 0,
    (snapshot.stats.todayOralCount || 0) < 3,
  ].filter(Boolean).length;

  return (
    <section className="h-full overflow-y-auto pb-28 bg-[#f7f5ef]">
      <div className="relative overflow-hidden px-5 pt-6 pb-8 bg-[#102a43] text-white">
        <div className="absolute -top-16 -right-12 w-48 h-48 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-40 h-24 bg-amber-300/10 blur-2xl" />
        <div className="relative flex items-center justify-between">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-sky-200">LINGOFLOW · TODAY</p>
          <button onClick={() => onNavigate('settings')} className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-slate-200" aria-label="打开设置"><Settings className="w-4 h-4" /></button>
        </div>
        <h1 className="relative mt-3 text-[27px] leading-tight font-bold tracking-tight">{getGreeting()}</h1>
        <p className="relative mt-2 text-sm text-slate-300">今天只做 {taskCount} 件事，完成比做多更重要。</p>

        <div className="relative grid grid-cols-3 gap-2 mt-5">
          <div className="rounded-2xl bg-white/10 border border-white/10 p-3">
            <Flame className="w-4 h-4 text-amber-300 mb-2" />
            <p className="text-xl font-bold">{snapshot.stats.streakDays || 0}</p>
            <p className="text-[10px] text-slate-300">连续学习天</p>
          </div>
          <div className="rounded-2xl bg-white/10 border border-white/10 p-3">
            <Layers className="w-4 h-4 text-sky-300 mb-2" />
            <p className="text-xl font-bold">{snapshot.dueWords}</p>
            <p className="text-[10px] text-slate-300">今日到期词</p>
          </div>
          <div className="rounded-2xl bg-white/10 border border-white/10 p-3">
            <GraduationCap className="w-4 h-4 text-emerald-300 mb-2" />
            <p className="text-xl font-bold">{snapshot.course.completed}</p>
            <p className="text-[10px] text-slate-300">已完成单元</p>
          </div>
        </div>
      </div>

      <div className="px-4 -mt-3 relative z-10 space-y-4">
        <div className="rounded-[22px] bg-white border border-[#e7e2d8] shadow-[0_8px_24px_rgba(53,45,30,0.08)] p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-slate-400">今日 10 分钟</p>
              <h2 className="font-bold text-slate-900 mt-0.5">按顺序完成这三步</h2>
            </div>
            <Sparkles className="w-5 h-5 text-amber-500" />
          </div>

          <button onClick={() => onNavigate('vocab')} className="w-full flex items-center gap-3 py-3 border-b border-slate-100 text-left">
            <span className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center"><Layers className="w-4 h-4" /></span>
            <span className="flex-1"><span className="block text-sm font-semibold text-slate-800">复习到期词</span><span className="block text-xs text-slate-400 mt-0.5">{snapshot.dueWords > 0 ? `${snapshot.dueWords} 个正在等你` : '今天已没有到期词'}</span></span>
            {snapshot.dueWords === 0 ? <span className="text-xs font-semibold text-emerald-600">完成</span> : <ArrowRight className="w-4 h-4 text-slate-300" />}
          </button>

          <button onClick={() => onNavigate('nce', { resume: true })} className="w-full flex items-center gap-3 py-3 border-b border-slate-100 text-left">
            <span className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center"><Headphones className="w-4 h-4" /></span>
            <span className="flex-1"><span className="block text-sm font-semibold text-slate-800">继续新概念第一册</span><span className="block text-xs text-slate-400 mt-0.5">{snapshot.course.latest ? `最近：${snapshot.course.latest[0].replace(/^\d+&\d+\./, '')}` : '从第一课开始，听读并完成练习'}</span></span>
            {(snapshot.stats.todayCourseCount || 0) > 0 ? <span className="text-xs font-semibold text-emerald-600">完成</span> : <ArrowRight className="w-4 h-4 text-slate-300" />}
          </button>

          <button onClick={() => onNavigate('oral')} className="w-full flex items-center gap-3 pt-3 text-left">
            <span className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><MessageSquare className="w-4 h-4" /></span>
            <span className="flex-1"><span className="block text-sm font-semibold text-slate-800">完成 3 轮口语</span><span className="block text-xs text-slate-400 mt-0.5">用今天学到的词说出来</span></span>
            {(snapshot.stats.todayOralCount || 0) >= 3 ? <span className="text-xs font-semibold text-emerald-600">完成</span> : <ArrowRight className="w-4 h-4 text-slate-300" />}
          </button>
        </div>

        <div>
          <p className="px-1 text-xs font-semibold tracking-wide text-slate-400 mb-2">快速进入</p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => onNavigate('reader')} className="rounded-2xl bg-[#fffaf0] border border-amber-100 p-4 text-left">
              <BookOpen className="w-5 h-5 text-amber-600" />
              <p className="font-semibold text-slate-800 mt-3">精读文库</p>
              <p className="text-xs text-slate-400 mt-1">{snapshot.articles} 篇文章</p>
            </button>
            <button onClick={() => onNavigate('vocab')} className="rounded-2xl bg-[#f2f8ff] border border-sky-100 p-4 text-left">
              <Layers className="w-5 h-5 text-sky-600" />
              <p className="font-semibold text-slate-800 mt-3">我的词库</p>
              <p className="text-xs text-slate-400 mt-1">{snapshot.totalWords} 个词</p>
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-400 pb-2">所有学习记录默认保存在这台设备上</p>
      </div>
    </section>
  );
}
