import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  BookOpen,
  Layers,
  Settings as SettingsIcon,
} from 'lucide-react';
import OralCoach from './components/OralCoach';
import SmartReader from './components/SmartReader';
import VocabularySRS from './components/VocabularySRS';
import Settings from './components/Settings';
import { StorageService } from './services/storage';

export default function App() {
  const [activeTab, setActiveTab] = useState('oral'); // 'oral' | 'reader' | 'vocab' | 'settings'
  const [dueVocabCount, setDueVocabCount] = useState(0);

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
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-100 font-sans">
      {/* Main View Container */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'oral' && (
          <OralCoach onNavigateToVocab={() => setActiveTab('vocab')} />
        )}
        {activeTab === 'reader' && <SmartReader />}
        {activeTab === 'vocab' && <VocabularySRS />}
        {activeTab === 'settings' && <Settings />}
      </main>

      {/* Bottom Navigation Bar (Mobile-first TabBar) */}
      <nav className="flex-none bg-white border-t border-slate-200/90 px-2 py-1.5 shadow-lg select-none z-20" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 12px), 10px)' }}>
        <div className="max-w-md mx-auto grid grid-cols-4 gap-1">
          {/* Tab 1: Oral */}
          <button
            onClick={() => setActiveTab('oral')}
            className={`flex flex-col items-center py-1.5 px-1 rounded-xl transition-all ${
              activeTab === 'oral'
                ? 'text-sky-600 font-semibold scale-105'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            <MessageSquare className="w-5 h-5 mb-0.5" />
            <span className="text-[11px] leading-none">口语对练</span>
          </button>

          {/* Tab 2: Smart Reader */}
          <button
            onClick={() => setActiveTab('reader')}
            className={`flex flex-col items-center py-1.5 px-1 rounded-xl transition-all ${
              activeTab === 'reader'
                ? 'text-sky-600 font-semibold scale-105'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            <BookOpen className="w-5 h-5 mb-0.5" />
            <span className="text-[11px] leading-none">精读伴读</span>
          </button>

          {/* Tab 3: Vocabulary & SRS */}
          <button
            onClick={() => {
              setActiveTab('vocab');
              updateDueCount();
            }}
            className={`flex flex-col items-center py-1.5 px-1 rounded-xl transition-all relative ${
              activeTab === 'vocab'
                ? 'text-sky-600 font-semibold scale-105'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            <div className="relative">
              <Layers className="w-5 h-5 mb-0.5" />
              {dueVocabCount > 0 && (
                <span className="absolute -top-1 -right-2.5 bg-rose-500 text-white text-[9px] font-bold px-1 rounded-full min-w-[14px] h-[14px] flex items-center justify-center leading-none">
                  {dueVocabCount}
                </span>
              )}
            </div>
            <span className="text-[11px] leading-none">生词闪卡</span>
          </button>

          {/* Tab 4: Settings */}
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center py-1.5 px-1 rounded-xl transition-all ${
              activeTab === 'settings'
                ? 'text-sky-600 font-semibold scale-105'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            <SettingsIcon className="w-5 h-5 mb-0.5" />
            <span className="text-[11px] leading-none">设置</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
