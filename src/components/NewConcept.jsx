import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Languages,
  NotebookPen,
  Play,
  Repeat2,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Volume2,
  BookmarkPlus,
} from 'lucide-react';
import NceDictation from './NceDictation';
import NceExam from './NceExam';
import NceReview from './NceReview';
import { tts } from '../services/speech';
import { StorageService } from '../services/storage';
import { buildDictationItems, buildExercises, extractWords, parseLrc, safeAssetName } from '../services/nce';
import { buildNceReviewQueue, resolveNceReviewMistake } from '../services/nceReview';

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

function pendingReviewCount(item) {
  return (item?.exerciseMistakes?.length || 0)
    + (item?.dictationMistakes?.length || 0)
    + (item?.examMistakes?.length || 0);
}

export default function NewConcept({ resumeLesson = '', entryIntent = '' }) {
  const [units, setUnits] = useState([]);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => entryIntent === 'review' || entryIntent === 'exam' ? entryIntent : 'lessons');
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
  const [showNotes, setShowNotes] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const [repeatRemaining, setRepeatRemaining] = useState(0);
  const [examUnitFilename, setExamUnitFilename] = useState('');
  const [reviewUnitFilename, setReviewUnitFilename] = useState('');
  const [usingOfflineCopy, setUsingOfflineCopy] = useState(false);
  const audioRef = useRef(null);
  const lineRefs = useRef({});
  const progressRef = useRef(progress);
  const lastSavedSecondRef = useRef(-1);
  const requestSeqRef = useRef(0);
  const autoResumedRef = useRef('');
  const requestAbortRef = useRef(null);
  const sentenceLoopRef = useRef({ lineIndex: -1, remaining: 0 });
  const ttsLoopRef = useRef(0);

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
    ttsLoopRef.current += 1;
    sentenceLoopRef.current = { lineIndex: -1, remaining: 0 };
    tts.stop();
  }, []);

  const exercises = useMemo(() => buildExercises(lines), [lines]);
  const dictationItems = useMemo(() => buildDictationItems(lines), [lines]);
  const lessonWords = useMemo(() => extractWords(lines), [lines]);
  const filteredWords = useMemo(
    () => lessonWords.filter((item) => item.word.includes(wordFilter.trim().toLowerCase())),
    [lessonWords, wordFilter],
  );
  const currentExercise = exercises[exerciseIndex];
  const completedCount = units.filter((unit) => progress[unit.filename]?.status === 'completed').length;
  const learningCount = units.filter((unit) => progress[unit.filename] && progress[unit.filename]?.status !== 'completed').length;
  const exerciseCount = units.filter((unit) => progress[unit.filename]?.exercisesCompleted).length;
  const dictationCount = units.filter((unit) => progress[unit.filename]?.dictationCompleted).length;
  const examCount = units.reduce((total, unit) => total + (progress[unit.filename]?.examAttempts || 0), 0);
  const reviewCount = units.filter((unit) => pendingReviewCount(progress[unit.filename]) > 0).length;
  const reviewItemCount = useMemo(() => buildNceReviewQueue(progress).length, [progress]);
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
  const bookmarkedLineIds = new Set(currentProgress.bookmarkedLineIds || []);
  const currentReviewCount = pendingReviewCount(currentProgress);
  const masterySteps = [
    Boolean(currentProgress.listenCompleted),
    Boolean(currentProgress.dictationCompleted),
    Boolean(currentProgress.vocabViewed),
    Boolean(currentProgress.exercisesCompleted),
  ];
  const masteryCount = masterySteps.filter(Boolean).length;

  const filteredUnits = useMemo(() => {
    const query = courseSearch.trim().toLowerCase();
    return units.filter((unit) => {
      const itemProgress = progress[unit.filename];
      const matchesQuery = !query || `${unit.title} ${unit.filename}`.toLowerCase().includes(query);
      const matchesFilter = courseFilter === 'all'
        || (courseFilter === 'completed' && itemProgress?.status === 'completed')
        || (courseFilter === 'learning' && itemProgress && itemProgress.status !== 'completed')
        || (courseFilter === 'pending' && !itemProgress)
        || (courseFilter === 'review' && pendingReviewCount(itemProgress) > 0);
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
    setShowNotes(false);
    setNoteDraft(progressRef.current[unit.filename]?.note || '');
    setNoteSaved(Boolean(progressRef.current[unit.filename]?.note));
    setRepeatRemaining(0);
    setUsingOfflineCopy(false);
    lineRefs.current = {};
    sentenceLoopRef.current = { lineIndex: -1, remaining: 0 };
    ttsLoopRef.current += 1;
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
    ttsLoopRef.current += 1;
    sentenceLoopRef.current = { lineIndex: -1, remaining: 0 };
    setRepeatRemaining(0);
    tts.stop();
    setView('lessons');
    setReviewUnitFilename('');
    setSelectedUnit(null);
    setLines([]);
    setError('');
  };

  const openExam = (unit = null) => {
    requestSeqRef.current += 1;
    requestAbortRef.current?.abort();
    audioRef.current?.pause();
    sentenceLoopRef.current = { lineIndex: -1, remaining: 0 };
    ttsLoopRef.current += 1;
    tts.stop();
    setRepeatRemaining(0);
    setSelectedUnit(null);
    setLines([]);
    setError('');
    setExamUnitFilename(unit?.filename || continueUnit?.filename || '');
    setView('exam');
  };

  const openReview = (unit = null) => {
    requestSeqRef.current += 1;
    requestAbortRef.current?.abort();
    audioRef.current?.pause();
    ttsLoopRef.current += 1;
    tts.stop();
    setReviewUnitFilename(unit?.filename || '');
    setView('review');
  };

  const handleResolveReview = (item) => {
    const current = progressRef.current;
    const next = resolveNceReviewMistake(current, item);
    if (next === current) return false;
    if (!StorageService.saveNceProgress(next)) return false;
    progressRef.current = next;
    setProgress(next);
    StorageService.recordStudyActivity({ type: 'course', count: 1 });
    return true;
  };

  const handleExamComplete = (attempt) => {
    const previous = progressRef.current[attempt.unitId] || {};
    saveProgress(attempt.unitId, {
      examAttempts: (previous.examAttempts || 0) + 1,
      examScore: attempt.score,
      examBest: Math.max(previous.examBest || 0, attempt.score),
      examMistakes: attempt.results.filter((result) => !result.isCorrect).map((result) => ({
        id: result.id,
        question: result.question,
        answer: result.answer,
        submitted: result.submitted,
      })),
    });
  };

  const audioUrl = selectedUnit ? `${NCE1_BASE}/${safeAssetName(selectedUnit.filename)}.mp3` : '';

  const cancelSentenceLoop = (stopAudio = false) => {
    ttsLoopRef.current += 1;
    sentenceLoopRef.current = { lineIndex: -1, remaining: 0 };
    setRepeatRemaining(0);
    if (stopAudio) audioRef.current?.pause();
  };

  const playTtsLoop = async (line, repeats) => {
    const loopToken = ttsLoopRef.current + 1;
    ttsLoopRef.current = loopToken;
    setRepeatRemaining(repeats);
    for (let index = repeats; index > 0; index -= 1) {
      if (ttsLoopRef.current !== loopToken) return;
      setRepeatRemaining(index);
      await tts.speak(line.en);
    }
    if (ttsLoopRef.current === loopToken) setRepeatRemaining(0);
  };

  const playSentenceSegment = (lineIndex, repeats = 1) => {
    const line = lines[lineIndex];
    if (!line) return;
    cancelSentenceLoop(true);
    tts.stop();
    setActiveLine(lineIndex);

    if (audioRef.current && Number.isFinite(line.time)) {
      sentenceLoopRef.current = { lineIndex, remaining: repeats };
      setRepeatRemaining(repeats);
      audioRef.current.currentTime = line.time;
      audioRef.current.play().catch(() => {
        sentenceLoopRef.current = { lineIndex: -1, remaining: 0 };
        playTtsLoop(line, repeats);
      });
      return;
    }
    playTtsLoop(line, repeats);
  };

  const playLine = (line, index) => {
    cancelSentenceLoop();
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

  const repeatCurrentLine = () => {
    const targetIndex = activeLine >= 0 ? activeLine : 0;
    playSentenceSegment(targetIndex, 3);
  };

  const toggleRepeatCurrentLine = () => {
    if (repeatRemaining > 0) {
      cancelSentenceLoop(true);
      tts.stop();
      return;
    }
    repeatCurrentLine();
  };

  const answerExercise = (answer) => {
    if (!currentExercise || exerciseResult) return;
    const normalized = String(answer || '').trim().toLowerCase();
    if (!normalized) return;
    setExerciseAnswer(answer);
    const isCorrect = normalized === currentExercise.answer;
    setExerciseResult(isCorrect ? 'correct' : 'wrong');
    if (isCorrect) setExerciseCorrectCount((value) => value + 1);

    if (selectedUnit) {
      const lessonProgress = progressRef.current[selectedUnit.filename] || {};
      const previousMistakes = lessonProgress.exerciseMistakes || [];
      const remainingMistakes = previousMistakes.filter((item) => item.id !== currentExercise.id);
      const exerciseMistakes = isCorrect ? remainingMistakes : [
        ...remainingMistakes,
        {
          id: currentExercise.id,
          sentence: currentExercise.sentence,
          answer: currentExercise.answer,
          attempt: normalized,
          updatedAt: Date.now(),
        },
      ];
      saveProgress(selectedUnit.filename, { exerciseMistakes });
    }
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

  const changeLearningView = (nextView) => {
    setView(nextView);
    if (!selectedUnit) return;
    if (nextView === 'vocab') saveProgress(selectedUnit.filename, { vocabViewed: true });
  };

  const toggleLineBookmark = (lineId) => {
    if (!selectedUnit) return;
    const lessonProgress = progressRef.current[selectedUnit.filename] || {};
    const bookmarkIds = new Set(lessonProgress.bookmarkedLineIds || []);
    if (bookmarkIds.has(lineId)) bookmarkIds.delete(lineId);
    else bookmarkIds.add(lineId);
    saveProgress(selectedUnit.filename, { bookmarkedLineIds: [...bookmarkIds] });
  };

  const saveLessonNote = () => {
    if (!selectedUnit) return;
    saveProgress(selectedUnit.filename, { note: noteDraft.trim(), noteUpdatedAt: Date.now() });
    setNoteSaved(true);
  };

  const handleDictationResult = (item, result, attempt) => {
    if (!selectedUnit) return;
    const lessonProgress = progressRef.current[selectedUnit.filename] || {};
    const previousMistakes = lessonProgress.dictationMistakes || [];
    const remainingMistakes = previousMistakes.filter((mistake) => mistake.id !== item.id);
    const dictationMistakes = result.score >= 90 ? remainingMistakes : [
      ...remainingMistakes,
      {
        id: item.id,
        text: item.text,
        attempt,
        score: result.score,
        missingWords: result.missingWords,
        updatedAt: Date.now(),
      },
    ];
    saveProgress(selectedUnit.filename, { dictationMistakes });
  };

  const handleDictationComplete = (averageScore) => {
    if (!selectedUnit) return;
    const lessonProgress = progressRef.current[selectedUnit.filename] || {};
    saveProgress(selectedUnit.filename, {
      dictationCompleted: true,
      dictationBest: Math.max(lessonProgress.dictationBest || 0, averageScore),
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
    const sentenceLoop = sentenceLoopRef.current;
    if (sentenceLoop.remaining > 0 && sentenceLoop.lineIndex >= 0) {
      const startTime = lines[sentenceLoop.lineIndex]?.time || 0;
      const endTime = lines[sentenceLoop.lineIndex + 1]?.time || event.currentTarget.duration;
      if (Number.isFinite(endTime) && time >= endTime - 0.08) {
        if (sentenceLoop.remaining > 1) {
          sentenceLoopRef.current = { ...sentenceLoop, remaining: sentenceLoop.remaining - 1 };
          setRepeatRemaining(sentenceLoop.remaining - 1);
          event.currentTarget.currentTime = startTime;
          event.currentTarget.play().catch(() => {});
        } else {
          event.currentTarget.pause();
          sentenceLoopRef.current = { lineIndex: -1, remaining: 0 };
          setRepeatRemaining(0);
        }
        setActiveLine(sentenceLoop.lineIndex);
        return;
      }
    }
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

  const handleAudioEnded = () => {
    const wasLooping = sentenceLoopRef.current.remaining > 0;
    cancelSentenceLoop();
    if (selectedUnit && !wasLooping) {
      saveProgress(selectedUnit.filename, { audioPosition: 0, listenCompleted: true });
    }
  };

  const goToAdjacentUnit = (unit) => {
    if (unit) openUnit(unit);
  };

  if (view === 'lessons') {
    return (
      <section className="study-page h-full overflow-y-auto p-4 pb-28">
        <div className="rounded-[30px] bg-[#102a43] text-white p-5 shadow-xl shadow-slate-900/15 overflow-hidden relative nce-grid-texture nce-reveal">
          <div className="absolute -right-10 -top-12 w-40 h-40 rounded-full bg-sky-400/20 blur-2xl" />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] text-sky-200 font-semibold tracking-[0.18em]">COURSE · NCE 1</p>
                <h1 className="text-2xl font-bold mt-2 tracking-tight">新概念英语第一册</h1>
                <p className="text-xs text-slate-300 mt-2 leading-5">听读建立语感，听写主动回忆，最后用练习巩固。</p>
              </div>
              <BookOpen className="w-9 h-9 text-sky-200 shrink-0" />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-5">
              <div className="rounded-2xl bg-white/10 p-3"><span className="block text-xl font-bold">{completedCount}</span><span className="text-[11px] text-slate-300">已完成单元</span></div>
              <div className="rounded-2xl bg-white/10 p-3"><span className="block text-xl font-bold">{learningCount}</span><span className="text-[11px] text-slate-300">正在学习</span></div>
              <div className="rounded-2xl bg-white/10 p-3"><span className="block text-xl font-bold">{reviewCount}</span><span className="text-[11px] text-slate-300">待复习单元</span></div>
              <div className="rounded-2xl bg-white/10 p-3"><span className="block text-xl font-bold">{courseWordCount}</span><span className="text-[11px] text-slate-300">已收录词</span></div>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-sky-100"><span>第一册完成度</span><span>{courseProgressPercent}% · {completedCount}/{units.length || 72} 单元</span></div>
            <div className="h-2 bg-white/15 rounded-full overflow-hidden mt-2"><div className="h-full bg-sky-300 rounded-full transition-all" style={{ width: `${courseProgressPercent}%` }} /></div>
            <p className="text-[10px] text-slate-400 mt-2">已完成 {dictationCount} 次听写 · {exerciseCount} 个单元练习 · {examCount} 份试题</p>
          </div>
        </div>

        {continueUnit && (
          <button onClick={() => openUnit(continueUnit)} className="w-full mt-4 rounded-2xl bg-white border border-sky-100 p-4 flex items-center gap-3 text-left shadow-sm hover:border-sky-300 transition-colors">
            <span className="w-11 h-11 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center"><Play className="w-5 h-5" /></span>
            <span className="flex-1 min-w-0"><span className="block text-[11px] text-sky-600 font-semibold">{latestUnit ? '继续上次学习' : '从第一课开始'}</span><span className="block font-semibold text-slate-800 mt-1 truncate editorial-serif">{displayUnitTitle(continueUnit)}</span><span className="block text-xs text-slate-400 mt-1">{lessonRange(continueUnit)} · 听读、听写、单词、练习</span></span>
            <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
          </button>
        )}

        <button type="button" onClick={() => openExam()} className="w-full mt-3 relative overflow-hidden rounded-[24px] bg-[#f3e7ce] border border-amber-200 p-4 flex items-center gap-3 text-left shadow-sm hover:border-amber-400 transition-colors nce-reveal">
          <span className="absolute -right-3 -top-8 text-8xl font-black text-amber-950/5 pointer-events-none">A+</span>
          <span className="relative w-12 h-12 rounded-2xl bg-[#102a43] text-amber-300 flex items-center justify-center shrink-0"><FileText className="w-6 h-6" /></span>
          <span className="relative flex-1 min-w-0"><span className="block text-[10px] tracking-[0.16em] font-bold text-amber-900/70">EXAM · 第一册</span><span className="block text-lg font-bold text-[#102a43] mt-0.5 editorial-serif">试题中心</span><span className="block text-xs text-amber-900/70 mt-1">限时测验 · 交卷评分 · 错题回看</span></span>
          <ChevronRight className="relative w-5 h-5 text-amber-900/50 shrink-0" />
        </button>

        {reviewItemCount > 0 && (
          <button type="button" onClick={() => openReview()} className="w-full mt-2 rounded-2xl bg-amber-50 border border-amber-100 p-3 flex items-center gap-3 text-left hover:border-amber-300 transition-colors">
            <span className="w-9 h-9 rounded-xl bg-white text-amber-600 flex items-center justify-center"><RotateCcw className="w-4 h-4" /></span>
            <span className="flex-1"><span className="block text-sm font-semibold text-amber-900">逐题复盘薄弱点</span><span className="block text-xs text-amber-700/70 mt-0.5">{reviewItemCount} 项待重练 · 答对后移出列表</span></span>
            <ChevronRight className="w-4 h-4 text-amber-400" />
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
          {[['all', '全部'], ['pending', '未开始'], ['learning', '学习中'], ['review', `待复习 ${reviewCount}`], ['completed', '已完成']].map(([value, label]) => (
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
            const itemReviewCount = pendingReviewCount(itemProgress);
            return (
              <button key={unit.filename} onClick={() => openUnit(unit)} className={`w-full text-left bg-white border rounded-2xl p-3 flex items-center gap-3 transition-colors ${completed ? 'border-emerald-100 hover:border-emerald-300' : 'border-slate-200 hover:border-sky-300'}`}>
                <span className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${completed ? 'bg-emerald-50 text-emerald-600' : itemProgress ? 'bg-amber-50 text-amber-600' : 'bg-sky-50 text-sky-600'}`}>{String(originalIndex * 2 + 1).padStart(3, '0')}</span>
                <span className="flex-1 min-w-0"><span className="block font-semibold text-slate-800 truncate editorial-serif">{displayUnitTitle(unit)}</span><span className="block text-xs text-slate-400 mt-1">{lessonRange(unit)} · {progressLabel(itemProgress)}{itemProgress?.dictationCompleted ? ' · 听写完成' : ''}{itemProgress?.exercisesCompleted ? ' · 练习完成' : ''}{itemProgress?.examAttempts ? ` · 测验最佳 ${itemProgress.examBest} 分` : ''}{itemReviewCount ? ` · ${itemReviewCount} 项待复习` : ''}</span></span>
                {completed ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /> : <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />}
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  if (view === 'exam') {
    return <NceExam key={examUnitFilename} units={units} baseUrl={NCE1_BASE} initialUnitFilename={examUnitFilename} onBack={backToLessons} onOpenLesson={(unit) => unit && openUnit(unit)} onComplete={handleExamComplete} />;
  }

  if (view === 'review') {
    return <NceReview progress={progress} units={units} initialUnitFilename={reviewUnitFilename} onResolve={handleResolveReview} onOpenLesson={(filename) => { const unit = units.find((item) => item.filename === filename); if (unit) openUnit(unit); }} onBack={backToLessons} />;
  }

  const exerciseScore = Math.min(exercises.length, exerciseCorrectCount);

  return (
    <section className="study-page h-full overflow-y-auto p-4 pb-28">
      <button onClick={backToLessons} className="flex items-center gap-1 text-sm text-slate-500 mb-3 hover:text-slate-800"><ArrowLeft className="w-4 h-4" />第一册课程</button>
      <div className="rounded-[28px] bg-gradient-to-br from-white via-white to-sky-50 border border-white p-4 mb-3 shadow-sm nce-reveal">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-[11px] text-sky-600 font-semibold tracking-[0.14em]">UNIT {String(selectedUnitIndex + 1).padStart(2, '0')} · {lessonRange(selectedUnit)}</p><h1 className="text-2xl font-bold text-slate-900 mt-1 truncate editorial-serif">{displayUnitTitle(selectedUnit)}</h1><p className="text-xs text-slate-400 mt-1">{progressLabel(currentProgress)} · 掌握 {masteryCount}/4{currentReviewCount ? ` · ${currentReviewCount} 项待复习` : ''}</p></div>
          <div className="flex gap-1.5 shrink-0"><button type="button" onClick={() => setShowNotes((value) => !value)} className={`p-2 rounded-xl border transition-colors ${showNotes || currentProgress.note ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-white text-slate-500 border-slate-200'}`} title="本课笔记"><NotebookPen className="w-5 h-5" /></button><button onClick={() => setShowChinese((value) => !value)} className={`p-2 rounded-xl border transition-colors ${showChinese ? 'bg-sky-50 text-sky-600 border-sky-100' : 'bg-white text-slate-500 border-slate-200'}`} title="切换中英"><Languages className="w-5 h-5" /></button></div>
        </div>
        <div className="grid grid-cols-4 gap-1.5 mt-4">{[['听读', masterySteps[0]], ['听写', masterySteps[1]], ['单词', masterySteps[2]], ['练习', masterySteps[3]]].map(([label, done]) => <div key={label} className={`rounded-xl px-2 py-1.5 text-center text-[10px] font-semibold ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>{done ? '✓ ' : ''}{label}</div>)}</div>
      </div>

      {showNotes && <div className="rounded-2xl bg-amber-50/80 border border-amber-100 p-3 mb-3 nce-reveal"><div className="flex items-center justify-between"><span className="text-xs font-bold text-amber-900">本课学习笔记</span><span className="text-[10px] text-amber-700/70">只保存在当前设备</span></div><textarea value={noteDraft} onChange={(event) => { setNoteDraft(event.target.value); setNoteSaved(false); }} rows={3} placeholder="记下易错词、语法点或自己的例句…" className="allow-select w-full mt-2 rounded-xl bg-white/80 border border-amber-100 p-3 text-sm leading-6 outline-none focus:border-amber-300" /><button type="button" onClick={saveLessonNote} className={`mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${noteSaved ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-600 text-white'}`}><Save className="w-3.5 h-3.5" />{noteSaved ? '笔记已保存' : '保存笔记'}</button></div>}

      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {[['lesson', '01 听读', lines.length ? '已载入' : '加载中'], ['dictation', '02 听写', currentProgress.dictationCompleted ? `${currentProgress.dictationBest || 0} 分` : `${dictationItems.length} 句`], ['vocab', '03 单词', lessonWords.length ? `${lessonWords.length - unsavedWordCount}/${lessonWords.length}` : '等待'], ['exercise', '04 练习', currentProgress.exercisesCompleted ? `${currentProgress.exerciseScore || 0}/${exercises.length}` : `${exercises.length} 题`]].map(([step, label, hint]) => (
          <button key={step} type="button" onClick={() => changeLearningView(step)} className={`rounded-xl p-2 text-center border transition-all ${view === step ? 'bg-[#102a43] text-white border-[#102a43] shadow-sm -translate-y-0.5' : 'bg-white text-slate-600 border-slate-200 hover:border-sky-200'}`}><span className="block text-[11px] font-semibold truncate">{label}</span><span className={`block text-[9px] mt-1 truncate ${view === step ? 'text-sky-200' : 'text-slate-400'}`}>{hint}</span></button>
        ))}
      </div>

      {error && <div className="rounded-xl bg-amber-50 text-amber-700 text-xs p-3 mb-3">{error}</div>}
      {usingOfflineCopy && <div className="rounded-xl bg-amber-50 text-amber-700 text-xs p-3 mb-3">网络不可用，正在使用这课之前缓存的字幕；音频不可用时可以点击句子使用系统朗读。</div>}

      <div className="sticky top-2 z-10 rounded-2xl bg-white/95 backdrop-blur-xl border border-white p-3 mb-3 shadow-lg shadow-slate-900/5">
        <div className="flex items-center justify-between gap-3 mb-2"><span className="text-xs font-semibold text-slate-700">听读训练</span><div className="flex items-center gap-2"><label className="text-[11px] text-slate-400" htmlFor="nce-playback-rate">速度</label><select id="nce-playback-rate" value={playbackRate} onChange={(event) => changePlaybackRate(Number(event.target.value))} className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 text-slate-600"><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></div></div>
        <audio ref={audioRef} src={audioUrl} controls preload="metadata" className="w-full" onLoadedMetadata={restoreAudioPosition} onTimeUpdate={handleAudioTimeUpdate} onError={() => setError('这课音频暂时无法加载；可以点击下方句子使用系统朗读。')} onEnded={handleAudioEnded} />
        <div className="flex items-center gap-1.5 mt-2 overflow-x-auto no-scrollbar"><button type="button" onClick={playCurrentLine} className="flex-none text-xs text-sky-700 font-semibold flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-50"><Play className="w-3.5 h-3.5" />{activeLine >= 0 ? '从当前句播放' : '从第一句开始'}</button><button type="button" onClick={toggleRepeatCurrentLine} disabled={lines.length === 0} className="flex-none text-xs text-amber-700 font-semibold flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 disabled:opacity-40"><Repeat2 className="w-3.5 h-3.5" />{repeatRemaining ? `停止循环 · ${repeatRemaining}` : '当前句 ×3'}</button><button type="button" onClick={toggleFollowAudio} aria-pressed={followAudio} className={`flex-none text-xs px-2 py-1 rounded-lg transition-colors ${followAudio ? 'bg-emerald-50 text-emerald-700' : 'text-slate-400 bg-slate-50'}`}>{followAudio ? '跟随：开' : '跟随：关'}</button></div>
      </div>

      {wordSaveError && <div className="rounded-xl bg-rose-50 text-rose-700 text-xs p-3 mb-3">{wordSaveError}</div>}

      {view === 'lesson' && (
        <div className="space-y-2">
          {lines.length === 0 && !error && <div className="text-sm text-slate-400 text-center py-8">正在加载课文字幕…</div>}
          {lines.map((line, index) => {
            const bookmarked = bookmarkedLineIds.has(line.id);
            return (
              <div key={line.id} ref={(node) => { lineRefs.current[index] = node; }} className={`relative rounded-2xl transition-all ${activeLine === index ? 'bg-sky-50 ring-1 ring-sky-200 shadow-sm' : isPromptLine(line) ? 'bg-amber-50/70 border border-amber-100' : 'bg-white border border-slate-200'}`}>
                <button type="button" onClick={() => playLine(line, index)} aria-current={activeLine === index ? 'true' : undefined} className="w-full text-left rounded-2xl p-3 pr-11">
                  <span className="flex gap-2"><Volume2 className={`w-4 h-4 mt-1 shrink-0 ${activeLine === index ? 'text-sky-600' : 'text-slate-300'}`} /><span><span className={`block text-[15px] leading-6 editorial-serif ${isPromptLine(line) ? 'text-amber-900' : 'text-slate-800'}`}>{line.en}</span>{showChinese && line.zh && <span className="block text-xs leading-5 text-slate-500 mt-1">{line.zh}</span>}</span></span>
                </button>
                {!isPromptLine(line) && <button type="button" onClick={() => toggleLineBookmark(line.id)} className={`absolute right-2 top-2 p-1.5 rounded-lg transition-colors ${bookmarked ? 'bg-amber-100 text-amber-700' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500'}`} title={bookmarked ? '取消收藏句子' : '收藏句子'}><Bookmark className={`w-3.5 h-3.5 ${bookmarked ? 'fill-current' : ''}`} /></button>}
              </div>
            );
          })}
        </div>
      )}

      {view === 'dictation' && (
        <NceDictation
          key={selectedUnit?.filename}
          items={dictationItems}
          bestScore={currentProgress.dictationBest || 0}
          onPlay={(item) => playSentenceSegment(item.lineIndex, 1)}
          onResult={handleDictationResult}
          onComplete={handleDictationComplete}
        />
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

      <div className="mt-4 rounded-2xl bg-white border border-slate-200 p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-700">本课掌握度</span><span className="text-xs font-bold text-sky-700">{masteryCount}/4</span></div><div className="grid grid-cols-4 gap-1.5 mt-2">{[['听读', masterySteps[0]], ['听写', masterySteps[1]], ['单词', masterySteps[2]], ['练习', masterySteps[3]]].map(([label, done]) => <div key={label} className="text-center"><div className={`h-1.5 rounded-full ${done ? 'bg-emerald-400' : 'bg-slate-100'}`} /><span className={`text-[9px] mt-1 block ${done ? 'text-emerald-600' : 'text-slate-400'}`}>{label}</span></div>)}</div>{currentReviewCount > 0 && <p className="text-[11px] text-amber-700 mt-2">还有 {currentReviewCount} 项薄弱内容，改对后会自动移出复习列表。</p>}</div>
      <div className="flex gap-2 mt-3"><button onClick={playCurrentLine} className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-sm flex items-center justify-center gap-1"><Play className="w-4 h-4" />{activeLine >= 0 ? '朗读当前句' : '从第一句开始'}</button><button onClick={markComplete} className={`flex-1 py-2.5 rounded-xl text-sm flex items-center justify-center gap-1 ${currentProgress.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-50 text-emerald-700'}`}><CheckCircle2 className="w-4 h-4" />{currentProgress.status === 'completed' ? '已完成本课' : masteryCount === 4 ? '完成本课' : '标记完成'}</button></div>
      {currentReviewCount > 0 && <button type="button" onClick={() => openReview(selectedUnit)} className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 py-2.5 text-sm font-semibold text-sky-900"><RotateCcw className="w-4 h-4" />复盘本课 {currentReviewCount} 项</button>}
      <button type="button" onClick={() => openExam(selectedUnit)} className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 py-2.5 text-sm font-semibold text-amber-900"><FileText className="w-4 h-4" />做本课试题</button>
      <div className="flex items-center justify-between gap-2 mt-3"><button type="button" onClick={() => goToAdjacentUnit(previousUnit)} disabled={!previousUnit} className="flex items-center gap-1 text-xs text-slate-500 disabled:opacity-30"><ChevronLeft className="w-4 h-4" />上一课</button><span className="text-[11px] text-slate-400">{selectedUnitIndex + 1}/{units.length || 72} 单元</span><button type="button" onClick={() => goToAdjacentUnit(nextUnit)} disabled={!nextUnit} className="flex items-center gap-1 text-xs text-slate-500 disabled:opacity-30">下一课<ChevronRight className="w-4 h-4" /></button></div>
      {view === 'exercise' && <button onClick={resetExercise} className="w-full mt-2 py-2 text-xs text-slate-400 flex items-center justify-center gap-1"><RotateCcw className="w-3 h-3" />重置本课练习</button>}
    </section>
  );
}
