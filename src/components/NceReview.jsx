import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Headphones, RotateCcw, Volume2 } from 'lucide-react';
import { tts } from '../services/speech';
import { buildNceReviewQueue, gradeNceReview } from '../services/nceReview';

export default function NceReview({ progress, units, initialUnitFilename = '', onResolve, onOpenLesson, onBack }) {
  const [unitId, setUnitId] = useState(initialUnitFilename);
  const [activeId, setActiveId] = useState('');
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [notice, setNotice] = useState('');
  const queue = useMemo(() => buildNceReviewQueue(progress, unitId), [progress, unitId]);
  const allCount = useMemo(() => buildNceReviewQueue(progress).length, [progress]);
  const unitIds = useMemo(() => [...new Set(buildNceReviewQueue(progress).map((item) => item.unitId))], [progress]);
  const current = queue.find((item) => item.id === activeId) || queue[0];
  const currentIndex = current ? queue.findIndex((item) => item.id === current.id) : -1;

  useEffect(() => () => tts.stop(), []);

  const chooseItem = (id) => {
    tts.stop();
    setNotice('');
    setAnswer('');
    setResult(null);
    setRevealed(false);
    setActiveId(id);
  };

  const checkAnswer = () => {
    if (!current || !answer.trim()) return;
    const graded = gradeNceReview(current, answer);
    if (!graded.correct) {
      setResult(graded);
      setNotice('');
      return;
    }
    if (!onResolve(current)) {
      setNotice('这次改错未能保存，请检查浏览器存储空间，再试一次。');
      return;
    }
    tts.stop();
    setAnswer('');
    setResult(null);
    setRevealed(false);
    setNotice('答对并已保存，这题已移出待复习。');
    setActiveId(queue.find((item) => item.id !== current.id)?.id || '');
  };

  const unitName = (filename) => units.find((unit) => unit.filename === filename)?.title?.replace(/^\d+&\d+\./, '')
    || filename.replace(/^\d+&\d+\./, '');

  return (
    <section className="h-full overflow-y-auto bg-[#f7f5ef] p-4 pb-28">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-slate-500 mb-4 hover:text-slate-800"><ArrowLeft className="w-4 h-4" />第一册课程</button>
      <div className="relative overflow-hidden rounded-[30px] bg-[#102a43] p-6 text-white nce-grid-texture nce-reveal">
        <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-amber-300/15 blur-2xl" />
        <div className="relative">
          <p className="text-[11px] font-bold tracking-[0.2em] text-amber-300">REVIEW · NCE BOOK ONE</p>
          <div className="flex items-end justify-between gap-3 mt-4"><div><h1 className="editorial-serif text-3xl font-bold">薄弱点复盘</h1><p className="mt-2 text-xs leading-5 text-slate-300">先自己想，再核对；答对一题，清掉一题。</p></div><span className="text-5xl font-semibold text-amber-300 tabular-nums">{allCount}</span></div>
          <p className="mt-4 border-t border-white/15 pt-3 text-xs text-slate-300">听写、课后练习、单元试题的待复习项汇总在这里。原试卷和成绩仍保留。</p>
        </div>
      </div>

      {unitIds.length > 1 && <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar pb-1" aria-label="按单元筛选错题">
        <button type="button" onClick={() => { setUnitId(''); chooseItem(''); }} aria-pressed={!unitId} className={`flex-none rounded-xl px-3 py-2 text-xs font-semibold ${!unitId ? 'bg-[#102a43] text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>全部单元</button>
        {unitIds.map((id) => <button key={id} type="button" onClick={() => { setUnitId(id); chooseItem(''); }} aria-pressed={unitId === id} className={`flex-none rounded-xl px-3 py-2 text-xs font-semibold ${unitId === id ? 'bg-[#102a43] text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>{unitName(id)}</button>)}
      </div>}

      {notice && <p role="status" className={`mt-4 rounded-xl p-3 text-xs ${notice.includes('未能') ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`}>{notice}</p>}

      {!current ? <div className="mt-4 rounded-[26px] border border-emerald-100 bg-white p-7 text-center shadow-sm">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="w-7 h-7" /></span>
        <h2 className="mt-4 text-lg font-bold text-[#102a43]">{allCount ? '这个单元的错题已清空' : '待复习已清空'}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">可以回到课文继续学习，新的错题会自动出现在这里。</p>
        {allCount > 0 && <button type="button" onClick={() => { setUnitId(''); chooseItem(''); }} className="mt-5 rounded-xl bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-700">查看其他单元</button>}
        <button type="button" onClick={onBack} className="mt-3 block w-full rounded-xl bg-[#102a43] py-3 text-sm font-semibold text-white">返回课程地图</button>
      </div> : <>
        <div className="mt-4 flex items-center justify-between text-xs text-slate-500"><span>待复习 · {queue.length} 题</span><span>当前 {currentIndex + 1}/{queue.length}</span></div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar pb-1" aria-label="待复习题目">
          {queue.map((item, index) => <button key={item.id} type="button" onClick={() => chooseItem(item.id)} aria-current={current.id === item.id ? 'step' : undefined} aria-label={`第 ${index + 1} 题，${item.label}`} className={`h-9 min-w-9 flex-none rounded-xl px-2 text-xs font-bold transition-colors ${current.id === item.id ? 'bg-amber-500 text-[#102a43]' : 'bg-white border border-slate-200 text-slate-500'}`}>{String(index + 1).padStart(2, '0')}</button>)}
        </div>
        <div className="mt-3 rounded-[26px] border border-[#e7e2d8] bg-white p-5 shadow-[0_8px_24px_rgba(53,45,30,0.06)]">
          <div className="flex items-center justify-between gap-2"><span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-800">{current.label}</span><span className="truncate text-xs text-slate-400">{unitName(current.unitId)}</span></div>
          <h2 className="editorial-serif mt-5 text-xl font-bold leading-8 text-[#102a43]">{current.kind === 'dictation' ? '听音，写出这句英文' : current.kind === 'exercise' ? '补全课文句子' : '重新作答这道试题'}</h2>
          {current.kind === 'dictation' ? <div className="mt-4 rounded-2xl bg-sky-50 p-4"><button type="button" onClick={() => tts.speak(current.answer)} className="inline-flex items-center gap-2 rounded-xl bg-[#102a43] px-4 py-3 text-sm font-semibold text-white"><Volume2 className="w-4 h-4" />播放句子</button><p className="mt-2 text-xs text-sky-800/70">使用设备语音朗读，可反复播放；语音不可用时可返回原课文。</p></div> : <p className="mt-4 rounded-2xl bg-[#f7f5ef] p-4 text-[17px] leading-8 text-slate-800 editorial-serif">{current.prompt || '请回想本课内容并写出正确答案。'}</p>}
          <label htmlFor="nce-review-answer" className="mt-5 block text-xs font-semibold text-slate-600">{current.answer.trim().includes(' ') ? '写出完整英文句子' : '写出缺少的英文单词'}</label>
          <input key={current.id} id="nce-review-answer" value={answer} onChange={(event) => { setAnswer(event.target.value); setResult(null); }} onKeyDown={(event) => { if (event.key === 'Enter') checkAnswer(); }} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="先凭记忆输入，再检查" className="allow-select mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-amber-500" />
          <button type="button" onClick={checkAnswer} disabled={!answer.trim()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3.5 text-sm font-bold text-[#102a43] disabled:opacity-40">检查并完成复习<ArrowRight className="w-4 h-4" /></button>
          {result && <div role="status" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800"><p className="font-semibold">还差一点 · 匹配 {result.score}%</p>{result.missingWords.length > 0 && <p className="mt-1 text-xs">再想想这些词：{result.missingWords.join('、')}</p>}<button type="button" onClick={() => setRevealed((value) => !value)} className="mt-2 text-xs font-bold underline">{revealed ? '收起参考答案' : '查看参考答案'}</button>{revealed && <p className="mt-2 rounded-lg bg-white p-2 text-sm text-slate-800">{current.answer}</p>}</div>}
          {current.lastAttempt && <p className="mt-3 text-xs text-slate-400">上次作答：{current.lastAttempt}</p>}
          <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs"><button type="button" onClick={() => onOpenLesson(current.unitId)} disabled={!units.some((unit) => unit.filename === current.unitId)} className="inline-flex items-center gap-1 font-semibold text-sky-700 disabled:opacity-40"><BookOpen className="w-4 h-4" />回课文理解</button><button type="button" onClick={() => chooseItem(queue[(currentIndex + 1) % queue.length].id)} className="inline-flex items-center gap-1 font-semibold text-slate-500"><RotateCcw className="w-4 h-4" />稍后再做</button></div>
        </div>
        <p className="mt-4 px-2 text-center text-[11px] leading-5 text-slate-400"><Headphones className="mr-1 inline h-3.5 w-3.5" />听写按相似度 90% 及以上判定，词汇拼写需正确。</p>
      </>}
    </section>
  );
}
