import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, CheckCircle2, ChevronRight, Languages, Play, RotateCcw, Sparkles, Volume2 } from 'lucide-react';
import { tts } from '../services/speech';

const NCE1_BASE = 'https://nce.mleo.site/NCE1';
const PROGRESS_KEY = 'lingoflow_nce1_progress';

function parseLrc(text) {
  return String(text || '').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (!match) return [];
    const time = Number(match[1]) * 60 + Number(match[2]);
    const [en, zh = ''] = match[3].split('|').map((part) => part.trim());
    return en ? [{ id: `${time}-${en}`, time, en, zh }] : [];
  });
}

function safeAssetName(name) {
  return encodeURIComponent(name).replace(/%26/g, '%26');
}

function buildExercises(lines) {
  const usable = lines.filter((line) => line.en.split(/\s+/).length >= 4).slice(0, 3);
  if (usable.length === 0) return [];
  return usable.map((line, index) => {
    const words = line.en.replace(/[^A-Za-z' ]/g, '').split(/\s+/).filter(Boolean);
    const answer = words[Math.min(1, words.length - 1)];
    const masked = line.en.replace(new RegExp(`\\b${answer}\\b`, 'i'), '_____');
    const options = Array.from(new Set([answer, words[0], words.at(-1), 'please'])).slice(0, 4);
    return {
      id: `${line.id}-exercise`,
      type: index % 2 === 0 ? 'choice' : 'fill',
      prompt: index % 2 === 0 ? '选择句中缺少的单词' : '填写句子中的缺词',
      sentence: masked,
      answer: answer.toLowerCase(),
      options,
      zh: line.zh || '先听懂句子，再尝试复述。',
    };
  });
}

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch { return {}; }
}

export default function NewConcept() {
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
  const audioRef = useRef(null);

  useEffect(() => {
    fetch(`${NCE1_BASE}/book.json`)
      .then((res) => { if (!res.ok) throw new Error('课程目录加载失败'); return res.json(); })
      .then((data) => setUnits(data.units || []))
      .catch((err) => setError(`${err.message}。请确认设备联网后重试。`))
      .finally(() => setLoading(false));
  }, []);

  const exercises = useMemo(() => buildExercises(lines), [lines]);
  const currentExercise = exercises[exerciseIndex];
  const completedCount = units.filter((unit) => progress[unit.filename]?.status === 'completed').length;

  const saveProgress = (filename, patch) => {
    const next = { ...progress, [filename]: { ...(progress[filename] || {}), ...patch, lastStudiedAt: Date.now() } };
    setProgress(next);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
  };

  const openUnit = async (unit) => {
    setSelectedUnit(unit);
    setView('lesson');
    setLines([]);
    setError('');
    setExerciseIndex(0);
    setExerciseResult(null);
    setExerciseAnswer('');
    saveProgress(unit.filename, { status: progress[unit.filename]?.status === 'completed' ? 'completed' : 'learning' });
    try {
      const response = await fetch(`${NCE1_BASE}/${safeAssetName(unit.filename)}.lrc`);
      if (!response.ok) throw new Error('课文字幕暂时不可用');
      setLines(parseLrc(await response.text()));
    } catch (err) {
      setError(`${err.message}，可以先使用浏览器朗读或稍后重试。`);
    }
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
      if (selectedUnit) saveProgress(selectedUnit.filename, { exercisesCompleted: true });
      return;
    }
    setExerciseIndex((value) => value + 1);
  };

  const markComplete = () => {
    if (!selectedUnit) return;
    saveProgress(selectedUnit.filename, { status: 'completed', completedCount: (progress[selectedUnit.filename]?.completedCount || 0) + 1 });
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
          <div className="flex items-center justify-between text-sm mb-2"><span>第一册进度</span><span className="font-semibold text-sky-600">{completedCount}/{units.length || 144}</span></div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-sky-500 rounded-full" style={{ width: `${units.length ? (completedCount / units.length) * 100 : 0}%` }} /></div>
        </div>
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
      <button onClick={() => setView('lessons')} className="flex items-center gap-1 text-sm text-slate-500 mb-3"><ArrowLeft className="w-4 h-4" />第一册课程</button>
      <div className="flex items-start justify-between gap-3 mb-3"><div><p className="text-xs text-sky-600 font-semibold">{selectedUnit?.title}</p><h1 className="text-xl font-bold text-slate-900 mt-1">{selectedUnit?.title.replace(/^\d+&\d+\./, '')}</h1></div><button onClick={() => setShowChinese((value) => !value)} className="p-2 rounded-xl bg-slate-100 text-slate-600" title="切换中英"><Languages className="w-5 h-5" /></button></div>
      {error && <div className="rounded-xl bg-amber-50 text-amber-700 text-xs p-3 mb-3">{error}</div>}
      <audio ref={audioRef} src={audioUrl} controls className="w-full mb-3" onTimeUpdate={(event) => { const time = event.currentTarget.currentTime; const index = lines.findIndex((line, i) => time >= line.time && (i === lines.length - 1 || time < lines[i + 1].time)); if (index >= 0) setActiveLine(index); }} onEnded={() => selectedUnit && saveProgress(selectedUnit.filename, { audioPosition: 0 })} />
      <div className="flex gap-2 mb-3"><button onClick={() => setView('lesson')} className={`flex-1 py-2 rounded-xl text-sm font-semibold ${view === 'lesson' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 border'}`}>课文精读</button><button onClick={() => setView('exercise')} className={`flex-1 py-2 rounded-xl text-sm font-semibold ${view === 'exercise' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 border'}`}>练习题 {exercises.length ? `(${exercises.length})` : ''}</button></div>
      {view === 'lesson' ? <div className="space-y-2">{lines.length === 0 && !error && <div className="text-sm text-slate-400 text-center py-8">正在加载课文字幕…</div>}{lines.map((line, index) => <button key={line.id} onClick={() => playLine(line, index)} className={`w-full text-left rounded-2xl p-3 transition-colors ${activeLine === index ? 'bg-sky-50 ring-1 ring-sky-200' : 'bg-white border border-slate-200'}`}><span className="flex gap-2"><Volume2 className={`w-4 h-4 mt-1 shrink-0 ${activeLine === index ? 'text-sky-600' : 'text-slate-300'}`} /><span><span className="block text-[15px] leading-6 text-slate-800">{line.en}</span>{showChinese && line.zh && <span className="block text-xs leading-5 text-slate-500 mt-1">{line.zh}</span>}</span></span></button>)}</div> : <div className="rounded-2xl bg-white border border-slate-200 p-4">{currentExercise ? <><div className="flex items-center justify-between mb-3"><span className="text-xs text-slate-400">练习 {exerciseIndex + 1}/{exercises.length}</span><Sparkles className="w-4 h-4 text-amber-500" /></div><h2 className="font-semibold text-slate-800 mb-3">{currentExercise.prompt}</h2><p className="rounded-xl bg-slate-50 p-3 text-lg leading-8 mb-2">{currentExercise.sentence}</p><p className="text-xs text-slate-500 mb-4">{currentExercise.zh}</p>{currentExercise.type === 'choice' ? <div className="grid grid-cols-2 gap-2">{currentExercise.options.map((option) => <button key={option} onClick={() => answerExercise(option)} disabled={Boolean(exerciseResult)} className={`p-2 rounded-xl border text-sm ${exerciseResult && option.toLowerCase() === currentExercise.answer ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 hover:border-sky-300'}`}>{option}</button>)}</div> : <div className="flex gap-2"><input value={exerciseAnswer} onChange={(event) => setExerciseAnswer(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && answerExercise(exerciseAnswer)} placeholder="输入缺少的单词" className="flex-1 border border-slate-200 rounded-xl px-3 text-sm" /><button onClick={() => answerExercise(exerciseAnswer)} className="px-4 rounded-xl bg-sky-600 text-white text-sm">检查</button></div>}{exerciseResult && <div className={`mt-4 rounded-xl p-3 text-sm ${exerciseResult === 'correct' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{exerciseResult === 'correct' ? '答对了，可以继续。' : `再想想。答案是：${currentExercise.answer}`}<button onClick={nextExercise} className="block mt-2 font-semibold underline">{exerciseIndex + 1 >= exercises.length ? '完成练习' : '下一题'}</button></div>}</> : <div className="text-center py-8 text-sm text-slate-500">课文加载后会自动生成句子练习。</div>}</div>}
      <div className="flex gap-2 mt-4"><button onClick={() => { if (lines[activeLine]) playLine(lines[activeLine], activeLine); }} className="flex-1 py-2 rounded-xl bg-slate-900 text-white text-sm flex items-center justify-center gap-1"><Play className="w-4 h-4" />朗读当前句</button><button onClick={markComplete} className="flex-1 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-sm flex items-center justify-center gap-1"><CheckCircle2 className="w-4 h-4" />标记完成</button></div>
      <button onClick={() => { setExerciseIndex(0); setExerciseResult(null); setExerciseAnswer(''); }} className="w-full mt-2 py-2 text-xs text-slate-400 flex items-center justify-center gap-1"><RotateCcw className="w-3 h-3" />重置本课练习</button>
    </section>
  );
}
