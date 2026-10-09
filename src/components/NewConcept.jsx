import { useStudyClock } from '../hooks/useStudyClock';
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
  Download,
} from 'lucide-react';
import NceDictation from './NceDictation';
import NceExam from './NceExam';
import NceReview from './NceReview';
import { tts } from '../services/speech';
import { StorageService } from '../services/storage';
import { buildDictationItems, buildExercises, buildNceWordPayload, buildCourseCaptions, extractWords, parseLrc, safeAssetName } from '../services/nce';
import { buildNceReviewQueue, resolveNceReviewMistake } from '../services/nceReview';
import { completeNceRecall, getNceMastery, isNceReviewDue } from '../services/nceMastery';
import { commitNceProgress, countCorrectNceAnswers, recordFirstNceAnswer } from '../services/nceProgress';
import { cacheCourseAudio, getCachedCourseAudioUrl, supportsCourseCache, isCoursePackageReady } from '../services/offline';
import { onEnterSubmit } from '../services/keyboard';
import { lookupLearningWord } from '../services/learningLookup';
import { createLatestRequest } from '../services/latestRequest';
import { useToast } from './ui/toastContext';
import { IconButton } from './ui/IconButton';

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
  return buildNceReviewQueue({ lesson: item }).length;
}

export default function NewConcept({ intent = null, onNavigate = null }) {
  const [reviewTargets, setReviewTargets] = useState(intent?.reviewIds || null);
  const toast = useToast();
  const studyClock = useStudyClock();
  const [units, setUnits] = useState([]);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => (intent?.entry === 'review' || intent?.entry === 'exam' ? intent.entry : 'lessons'));
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
  const [audioSourceUrl, setAudioSourceUrl] = useState('');
  const [captionsUrl, setCaptionsUrl] = useState('');
  const [audioCacheState, setAudioCacheState] = useState('idle');
  const downloadAbortRef = useRef(null);
  const audioRef = useRef(null);
  const lineRefs = useRef({});
  const progressRef = useRef(progress);
  const lastSavedSecondRef = useRef(-1);
  const requestSeqRef = useRef(0);
  const pendingLineIdRef = useRef('');
  const handledIntentRef = useRef(null);
  const requestAbortRef = useRef(null);
  const sentenceLoopRef = useRef({ lineIndex: -1, remaining: 0 });
  const ttsLoopRef = useRef(0);
  const wordLookupGate = useRef(createLatestRequest());
  const exerciseAnswersRef = useRef({});
  const exerciseAnswerLockRef = useRef('');
  const exerciseCompletionRef = useRef(false);
  const recallEvidenceRef = useRef(null);
  const recallSessionRef = useRef('');

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
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
        if (disposed || (err.name === 'AbortError' && !timedOut)) return;
        if (cachedBook?.units?.length) {
          setUsingOfflineCopy(true);
        } else {
          setError(`${timedOut ? '课程目录加载超时' : err.message}。请确认设备联网后重试。`);
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  useEffect(() => () => {
    requestAbortRef.current?.abort();
    downloadAbortRef.current?.abort();
    wordLookupGate.current.cancel();
    audioRef.current?.pause();
    ttsLoopRef.current += 1;
    sentenceLoopRef.current = { lineIndex: -1, remaining: 0 };
    tts.stop();
  }, []);

  const exercises = useMemo(() => buildExercises(lines), [lines]);
  const dictationItems = useMemo(() => buildDictationItems(lines), [lines]);
  const [wordAnalyses, setWordAnalyses] = useState(() => new Map());
  const [analyzingWordKey, setAnalyzingWordKey] = useState('');

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
  const averageMastery = units.length
    ? Math.round(units.reduce((sum, unit) => sum + getNceMastery(progress[unit.filename] || {}).score, 0) / units.length)
    : 0;

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
  const unsavedWordCount = lessonWords.filter((item) => !savedWords.get(item.word)?.translation).length;
  const bookmarkedLineIds = new Set(currentProgress.bookmarkedLineIds || []);
  const currentReviewCount = pendingReviewCount(currentProgress);
  const masterySteps = [
    Boolean(currentProgress.listenCompleted),
    Boolean(currentProgress.dictationCompleted),
    Boolean(currentProgress.vocabViewed),
    Boolean(currentProgress.exercisesCompleted),
  ];
  const currentMastery = getNceMastery(currentProgress);
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
        || (courseFilter === 'review' && pendingReviewCount(itemProgress) > 0)
        || (courseFilter === 'due' && isNceReviewDue(itemProgress));
      return matchesQuery && matchesFilter;
    });
  }, [courseFilter, courseSearch, progress, units]);

  const saveProgress = (filename, patch, activity = null) => {
    const current = progressRef.current;
    const next = commitNceProgress(current, filename, patch, {
      persist: (value) => StorageService.saveNceProgress(value),
      recordActivity: (value) => StorageService.recordStudyActivity(value),
      activity,
    });
    if (!next) {
      setError('学习进度暂时无法保存。请导出备份或清理浏览器存储空间。');
      return false;
    }
    progressRef.current = next;
    setProgress(next);
    return true;
  };

  const openUnit = async (unit, { lineId = '' } = {}) => {
    // Remember which line to highlight once the subtitles arrive (used by the review page's
    // "回到该句" action). The existing activeLine effect scrolls it into view.
    downloadAbortRef.current?.abort();
    wordLookupGate.current.cancel();
    setAnalyzingWordKey('');
    setWordAnalyses(new Map());
    setIsSavingAllWords(false);
    setSavedWords(new Map(StorageService.getVocabulary().map((word) => [word.word.toLowerCase(), word])));
    exerciseAnswersRef.current = {};
    exerciseAnswerLockRef.current = '';
    exerciseCompletionRef.current = false;
    recallEvidenceRef.current = null;
    recallSessionRef.current = `${unit.filename}:${Date.now()}:${requestSeqRef.current + 1}`;
    pendingLineIdRef.current = lineId || '';
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

  // React to a navigation intent.
  //
  // The intent carries a monotonic `token`, so tapping the same "继续学习" task twice in a
  // row works: the previous version compared only the lesson filename against a "handled"
  // ref, so the second tap of the same target was silently ignored and the user landed on
  // the course map instead of the lesson.
  useEffect(() => {
    if (!intent?.token || units.length === 0) return;
    if (handledIntentRef.current === intent.token) return;
    setReviewTargets(intent.reviewIds || null);
    if (intent.entry) setView(intent.entry === 'exam' ? 'exam' : 'review');

    const requestedUnit = intent.lessonId || intent.unit;
    if (!requestedUnit) { handledIntentRef.current = intent.token; return; }
    const unit = units.find((item) => item.filename === requestedUnit);
    if (!unit) return;
    handledIntentRef.current = intent.token;
    openUnit(unit, { lineId: intent.lineId });
    // openUnit intentionally runs once per explicit intent (guarded by the token).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.token, units]);

  // Resolve "回到该句" once the subtitles for the opened lesson are available.
  useEffect(() => {
    const pendingLineId = pendingLineIdRef.current;
    if (!pendingLineId || lines.length === 0) return;
    pendingLineIdRef.current = '';
    const index = lines.findIndex((line) => line.id === pendingLineId);
    if (index >= 0) setActiveLine(index);
  }, [lines]);

  useEffect(() => {
    if (!followAudio || activeLine < 0) return;
    lineRefs.current[activeLine]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeLine, followAudio]);

  const backToLessons = () => {
    wordLookupGate.current.cancel();
    downloadAbortRef.current?.abort();
    setIsSavingAllWords(false);
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
    setReviewTargets(null);
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
    return saveProgress(item.unitId, next[item.unitId], { type: 'course', count: 1, durationMinutes: studyClock.takeMinutes(), source: 'nce-review', entityId: item.unitId, label: '新概念错题复盘' });
  };

  const handleExamComplete = (attempt) => {
    const previous = progressRef.current[attempt.unitId] || {};
    if (previous.lastExamAttemptId === attempt.id) return true;
    return saveProgress(attempt.unitId, {
      lastExamAttemptId: attempt.id,
      examAttempts: (previous.examAttempts || 0) + 1,
      examScore: attempt.score,
      examBest: Math.max(previous.examBest || 0, attempt.score),
      examMistakes: attempt.results.filter((result) => !result.isCorrect).map((result) => ({
        id: result.id,
        question: result.question,
        answer: result.answer,
        submitted: result.submitted,
      })),
    }, { type: 'course', count: 1, source: 'nce-exam', entityId: attempt.unitId, label: '完成新概念单元测验', metadata: { score: attempt.score, attemptId: attempt.id } });
  };

  useEffect(() => {
    if (!lines.length) { setCaptionsUrl(''); return undefined; }
    const url = URL.createObjectURL(new Blob([buildCourseCaptions(lines)], { type: 'text/vtt' }));
    setCaptionsUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [lines]);

  const audioUrl = selectedUnit ? `${NCE1_BASE}/${safeAssetName(selectedUnit.filename)}.mp3` : '';

  useEffect(() => {
    let disposed = false;
    let objectUrl = '';
    setAudioSourceUrl('');
    setAudioCacheState('idle');
    if (!audioUrl) return undefined;
    getCachedCourseAudioUrl(audioUrl).then(async (cachedUrl) => {
      if (disposed) {
        if (cachedUrl) URL.revokeObjectURL(cachedUrl);
        return;
      }
      if (cachedUrl) {
        objectUrl = cachedUrl;
        setAudioSourceUrl(cachedUrl);
        const ready = await isCoursePackageReady(selectedUnit, StorageService.getNceCache());
        if (!disposed) setAudioCacheState(ready ? 'cached' : 'idle');
      }
    }).catch(() => {});
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [audioUrl, selectedUnit]);

  const handleCacheAudio = async () => {
    if (audioCacheState === 'caching') {
      downloadAbortRef.current?.abort();
      setAudioCacheState('idle');
      return;
    }
    if (!audioUrl || !selectedUnit || !supportsCourseCache()) { setAudioCacheState('unsupported'); return; }
    downloadAbortRef.current?.abort();
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60000);
    const unit = selectedUnit;
    setAudioCacheState('caching');
    try {
      const response = await fetch(`${NCE1_BASE}/${safeAssetName(unit.filename)}.lrc`, { signal: controller.signal });
      if (!response.ok) throw new Error('课文字幕下载失败。');
      const text = await response.text();
      if (!parseLrc(text).length) throw new Error('课文字幕格式无效。');
      const cache = StorageService.getNceCache();
      if (!StorageService.saveNceCache({ ...cache, book: { ...(cache.book || {}), units }, lessons: { ...(cache.lessons || {}), [unit.filename]: text } })) throw new Error('课文没有保存成功。');
      await cacheCourseAudio(audioUrl, { signal: controller.signal });
      if (!await isCoursePackageReady(unit, StorageService.getNceCache())) throw new Error('离线包不完整，请重新下载。');
      if (!controller.signal.aborted) {
        setAudioCacheState('cached');
        toast.success('本课离线包已就绪：课文、字幕和原版音频均已保存。');
      }
    } catch (error) {
      if (downloadAbortRef.current === controller && (!controller.signal.aborted || timedOut)) { setAudioCacheState('error'); toast.error(timedOut ? '离线包下载超时，请检查网络后重试。' : error.message || '离线包下载失败，请重试。'); }
    } finally {
      window.clearTimeout(timeoutId);
      if (downloadAbortRef.current === controller) downloadAbortRef.current = null;
    }
  };

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
      await tts.speak(line.en, { channel: 'course', mode: 'system' });
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
      audioRef.current.play().catch(() => tts.speak(line.en, { channel: 'course', mode: 'system' }));
    } else {
      tts.speak(line.en, { channel: 'course', mode: 'system' });
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
    if (!currentExercise || exerciseResult || exerciseAnswerLockRef.current === currentExercise.id) return;
    const normalized = String(answer || '').trim().toLowerCase();
    if (!normalized) return;
    const isCorrect = normalized === currentExercise.answer;

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
          // Traceability: without these the review page could only jump to the whole lesson.
          lineId: currentExercise.lineId || '',
          sourceText: currentExercise.sourceText || '',
        },
      ];
      if (!saveProgress(selectedUnit.filename, { exerciseMistakes })) return;
    }
    exerciseAnswerLockRef.current = currentExercise.id;
    exerciseAnswersRef.current = recordFirstNceAnswer(exerciseAnswersRef.current, currentExercise.id, isCorrect);
    setExerciseCorrectCount(countCorrectNceAnswers(exercises, exerciseAnswersRef.current));
    setExerciseAnswer(answer);
    setExerciseResult(isCorrect ? 'correct' : 'wrong');
  };

  const retryExercise = () => {
    exerciseAnswerLockRef.current = '';
    setExerciseResult(null);
    setExerciseAnswer('');
  };

  const resetExercise = () => {
    exerciseAnswersRef.current = {};
    exerciseAnswerLockRef.current = '';
    exerciseCompletionRef.current = false;
    setExerciseIndex(0);
    setExerciseResult(null);
    setExerciseAnswer('');
    setExerciseFinished(false);
    setExerciseCorrectCount(0);
  };

  const nextExercise = () => {
    if (!exerciseResult || exerciseCompletionRef.current) return;
    if (exerciseIndex + 1 >= exercises.length) {
      if (selectedUnit) {
        const correct = countCorrectNceAnswers(exercises, exerciseAnswersRef.current);
        const bestScore = Math.min(exercises.length, Math.max(progressRef.current[selectedUnit.filename]?.exerciseScore || 0, correct));
        if (!saveProgress(selectedUnit.filename, { exercisesCompleted: true, exerciseScore: bestScore, exerciseLastScore: correct, exerciseTotal: exercises.length },
          { type: 'course', count: 1, durationMinutes: studyClock.takeMinutes(), source: 'nce-exercise', entityId: selectedUnit.filename, label: '新概念句子练习', metadata: { sessionId: recallSessionRef.current } })) return;
        const score = Math.round(correct / exercises.length * 100);
        recallEvidenceRef.current = score >= 80 ? { score, source: 'exercise' } : null;
      }
      exerciseCompletionRef.current = true;
      setExerciseFinished(true);
      return;
    }
    exerciseAnswerLockRef.current = '';
    setExerciseResult(null);
    setExerciseAnswer('');
    setExerciseIndex((value) => value + 1);
  };

  const markComplete = () => {
    if (!selectedUnit) return;
    const previous = progressRef.current[selectedUnit.filename] || {};
    if (previous.status === 'completed') return;
    if (!saveProgress(selectedUnit.filename, {
      status: 'completed',
      completedCount: (previous.completedCount || 0) + 1,
    }, { type: 'course', count: 1, durationMinutes: studyClock.takeMinutes(), source: 'nce-lesson', entityId: selectedUnit.filename, label: '完成新概念课程' })) return;
  };

  const finishRecall = () => {
    if (!selectedUnit || !recallEvidenceRef.current) return;
    const previous = progressRef.current[selectedUnit.filename] || {};
    if (pendingReviewCount(previous) > 0) { toast.info('请先纠正本课今天待复习的错题，再完成回忆复习。'); return; }
    const patch = completeNceRecall(previous, { ...recallEvidenceRef.current, sessionId: recallSessionRef.current });
    if (!patch) return;
    if (!saveProgress(selectedUnit.filename, patch, { type: 'course', count: 1, source: 'nce-course-recall', entityId: selectedUnit.filename, label: '完成本课回忆复习', metadata: { score: recallEvidenceRef.current.score } })) return;
    recallEvidenceRef.current = null;
    toast.success('本次回忆复习已保存，下次复习日期已更新。');
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
    if (!saveProgress(selectedUnit.filename, { note: noteDraft.trim(), noteUpdatedAt: Date.now() })) return;
    setNoteSaved(true);
  };

  const handleDictationResult = (item, result, attempt) => {
    if (!selectedUnit) return;
    const lessonProgress = progressRef.current[selectedUnit.filename] || {};
    const previousMistakes = lessonProgress.dictationMistakes || [];
    const remainingMistakes = previousMistakes.filter((mistake) => mistake.id !== item.id);
    const dictationMistakes = result.passed ? remainingMistakes : [
      ...remainingMistakes,
      {
        id: item.id,
        text: item.text,
        attempt,
        score: result.score,
        missingWords: result.missingWords,
        updatedAt: Date.now(),
        // Same traceability as exercise mistakes; note `text` must not be shown before the
        // retry, or it would reveal the dictation answer.
        lineId: item.lineId || '',
      },
    ];
    return saveProgress(selectedUnit.filename, { dictationMistakes });
  };

  const handleDictationComplete = (averageScore, { firstAnswersPassed = false } = {}) => {
    if (!selectedUnit) return false;
    const lessonProgress = progressRef.current[selectedUnit.filename] || {};
    if (!saveProgress(selectedUnit.filename, {
      dictationCompleted: true,
      dictationBest: Math.max(lessonProgress.dictationBest || 0, averageScore),
    }, { type: 'course', count: 1, durationMinutes: studyClock.takeMinutes(), source: 'nce-dictation', entityId: selectedUnit.filename, label: '新概念听写', metadata: { sessionId: recallSessionRef.current } })) return false;
    recallEvidenceRef.current = firstAnswersPassed && averageScore >= 90 && pendingReviewCount(progressRef.current[selectedUnit.filename]) === 0 ? { score: averageScore, source: 'dictation' } : null;
    return true;
  };

  // N-01: the lesson word list showed only the word and its frequency — no meaning, phonetic or
  // part of speech. The only way to see one was to collect the word first and then go read it in
  // the vocabulary book. Look-ups are cached per lesson, and a word already in the vocabulary
  // book reuses that entry instead of spending an AI request.
  const meaningFor = (item) => {
    const key = item.word.toLowerCase();
    const fetched = wordAnalyses.get(key);
    if (fetched) return fetched;
    const saved = savedWords.get(key);
    if (saved?.translation) {
      return {
        translation: saved.translation || '',
        phonetic: saved.phonetic || '',
        pos: saved.pos || '',
        definitionEn: saved.definitionEn || '',
      };
    }
    return null;
  };

  const lookupWord = async (item) => {
    const key = item.word.toLowerCase();
    if (analyzingWordKey || isSavingAllWords || meaningFor(item)) return;
    const request = wordLookupGate.current.start();
    setAnalyzingWordKey(key);
    try {
      const analysis = await lookupLearningWord(item.word, item.sentence, { signal: request.signal, enrich: false });
      if (!request.isCurrent()) return;
      if (!analysis?.translation) { toast.info(`词库暂未收录 “${item.word}”，可以在词典中继续查询。`); return; }
      setWordAnalyses((previous) => new Map(previous).set(key, {
        translation: analysis?.translation || '',
        phonetic: analysis?.phonetic || '',
        pos: analysis?.pos || '',
        definitionEn: analysis?.definitionEn || '',
      }));
    } catch (error) {
      if (request.isCurrent()) toast.error(`查询 “${item.word}” 失败：${error.message || '请检查网络后重试。'}`);
    } finally {
      if (request.isCurrent()) setAnalyzingWordKey('');
    }
  };

  const saveWord = async (item) => {
    const unit = selectedUnit;
    if (!unit || analyzingWordKey || isSavingAllWords) return;
    const request = wordLookupGate.current.start();
    setAnalyzingWordKey(item.word.toLowerCase());
    try {
      const meaning = meaningFor(item) || await lookupLearningWord(item.word, item.sentence, { signal: request.signal, enrich: false });
      if (!request.isCurrent()) return;
      if (!meaning?.translation) { setWordSaveError('这个词暂时没有中文释义，请先在词典中查询或手动补齐后再复习。'); return; }
      const saved = StorageService.addWord(buildNceWordPayload(item, { unitId: unit.filename, unitTitle: displayUnitTitle(unit), meaning }));
      if (!saved) {
        setWordSaveError('设备存储空间不足，这个单词没有保存。请先导出备份或清理浏览器空间。');
        return;
      }
      setWordSaveError('');
      StorageService.recordStudyActivity({ type: 'vocab', count: 1, source: 'nce-vocab', entityId: selectedUnit.filename, label: '收录新概念单词' });
      setSavedWords(new Map(StorageService.getVocabulary().map((word) => [word.word.toLowerCase(), word])));
    } catch (error) {
      if (request.isCurrent()) setWordSaveError(error.message || '查词失败，请重试。');
    } finally {
      if (request.isCurrent()) setAnalyzingWordKey('');
    }
  };

  const saveAllWords = async () => {
    if (isSavingAllWords || unsavedWordCount === 0) return;
    const request = wordLookupGate.current.start();
    const unit = selectedUnit;
    setIsSavingAllWords(true);
    const nextSavedWords = new Map(savedWords);
    let addedCount = 0;
    let skippedCount = 0;
    try {
      for (const item of lessonWords) {
        if (!request.isCurrent()) return;
        if (nextSavedWords.get(item.word)?.translation) continue;
        let meaning;
        try {
          meaning = meaningFor(item) || await lookupLearningWord(item.word, item.sentence, { signal: request.signal, enrich: false });
        } catch {
          if (!request.isCurrent()) return;
          skippedCount += 1;
          continue;
        }
        if (!request.isCurrent()) return;
        if (!meaning?.translation) { skippedCount += 1; continue; }
        const saved = StorageService.addWord(buildNceWordPayload(item, { unitId: unit.filename, unitTitle: displayUnitTitle(unit), meaning }));
        if (saved) {
          nextSavedWords.set(item.word, saved);
          addedCount += 1;
        } else skippedCount += 1;
      }
      setSavedWords(nextSavedWords);
      setIsSavingAllWords(false);
      if (addedCount > 0) {
        setWordSaveError(skippedCount ? `已收录 ${addedCount} 个词，另有 ${skippedCount} 个未取得释义或保存失败，请稍后补齐。` : '');
        StorageService.recordStudyActivity({ type: 'vocab', count: addedCount, durationMinutes: studyClock.takeMinutes(), source: 'nce-vocab', entityId: unit.filename, label: '批量收录新概念单词' });
      } else {
        setWordSaveError(`本次 ${skippedCount} 个词暂未取得可用释义或未能保存，请检查网络和本地存储后重试。`);
      }
    } catch (error) {
      if (request.isCurrent()) { setSavedWords(new Map(StorageService.getVocabulary().map((word) => [word.word.toLowerCase(), word]))); setWordSaveError(error.message || '批量查词失败，已保存的词会保留。'); }
    } finally {
      if (request.isCurrent()) setIsSavingAllWords(false);
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
      <section className="study-page nce-page course-overview h-full overflow-y-auto p-4 pb-28">
        <div className="course-layout">
        <header className="course-heading"><h1>新概念英语</h1></header>
        <div className="course-book-card nce-reveal">
          <div className="course-book-cover" aria-hidden="true"><strong>01</strong><BookOpen size={26} /></div>
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold mt-2 tracking-tight">从第一册开始</h2>
              </div>
            </div>
            <div className="course-metrics grid grid-cols-4 gap-2 mt-5">
              <div className="rounded-2xl bg-white/10 p-3"><span className="block text-xl font-bold">{completedCount}</span><span className="text-[11px] text-slate-300">已完成</span></div>
              <div className="rounded-2xl bg-white/10 p-3"><span className="block text-xl font-bold">{learningCount}</span><span className="text-[11px] text-slate-300">正在学习</span></div>
              <div className="rounded-2xl bg-white/10 p-3"><span className="block text-xl font-bold">{reviewCount}</span><span className="text-[11px] text-slate-300">待复习</span></div>
              <div className="rounded-2xl bg-white/10 p-3"><span className="block text-xl font-bold">{courseWordCount}</span><span className="text-[11px] text-slate-300">已收录词</span></div>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-sky-100"><span>第一册课程进度</span><span>{courseProgressPercent}% · 掌握度均值 {averageMastery}%</span></div>
            <div className="h-2 bg-white/15 rounded-full overflow-hidden mt-2"><div className="h-full bg-sky-300 rounded-full transition-all" style={{ width: `${courseProgressPercent}%` }} /></div>
            <p className="text-[10px] text-slate-400 mt-2">已完成 {dictationCount} 次听写 · {exerciseCount} 个单元练习 · {examCount} 份试题</p>
          </div>
        </div>

        {continueUnit && (
          <button onClick={() => openUnit(continueUnit)} className="course-resume w-full mt-4 rounded-2xl bg-white border border-sky-100 p-4 flex items-center gap-3 text-left shadow-sm hover:border-sky-300 transition-colors">
            <span className="w-11 h-11 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center"><Play className="w-5 h-5" /></span>
            <span className="flex-1 min-w-0"><span className="block text-[11px] text-sky-600 font-semibold">{latestUnit ? '继续上次学习' : '从第一课开始'}</span><span className="block font-semibold text-slate-800 mt-1 truncate editorial-serif">{displayUnitTitle(continueUnit)}</span><span className="block text-xs text-slate-400 mt-1">{lessonRange(continueUnit)}</span></span>
            <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
          </button>
        )}

        <button type="button" onClick={() => openExam()} className="course-exam w-full mt-3 relative overflow-hidden rounded-[24px] bg-[#f3e7ce] border border-amber-200 p-4 flex items-center gap-3 text-left shadow-sm hover:border-amber-400 transition-colors nce-reveal">
          <span className="relative w-12 h-12 rounded-2xl bg-[#102a43] text-amber-300 flex items-center justify-center shrink-0"><FileText className="w-6 h-6" /></span>
          <span className="relative flex-1 min-w-0"><span className="block text-lg font-bold text-[#102a43] editorial-serif">试题中心</span></span>
          <ChevronRight className="relative w-5 h-5 text-amber-900/50 shrink-0" />
        </button>

        {reviewItemCount > 0 && (
          <button type="button" onClick={() => openReview()} className="w-full mt-2 rounded-2xl bg-amber-50 border border-amber-100 p-3 flex items-center gap-3 text-left hover:border-amber-300 transition-colors">
            <span className="w-9 h-9 rounded-xl bg-white text-amber-600 flex items-center justify-center"><RotateCcw className="w-4 h-4" /></span>
            <span className="flex-1"><span className="block text-sm font-semibold text-amber-900">逐题复盘薄弱点</span><span className="block text-xs text-amber-700/70 mt-0.5">{reviewItemCount} 项待重练</span></span>
            <ChevronRight className="w-4 h-4 text-amber-400" />
          </button>
        )}

        {usingOfflineCopy && <div className="rounded-xl bg-amber-50 text-amber-700 text-xs p-3 mt-3">正在使用离线课程目录。</div>}
        {error && !selectedUnit && <div className="rounded-xl bg-rose-50 text-rose-700 text-sm p-3 mt-3">{error}</div>}

        <div className="mt-5 flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-bold text-slate-900">144 课学习地图</h2></div>
          <span className="text-xs text-slate-400">{filteredUnits.length}/{units.length || 72} 单元</span>
        </div>
        <div className="mt-3 flex items-center gap-2 bg-white rounded-2xl border border-slate-200 px-3 py-2.5">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input value={courseSearch} onChange={(event) => setCourseSearch(event.target.value)} placeholder="搜索课文标题或课号" className="bg-transparent outline-none text-sm flex-1 min-w-0 text-slate-800" />
          {courseSearch && <button type="button" onClick={() => setCourseSearch('')} className="text-xs text-slate-400 hover:text-slate-700">清除</button>}
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar mt-2 pb-1">
          {[['all', '全部'], ['pending', '未开始'], ['learning', '学习中'], ['review', `错题 ${reviewCount}`], ['due', '到期复习'], ['completed', '已完成']].map(([value, label]) => (
            <button key={value} type="button" onClick={() => setCourseFilter(value)} aria-pressed={courseFilter === value} className={`flex-none px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${courseFilter === value ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'}`}>{label}</button>
          ))}
        </div>

        {loading && <div className="text-center text-sm text-slate-500 py-12">正在加载第一册课程目录…</div>}
        {!loading && filteredUnits.length === 0 && <div className="text-center bg-white rounded-2xl border border-slate-200 text-sm text-slate-500 py-12 mt-3">没有找到符合条件的课文。</div>}
        <div className="course-units space-y-2 mt-3">
          {filteredUnits.map((unit) => {
            const originalIndex = units.findIndex((item) => item.filename === unit.filename);
            const itemProgress = progress[unit.filename];
            const completed = itemProgress?.status === 'completed';
            const itemReviewCount = pendingReviewCount(itemProgress);
            const itemMastery = getNceMastery(itemProgress || {});
            const itemDue = isNceReviewDue(itemProgress || {});
            return (
              <button key={unit.filename} onClick={() => openUnit(unit)} className={`w-full text-left bg-white border rounded-2xl p-3 flex items-center gap-3 transition-colors ${completed ? 'border-emerald-100 hover:border-emerald-300' : 'border-slate-200 hover:border-sky-300'}`}>
                <span className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${completed ? 'bg-emerald-50 text-emerald-600' : itemProgress ? 'bg-amber-50 text-amber-600' : 'bg-sky-50 text-sky-600'}`}>{String(originalIndex * 2 + 1).padStart(3, '0')}</span>
                <span className="flex-1 min-w-0"><span className="block font-semibold text-slate-800 truncate editorial-serif">{displayUnitTitle(unit)}</span><span className="block text-xs text-slate-400 mt-1">{lessonRange(unit)} · {progressLabel(itemProgress)}{itemProgress?.examAttempts ? ` · 测验最佳 ${itemProgress.examBest} 分` : ''}{itemReviewCount ? ` · ${itemReviewCount} 项错题` : itemDue ? ' · 到期复习' : ''}</span><span className="mt-2 flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full ${itemMastery.score >= 80 ? 'bg-emerald-400' : itemMastery.score > 0 ? 'bg-amber-400' : 'bg-slate-200'}`} style={{ width: `${itemMastery.score}%` }} /></span><span className="text-[10px] font-semibold tabular-nums text-slate-400">{itemMastery.score}%</span></span></span>
                {completed ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /> : <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />}
              </button>
            );
          })}
        </div>
        </div>
      </section>
    );
  }

  if (view === 'exam') {
    return <NceExam key={examUnitFilename} units={units} baseUrl={NCE1_BASE} initialUnitFilename={examUnitFilename} onBack={backToLessons} onOpenLesson={(unit) => unit && openUnit(unit)} onComplete={handleExamComplete} />;
  }

  if (view === 'review') {
    return <NceReview progress={progress} units={units} initialUnitFilename={reviewUnitFilename} reviewIds={reviewTargets} onResolve={handleResolveReview} onOpenLesson={(filename, lineId) => { const unit = units.find((item) => item.filename === filename); if (unit) openUnit(unit, { lineId }); }} onBack={backToLessons} />;
  }

  const exerciseScore = Math.min(exercises.length, exerciseCorrectCount);

  return (
    <section className="study-page nce-page h-full overflow-y-auto p-4 pb-28">
      <button onClick={backToLessons} className="flex items-center gap-1 text-sm text-slate-500 mb-3 hover:text-slate-800"><ArrowLeft className="w-4 h-4" />第一册课程</button>
      <div className="rounded-[28px] bg-gradient-to-br from-white via-white to-sky-50 border border-white p-4 mb-3 shadow-sm nce-reveal">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-[11px] text-sky-600 font-semibold tracking-[0.14em]">{lessonRange(selectedUnit)}</p><h1 className="text-2xl font-bold text-slate-900 mt-1 truncate editorial-serif">{displayUnitTitle(selectedUnit)}</h1><p className="text-xs text-slate-400 mt-1">{progressLabel(currentProgress)} · 掌握 {masteryCount}/4{currentReviewCount ? ` · ${currentReviewCount} 项待复习` : ''}</p></div>
          <div className="flex gap-1.5 shrink-0"><button type="button" onClick={() => setShowNotes((value) => !value)} className={`p-2 rounded-xl border transition-colors ${showNotes || currentProgress.note ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-white text-slate-500 border-slate-200'}`} title="本课笔记"><NotebookPen className="w-5 h-5" /></button><button onClick={() => setShowChinese((value) => !value)} className={`p-2 rounded-xl border transition-colors ${showChinese ? 'bg-sky-50 text-sky-600 border-sky-100' : 'bg-white text-slate-500 border-slate-200'}`} title="切换中英"><Languages className="w-5 h-5" /></button></div>
        </div>
        <div className="grid grid-cols-4 gap-1.5 mt-4">{[['听读', masterySteps[0]], ['听写', masterySteps[1]], ['单词', masterySteps[2]], ['练习', masterySteps[3]]].map(([label, done]) => <div key={label} className={`rounded-xl px-2 py-1.5 text-center text-[10px] font-semibold ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>{done ? '✓ ' : ''}{label}</div>)}</div>
      </div>

      {showNotes && <div className="rounded-2xl bg-amber-50/80 border border-amber-100 p-3 mb-3 nce-reveal"><div className="flex items-center justify-between"><span className="text-xs font-bold text-amber-900">本课学习笔记</span></div><textarea value={noteDraft} onChange={(event) => { setNoteDraft(event.target.value); setNoteSaved(false); }} rows={3} placeholder="记下易错词、语法点或自己的例句…" className="allow-select w-full mt-2 rounded-xl bg-white/80 border border-amber-100 p-3 text-sm leading-6 outline-none focus:border-amber-300" /><button type="button" onClick={saveLessonNote} className={`mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${noteSaved ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-600 text-white'}`}><Save className="w-3.5 h-3.5" />{noteSaved ? '笔记已保存' : '保存笔记'}</button></div>}

      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {[['lesson', '01 听读', lines.length ? '已载入' : '加载中'], ['dictation', '02 听写', currentProgress.dictationCompleted ? `${currentProgress.dictationBest || 0} 分` : `${dictationItems.length} 句`], ['vocab', '03 单词', lessonWords.length ? `${lessonWords.length - unsavedWordCount}/${lessonWords.length}` : '等待'], ['exercise', '04 练习', currentProgress.exercisesCompleted ? `${currentProgress.exerciseScore || 0}/${exercises.length}` : `${exercises.length} 题`]].map(([step, label, hint]) => (
          <button key={step} type="button" onClick={() => changeLearningView(step)} className={`rounded-xl p-2 text-center border transition-all ${view === step ? 'bg-[#102a43] text-white border-[#102a43] shadow-sm -translate-y-0.5' : 'bg-white text-slate-600 border-slate-200 hover:border-sky-200'}`}><span className="block text-[11px] font-semibold truncate">{label}</span><span className={`block text-[9px] mt-1 truncate ${view === step ? 'text-sky-200' : 'text-slate-400'}`}>{hint}</span></button>
        ))}
      </div>

      {error && <div className="rounded-xl bg-amber-50 text-amber-700 text-xs p-3 mb-3">{error}</div>}
      {usingOfflineCopy && <div className="rounded-xl bg-amber-50 text-amber-700 text-xs p-3 mb-3">正在使用离线课文。</div>}

      <div className="sticky top-2 z-10 rounded-2xl bg-white/95 backdrop-blur-xl border border-white p-3 mb-3 shadow-lg shadow-slate-900/5">
        <div className="flex items-center justify-between gap-3 mb-2"><span className="text-xs font-semibold text-slate-700">听读训练</span><div className="flex items-center gap-2"><label className="text-[11px] text-slate-400" htmlFor="nce-playback-rate">速度</label><select id="nce-playback-rate" value={playbackRate} onChange={(event) => changePlaybackRate(Number(event.target.value))} className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 text-slate-600"><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></div></div>
        <audio ref={audioRef} src={audioSourceUrl || audioUrl} controls preload="metadata" aria-label="本课原版音频，英文及中文字幕在下方课文中同步显示" className="w-full" onLoadedMetadata={restoreAudioPosition} onTimeUpdate={handleAudioTimeUpdate} onError={() => setError('这课音频暂时无法加载；可以点击下方句子使用系统朗读。')} onEnded={handleAudioEnded} ><track kind="captions" src={captionsUrl || undefined} srcLang="en" label="English / 中文" default /></audio>
        <div className="flex items-center gap-1.5 mt-2 overflow-x-auto no-scrollbar"><button type="button" onClick={playCurrentLine} className="flex-none text-xs text-sky-700 font-semibold flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-50"><Play className="w-3.5 h-3.5" />{activeLine >= 0 ? '从当前句播放' : '从第一句开始'}</button><button type="button" onClick={toggleRepeatCurrentLine} disabled={lines.length === 0} className="flex-none text-xs text-amber-700 font-semibold flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 disabled:opacity-40"><Repeat2 className="w-3.5 h-3.5" />{repeatRemaining ? `停止循环 · ${repeatRemaining}` : '当前句 ×3'}</button><button type="button" onClick={toggleFollowAudio} aria-pressed={followAudio} className={`flex-none text-xs px-2 py-1 rounded-lg transition-colors ${followAudio ? 'bg-emerald-50 text-emerald-700' : 'text-slate-400 bg-slate-50'}`}>{followAudio ? '跟随：开' : '跟随：关'}</button><button type="button" onClick={handleCacheAudio} className={`flex-none text-xs px-2 py-1 rounded-lg flex items-center gap-1 ${audioCacheState === 'cached' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'}`}><Download className="w-3.5 h-3.5" />{audioCacheState === 'caching' ? '取消下载' : audioCacheState === 'cached' ? '已缓存' : audioCacheState === 'error' ? '缓存失败' : '缓存音频'}</button></div>
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
          <div className="flex items-start justify-between gap-3 mb-3"><div><h2 className="font-semibold text-slate-800">本课重点词</h2><p className="text-xs text-slate-400 mt-1">已收录 {lessonWords.length - unsavedWordCount}/{lessonWords.length}</p></div><button type="button" onClick={saveAllWords} disabled={isSavingAllWords || unsavedWordCount === 0} className="text-xs px-2.5 py-1.5 rounded-xl bg-sky-50 text-sky-700 font-semibold disabled:opacity-40 disabled:cursor-not-allowed">{isSavingAllWords ? '收录中…' : unsavedWordCount ? `一键收录 ${unsavedWordCount} 词` : '已全部收录'}</button></div>
          <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2 mb-3"><Search className="w-4 h-4 text-slate-400" /><input value={wordFilter} onChange={(event) => setWordFilter(event.target.value)} placeholder="筛选本课单词" className="bg-transparent outline-none text-sm flex-1" /></div>
          {selectedUnit && lessonWords.length === 0 ? <div className="text-center py-8 text-sm text-slate-500">课文加载后会生成本课重点词。</div> : <div className="space-y-2">{filteredWords.map((item) => {
            const saved = Boolean(savedWords.get(item.word)?.translation);
            const meaning = meaningFor(item);
            const isLookingUp = analyzingWordKey === item.word;
            return (
              <div key={item.word} className="border border-slate-100 rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <IconButton label={`朗读 ${item.word}`} tone="sky" onClick={() => tts.speak(item.word, { channel: 'course', mode: 'system' })} className="p-1">
                    <Volume2 className="w-4 h-4" />
                  </IconButton>
                  <span className="font-semibold text-slate-800">{item.word}</span>
                  {meaning?.phonetic && <span className="text-[11px] font-mono text-slate-500">{meaning.phonetic}</span>}
                  {meaning?.pos && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{meaning.pos}</span>}
                  <span className="text-xs text-slate-400">出现 {item.count} 次</span>
                  <div className="ml-auto flex items-center gap-1">
                    {!meaning && (
                      <button
                        type="button"
                        onClick={() => lookupWord(item)}
                        disabled={isLookingUp}
                        className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
                      >
                        <Sparkles className="w-3 h-3" />
                        {isLookingUp ? '查询中…' : '查释义'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => saved ? null : saveWord(item)}
                      className={`rounded-lg px-2 py-1 text-xs ${saved ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-50 text-sky-600'}`}
                    >
                      {saved ? <span className="flex items-center gap-1"><Check className="w-3 h-3" />已收录</span> : <span className="flex items-center gap-1"><BookmarkPlus className="w-3 h-3" />加入生词本</span>}
                    </button>
                  </div>
                </div>
                {meaning?.translation ? (
                  <p className="mt-2 text-xs font-medium text-slate-700">{meaning.translation}</p>
                ) : (
                  <p className="mt-2 text-[11px] text-slate-400">暂无释义</p>
                )}
                <p className="text-xs text-slate-500 mt-2">{item.sentence}</p>
                {item.sentenceCn && <p className="text-xs text-slate-400 mt-1">{item.sentenceCn}</p>}
              </div>
            );
          })}</div>}
        </div>
      )}

      {view === 'exercise' && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          {exerciseFinished ? (
            <div className="text-center py-5"><div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto"><CheckCircle2 className="w-8 h-8" /></div><h2 className="font-bold text-slate-900 mt-3">本课练习完成</h2><p className="text-sm text-slate-500 mt-1">本次首答正确 {exerciseScore}/{exercises.length} 题，复习得分已保存。</p><div className="flex gap-2 justify-center mt-4"><button type="button" onClick={resetExercise} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" />再做一次</button><button type="button" onClick={() => setView('lesson')} className="px-3 py-2 rounded-xl bg-sky-600 text-white text-xs font-semibold">回到课文</button></div></div>
          ) : currentExercise ? (
            <><div className="flex items-center justify-between mb-3"><span className="text-xs text-slate-400">练习 {exerciseIndex + 1}/{exercises.length} · 本次首答正确 {exerciseCorrectCount} 题</span><Sparkles className="w-4 h-4 text-amber-500" /></div><h2 className="font-semibold text-slate-800 mb-3">{currentExercise.prompt}</h2><p className="rounded-xl bg-slate-50 p-3 text-lg leading-8 mb-2">{currentExercise.sentence}</p><p className="text-xs text-slate-500 mb-4">{currentExercise.zh}</p>{currentExercise.type === 'choice' ? <div className="grid grid-cols-2 gap-2">{currentExercise.options.map((option) => { const isCorrect = option.toLowerCase() === currentExercise.answer; const isSelected = exerciseAnswer.trim().toLowerCase() === option.toLowerCase(); const style = exerciseResult && isCorrect ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : exerciseResult && isSelected ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-slate-200 hover:border-sky-300'; return <button key={option} onClick={() => answerExercise(option)} disabled={Boolean(exerciseResult)} className={`p-2 rounded-xl border text-sm transition-colors ${style}`}>{option}</button>; })}</div> : <div className="flex gap-2"><input value={exerciseAnswer} onChange={(event) => setExerciseAnswer(event.target.value)} onKeyDown={onEnterSubmit(() => answerExercise(exerciseAnswer))} disabled={Boolean(exerciseResult)} placeholder="输入缺少的单词" className="flex-1 border border-slate-200 rounded-xl px-3 text-sm" /><button onClick={() => answerExercise(exerciseAnswer)} disabled={Boolean(exerciseResult)} className="px-4 rounded-xl bg-sky-600 text-white text-sm disabled:opacity-40">检查</button></div>}{exerciseResult && <div className={`mt-4 rounded-xl p-3 text-sm ${exerciseResult === 'correct' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}><p>{exerciseResult === 'correct' ? '答对了，可以继续。' : `再想想。答案是：${currentExercise.answer}`}</p><div className="flex gap-3 mt-2"><button type="button" onClick={nextExercise} className="font-semibold underline">{exerciseIndex + 1 >= exercises.length ? '完成练习' : '下一题'}</button>{exerciseResult === 'wrong' && <button type="button" onClick={retryExercise} className="font-semibold underline">再试一次</button>}</div></div>}</>
          ) : <div className="text-center py-8 text-sm text-slate-500">课文加载后会自动生成句子练习。</div>}
        </div>
      )}

      <div className="mt-4 rounded-2xl bg-white border border-slate-200 p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-700">本课掌握度</span><span className="text-xs font-bold text-sky-700">{currentMastery.score}% · {currentMastery.label}</span></div><div className="grid grid-cols-5 gap-1.5 mt-2">{[['听读', masterySteps[0]], ['听写', masterySteps[1]], ['单词', masterySteps[2]], ['练习', masterySteps[3]], ['测验', currentMastery.examBonus]].map(([label, done]) => <div key={label} className="text-center"><div className={`h-1.5 rounded-full ${done ? 'bg-emerald-400' : 'bg-slate-100'}`} /><span className={`text-[9px] mt-1 block ${done ? 'text-emerald-600' : 'text-slate-400'}`}>{label}</span></div>)}</div>{currentReviewCount > 0 && <p className="text-[11px] text-amber-700 mt-2">待复习 {currentReviewCount} 项</p>}{currentProgress.nextReviewAt && <p className="text-[11px] text-slate-400 mt-2">下次课程复习：{new Date(currentProgress.nextReviewAt).toLocaleDateString('zh-CN')}</p>}</div>
      <div className="flex gap-2 mt-3"><button onClick={playCurrentLine} className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-sm flex items-center justify-center gap-1"><Play className="w-4 h-4" />{activeLine >= 0 ? '朗读当前句' : '从第一句开始'}</button><button onClick={markComplete} disabled={currentProgress.status === 'completed'} className={`flex-1 py-2.5 rounded-xl text-sm flex items-center justify-center gap-1 ${currentProgress.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-50 text-emerald-700'}`}><CheckCircle2 className="w-4 h-4" />{currentProgress.status === 'completed' ? '已完成本课' : masteryCount === 4 ? '完成本课' : '标记完成'}</button></div>
      <div className="mt-3 rounded-2xl border border-sky-100 bg-sky-50/70 p-3">
        <button type="button" onClick={finishRecall} disabled={!recallEvidenceRef.current || currentProgress.lastRecallSessionId === recallSessionRef.current} className="w-full rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40">完成本课回忆复习</button>
        <details className="mt-2 text-xs text-sky-900/70"><summary className="cursor-pointer">复习规则</summary><p className="mt-2 leading-5">本次听写达到 90 分且关键词正确，或句子练习达到 80%，并纠正今天的错题后，可更新复习日期。</p></details>
      </div>
      {currentReviewCount > 0 && <button type="button" onClick={() => openReview(selectedUnit)} className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 py-2.5 text-sm font-semibold text-sky-900"><RotateCcw className="w-4 h-4" />复盘本课 {currentReviewCount} 项</button>}
      <button type="button" onClick={() => openExam(selectedUnit)} className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 py-2.5 text-sm font-semibold text-amber-900"><FileText className="w-4 h-4" />做本课试题</button>
      <div className="flex items-center justify-between gap-2 mt-3"><button type="button" onClick={() => goToAdjacentUnit(previousUnit)} disabled={!previousUnit} className="flex items-center gap-1 text-xs text-slate-500 disabled:opacity-30"><ChevronLeft className="w-4 h-4" />上一课</button><span className="text-[11px] text-slate-400">{selectedUnitIndex + 1}/{units.length || 72} 单元</span><button type="button" onClick={() => goToAdjacentUnit(nextUnit)} disabled={!nextUnit} className="flex items-center gap-1 text-xs text-slate-500 disabled:opacity-30">下一课<ChevronRight className="w-4 h-4" /></button></div>
      {view === 'exercise' && <button onClick={resetExercise} className="w-full mt-2 py-2 text-xs text-slate-400 flex items-center justify-center gap-1"><RotateCcw className="w-3 h-3" />重置本课练习</button>}
      {onNavigate && <div className="mt-3 flex gap-2"><button type="button" onClick={() => onNavigate('home')} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm">回今日计划</button><button type="button" disabled={!lessonWords.length} onClick={() => onNavigate('oral', { practiceWords: lessonWords.slice(0, 5).map((item) => item.word) })} className="flex-1 rounded-xl bg-sky-50 py-2.5 text-sm text-sky-800 disabled:opacity-40">用本课词练表达</button></div>}
    </section>
  );
}
