import React, { lazy, Suspense, useState, useEffect } from 'react';
import {
  Home,
  MessageSquare,
  BookOpen,
  Layers,
  GraduationCap,
} from 'lucide-react';
import HomeDashboard from './components/HomeDashboard';
import ErrorBoundary from './components/ErrorBoundary';
import { StorageService } from './services/storage';

const OralCoach = lazy(() => import('./components/OralCoach'));
const SmartReader = lazy(() => import('./components/SmartReader'));
const VocabularySRS = lazy(() => import('./components/VocabularySRS'));
const Settings = lazy(() => import('./components/Settings'));
const NewConcept = lazy(() => import('./components/NewConcept'));

const VALID_TABS = new Set(['home', 'oral', 'reader', 'nce', 'vocab', 'settings']);

function PageFallback() {
  return (
    <div className="h-full flex items-center justify-center text-sm text-slate-400">
      <span className="w-5 h-5 mr-2 rounded-full border-2 border-slate-200 border-t-sky-500 animate-spin" />
      正在打开学习空间…
    </div>
  );
}

function countDueWords() {
  const now = Date.now();
  return StorageService.getVocabulary().filter(
    (word) => !word.nextReviewDate || word.nextReviewDate <= now + 60 * 60 * 1000
  ).length;
}

export default function App() {
  const [activeTab, setActiveTab] = useState(() => {
    const saved = StorageService.getAppState().activeTab;
    return VALID_TABS.has(saved) ? saved : 'home';
  });
  const [dueVocabCount, setDueVocabCount] = useState(() => countDueWords());
  const [nceResumeLesson, setNceResumeLesson] = useState('');
  const [nceEntryIntent, setNceEntryIntent] = useState('');
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [showOnlineToast, setShowOnlineToast] = useState(false);

  useEffect(() => {
    StorageService.ensureSchema();
  }, []);

  // Online / Offline Detection
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setShowOnlineToast(true);
      setTimeout(() => setShowOnlineToast(false), 3000);
    };
    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const navigate = (tab, options = {}) => {
    if (!VALID_TABS.has(tab)) return;
    if (tab === 'nce') {
      setNceResumeLesson(options.resume ? (StorageService.getAppState().lastNceLesson || '') : '');
      setNceEntryIntent(options.entry === 'review' || options.entry === 'exam' ? options.entry : '');
    }
    setActiveTab(tab);
    StorageService.saveAppState({ ...StorageService.getAppState(), activeTab: tab });
  };

  // Check how many cards are due today for review
  const updateDueCount = () => {
    setDueVocabCount(countDueWords());
  };

  useEffect(() => {
    const interval = setInterval(updateDueCount, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="study-page flex flex-col h-[100dvh] w-full max-w-md mx-auto overflow-hidden font-sans shadow-2xl relative">
      {/* Background Subtle Gradient Atmosphere */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-sky-200/25 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-24 w-80 h-80 bg-[#dfeaf1]/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 left-1/4 w-72 h-72 bg-amber-100/25 rounded-full blur-3xl" />
      </div>

      {/* Offline / Online Status Toast Bar */}
      {isOffline && (
        <div className="flex-none bg-amber-500/95 text-white text-[11px] font-medium py-1 px-3 flex items-center justify-center gap-1.5 shadow-xs z-50 animate-fade-in select-none">
          <span>✈️ 离线模式：本地文章、闪卡与笔记完整可用</span>
        </div>
      )}
      {showOnlineToast && !isOffline && (
        <div className="flex-none bg-emerald-600 text-white text-[11px] font-medium py-1 px-3 flex items-center justify-center gap-1.5 shadow-xs z-50 animate-fade-in select-none">
          <span>🌐 网络已恢复连接，AI 能力已就绪</span>
        </div>
      )}

      {/* Main View Container */}
      <main className="flex-1 overflow-hidden relative z-10">
        <ErrorBoundary key={activeTab}>
        <Suspense fallback={<PageFallback />}>
          {activeTab === 'home' && <HomeDashboard onNavigate={navigate} />}
          {activeTab === 'oral' && (
            <OralCoach onNavigateToVocab={() => navigate('vocab')} />
          )}
          {activeTab === 'reader' && <SmartReader />}
          {activeTab === 'nce' && <NewConcept resumeLesson={nceResumeLesson} entryIntent={nceEntryIntent} />}
          {activeTab === 'vocab' && <VocabularySRS />}
          {activeTab === 'settings' && <Settings />}
        </Suspense>
        </ErrorBoundary>
      </main>

      {/* Bottom Floating Frosted Glass TabBar */}
      <nav 
        className="flex-none bg-[#fffdf8]/95 backdrop-blur-2xl border-t border-[#e7e0d4] px-3 pt-1.5 select-none z-30 shadow-[0_-12px_30px_-24px_rgba(15,23,42,0.5)]"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
      >
        <div className="grid grid-cols-5 gap-1">
          <button
            type="button"
            aria-current={activeTab === 'home' ? 'page' : undefined}
            onClick={() => navigate('home')}
            className={`tap-lift flex flex-col items-center py-1.5 px-0.5 rounded-2xl transition-all ${
              activeTab === 'home'
                ? 'bg-[#102a43] text-white font-semibold shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Home className="w-4.5 h-4.5 mb-1" />
            <span className="text-[10px] leading-none tracking-tight">今日</span>
          </button>

          <button
            type="button"
            aria-current={activeTab === 'oral' ? 'page' : undefined}
            onClick={() => navigate('oral')}
            className={`tap-lift flex flex-col items-center py-1.5 px-1 rounded-2xl transition-all ${
              activeTab === 'oral'
                ? 'bg-[#102a43] text-white font-semibold shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <MessageSquare className="w-4.5 h-4.5 mb-1" />
            <span className="text-[10px] leading-none tracking-tight">口语</span>
          </button>

          {/* Tab 2: Smart Reader */}
          <button
            type="button"
            aria-current={activeTab === 'reader' ? 'page' : undefined}
            onClick={() => navigate('reader')}
            className={`tap-lift flex flex-col items-center py-1.5 px-1 rounded-2xl transition-all ${
              activeTab === 'reader'
                ? 'bg-[#102a43] text-white font-semibold shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <BookOpen className="w-4.5 h-4.5 mb-1" />
            <span className="text-[10px] leading-none tracking-tight">精读</span>
          </button>

          {/* Tab 3: Vocabulary & SRS */}
          <button
            type="button"
            aria-current={activeTab === 'nce' ? 'page' : undefined}
            onClick={() => navigate('nce')}
            className={`tap-lift flex flex-col items-center py-1.5 px-1 rounded-2xl transition-all ${
              activeTab === 'nce'
                ? 'bg-[#102a43] text-white font-semibold shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <GraduationCap className="w-4.5 h-4.5 mb-1" />
            <span className="text-[10px] leading-none tracking-tight">新概念</span>
          </button>

          {/* Tab 4: Vocabulary & SRS */}
          <button
            type="button"
            aria-current={activeTab === 'vocab' ? 'page' : undefined}
            onClick={() => {
              navigate('vocab');
              updateDueCount();
            }}
            className={`tap-lift flex flex-col items-center py-1.5 px-1 rounded-2xl transition-all relative ${
              activeTab === 'vocab'
                ? 'bg-[#102a43] text-white font-semibold shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <div className="relative">
              <Layers className="w-4.5 h-4.5 mb-1" />
              {dueVocabCount > 0 && (
                <span className="absolute -top-1 -right-2 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-[9px] font-bold px-1 rounded-full min-w-[14px] h-[14px] flex items-center justify-center leading-none shadow-xs animate-pulse">
                  {dueVocabCount}
                </span>
              )}
            </div>
            <span className="text-[10px] leading-none tracking-tight">生词</span>
          </button>

        </div>
      </nav>
    </div>
  );
}
