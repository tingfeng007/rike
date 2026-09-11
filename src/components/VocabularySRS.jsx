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
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { StorageService } from '../services/storage';
import { analyzeWordWithAI, generateVocabularyQuiz } from '../services/ai';
import { tts } from '../services/speech';

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

  // Reload vocabulary from storage
  const reloadVocabulary = (forcePractice = false) => {
    const words = StorageService.getVocabulary();
    setVocabulary(words);
    setStudyStats(StorageService.getStudyStats());

    // Calculate due cards (nextReviewDate <= now + 1 hour)
    const now = Date.now();
    const due = words.filter((w) => !w.nextReviewDate || w.nextReviewDate <= now + 60 * 60 * 1000);
    
    if (forcePractice) {
      // User explicitly requested extra practice session
      const sampleSet = words.slice(0, Math.min(10, words.length));
      setDueCards(sampleSet);
      setCurrentIndex(0);
      setIsFlipped(false);
      setReviewCompleted(false);
    } else if (due.length > 0) {
      setDueCards(due);
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
    const updatedStats = StorageService.recordReviewActivity(1);
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
  const filteredWords = vocabulary.filter((item) => {
    const matchesQuery =
      item.word.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.translation && item.translation.includes(searchQuery));
    if (!matchesQuery) return false;
    if (filterStatus === 'all') return true;
    return item.status === filterStatus;
  });

  const currentCard = dueCards[currentIndex];

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Top Header */}
      <header 
        className="flex-none bg-white border-b border-slate-200 px-4 py-2.5 shadow-xs"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 10px)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-sky-600" />
            <h2 className="font-semibold text-slate-850 text-sm">
              艾宾浩斯生词本
            </h2>
            <span className="text-xs bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full font-medium">
              共 {vocabulary.length} 词
            </span>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1 bg-sky-600 hover:bg-sky-700 text-white px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>添加生词</span>
          </button>
        </div>

        {/* Study Habit Stats Bar */}
        <div className="flex items-center justify-between bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-1.5 mb-2 text-xs">
          <div className="flex items-center gap-1 text-amber-700 font-semibold">
            <Flame className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            <span>连续 {studyStats.streakDays || 1} 天打卡</span>
          </div>
          <div className="flex items-center gap-1 text-slate-600">
            <Target className="w-3.5 h-3.5 text-sky-600" />
            <span>今日已复习 <strong className="text-sky-700">{studyStats.todayReviewedCount || 0}</strong> 词</span>
          </div>
          <div className="text-emerald-700 font-medium">
            <span>牢记 {vocabulary.filter((w) => w.status === 'mastered').length} 词</span>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-medium">
          <button
            onClick={() => {
              setActiveTab('flashcard');
              reloadVocabulary();
            }}
            className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'flashcard'
                ? 'bg-white text-sky-700 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>闪卡复习</span>
          </button>
          <button
            onClick={() => setActiveTab('list')}
            className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'list'
                ? 'bg-white text-sky-700 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ListFilter className="w-3.5 h-3.5" />
            <span>生词库清单</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('quiz');
              if (quizQuestions.length === 0) handleGenerateQuiz();
            }}
            className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'quiz'
                ? 'bg-white text-sky-700 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>AI 巩固测验</span>
          </button>
        </div>
      </header>

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
                <div className="w-full h-1.5 bg-slate-200 rounded-full mb-4 overflow-hidden">
                  <div
                    className="h-full bg-sky-600 transition-all duration-300"
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
                    <div className="absolute inset-0 backface-hidden bg-white border border-slate-200/90 rounded-3xl p-6 flex flex-col justify-between shadow-md hover:shadow-lg transition-shadow">
                      <div className="flex justify-between items-start">
                        <span className="text-[11px] font-semibold px-2 py-0.5 bg-sky-50 text-sky-700 rounded-md">
                          {currentCard.tags?.[0] || '生词闪卡'}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            tts.speak(currentCard.word);
                          }}
                          className="p-2 text-sky-600 hover:bg-sky-50 rounded-full transition-colors"
                          title="发音朗读"
                        >
                          <Volume2 className="w-5 h-5" />
                        </button>
                      </div>

                      {/* Main Word & Phonetic */}
                      <div className="text-center py-6">
                        <h2 className="text-3xl font-bold text-slate-900 tracking-tight">
                          {currentCard.word}
                        </h2>
                        {currentCard.phonetic && (
                          <p className="text-sm text-slate-600 font-mono mt-1">
                            {currentCard.phonetic}
                          </p>
                        )}
                      </div>

                      {/* Context Sentence (Crucial for Retention!) */}
                      {currentCard.contextSentence ? (
                        <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 text-xs text-slate-700 leading-relaxed text-center">
                          <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-semibold mb-1">
                            语境例句
                          </span>
                          "{currentCard.contextSentence}"
                        </div>
                      ) : (
                        <div className="h-10"></div>
                      )}

                      <div className="text-center text-xs text-slate-600 flex items-center justify-center gap-1">
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>点击卡片任意位置查看释义与剖析</span>
                      </div>
                    </div>

                    {/* --- BACK SIDE --- */}
                    <div className="absolute inset-0 backface-hidden rotate-y-180 bg-white border border-sky-200 rounded-3xl p-6 flex flex-col justify-between shadow-md overflow-y-auto">
                      <div>
                        <div className="flex justify-between items-start pb-3 border-b border-slate-100">
                          <div>
                            <span className="text-xs font-semibold px-2 py-0.5 bg-sky-100 text-sky-800 rounded-md mr-2">
                              {currentCard.pos || '释义'}
                            </span>
                            <span className="text-lg font-bold text-slate-900">
                              {currentCard.word}
                            </span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              tts.speak(currentCard.word);
                            }}
                            className="p-1.5 text-sky-600 hover:bg-sky-50 rounded-full"
                          >
                            <Volume2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Translation */}
                        <div className="mt-3">
                          <p className="text-base font-semibold text-slate-850">
                            {currentCard.translation || '暂无详细中文释义'}
                          </p>
                          {currentCard.definitionEn && (
                            <p className="text-xs text-slate-600 mt-1 italic leading-relaxed">
                              {currentCard.definitionEn}
                            </p>
                          )}
                        </div>

                        {/* Context Sentence Breakdown */}
                        {currentCard.contextSentence && (
                          <div className="mt-3.5 bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs space-y-1">
                            <p className="text-slate-800 font-medium">
                              "{currentCard.contextSentence}"
                            </p>
                            {currentCard.contextSentenceCn && (
                              <p className="text-slate-600 pt-1 border-t border-slate-200/60">
                                {currentCard.contextSentenceCn}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="pt-2 text-center text-[11px] text-slate-600">
                        当前复习次数: {currentCard.reviewCount || 0} 次 · 记忆权重: {currentCard.intervalDays || 1} 天
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
                      className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
                    >
                      随便翻翻（自主温故 10 词）
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
            {/* Search and Status Filter */}
            <div className="flex gap-2">
              <div className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-1.5 flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索生词或中文释义..."
                  className="w-full text-xs text-slate-800 placeholder-slate-600 outline-hidden bg-transparent"
                />
              </div>

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-white border border-slate-200 text-xs rounded-xl px-2.5 py-1.5 text-slate-700 outline-hidden"
              >
                <option value="all">全部生词 ({vocabulary.length})</option>
                <option value="learning">学习中</option>
                <option value="review">复习巩固中</option>
                <option value="mastered">已牢记掌握</option>
              </select>
            </div>

            {/* Words list */}
            {filteredWords.length > 0 ? (
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
                    </div>

                    <button
                      onClick={(e) => handleDeleteWord(item.id, e)}
                      className="p-1.5 text-slate-500 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                      title="删除该词"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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

      {/* Manual Add Word Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl p-5 shadow-xl border border-slate-200">
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
    </div>
  );
}
