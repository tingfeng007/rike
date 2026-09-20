import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, CheckCircle2, ChevronRight, Languages, Play, RotateCcw, Sparkles, Volume2, BookmarkPlus, Check, Search } from 'lucide-react';
import { tts } from '../services/speech';
import { StorageService } from '../services/storage';
import { buildExercises, extractWords, parseLrc, safeAssetName } from '../services/nce';

const NCE1_BASE = 'https://nce.mleo.site/NCE1';

function loadProgress() {
  return StorageService.getNceProgress();
}

export default function NewConcept({ resumeLesson = '' }) {
  const [units, setUnits] = useState([]);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('lessons');
  const [showChinese, setShowChinese] = useState(true);
  const [activeLine, setActiveLine] = useState(-1);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [exerciseAnswer, setExerciseAnswer] = useState('');
  const [exerciseResult, setExerciseResult] = useState(null);
  const [progress, setProgress] = useState(() => loadProgress());
  const [wordFilter, setWordFilter] = useState('');
  const [savedWords, setSavedWords] = useState(() => new Map(StorageService.getVocabulary().map((item) => [item.word.toLowerCase(), item])));
  const [wordSaveError, setWordSaveError] = useState('');
  const [usingOfflineCopy, setUsingOfflineCopy] = useState(false);
  const audioRef = useRef(null);
  const lastSavedSecondRef = useRef(-1);
  const requestSeqRef = useRef(0);
  const autoResumedRef = useRef('');
  const requestAbortRef = useRef(null);

  useEffect(() => () => {
    requestAbortRef.current?.abort();
    audioRef.current?.pause();
    tts.stop();
  }, []);

  useEffect(() => {
    const cachedBook = StorageService.getNceCache().book;
    if (cachedBook?.units?.length) {
      setUnits(cachedBook.units);
      setLoading(false);
    }
    fetch(`${NCE1_BASE}/book.json`)
      .then((res) => { if (!res.ok) throw new Error('课程目录加载失败'); return res.json(); })
      .then((data) => {
        setUnits(data.units || []);
        const cache = StorageService.getNceCache();
        StorageService.saveNceCache({ ...cache, book: data, updatedAt: Date.now() });
        setUsingOfflineCopy(false);
      })
      .catch((err) => {
        if (cachedBook?.units?.length) {
          setUsingOfflineCopy(true);
        } else {
          setError(`${err.message}。请确认设备联网后重试。`);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const exercises = useMemo(() => buildExercises(lines), [lines]);
  const lessonWords = useMemo(() => extractWords(lines), [lines]);
  const filteredWords = useMemo(() => lessonWords.filter((item) => item.word.includes(wordFilter.trim().toLowerCase())), [lessonWords, wordFilter]);
  const currentExercise = exercises[exerciseIndex];
  const completedCount = units.filter((unit) => progress[unit.filename]?.status === 'completed').length;
  const latestUnit = useMemo(() => {
    const latestFilename = Object.entries(progress)
      .filter(([, item]) => item && typeof item === 'object')
      .sort((a, b) => (b[1].lastStudiedAt || 0) - (a[1].lastStudiedAt || 0))[0]?.[0];
    return units.find((unit) => unit.filename === latestFilename) || null;
  }, [progress, units]);

  const saveProgress = (filename, patch) => {
    const next = { ...progress, [filename]: { ...(progress[filename] || {}), ...patch, lastStudiedAt: Date.now() } };
    setProgress(next);
    if (!StorageService.saveNceProgress(next)) {
      setError('学习进度暂时无法保存。请导出备份或清理浏览器存储空间。');
    }
  };

  const openUnit = async (unit) => {
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12000);
    setSelectedUnit(unit);
    setView('lesson');
    setLines([]);
    setError('');
    setExerciseIndex(0);
    setExerciseResult(null);
    setExerciseAnswer('');
    setActiveLine(-1);
    setWordFilter('');
    setUsingOfflineCopy(false);
    saveProgress(unit.filename, { status: progress[unit.filename]?.status === 'completed' ? 'completed' : 'learning' });
    StorageService.saveAppState({ ...StorageService.getAppState(), lastNceLesson: unit.filename });
    const cachedLrc = StorageService.getNceCache().lessons?.[unit.filename];
    if (cachedLrc) {
      setLines(parseLrc(cachedLrc));
    }
    try {
      const response = await fetch(`${NCE1_BASE}/${safeAssetName(unit.filename)}.lrc`, { signal: controller.signal });
      if (!response.ok) throw new Error('课文字幕暂时不可用');
      const lrc = await response.text();
      if (requestId !== requestSeqRef.current) return;
      setLines(parseLrc(lrc));
      const cache = StorageService.getNceCache();
      StorageService.saveNceCache({
        ...cache,
        lessons: { ...(cache.lessons || {}), [unit.filename]: lrc },
        updatedAt: Date.now(),
      });
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      if (cachedLrc) {
        setUsingOfflineCopy(true);
      } else {
        setError(`${timedOut ? '课文加载超时' : err.message}，请稍后重试。`);
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  useEffect(() => {
    if (!resumeLesson || units.length === 0 || autoResumedRef.current === resumeLesson) return;
    const unit = units.find((item) => item.filename === resumeLesson);
    if (!unit) return;
    autoResumedRef.current = resumeLesson;
    openUnit(unit);
    // openUnit intentionally runs once for each explicit resume intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeLesson, units]);

  const backToLessons = () => {
    requestSeqRef.current += 1;
    requestAbortRef.current?.abort();
    audioRef.current?.pause();
    setView('lessons');
    setSelectedUnit(null);
    setLines([]);
    setError('');
  };

  const audioUrl = selectedUnit ? `${NCE1_BASE}/${safeAssetName(selectedUnit.filename)}.mp3` : '';

  const playLine = (line, index) => {
    setActiveLine(index);
    if (audioRef.current && Number.isFinite(line.time)) {
      audioRef.current.currentTime = line.time;
      audioRef.current.play().catch(() => tts.speak(line.en));
    } else {
      tts.speak(line.en);
    }
  };

  const answerExercise = (answer) => {
    if (!currentExercise) return;
    const normalized = answer.trim().toLowerCase();
    setExerciseAnswer(answer);
    setExerciseResult(normalized === currentExercise.answer ? 'correct' : 'wrong');
  };

  const nextExercise = () => {
    setExerciseResult(null);
    setExerciseAnswer('');
    if (exerciseIndex + 1 >= exercises.length) {
      if (selectedUnit) {
        saveProgress(selectedUnit.filename, { exercisesCompleted: true });
        StorageService.recordStudyActivity({ type: 'course', count: 1 });
      }
      return;
    }
    setExerciseIndex((value) => value + 1);
  };

  const markComplete = () => {
    if (!selectedUnit) return;
    saveProgress(selectedUnit.filename, { status: 'completed', completedCount: (progress[selectedUnit.filename]?.completedCount || 0) + 1 });
    StorageService.recordStudyActivity({ type: 'course', count: 1 });
  };

  const saveWord = (item) => {
    const saved = StorageService.addWord({
      word: item.word,
      translation: '',
      contextSentence: item.sentence,
      contextSentenceCn: item.sentenceCn,
      tags: ['新概念英语', '第一册', selectedUnit?.title || '当前课文'],
    });
    if (!saved) {
      setWordSaveError('设备存储空间不足，这个单词没有保存。请先导出备份或清理浏览器空间。');
      return;
    }
    setWordSaveError('');
    StorageService.recordStudyActivity({ type: 'vocab', count: 1 });
    setSavedWords(new Map(StorageService.getVocabulary().map((word) => [word.word.toLowerCase(), word])));
  };

  const handleAudioTimeUpdate = (event) => {
    const time = event.currentTarget.currentTime;
    const index = lines.findIndex((line, i) => time >= line.time && (i === lines.length - 1 || time < lines[i + 1].time));
    if (index >= 0) setActiveLine(index);
    if (!selectedUnit) return;
    const wholeSecond = Math.floor(time);
    if (wholeSecond % 5 === 0 && wholeSecond !== lastSavedSecondRef.current) {
      lastSavedSecondRef.current = wholeSecond;
      saveProgress(selectedUnit.filename, { audioPosition: time });
    }
  };

  const restoreAudioPosition = () => {
    if (!selectedUnit || !audioRef.current) return;
    const savedPosition = progress[selectedUnit.filename]?.audioPosition || 0;
    if (savedPosition > 0 && savedPosition < audioRef.current.duration - 2) {
      audioRef.current.currentTime = savedPosition;
    }
  };

  if (view === 'lessons') {
    return (
      <section className="h-full overflow-y-auto p-4 pb-28">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-sky-600 font-semibold tracking-wide">COURSE · NCE 1</p>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">新概念英语第一册</h1>
            <p className="text-xs text-slate-500 mt-1">听、读、点读、练习，完成一课再进入下一课</p>
          </div>
          <BookOpen className="w-8 h-8 text-sky-500" />
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-4 mb-4 shadow-sm">
          <div className="flex items-center justify-between text-sm mb-2"><span>第一册进度</span><span className="font-semibold text-sky-600">{completedCount}/{units.length || 72} 单元</span></div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-sky-500 rounded-full" style={{ width: `${units.length ? (completedCount / units.length) * 100 : 0}%` }} /></div>
        </div>
        {latestUnit && <button onClick={() => openUnit(latestUnit)} className="w-full mb-4 rounded-2xl bg-[#102a43] text-white p-4 flex items-center gap-3 text-left shadow-sm"><span className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center"><Play className="w-4 h-4" /></span><span className="flex-1"><span className="block text-xs text-sky-200">继续上次学习</span><span className="block font-semibold mt-1">{latestUnit.title.replace(/^\d+&\d+\./, '')}</span></span><ChevronRight className="w-5 h-5 text-slate-300" /></button>}
        {usingOfflineCopy && <div className="rounded-xl bg-amber-50 text-amber-700 text-xs p-3 mb-3">当前使用已缓存的课程目录；恢复联网后会自动更新。</div>}
        {loading && <div className="text-center text-sm text-slate-500 py-12">正在加载第一册课程目录…</div>}
        {error && !selectedUnit && <div className="rounded-xl bg-rose-50 text-rose-700 text-sm p-3 mb-3">{error}</div>}
        <div className="space-y-2">
          {units.map((unit, index) => {
            const itemProgress = progress[unit.filename];
            return <button key={unit.filename} onClick={() => openUnit(unit)} className="w-full text-left bg-white border border-slate-200 rounded-2xl p-3 flex items-center gap-3 hover:border-sky-300 transition-colors">
              <span className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center font-bold text-sm">{String(index * 2 + 1).padStart(3, '0')}</span>
              <span className="flex-1 min-w-0"><span className="block font-semibold text-slate-800 truncate">{unit.title.replace(/^\d+&\d+\./, '')}</span><span className="text-xs text-slate-400">{itemProgress?.status === 'completed' ? '已完成' : itemProgress ? '学习中' : '未开始'}</span></span>
              {itemProgress?.status === 'completed' ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <ChevronRight className="w-5 h-5 text-slate-300" />}
            </button>;
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="h-full overflow-y-auto p-4 pb-28">
      <button onClick={backToLessons} className="flex items-center gap-1 text-sm text-slate-500 mb-3"><ArrowLeft className="w-4 h-4" />第一册课程</button>
      <div className="flex items-start justify-between gap-3 mb-3"><div><p className="text-xs text-sky-600 font-semibold">{selectedUnit?.title}</p><h1 className="text-xl font-bold text-slate-900 mt-1">{selectedUnit?.title.replace(/^\d+&\d+\./, '')}</h1></div><button onClick={() => setShowChinese((value) => !value)} className="p-2 rounded-xl bg-slate-100 text-slate-600" title="切换中英"><Languages className="w-5 h-5" /></button></div>
      {error && <div className="rounded-xl bg-amber-50 text-amber-700 text-xs p-3 mb-3">{error}</div>}
      {usingOfflineCopy && <div className="rounded-xl bg-amber-50 text-amber-700 text-xs p-3 mb-3">网络不可用，正在使用这课之前缓存的字幕；音频不可用时可点击句子使用系统朗读。</div>}
      <audio ref={audioRef} src={audioUrl} controls className="w-full mb-3" onLoadedMetadata={restoreAudioPosition} onTimeUpdate={handleAudioTimeUpdate} onEnded={() => selectedUnit && saveProgress(selectedUnit.filename, { audioPosition: 0 })} />
      <div className="flex gap-2 mb-3"><button onClick={() => setView('lesson')} className={`flex-1 py-2 rounded-xl text-sm font-semibold ${view === 'lesson' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 border'}`}>课文精读</button><button onClick={() => setView('vocab')} className={`flex-1 py-2 rounded-xl text-sm font-semibold ${view === 'vocab' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border'}`}>本课单词 {lessonWords.length ? `(${lessonWords.length})` : ''}</button><button onClick={() => setView('exercise')} className={`flex-1 py-2 rounded-xl text-sm font-semibold ${view === 'exercise' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 border'}`}>练习题 {exercises.length ? `(${exercises.length})` : ''}</button></div>
      {wordSaveError && <div className="rounded-xl bg-rose-50 text-rose-700 text-xs p-3 mb-3">{wordSaveError}</div>}
      {view === 'lesson' ? <div className="space-y-2">{lines.length === 0 && !error && <div className="text-sm text-slate-400 text-center py-8">正在加载课文字幕…</div>}{lines.map((line, index) => <button key={line.id} onClick={() => playLine(line, index)} className={`w-full text-left rounded-2xl p-3 transition-colors ${activeLine === index ? 'bg-sky-50 ring-1 ring-sky-200' : 'bg-white border border-slate-200'}`}><span className="flex gap-2"><Volume2 className={`w-4 h-4 mt-1 shrink-0 ${activeLine === index ? 'text-sky-600' : 'text-slate-300'}`} /><span><span className="block text-[15px] leading-6 text-slate-800">{line.en}</span>{showChinese && line.zh && <span className="block text-xs leading-5 text-slate-500 mt-1">{line.zh}</span>}</span></span></button>)}</div> : view === 'vocab' ? <div className="rounded-2xl bg-white border border-slate-200 p-4"><div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2 mb-3"><Search className="w-4 h-4 text-slate-400" /><input value={wordFilter} onChange={(event) => setWordFilter(event.target.value)} placeholder="筛选本课单词" className="bg-transparent outline-none text-sm flex-1" /></div>{selectedUnit && lessonWords.length === 0 ? <div className="text-center py-8 text-sm text-slate-500">课文加载后会生成本课重点词。</div> : <div className="space-y-2">{filteredWords.map((item) => { const saved = savedWords.has(item.word); return <div key={item.word} className="border border-slate-100 rounded-xl p-3"><div className="flex items-center gap-2"><button onClick={() => tts.speak(item.word)} className="text-sky-600"><Volume2 className="w-4 h-4" /></button><span className="font-semibold text-slate-800">{item.word}</span><span className="text-xs text-slate-400">出现 {item.count} 次</span><button onClick={() => saved ? null : saveWord(item)} className={`ml-auto text-xs px-2 py-1 rounded-lg ${saved ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-50 text-sky-600'}`}>{saved ? <span className="flex items-center gap-1"><Check className="w-3 h-3" />已收录</span> : <span className="flex items-center gap-1"><BookmarkPlus className="w-3 h-3" />加入生词本</span>}</button></div><p className="text-xs text-slate-500 mt-2">{item.sentence}</p>{item.sentenceCn && <p className="text-xs text-slate-400 mt-1">{item.sentenceCn}</p>}</div>; })}</div>}</div> : <div className="rounded-2xl bg-white border border-slate-200 p-4">{currentExercise ? <><div className="flex items-center justify-between mb-3"><span className="text-xs text-slate-400">练习 {exerciseIndex + 1}/{exercises.length}</span><Sparkles className="w-4 h-4 text-amber-500" /></div><h2 className="font-semibold text-slate-800 mb-3">{currentExercise.prompt}</h2><p className="rounded-xl bg-slate-50 p-3 text-lg leading-8 mb-2">{currentExercise.sentence}</p><p className="text-xs text-slate-500 mb-4">{currentExercise.zh}</p>{currentExercise.type === 'choice' ? <div className="grid grid-cols-2 gap-2">{currentExercise.options.map((option) => <button key={option} onClick={() => answerExercise(option)} disabled={Boolean(exerciseResult)} className={`p-2 rounded-xl border text-sm ${exerciseResult && option.toLowerCase() === currentExercise.answer ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 hover:border-sky-300'}`}>{option}</button>)}</div> : <div className="flex gap-2"><input value={exerciseAnswer} onChange={(event) => setExerciseAnswer(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && answerExercise(exerciseAnswer)} placeholder="输入缺少的单词" className="flex-1 border border-slate-200 rounded-xl px-3 text-sm" /><button onClick={() => answerExercise(exerciseAnswer)} className="px-4 rounded-xl bg-sky-600 text-white text-sm">检查</button></div>}{exerciseResult && <div className={`mt-4 rounded-xl p-3 text-sm ${exerciseResult === 'correct' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{exerciseResult === 'correct' ? '答对了，可以继续。' : `再想想。答案是：${currentExercise.answer}`}<button onClick={nextExercise} className="block mt-2 font-semibold underline">{exerciseIndex + 1 >= exercises.length ? '完成练习' : '下一题'}</button></div>}</> : <div className="text-center py-8 text-sm text-slate-500">课文加载后会自动生成句子练习。</div>}</div>}
      <div className="flex gap-2 mt-4"><button onClick={() => { if (lines[activeLine]) playLine(lines[activeLine], activeLine); }} className="flex-1 py-2 rounded-xl bg-slate-900 text-white text-sm flex items-center justify-center gap-1"><Play className="w-4 h-4" />朗读当前句</button><button onClick={markComplete} className="flex-1 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-sm flex items-center justify-center gap-1"><CheckCircle2 className="w-4 h-4" />标记完成</button></div>
      <button onClick={() => { setExerciseIndex(0); setExerciseResult(null); setExerciseAnswer(''); }} className="w-full mt-2 py-2 text-xs text-slate-400 flex items-center justify-center gap-1"><RotateCcw className="w-3 h-3" />重置本课练习</button>
    </section>
  );
}
