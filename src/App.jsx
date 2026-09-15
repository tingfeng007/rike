import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  BookOpen,
  Layers,
  GraduationCap,
  Settings as SettingsIcon,
} from 'lucide-react';
import OralCoach from './components/OralCoach';
import SmartReader from './components/SmartReader';
import VocabularySRS from './components/VocabularySRS';
import Settings from './components/Settings';
import NewConcept from './components/NewConcept';
import { StorageService } from './services/storage';

export default function App() {
  const [activeTab, setActiveTab] = useState('oral'); // 'oral' | 'reader' | 'nce' | 'vocab' | 'settings'
  const [dueVocabCount, setDueVocabCount] = useState(0);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [showOnlineToast, setShowOnlineToast] = useState(false);

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

  // Check how many cards are due today for review
  const updateDueCount = () => {
    const words = StorageService.getVocabulary();
    const now = Date.now();
    const due = words.filter(
      (w) => !w.nextReviewDate || w.nextReviewDate <= now + 60 * 60 * 1000
    );
    setDueVocabCount(due.length);
  };

  useEffect(() => {
    updateDueCount();
    const interval = setInterval(updateDueCount, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-md mx-auto overflow-hidden bg-slate-50 font-sans shadow-2xl relative">
      {/* Background Subtle Gradient Atmosphere */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-sky-200/30 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-24 w-80 h-80 bg-indigo-100/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 left-1/4 w-72 h-72 bg-amber-100/20 rounded-full blur-3xl" />
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
        {activeTab === 'oral' && (
          <OralCoach onNavigateToVocab={() => setActiveTab('vocab')} />
        )}
        {activeTab === 'reader' && <SmartReader />}
        {activeTab === 'nce' && <NewConcept />}
        {activeTab === 'vocab' && <VocabularySRS />}
        {activeTab === 'settings' && <Settings />}
      </main>

      {/* Bottom Floating Frosted Glass TabBar */}
      <nav 
        className="flex-none glass-floating-bar border-t border-white/80 px-3 py-1.5 select-none z-30 transition-all"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
      >
        <div className="grid grid-cols-5 gap-1">
          {/* Tab 1: Oral */}
          <button
            onClick={() => setActiveTab('oral')}
            className={`flex flex-col items-center py-1.5 px-1 rounded-2xl transition-all ${
              activeTab === 'oral'
                ? 'bg-sky-50/90 text-sky-600 font-semibold shadow-xs ring-1 ring-sky-100 scale-102'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <MessageSquare className="w-4.5 h-4.5 mb-1" />
            <span className="text-[10.5px] leading-none tracking-tight">口语对练</span>
          </button>

          {/* Tab 2: Smart Reader */}
          <button
            onClick={() => setActiveTab('reader')}
            className={`flex flex-col items-center py-1.5 px-1 rounded-2xl transition-all ${
              activeTab === 'reader'
                ? 'bg-sky-50/90 text-sky-600 font-semibold shadow-xs ring-1 ring-sky-100 scale-102'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <BookOpen className="w-4.5 h-4.5 mb-1" />
            <span className="text-[10.5px] leading-none tracking-tight">精读伴读</span>
          </button>

          {/* Tab 3: Vocabulary & SRS */}
          <button
            onClick={() => setActiveTab('nce')}
            className={`flex flex-col items-center py-1.5 px-1 rounded-2xl transition-all ${
              activeTab === 'nce'
                ? 'bg-sky-50/90 text-sky-600 font-semibold shadow-xs ring-1 ring-sky-100 scale-102'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <GraduationCap className="w-4.5 h-4.5 mb-1" />
            <span className="text-[10.5px] leading-none tracking-tight">新概念</span>
          </button>

          {/* Tab 4: Vocabulary & SRS */}
          <button
            onClick={() => {
              setActiveTab('vocab');
              updateDueCount();
            }}
            className={`flex flex-col items-center py-1.5 px-1 rounded-2xl transition-all relative ${
              activeTab === 'vocab'
                ? 'bg-sky-50/90 text-sky-600 font-semibold shadow-xs ring-1 ring-sky-100 scale-102'
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
            <span className="text-[10.5px] leading-none tracking-tight">生词闪卡</span>
          </button>

          {/* Tab 4: Settings */}
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center py-1.5 px-1 rounded-2xl transition-all ${
              activeTab === 'settings'
                ? 'bg-sky-50/90 text-sky-600 font-semibold shadow-xs ring-1 ring-sky-100 scale-102'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <SettingsIcon className="w-4.5 h-4.5 mb-1" />
            <span className="text-[10.5px] leading-none tracking-tight">设置</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
