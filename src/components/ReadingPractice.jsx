import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Timer } from 'lucide-react';
import { StorageService } from '../services/storage';
import { hasApiKey, describeAIError } from '../services/ai';
import { createLatestRequest } from '../services/latestRequest';
import { builtInReadingQuestions, generateReadingQuestions, readingArticleVersion, readingPracticeEvidence, restoreReadingPractice } from '../services/readingPractice';
import { useToast } from './ui/toastContext';

export default function ReadingPractice({ article }) {
  const toast = useToast();
  const version = readingArticleVersion(article);
  const scope = `reader-practice:${article.id}`;
  const [initial] = useState(() => {
    const session = StorageService.getLearningSession(scope);
    const evidence = StorageService.getReadingEvidence(article.id);
    return restoreReadingPractice(session.articleVersion === version ? session : evidence, article);
  });
  const [questions, setQuestions] = useState(() => initial.questions || builtInReadingQuestions(article));
  const [answers, setAnswers] = useState(() => initial.answers || {});
  const [quizChecked, setQuizChecked] = useState(() => Boolean(initial.quizChecked));
  const [retellingText, setRetellingText] = useState(() => initial.retellingText || '');
  const [retellingSeconds, setRetellingSeconds] = useState(() => initial.retellingSeconds || 0);
  const [running, setRunning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [completedAt, setCompletedAt] = useState(() => initial.completedAt || 0);
  const generationGate = useRef(createLatestRequest());
  useEffect(() => { const gate = generationGate.current; return () => gate.cancel(); }, []);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      if (!document.hidden) setRetellingSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    let alive = true;
    Promise.resolve(StorageService.saveLearningSession(scope, { articleVersion: version, questions, answers, quizChecked, retellingText, retellingSeconds, completedAt, updatedAt: Date.now() }))
      .then((saved) => { if (alive) setDraftError(saved ? '' : '练习草稿尚未保存，请保留页面并检查存储空间。'); });
    return () => { alive = false; };
  }, [scope, version, questions, answers, quizChecked, retellingText, retellingSeconds, completedAt]);
  const evidence = readingPracticeEvidence({ questions, answers, retellingText, retellingSeconds, quizChecked });
  const generate = async () => {
    const request = generationGate.current.start();
    setGenerating(true);
    try {
      const next = await generateReadingQuestions(article, { signal: request.signal });
      if (!request.isCurrent()) return;
      setQuestions(next); setAnswers({}); setQuizChecked(false);
    } catch (error) {
      if (request.isCurrent()) toast.error(describeAIError(error, { fallback: '理解题生成失败，可继续进行复述练习。' }).message);
    } finally { if (request.isCurrent()) setGenerating(false); }
  };
  const saveEvidence = async () => {
    if (!evidence.complete) return;
    setSaving(true);
    setRunning(false);
    const now = Date.now();
    const previous = StorageService.getReadingEvidence(article.id);
    const saved = await StorageService.saveReadingEvidence(article.id, { articleVersion: version, questions, answers, quizChecked, retellingText: retellingText.trim(), retellingSeconds, ...evidence, completedAt: now, updatedAt: now });
    setSaving(false);
    if (!saved) { toast.error('阅读证据还未保存，你的答案和复述仍在页面里。'); return; }
    setCompletedAt(now);
    if (!previous.completedAt || new Date(previous.completedAt).toDateString() !== new Date(now).toDateString()) {
      StorageService.recordStudyActivity({ type: 'reader', count: 1, source: 'reader-evidence', entityId: String(article.id), label: '完成阅读理解与复述' });
    }
    toast.success('阅读练习已保存');
  };
  return (
    <section className="mt-8 border-t border-slate-200 pt-6" aria-label="阅读理解与复述练习">
      <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-900">读懂了，再说一遍</h2><p className="mt-1 text-sm leading-6 text-slate-600">回答理解题，再用自己的话复述 30 秒，留下这次阅读的收获。</p></div><Timer size={22} className="shrink-0 text-sky-600" /></div>
      {questions.length ? <div className="space-y-4">{questions.map((question) => <fieldset key={question.id} className="rounded-2xl bg-slate-50 p-4"><legend className="px-1 text-sm font-semibold text-slate-800">{question.prompt}</legend><div className="space-y-2">{question.options.map((option, index) => <label key={option} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl bg-white p-3 text-sm leading-6 text-slate-700"><input type="radio" name={`reading-${article.id}-${question.id}`} checked={answers[question.id] === index} onChange={() => { setAnswers((previous) => ({ ...previous, [question.id]: index })); setQuizChecked(false); }} />{option}</label>)}</div>{quizChecked && <p className={`mt-3 text-sm leading-6 ${answers[question.id] === question.correctIndex ? 'text-emerald-800' : 'text-amber-900'}`}>{answers[question.id] === question.correctIndex ? '回答正确。' : `参考答案：${question.options[question.correctIndex]}。`}{question.explanation}</p>}</fieldset>)}<button type="button" disabled={!questions.every((question) => Number.isInteger(answers[question.id]))} onClick={() => setQuizChecked(true)} className="rounded-xl bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800 disabled:opacity-50">核对原文依据</button>{quizChecked && <span className="ml-3 text-sm text-slate-600">理解题 {evidence.quizScore}/{questions.length}</span>}</div> : <div className="rounded-2xl bg-slate-50 p-4"><p className="text-sm leading-6 text-slate-600">这篇文章的中心思想是什么？下面用英语复述，保留你的理解。也可以选用 AI 生成 2–3 道理解题。</p>{hasApiKey() && <button type="button" disabled={generating} onClick={generate} className="mt-3 flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-sky-800">{generating && <Loader2 size={15} className="animate-spin" />}AI 生成理解题</button>}</div>}
      <div className="mt-5 rounded-2xl border border-slate-200 p-4"><label htmlFor={`retelling-${article.id}`} className="text-sm font-semibold text-slate-800">用英语写下或说出重点，再留下一句话</label><textarea id={`retelling-${article.id}`} value={retellingText} onChange={(event) => setRetellingText(event.target.value)} rows={3} placeholder="In my own words, this article is about…" className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm leading-6" /><div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" onClick={() => setRunning((value) => !value)} className="rounded-xl bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">{running ? '暂停复述计时' : retellingSeconds ? '继续复述计时' : '开始 30 秒复述'}</button><output className="text-sm text-slate-600">已练 {retellingSeconds} / 30 秒</output></div><p className="mt-2 text-xs leading-5 text-slate-500">计时期间说出或整理你的复述，切到后台时计时会暂停。至少留下 5 个英文词。</p></div>
      {draftError && <output className="mt-3 block text-sm text-rose-700">{draftError}</output>}
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={!evidence.complete || saving} onClick={saveEvidence} className="rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? '正在保存…' : '保存阅读收获'}</button>{completedAt > 0 && <span className="flex items-center gap-1 text-sm text-emerald-800"><CheckCircle2 size={16} />已有练习记录</span>}</div>
    </section>
  );
}
