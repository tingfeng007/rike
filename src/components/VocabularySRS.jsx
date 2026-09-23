import React, { useState, useEffect } from 'react';
import {
  Layers,
  ListFilter,
  Volume2,
  Plus,
  Trash2,
  Search,
  RotateCw,
  Sparkles,
  Trophy,
  Clock,
  CheckCircle,
  AlertTriangle,
  Flame,
  Target,
  Film,
  Headphones,
  BookPlus,
  X,
  Edit3,
  StickyNote,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { StorageService } from '../services/storage';
import {
  analyzeWordWithAI,
  generateVocabularyQuiz,
  generateVocabStoryWithAI,
} from '../services/ai';
import { tts } from '../services/speech';
import StudyHeader from './StudyHeader';
import { filterVocabulary } from '../services/studyView';

// Fisher-Yates random shuffle utility
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function VocabularySRS() {
  const [activeTab, setActiveTab] = useState('flashcard'); // 'flashcard' | 'list' | 'quiz'
  const [vocabulary, setVocabulary] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'learning' | 'review' | 'mastered'
  const [searchQuery, setSearchQuery] = useState('');

  // Flashcard states
  const [dueCards, setDueCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewCompleted, setReviewCompleted] = useState(false);
  const [studyStats, setStudyStats] = useState(() => StorageService.getStudyStats());

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
    StorageService.updateWord(editingWord.id, {
      translation: editTranslation.trim(),
      contextSentence: editContextSentence.trim(),
      userNote: editUserNote.trim(),
    });
    setEditingWord(null);
    reloadVocabulary();
  };

  // Reload vocabulary from storage with randomized shuffling
  const reloadVocabulary = (forcePractice = false) => {
    const words = StorageService.getVocabulary();
    setVocabulary(words);
    setStudyStats(StorageService.getStudyStats());

    // Calculate due cards (nextReviewDate <= now + 1 hour)
    const now = Date.now();
    const due = words.filter((w) => !w.nextReviewDate || w.nextReviewDate <= now + 60 * 60 * 1000);
    
    if (forcePractice) {
      // Randomly sample 8 words from entire deck
      const randomBatch = shuffleArray(words).slice(0, Math.min(8, words.length));
      setDueCards(randomBatch);
      setCurrentIndex(0);
      setIsFlipped(false);
      setReviewCompleted(false);
    } else if (due.length > 0) {
      // Shuffle due cards to eliminate predictable position memory
      setDueCards(shuffleArray(due));
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

  useEffect(() => {
    reloadVocabulary();
  }, []);

  // Flashcard Rating: 'again' | 'hard' | 'good'
  const handleRateCard = (quality) => {
    if (dueCards.length === 0) return;

    const currentCard = dueCards[currentIndex];
    StorageService.updateWordSRS(currentCard.id, quality);
    const updatedStats = StorageService.recordReviewActivity(1, { entityId: currentCard.id, durationMinutes: 1 });
    setStudyStats(updatedStats);

    setIsFlipped(false);

    if (currentIndex + 1 < dueCards.length) {
      setTimeout(() => {
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
      // Refresh local list
      const words = StorageService.getVocabulary();
      setVocabulary(words);
    }
  };

  // Add new word manually with AI enhancement
  const handleAddWord = async () => {
    const word = inputWord.trim();
    if (!word) return;

    setIsAddingWord(true);
    try {
      let analysis = null;
      try {
        analysis = await analyzeWordWithAI(word, inputContext);
      } catch {
        // Fallback if no API key
        analysis = {
          word,
          phonetic: '',
          pos: 'word',
          translation: '自主添加生词',
          definitionEn: '',
          contextSentence: inputContext,
        };
      }

      StorageService.addWord({
        word,
        phonetic: analysis?.phonetic || '',
        pos: analysis?.pos || '',
        translation: analysis?.translation || '',
        definitionEn: analysis?.definitionEn || '',
        contextSentence: inputContext || analysis?.contextSentence || '',
        contextSentenceCn: analysis?.contextSentenceCn || '',
        tags: ['手动输入'],
      });

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
    if (confirm('确认将此单词从生词本中删除？')) {
      const updated = StorageService.deleteWord(id);
      setVocabulary(updated);
      reloadVocabulary();
    }
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
      alert('请至少勾选 1 个生词融入故事');
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
      alert(`微剧场生成失败: ${err.message}`);
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
    StorageService.saveArticle({
      title: `${generatedStory.title} (${generatedStory.titleCn || '微剧场'})`,
      level: 'AI 生词微剧场',
      content: plainContent,
      tags: ['生词微剧场', storyGenre],
    });
    setIsSavedToReader(true);
  };

  // Start AI Quiz
  const handleGenerateQuiz = async () => {
    if (vocabulary.length < 2) {
      alert('生词本中至少需要有 2 个词才能生成测验，先去阅读或对话中收集几个词吧！');
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
      alert(`生成测验失败: ${err.message}`);
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
      setStudyStats(updatedStats);

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
  const masteredCount = vocabulary.filter((word) => word.status === 'mastered').length;
  const missingMeaningCount = vocabulary.filter((word) => !word.translation?.trim()).length;

  return (
    <div className="study-page flex flex-col h-full">
      <StudyHeader
        eyebrow="REMEMBER · RECALL · USE"
        title="记忆词库"
        description={dueCards.length ? `今天先复习 ${dueCards.length} 个到期词，再用测验或口语把它们真正激活。` : '今天没有到期词，可以补释义、做测验或随机强化。'}
        icon={<Layers className="w-4 h-4" />}
        status={`${vocabulary.length} 词 · ${dueCards.length} 到期`}
        actions={(
          <>
            <button
              type="button"
              onClick={handleOpenStoryStudio}
              className="tap-lift flex items-center gap-1 rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-[11px] font-semibold text-amber-200"
              title="一键把难记生词写成悬疑微小说与有声广播剧"
            >
              <Film className="w-3.5 h-3.5" />
              <span>微剧场</span>
            </button>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="tap-lift flex items-center gap-1 rounded-xl bg-amber-400 px-2.5 py-2 text-[11px] font-bold text-[#102a43]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加</span>
            </button>
          </>
        )}
      >
        <div className="grid grid-cols-3 gap-1.5 text-center text-[10px]">
          <button
            type="button"
            onClick={() => setShowStatsDetail(true)}
            className="tap-lift rounded-xl bg-white/8 px-2 py-2 text-slate-200 ring-1 ring-white/10"
            title="点击查看今日打卡明细与动作"
          >
            <Flame className="mx-auto mb-1 h-3.5 w-3.5 text-amber-300" />
            <strong className="block text-sm text-white">{studyStats.streakDays || 0} 天</strong>连续学习
          </button>
          <div className="rounded-xl bg-white/8 px-2 py-2 text-slate-200 ring-1 ring-white/10"><Target className="mx-auto mb-1 h-3.5 w-3.5 text-sky-300" /><strong className="block text-sm text-white">{studyStats.todayReviewedCount || 0} 词</strong>今日复习</div>
          <button
            type="button"
            onClick={() => {
              setFilterStatus('mastered');
              setActiveTab('list');
            }}
            className="tap-lift rounded-xl bg-white/8 px-2 py-2 text-slate-200 ring-1 ring-white/10"
            title="点击查看所有已牢记掌握的生词名册"
          >
            <Trophy className="mx-auto mb-1 h-3.5 w-3.5 text-emerald-300" /><strong className="block text-sm text-white">{masteredCount} 词</strong>已牢记
          </button>
        </div>

        <div className="mt-2 flex rounded-xl bg-black/10 p-1 text-[11px] font-medium ring-1 ring-white/10">
          <button
            type="button"
            onClick={() => {
              setActiveTab('flashcard');
              reloadVocabulary();
            }}
            className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'flashcard'
                ? 'bg-white text-[#102a43] shadow-xs font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>闪卡复习</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('list')}
            className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'list'
                ? 'bg-white text-[#102a43] shadow-xs font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <ListFilter className="w-3.5 h-3.5" />
            <span>生词库清单</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('quiz');
              if (quizQuestions.length === 0) handleGenerateQuiz();
            }}
            className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'quiz'
                ? 'bg-white text-[#102a43] shadow-xs font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>AI 巩固测验</span>
          </button>
        </div>
      </StudyHeader>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-4 pb-20">
        {/* ================= TAB 1: FLASHCARD SRS ================= */}
        {activeTab === 'flashcard' && (
          <div className="max-w-md mx-auto h-full flex flex-col justify-between py-2">
            {!reviewCompleted && currentCard ? (
              <>
                {/* Progress Bar & Counter */}
                <div className="flex items-center justify-between text-xs text-slate-600 mb-3 px-1">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-600" />
                    <span>今日复习进度</span>
                  </div>
                  <span className="font-mono font-semibold text-slate-700">
                    {currentIndex + 1} / {dueCards.length}
                  </span>
                </div>

                {/* Progress Track */}
                <div className="w-full h-1.5 bg-slate-200/80 rounded-full mb-4 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-blue-600 transition-all duration-300"
                    style={{
                      width: `${((currentIndex + 1) / dueCards.length) * 100}%`,
                    }}
                  />
                </div>

                {/* 3D Flip Card Container */}
                <div
                  onClick={() => setIsFlipped(!isFlipped)}
                  className="w-full flex-1 min-h-[360px] cursor-pointer perspective-1000 relative select-none"
                >
                  <div
                    className={`w-full h-full duration-500 transform-style-preserve-3d relative transition-transform rounded-3xl ${
                      isFlipped ? 'rotate-y-180' : ''
                    }`}
                  >
                    {/* --- FRONT SIDE --- */}
                    <div className="absolute inset-0 backface-hidden bg-white/95 border border-white/90 rounded-3xl p-6 flex flex-col justify-between shadow-[0_8px_30px_-4px_rgba(15,23,42,0.08)] hover:shadow-xl transition-all">
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
                        >
                          <Volume2 className="w-5 h-5" />
                        </button>
                      </div>

                      {/* Main Word & Phonetic */}
                      <div className="text-center py-6">
                        <h2 className="text-3xl md:text-4xl font-bold font-serif text-slate-900 tracking-tight">
                          {currentCard.word}
                        </h2>
                        {currentCard.phonetic && (
                          <p className="text-sm text-sky-700 font-mono mt-1.5 font-medium">
                            {currentCard.phonetic}
                          </p>
                        )}
                      </div>

                      {/* Context Sentence (Crucial for Retention!) */}
                      {currentCard.contextSentence ? (
                        <div className="bg-slate-50/90 p-3.5 rounded-2xl border border-slate-200/60 text-xs text-slate-700 leading-relaxed text-center shadow-2xs font-serif">
                          <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-sans font-bold mb-1">
                            语境例句
                          </span>
                          "{currentCard.contextSentence}"
                        </div>
                      ) : (
                        <div className="h-10"></div>
                      )}

                      <div className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1">
                        <RotateCw className="w-3 h-3" />
                        <span>轻触卡片翻转查看释义</span>
                      </div>
                    </div>

                    {/* --- BACK SIDE --- */}
                    <div className="absolute inset-0 backface-hidden rotate-y-180 bg-white/95 border border-amber-200/80 rounded-3xl p-6 flex flex-col justify-between shadow-[0_8px_30px_-4px_rgba(15,23,42,0.08)] overflow-y-auto">
                      <div>
                        <div className="flex justify-between items-start pb-3 border-b border-slate-100">
                          <div>
                            <span className="text-xs font-semibold px-2 py-0.5 bg-sky-100/80 text-sky-800 rounded-md mr-2">
                              {currentCard.pos || '释义'}
                            </span>
                            <span className="text-xl font-bold font-serif text-slate-900">
                              {currentCard.word}
                            </span>
                          </div>
                          <button
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
                              <span>我的专属助记笔记:</span>
                            </span>
                            <p>{currentCard.userNote}</p>
                          </div>
                        )}
                      </div>

                      <div className="pt-2 text-center text-[10.5px] text-slate-400 font-medium">
                        已复习: {currentCard.reviewCount || 0} 次 · 遗忘难度系数: {currentCard.easeFactor || 2.5} · 下次间隔: {currentCard.intervalDays || 1} 天
                      </div>
                    </div>
                  </div>
                </div>

                {/* SRS Evaluation Buttons */}
                <div className="mt-5 grid grid-cols-3 gap-2.5">
                  <button
                    onClick={() => handleRateCard('again')}
                    className="flex flex-col items-center py-2.5 px-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-2xl transition-all active:scale-95"
                  >
                    <span className="text-sm font-semibold">❌ 遗忘</span>
                    <span className="text-[10px] text-rose-600 mt-0.5">重头复习</span>
                  </button>

                  <button
                    onClick={() => handleRateCard('hard')}
                    className="flex flex-col items-center py-2.5 px-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-2xl transition-all active:scale-95"
                  >
                    <span className="text-sm font-semibold">🤔 模糊</span>
                    <span className="text-[10px] text-amber-700 mt-0.5">+1~2 天</span>
                  </button>

                  <button
                    onClick={() => handleRateCard('good')}
                    className="flex flex-col items-center py-2.5 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-2xl transition-all active:scale-95"
                  >
                    <span className="text-sm font-semibold">✅ 掌握</span>
                    <span className="text-[10px] text-emerald-700 mt-0.5">延长间隔</span>
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
                  {vocabulary.length === 0
                    ? '生词库暂无单词'
                    : '太棒了！今日闪卡已全部搞定'}
                </h3>
                <p className="text-xs text-slate-600 max-w-xs mt-2 leading-relaxed">
                  {vocabulary.length === 0
                    ? '去“精读伴读”或“口语对练”中收藏几个新词，开启你的艾宾浩斯记忆旅程吧！'
                    : '艾宾浩斯智能算法显示：当前所有生词均在记忆稳定期，今天无待复习单词。保持这个节奏，下一次复习将在明天到来！'}
                </p>

                <div className="mt-6 flex flex-col w-full max-w-xs space-y-2">
                  {vocabulary.length > 0 && (
                    <button
                      onClick={() => reloadVocabulary(true)}
                      className="w-full py-2.5 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>🎲 随便翻翻（随机抽选 8 词强化）</span>
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
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索生词、中文释义或专属笔记..."
                className="w-full text-xs text-slate-800 placeholder-slate-400 outline-hidden bg-transparent"
              />
              {searchQuery && (
                <button
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
                <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                  科学记忆机制：当一个生词在闪卡复习中连续选择【✅ 掌握】达到 3~5 次以上，系统就会自动将其晋升为“👑 已牢记掌握”！
                </p>
                <div className="pt-1">
                  <button
                    onClick={() => {
                      setActiveTab('flashcard');
                      reloadVocabulary(true);
                    }}
                    className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all active:scale-95"
                  >
                    去闪卡挑战温故
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

                      <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-600">
                        <span className="bg-slate-100 px-1.5 py-0.5 rounded">
                          {item.tags?.[0] || '生词'}
                        </span>
                        <span>复习次数: {item.reviewCount || 0}</span>
                        <span>
                          {item.status === 'mastered'
                            ? '🌟 已掌握'
                            : `间隔: ${item.intervalDays || 1} 天`}
                        </span>
                      </div>
                      {Array.isArray(item.sources) && item.sources.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.sources.slice(0, 3).map((source) => (
                            <span key={source.key || `${source.type}:${source.id}`} className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
                              来源 · {source.label || source.id}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1 flex-none">
                      <button
                        onClick={(e) => handleOpenEdit(item, e)}
                        className="p-1.5 text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
                        title="编辑生词与个人笔记"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleDeleteWord(item.id, e)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                        title="删除该词"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
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
                  AI 语境实战小测验
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  基于你生词本里的单词生成地道填空考题
                </p>
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
                <span>AI 正在为你量身定制例句填空测验...</span>
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
                          第 {qIdx + 1} 题 · 考察词: {q.targetWord}
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
                        {q.options.map((opt, optIdx) => {
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
                              key={optIdx}
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
                            {quizScore.correct === quizScore.total ? '🎉 满分通关！太厉害了' : '🎯 测验完成，巩固进步！'}
                          </h4>
                          <p className="text-xs text-slate-600">
                            得分：{quizScore.correct} / {quizScore.total} 题（正确率 {quizScore.percent}%）
                          </p>
                        </div>
                      </div>
                    </div>

                    {quizScore.wrongs.length > 0 ? (
                      <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1">
                        <div className="flex items-center gap-1 font-semibold text-rose-900">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                          <span>错题反哺已生效：</span>
                        </div>
                        <p className="leading-relaxed text-[11px]">
                          薄弱词汇 <span className="font-bold font-mono">[{quizScore.wrongs.join(', ')}]</span> 已自动重置加入今日待复习闪卡队伍，记得稍后强化温习！
                        </p>
                      </div>
                    ) : (
                      <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-1.5 font-medium">
                        <CheckCircle className="w-4 h-4 text-emerald-600 flex-none" />
                        <span>所有考题全部正确，所考察生词记忆非常牢固！</span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() => {
                          setActiveTab('flashcard');
                          reloadVocabulary();
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
      {showStoryModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-3xl p-5 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Film className="w-5 h-5 text-amber-500" />
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    生词微剧场 · AI 专属小说
                  </h3>
                  <p className="text-xs text-slate-500">
                    把背不会的单词编进高潮迭起的故事中，听广播剧沉浸式记忆
                  </p>
                </div>
              </div>
              <button
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
              <label className="block text-xs font-bold text-slate-700 mb-2">
                第一步：选择剧场风格
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'mystery', icon: '🕵️‍♂️', label: '悬疑推理', desc: '深夜密室、暗藏线索' },
                  { id: 'workplace', icon: '💼', label: '硅谷职场', desc: '商战博弈、产品发布' },
                  { id: 'romance', icon: '☕', label: '都市温情', desc: '街角咖啡、治愈遇见' },
                  { id: 'cyberpunk', icon: '🚀', label: '未来科幻', desc: '霓虹夜市、AI觉醒' },
                ].map((g) => (
                  <div
                    key={g.id}
                    onClick={() => setStoryGenre(g.id)}
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                      storyGenre === g.id
                        ? 'bg-amber-50 border-amber-400 text-amber-900 font-semibold shadow-xs ring-1 ring-amber-300'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <span>{g.icon}</span>
                      <span>{g.label}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">{g.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Words To Include */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                第二步：选择要融入剧场的生词 (点击切换)
              </label>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1">
                {vocabulary.slice(0, 10).map((w) => {
                  const isChecked = selectedStoryWords.includes(w.word);
                  return (
                    <button
                      key={w.id}
                      type="button"
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
                    <span>AI 编剧正在构思情节与对话...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-200" />
                    <span>🎬 开始生成专属微剧场</span>
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
                  {generatedStory.storyEn.split('\n\n').map((para, idx) => (
                    <p key={idx}>{para}</p>
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
          </div>
        </div>
      )}

      {/* Edit Word & Note Modal */}
      {editingWord && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-md rounded-3xl p-5 shadow-2xl border border-slate-100 space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-sky-600" />
                <h3 className="font-bold text-slate-900 text-sm">
                  编辑词条与专属助记笔记
                </h3>
              </div>
              <button
                onClick={() => setEditingWord(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  目标生词 (只读)
                </label>
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
                    onClick={() => tts.speak(editingWord.word)}
                    className="p-1 text-sky-600 hover:bg-sky-100 rounded-full ml-auto"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  中文释义
                </label>
                <input
                  type="text"
                  value={editTranslation}
                  onChange={(e) => setEditTranslation(e.target.value)}
                  placeholder="中文意思..."
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  语境例句
                </label>
                <textarea
                  rows={2}
                  value={editContextSentence}
                  onChange={(e) => setEditContextSentence(e.target.value)}
                  placeholder="英文例句..."
                  className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-amber-800 mb-1 flex items-center gap-1">
                  <StickyNote className="w-3.5 h-3.5 text-amber-600" />
                  <span>我的专属助记口诀 / 记忆心得 (卡片翻面立现)</span>
                </label>
                <textarea
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
          </div>
        </div>
      )}

      {/* Manual Add Word Modal */}
      {showAddModal && (
        <div onClick={() => setShowAddModal(false)} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer">
          <div onClick={(e) => e.stopPropagation()} className="bg-white cursor-default w-full max-w-md rounded-2xl p-5 shadow-xl border border-slate-200">
            <h3 className="font-bold text-slate-850 text-base mb-3">
              添加生词到生词本
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  英文单词或短语 *
                </label>
                <input
                  type="text"
                  value={inputWord}
                  onChange={(e) => setInputWord(e.target.value)}
                  placeholder="例如: ubiquitous 或 figure out"
                  className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  原句或语境 (可选，AI将依此解析最准释义)
                </label>
                <textarea
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
                {isAddingWord ? 'AI 分析中...' : '智能添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Today's Study Stats Detail Modal */}
      {showStatsDetail && (
        <div onClick={() => setShowStatsDetail(false)} className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in cursor-pointer">
          <div onClick={(e) => e.stopPropagation()} className="bg-white cursor-default w-full max-w-sm rounded-3xl p-5 shadow-2xl border border-slate-100 space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔥</span>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">今日学习与打卡明细</h3>
                  <p className="text-[10.5px] text-slate-500">
                    {studyStats.todayTotalActions > 0
                      ? '✨ 今日学习指标已点亮！连续打卡中'
                      : '🎯 今日尚未打卡，完成任一学习即可点亮'}
                  </p>
                </div>
              </div>
              <button
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

            <p className="text-[11px] text-slate-500 bg-amber-50/70 p-2.5 rounded-xl border border-amber-200/50 leading-relaxed">
              💡 <strong>真实可信打卡规则</strong>：无论是跟外教聊 1 句英语、在文章中划 1 个金句批注、还是复习 1 个生词，都会自动算作今日有效学习并保持连击！
            </p>

            <button
              onClick={() => setShowStatsDetail(false)}
              className="w-full py-2 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-xl shadow-xs transition-all active:scale-95"
            >
              我知道了，继续学习
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
