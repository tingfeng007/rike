import React, { useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, Headphones, RotateCcw, Volume2 } from 'lucide-react';
import { scoreDictation } from '../services/nce';

export default function NceDictation({ items, bestScore = 0, onPlay, onResult, onComplete }) {
  const [itemIndex, setItemIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null);
  const [scores, setScores] = useState({});
  const [finished, setFinished] = useState(false);
  const [notice, setNotice] = useState('');
  const completedRef = useRef(false);
  const firstPassRef = useRef({});

  const currentItem = items[itemIndex];
  const completedScores = useMemo(() => Object.values(scores), [scores]);
  const averageScore = completedScores.length
    ? Math.round(completedScores.reduce((sum, score) => sum + score, 0) / completedScores.length)
    : 0;

  const checkAnswer = () => {
    if (!currentItem || !answer.trim()) return;
    const nextResult = scoreDictation(currentItem.text, answer);
    if (onResult?.(currentItem, nextResult, answer.trim()) === false) {
      setNotice('本句没有保存成功，答案已保留，请重试。');
      return;
    }
    const nextScores = Object.hasOwn(scores, currentItem.id) ? scores : { ...scores, [currentItem.id]: nextResult.score };
    if (!Object.hasOwn(firstPassRef.current, currentItem.id)) firstPassRef.current[currentItem.id] = nextResult.passed;
    setScores(nextScores);
    setResult(nextResult);
    setNotice('');
  };

  const goNext = () => {
    if (!result || completedRef.current) return;
    if (itemIndex + 1 >= items.length) {
      const values = Object.values(scores);
      const finalAverage = values.length
        ? Math.round(values.reduce((sum, score) => sum + score, 0) / values.length)
        : 0;
      if (onComplete?.(finalAverage, { firstAnswersPassed: Object.values(firstPassRef.current).every(Boolean) }) === false) {
        setNotice('完成记录没有保存成功，请重试。');
        return;
      }
      completedRef.current = true;
      setFinished(true);
      return;
    }
    setItemIndex((value) => value + 1);
    setAnswer('');
    setResult(null);
  };

  const goPrevious = () => {
    if (itemIndex === 0) return;
    const nextIndex = itemIndex - 1;
    setItemIndex(nextIndex);
    setAnswer('');
    setResult(null);
  };

  const retry = () => {
    setAnswer('');
    setResult(null);
  };

  const restart = () => {
    completedRef.current = false;
    firstPassRef.current = {};
    setNotice('');
    setItemIndex(0);
    setAnswer('');
    setResult(null);
    setScores({});
    setFinished(false);
  };

  if (items.length === 0) {
    return <div className="rounded-3xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">课文加载后会生成逐句听写。</div>;
  }

  if (finished) {
    return (
      <div className="rounded-3xl bg-white border border-emerald-100 p-6 text-center shadow-sm nce-reveal">
        <div className="w-16 h-16 rounded-[22px] bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto"><CheckCircle2 className="w-9 h-9" /></div>
        <h2 className="text-xl font-bold text-slate-900 mt-1">本课听写完成</h2>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <div className="rounded-2xl bg-slate-50 p-3"><span className="block text-2xl font-bold text-slate-900">{averageScore}</span><span className="text-xs text-slate-400">首答平均分</span></div>
          <div className="rounded-2xl bg-sky-50 p-3"><span className="block text-2xl font-bold text-sky-700">{Math.max(bestScore, averageScore)}</span><span className="text-xs text-sky-500">历史最佳</span></div>
        </div>
        <button type="button" onClick={restart} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold"><RotateCcw className="w-4 h-4" />重新听写</button>
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-white border border-slate-200 p-4 shadow-sm nce-reveal">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="font-bold text-slate-900">逐句听写</h2></div>
        <span className="text-xs text-slate-400">{itemIndex + 1}/{items.length}</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-3"><div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${((itemIndex + (result ? 1 : 0)) / items.length) * 100}%` }} /></div>

      <div className="mt-4 rounded-2xl bg-[#102a43] text-white p-4 relative overflow-hidden">
        <div className="absolute -right-7 -top-8 w-24 h-24 rounded-full bg-sky-400/20 blur-xl" />
        <div className="relative flex items-center justify-between gap-3">
          <div>{currentItem.zh && <p className="text-sm text-white/90">{currentItem.zh}</p>}</div>
          <button type="button" onClick={() => onPlay?.(currentItem)} className="w-12 h-12 rounded-2xl bg-white/12 hover:bg-white/20 flex items-center justify-center shrink-0" title="播放听写句子"><Headphones className="w-6 h-6" /></button>
        </div>
      </div>

      <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} disabled={Boolean(result)} rows={3} placeholder="在这里输入你听到的英文句子…" className="allow-select w-full mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:text-slate-500" />

      {notice && <p role="alert" className="mt-3 text-xs text-rose-700">{notice}</p>}
      {!result ? (
        <div className="flex items-center justify-between gap-2 mt-3">
          <button type="button" onClick={goPrevious} disabled={itemIndex === 0} className="inline-flex items-center gap-1 text-xs text-slate-400 disabled:opacity-30"><ChevronLeft className="w-4 h-4" />上一句</button>
          <div className="flex gap-2"><button type="button" onClick={() => onPlay?.(currentItem)} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-sky-50 text-sky-700 text-xs font-semibold"><Volume2 className="w-3.5 h-3.5" />再听一次</button><button type="button" onClick={checkAnswer} disabled={!answer.trim()} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold disabled:opacity-35">检查听写</button></div>
        </div>
      ) : (
        <div className={`mt-3 rounded-2xl p-3 border ${result.passed ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
          <div className="flex items-center justify-between"><span className={`font-bold ${result.passed ? 'text-emerald-700' : 'text-amber-800'}`}>{result.passed ? '听得很准' : '再核对关键单词'}</span><span className="text-2xl font-bold text-slate-900">{result.score}<span className="text-xs text-slate-400"> 分</span></span></div>
          {result.criticalErrors.length > 0 && <p className="mt-2 text-xs text-amber-800">关键单词仍有差异：{[...new Set(result.criticalErrors)].join('、')}。否定、数字和动作词需要听对。</p>}
          <p className="text-sm text-slate-800 mt-2 leading-6">{currentItem.text}</p>
          {(result.missingWords.length > 0 || result.extraWords.length > 0) && <div className="flex flex-wrap gap-1.5 mt-2">{[...new Set(result.missingWords)].map((word) => <span key={`missing-${word}`} className="px-2 py-0.5 rounded-lg bg-white text-rose-600 text-[11px] border border-rose-100">漏词 · {word}</span>)}{[...new Set(result.extraWords)].map((word) => <span key={`extra-${word}`} className="px-2 py-0.5 rounded-lg bg-white text-amber-700 text-[11px] border border-amber-100">多词 · {word}</span>)}</div>}
          <div className="flex justify-end gap-3 mt-3">{result.score < 100 && <button type="button" onClick={retry} className="text-xs font-semibold text-slate-500 underline">重写本句</button>}<button type="button" onClick={goNext} className="text-xs font-semibold text-sky-700 underline">{itemIndex + 1 >= items.length ? '完成听写' : '下一句'}</button></div>
        </div>
      )}
      <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">评分规则</summary><p className="mt-2 leading-5">标点和大小写不扣分，重点检查单词是否听对。</p></details>
    </div>
  );
}
