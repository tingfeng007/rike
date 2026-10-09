import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Lightbulb, Save, Wand2, X } from 'lucide-react';
import { GRAMMAR_LESSONS, GRAMMAR_SOURCES, SENTENCE_BUILDER } from '../data/grammarLessons';
import { composeLearningSentence } from '../services/grammarLessons';
import { StorageService } from '../services/storage';

const DEFAULT_SLOTS = { frequency: '', manner: 'carefully', place: 'in the library', time: 'in the evening' };
const SELF_CHECKS = [
  { id: 'core', label: '我能找到完整的主语和谓语' },
  { id: 'structure', label: '我用到了本节学习的结构' },
  { id: 'meaning', label: '句子清楚表达了我想说的意思' },
];
const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const asText = (value, maximum) => typeof value === 'string' ? value.slice(0, maximum) : '';
const normalizeDraft = (value) => {
  const draft = asObject(value);
  const checks = asObject(draft.checks);
  return { sentence: asText(draft.sentence, 500), reflection: asText(draft.reflection, 1000), checks: Object.fromEntries(SELF_CHECKS.map((check) => [check.id, checks[check.id] === true])) };
};

function normalizeWorkbenchSession(raw) {
  const stored = asObject(raw);
  const topicIds = new Set(GRAMMAR_LESSONS.map((topic) => topic.id));
  const storedSlots = asObject(stored.slots);
  const slots = stored.slots && typeof stored.slots === 'object' && !Array.isArray(stored.slots)
    ? Object.fromEntries(SENTENCE_BUILDER.slots.map((slot) => [slot.id, slot.options.includes(storedSlots[slot.id]) ? storedSlots[slot.id] : '']))
    : { ...DEFAULT_SLOTS };
  const drafts = Object.fromEntries(Object.entries(asObject(stored.drafts)).filter(([id]) => topicIds.has(id)).map(([id, draft]) => [id, normalizeDraft(draft)]));
  const notes = Array.isArray(stored.notes) ? stored.notes.slice(-64).flatMap((note) => {
    if (!note || typeof note.id !== 'string' || !note.id || !topicIds.has(note.topicId) || typeof note.sentence !== 'string' || !note.sentence.trim()) return [];
    return [{ ...normalizeDraft(note), id: note.id.slice(0, 200), topicId: note.topicId, createdAt: Number.isFinite(note.createdAt) && note.createdAt > 0 ? note.createdAt : 0 }];
  }) : [];
  return {
    topicId: topicIds.has(stored.topicId) ? stored.topicId : GRAMMAR_LESSONS[0].id,
    slots, drafts, notes: [...new Map(notes.map((note) => [note.id, note])).values()],
    timeFirst: stored.timeFirst === true && Boolean(slots.time), outlineOpen: stored.outlineOpen === true,
  };
}

const colors = {
  主语: 'bg-sky-50 text-sky-900 border-sky-200', 谓语: 'bg-rose-50 text-rose-900 border-rose-200', 系动词: 'bg-rose-50 text-rose-900 border-rose-200',
  宾语: 'bg-emerald-50 text-emerald-900 border-emerald-200', 表语: 'bg-amber-50 text-amber-900 border-amber-200', 宾语补足语: 'bg-violet-50 text-violet-900 border-violet-200',
};
function SentenceParts({ parts }) {
  return <div className="grammar-parts">{parts.map((part) => <div key={`${part.role}:${part.text}`} className={`border ${colors[part.role] || 'bg-stone-50 text-stone-700 border-stone-200'}`}><span className="text-sm font-semibold">{part.text}</span><span className="text-[11px] opacity-75">{part.role}</span></div>)}</div>;
}

export default function GrammarWorkbench({ onPractice, onShowPatterns, onAnalyze }) {
  const [restored] = useState(() => normalizeWorkbenchSession(StorageService.getLearningSession('grammar-workbench')));
  const [topicId, setTopicId] = useState(restored.topicId);
  const [slots, setSlots] = useState(restored.slots);
  const [timeFirst, setTimeFirst] = useState(restored.timeFirst);
  const [outlineOpen, setOutlineOpen] = useState(restored.outlineOpen);
  const [drafts, setDrafts] = useState(restored.drafts);
  const [notes, setNotes] = useState(restored.notes);
  const [sessionError, setSessionError] = useState('');
  const [draftError, setDraftError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const queue = useRef(Promise.resolve());
  const mounted = useRef(true);
  const noteSequence = useRef(0);
  const topicIndex = GRAMMAR_LESSONS.findIndex((item) => item.id === topicId);
  const topic = GRAMMAR_LESSONS[topicIndex];
  const composition = composeLearningSentence(slots, timeFirst);
  const draft = drafts[topicId] || normalizeDraft({});
  const topicNotes = notes.filter((note) => note.topicId === topicId).slice().reverse();
  const practisedTopics = new Set(notes.map((note) => note.topicId));
  const snapshot = useMemo(() => ({ topicId, slots, timeFirst, outlineOpen, drafts, notes }), [topicId, slots, timeFirst, outlineOpen, drafts, notes]);

  // Autosave and explicit sentence saves share a queue so an old draft cannot
  // overwrite a newer committed sentence when an IDB transaction is delayed.
  const persist = useCallback((next) => {
    const write = queue.current.then(() => StorageService.saveLearningSession('grammar-workbench', next)).catch(() => false);
    queue.current = write;
    return write;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (saving) return;
    void persist(snapshot).then((saved) => {
      if (mounted.current) setDraftError(saved ? '' : '草稿暂未保存到设备，内容仍保留在当前页面，请检查存储空间。');
    });
  }, [snapshot, persist, saving]);

  const changeTopic = (id) => {
    if (savingRef.current || !GRAMMAR_LESSONS.some((item) => item.id === id)) return;
    setTopicId(id);
    setSavedMessage('');
  };
  const changeDraft = (patch) => {
    if (savingRef.current) return;
    setDrafts((previous) => ({ ...previous, [topicId]: { ...normalizeDraft(previous[topicId]), ...patch } }));
    setSavedMessage('');
  };
  const saveSentence = async () => {
    if (savingRef.current) return;
    const sentence = draft.sentence.trim();
    if (!sentence || !/[a-z]/i.test(sentence)) { setSessionError('请先写一句英文，再保存造句与自评。'); return; }
    if (topicNotes.some((note) => note.sentence === sentence && note.reflection === draft.reflection && SELF_CHECKS.every((check) => note.checks[check.id] === draft.checks[check.id]))) {
      setSessionError('');
      setSavedMessage('这条造句与自评已在本节记录中。');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSavedMessage('');
    noteSequence.current += 1;
    const note = { ...draft, sentence, id: `${topicId}:${Date.now()}:${noteSequence.current}`, topicId, createdAt: Date.now() };
    const nextNotes = [...notes, note].slice(-64);
    const saved = await persist({ ...snapshot, notes: nextNotes });
    if (mounted.current) {
      if (saved) { setNotes(nextNotes); setSessionError(''); setDraftError(''); setSavedMessage('造句与自评已保存到本设备。'); }
      else setSessionError('造句没有保存成功，输入与自评已保留，请检查存储空间后重试。');
      setSaving(false);
    }
    savingRef.current = false;
  };
  return <div className="grammar-workbench">
    <aside className={`grammar-outline ${outlineOpen ? 'is-open' : ''}`} aria-label="语法学习目录">
      <div className="grammar-mobile-topic"><label className="block text-xs font-semibold text-stone-600">学习章节<select value={topicId} disabled={saving} onChange={(event) => changeTopic(event.target.value)} className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5">{GRAMMAR_LESSONS.map((lesson, index) => <option key={lesson.id} value={lesson.id}>{String(index + 1).padStart(2, '0')} · {lesson.name}</option>)}</select></label><button type="button" aria-expanded={outlineOpen} onClick={() => setOutlineOpen((value) => !value)} className="mt-2 py-2 text-xs text-teal-800">{outlineOpen ? '收起学习目录' : '展开全部 8 节目录'}</button></div>
      <div className="grammar-topic-grid">{GRAMMAR_LESSONS.map((lesson, index) => <button key={lesson.id} type="button" aria-pressed={topicId === lesson.id} disabled={saving} onClick={() => changeTopic(lesson.id)} className={`grammar-topic ${topicId === lesson.id ? 'is-active' : ''}`}><span className="font-mono text-xs opacity-60">{String(index + 1).padStart(2, '0')}</span><span><strong className="block text-sm">{lesson.name}{practisedTopics.has(lesson.id) && <Check className="ml-1 inline h-3 w-3" aria-label="已保存过造句" />}</strong><span className="mt-1 block text-[11px] opacity-70">{lesson.subtitle}</span></span></button>)}</div>
      <button type="button" disabled={saving} onClick={onShowPatterns} className="mt-4 flex w-full items-center justify-between rounded-xl border border-stone-300 px-3 py-3 text-xs font-semibold text-stone-600"><span>五大句型</span><ArrowRight className="h-4 w-4" /></button>
    </aside>
    <article className="grammar-lesson" key={topic.id}>
      <div className="grammar-lesson-heading"><div className="mb-3 flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>第 {topicIndex + 1} / {GRAMMAR_LESSONS.length} 节</span><span>已保存造句 {practisedTopics.size} / {GRAMMAR_LESSONS.length} 节</span></div><h2 className="mt-2 text-2xl font-bold text-[#102a43] sm:text-3xl">{topic.name}</h2><p className="mt-3 text-sm leading-7 text-stone-600">{topic.summary}</p><p className="mt-4 rounded-xl bg-[#102a43] px-4 py-3 font-mono text-sm leading-6 text-white">{topic.symbol}</p></div>
      {topic.id === 'expansion' && <section className="grammar-builder" aria-label="互动扩句实验">
        <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="text-base font-bold text-slate-900">句子拓展</h3><button type="button" disabled={saving} onClick={() => { setSlots({}); setTimeFirst(false); }} className="rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-600">只看主干</button></div>
        <div className="my-5 grid grid-cols-2 gap-3">{SENTENCE_BUILDER.slots.map((slot) => <label key={slot.id} className="block text-xs font-semibold text-stone-700"><span>{slot.label} <span className="font-normal text-stone-500">{slot.question}</span></span><select value={slots[slot.id] || ''} disabled={saving} onChange={(event) => { setSlots((previous) => ({ ...previous, [slot.id]: event.target.value })); if (slot.id === 'time' && !event.target.value) setTimeFirst(false); }} className="mt-2 w-full rounded-xl border border-stone-300 bg-white p-2.5 text-sm">{slot.options.map((option) => <option key={option} value={option}>{option || '省略'}</option>)}</select></label>)}</div>
        <label className="mb-4 flex items-center gap-2 text-xs leading-5 text-stone-600"><input type="checkbox" checked={timeFirst} disabled={saving || !slots.time} onChange={(event) => setTimeFirst(event.target.checked)} />把时间提到句首，作为背景</label>
        <div className="rounded-2xl border border-teal-200 bg-white p-4" aria-live="polite" aria-atomic="true"><p className="editorial-serif text-xl leading-8 text-[#102a43]">{composition.sentence}</p><div className="mt-4"><SentenceParts parts={composition.parts} /></div></div>
        <p className="mt-3 text-xs leading-6 text-teal-800">主干始终是 <strong>{composition.core}</strong> 频率副词放在 read 前；句末方式 → 地点 → 时间是这里的默认顺序。</p>
      </section>}
      <section className="grammar-section"><h3 className="grammar-section-title"><Lightbulb className="h-4 w-4 text-amber-600" />语法规则</h3><div className="grid gap-4 sm:grid-cols-2">{topic.rules.map(([title, body], index) => <div key={title}><div className="mb-2 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-stone-100 font-mono text-xs text-stone-500">{index + 1}</span><h4 className="text-sm font-bold text-stone-800">{title}</h4></div><p className="text-sm leading-7 text-stone-600">{body}</p></div>)}</div></section>
      <section className="grammar-section"><h3 className="grammar-section-title"><BookOpen className="h-4 w-4 text-teal-700" />例句拆解</h3><div className="space-y-5">{topic.examples.map((item) => <div key={item.en} className="border-l-2 border-teal-300 pl-4"><p className="editorial-serif text-lg leading-8 text-slate-900">{item.en}</p><p className="mb-3 mt-1 text-xs leading-6 text-stone-500">{item.zh}</p><SentenceParts parts={item.parts} /><p className="mt-3 text-xs leading-6 text-teal-800">{item.note}</p></div>)}</div></section>
      <section className="grammar-section"><h3 className="grammar-section-title">容易踩的坑</h3><div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-4"><p className="flex gap-2 text-sm leading-6 text-rose-800"><X className="mt-1 h-4 w-4 shrink-0" /><span>{topic.pitfall[0]}</span></p><p className="mt-2 flex gap-2 text-sm leading-6 text-emerald-800"><Check className="mt-1 h-4 w-4 shrink-0" /><span>{topic.pitfall[1]}</span></p><p className="mt-3 text-xs leading-6 text-stone-600">{topic.pitfall[2]}</p></div></section>
      <section className="grammar-section space-y-4" aria-label="自由造句与自评">
        <h3 className="text-base font-bold text-slate-900">自由造句</h3>
        {(sessionError || draftError) && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{sessionError || draftError}</p>}
        <label className="block text-xs font-semibold text-slate-700">我的英文句子<textarea value={draft.sentence} disabled={saving} maxLength={500} onChange={(event) => changeDraft({ sentence: event.target.value.slice(0, 500) })} rows={3} placeholder="用本节的结构，说一件与你有关的事。" className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-normal leading-6 text-slate-800" /></label>
        <fieldset disabled={saving} className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/70 p-3"><legend className="px-1 text-xs font-semibold text-slate-700">写完后自评</legend>{SELF_CHECKS.map((check) => <label key={check.id} className="flex items-start gap-2 text-xs leading-5 text-slate-600"><input type="checkbox" checked={draft.checks[check.id]} onChange={(event) => changeDraft({ checks: { ...draft.checks, [check.id]: event.target.checked } })} className="mt-1" /><span>{check.label}</span></label>)}</fieldset>
        <label className="block text-xs font-semibold text-slate-700">我的结构说明或疑问（可选）<textarea value={draft.reflection} disabled={saving} maxLength={1000} onChange={(event) => changeDraft({ reflection: event.target.value.slice(0, 1000) })} rows={2} placeholder="例如：我把时间放在句首；还不确定副词的位置。" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-normal leading-6" /></label>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={saving || !draft.sentence.trim()} onClick={() => void saveSentence()} className="flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40"><Save className="h-4 w-4" />{saving ? '正在保存…' : '保存造句与自评'}</button>{onAnalyze && <button type="button" disabled={saving || !draft.sentence.trim()} onClick={() => onAnalyze(draft.sentence.trim())} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 disabled:opacity-40"><Wand2 className="h-4 w-4" />用 AI 继续拆句</button>}</div>
        {savedMessage && <output className="flex items-center gap-1.5 text-xs text-emerald-700"><Check className="h-4 w-4" />{savedMessage}</output>}
        {topicNotes.length > 0 && <details className="rounded-xl border border-slate-100 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">本节造句记录（{topicNotes.length}）</summary><div className="mt-3 space-y-3">{topicNotes.map((note) => <div key={note.id} className="border-t border-slate-100 pt-3"><p className="break-words text-sm leading-6 text-slate-800">{note.sentence}</p><p className="mt-1 text-[11px] text-slate-500">自评 {SELF_CHECKS.filter((check) => note.checks[check.id]).length} / {SELF_CHECKS.length} 项</p>{note.reflection && <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-600">{note.reflection}</p>}</div>)}</div></details>}
      </section>
      <div className="grammar-section flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={saving} onClick={() => onPractice?.(topic.id)} className="flex items-center gap-2 rounded-xl bg-[#102a43] px-5 py-3 text-sm font-semibold text-white">练习这一节 · 5 题<ArrowRight className="h-4 w-4" /></button></div>
      <nav aria-label="语法章节前后导航" className="grammar-section flex items-center justify-between gap-3"><button type="button" disabled={saving || topicIndex === 0} onClick={() => changeTopic(GRAMMAR_LESSONS[topicIndex - 1]?.id)} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-600 disabled:opacity-35"><ArrowLeft className="h-4 w-4" />上一节</button><span className="text-xs text-slate-400">{topicIndex + 1} / {GRAMMAR_LESSONS.length}</span><button type="button" disabled={saving || topicIndex + 1 === GRAMMAR_LESSONS.length} onClick={() => changeTopic(GRAMMAR_LESSONS[topicIndex + 1]?.id)} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-600 disabled:opacity-35">下一节<ArrowRight className="h-4 w-4" /></button></nav>
      <details className="px-5 pb-5 text-xs text-stone-500"><summary className="cursor-pointer py-2">帮助与内容参考</summary><p className="py-2 leading-6">草稿自动保留，保存后进入造句记录，最多保留最近 64 条。自评记录你的理解，不会自动判定句子对错；可对照例句或使用 AI 拆句。</p><p className="py-2 leading-6">本模块提供初学者常用结构，例句为自编。词序会因强调、语境和动词用法而变化；内置句型判定器覆盖范围有限。</p>{GRAMMAR_SOURCES.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="mr-4 inline-block py-2 text-teal-700 underline">{source.title}</a>)}</details>
    </article>
  </div>;
}
