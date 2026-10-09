import { VOCABULARY_CATEGORIES, sampleCategoryWords } from '../data/categoryVocabulary';
import { fillCategoryPhonetics } from '../data/categoryPhonetics';
import { dueVocabulary, selectReviewSession } from '../services/reviewSession';
import { useStudyClock } from '../hooks/useStudyClock';
import { useLearningSession } from '../hooks/useLearningSession';
import { lookupLearningWord } from '../services/learningLookup';
import { restoreVocabularySession, matchesVocabularySpelling, keyedVocabularyText } from '../services/vocabularySession';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Layers,
  Volume2,
  Plus,
  Trash2,
  Search,
  RotateCw,
  Sparkles,
  Trophy,
  Clock,
  CheckCircle,
  Film,
  Headphones,
  BookPlus,
  X,
  Edit3,
  StickyNote,
  MoreHorizontal,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { StorageService } from '../services/storage';
import {
  generateVocabularyQuiz,
  generateVocabStoryWithAI,
} from '../services/ai';
import { tts } from '../services/speech';
import StudyHeader from './StudyHeader';
import { filterVocabulary, formatDueDate } from '../services/studyView';
import { useToast } from './ui/toastContext';
import { Modal } from './ui/Modal';
import { IconButton } from './ui/IconButton';

// Fisher-Yates random shuffle utility
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// The next card appears after 150ms, so ignore repeat taps on the same card inside this window.
const RATING_LOCK_MS = 600;
// How long the "撤销" affordance stays available after a rating.
const UNDO_WINDOW_MS = 5000;

// How many due cards a single session shows by default (see the backlog note in the UI).
const SESSION_SIZE_OPTIONS = [10, 20, 50, 'all'];
const DEFAULT_SESSION_SIZE = 20;

function readSessionSize() {
  const saved = StorageService.getAppState().vocabSessionSize;
  if (saved === 'all') return 'all';
  const numeric = Number(saved);
  return [10, 20, 50].includes(numeric) ? numeric : DEFAULT_SESSION_SIZE;
}

function ratingTimestamp() { return Date.now(); }

function initialVocabularyState(intent) {
  const vocabulary = fillCategoryPhonetics(StorageService.getVocabulary());
  const restored = restoreVocabularySession(StorageService.getLearningSession('vocabulary'), { vocabulary });
  const planned = Array.isArray(intent?.wordIds) && intent.wordIds.length > 0;
  if (!planned && restored.dueCards.length) return { ...restored, vocabulary };
  const dueCards = selectReviewSession(vocabulary.filter((word) => word.translation?.trim()), { size: readSessionSize(), wordIds: planned ? intent.wordIds : undefined });
  return { ...restored, activeTab: planned ? 'flashcard' : restored.activeTab, selectedCategory: 'personal', dueCards, currentIndex: 0, isFlipped: false, spellingAnswer: '', spellingChecked: false, reviewCompleted: !dueCards.length, vocabulary };
}

export default function VocabularySRS({ onOpenSource = null, sectionSwitch = null, intent = null }) {
  const toast = useToast();
  const studyClock = useStudyClock();
  const [restoredSession] = useState(() => initialVocabularyState(intent));
  const [activeTab, setActiveTab] = useState(restoredSession.activeTab || 'flashcard');
  const [vocabulary, setVocabulary] = useState(restoredSession.vocabulary);
  const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'learning' | 'review' | 'mastered'
  const [searchQuery, setSearchQuery] = useState('');

  // Flashcard states
  const [dueCards, setDueCards] = useState(restoredSession.dueCards || []);
  const [currentIndex, setCurrentIndex] = useState(restoredSession.currentIndex || 0);
  const [isFlipped, setIsFlipped] = useState(Boolean(restoredSession.isFlipped));
  const [reviewCompleted, setReviewCompleted] = useState(Boolean(restoredSession.reviewCompleted));
  const [studyStats, setStudyStats] = useState(() => StorageService.getStudyStats());
  // Last rating, kept briefly so a mis-tap can be undone (word state + stats + event).
  const [undoState, setUndoState] = useState(null);
  const [dataError, setDataError] = useState('');
  // How many due cards one session should contain (learners returning after a break need an
  // exit from a huge backlog). The authoritative value is read from storage inside
  // `reloadVocabulary` so that function stays independent of React state — otherwise every
  // caller (including the mount effect) would need `sessionSize` as a dependency.
  const [sessionSize, setSessionSize] = useState(() => readSessionSize());
  const [dueTotal, setDueTotal] = useState(() => dueVocabulary(restoredSession.vocabulary).length);
  const [selectedCategory, setSelectedCategory] = useState(restoredSession.selectedCategory || 'personal');
  const categoryRef = useRef(restoredSession.selectedCategory || 'personal');
  const [showDeckSettings, setShowDeckSettings] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState(restoredSession.selectedLevel);
  const [learningMode, setLearningMode] = useState(restoredSession.learningMode);
  const [spellingAnswer, setSpellingAnswer] = useState(restoredSession.spellingAnswer);
  const [spellingChecked, setSpellingChecked] = useState(restoredSession.spellingChecked);
  const appliedIntentRef = useRef(intent?.token);
  const ratingAdvanceRef = useRef(null);
  const flipButtonRef = useRef(null);
  const spellingInputRef = useRef(null);
  const answerPanelRef = useRef(null);
  const focusRequestedRef = useRef(false);
  const category = VOCABULARY_CATEGORIES.find((item) => item.id === selectedCategory);
  const scopedVocabulary = (words) => categoryRef.current === 'personal' ? words : words.filter((word) =>
    word.sources?.some((source) => source.type === 'category' && source.id === categoryRef.current));

  const startCategory = (categoryId, level = selectedLevel, size = sessionSize) => {
    clearTimeout(ratingAdvanceRef.current);
    clearTimeout(undoTimerRef.current);
    setUndoState(null);
    lastRatedRef.current = { id: '', at: 0 };
    requeuedRef.current.clear();
    planTargetsRef.current = null;
    categoryRef.current = categoryId;
    setSelectedCategory(categoryId);
    if (categoryId === 'personal') { reloadVocabulary(); return; }
    const words = StorageService.getVocabulary();
    const batch = sampleCategoryWords(categoryId, {
      size: size === 'all' ? 32 : size,
      level,
      learnedWords: [
        ...words.filter((word) => word.reviewCount > 0 || word.step > 0 || word.status === 'mastered'),
        ...StorageService.getStudyEvents().filter((event) => event.type === 'category' && event.metadata?.quality !== 'again').map((event) => event.entityId),
      ],
      previousWords: categoryId === selectedCategory ? dueCards.map((card) => card.word) : [],
    });
    const savedCards = batch.map((word) => words.find((item) => item.word.toLowerCase() === word.word.toLowerCase()) || {...word, id:`explore:${categoryId}:${word.word}`, reviewCount:0, interval:0});
    setVocabulary(words);
    setDueTotal(dueVocabulary(scopedVocabulary(words)).length);
    setDueCards(savedCards);
    setCurrentIndex(0);
    setIsFlipped(false);
    setReviewCompleted(false);
    setDataError('');
    setSpellingAnswer('');
    setSpellingChecked(false);
  };
  const collectCategory = (single = null) => {
    const candidates = single ? [single] : dueCards;
    let savedCount = 0;
    for (const candidate of candidates) {
      const {id: _temporaryId, ...payload} = candidate;
      if (!StorageService.addWord(payload)) { setDataError('有词卡尚未收藏成功，请检查存储空间后重试。'); break; }
      savedCount += 1;
    }
    setVocabulary(StorageService.getVocabulary());
    if (savedCount) toast.success(`已收藏 ${savedCount} 个词，可到“我的生词”间隔复习。`);
  };
  const lastRatedRef = useRef({ id: '', at: 0 });
  const requeuedRef = useRef(new Set(restoredSession.requeuedIds));
  const planTargetsRef = useRef(intent?.wordIds);
  const undoTimerRef = useRef(null);

  // Manual Add Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [inputWord, setInputWord] = useState('');
  const [inputContext, setInputContext] = useState('');
  const [isAddingWord, setIsAddingWord] = useState(false);

  // AI Quiz states
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [quizScore, setQuizScore] = useState(null);

  // Vocab Story Studio states
  const [showStoryModal, setShowStoryModal] = useState(false);
  const [storyGenre, setStoryGenre] = useState('mystery');
  const [selectedStoryWords, setSelectedStoryWords] = useState([]);
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [generatedStory, setGeneratedStory] = useState(null);
  const [isPlayingStory, setIsPlayingStory] = useState(false);
  const [isSavedToReader, setIsSavedToReader] = useState(false);

  // Edit Word states
  const [editingWord, setEditingWord] = useState(null);
  const [editTranslation, setEditTranslation] = useState('');
  const [editContextSentence, setEditContextSentence] = useState('');
  const [editUserNote, setEditUserNote] = useState('');
  const [showStatsDetail, setShowStatsDetail] = useState(false);

  const handleOpenEdit = (item, e) => {
    e.stopPropagation();
    setEditingWord(item);
    setEditTranslation(item.translation || '');
    setEditContextSentence(item.contextSentence || '');
    setEditUserNote(item.userNote || '');
  };

  const handleSaveEdit = () => {
    if (!editingWord) return;
    const saved = StorageService.updateWord(editingWord.id, {
      translation: editTranslation.trim(),
      contextSentence: editContextSentence.trim(),
      userNote: editUserNote.trim(),
    });
    if (!saved) {
      setDataError('修改没有保存成功（可能是浏览器存储已满）。请先导出备份，再清理空间后重试。');
      return;
    }
    setDataError('');
    setEditingWord(null);
    reloadVocabulary();
  };

  // Reload vocabulary from storage with randomized shuffling
  const reloadVocabulary = (forcePractice = false) => {
    if (forcePractice) planTargetsRef.current = null;
    const storedWords = StorageService.getVocabulary();
    const words = fillCategoryPhonetics(storedWords);
    if (words.some((word, index) => word !== storedWords[index]) && !StorageService.saveVocabulary(words)) {
      setDataError('音标已显示，但补全结果未能保存。请检查浏览器存储空间后重试。');
    }
    setVocabulary(words);
    setStudyStats(StorageService.getStudyStats());

    // Calculate due cards (nextReviewDate <= now + 1 hour)
    // Reading the clock is inherent to "what is due right now"; this function only runs from
    // effects and event handlers (never during render), so the purity heuristic does not apply.
    // oxlint-disable-next-line react/purity
    const now = Date.now();
    const pool = scopedVocabulary(words).filter((word) => word.translation?.trim());
    const due = dueVocabulary(pool, now);
    setDueTotal(due.length);

    if (forcePractice) {
      // Randomly sample 8 words from entire deck
      const randomBatch = shuffleArray(pool).slice(0, Math.min(8, pool.length));
      setDueCards(randomBatch);
      setCurrentIndex(0);
      setIsFlipped(false);
      setReviewCompleted(false);
    } else if (planTargetsRef.current?.length || due.length > 0) {
      // Shuffle due cards to eliminate predictable position memory, then cap the session.
      // Without a cap, coming back after a week off meant being handed a 200+ card queue
      // with no way to say "I'll do 20 today" — the classic reason learners quit a streak.
      const size = readSessionSize();
      setDueCards(selectReviewSession(pool, { size, wordIds: planTargetsRef.current, now }));
      requeuedRef.current.clear();
      setCurrentIndex(0);
      setIsFlipped(false);
      setReviewCompleted(false);
    } else {
      // Clean completion state: no cards left for today
      setDueCards([]);
      setCurrentIndex(0);
      setIsFlipped(false);
      setReviewCompleted(true);
    }
  };

  const changeSessionSize = (size) => {
    planTargetsRef.current = null;
    setSessionSize(size);
    const state = StorageService.getAppState();
    StorageService.saveAppState({ ...state, vocabSessionSize: size });
    setReviewCompleted(false);
    // Rebuild the queue with the new size (due list is recomputed from current storage).
    if (categoryRef.current !== 'personal') startCategory(categoryRef.current, selectedLevel, size);
    else reloadVocabulary();
  };

  useEffect(() => {
    if (!intent?.wordIds?.length || intent.token === appliedIntentRef.current) return;
    appliedIntentRef.current = intent.token;
    categoryRef.current = 'personal';
    // External plan navigation changes the active queue; ordinary initialization is handled above.
    // oxlint-disable-next-line react/set-state-in-effect
    setSelectedCategory('personal');
    planTargetsRef.current = intent?.wordIds;
    reloadVocabulary();
    setActiveTab('flashcard');
  }, [intent]);

  useEffect(() => {
    return () => {
      clearTimeout(ratingAdvanceRef.current);
      clearTimeout(undoTimerRef.current);
    };
  }, []);

  const sessionSnapshot = useMemo(() => ({activeTab,selectedCategory,selectedLevel,dueCards,currentIndex,isFlipped,reviewCompleted,learningMode,spellingAnswer,spellingChecked}), [activeTab,selectedCategory,selectedLevel,dueCards,currentIndex,isFlipped,reviewCompleted,learningMode,spellingAnswer,spellingChecked]);
  useLearningSession('vocabulary', sessionSnapshot, () => setDataError('本轮位置暂未保存，请保留当前页面并检查存储空间。'));

  useEffect(() => {
    if (!focusRequestedRef.current) return;
    focusRequestedRef.current = false;
    const target = isFlipped ? answerPanelRef.current : learningMode === 'spelling' ? spellingInputRef.current : flipButtonRef.current;
    target?.focus({ preventScroll: true });
  }, [isFlipped, currentIndex, learningMode]);

  const flipCard = () => {
    if (learningMode === 'spelling' && !isFlipped && !spellingAnswer.trim()) return;
    focusRequestedRef.current = true;
    if (learningMode === 'spelling' && !isFlipped) setSpellingChecked(true);
    setIsFlipped((value) => !value);
  };

  // Flashcard Rating: 'again' | 'hard' | 'good'
  const handleRateCard = (quality) => {
    if (dueCards.length === 0) return;
    const currentCard = dueCards[currentIndex];
    if (!currentCard) return;

    // Guard against a double tap: the next card is only shown after a 150ms delay, so a
    // second tap used to rate the *same* card twice (reviewCount/step +2, one card skipped).
    const lastRated = lastRatedRef.current;
    const at = ratingTimestamp();
    if (lastRated.id === currentCard.id && at - lastRated.at < RATING_LOCK_MS) return;
    lastRatedRef.current = { id: currentCard.id, at };
    focusRequestedRef.current = true;

    if (categoryRef.current !== 'personal') {
      if (!StorageService.recordStudyActivity({type:'category', count:1, source:'category-practice',entityId:currentCard.word,label:'分类词练习',durationMinutes:studyClock.takeMinutes(),metadata:{quality}})) {
        lastRatedRef.current = {id:'',at:0}; setDataError('本次练习记录未保存，请重试。'); return;
      }
      setStudyStats(StorageService.getStudyStats());
      setIsFlipped(false); setSpellingAnswer(''); setSpellingChecked(false);
      const requeue = quality === 'again' && !requeuedRef.current.has(currentCard.id);
      if (requeue) { requeuedRef.current.add(currentCard.id); setDueCards((cards) => [...cards,currentCard]); }
      if (requeue || currentIndex + 1 < dueCards.length) setCurrentIndex((index) => index + 1);
      else setReviewCompleted(true);
      return;
    }

    // Snapshot the stored state so this rating can be undone (see handleUndoRating).
    const storedBefore = StorageService.getVocabulary().find((w) => w.id === currentCard.id) || null;
    const statsBefore = StorageService.getStudyStats();

    const updatedWord = StorageService.updateWordSRS(currentCard.id, quality);
    if (!updatedWord) {
      // The write failed (quota / blocked storage): keep the card and tell the user.
      lastRatedRef.current = { id: '', at: 0 };
      setDataError('这次评分没有保存成功（可能是浏览器存储已满）。请先导出备份再重试。');
      return;
    }
    setDueTotal(dueVocabulary(scopedVocabulary(StorageService.getVocabulary())).length);
    setDataError('');
    const updatedStats = StorageService.recordReviewActivity(1, { entityId: currentCard.id, durationMinutes: studyClock.takeMinutes(), metadata: { quality, taskId: intent?.taskId || '' } });
    if (!updatedStats) {
      if (storedBefore) StorageService.updateWord(currentCard.id, storedBefore);
      setDataError('学习记录没有保存成功，本次评分已撤回，请重试。');
      return;
    }
    setStudyStats(updatedStats);

    if (storedBefore) {
      setUndoState({
        wordId: currentCard.id,
        snapshot: storedBefore,
        statsBefore,
        label: currentCard.word,
        quality,
      });
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      // This mutable React ref is written only by the rating handler, never during render.
      // oxlint-disable-next-line react/immutability
      undoTimerRef.current = setTimeout(() => setUndoState(null), UNDO_WINDOW_MS);
    }

    setIsFlipped(false);
    setSpellingAnswer('');
    setSpellingChecked(false);

    // "again" means relearn today: put the card back at the end of this session's queue
    // (bounded to one requeue per card so a forgotten word cannot loop forever).
    const willRequeue = quality === 'again' && !requeuedRef.current.has(currentCard.id);
    if (willRequeue) {
      requeuedRef.current.add(currentCard.id);
      setDueCards((prev) => [...prev, { ...updatedWord }]);
    }

    if (willRequeue || currentIndex + 1 < dueCards.length) {
      ratingAdvanceRef.current = setTimeout(() => {
        setCurrentIndex((prev) => prev + 1);
      }, 150);
    } else {
      // Completed all due reviews
      setReviewCompleted(true);
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
      });
      // Refresh local list and recompute what is still due, so the completion screen does not
      // report a stale backlog count.
      const words = StorageService.getVocabulary();
      setVocabulary(words);
      setDueTotal(dueVocabulary(scopedVocabulary(words)).length);
    }
  };

  // Undo the most recent rating: restore the word's SRS state and roll back the review
  // counters/event recorded for it, then put the card back in front of the user.
  const handleUndoRating = () => {
    if (!undoState) return;
    const restored = StorageService.revertReview({
      snapshot: undoState.snapshot,
      previousStats: undoState.statsBefore,
      entityId: undoState.wordId,
    });
    if (!restored) {
      setDataError('撤销失败，未能恢复这条评分。');
      return;
    }
    requeuedRef.current.delete(undoState.wordId);
    lastRatedRef.current = { id: '', at: 0 };
    const restoredCard = { ...undoState.snapshot };
    // The rating had advanced the cursor by one, so put the card back where it was and
    // step the cursor back to it — otherwise the card that was on screen gets skipped.
    const insertAt = Math.max(0, currentIndex - 1);
    setDueCards((prev) => {
      const rest = prev.filter((card) => card.id !== restoredCard.id);
      const at = Math.min(insertAt, rest.length);
      return [...rest.slice(0, at), restoredCard, ...rest.slice(at)];
    });
    setCurrentIndex(insertAt);
    setReviewCompleted(false);
    setIsFlipped(true);
    setVocabulary(StorageService.getVocabulary());
    setStudyStats(StorageService.getStudyStats());
    setUndoState(null);
    setDataError('');
  };

  // Look up a word locally and keep the original context with the saved card.
  const handleAddWord = async () => {
    const word = inputWord.trim();
    if (!word) return;

    setIsAddingWord(true);
    try {
      let analysis = null;
      try {
        analysis = await lookupLearningWord(word, inputContext);
      } catch {
        // Lookup unavailable: keep the word but leave the meaning EMPTY. The placeholder text
        // used to be written here ("自主添加生词"), which looked complete and defeated the
        // app's own "需要释义" filter (studyView.js treats a blank translation as missing).
        analysis = {
          word,
          phonetic: '',
          pos: '',
          translation: '',
          definitionEn: '',
          contextSentence: inputContext,
        };
      }

      const added = StorageService.addWord({
        word,
        phonetic: analysis?.phonetic || '',
        pos: analysis?.pos || '',
        translation: analysis?.translation || '',
        definitionEn: analysis?.definitionEn || '',
        contextSentence: inputContext || analysis?.contextSentence || '',
        contextSentenceCn: analysis?.contextSentenceCn || '',
        tags: ['手动输入'],
      });
      if (!added) {
        setDataError('这个词没有保存成功（可能是浏览器存储已满）。');
        return;
      }
      setDataError(added.translation ? '' : '已加入生词本，但暂时没有释义——可在“需要释义”筛选里补齐。');

      setShowAddModal(false);
      setInputWord('');
      setInputContext('');
      reloadVocabulary();
    } finally {
      setIsAddingWord(false);
    }
  };

  // Delete word
  const handleDeleteWord = (id, e) => {
    e.stopPropagation();
    if (!confirm('确认将此单词从生词本中删除？该词的复习进度、来源与个人笔记会一并移除，且不可撤销。')) return;
    const updated = StorageService.deleteWord(id);
    if (!updated) {
      setDataError('删除没有保存成功，这个词仍在生词本里。');
      return;
    }
    setDataError('');
    setVocabulary(updated);
    reloadVocabulary();
  };

  // Open story studio modal
  const handleOpenStoryStudio = () => {
    const defaultWords = vocabulary.slice(0, 4).map((w) => w.word);
    setSelectedStoryWords(defaultWords);
    setGeneratedStory(null);
    setIsSavedToReader(false);
    setShowStoryModal(true);
  };

  // Generate Story
  const handleGenerateStory = async () => {
    if (selectedStoryWords.length === 0) {
      toast.error('请至少勾选 1 个生词融入故事');
      return;
    }

    setIsGeneratingStory(true);
    try {
      const wordsToUse = vocabulary.filter((w) => selectedStoryWords.includes(w.word));
      const res = await generateVocabStoryWithAI({
        words: wordsToUse,
        genre: storyGenre,
      });
      setGeneratedStory(res);
      setIsSavedToReader(false);
      confetti({
        particleCount: 60,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch (err) {
      toast.error(`微剧场生成失败: ${err.message}`);
    } finally {
      setIsGeneratingStory(false);
    }
  };

  // Play Story Audio
  const handleTogglePlayStory = () => {
    if (!generatedStory) return;
    if (isPlayingStory) {
      tts.stop();
      setIsPlayingStory(false);
    } else {
      setIsPlayingStory(true);
      const plainText = generatedStory.storyEn.replace(/\*\*/g, '');
      tts.speak(plainText).finally(() => {
        setIsPlayingStory(false);
      });
    }
  };

  // Save to SmartReader
  const handleSaveStoryToReader = () => {
    if (!generatedStory) return;
    const plainContent = generatedStory.storyEn.replace(/\*\*/g, '');
    const saved = StorageService.saveArticle({
      title: `${generatedStory.title} (${generatedStory.titleCn || '微剧场'})`,
      level: 'AI 生词微剧场',
      content: plainContent,
      contentCn: generatedStory.storyCn || '',
      targetWords: selectedStoryWords,
      tags: ['生词微剧场', storyGenre],
    });
    if (!saved) { toast.error('故事没有保存成功，请检查存储空间。'); return; }
    setIsSavedToReader(true);
  };

  // Start AI Quiz
  const handleGenerateQuiz = async () => {
    if (vocabulary.length < 2) {
      toast.error('生词本中至少需要有 2 个词才能生成测验，先去阅读或对话中收集几个词吧！');
      return;
    }

    setIsGeneratingQuiz(true);
    setSelectedAnswers({});
    setQuizScore(null);

    try {
      // Pick 4 random words
      const shuffled = [...vocabulary].sort(() => 0.5 - Math.random()).slice(0, 4);
      const res = await generateVocabularyQuiz(shuffled);
      setQuizQuestions(res.questions || []);
    } catch (err) {
      toast.error(`生成测验失败: ${err.message}`);
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  // Handle quiz option select
  const handleSelectOption = (questionId, optionIdx, correctIdx) => {
    const updated = {
      ...selectedAnswers,
      [questionId]: optionIdx,
    };
    setSelectedAnswers(updated);

    // If answer is wrong, auto-penalize and put word back to review queue!
    if (optionIdx !== correctIdx) {
      const q = quizQuestions.find((item) => item.id === questionId);
      if (q?.targetWord) {
        const found = vocabulary.find(
          (w) => w.word.toLowerCase() === q.targetWord.toLowerCase()
        );
        if (found) {
          StorageService.updateWordSRS(found.id, 'again');
        }
      }
    }

    // Check if all questions are answered
    if (quizQuestions.length > 0 && Object.keys(updated).length === quizQuestions.length) {
      let correct = 0;
      const wrongs = [];
      quizQuestions.forEach((q) => {
        if (updated[q.id] === q.correctIndex) {
          correct += 1;
        } else {
          wrongs.push(q.targetWord);
        }
      });

      setQuizScore({
        total: quizQuestions.length,
        correct,
        percent: Math.round((correct / quizQuestions.length) * 100),
        wrongs,
      });
      const updatedStats = StorageService.recordStudyActivity({
        type: 'quiz',
        count: 1,
        source: 'vocab-quiz',
        label: '完成 AI 词汇测验',
        metadata: { correct, total: quizQuestions.length },
      });
      if (updatedStats) setStudyStats(updatedStats);

      if (correct === quizQuestions.length) {
        confetti({
          particleCount: 70,
          spread: 60,
          origin: { y: 0.5 },
        });
      }
    }
  };

  // Filtered vocabulary list
  const filteredWords = filterVocabulary(vocabulary, searchQuery, filterStatus);

  const currentCard = dueCards[currentIndex];
  const missingMeaningCount = vocabulary.filter((word) => !word.translation?.trim()).length;

  return (
    <div className="study-page vocab-page flex flex-col h-full">
      <StudyHeader
        title={activeTab === 'flashcard' ? '记忆词卡' : activeTab === 'list' ? '我的词库' : '巩固测验'}
        status={StorageService.isUsingSampleVocabulary() ? '示例词卡' : `${vocabulary.length} 个词 · 今日复习 ${studyStats.todayReviewedCount || 0} 词`}
        actions={<>
          <details className="vocab-menu"><summary aria-label="词卡更多功能"><MoreHorizontal size={20} /></summary><div>
            <button type="button" aria-current={activeTab === 'flashcard' ? 'page' : undefined} onClick={(event) => { setActiveTab('flashcard'); event.currentTarget.closest('details').open = false; }}>闪卡复习</button>
            <button type="button" aria-current={activeTab === 'list' ? 'page' : undefined} onClick={(event) => { setActiveTab('list'); event.currentTarget.closest('details').open = false; }}>生词库清单</button>
            <button type="button" aria-current={activeTab === 'quiz' ? 'page' : undefined} onClick={(event) => { setActiveTab('quiz'); if (!quizQuestions.length) handleGenerateQuiz(); event.currentTarget.closest('details').open = false; }}>AI 巩固测验</button>
            <button type="button" onClick={(event) => { setShowStatsDetail(true); event.currentTarget.closest('details').open = false; }}>查看学习统计</button>
            <button type="button" onClick={(event) => { handleOpenStoryStudio(); event.currentTarget.closest('details').open = false; }}>生词微剧场</button>
          </div></details>
          <button type="button" aria-label="添加词" title="添加词" onClick={() => setShowAddModal(true)} className="vocab-header-action is-primary"><Plus size={19} /></button>
        </>}
      >
        {sectionSwitch}
        <div className="vocab-mode-tabs">
          <button type="button" aria-current={activeTab === 'flashcard' ? 'page' : undefined} onClick={() => setActiveTab('flashcard')}>闪卡复习</button>
          <button type="button" aria-current={activeTab === 'list' ? 'page' : undefined} onClick={() => setActiveTab('list')}>生词库清单</button>
          <button type="button" aria-current={activeTab === 'quiz' ? 'page' : undefined} onClick={() => { setActiveTab('quiz'); if (!quizQuestions.length) handleGenerateQuiz(); }}>AI 巩固测验</button>
        </div>
      </StudyHeader>

      {/* Main Body */}
      <div className="vocab-content flex-1 overflow-y-auto p-4 pb-20">
        {/* Write failures (quota / blocked storage) must be visible from every tab, not only
            on the flashcard: rating, adding, editing and deleting all write to localStorage. */}
        {dataError && (
          <output className="mx-auto mb-3 block max-w-md rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-800">
            {dataError}
          </output>
        )}

        {/* ================= TAB 1: FLASHCARD SRS ================= */}
        {activeTab === 'flashcard' && (
          <div className="flashcard-workspace max-w-md mx-auto min-h-full flex flex-col gap-2 py-2">
            <div className="vocab-deck-picker">
              <div className="deck-select-row flex items-center gap-2">
                <label htmlFor="vocab-category" className="shrink-0 text-xs font-semibold text-slate-600">词库</label>
                <select id="vocab-category" aria-label="选择词卡分类" value={selectedCategory} onChange={(event) => startCategory(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-2 py-2 text-sm text-[#102a43]">
                  <option value="personal">我的生词 · 到期复习</option>
                  {VOCABULARY_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.icon} {item.label}</option>)}
                </select>
                {category && <button type="button" onClick={() => startCategory(selectedCategory)} className="shrink-0 rounded-lg bg-[#102a43] px-3 py-2 text-xs font-semibold text-white">换一组</button>}
              </div>
              {category && showDeckSettings && <div className="vocab-level-row"><label htmlFor="vocab-learning-level">学习等级</label><select id="vocab-learning-level" value={selectedLevel} onChange={(event) => { const level = event.target.value; setSelectedLevel(level); startCategory(selectedCategory, level); }}><option value="all">全部等级 · 32 词</option><option value="starter">入门常用 · 8 词</option><option value="core">核心表达 · 16 词</option><option value="advanced">专业进阶 · 8 词</option></select></div>}
              <div className="deck-action-row"><button type="button" aria-expanded={showDeckSettings} onClick={() => setShowDeckSettings((value) => !value)}>练习设置 · {learningMode === 'recall' ? '看词回忆' : '听音拼写'}</button>{category && <button type="button" onClick={() => collectCategory()}>收藏本组</button>}</div>
              {showDeckSettings && <fieldset className="deck-settings"><legend>练习设置</legend><label htmlFor="vocab-learning-mode">练习方式</label><select id="vocab-learning-mode" value={learningMode} onChange={(event) => {setLearningMode(event.target.value);setIsFlipped(false);setSpellingAnswer('');setSpellingChecked(false);}}><option value="recall">看词回忆</option><option value="spelling">听音拼写</option></select><span>每组数量</span><div className="flex gap-2">{SESSION_SIZE_OPTIONS.map((size) => <button key={String(size)} type="button" aria-pressed={sessionSize === size} onClick={() => changeSessionSize(size)}>{size === 'all' ? '全部' : size}</button>)}</div>{category && <><p>{category.description}</p><ol className="vocab-learning-route">{category.learningRoute.map((stage) => <li key={stage.level}>{stage.title}</li>)}</ol></>}<details className="col-span-2 text-slate-500"><summary className="cursor-pointer">复习帮助</summary><p className="mt-2">分类练习优先抽取未练过、未出现的词，收藏后进入个人间隔复习。个人词卡按评分调整间隔；缺少释义的词需先在“需要释义”中补齐。</p></details></fieldset>}
            </div>
            {!reviewCompleted && currentCard ? (
              <>
                {/* Progress Bar & Counter */}
                <div className="vocab-progress-caption flex items-center justify-between text-xs text-slate-600 px-1">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-600" />
                    <span>{category ? `${category.label} · 本组进度` : '今日复习进度'}</span>
                  </div>
                  <span className="font-mono font-semibold text-slate-700">
                    {currentIndex + 1} / {dueCards.length}
                  </span>
                </div>

                {/* Backlog transparency: say how many are due in total, and let the learner
                    pick a batch size instead of being handed the whole pile. */}
                {(!category && (dueTotal > dueCards.length || dueCards.length > 10)) && (
                  <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-2.5 py-1.5 text-[10px] text-slate-600">
                    <span>
                      今天到期 {dueTotal} 个{ dueTotal > dueCards.length ? `，本次做 ${dueCards.length} 个` : '' }
                    </span>
                    <span className="hidden">
                      <span className="text-slate-400">每组</span>
                      {SESSION_SIZE_OPTIONS.map((size) => (
                        <button
                          key={String(size)}
                          type="button"
                          onClick={() => changeSessionSize(size)}
                          className={`rounded-md px-1.5 py-0.5 font-semibold ${sessionSize === size ? 'bg-sky-600 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}
                        >
                          {size === 'all' ? '全部' : size}
                        </button>
                      ))}
                    </span>
                  </div>
                )}

                {/* Progress Track */}
                <div className="vocab-progress-track w-full h-1.5 bg-slate-200/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-blue-600 transition-all duration-300"
                    style={{
                      width: `${((currentIndex + 1) / dueCards.length) * 100}%`,
                    }}
                  />
                </div>

                {/* Undo bar: a mis-tapped rating can be taken back for a few seconds */}
                {undoState && (
                  <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                    <span className="truncate">已给「{undoState.label}」评了分</span>
                    <button type="button" onClick={handleUndoRating} className="flex-none font-semibold underline">
                      撤销
                    </button>
                  </div>
                )}

                {/* 3D Flip Card Container */}
                <fieldset
                  aria-label="记忆词卡"
                  className="vocab-flip-card w-full min-w-0 border-0 p-0 flex-none h-[300px] md:h-[360px] perspective-1000 relative select-none"
                >
                  <div
                    className={`w-full h-full duration-500 transform-style-preserve-3d relative transition-transform rounded-3xl ${
                      isFlipped ? 'rotate-y-180' : ''
                    }`}
                  >
                    {/* --- FRONT SIDE --- */}
                    <div aria-hidden={isFlipped} inert={isFlipped} className="flashcard-front absolute inset-0 backface-hidden bg-white/95 border border-white/90 rounded-3xl p-6 flex flex-col justify-between shadow-[0_8px_30px_-4px_rgba(15,23,42,0.08)] hover:shadow-xl transition-all">
                      <div className="flex justify-between items-start">
                        <span className="text-[11px] font-semibold px-2.5 py-0.5 bg-sky-50 text-sky-700 rounded-lg ring-1 ring-sky-200/60">
                          {currentCard.tags?.[0] || '生词闪卡'}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            tts.speak(currentCard.word);
                          }}
                          className="p-2 text-sky-600 hover:bg-sky-50 rounded-full transition-colors active:scale-90"
                          title="发音朗读"
                          aria-label="发音朗读"
                        >
                          <Volume2 className="w-5 h-5" />
                        </button>
                      </div>

                      {/* Main Word & Phonetic */}
                      <div className="text-center py-4">
                        {learningMode === 'spelling' ? <div className="spelling-practice"><p>听发音，写出这个词</p><button type="button" onClick={() => tts.speak(currentCard.word)}>再听一遍</button><label htmlFor="spelling-answer" className="sr-only">拼写答案</label><input ref={spellingInputRef} id="spelling-answer" value={spellingAnswer} autoComplete="off" autoCapitalize="off" spellCheck={false} onKeyDown={(event) => { if (event.key === 'Enter' && spellingAnswer.trim()) flipCard(); }} onChange={(event) => {setSpellingAnswer(event.target.value);setSpellingChecked(false);}} /></div> : <>
                        <h2 className="text-3xl md:text-4xl font-bold font-serif text-slate-900 tracking-tight">
                          {currentCard.word}
                        </h2>
                        {currentCard.phonetic && (
                          <p className="text-sm text-sky-700 font-mono mt-1.5 font-medium">
                            {currentCard.phonetic}
                          </p>
                        )}
                        </>}
                      </div>

                      {/* Context Sentence (Crucial for Retention!) */}
                      {learningMode === 'recall' && currentCard.contextSentence ? (
                        <div className="bg-slate-50/90 p-3.5 rounded-2xl border border-slate-200/60 text-xs text-slate-700 leading-relaxed text-center shadow-2xs font-serif">
                          <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-sans font-bold mb-1">
                            语境例句
                          </span>
                          "{currentCard.contextSentence}"
                        </div>
                      ) : (
                        <div className="h-10"></div>
                      )}

                    </div>

                    {/* --- BACK SIDE --- */}
                    <div ref={answerPanelRef} tabIndex={-1} aria-label="词卡答案" aria-hidden={!isFlipped} inert={!isFlipped} className="flashcard-back absolute inset-0 backface-hidden rotate-y-180 bg-white/95 border border-amber-200/80 rounded-3xl p-6 flex flex-col justify-between shadow-[0_8px_30px_-4px_rgba(15,23,42,0.08)] overflow-y-auto">
                      <div>
                        <div className="flex justify-between items-start pb-3 border-b border-slate-100">
                          <div>
                            <span className="text-xs font-semibold px-2 py-0.5 bg-sky-100/80 text-sky-800 rounded-md mr-2">
                              {currentCard.pos || '释义'}
                            </span>
                            <span className="text-xl font-bold font-serif text-slate-900">
                              {currentCard.word}
                            </span>
                            {currentCard.phonetic && <p className="mt-1 text-xs font-mono text-sky-700">{currentCard.phonetic}</p>}
                          </div>
                          <button
                            aria-label="朗读答案单词"
                            onClick={(e) => {
                              e.stopPropagation();
                              tts.speak(currentCard.word);
                            }}
                            className="p-1.5 text-sky-600 hover:bg-sky-50 rounded-full active:scale-90"
                          >
                            <Volume2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Translation */}
                        <div className="mt-3.5">
                          {spellingChecked && <output className="mb-2 block text-sm font-semibold">{matchesVocabularySpelling(spellingAnswer, currentCard.word) ? '拼写正确' : `你的拼写：${spellingAnswer}。对照正确单词再试一次。`}</output>}
                          <p className="text-base font-bold text-slate-900 leading-snug">
                            {currentCard.translation || '暂无详细中文释义'}
                          </p>
                          {!currentCard.translation?.trim() && (
                            <button type="button" onClick={(event) => handleOpenEdit(currentCard, event)} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                              <Edit3 className="w-3 h-3" />补充中文释义
                            </button>
                          )}
                          {currentCard.definitionEn && (
                            <p className="text-xs text-slate-500 mt-1 italic leading-relaxed">
                              {currentCard.definitionEn}
                            </p>
                          )}
                          {!!currentCard.collocations?.length && <p className="vocab-collocation">常用搭配 · {currentCard.collocations.join(' · ')}</p>}
                        </div>

                        {/* Context Sentence Breakdown */}
                        {currentCard.contextSentence && (
                          <div className="mt-4 bg-[#faf8f5] p-3.5 rounded-2xl border border-[#e8dfcf] text-xs space-y-1 shadow-2xs">
                            <p className="text-slate-850 font-serif font-medium leading-relaxed">
                              "{currentCard.contextSentence}"
                            </p>
                            {currentCard.contextSentenceCn && (
                              <p className="text-slate-500 pt-1.5 border-t border-slate-200/60 leading-relaxed">
                                {currentCard.contextSentenceCn}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Personal Note if exists */}
                        {currentCard.userNote && (
                          <div className="mt-3 p-2.5 bg-amber-50 border border-amber-200/70 rounded-xl text-xs text-amber-900 leading-relaxed">
                            <span className="font-bold text-[10.5px] text-amber-800 flex items-center gap-1 mb-0.5">
                              <StickyNote className="w-3 h-3 text-amber-600" />
                              <span>助记笔记</span>
                            </span>
                            <p>{currentCard.userNote}</p>
                          </div>
                        )}
                      </div>

                      {!category && <details className="pt-2 text-xs text-slate-500"><summary className="cursor-pointer">复习安排</summary><p className="mt-1">已复习 {currentCard.reviewCount || 0} 次 · 下次间隔 {currentCard.intervalDays || 1} 天</p></details>}
                    </div>
                  </div>
                </fieldset>

                <div className="flashcard-tools"><button ref={flipButtonRef} type="button" disabled={learningMode === 'spelling' && !isFlipped && !spellingAnswer.trim()} onClick={flipCard}>{isFlipped ? '返回单词' : learningMode === 'spelling' ? '检查拼写' : '查看释义'}</button>{category && <button type="button" onClick={() => collectCategory(currentCard)}>收藏此词</button>}{onOpenSource && <button type="button" onClick={() => onOpenSource({type:'dictionary',id:currentCard.word})}>查词详情</button>}</div>

                {/* SRS Evaluation Buttons (only meaningful once the answer is visible) */}
                <div className="vocab-ratings mt-5 grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    disabled={!isFlipped}
                    onClick={(event) => { event.stopPropagation(); handleRateCard('again'); }}
                    className="flex flex-col items-center py-2.5 px-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-2xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <strong className="text-sm font-semibold">再认识一下</strong>
                  </button>

                  <button
                    type="button"
                    disabled={!isFlipped}
                    onClick={(event) => { event.stopPropagation(); handleRateCard('hard'); }}
                    className="flex flex-col items-center py-2.5 px-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-2xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <strong className="text-sm font-semibold">有点印象</strong>
                  </button>

                  <button
                    type="button"
                    disabled={!isFlipped}
                    onClick={(event) => { event.stopPropagation(); handleRateCard('good'); }}
                    className="flex flex-col items-center py-2.5 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-2xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <strong className="text-sm font-semibold">记住了</strong>
                  </button>
                </div>
              </>
            ) : (
              /* Review Finished / No Due Cards Celebration */
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs">
                <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-4">
                  <Trophy className="w-8 h-8 text-amber-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-850">
                  {category ? `${category.label} · 本组完成` : vocabulary.length === 0
                    ? '选一个分类，开始学词'
                    : dueTotal > 0
                      ? '这一组复习完成'
                      : '今日复习完成'}
                </h3>

                <div className="mt-6 flex flex-col w-full max-w-xs space-y-2">
                  {category && <button type="button" onClick={() => startCategory(selectedCategory)} className="w-full rounded-xl bg-[#102a43] py-2.5 text-xs font-semibold text-white">再练一组</button>}
                  {!category && dueTotal > 0 && (
                    <button
                      onClick={() => {
                        // Plan targets are an event-owned mutable ref, not a state dependency.
                        // oxlint-disable-next-line react/immutability
                        planTargetsRef.current = null;
                        reloadVocabulary();
                      }}
                      className="w-full py-2.5 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>继续下一组（还剩 {dueTotal} 个）</span>
                    </button>
                  )}
                  {!category && vocabulary.length > 0 && (
                    <button
                      onClick={() => reloadVocabulary(true)}
                      className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>随机练 8 词</span>
                    </button>
                  )}
                  <button
                    onClick={() => setActiveTab('quiz')}
                    className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
                  >
                    去做 3 道 AI 语境测验
                  </button>
                  <button
                    onClick={() => setActiveTab('list')}
                    className="w-full py-2 text-slate-500 hover:text-slate-800 text-xs transition-colors"
                  >
                    查看生词库清单 ({vocabulary.length})
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2: VOCABULARY LIST ================= */}
        {activeTab === 'list' && (
          <div className="space-y-3 max-w-xl mx-auto">
            {/* Search Bar */}
            <div className="bg-white border border-slate-200/80 rounded-2xl px-3 py-2 flex items-center gap-2 shadow-2xs">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                aria-label="搜索生词、中文释义或笔记"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索生词、释义或笔记"
                className="w-full text-xs text-slate-800 placeholder-slate-400 outline-hidden bg-transparent"
              />
              {searchQuery && (
                <button
                  aria-label="清空生词搜索"
                  onClick={() => setSearchQuery('')}
                  className="p-0.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Status Segmented Filter Pills */}
            <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pb-0.5 text-xs">
              {[
                { id: 'all', label: '全部', count: vocabulary.length },
                { id: 'learning', label: '学习中', count: vocabulary.filter((w) => w.status === 'learning').length },
                { id: 'review', label: '复习中', count: vocabulary.filter((w) => w.status === 'review').length },
                { id: 'hard', label: '困难词', count: vocabulary.filter((w) => w.tags?.includes('困难词') || (w.easeFactor || 2.5) <= 1.8).length },
                { id: 'needsMeaning', label: '待补释义', count: missingMeaningCount },
                { id: 'mastered', label: '👑 已牢记', count: vocabulary.filter((w) => w.status === 'mastered').length },
              ].map((f) => {
                const isActive = filterStatus === f.id;
                const isMastered = f.id === 'mastered';
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilterStatus(f.id)}
                    className={`flex-none px-3 py-1.5 rounded-xl border text-xs transition-all active:scale-95 flex items-center gap-1.5 ${
                      isActive
                        ? isMastered
                          ? 'bg-emerald-600 text-white border-emerald-600 font-bold shadow-xs'
                          : 'bg-sky-600 text-white border-sky-600 font-bold shadow-xs'
                        : 'bg-white/90 text-slate-600 border-slate-200/80 hover:bg-white'
                    }`}
                  >
                    <span>{f.label}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                        isActive
                          ? 'bg-white/20 text-white font-bold'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {f.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Words list or Specialized Mastered Empty State */}
            {filterStatus === 'mastered' && filteredWords.length === 0 ? (
              <div className="text-center py-12 px-5 bg-white/80 rounded-3xl border border-emerald-100/90 space-y-3 shadow-2xs">
                <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto text-2xl shadow-inner">
                  👑
                </div>
                <h4 className="font-bold text-slate-850 text-sm">暂无已牢记的生词</h4>
                <div className="pt-1">
                  <button
                    onClick={() => {
                      setActiveTab('flashcard');
                      reloadVocabulary(true);
                    }}
                    className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all active:scale-95"
                  >
                    闪卡复习
                  </button>
                </div>
              </div>
            ) : filteredWords.length > 0 ? (
              <div className="space-y-2">
                {filteredWords.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white border border-slate-200/80 rounded-2xl p-3.5 shadow-xs flex items-start justify-between gap-3 hover:border-sky-300 transition-all"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-base">
                          {item.word}
                        </span>
                        {item.phonetic && (
                          <span className="text-xs text-slate-600 font-mono">
                            {item.phonetic}
                          </span>
                        )}
                        <button
                          aria-label={`朗读单词 ${item.word}`}
                          onClick={() => tts.speak(item.word)}
                          className="p-1 text-sky-600 hover:bg-sky-50 rounded-full"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-xs text-slate-700 mt-1">
                        <span className="text-sky-700 font-medium mr-1.5">
                          {item.pos}
                        </span>
                        {item.translation}
                      </p>

                      {item.contextSentence && (
                        <p className="text-[11px] text-slate-600 mt-1.5 italic bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                          "{item.contextSentence}"
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-600">
                        <span className="bg-slate-100 px-1.5 py-0.5 rounded">
                          {item.tags?.[0] || '生词'}
                        </span>
                        <span>复习次数: {item.reviewCount || 0}</span>
                        {item.status === 'mastered' && <span>已掌握</span>}
                        <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">
                          下次复习: {formatDueDate(item.nextReviewDate)}
                        </span>
                      </div>
                      {Array.isArray(item.sources) && item.sources.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.sources.slice(0, 3).map((source) => {
                            const sourceKey = source.key || `${source.type}:${source.id}`;
                            const canOpen = typeof onOpenSource === 'function' && Boolean(source.type) && source.type !== 'category';
                            return canOpen ? (
                              <button
                                key={sourceKey}
                                type="button"
                                onClick={(event) => { event.stopPropagation(); onOpenSource(source); }}
                                className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700 ring-1 ring-sky-100 hover:bg-sky-100"
                                title={`回到原文：${source.label || source.id}`}
                              >
                                来源 · {source.label || source.id} ↗
                              </button>
                            ) : (
                              <span key={sourceKey} className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
                                来源 · {source.label || source.id}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1 flex-none">
                      {/* IconButton keeps the compact look but expands the touch target to 44x44:
                          stacked 26px buttons made “delete” easy to hit instead of “edit”. */}
                      <IconButton
                        label="编辑生词与个人笔记"
                        tone="sky"
                        onClick={(e) => handleOpenEdit(item, e)}
                        className="p-1.5"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </IconButton>
                      <IconButton
                        label={`删除生词 ${item.word}`}
                        tone="danger"
                        onClick={(e) => handleDeleteWord(item.id, e)}
                        className="p-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconButton>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-slate-600 text-xs">
                没有找到匹配的生词
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 3: AI SMART QUIZ ================= */}
        {activeTab === 'quiz' && (
          <div className="max-w-md mx-auto space-y-4">
            <div className="bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-200/80 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  AI 语境测验
                </h3>
              </div>

              <button
                onClick={handleGenerateQuiz}
                disabled={isGeneratingQuiz}
                className="flex items-center gap-1 bg-sky-600 hover:bg-sky-700 text-white text-xs font-medium px-3 py-1.5 rounded-xl shadow-xs transition-colors"
              >
                {isGeneratingQuiz ? '生成中...' : '换一批题目'}
              </button>
            </div>

            {isGeneratingQuiz ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-600 text-xs space-y-2">
                <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
                <span>正在生成题目…</span>
              </div>
            ) : quizQuestions.length > 0 ? (
              <div className="space-y-4">
                {quizQuestions.map((q, qIdx) => {
                  const userChoice = selectedAnswers[q.id];
                  const hasAnswered = userChoice !== undefined;

                  return (
                    <div
                      key={q.id || qIdx}
                      className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md">
                          第 {qIdx + 1} 题{hasAnswered ? ` · 考察词：${q.targetWord}` : ''}
                        </span>
                      </div>

                      {/* Question Sentence */}
                      <p className="text-sm font-medium text-slate-850 leading-relaxed">
                        {q.sentenceWithBlank}
                      </p>
                      {q.sentenceCn && (
                        <p className="text-xs text-slate-600">{q.sentenceCn}</p>
                      )}

                      {/* Options */}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        {keyedVocabularyText(q.options).map(({ text: opt, key, index: optIdx }) => {
                          const isSelected = userChoice === optIdx;
                          const isCorrect = optIdx === q.correctIndex;

                          let btnStyle =
                            'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100';
                          if (hasAnswered) {
                            if (isCorrect) {
                              btnStyle =
                                'bg-emerald-50 text-emerald-800 border-emerald-400 font-semibold';
                            } else if (isSelected && !isCorrect) {
                              btnStyle =
                                'bg-rose-50 text-rose-700 border-rose-300 line-through';
                            }
                          }

                          return (
                            <button
                              key={key}
                              disabled={hasAnswered}
                              onClick={() =>
                                handleSelectOption(q.id, optIdx, q.correctIndex)
                              }
                              className={`p-2.5 rounded-xl border text-xs text-left transition-all ${btnStyle}`}
                            >
                              <span className="font-semibold mr-1">
                                {String.fromCharCode(65 + optIdx)}.
                              </span>
                              {opt}
                            </button>
                          );
                        })}
                      </div>

                      {/* Explanation when answered */}
                      {hasAnswered && (
                        <div className="p-2.5 bg-slate-50 border border-slate-200/70 rounded-xl text-xs text-slate-700 space-y-1 mt-2">
                          <span className="font-semibold text-slate-600 block">
                            💡 解析与搭配:
                          </span>
                          <p>{q.explanation}</p>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Quiz Completion & Score Card */}
                {quizScore && (
                  <div className="bg-white border-2 border-sky-300 rounded-2xl p-4 shadow-md space-y-3 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Trophy className={`w-6 h-6 ${quizScore.correct === quizScore.total ? 'text-amber-500' : 'text-sky-600'}`} />
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">
                            测验完成
                          </h4>
                          <p className="text-xs text-slate-600">
                            得分：{quizScore.correct} / {quizScore.total} 题（正确率 {quizScore.percent}%）
                          </p>
                        </div>
                      </div>
                    </div>

                    {quizScore.wrongs.length > 0 ? (
                      <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1">
                        <p className="leading-relaxed text-[11px]">
                          已加入今日复习：<span className="font-bold font-mono">{quizScore.wrongs.join(', ')}</span>
                        </p>
                      </div>
                    ) : (
                      <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-1.5 font-medium">
                        <CheckCircle className="w-4 h-4 text-emerald-600 flex-none" />
                        <span>全部答对</span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() => {
                          setActiveTab('flashcard');
                          startCategory('personal');
                        }}
                        className="py-2 px-3 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center justify-center gap-1"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>前往闪卡复习</span>
                      </button>
                      <button
                        onClick={handleGenerateQuiz}
                        disabled={isGeneratingQuiz}
                        className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
                      >
                        换一批题目再战
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Vocab Story Studio Modal */}
      <Modal
        open={showStoryModal}
        onClose={() => setShowStoryModal(false)}
        ariaLabel="生词微剧场"
        size="lg"
        showCloseButton={false}
        bodyClassName="space-y-4 p-5"
      >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Film className="w-5 h-5 text-amber-500" />
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    生词微剧场
                  </h3>
                </div>
              </div>
              <button
                aria-label="关闭生词微剧场"
                onClick={() => {
                  tts.stop();
                  setIsPlayingStory(false);
                  setShowStoryModal(false);
                }}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Genre Select */}
            <div>
              <p className="block text-xs font-bold text-slate-700 mb-2">
                故事风格
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'mystery', icon: '🕵️‍♂️', label: '悬疑推理', desc: '深夜密室、暗藏线索' },
                  { id: 'workplace', icon: '💼', label: '硅谷职场', desc: '商战博弈、产品发布' },
                  { id: 'romance', icon: '☕', label: '都市温情', desc: '街角咖啡、治愈遇见' },
                  { id: 'cyberpunk', icon: '🚀', label: '未来科幻', desc: '霓虹夜市、AI觉醒' },
                ].map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={storyGenre === g.id}
                    onClick={() => setStoryGenre(g.id)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      storyGenre === g.id
                        ? 'bg-amber-50 border-amber-400 text-amber-900 font-semibold shadow-xs ring-1 ring-amber-300'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-bold">
                      <span>{g.icon}</span>
                      <span>{g.label}</span>
                    </span>
                    <span className="block text-[10px] text-slate-500 mt-0.5">{g.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Words To Include */}
            <div>
              <p className="block text-xs font-bold text-slate-700 mb-1.5">
                故事词汇
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1">
                {vocabulary.slice(0, 10).map((w) => {
                  const isChecked = selectedStoryWords.includes(w.word);
                  return (
                    <button
                      key={w.id}
                      type="button"
                      aria-pressed={isChecked}
                      onClick={() => {
                        setSelectedStoryWords((prev) =>
                          isChecked ? prev.filter((item) => item !== w.word) : [...prev, w.word]
                        );
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs transition-all border ${
                        isChecked
                          ? 'bg-sky-600 text-white border-sky-600 font-medium shadow-xs'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span>{w.word}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Generate Button */}
            {!generatedStory && (
              <button
                onClick={handleGenerateStory}
                disabled={isGeneratingStory || selectedStoryWords.length === 0}
                className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center justify-center gap-1.5"
              >
                {isGeneratingStory ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>正在生成故事…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-200" />
                    <span>生成故事</span>
                  </>
                )}
              </button>
            )}

            {/* Generated Story Display */}
            {generatedStory && (
              <div className="bg-amber-50/60 border border-amber-200/90 rounded-2xl p-4 space-y-3 animate-fade-in">
                <div className="flex items-start justify-between pb-2 border-b border-amber-200/60">
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">
                      {generatedStory.title}
                    </h4>
                    <p className="text-xs text-amber-800 font-medium mt-0.5">
                      {generatedStory.titleCn}
                    </p>
                  </div>

                  {/* Audio Play Button */}
                  <button
                    onClick={handleTogglePlayStory}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-xs transition-all ${
                      isPlayingStory
                        ? 'bg-rose-500 text-white animate-pulse'
                        : 'bg-amber-200/80 hover:bg-amber-300 text-amber-900'
                    }`}
                  >
                    <Headphones className="w-3.5 h-3.5" />
                    <span>{isPlayingStory ? '停止播放' : '有声朗读'}</span>
                  </button>
                </div>

                {/* English Story Body */}
                <div className="text-xs text-slate-800 leading-relaxed select-text space-y-2 font-serif">
                  {keyedVocabularyText(generatedStory.storyEn.split('\n\n')).map(({text: para, key}) => (
                    <p key={key}>{para}</p>
                  ))}
                </div>

                {/* Chinese Translation */}
                <div className="pt-2 border-t border-amber-200/60 text-xs text-slate-600 leading-relaxed select-text">
                  <span className="font-semibold text-amber-800 block mb-1 text-[11px]">
                    🇨🇳 中文剧情译文:
                  </span>
                  <p>{generatedStory.storyCn}</p>
                </div>

                {/* Actions: Save to Reader or Regenerate */}
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleSaveStoryToReader}
                    disabled={isSavedToReader}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 transition-all ${
                      isSavedToReader
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-white hover:bg-amber-100 text-slate-700 border border-slate-200'
                    }`}
                  >
                    <BookPlus className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{isSavedToReader ? '已存入精读伴读库 ✅' : '存入精读伴读'}</span>
                  </button>

                  <button
                    onClick={handleGenerateStory}
                    disabled={isGeneratingStory}
                    className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>换个题材重写</span>
                  </button>
                </div>
              </div>
            )}
      </Modal>

      {/* Edit Word & Note Modal — migrated to Modal: it previously had no height cap, so the
          on-screen keyboard could push “保存修改” out of reach (V-20).
          NOTE: the whole modal is rendered conditionally. React evaluates JSX children before
          the component runs, so a closed `<Modal open={false}>` would still evaluate
          `editingWord.word` and crash the page. */}
      {editingWord && (
      <Modal
        open
        onClose={() => setEditingWord(null)}
        ariaLabel="编辑词条与助记笔记"
        size="md"
        showCloseButton={false}
        bodyClassName="space-y-3.5 p-5"
      >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-sky-600" />
                <h3 className="font-bold text-slate-900 text-sm">
                  编辑词条与助记笔记
                </h3>
              </div>
              <button
                aria-label="关闭词条编辑"
                onClick={() => setEditingWord(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="block text-xs font-semibold text-slate-700 mb-1">
                  目标生词 (只读)
                </p>
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="font-bold font-serif text-slate-900 text-sm">
                    {editingWord.word}
                  </span>
                  {editingWord.phonetic && (
                    <span className="text-xs text-sky-700 font-mono">
                      {editingWord.phonetic}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label="朗读编辑中的单词"
                    onClick={() => tts.speak(editingWord.word)}
                    className="p-1 text-sky-600 hover:bg-sky-100 rounded-full ml-auto"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="vocab-edit-meaning" className="block text-xs font-semibold text-slate-700 mb-1">
                  中文释义
                </label>
                <input
                  id="vocab-edit-meaning"
                  type="text"
                  value={editTranslation}
                  onChange={(e) => setEditTranslation(e.target.value)}
                  placeholder="中文意思..."
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label htmlFor="vocab-edit-context" className="block text-xs font-semibold text-slate-700 mb-1">
                  语境例句
                </label>
                <textarea
                  id="vocab-edit-context"
                  rows={2}
                  value={editContextSentence}
                  onChange={(e) => setEditContextSentence(e.target.value)}
                  placeholder="英文例句..."
                  className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden resize-none"
                />
              </div>

              <div>
                <label htmlFor="vocab-edit-note" className="block text-xs font-semibold text-amber-800 mb-1 flex items-center gap-1">
                  <StickyNote className="w-3.5 h-3.5 text-amber-600" />
                  <span>我的助记笔记</span>
                </label>
                <textarea
                  id="vocab-edit-note"
                  rows={2}
                  value={editUserNote}
                  onChange={(e) => setEditUserNote(e.target.value)}
                  placeholder="例如：谐音记忆、词根拆解、特定场景联想..."
                  className="w-full text-xs p-3 bg-amber-50/50 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-hidden resize-none text-amber-950 placeholder-amber-700/50"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setEditingWord(null)}
                className="flex-1 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                className="flex-1 py-2 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all active:scale-95"
              >
                保存修改
              </button>
            </div>
      </Modal>
      )}

      {/* Manual Add Word Modal */}
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="添加生词到生词本"
        size="md"
        showCloseButton={false}
        bodyClassName="p-5 pt-3"
      >
            <div className="space-y-3">
              <div>
                <label htmlFor="vocab-add-word" className="block text-xs font-medium text-slate-700 mb-1">
                  英文单词或短语 *
                </label>
                <input
                  id="vocab-add-word"
                  type="text"
                  value={inputWord}
                  onChange={(e) => setInputWord(e.target.value)}
                  placeholder="例如: ubiquitous 或 figure out"
                  className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label htmlFor="vocab-add-context" className="block text-xs font-medium text-slate-700 mb-1">
                  原句或语境（可选）
                </label>
                <textarea
                  id="vocab-add-context"
                  rows={3}
                  value={inputContext}
                  onChange={(e) => setInputContext(e.target.value)}
                  placeholder="遇到这个词的整句话..."
                  className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden resize-none"
                />
              </div>
            </div>

            <div className="flex space-x-2 pt-4">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAddWord}
                disabled={isAddingWord || !inputWord.trim()}
                className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1"
              >
                {isAddingWord ? '查词中...' : '查词并添加'}
              </button>
            </div>
      </Modal>

      {/* Today's Study Stats Detail Modal */}
      <Modal
        open={showStatsDetail}
        onClose={() => setShowStatsDetail(false)}
        ariaLabel="今日学习统计"
        size="sm"
        showCloseButton={false}
        bodyClassName="space-y-3.5 p-5"
      >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔥</span>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">今日学习与打卡明细</h3>
                </div>
              </div>
              <button
                aria-label="关闭今日学习统计"
                onClick={() => setShowStatsDetail(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/70 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-600">连续坚持天数:</span>
                <strong className="text-amber-600 font-mono text-sm font-bold">
                  {studyStats.streakDays || 0} 天
                </strong>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">今日复习生词:</span>
                <strong className="text-sky-700 font-mono">
                  {studyStats.todayReviewedCount || 0} 词
                </strong>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">今日口语对练:</span>
                <strong className="text-indigo-700 font-mono">
                  {studyStats.todayOralCount || 0} 轮
                </strong>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">今日精读批注:</span>
                <strong className="text-teal-700 font-mono">
                  {studyStats.todayAnnotationCount || 0} 处
                </strong>
              </div>
              <div className="flex justify-between items-center pt-1.5 border-t border-slate-200/60">
                <span className="text-slate-500 font-medium">今日总学习动作:</span>
                <strong className="text-slate-900 font-bold font-mono">
                  {studyStats.todayTotalActions || 0} 次
                </strong>
              </div>
            </div>

            <details className="text-xs text-slate-500"><summary className="cursor-pointer">打卡帮助</summary><p className="mt-2 leading-6">完成对话、批注或词卡复习等有效学习会记录当日活动；仅打开页面不会计入。</p></details>

            <button
              onClick={() => setShowStatsDetail(false)}
              className="w-full py-2 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-xl shadow-xs transition-all active:scale-95"
            >
              继续学习
            </button>
      </Modal>
    </div>
  );
}
