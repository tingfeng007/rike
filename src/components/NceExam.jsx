import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, Clock3, FileText, RotateCcw, Trophy } from 'lucide-react';
import { StorageService } from '../services/storage';
import { buildNceExamQuestions, gradeNceExam } from '../services/nceExam';
import { parseLrc, safeAssetName } from '../services/nce';

function unitTitle(unit) {
  return unit?.title?.replace(/^\d+&\d+\./, '') || unit?.filename || '未命名单元';
}

function timeLabel(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function NceExam({ units, baseUrl, initialUnitFilename, onBack, onOpenLesson, onComplete }) {
  const [data, setData] = useState(() => StorageService.getNceExams());
  const dataRef = useRef(data);
  const [screen, setScreen] = useState(() => data.draft ? 'paper' : 'home');
  const [unitId, setUnitId] = useState(() => data.draft?.unitId || initialUnitFilename || '');
  const [selectedAttemptId, setSelectedAttemptId] = useState(null);
  const [showAllResults, setShowAllResults] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [preparing, setPreparing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const abortRef = useRef(null);

  const persist = useCallback((next) => {
    dataRef.current = next;
    setData(next);
    setSaveError(StorageService.saveNceExams(next)
      ? '' : '本次答卷未能保存到设备。请检查浏览器存储空间。');
  }, []);

  const finishExam = useCallback((expired = false) => {
    const current = dataRef.current;
    const draft = current.draft;
    if (!draft) return;
    const graded = gradeNceExam(draft.questions, draft.answers);
    const attempt = {
      ...graded,
      id: `${draft.startedAt}-${draft.unitId}`,
      unitId: draft.unitId,
      title: draft.title,
      startedAt: draft.startedAt,
      submittedAt: Date.now(),
      expired,
    };
    persist({ attempts: [attempt, ...current.attempts].slice(0, 30), draft: null });
    onComplete?.(attempt);
    StorageService.recordStudyActivity({ type: 'course', count: 1 });
    setSelectedAttemptId(attempt.id);
    setShowAllResults(false);
    setScreen('results');
  }, [persist, onComplete]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!dataRef.current.draft) return;
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime >= dataRef.current.draft.deadline) finishExam(true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [finishExam]);

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const startExam = async () => {
    const unit = units.find((item) => item.filename === unitId) || units[0];
    if (!unit || preparing) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12000);
    setPreparing(true);
    setLoadError('');

    try {
      const cache = StorageService.getNceCache();
      let lessonText = cache.lessons?.[unit.filename];
      if (!lessonText) {
        const response = await fetch(`${baseUrl}/${safeAssetName(unit.filename)}.lrc`, { signal: controller.signal });
        if (!response.ok) throw new Error('课文暂时无法下载');
        lessonText = await response.text();
        StorageService.saveNceCache({
          ...cache,
          lessons: { ...(cache.lessons || {}), [unit.filename]: lessonText },
          updatedAt: Date.now(),
        });
      }
      if (controller.signal.aborted) return;
      const questions = buildNceExamQuestions(parseLrc(lessonText), unit.filename);
      if (questions.length < 3) throw new Error('本单元可生成的试题不足，请选择另一单元');
      const startedAt = Date.now();
      const minutes = Math.max(5, Math.ceil(questions.length * 1.25));
      persist({ ...dataRef.current, draft: {
        unitId: unit.filename,
        title: unitTitle(unit),
        questions,
        answers: {},
        currentIndex: 0,
        startedAt,
        deadline: startedAt + minutes * 60_000,
      } });
      setNow(startedAt);
      setScreen('paper');
    } catch (error) {
      if (controller.signal.aborted && !timedOut) return;
      if (timedOut) {
        setLoadError('加载超时，请检查网络后重试；已缓存的课文可离线组卷。');
      } else {
        setLoadError(error.message || '组卷失败，请稍后再试。');
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (abortRef.current === controller) {
        abortRef.current = null;
        setPreparing(false);
      }
    }
  };

  const updateDraft = (patch) => {
    const current = dataRef.current;
    if (!current.draft) return;
    persist({ ...current, draft: { ...current.draft, ...patch } });
  };

  const draft = data.draft;
  const selectedUnit = units.find((unit) => unit.filename === unitId) || units[0];
  const attempt = data.attempts.find((item) => item.id === selectedAttemptId) || data.attempts[0];

  if (screen === 'paper' && draft) {
    const remaining = Math.max(0, Math.ceil((draft.deadline - now) / 1000));
    const currentIndex = Math.min(draft.currentIndex || 0, draft.questions.length - 1);
    const question = draft.questions[currentIndex];
    const answered = draft.questions.filter((item) => String(draft.answers[item.id] || '').trim()).length;
    const selected = draft.answers[question.id] || '';
    return (
      <section className="study-page h-full overflow-y-auto p-4 pb-28">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 mb-4"><ArrowLeft className="w-4 h-4" />退出试卷 · 自动保存</button>
        <div className="nce-exam-paper rounded-[28px] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5 nce-reveal">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-[10px] font-bold tracking-[0.2em] text-amber-600">NCE I · UNIT TEST</p><h1 className="editorial-serif mt-1 text-2xl font-bold text-[#102a43]">{draft.title}</h1><p className="mt-1 text-xs text-slate-500">第一册单元测验 · {draft.questions.length} 题</p></div>
            <div className={`rounded-xl px-3 py-2 text-sm font-bold tabular-nums ${remaining < 60 ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-700'}`} role="timer" aria-label={`剩余时间 ${timeLabel(remaining)}`}><Clock3 className="w-4 h-4 inline mr-1.5" />{timeLabel(remaining)}</div>
          </div>
          <div className="flex items-center justify-between mt-6 text-xs text-slate-500"><span>作答进度 <strong className="text-slate-900">{answered}/{draft.questions.length}</strong></span><span>第 {currentIndex + 1} 题</span></div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-2"><div className="h-full bg-amber-500 transition-all" style={{ width: `${answered / draft.questions.length * 100}%` }} /></div>
          <div className="mt-5 grid grid-cols-5 gap-2" aria-label="试题导航">
            {draft.questions.map((item, index) => <button key={item.id} type="button" aria-label={`第 ${index + 1} 题${draft.answers[item.id] ? '，已作答' : '，未作答'}`} aria-current={currentIndex === index ? 'step' : undefined} onClick={() => updateDraft({ currentIndex: index })} className={`h-9 rounded-xl text-xs font-bold transition-colors ${currentIndex === index ? 'bg-[#102a43] text-white' : draft.answers[item.id] ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-400'}`}>{String(index + 1).padStart(2, '0')}</button>)}
          </div>
          <div className="border-t border-dashed border-slate-200 mt-6 pt-5">
            <p className="text-[11px] tracking-[0.14em] text-amber-600 font-bold">{question.type === 'choice' ? '01 / 句意选择' : '02 / 单词拼写'}</p>
            <h2 className="text-sm font-semibold text-slate-700 mt-2">{question.prompt}</h2>
            <p className="editorial-serif text-xl leading-8 text-[#102a43] mt-3">{question.question}</p>
            {question.type === 'fill' && <p className="text-xs text-slate-500 mt-2">中文提示：{question.translation}</p>}
            {question.type === 'choice' ? (
              <fieldset className="mt-5 space-y-2"><legend className="sr-only">选择答案</legend>{question.options.map((option, index) => <label key={option} className={`flex items-start gap-3 border rounded-2xl px-3 py-3 cursor-pointer transition-colors ${selected === option ? 'border-[#102a43] bg-sky-50' : 'border-slate-200 hover:border-sky-300'}`}><input type="radio" name={`exam-${question.id}`} checked={selected === option} onChange={() => updateDraft({ answers: { ...draft.answers, [question.id]: option } })} className="mt-1 accent-[#102a43]" /><span className="text-xs font-bold text-slate-400 mt-0.5">{String.fromCharCode(65 + index)}</span><span className="editorial-serif text-[15px] leading-6 text-slate-800">{option}</span></label>)}</fieldset>
            ) : <div className="mt-5"><label htmlFor="nce-exam-answer" className="text-xs text-slate-500">只填写缺少的那个英文单词</label><input id="nce-exam-answer" value={selected} onChange={(event) => updateDraft({ answers: { ...draft.answers, [question.id]: event.target.value } })} autoComplete="off" spellCheck="false" placeholder="输入单词" className="allow-select w-full mt-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-amber-500" /></div>}
          </div>
          <div className="flex items-center justify-between gap-2 mt-8"><button type="button" disabled={currentIndex === 0} onClick={() => updateDraft({ currentIndex: currentIndex - 1 })} className="inline-flex items-center gap-1 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-500 disabled:opacity-30"><ChevronLeft className="w-4 h-4" />上一题</button><button type="button" onClick={() => currentIndex === draft.questions.length - 1 ? finishExam() : updateDraft({ currentIndex: currentIndex + 1 })} className="inline-flex items-center gap-1 rounded-xl bg-[#102a43] px-4 py-2.5 text-xs font-semibold text-white">{currentIndex === draft.questions.length - 1 ? '交卷评分' : '下一题'}<ChevronRight className="w-4 h-4" /></button></div>
        </div>
        <button type="button" onClick={() => finishExam()} className="mt-4 w-full py-3 text-sm font-semibold text-amber-700 bg-amber-50 rounded-xl border border-amber-100">交卷 · {draft.questions.length - answered} 题未作答</button>
        <p className="text-center text-xs text-slate-400 mt-3">答题时不显示答案；到时自动交卷。退出后可继续。</p>
        {saveError && <p role="alert" className="mt-3 text-xs text-rose-700">{saveError}</p>}
      </section>
    );
  }

  if (screen === 'results' && attempt) {
    const displayed = showAllResults ? attempt.results : attempt.results.filter((item) => !item.isCorrect);
    return (
      <section className="study-page h-full overflow-y-auto p-4 pb-28">
        <button type="button" onClick={() => setScreen('home')} className="flex items-center gap-1.5 text-sm text-slate-500 mb-4"><ArrowLeft className="w-4 h-4" />返回试题中心</button>
        <div className="rounded-[30px] bg-[#102a43] text-white p-6 nce-grid-texture nce-reveal"><p className="text-[11px] tracking-[0.2em] text-amber-300 font-bold">EXAM REPORT</p><div className="flex items-end justify-between gap-3 mt-3"><div><h1 className="editorial-serif text-2xl font-bold">{attempt.title}</h1><p className="text-xs text-slate-300 mt-1">{attempt.expired ? '时间到，已自动交卷' : '答卷已提交'} · {attempt.correct}/{attempt.total} 题正确</p></div><div className="text-5xl font-bold tabular-nums text-amber-300">{attempt.score}<span className="text-base text-slate-300">分</span></div></div><div className="h-2 rounded-full bg-white/15 mt-5 overflow-hidden"><div className="h-full bg-amber-300" style={{ width: `${attempt.score}%` }} /></div></div>
        <div className="grid grid-cols-3 gap-2 mt-3 text-center"><div className="bg-white rounded-2xl p-3"><strong className="block text-lg text-emerald-600">{attempt.correct}</strong><span className="text-[11px] text-slate-500">答对</span></div><div className="bg-white rounded-2xl p-3"><strong className="block text-lg text-rose-600">{attempt.total - attempt.correct - attempt.unanswered}</strong><span className="text-[11px] text-slate-500">答错</span></div><div className="bg-white rounded-2xl p-3"><strong className="block text-lg text-slate-600">{attempt.unanswered}</strong><span className="text-[11px] text-slate-500">未答</span></div></div>
        <div className="flex gap-2 mt-4"><button type="button" onClick={() => { setUnitId(attempt.unitId); setScreen('home'); }} className="flex-1 inline-flex justify-center items-center gap-1.5 rounded-xl bg-[#102a43] text-white py-3 text-xs font-semibold"><RotateCcw className="w-4 h-4" />再测一次</button><button type="button" onClick={() => onOpenLesson(units.find((unit) => unit.filename === attempt.unitId))} className="flex-1 inline-flex justify-center items-center gap-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 py-3 text-xs font-semibold"><BookOpen className="w-4 h-4" />回课文复习</button></div>
        <div className="flex items-center justify-between mt-6 mb-3"><div><p className="text-[10px] font-bold tracking-[0.2em] text-amber-600">ANSWER REVIEW</p><h2 className="text-lg font-bold text-[#102a43] mt-1">{showAllResults ? '全部试题' : '错题回看'}</h2></div><button type="button" onClick={() => setShowAllResults((value) => !value)} className="text-xs font-semibold text-sky-700">{showAllResults ? '只看错题' : '查看全部'}</button></div>
        {displayed.length === 0 && <p className="rounded-2xl bg-emerald-50 text-emerald-800 p-5 text-sm">本次全部答对，可以开始下一单元。</p>}
        <div className="space-y-3">{displayed.map((item) => <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><span className="text-[10px] font-bold text-slate-400">{item.type === 'choice' ? '句意选择' : '单词拼写'} · 第 {attempt.results.findIndex((result) => result.id === item.id) + 1} 题</span><span className={`text-xs font-bold ${item.isCorrect ? 'text-emerald-600' : 'text-rose-600'}`}>{item.isCorrect ? '答对' : '需复习'}</span></div><p className="text-sm text-slate-800 mt-3 leading-6">{item.question}</p><p className="text-xs text-slate-500 mt-2">你的答案：{item.submitted || '未作答'}</p><p className="text-xs text-emerald-700 mt-1">正确答案：{item.answer}</p><p className="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-100">课文原句：{item.source} · {item.translation}</p></article>)}</div>
        {saveError && <p role="alert" className="mt-3 text-xs text-rose-700">{saveError}</p>}
      </section>
    );
  }

  return (
    <section className="study-page h-full overflow-y-auto p-4 pb-28">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 mb-4"><ArrowLeft className="w-4 h-4" />第一册课程</button>
      <div className="rounded-[30px] bg-[#102a43] text-white p-6 nce-grid-texture relative overflow-hidden nce-reveal"><div className="absolute -right-10 -top-10 w-36 h-36 bg-amber-400/15 rounded-full blur-2xl" /><div className="relative"><p className="text-[11px] tracking-[0.22em] text-amber-300 font-bold">EXAM · NCE BOOK ONE</p><FileText className="w-10 h-10 text-amber-300 mt-4" /><h1 className="editorial-serif text-3xl font-bold mt-3">第一册试题中心</h1><p className="text-sm leading-6 text-slate-300 mt-2">像正式测验一样独立作答，交卷后再看答案与错题。</p><div className="flex gap-2 mt-5 text-[11px]"><span className="bg-white/10 rounded-full px-3 py-1.5">限时答卷</span><span className="bg-white/10 rounded-full px-3 py-1.5">自动评分</span><span className="bg-white/10 rounded-full px-3 py-1.5">错题回看</span></div></div></div>
      {data.draft && <div className="mt-4 rounded-2xl bg-amber-50 border border-amber-200 p-4"><p className="font-semibold text-amber-900">有一份未交卷试题</p><p className="text-xs text-amber-800 mt-1">{data.draft.title} · 已作答 {Object.values(data.draft.answers || {}).filter((value) => String(value).trim()).length}/{data.draft.questions.length} 题</p><button type="button" onClick={() => setScreen('paper')} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-amber-800">继续答卷<ArrowRight className="w-4 h-4" /></button></div>}
      <div className="mt-4 rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><span className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center"><FileText className="w-5 h-5" /></span><div><h2 className="font-bold text-[#102a43]">生成单元试卷</h2><p className="text-xs text-slate-500 mt-0.5">从课文句子生成，不是教材原版试题</p></div></div><label htmlFor="nce-exam-unit" className="block text-xs font-semibold text-slate-600 mt-5 mb-2">选择考试单元</label><select id="nce-exam-unit" value={selectedUnit?.filename || ''} onChange={(event) => setUnitId(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-800 outline-none focus:border-amber-500">{units.map((unit, index) => <option key={unit.filename} value={unit.filename}>{String(index * 2 + 1).padStart(3, '0')} · {unitTitle(unit)}</option>)}</select><div className="grid grid-cols-2 gap-2 mt-4 text-xs"><div className="rounded-xl bg-slate-50 p-3"><span className="block font-bold text-slate-800">句意选择 + 单词拼写</span><span className="block text-slate-500 mt-1">题型组合</span></div><div className="rounded-xl bg-slate-50 p-3"><span className="block font-bold text-slate-800">约 5–13 分钟</span><span className="block text-slate-500 mt-1">按实际题量计时</span></div></div><button type="button" onClick={startExam} disabled={preparing || !selectedUnit} className="w-full mt-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#102a43] py-3.5 font-bold text-sm disabled:opacity-50">{preparing ? '正在组卷…' : data.draft ? '覆盖草稿并重新组卷' : '开始单元测验'}</button>{loadError && <p role="alert" className="mt-3 text-xs text-rose-600">{loadError}</p>}</div>
      <div className="mt-6"><div className="flex items-center justify-between"><div><p className="text-[10px] tracking-[0.18em] text-amber-600 font-bold">YOUR RECORD</p><h2 className="text-lg font-bold text-[#102a43] mt-1">历次成绩</h2></div><Trophy className="w-5 h-5 text-amber-500" /></div>{data.attempts.length === 0 ? <p className="mt-3 rounded-2xl bg-white border border-slate-200 p-5 text-sm text-slate-500">完成第一份试卷后，成绩会留在这里。</p> : <div className="mt-3 space-y-2">{data.attempts.slice(0, 10).map((item) => <button key={item.id} type="button" onClick={() => { setSelectedAttemptId(item.id); setShowAllResults(false); setScreen('results'); }} className="w-full flex items-center gap-3 text-left rounded-2xl bg-white border border-slate-200 p-3"><span className={`w-12 h-12 rounded-xl grid place-items-center text-lg font-bold ${item.score >= 80 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{item.score}</span><span className="flex-1 min-w-0"><span className="block text-sm font-semibold text-slate-800 truncate">{item.title}</span><span className="block text-[11px] text-slate-500 mt-1">{new Date(item.submittedAt).toLocaleString('zh-CN')} · {item.correct}/{item.total} 题</span></span><ChevronRight className="w-4 h-4 text-slate-300" /></button>)}</div>}</div>
      {saveError && <p role="alert" className="mt-3 text-xs text-rose-700">{saveError}</p>}
    </section>
  );
}
