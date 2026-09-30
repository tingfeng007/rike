import React, { useState } from 'react';
import { ArrowRight, BookOpen, Check, Lightbulb, X } from 'lucide-react';
import { GRAMMAR_LESSONS, GRAMMAR_SOURCES, SENTENCE_BUILDER } from '../data/grammarLessons';
import { composeLearningSentence } from '../services/grammarLessons';

const colors = {
  主语: 'bg-sky-50 text-sky-900 border-sky-200', 谓语: 'bg-rose-50 text-rose-900 border-rose-200', 系动词: 'bg-rose-50 text-rose-900 border-rose-200',
  宾语: 'bg-emerald-50 text-emerald-900 border-emerald-200', 表语: 'bg-amber-50 text-amber-900 border-amber-200', 宾语补足语: 'bg-violet-50 text-violet-900 border-violet-200',
};
function SentenceParts({ parts }) {
  return <div className="grammar-parts">{parts.map((part) => <div key={`${part.role}:${part.text}`} className={`border ${colors[part.role] || 'bg-stone-50 text-stone-700 border-stone-200'}`}><span className="text-sm font-semibold">{part.text}</span><span className="text-[11px] opacity-75">{part.role}</span></div>)}</div>;
}

export default function GrammarWorkbench({ onPractice, onShowPatterns }) {
  const [topicId, setTopicId] = useState('expansion');
  const [slots, setSlots] = useState({ manner: 'carefully', place: 'in the library', time: 'in the evening' });
  const [timeFirst, setTimeFirst] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const topic = GRAMMAR_LESSONS.find((item) => item.id === topicId);
  const composition = composeLearningSentence(slots, timeFirst);
  return <div className="grammar-workbench">
    <aside className={`grammar-outline ${outlineOpen ? 'is-open' : ''}`} aria-label="语法学习目录">
      <div className="grammar-mobile-topic"><label className="block text-xs font-semibold text-stone-600">学习章节<select value={topicId} onChange={(event) => setTopicId(event.target.value)} className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5">{GRAMMAR_LESSONS.map((lesson, index) => <option key={lesson.id} value={lesson.id}>{String(index + 1).padStart(2, '0')} · {lesson.name}</option>)}</select></label><button type="button" aria-expanded={outlineOpen} onClick={() => setOutlineOpen((value) => !value)} className="mt-2 py-2 text-xs text-teal-800">{outlineOpen ? '收起学习目录' : '展开全部 8 节目录'}</button></div>
      <p className="mb-3 text-[11px] font-bold tracking-widest text-stone-500">学习路线 / 08 LESSONS</p>
      <div className="grammar-topic-grid">{GRAMMAR_LESSONS.map((lesson, index) => <button key={lesson.id} type="button" aria-pressed={topicId === lesson.id} onClick={() => setTopicId(lesson.id)} className={`grammar-topic ${topicId === lesson.id ? 'is-active' : ''}`}><span className="font-mono text-xs opacity-60">{String(index + 1).padStart(2, '0')}</span><span><strong className="block text-sm">{lesson.name}</strong><span className="mt-1 block text-[11px] opacity-70">{lesson.subtitle}</span></span></button>)}</div>
      <button type="button" onClick={onShowPatterns} className="mt-4 flex w-full items-center justify-between rounded-xl border border-stone-300 px-3 py-3 text-xs font-semibold text-stone-600"><span>先复习五大句型骨架</span><ArrowRight className="h-4 w-4" /></button>
    </aside>
    <article className="grammar-lesson" key={topic.id}>
      <div className="grammar-lesson-heading"><span className="text-[11px] font-bold tracking-widest text-teal-700">从句子骨架，到完整表达</span><h2 className="mt-2 text-2xl font-bold text-[#102a43] sm:text-3xl">{topic.name}</h2><p className="mt-3 text-sm leading-7 text-stone-600">{topic.summary}</p><p className="mt-4 rounded-xl bg-[#102a43] px-4 py-3 font-mono text-sm leading-6 text-white">{topic.symbol}</p></div>
      {topic.id === 'expansion' && <section className="grammar-builder" aria-label="互动扩句实验">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-bold text-slate-900">亲手给句子加一层信息</h3><p className="mt-1 text-xs leading-5 text-slate-500">切换下方选项，观察位置变化；选“省略”看句子主干。</p></div><button type="button" onClick={() => { setSlots({}); setTimeFirst(false); }} className="rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-600">只看主干</button></div>
        <div className="my-5 grid grid-cols-2 gap-3">{SENTENCE_BUILDER.slots.map((slot) => <label key={slot.id} className="block text-xs font-semibold text-stone-700"><span>{slot.label} <span className="font-normal text-stone-500">{slot.question}</span></span><select value={slots[slot.id] || ''} onChange={(event) => setSlots((previous) => ({ ...previous, [slot.id]: event.target.value }))} className="mt-2 w-full rounded-xl border border-stone-300 bg-white p-2.5 text-sm">{slot.options.map((option) => <option key={option} value={option}>{option || '省略'}</option>)}</select></label>)}</div>
        <label className="mb-4 flex items-center gap-2 text-xs leading-5 text-stone-600"><input type="checkbox" checked={timeFirst} disabled={!slots.time} onChange={(event) => setTimeFirst(event.target.checked)} />把时间提到句首，作为背景</label>
        <div className="rounded-2xl border border-teal-200 bg-white p-4" aria-live="polite" aria-atomic="true"><p className="editorial-serif text-xl leading-8 text-[#102a43]">{composition.sentence}</p><div className="mt-4"><SentenceParts parts={composition.parts} /></div></div>
        <p className="mt-3 text-xs leading-6 text-teal-800">主干始终是 <strong>{composition.core}</strong> 频率副词放在 read 前；句末方式 → 地点 → 时间是这里的默认顺序。</p>
      </section>}
      <section className="grammar-section"><h3 className="grammar-section-title"><Lightbulb className="h-4 w-4 text-amber-600" />一步一步理解</h3><div className="grid gap-4 sm:grid-cols-2">{topic.rules.map(([title, body], index) => <div key={title}><div className="mb-2 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-stone-100 font-mono text-xs text-stone-500">{index + 1}</span><h4 className="text-sm font-bold text-stone-800">{title}</h4></div><p className="text-sm leading-7 text-stone-600">{body}</p></div>)}</div></section>
      <section className="grammar-section"><h3 className="grammar-section-title"><BookOpen className="h-4 w-4 text-teal-700" />例句拆解</h3><div className="space-y-5">{topic.examples.map((item) => <div key={item.en} className="border-l-2 border-teal-300 pl-4"><p className="editorial-serif text-lg leading-8 text-slate-900">{item.en}</p><p className="mb-3 mt-1 text-xs leading-6 text-stone-500">{item.zh}</p><SentenceParts parts={item.parts} /><p className="mt-3 text-xs leading-6 text-teal-800">{item.note}</p></div>)}</div></section>
      <section className="grammar-section"><h3 className="grammar-section-title">容易踩的坑</h3><div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-4"><p className="flex gap-2 text-sm leading-6 text-rose-800"><X className="mt-1 h-4 w-4 shrink-0" /><span>{topic.pitfall[0]}</span></p><p className="mt-2 flex gap-2 text-sm leading-6 text-emerald-800"><Check className="mt-1 h-4 w-4 shrink-0" /><span>{topic.pitfall[1]}</span></p><p className="mt-3 text-xs leading-6 text-stone-600">{topic.pitfall[2]}</p></div></section>
      <div className="grammar-section flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-stone-600">理解之后，用两道题检验这一节。</p><button type="button" onClick={() => onPractice(topic.id)} className="flex items-center gap-2 rounded-xl bg-[#102a43] px-5 py-3 text-sm font-semibold text-white">练习这一节<ArrowRight className="h-4 w-4" /></button></div>
      <details className="px-5 pb-5 text-xs text-stone-500"><summary className="cursor-pointer py-2">内容参考与学习边界</summary><p className="py-2 leading-6">本模块提供初学者常用结构，例句为自编。词序会因强调、语境和动词用法而变化；内置句型判定器覆盖范围有限。</p>{GRAMMAR_SOURCES.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="mr-4 inline-block py-2 text-teal-700 underline">{source.title}</a>)}</details>
    </article>
  </div>;
}
