import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import AppNavigation from './components/AppNavigation';
import HomeDashboard from './components/HomeDashboard';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/ui/Toast';
import { StorageService } from './services/storage';

const OralCoach = lazy(() => import('./components/OralCoach'));
const SmartReader = lazy(() => import('./components/SmartReader'));
const Settings = lazy(() => import('./components/Settings'));
const NewConcept = lazy(() => import('./components/NewConcept'));
// 「生词 + 语法」合并为一个导航项（内部由 WordGrammarHub 切换板块）
const WordGrammarHub = lazy(() => import('./components/WordGrammarHub'));

// 'grammar' 保留在集合里只为兼容历史保存的 activeTab：它现在由「词法」板块承载。
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
    // 旧版本可能保存过 'grammar'：现在它归入「词法」板块。
    if (saved === 'grammar') return 'vocab';
    return VALID_TABS.has(saved) ? saved : 'home';
  });
  const [dueVocabCount, setDueVocabCount] = useState(() => countDueWords());
  // Navigation intents. Each carries a monotonic token so that navigating to the *same*
  // target twice still triggers the child effect — the previous implementation compared the
  // target against a "already handled" ref and silently ignored every repeat tap.
  const intentSeqRef = useRef(0);
  const [nceIntent, setNceIntent] = useState(null);
  const [readerIntent, setReaderIntent] = useState(null);
  const [oralIntent, setOralIntent] = useState(null);
  // 「词法」板块内部的跳转意图（section: 'vocab' | 'grammar'）
  const [wordGrammarIntent, setWordGrammarIntent] = useState(null);
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
    const token = (intentSeqRef.current += 1);

    if (tab === 'nce') {
      setNceIntent({
        token,
        lessonId: options.lesson || (options.resume ? (StorageService.getAppState().lastNceLesson || '') : ''),
        entry: options.entry === 'review' || options.entry === 'exam' ? options.entry : '',
        lineId: options.lineId || '',
        reviewIds: options.reviewIds,
      });
    } else if (tab === 'reader') {
      setReaderIntent({ token, articleId: options.articleId || '' });
    } else if (tab === 'oral') {
      setOralIntent({ token, scenarioId: options.scenarioId || '', practiceWords: options.practiceWords });
    } else if (tab === 'vocab') {
      setWordGrammarIntent({ token, section: options.section || 'vocab', wordIds: options.wordIds, taskId: options.taskId });
    }

    setActiveTab(tab);
    StorageService.saveAppState({ ...StorageService.getAppState(), activeTab: tab });
  };

  // Jump from a saved word back to where it came from (the vocabulary list shows its sources).
  const openSourceFromVocab = (source) => {
    if (!source?.type) return;
    if (source.type === 'reader') navigate('reader', { articleId: source.id });
    else if (source.type === 'nce') navigate('nce', { lesson: source.id });
    else if (source.type === 'oral') navigate('oral', { scenarioId: source.id });
  };

  // Check how many cards are due today for review
  const updateDueCount = () => {
    setDueVocabCount(countDueWords());
  };

  useEffect(() => {
    const interval = setInterval(updateDueCount, 30000);
    window.addEventListener('lingoflow:storage', updateDueCount);
    return () => { clearInterval(interval); window.removeEventListener('lingoflow:storage', updateDueCount); };
  }, []);

  return (
    <ToastProvider>
    <div className="app-shell study-page flex flex-col h-[100dvh] w-full mx-auto overflow-hidden font-sans relative">
      {/* Offline / Online Status Toast Bar */}
      {isOffline && (
        <div className="flex-none bg-amber-500/95 text-white text-[11px] font-medium py-1 px-3 flex items-center justify-center gap-1.5 shadow-xs z-50 animate-fade-in select-none">
          <span>✈️ 离线模式：本地文章、闪卡与笔记完整可用</span>
        </div>
      )}
      {showOnlineToast && !isOffline && (
        <div className="flex-none bg-emerald-600 text-white text-[11px] font-medium py-1 px-3 flex items-center justify-center gap-1.5 shadow-xs z-50 animate-fade-in select-none">
          <span>🌐 网络已恢复，可继续使用联网功能</span>
        </div>
      )}

      {/* Main View Container */}
      <main className="app-main flex-1 min-h-0 min-w-0 overflow-hidden relative z-10">
        <ErrorBoundary key={activeTab}>
        <Suspense fallback={<PageFallback />}>
          {activeTab === 'home' && <HomeDashboard onNavigate={navigate} />}
          {activeTab === 'oral' && (
            <OralCoach intent={oralIntent} onNavigateToVocab={() => navigate('vocab')} />
          )}
          {activeTab === 'reader' && <SmartReader intent={readerIntent} />}
          {activeTab === 'nce' && <NewConcept intent={nceIntent} onNavigate={navigate} />}
          {activeTab === 'vocab' && (
            <WordGrammarHub
              onOpenSource={openSourceFromVocab}
              onOpenSettings={() => navigate('settings')}
              intent={wordGrammarIntent}
            />
          )}
          {activeTab === 'settings' && <Settings />}
        </Suspense>
        </ErrorBoundary>
      </main>

      <AppNavigation activeTab={activeTab} onNavigate={navigate} dueVocabCount={dueVocabCount} />
    </div>
    </ToastProvider>
  );
}
