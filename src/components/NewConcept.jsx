import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Languages,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Volume2,
  BookmarkPlus,
} from 'lucide-react';
import { tts } from '../services/speech';
import { StorageService } from '../services/storage';
import { buildExercises, extractWords, parseLrc, safeAssetName } from '../services/nce';

const NCE1_BASE = 'https://nce.mleo.site/NCE1';
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5];

function loadProgress() {
  return StorageService.getNceProgress();
}

function displayUnitTitle(unit) {
  return unit?.title?.replace(/^\d+&\d+\./, '') || '未命名课文';
}

function lessonRange(unit) {
  const match = unit?.filename?.match(/^(\d+)&(\d+)/);
  return match ? `第 ${Number(match[1])}–${Number(match[2])} 课` : '本课';
}

function isPromptLine(line) {
  return /^Lesson\s+\d+/i.test(line.en) || /^Listen to the tape/i.test(line.en);
}

function progressLabel(item) {
  if (item?.status === 'completed') return '已完成';
  if (item) return '学习中';
  return '未开始';
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
  const [followAudio, setFollowAudio] = useState(() => StorageService.getAppState().nceFollowAudio !== false);
  const [playbackRate, setPlaybackRate] = useState(() => {
    const savedRate = Number(StorageService.getAppState().ncePlaybackRate);
    return PLAYBACK_RATES.includes(savedRate) ? savedRate : 1;
  });
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [exerciseAnswer, setExerciseAnswer] = useState('');
  const [exerciseResult, setExerciseResult] = useState(null);
  const [exerciseFinished, setExerciseFinished] = useState(false);
  const [exerciseCorrectCount, setExerciseCorrectCount] = useState(0);
  const [progress, setProgress] = useState(() => loadProgress());
  const [courseSearch, setCourseSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('all');
  const [wordFilter, setWordFilter] = useState('');
  const [savedWords, setSavedWords] = useState(() => new Map(
    StorageService.getVocabulary().map((item) => [item.word.toLowerCase(), item]),
  ));
  const [wordSaveError, setWordSaveError] = useState('');
  const [isSavingAllWords, setIsSavingAllWords] = useState(false);
  const [usingOfflineCopy, setUsingOfflineCopy] = useState(false);
  const audioRef = useRef(null);
  const lineRefs = useRef({});
  const progressRef = useRef(progress);
  const lastSavedSecondRef = useRef(-1);
  const requestSeqRef = useRef(0);
  const autoResumedRef = useRef('');
  const requestAbortRef = useRef(null);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const cachedBook = StorageService.getNceCache().book;

    if (cachedBook?.units?.length) {
      setUnits(cachedBook.units);
      setLoading(false);
    }

    fetch(`${NCE1_BASE}/book.json`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('课程目录加载失败');
        return res.json();
      })
      .then((data) => {
        if (disposed) return;
        setUnits(data.units || []);
        const cache = StorageService.getNceCache();
        StorageService.saveNceCache({ ...cache, book: data, updatedAt: Date.now() });
        setUsingOfflineCopy(false);
      })
      .catch((err) => {
        if (disposed || err.name === 'AbortError') return;
        if (cachedBook?.units?.length) {
          setUsingOfflineCopy(true);
        } else {
          setError(`${err.message}。请确认设备联网后重试。`);
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, []);

  useEffect(() => () => {
    requestAbortRef.current?.abort();
    audioRef.current?.pause();
    tts.stop();
  }, []);

  const exercises = useMemo(() => buildExercises(lines), [lines]);
  const lessonWords = useMemo(() => extractWords(lines), [lines]);
  const filteredWords = useMemo(
    () => lessonWords.filter((item) => item.word.includes(wordFilter.trim().toLowerCase())),
    [lessonWords, wordFilter],
  );
  const currentExercise = exercises[exerciseIndex];
  const completedCount = units.filter((unit) => progress[unit.filename]?.status === 'completed').length;
  const learningCount = units.filter((unit) => progress[unit.filename] && progress[unit.filename]?.status !== 'completed').length;
  const exerciseCount = units.filter((unit) => progress[unit.filename]?.exercisesCompleted).length;
  const courseWordCount = [...savedWords.values()].filter((item) => item.tags?.includes('新概念英语')).length;
  const courseProgressPercent = units.length ? Math.round((completedCount / units.length) * 100) : 0;

  const latestUnit = useMemo(() => {
    const latestFilename = Object.entries(progress)
      .filter(([, item]) => item && typeof item === 'object')
      .sort((a, b) => (b[1].lastStudiedAt || 0) - (a[1].lastStudiedAt || 0))[0]?.[0];
    return units.find((unit) => unit.filename === latestFilename) || null;
  }, [progress, units]);

  const continueUnit = latestUnit || units[0] || null;
  const selectedUnitIndex = selectedUnit ? units.findIndex((unit) => unit.filename === selectedUnit.filename) : -1;
  const previousUnit = selectedUnitIndex > 0 ? units[selectedUnitIndex - 1] : null;
  const nextUnit = selectedUnitIndex >= 0 && selectedUnitIndex < units.length - 1 ? units[selectedUnitIndex + 1] : null;
  const currentProgress = selectedUnit ? progress[selectedUnit.filename] || {} : {};
  const unsavedWordCount = lessonWords.filter((item) => !savedWords.has(item.word)).length;

  const filteredUnits = useMemo(() => {
    const query = courseSearch.trim().toLowerCase();
    return units.filter((unit) => {
      const itemProgress = progress[unit.filename];
      const matchesQuery = !query || `${unit.title} ${unit.filename}`.toLowerCase().includes(query);
      const matchesFilter = courseFilter === 'all'
        || (courseFilter === 'completed' && itemProgress?.status === 'completed')
        || (courseFilter === 'learning' && itemProgress && itemProgress.status !== 'completed')
        || (courseFilter === 'pending' && !itemProgress);
      return matchesQuery && matchesFilter;
    });
  }, [courseFilter, courseSearch, progress, units]);

  const saveProgress = (filename, patch) => {
    const current = progressRef.current;
    const next = {
      ...current,
      [filename]: {
        ...(current[filename] || {}),
        ...patch,
        lastStudiedAt: Date.now(),
      },
    };
    progressRef.current = next;
    setProgress(next);
    if (!StorageService.saveNceProgress(next)) {
      setError('学习进度暂时无法保存。请导出备份或清理浏览器存储空间。');
    }
  };

  const openUnit = async (unit) => {
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    requestAbortRef.current?.abort();
    audioRef.current?.pause();
    tts.stop();

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
    setExerciseFinished(false);
    setExerciseCorrectCount(0);
    setExerciseAnswer('');
    setActiveLine(-1);
    setWordFilter('');
    setUsingOfflineCopy(false);
    lineRefs.current = {};
    lastSavedSecondRef.current = -1;
    saveProgress(unit.filename, {
      status: progressRef.current[unit.filename]?.status === 'completed' ? 'completed' : 'learning',
    });
    StorageService.saveAppState({ ...StorageService.getAppState(), lastNceLesson: unit.filename });

    const cachedLrc = StorageService.getNceCache().lessons?.[unit.filename];
    if (cachedLrc) setLines(parseLrc(cachedLrc));

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
      if (requestId !== requestSeqRef.current || (err.name === 'AbortError' && !timedOut)) return;
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

  useEffect(() => {
    if (!followAudio || activeLine < 0) return;
    lineRefs.current[activeLine]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeLine, followAudio]);

  const backToLessons = () => {
    requestSeqRef.current += 1;
    requestAbortRef.current?.abort();
    audioRef.current?.pause();
    tts.stop();
    setView('lessons');
    setSelectedUnit(null);
    setLines([]);
    setError('');
  };

  const audioUrl = selectedUnit ? `${NCE1_BASE}/${safeAssetName(selectedUnit.filename)}.mp3` : '';

  const playLine = (line, index) => {
    tts.stop();
    setActiveLine(index);
    if (audioRef.current && Number.isFinite(line.time)) {
      audioRef.current.currentTime = line.time;
      audioRef.current.play().catch(() => tts.speak(line.en));
    } else {
      tts.speak(line.en);
    }
  };

  const playCurrentLine = () => {
    const targetIndex = activeLine >= 0 ? activeLine : 0;
    if (lines[targetIndex]) playLine(lines[targetIndex], targetIndex);
  };

  const answerExercise = (answer) => {
    if (!currentExercise || exerciseResult) return;
    const normalized = String(answer || '').trim().toLowerCase();
    if (!normalized) return;
    setExerciseAnswer(answer);
    const isCorrect = normalized === currentExercise.answer;
    setExerciseResult(isCorrect ? 'correct' : 'wrong');
    if (isCorrect) setExerciseCorrectCount((value) => value + 1);
  };

  const retryExercise = () => {
    setExerciseResult(null);
    setExerciseAnswer('');
  };

  const resetExercise = () => {
    setExerciseIndex(0);
    setExerciseResult(null);
    setExerciseAnswer('');
    setExerciseFinished(false);
    setExerciseCorrectCount(0);
  };

  const nextExercise = () => {
    setExerciseResult(null);
    setExerciseAnswer('');
    if (exerciseIndex + 1 >= exercises.length) {
      if (selectedUnit) {
        const bestScore = Math.max(currentProgress.exerciseScore || 0, exerciseCorrectCount);
        saveProgress(selectedUnit.filename, { exercisesCompleted: true, exerciseScore: bestScore });
        StorageService.recordStudyActivity({ type: 'course', count: 1 });
      }
      setExerciseFinished(true);
      return;
    }
    setExerciseIndex((value) => value + 1);
  };

  const markComplete = () => {
    if (!selectedUnit) return;
    saveProgress(selectedUnit.filename, {
      status: 'completed',
      completedCount: (currentProgress.completedCount || 0) + 1,
    });
    StorageService.recordStudyActivity({ type: 'course', count: 1 });
  };

  const buildWordPayload = (item) => ({
    word: item.word,
    translation: '',
    contextSentence: item.sentence,
    contextSentenceCn: item.sentenceCn,
    tags: ['新概念英语', '第一册', displayUnitTitle(selectedUnit)],
  });

  const saveWord = (item) => {
    const saved = StorageService.addWord(buildWordPayload(item));
    if (!saved) {
      setWordSaveError('设备存储空间不足，这个单词没有保存。请先导出备份或清理浏览器空间。');
      return;
    }
    setWordSaveError('');
    StorageService.recordStudyActivity({ type: 'vocab', count: 1 });
    setSavedWords(new Map(StorageService.getVocabulary().map((word) => [word.word.toLowerCase(), word])));
  };

  const saveAllWords = () => {
    if (isSavingAllWords || unsavedWordCount === 0) return;
    setIsSavingAllWords(true);
    const nextSavedWords = new Map(savedWords);
    let addedCount = 0;
    lessonWords.forEach((item) => {
      if (nextSavedWords.has(item.word)) return;
      const saved = StorageService.addWord(buildWordPayload(item));
      if (saved) {
        nextSavedWords.set(item.word, saved);
        addedCount += 1;
      }
    });
    setSavedWords(nextSavedWords);
    setIsSavingAllWords(false);
    if (addedCount > 0) {
      setWordSaveError('');
      StorageService.recordStudyActivity({ type: 'vocab', count: addedCount });
    } else {
      setWordSaveError('单词没有保存成功，请检查浏览器存储空间。');
    }
  };

  const handleAudioTimeUpdate = (event) => {
    const time = event.currentTarget.currentTime;
    const index = lines.findIndex((line, lineIndex) => (
      time >= line.time && (lineIndex === lines.length - 1 || time < lines[lineIndex + 1].time)
    ));
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
    audioRef.current.playbackRate = playbackRate;
    const savedPosition = progressRef.current[selectedUnit.filename]?.audioPosition || 0;
    if (savedPosition > 0 && savedPosition < audioRef.current.duration - 2) {
      audioRef.current.currentTime = savedPosition;
    }
  };

  const changePlaybackRate = (rate) => {
    setPlaybackRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
    StorageService.saveAppState({ ...StorageService.getAppState(), ncePlaybackRate: rate });
  };

  const toggleFollowAudio = () => {
    setFollowAudio((value) => {
      const next = !value;
      StorageService.saveAppState({ ...StorageService.getAppState(), nceFollowAudio: next });
      return next;
    });
  };

  const goToAdjacentUnit = (unit) => {
    if (unit) openUnit(unit);
  };

  if (view === 'lessons') {
    return (
      <section className="h-full overflow-y-auto p-4 pb-28">
        <div className="rounded-[28px] bg-[#102a43] text-white p-5 shadow-lg shadow-slate-900/10 overflow-hidden relative">
          <div className="absolute -right-10 -top-12 w-40 h-40 rounded-full bg-sky-400/20 blur-2xl" />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] text-sky-200 font-semibold tracking-[0.18em]">COURSE · NCE 1</p>
                <h1 className="text-2xl font-bold mt-2 tracking-tight">新概念英语第一册</h1>
                <p className="text-xs text-slate-300 mt-2">每天完成一课：先听懂，再跟读，最后用练习确认记住。</p>
              </div>
              <BookOpen className="w-9 h-9 text-sky-200 shrink-0" />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-5">
              <div className="rounded-2xl bg-white/10 p-3"><span className="block text-xl font-bold">{completedCount}</span><span className="text-[11px] text-slate-300">已完成单元</span></div>
              <div className="rounded-2xl bg-white/10 p-3"><span className="block text-xl font-bold">{learningCount}</span><span className="text-[11px] text-slate-300">正在学习</span></div>
              <div className="rounded-2xl bg-white/10 p-3"><span className="block text-xl font-bold">{courseWordCount}</span><span className="text-[11px] text-slate-300">已收录词</span></div>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-sky-100"><span>第一册完成度</span><span>{courseProgressPercent}% · {completedCount}/{units.length || 72} 单元 · {exerciseCount} 个已做练习</span></div>
            <div className="h-2 bg-white/15 rounded-full overflow-hidden mt-2"><div className="h-full bg-sky-300 rounded-full transition-all" style={{ width: `${courseProgressPercent}%` }} /></div>
          </div>
        </div>

        {continueUnit && (
          <button onClick={() => openUnit(continueUnit)} className="w-full mt-4 rounded-2xl bg-white border border-sky-100 p-4 flex items-center gap-3 text-left shadow-sm hover:border-sky-300 transition-colors">
            <span className="w-11 h-11 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center"><Play className="w-5 h-5" /></span>
            <span className="flex-1 min-w-0"><span className="block text-[11px] text-sky-600 font-semibold">{latestUnit ? '继续上次学习' : '从第一课开始'}</span><span className="block font-semibold text-slate-800 mt-1 truncate">{displayUnitTitle(continueUnit)}</span><span className="block text-xs text-slate-400 mt-1">{lessonRange(continueUnit)} · 听读、单词、练习</span></span>
            <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
          </button>
        )}

        {usingOfflineCopy && <div className="rounded-xl bg-amber-50 text-amber-700 text-xs p-3 mt-3">当前使用已缓存的课程目录；恢复联网后会自动更新。</div>}
        {error && !selectedUnit && <div className="rounded-xl bg-rose-50 text-rose-700 text-sm p-3 mt-3">{error}</div>}

        <div className="mt-5 flex items-center justify-between gap-3">
          <div><p className="text-xs text-slate-400">COURSE MAP</p><h2 className="text-lg font-bold text-slate-900 mt-1">144 课学习地图</h2></div>
          <span className="text-xs text-slate-400">{filteredUnits.length}/{units.length || 72} 单元</span>
        </div>
        <div className="mt-3 flex items-center gap-2 bg-white rounded-2xl border border-slate-200 px-3 py-2.5">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input value={courseSearch} onChange={(event) => setCourseSearch(event.target.value)} placeholder="搜索课文标题或课号" className="bg-transparent outline-none text-sm flex-1 min-w-0 text-slate-800" />
          {courseSearch && <button type="button" onClick={() => setCourseSearch('')} className="text-xs text-slate-400 hover:text-slate-700">清除</button>}
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar mt-2 pb-1">
          {[['all', '全部'], ['pending', '未开始'], ['learning', '学习中'], ['completed', '已完成']].map(([value, label]) => (
            <button key={value} type="button" onClick={() => setCourseFilter(value)} aria-pressed={courseFilter === value} className={`flex-none px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${courseFilter === value ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'}`}>{label}</button>
          ))}
        </div>

        {loading && <div className="text-center text-sm text-slate-500 py-12">正在加载第一册课程目录…</div>}
        {!loading && filteredUnits.length === 0 && <div className="text-center bg-white rounded-2xl border border-slate-200 text-sm text-slate-500 py-12 mt-3">没有找到符合条件的课文。换个关键词或筛选条件试试。</div>}
        <div className="space-y-2 mt-3">
          {filteredUnits.map((unit) => {
            const originalIndex = units.findIndex((item) => item.filename === unit.filename);
            const itemProgress = progress[unit.filename];
            const completed = itemProgress?.status === 'completed';
            return (
              <button key={unit.filename} onClick={() => openUnit(unit)} className={`w-full text-left bg-white border rounded-2xl p-3 flex items-center gap-3 transition-colors ${completed ? 'border-emerald-100 hover:border-emerald-300' : 'border-slate-200 hover:border-sky-300'}`}>
                <span className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${completed ? 'bg-emerald-50 text-emerald-600' : itemProgress ? 'bg-amber-50 text-amber-600' : 'bg-sky-50 text-sky-600'}`}>{String(originalIndex * 2 + 1).padStart(3, '0')}</span>
                <span className="flex-1 min-w-0"><span className="block font-semibold text-slate-800 truncate">{displayUnitTitle(unit)}</span><span className="block text-xs text-slate-400 mt-1">{lessonRange(unit)} · {progressLabel(itemProgress)}{itemProgress?.exercisesCompleted ? ' · 练习完成' : ''}</span></span>
                {completed ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /> : <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />}
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  const exerciseScore = Math.min(exercises.length, exerciseCorrectCount);

  return (
    <section className="h-full overflow-y-auto p-4 pb-28">
      <button onClick={backToLessons} className="flex items-center gap-1 text-sm text-slate-500 mb-3 hover:text-slate-800"><ArrowLeft className="w-4 h-4" />第一册课程</button>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0"><p className="text-[11px] text-sky-600 font-semibold tracking-wide">UNIT {String(selectedUnitIndex + 1).padStart(2, '0')} · {lessonRange(selectedUnit)}</p><h1 className="text-xl font-bold text-slate-900 mt-1 truncate">{displayUnitTitle(selectedUnit)}</h1><p className="text-xs text-slate-400 mt-1">{progressLabel(currentProgress)}{currentProgress.exercisesCompleted ? ' · 练习已完成' : ''}</p></div>
        <button onClick={() => setShowChinese((value) => !value)} className={`shrink-0 p-2 rounded-xl border transition-colors ${showChinese ? 'bg-sky-50 text-sky-600 border-sky-100' : 'bg-white text-slate-500 border-slate-200'}`} title="切换中英"><Languages className="w-5 h-5" /></button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {[['lesson', '01 听读', lines.length ? '已载入' : '加载中'], ['vocab', `02 单词 · ${lessonWords.length}`, lessonWords.length ? `${lessonWords.length - unsavedWordCount}/${lessonWords.length} 已收录` : '等待课文'], ['exercise', `03 练习 · ${exercises.length}`, currentProgress.exercisesCompleted ? '已完成' : '待完成']].map(([step, label, hint]) => (
          <button key={step} type="button" onClick={() => setView(step)} className={`rounded-xl p-2 text-left border transition-colors ${view === step ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:border-sky-200'}`}><span className="block text-xs font-semibold truncate">{label}</span><span className={`block text-[10px] mt-1 truncate ${view === step ? 'text-sky-100' : 'text-slate-400'}`}>{hint}</span></button>
        ))}
      </div>

      {error && <div className="rounded-xl bg-amber-50 text-amber-700 text-xs p-3 mb-3">{error}</div>}
      {usingOfflineCopy && <div className="rounded-xl bg-amber-50 text-amber-700 text-xs p-3 mb-3">网络不可用，正在使用这课之前缓存的字幕；音频不可用时可以点击句子使用系统朗读。</div>}

      <div className="rounded-2xl bg-white border border-slate-200 p-3 mb-3 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-2"><span className="text-xs font-semibold text-slate-700">听读训练</span><div className="flex items-center gap-2"><label className="text-[11px] text-slate-400" htmlFor="nce-playback-rate">速度</label><select id="nce-playback-rate" value={playbackRate} onChange={(event) => changePlaybackRate(Number(event.target.value))} className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 text-slate-600"><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></div></div>
        <audio ref={audioRef} src={audioUrl} controls preload="metadata" className="w-full" onLoadedMetadata={restoreAudioPosition} onTimeUpdate={handleAudioTimeUpdate} onError={() => setError('这课音频暂时无法加载；可以点击下方句子使用系统朗读。')} onEnded={() => selectedUnit && saveProgress(selectedUnit.filename, { audioPosition: 0 })} />
        <div className="flex items-center justify-between gap-2 mt-2"><button type="button" onClick={playCurrentLine} className="text-xs text-sky-700 font-semibold flex items-center gap-1"><Play className="w-3.5 h-3.5" />{activeLine >= 0 ? '播放当前句' : '从第一句开始'}</button><button type="button" onClick={toggleFollowAudio} aria-pressed={followAudio} className={`text-xs px-2 py-1 rounded-lg transition-colors ${followAudio ? 'bg-sky-50 text-sky-700' : 'text-slate-400 hover:bg-slate-50'}`}>{followAudio ? '跟随播放：开' : '跟随播放：关'}</button></div>
      </div>

      {wordSaveError && <div className="rounded-xl bg-rose-50 text-rose-700 text-xs p-3 mb-3">{wordSaveError}</div>}

      {view === 'lesson' && (
        <div className="space-y-2">
          {lines.length === 0 && !error && <div className="text-sm text-slate-400 text-center py-8">正在加载课文字幕…</div>}
          {lines.map((line, index) => (
            <button key={line.id} ref={(node) => { lineRefs.current[index] = node; }} onClick={() => playLine(line, index)} aria-current={activeLine === index ? 'true' : undefined} className={`w-full text-left rounded-2xl p-3 transition-colors ${activeLine === index ? 'bg-sky-50 ring-1 ring-sky-200' : isPromptLine(line) ? 'bg-amber-50/70 border border-amber-100' : 'bg-white border border-slate-200'}`}>
              <span className="flex gap-2"><Volume2 className={`w-4 h-4 mt-1 shrink-0 ${activeLine === index ? 'text-sky-600' : 'text-slate-300'}`} /><span><span className={`block text-[15px] leading-6 ${isPromptLine(line) ? 'text-amber-900' : 'text-slate-800'}`}>{line.en}</span>{showChinese && line.zh && <span className="block text-xs leading-5 text-slate-500 mt-1">{line.zh}</span>}</span></span>
            </button>
          ))}
        </div>
      )}

      {view === 'vocab' && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3 mb-3"><div><h2 className="font-semibold text-slate-800">本课重点词</h2><p className="text-xs text-slate-400 mt-1">按出现频率排序 · 已收录 {lessonWords.length - unsavedWordCount}/{lessonWords.length}</p></div><button type="button" onClick={saveAllWords} disabled={isSavingAllWords || unsavedWordCount === 0} className="text-xs px-2.5 py-1.5 rounded-xl bg-sky-50 text-sky-700 font-semibold disabled:opacity-40 disabled:cursor-not-allowed">{isSavingAllWords ? '收录中…' : unsavedWordCount ? `一键收录 ${unsavedWordCount} 词` : '已全部收录'}</button></div>
          <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2 mb-3"><Search className="w-4 h-4 text-slate-400" /><input value={wordFilter} onChange={(event) => setWordFilter(event.target.value)} placeholder="筛选本课单词" className="bg-transparent outline-none text-sm flex-1" /></div>
          {selectedUnit && lessonWords.length === 0 ? <div className="text-center py-8 text-sm text-slate-500">课文加载后会生成本课重点词。</div> : <div className="space-y-2">{filteredWords.map((item) => { const saved = savedWords.has(item.word); return <div key={item.word} className="border border-slate-100 rounded-xl p-3"><div className="flex items-center gap-2"><button onClick={() => tts.speak(item.word)} className="text-sky-600" title={`朗读 ${item.word}`}><Volume2 className="w-4 h-4" /></button><span className="font-semibold text-slate-800">{item.word}</span><span className="text-xs text-slate-400">出现 {item.count} 次</span><button onClick={() => saved ? null : saveWord(item)} className={`ml-auto text-xs px-2 py-1 rounded-lg ${saved ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-50 text-sky-600'}`}>{saved ? <span className="flex items-center gap-1"><Check className="w-3 h-3" />已收录</span> : <span className="flex items-center gap-1"><BookmarkPlus className="w-3 h-3" />加入生词本</span>}</button></div><p className="text-xs text-slate-500 mt-2">{item.sentence}</p>{item.sentenceCn && <p className="text-xs text-slate-400 mt-1">{item.sentenceCn}</p>}</div>; })}</div>}
        </div>
      )}

      {view === 'exercise' && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          {exerciseFinished ? (
            <div className="text-center py-5"><div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto"><CheckCircle2 className="w-8 h-8" /></div><h2 className="font-bold text-slate-900 mt-3">本课练习完成</h2><p className="text-sm text-slate-500 mt-1">本次答对 {exerciseScore}/{exercises.length} 题，复习得分已保存。</p><div className="flex gap-2 justify-center mt-4"><button type="button" onClick={resetExercise} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" />再做一次</button><button type="button" onClick={() => setView('lesson')} className="px-3 py-2 rounded-xl bg-sky-600 text-white text-xs font-semibold">回到课文</button></div></div>
          ) : currentExercise ? (
            <><div className="flex items-center justify-between mb-3"><span className="text-xs text-slate-400">练习 {exerciseIndex + 1}/{exercises.length} · 本次答对 {exerciseCorrectCount} 题</span><Sparkles className="w-4 h-4 text-amber-500" /></div><h2 className="font-semibold text-slate-800 mb-3">{currentExercise.prompt}</h2><p className="rounded-xl bg-slate-50 p-3 text-lg leading-8 mb-2">{currentExercise.sentence}</p><p className="text-xs text-slate-500 mb-4">{currentExercise.zh}</p>{currentExercise.type === 'choice' ? <div className="grid grid-cols-2 gap-2">{currentExercise.options.map((option) => { const isCorrect = option.toLowerCase() === currentExercise.answer; const isSelected = exerciseAnswer.trim().toLowerCase() === option.toLowerCase(); const style = exerciseResult && isCorrect ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : exerciseResult && isSelected ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-slate-200 hover:border-sky-300'; return <button key={option} onClick={() => answerExercise(option)} disabled={Boolean(exerciseResult)} className={`p-2 rounded-xl border text-sm transition-colors ${style}`}>{option}</button>; })}</div> : <div className="flex gap-2"><input value={exerciseAnswer} onChange={(event) => setExerciseAnswer(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && answerExercise(exerciseAnswer)} disabled={Boolean(exerciseResult)} placeholder="输入缺少的单词" className="flex-1 border border-slate-200 rounded-xl px-3 text-sm" /><button onClick={() => answerExercise(exerciseAnswer)} disabled={Boolean(exerciseResult)} className="px-4 rounded-xl bg-sky-600 text-white text-sm disabled:opacity-40">检查</button></div>}{exerciseResult && <div className={`mt-4 rounded-xl p-3 text-sm ${exerciseResult === 'correct' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}><p>{exerciseResult === 'correct' ? '答对了，可以继续。' : `再想想。答案是：${currentExercise.answer}`}</p><div className="flex gap-3 mt-2"><button type="button" onClick={nextExercise} className="font-semibold underline">{exerciseIndex + 1 >= exercises.length ? '完成练习' : '下一题'}</button>{exerciseResult === 'wrong' && <button type="button" onClick={retryExercise} className="font-semibold underline">再试一次</button>}</div></div>}</>
          ) : <div className="text-center py-8 text-sm text-slate-500">课文加载后会自动生成句子练习。</div>}
        </div>
      )}

      <div className="flex gap-2 mt-4"><button onClick={playCurrentLine} className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-sm flex items-center justify-center gap-1"><Play className="w-4 h-4" />{activeLine >= 0 ? '朗读当前句' : '从第一句开始'}</button><button onClick={markComplete} className={`flex-1 py-2.5 rounded-xl text-sm flex items-center justify-center gap-1 ${currentProgress.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-50 text-emerald-700'}`}><CheckCircle2 className="w-4 h-4" />{currentProgress.status === 'completed' ? '已完成本课' : '标记完成'}</button></div>
      <div className="flex items-center justify-between gap-2 mt-3"><button type="button" onClick={() => goToAdjacentUnit(previousUnit)} disabled={!previousUnit} className="flex items-center gap-1 text-xs text-slate-500 disabled:opacity-30"><ChevronLeft className="w-4 h-4" />上一课</button><span className="text-[11px] text-slate-400">{selectedUnitIndex + 1}/{units.length || 72} 单元</span><button type="button" onClick={() => goToAdjacentUnit(nextUnit)} disabled={!nextUnit} className="flex items-center gap-1 text-xs text-slate-500 disabled:opacity-30">下一课<ChevronRight className="w-4 h-4" /></button></div>
      <button onClick={resetExercise} className="w-full mt-2 py-2 text-xs text-slate-400 flex items-center justify-center gap-1"><RotateCcw className="w-3 h-3" />重置本课练习</button>
    </section>
  );
}
