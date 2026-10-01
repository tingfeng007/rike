import React from 'react';
import { BookOpen, GraduationCap, Home, Layers, MessageSquare, Settings } from 'lucide-react';

const destinations = [
  { id: 'home', label: '今日', icon: Home },
  { id: 'oral', label: '口语', icon: MessageSquare },
  { id: 'reader', label: '精读', icon: BookOpen },
  { id: 'nce', label: '新概念', icon: GraduationCap },
  { id: 'vocab', label: '词法', icon: Layers },
];

export default function AppNavigation({ activeTab, onNavigate, dueVocabCount }) {
  return (
    <nav className="app-nav" aria-label="主导航">
      <div className="nav-brand"><span className="nav-brand-mark"><BookOpen size={23} /></span><strong>LingoFlow<span>英语学习空间</span></strong></div>
      <div className="app-navigation">
        {destinations.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={activeTab === id ? 'page' : undefined} onClick={() => onNavigate(id)} className="nav-link">
            <span className="nav-icon"><Icon size={21} strokeWidth={1.9} />{id === 'vocab' && dueVocabCount > 0 && <span className="nav-badge">{dueVocabCount > 99 ? '99+' : dueVocabCount}</span>}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <button type="button" className="nav-settings" aria-current={activeTab === 'settings' ? 'page' : undefined} onClick={() => onNavigate('settings')}><Settings size={20} /><span>设置</span></button>
    </nav>
  );
}
