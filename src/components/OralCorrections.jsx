import React, { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { StorageService } from '../services/storage';
import { reviewOralCorrection } from '../services/oralSession';
import { tts } from '../services/speech';
import { BottomSheet } from './ui/Modal';
import { useToast } from './ui/toastContext';

export default function OralCorrections({ open, onClose, onPractice }) {
  const toast = useToast();
  const [items, setItems] = useState(() => StorageService.getOralCorrections());
  const [revealed, setRevealed] = useState({});
  const [attempts, setAttempts] = useState({});
  const [saving, setSaving] = useState('');
  const [now] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setItems(StorageService.getOralCorrections());
    window.addEventListener('lingoflow:storage', refresh);
    return () => window.removeEventListener('lingoflow:storage', refresh);
  }, []);
  const due = items.filter((item) => item.nextReviewAt <= now);
  const review = async (item, recalled) => {
    setSaving(item.id);
    const latest = StorageService.getOralCorrections();
    const next = latest.map((entry) => entry.id === item.id ? reviewOralCorrection(entry, recalled) : entry);
    const saved = await StorageService.saveOralCorrections(next);
    setSaving('');
    if (!saved) { toast.error('复习结果未能保存，你的重说内容仍保留。'); return; }
    setItems(StorageService.getOralCorrections());
    toast.success(recalled ? '已安排三天后再练' : '已安排明天再练');
  };
  return (
    <BottomSheet open={open} onClose={onClose} title="隔日纠错句库" size="lg">
      <p className="mb-4 text-sm text-slate-600">今天待复习 {due.length} 句 · 已积累 {items.length} 句</p>
      {!items.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">暂无纠错记录</p>}
      {items.length > 0 && due.length === 0 && <p className="mb-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-800">今天没有到期句子</p>}
      <div className="space-y-4">
        {(due.length ? due : items.slice(-10).reverse()).map((item) => (
          <section key={item.id} className="rounded-2xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500">原句</p>
            <p className="mt-1 text-sm leading-6 text-slate-800">{item.original}</p>
            <label htmlFor={`correction-${item.id}`} className="mt-3 block text-xs font-semibold text-slate-700">不看答案，用英语重新说一次</label>
            <textarea id={`correction-${item.id}`} value={attempts[item.id] || ''} onChange={(event) => setAttempts((previous) => ({ ...previous, [item.id]: event.target.value }))} rows={2} className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm" />
            {!revealed[item.id] ? <button type="button" onClick={() => setRevealed((previous) => ({ ...previous, [item.id]: true }))} className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-800">查看参考表达</button> : <>
              <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-900"><p>{item.corrected}</p>{item.explanation && <p className="mt-2 text-xs text-slate-700">{item.explanation}</p>}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => tts.speak(item.corrected)} className="flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-2 text-xs"><Volume2 size={15} />听参考</button>
                <button type="button" onClick={() => onPractice(item)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs">带回对话练习</button>
                <button type="button" disabled={Boolean(saving)} onClick={() => review(item, false)} className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">还需巩固</button>
                <button type="button" disabled={Boolean(saving) || !attempts[item.id]?.trim()} onClick={() => review(item, true)} className="rounded-xl bg-sky-600 px-3 py-2 text-xs text-white disabled:opacity-50">已自己重说</button>
              </div>
            </>}
          </section>
        ))}
      </div>
    </BottomSheet>
  );
}
