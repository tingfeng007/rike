import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  BookOpen,
  Plus,
  Trash2,
  Volume2,
  Sparkles,
  BookmarkPlus,
  CheckCircle2,
  X,
  Languages,
  Globe,
  Dices,
  Highlighter,
  NotebookPen,
  Download,
  RotateCcw,
  Play,
  Pause,
  Square,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { StorageService } from '../services/storage';
import {
  analyzeWordWithAI,
  analyzeSentenceWithAI,
  translateParagraphWithAI,
  generateDailyArticleWithAI,
} from '../services/ai';
import { tts } from '../services/speech';
import StudyHeader from './StudyHeader';
import { getReadingMetrics } from '../services/studyView';

// Robust sentence splitter with abbreviation protection & Intl fallback
function splitIntoSentences(text) {
  if (!text) return [];

  // Try modern Intl.Segmenter if supported
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
      const segments = Array.from(segmenter.segment(text))
        .map((s) => s.segment.trim())
        .filter(Boolean);
      if (segments.length > 0) {
        return segments;
      }
    } catch {
      // fallback below
    }
  }

  // Fallback: Protect common abbreviations
  const abbreviations = [
    'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'U.S.', 'U.K.',
    'e.g.', 'i.e.', 'vs.', 'etc.', 'a.m.', 'p.m.',
    'Jan.', 'Feb.', 'Mar.', 'Apr.', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'
  ];
  let masked = text;
  abbreviations.forEach((abbr, idx) => {
    const regex = new RegExp(`\\b${abbr.replace('.', '\\.')}`, 'gi');
    masked = masked.replace(regex, `__ABBR_${idx}__`);
  });

  const rawSentences = masked.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [masked];

  return rawSentences
    .map((s) => {
      let restored = s.trim();
      abbreviations.forEach((abbr, idx) => {
        restored = restored.replaceAll(`__ABBR_${idx}__`, abbr);
      });
      return restored;
    })
    .filter(Boolean);
}

function pickRandomOtherArticle(articles, currentId) {
  const candidates = articles.filter((article) => article.id !== currentId);
  return candidates[Math.floor(Math.random() * candidates.length)] || null;
}

export default function SmartReader() {
  const [articles, setArticles] = useState(() => StorageService.getArticles());
  const [currentArticle, setCurrentArticle] = useState(() => {
    const list = StorageService.getArticles();
    const savedId = StorageService.getAppState().lastReaderArticleId;
    return list.find((article) => article.id === savedId) || list[0] || null;
  });
  const [fontSize, setFontSize] = useState('text-base'); // 'text-sm' | 'text-base' | 'text-lg'
  const [readingProgress, setReadingProgress] = useState(0);

  // Modal / Drawer states
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newLevel, setNewLevel] = useState('中级 (Intermediate)');

  // Selected word modal state
  const [selectedWord, setSelectedWord] = useState(null);
  const [wordAnalysis, setWordAnalysis] = useState(null);
  const [isAnalyzingWord, setIsAnalyzingWord] = useState(false);
  const [isWordSaved, setIsWordSaved] = useState(false);

  // Selected sentence modal state
  const [selectedSentence, setSelectedSentence] = useState(null);
  const [sentenceAnalysis, setSentenceAnalysis] = useState(null);
  const [isAnalyzingSentence, setIsAnalyzingSentence] = useState(false);

  // Paragraph translation state: { [artId_paraIdx]: { text: string, visible: boolean } }
  const [paragraphTranslations, setParagraphTranslations] = useState({});
  const [translatingParaIndex, setTranslatingParaIndex] = useState(null);

  // URL Import states
  const [importMode, setImportMode] = useState('text'); // 'text' | 'url'
  const [urlInput, setUrlInput] = useState('');
  const [isExtractingUrl, setIsExtractingUrl] = useState(false);

  // Daily Refresh & New Article Generator states
  const [showRefreshModal, setShowRefreshModal] = useState(false);
  const [refreshTopic, setRefreshTopic] = useState('random');
  const [blendUserVocab, setBlendUserVocab] = useState(true);
  const [isGeneratingArticle, setIsGeneratingArticle] = useState(false);

  // Reading highlights & personal notes
  const [annotations, setAnnotations] = useState(() => StorageService.getReadingAnnotations());
  const [editingAnnotation, setEditingAnnotation] = useState(null);
  const [annotationDraft, setAnnotationDraft] = useState('');
  const [showNotesModal, setShowNotesModal] = useState(false);

  // Reading scroll container & position persistence
  const scrollContainerRef = useRef(null);

  // Whole-article speech state. The browser speech engine reads one sentence
  // at a time so pause/resume stays responsive even for long articles.
  const articleSpeechRunRef = useRef(0);
  const [isArticleSpeaking, setIsArticleSpeaking] = useState(false);
  const [isArticlePaused, setIsArticlePaused] = useState(false);
  const [articleSpeechIndex, setArticleSpeechIndex] = useState(0);

  // Map of saved vocabulary for instant in-article highlighting
  const savedVocabMap = {};
  StorageService.getVocabulary().forEach((word) => {
    if (word.word) savedVocabMap[word.word.toLowerCase().trim()] = word;
  });

  // Restore scroll position when article changes
  useEffect(() => {
    if (!currentArticle?.id || !scrollContainerRef.current) return;
    const savedTop = localStorage.getItem(`lingoflow_read_pos_${currentArticle.id}`);
    if (savedTop) {
      setTimeout(() => {
        scrollContainerRef.current?.scrollTo({ top: Number(savedTop), behavior: 'smooth' });
      }, 100);
    }
  }, [currentArticle?.id]);

  const handleScroll = (e) => {
    if (!currentArticle?.id) return;
    const element = e.currentTarget;
    localStorage.setItem(`lingoflow_read_pos_${currentArticle.id}`, element.scrollTop);
    const maxScroll = Math.max(1, element.scrollHeight - element.clientHeight);
    setReadingProgress(Math.min(100, Math.round(element.scrollTop / maxScroll * 100)));
  };

  const selectArticle = (article, { scrollToTop = true } = {}) => {
    if (!article) return;
    setCurrentArticle(article);
    setReadingProgress(0);
    articleSpeechRunRef.current += 1;
    tts.stop();
    setIsArticleSpeaking(false);
    setIsArticlePaused(false);
    setArticleSpeechIndex(0);
    StorageService.saveAppState({ ...StorageService.getAppState(), lastReaderArticleId: article.id });
    if (scrollToTop) scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const currentAnnotations = currentArticle?.id
    ? annotations[String(currentArticle.id)] || []
    : [];

  const articleSpeechSentences = useMemo(() => {
    if (!currentArticle?.content) return [];
    return currentArticle.content
      .split(/\n\n+/)
      .flatMap((paragraph) => splitIntoSentences(paragraph))
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }, [currentArticle]);
  const readingMetrics = useMemo(() => getReadingMetrics(currentArticle?.content), [currentArticle]);
  const currentWordCount = readingMetrics.wordCount;
  const readingMinutes = readingMetrics.minutes;

  const stopArticleSpeech = (resetProgress = true) => {
    articleSpeechRunRef.current += 1;
    tts.stop();
    setIsArticleSpeaking(false);
    setIsArticlePaused(false);
    if (resetProgress) setArticleSpeechIndex(0);
  };

  const startArticleSpeech = async (startIndex = 0) => {
    if (articleSpeechSentences.length === 0) return;
    if (!tts.isSupported()) {
      alert('当前浏览器不支持系统语音朗读，请换用新版 Chrome、Edge 或 Safari。');
      return;
    }

    const runId = articleSpeechRunRef.current + 1;
    articleSpeechRunRef.current = runId;
    setIsArticleSpeaking(true);
    setIsArticlePaused(false);

    for (let index = startIndex; index < articleSpeechSentences.length; index += 1) {
      if (articleSpeechRunRef.current !== runId) return;
      setArticleSpeechIndex(index);
      await tts.speak(articleSpeechSentences[index]);
    }

    if (articleSpeechRunRef.current === runId) {
      setArticleSpeechIndex(articleSpeechSentences.length);
      setIsArticleSpeaking(false);
      setIsArticlePaused(false);
      StorageService.recordStudyActivity({ type: 'reader', count: 1, durationMinutes: readingMinutes, source: 'reader-session', entityId: currentArticle?.id, label: '完成精读朗读' });
    }
  };

  const toggleArticleSpeech = () => {
    if (isArticleSpeaking) {
      if (isArticlePaused) {
        tts.resume();
        setIsArticlePaused(false);
      } else {
        tts.pause();
        setIsArticlePaused(true);
      }
      return;
    }

    const nextIndex = articleSpeechIndex >= articleSpeechSentences.length ? 0 : articleSpeechIndex;
    startArticleSpeech(nextIndex);
  };

  useEffect(() => () => {
    articleSpeechRunRef.current += 1;
    tts.stop();
  }, []);

  const persistAnnotations = (next) => {
    setAnnotations(next);
    localStorage.setItem('lingoflow_reading_annotations', JSON.stringify(next));
  };

  const openAnnotationEditor = (sentence) => {
    const cleanSentence = sentence.trim();
    const existing = currentAnnotations.find((item) => item.sentence === cleanSentence);
    setEditingAnnotation(existing || {
      id: cleanSentence,
      sentence: cleanSentence,
      note: '',
    });
    setAnnotationDraft(existing?.note || '');
  };

  const saveAnnotation = () => {
    if (!currentArticle?.id || !editingAnnotation) return;
    const articleKey = String(currentArticle.id);
    const articleNotes = annotations[articleKey] || [];
    const exists = articleNotes.some((item) => item.id === editingAnnotation.id);
    const savedNote = { ...editingAnnotation, note: annotationDraft.trim() };
    const nextNotes = exists
      ? articleNotes.map((item) => item.id === savedNote.id ? savedNote : item)
      : [...articleNotes, savedNote];
    persistAnnotations({ ...annotations, [articleKey]: nextNotes });
    StorageService.recordStudyActivity({ type: 'annotation', count: 1, durationMinutes: 2, source: 'reader-annotation', entityId: articleKey, label: '收藏精读句子' });
    setEditingAnnotation(null);
    setAnnotationDraft('');
  };

  const removeAnnotation = (annotationId) => {
    if (!currentArticle?.id) return;
    const articleKey = String(currentArticle.id);
    const nextNotes = (annotations[articleKey] || []).filter((item) => item.id !== annotationId);
    const next = { ...annotations, [articleKey]: nextNotes };
    persistAnnotations(next);
    if (editingAnnotation?.id === annotationId) setEditingAnnotation(null);
  };

  const exportReadingNotes = () => {
    if (!currentArticle) return;
    const vocabInArticle = Object.values(savedVocabMap).filter((item) =>
      new RegExp(`\\b${item.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(currentArticle.content)
    );
    const noteSections = currentAnnotations.length > 0
      ? currentAnnotations.map((item, index) =>
          `### ${index + 1}. 划线摘录\n\n> ${item.sentence}\n\n${item.note ? `**我的批注：** ${item.note}` : '_暂未添加批注_'}`
        ).join('\n\n')
      : '_本篇暂无划线批注。_';
    const vocabSection = vocabInArticle.length > 0
      ? vocabInArticle.map((item) => `- **${item.word}**：${item.translation || '暂无释义'}`).join('\n')
      : '_本篇暂无已收录生词。_';
    const markdown = `# ${currentArticle.title}\n\n> LingoFlow 精读笔记导出\n> 导出时间：${new Date().toLocaleString('zh-CN')}\n\n## 划线与批注\n\n${noteSections}\n\n## 本篇生词\n\n${vocabSection}\n`;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${currentArticle.title.replace(/[\\/:*?"<>|]/g, '_')}-精读笔记.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // 1. Randomly pick an existing article from library
  const handleRandomPickExisting = () => {
    if (articles.length <= 1) {
      alert('文库中目前只有一篇文章，点击下方“生成全新 AI 外刊”立即创作新短文吧！');
      return;
    }
    const chosen = pickRandomOtherArticle(articles, currentArticle?.id);
    selectArticle(chosen);
    setShowRefreshModal(false);
  };

  // 2. Generate a brand-new AI article tailored to user
  const handleGenerateNewArticle = async () => {
    setIsGeneratingArticle(true);
    try {
      // Pick 2~3 unmastered words from vocabulary if blendUserVocab is on
      let wordsToBlend = [];
      if (blendUserVocab) {
        const vocab = StorageService.getVocabulary();
        const unmastered = vocab.filter((w) => w.status !== 'mastered');
        const pool = unmastered.length >= 2 ? unmastered : vocab;
        const shuffled = [...pool].sort(() => 0.5 - Math.random());
        wordsToBlend = shuffled.slice(0, 3).map((w) => w.word);
      }

      const generated = await generateDailyArticleWithAI({
        topic: refreshTopic,
        targetWords: wordsToBlend,
      });

      const newArt = {
        title: `${generated.title} (${generated.titleCn || '精选外刊'})`,
        level: generated.level || '中级精选 (Intermediate)',
        content: generated.content,
        tags: generated.tags || ['AI 每日精选', '智能生成'],
      };

      const updated = StorageService.saveArticle(newArt);
      setArticles(updated);
      selectArticle(updated[0]);
      setShowRefreshModal(false);

      confetti({
        particleCount: 70,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch (err) {
      alert(`生成失败: ${err.message}。请检查设置中的 API Key 或网络状况。`);
    } finally {
      setIsGeneratingArticle(false);
    }
  };

  // Close modals on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (selectedWord) setSelectedWord(null);
        else if (selectedSentence) setSelectedSentence(null);
        else if (editingAnnotation) setEditingAnnotation(null);
        else if (showNotesModal) setShowNotesModal(false);
        else if (showRefreshModal) setShowRefreshModal(false);
        else if (showAddModal) setShowAddModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedWord, selectedSentence, editingAnnotation, showNotesModal, showRefreshModal, showAddModal]);

  // Toggle paragraph translation
  const handleToggleParagraphTranslation = async (pIdx, paraText) => {
    const key = `${currentArticle?.id || 'art'}_${pIdx}`;
    if (paragraphTranslations[key]) {
      setParagraphTranslations((prev) => ({
        ...prev,
        [key]: { ...prev[key], visible: !prev[key].visible },
      }));
      return;
    }

    setTranslatingParaIndex(pIdx);
    try {
      const translation = await translateParagraphWithAI(paraText);
      setParagraphTranslations((prev) => ({
        ...prev,
        [key]: { text: translation, visible: true },
      }));
    } catch (err) {
      alert(`段落翻译失败: ${err.message}`);
    } finally {
      setTranslatingParaIndex(null);
    }
  };

  // Extract article content from URL
  const handleExtractFromUrl = async () => {
    const url = urlInput.trim();
    if (!url) {
      alert('请先输入网页链接');
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      alert('请输入以 http:// 或 https:// 开头的完整网址');
      return;
    }

    setIsExtractingUrl(true);
    try {
      const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
        headers: { Accept: 'text/plain' },
      });

      if (!res.ok) {
        throw new Error(`无法抓取网页内容 (状态码: ${res.status})`);
      }

      const markdown = await res.text();
      const titleMatch = markdown.match(/^#\s+(.+)$/m) || markdown.match(/^Title:\s*(.+)$/im);
      const extractedTitle = titleMatch ? titleMatch[1].trim() : '外刊网页摘录';

      let cleanContent = markdown
        .replace(/^#\s+.+$/m, '')
        .replace(/!\[.*?\]\(.*?\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (cleanContent.length > 5000) {
        cleanContent = cleanContent.slice(0, 5000) + '\n\n(已自动截取前 5000 字符精读片段)';
      }

      setNewTitle(extractedTitle);
      setNewContent(cleanContent);
      setImportMode('text');
    } catch (err) {
      alert(`提取失败: ${err.message}。建议直接在浏览器中全选英文正文复制后粘贴到“直接粘贴”标签。`);
    } finally {
      setIsExtractingUrl(false);
    }
  };

  // Save new custom article
  const handleCreateArticle = () => {
    if (!newTitle.trim() || !newContent.trim()) {
      alert('请填写文章标题和内容');
      return;
    }
    const newArt = {
      title: newTitle.trim(),
      content: newContent.trim(),
      level: newLevel,
      tags: ['自主录入'],
    };
    const updated = StorageService.saveArticle(newArt);
    setArticles(updated);
    selectArticle(updated[0]);
    setShowAddModal(false);
    setNewTitle('');
    setNewContent('');
  };

  // Delete article
  const handleDeleteArticle = (id, e) => {
    e.stopPropagation();
    if (articles.length <= 1) {
      alert('请至少保留一篇文章');
      return;
    }
    if (confirm('确认删除这篇文章吗？（该篇的阅读位置记忆与划线批注手记将一并安全清理）')) {
      const updated = StorageService.deleteArticle(id);
      setArticles(updated);
      // Also sync local annotations state
      setAnnotations(StorageService.getReadingAnnotations());
      if (currentArticle?.id === id) {
        selectArticle(updated[0]);
      }
    }
  };

  // Find sentence containing the word
  const findEnclosingSentence = (text, word) => {
    const sentences = splitIntoSentences(text);
    const match = sentences.find((s) =>
      new RegExp(`\\b${word}\\b`, 'i').test(s)
    );
    return match ? match.trim() : '';
  };

  // Handle word click
  const handleWordClick = async (rawWord) => {
    // Clean word: remove trailing punctuation
    const clean = rawWord.replace(/^[^\w]+|[^\w]+$/g, '');
    if (!clean || clean.length < 2) return;

    stopArticleSpeech();

    const sentence = findEnclosingSentence(currentArticle.content, clean);
    setSelectedWord({ word: clean, sentence });
    setWordAnalysis(null);
    setIsAnalyzingWord(true);
    setIsWordSaved(false);

    // Play quick pronunciation
    tts.speak(clean);

    try {
      const analysis = await analyzeWordWithAI(clean, sentence);
      setWordAnalysis(analysis);
    } catch {
      setWordAnalysis({
        word: clean,
        phonetic: '',
        pos: '',
        isError: true,
        translation: '释义解析未成功（可能是网络波动或未配置 API Key）',
        contextSentence: sentence,
      });
    } finally {
      setIsAnalyzingWord(false);
    }
  };

  // Retry word analysis
  const handleRetryWordAnalysis = async () => {
    if (!selectedWord?.word) return;
    setIsAnalyzingWord(true);
    try {
      const analysis = await analyzeWordWithAI(selectedWord.word, selectedWord.sentence || '');
      setWordAnalysis(analysis);
    } catch {
      setWordAnalysis({
        word: selectedWord.word,
        phonetic: '',
        pos: '',
        isError: true,
        translation: '再次尝试未成功，请检查设置中的 API Key 或网络',
        contextSentence: selectedWord.sentence || '',
      });
    } finally {
      setIsAnalyzingWord(false);
    }
  };

  // Save clicked word to vocabulary
  const handleSaveToVocab = () => {
    if (!selectedWord) return;
    StorageService.addWord({
      word: wordAnalysis?.word || selectedWord.word,
      phonetic: wordAnalysis?.phonetic || '',
      pos: wordAnalysis?.pos || '',
      translation: wordAnalysis?.translation || '',
      definitionEn: wordAnalysis?.definitionEn || '',
      contextSentence: selectedWord.sentence || '',
      contextSentenceCn: wordAnalysis?.contextSentenceCn || '',
      tags: ['精读摘录', currentArticle?.title || '自主精读'],
      sources: [{ type: 'reader', id: currentArticle?.id, key: `reader:${currentArticle?.id}`, label: currentArticle?.title || '精读文章' }],
    });
    setIsWordSaved(true);
    // Auto dismiss after 1.1s so reading flow continues seamlessly!
    setTimeout(() => {
      setSelectedWord(null);
    }, 1100);
  };

  // Handle sentence click for AI syntactic breakdown
  const handleSentenceClick = async (sentence) => {
    const cleanSentence = sentence.trim();
    if (!cleanSentence) return;

    stopArticleSpeech();

    setSelectedSentence(cleanSentence);
    setSentenceAnalysis(null);
    setIsAnalyzingSentence(true);

    try {
      const result = await analyzeSentenceWithAI(cleanSentence);
      setSentenceAnalysis(result);
    } catch (err) {
      setSentenceAnalysis({
        isError: true,
        translation: '长难句剖析未成功，请检查 API Key 配置或网络状况。',
        structureSummary: err.message,
        clauses: [],
        grammarPoints: [],
      });
    } finally {
      setIsAnalyzingSentence(false);
    }
  };

  return (
    <div className="study-page flex flex-col h-full relative">
      <StudyHeader
        eyebrow="READ · NOTICE · REMEMBER"
        title="精读工作台"
        description={currentArticle ? `正在阅读：${currentArticle.title}` : '导入一篇英文文章，从真实语境中积累表达。'}
        icon={<BookOpen className="w-4 h-4" />}
        status={currentArticle ? `${currentWordCount} 词 · 约 ${readingMinutes} 分钟` : `${articles.length} 篇文章`}
        actions={(
          <>
            <button
              type="button"
              onClick={() => setShowNotesModal(true)}
              className="tap-lift relative flex items-center gap-1 rounded-xl border border-white/15 bg-white/10 px-2.5 py-2 text-[11px] font-semibold text-slate-100"
              title="查看本篇划线与读书笔记"
            >
              <NotebookPen className="w-3.5 h-3.5 text-amber-300" />
              <span>笔记</span>
              {currentAnnotations.length > 0 && <span className="min-w-4 rounded-full bg-amber-400 px-1 text-[9px] text-[#102a43]">{currentAnnotations.length}</span>}
            </button>
            <button type="button" onClick={() => setShowAddModal(true)} className="tap-lift flex items-center gap-1 rounded-xl bg-amber-400 px-2.5 py-2 text-[11px] font-bold text-[#102a43]">
              <Plus className="w-3.5 h-3.5" />导入
            </button>
          </>
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center rounded-xl bg-white/10 p-0.5 text-[11px] text-slate-300 ring-1 ring-white/10" aria-label="正文字号">
              <button
                type="button"
                onClick={() => setFontSize('text-sm')}
                aria-pressed={fontSize === 'text-sm'}
                className={`px-2 py-1 rounded-lg transition-all ${fontSize === 'text-sm' ? 'bg-white text-[#102a43] shadow-xs font-semibold' : ''}`}
              >
                小
              </button>
              <button
                type="button"
                onClick={() => setFontSize('text-base')}
                aria-pressed={fontSize === 'text-base'}
                className={`px-2 py-1 rounded-lg transition-all ${fontSize === 'text-base' ? 'bg-white text-[#102a43] shadow-xs font-semibold' : ''}`}
              >
                中
              </button>
              <button
                type="button"
                onClick={() => setFontSize('text-lg')}
                aria-pressed={fontSize === 'text-lg'}
                className={`px-2 py-1 rounded-lg transition-all ${fontSize === 'text-lg' ? 'bg-white text-[#102a43] shadow-xs font-semibold' : ''}`}
              >
                大
              </button>
          </div>
          <button type="button" onClick={() => setShowRefreshModal(true)} className="tap-lift flex items-center gap-1 rounded-xl bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200 ring-1 ring-white/10"><Sparkles className="w-3.5 h-3.5" />换篇文章</button>
        </div>
        <div className="mt-2 flex space-x-2 overflow-x-auto pb-1 no-scrollbar text-xs" aria-label="精读文库">
          {articles.map((art) => {
            const isActive = art.id === currentArticle?.id;
            return (
              <div
                key={art.id}
                className={`flex-none flex items-center rounded-xl border transition-all ${isActive ? 'border-amber-300/70 bg-amber-400 text-[#102a43]' : 'border-white/10 bg-white/5 text-slate-200'}`}
              >
                <button type="button" onClick={() => selectArticle(art)} aria-current={isActive ? 'page' : undefined} className="max-w-[155px] truncate px-3 py-1.5 text-left text-[11px] font-semibold">{art.title}</button>
                {articles.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => handleDeleteArticle(art.id, e)}
                    className={`mr-1 rounded-md p-1 ${isActive ? 'text-[#102a43]/60 hover:bg-black/5' : 'text-slate-400 hover:bg-white/10 hover:text-rose-300'}`}
                    aria-label={`删除文章 ${art.title}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </StudyHeader>

      {/* Reading Body with Scroll Tracking */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 pt-3 md:px-6 pb-24"
      >
        <div className="sticky top-0 z-10 mx-auto mb-3 h-1 max-w-2xl overflow-hidden rounded-full bg-[#ded7ca]/80" aria-label={`阅读进度 ${readingProgress}%`}><div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${readingProgress}%` }} /></div>
        {currentArticle ? (
          <article className="study-card paper-grain max-w-2xl mx-auto rounded-[28px] p-5 md:p-7">
            {/* Title & Meta */}
            <div className="mb-5 pb-4 border-b border-slate-100">
              <span className="text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 bg-sky-50 text-sky-700 rounded-md">
                {currentArticle.level || '精选阅读'}
              </span>
              <h1 className="editorial-serif text-2xl md:text-3xl font-bold text-[#102a43] mt-2 tracking-tight leading-tight">
                {currentArticle.title}
              </h1>
               <p className="text-xs text-slate-500 mt-2 flex items-center gap-2">
                 <span>{currentWordCount} 词 · 约 {readingMinutes} 分钟 · 点词查义，句末可拆解与划线</span>
               </p>
               <div className="mt-3 flex flex-wrap items-center gap-2">
                 <button
                   type="button"
                   onClick={toggleArticleSpeech}
                   disabled={articleSpeechSentences.length === 0 || !tts.isSupported()}
                   className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold shadow-xs transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                     isArticleSpeaking
                       ? 'bg-sky-600 text-white hover:bg-sky-700'
                       : 'bg-sky-50 text-sky-800 border border-sky-200 hover:bg-sky-100'
                   }`}
                   title={tts.isSupported() ? '按句连续朗读整篇文章，可暂停和继续' : '当前浏览器不支持系统语音朗读'}
                 >
                   {isArticleSpeaking ? (
                     isArticlePaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />
                   ) : <Volume2 className="w-3.5 h-3.5" />}
                   <span>{isArticleSpeaking ? (isArticlePaused ? '继续朗读' : '暂停朗读') : '整篇朗读'}</span>
                 </button>
                 {(isArticleSpeaking || articleSpeechIndex > 0) && (
                   <button
                     type="button"
                     onClick={() => stopArticleSpeech()}
                     className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 transition-all active:scale-95"
                   >
                     <Square className="w-3 h-3 fill-current" />
                     <span>停止</span>
                   </button>
                 )}
                 {articleSpeechSentences.length > 0 && (
                   <span className="text-[11px] text-slate-500">
                     {articleSpeechIndex >= articleSpeechSentences.length
                       ? '全文已读完'
                       : `共 ${articleSpeechSentences.length} 句${isArticleSpeaking ? ` · 第 ${articleSpeechIndex + 1} 句` : ''}`}
                   </span>
                 )}
               </div>
               {(isArticleSpeaking || articleSpeechIndex > 0) && articleSpeechSentences.length > 0 && (
                 <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100" aria-label="整篇朗读进度">
                   <div
                     className="h-full rounded-full bg-sky-500 transition-all duration-300"
                     style={{ width: `${Math.min(100, (articleSpeechIndex / articleSpeechSentences.length) * 100)}%` }}
                   />
                 </div>
               )}
             </div>

            {/* Paragraphs with interactive words & sentence breakdown button */}
            <div className="space-y-5">
              {currentArticle.content.split('\n\n').map((para, pIdx) => {
                if (!para.trim()) return null;

                const sentences = splitIntoSentences(para);
                const paraKey = `${currentArticle?.id || 'art'}_${pIdx}`;
                const translationInfo = paragraphTranslations[paraKey];
                const isTranslating = translatingParaIndex === pIdx;

                return (
                  <div key={pIdx} className="group/para -mx-2 rounded-xl border-l-2 border-transparent px-2 py-1 space-y-2 transition-colors hover:border-amber-200 hover:bg-[#fbf8f1]">
                    <div>
                      {sentences.map((sentence, sIdx) => {
                        const words = sentence.trim().split(/\s+/);

                        const savedAnnotation = currentAnnotations.find(
                          (item) => item.sentence === sentence.trim()
                        );

                        return (
                          <span
                            key={sIdx}
                            className={`inline leading-loose tracking-wide ${fontSize} text-slate-800 transition-colors rounded-sm group relative ${
                              savedAnnotation
                                ? 'bg-gradient-to-t from-yellow-200/90 from-45% to-transparent to-45% decoration-clone'
                                : ''
                            }`}
                          >
                            {words.map((word, wIdx) => {
                              const cleanWord = word.replace(/^[^\w]+|[^\w]+$/g, '').toLowerCase();
                              const vocabHit = cleanWord && savedVocabMap[cleanWord];

                              return (
                                <span
                                  key={wIdx}
                                  onClick={() => handleWordClick(word)}
                                  className={`cursor-pointer rounded px-0.5 py-0.5 transition-all active:bg-sky-200 ${
                                    vocabHit
                                      ? 'bg-amber-100/90 text-amber-950 font-semibold border-b-2 border-amber-400 shadow-2xs hover:bg-amber-200'
                                      : 'hover:bg-sky-100 hover:text-sky-900'
                                  }`}
                                  title={vocabHit ? `✨ 生词本已收录: ${vocabHit.translation || ''}` : '点击查词释义'}
                                >
                                  {word}{' '}
                                </span>
                              );
                            })}

                            {/* Sentence action trigger icon */}
                            <button
                              onClick={() => handleSentenceClick(sentence)}
                              title="点击剖析此长难句语法结构"
                              className="inline-flex items-center text-slate-400 hover:text-sky-600 hover:bg-sky-50 p-1 rounded-md text-xs transition-colors align-middle ml-0.5"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => openAnnotationEditor(sentence)}
                              title={savedAnnotation ? '编辑这句的划线批注' : '划线收藏并写下心得'}
                              className={`inline-flex items-center p-1 rounded-md text-xs transition-colors align-middle ${
                                savedAnnotation
                                  ? 'text-amber-700 bg-amber-100 hover:bg-amber-200'
                                  : 'text-slate-400 hover:text-amber-700 hover:bg-amber-50'
                              }`}
                            >
                              <Highlighter className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        );
                      })}

                      {/* Paragraph translation toggle button */}
                      <button
                        onClick={() => handleToggleParagraphTranslation(pIdx, para)}
                        disabled={isTranslating}
                        className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md ml-2 transition-all align-middle ${
                          translationInfo?.visible
                            ? 'bg-amber-100 text-amber-800 font-semibold'
                            : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                        }`}
                        title="点击查看整段中文对照译文"
                      >
                        <Languages className="w-3 h-3" />
                        <span>
                          {isTranslating
                            ? '翻译中...'
                            : translationInfo?.visible
                            ? '收起译文'
                            : '整段译文'}
                        </span>
                      </button>
                    </div>

                    {/* Collapsible paragraph bilingual translation card */}
                    {translationInfo?.visible && (
                      <div className="p-3 bg-gradient-to-r from-amber-50 to-orange-50/40 border border-amber-200/80 rounded-xl text-xs text-amber-950 leading-relaxed animate-fade-in select-text">
                        <span className="font-semibold text-amber-800 block mb-1 text-[11px] flex items-center gap-1">
                          <span>🇨🇳 地道中文对照参考:</span>
                        </span>
                        <p className="font-normal">{translationInfo.text}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </article>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-slate-600 text-sm">
            <BookOpen className="w-10 h-10 text-slate-300 mb-2" />
            <span>暂无文章，点击上方“导入文章”开始阅读</span>
          </div>
        )}
      </div>

      {/* 1. Bottom Sheet / Modal: Word Detail & Add to Vocab */}
      {selectedWord && (
        <div onClick={() => setSelectedWord(null)} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150 cursor-pointer">
          <div onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-md cursor-default rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-slate-100 max-h-[85vh] overflow-y-auto">
            {/* iOS BottomSheet Grabber */}
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-3" />

            {/* Header */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <h3 className="text-2xl font-bold font-serif text-slate-900 tracking-tight">
                  {selectedWord.word}
                </h3>
                {wordAnalysis?.phonetic && (
                  <span className="text-xs text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md font-mono">
                    {wordAnalysis.phonetic}
                  </span>
                )}
                <button
                   onClick={() => { stopArticleSpeech(); tts.speak(selectedWord.word); }}
                  className="p-1.5 text-sky-600 hover:bg-sky-50 rounded-full transition-colors"
                  title="播放发音"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>

              <button
                onClick={() => setSelectedWord(null)}
                className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="py-4 space-y-3">
              {isAnalyzingWord ? (
                <div className="flex items-center space-x-2 text-slate-600 text-xs py-4 justify-center">
                  <div className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
                  <span>AI 正在分析词汇释义与原句搭配...</span>
                </div>
              ) : (
                <>
                  {/* Part of Speech & Meaning */}
                  <div>
                    <div className="flex items-baseline gap-2">
                      {wordAnalysis?.pos && (
                        <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md">
                          {wordAnalysis.pos}
                        </span>
                      )}
                      <p className={`text-sm font-semibold ${wordAnalysis?.isError ? 'text-rose-700' : 'text-slate-800'}`}>
                        {wordAnalysis?.translation || '暂无释义'}
                      </p>
                    </div>

                    {wordAnalysis?.isError && (
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={handleRetryWordAnalysis}
                          className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>重新解析词义</span>
                        </button>
                      </div>
                    )}

                    {wordAnalysis?.definitionEn && (
                      <p className="text-xs text-slate-600 mt-1 italic">
                        {wordAnalysis.definitionEn}
                      </p>
                    )}
                  </div>

                  {/* Context Sentence in Current Article */}
                  {selectedWord.sentence && (
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-600 font-medium">
                        <span>📖 原文出处语境:</span>
                        <button
                          onClick={() => { stopArticleSpeech(); tts.speak(selectedWord.sentence); }}
                          className="hover:text-sky-600 flex items-center gap-1"
                        >
                          <Volume2 className="w-3 h-3" />
                          <span>听原句</span>
                        </button>
                      </div>
                      <p className="text-xs text-slate-800 leading-relaxed">
                        {selectedWord.sentence}
                      </p>
                      {wordAnalysis?.contextSentenceCn && (
                        <p className="text-xs text-slate-600 pt-1 border-t border-slate-200/60">
                          {wordAnalysis.contextSentenceCn}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Collocations & Memory Tip */}
                  {wordAnalysis?.collocations && wordAnalysis.collocations.length > 0 && (
                    <div className="text-xs text-slate-700">
                      <span className="font-semibold text-slate-600 block mb-1">
                        🔗 常见搭配:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {wordAnalysis.collocations.map((col, idx) => (
                          <span
                            key={idx}
                            className="bg-sky-50 text-sky-800 px-2 py-0.5 rounded-md border border-sky-100"
                          >
                            {col}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {wordAnalysis?.memoryTip && (
                    <div className="p-2.5 bg-amber-50/80 border border-amber-200/60 rounded-xl text-xs text-amber-900 leading-relaxed">
                      <span className="font-semibold block mb-0.5">💡 记忆助记法:</span>
                      {wordAnalysis.memoryTip}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer Action: Add to Vocabulary */}
            <div className="pt-2">
              <button
                onClick={handleSaveToVocab}
                disabled={isWordSaved || isAnalyzingWord}
                className={`w-full py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-all ${
                  isWordSaved
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                    : 'bg-sky-600 hover:bg-sky-700 text-white shadow-xs'
                }`}
              >
                {isWordSaved ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>已存入生词本 (自动关联原句)</span>
                  </>
                ) : (
                  <>
                    <BookmarkPlus className="w-4 h-4" />
                    <span>一键存入生词本并开启艾宾浩斯复习</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Modal: Deep Sentence & Grammar Breakdown */}
      {selectedSentence && (
        <div onClick={() => setSelectedSentence(null)} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150 cursor-pointer">
          <div onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-lg cursor-default rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl border border-slate-100 max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900">
                  长难句语法透析
                </h3>
              </div>
              <button
                onClick={() => setSelectedSentence(null)}
                className="p-1 text-slate-500 hover:bg-slate-100 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sentence quote */}
            <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                <span>目标句子</span>
                <button
                  onClick={() => { stopArticleSpeech(); tts.speak(selectedSentence); }}
                  className="text-sky-600 hover:underline flex items-center gap-1 font-medium"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>朗读整句</span>
                </button>
              </div>
              <p className="text-sm font-serif italic text-slate-850 leading-relaxed">
                "{selectedSentence}"
              </p>
            </div>

            {/* Breakdown Content */}
            <div className="py-3 space-y-3">
              {isAnalyzingSentence ? (
                <div className="flex items-center space-x-2 text-slate-600 text-xs py-6 justify-center">
                  <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  <span>AI 语法私教正在深度拆解句子主干与从句结构...</span>
                </div>
              ) : sentenceAnalysis ? (
                <>
                  {/* Translation */}
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-slate-600">
                      🇨🇳 纯正地道译文:
                    </span>
                    <p className={`text-sm p-2.5 rounded-lg border leading-relaxed font-medium ${
                      sentenceAnalysis.isError
                        ? 'bg-rose-50 text-rose-800 border-rose-200'
                        : 'bg-sky-50/50 text-slate-800 border-sky-100/60'
                    }`}>
                      {sentenceAnalysis.translation}
                    </p>
                  </div>

                  {sentenceAnalysis.isError && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => handleSentenceClick(selectedSentence)}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>重新剖析语法主干</span>
                      </button>
                    </div>
                  )}

                  {/* Structure Summary */}
                  {sentenceAnalysis.structureSummary && (
                    <div className="space-y-1">
                      <span className="text-xs font-semibold text-indigo-700">
                        ⚡ 句式主干透视:
                      </span>
                      <p className="text-xs text-slate-700 bg-indigo-50/40 p-2.5 rounded-lg border border-indigo-100/60 leading-relaxed">
                        {sentenceAnalysis.structureSummary}
                      </p>
                    </div>
                  )}

                  {/* Clauses Breakdown */}
                  {sentenceAnalysis.clauses && sentenceAnalysis.clauses.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-slate-600">
                        🧩 从句成分拆解:
                      </span>
                      <div className="space-y-1.5">
                        {sentenceAnalysis.clauses.map((clause, idx) => (
                          <div
                            key={idx}
                            className="text-xs p-2.5 rounded-lg bg-slate-50 border border-slate-200/70"
                          >
                            <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-slate-200 text-slate-800 rounded mr-2">
                              {clause.type}
                            </span>
                            <span className="font-mono text-slate-850 font-medium">
                              "{clause.text}"
                            </span>
                            <p className="text-slate-600 mt-1 pl-1">
                              {clause.explanation}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Key Grammar Points */}
                  {sentenceAnalysis.grammarPoints && sentenceAnalysis.grammarPoints.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-xs font-semibold text-slate-600">
                        💡 核心语法亮点:
                      </span>
                      <ul className="text-xs text-slate-700 space-y-1 list-disc list-inside bg-amber-50/50 p-2.5 rounded-lg border border-amber-100">
                        {sentenceAnalysis.grammarPoints.map((pt, idx) => (
                          <li key={idx} className="leading-relaxed">
                            {pt}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* 3. Modal: Add New Custom Article */}
      {showAddModal && (
        <div onClick={() => setShowAddModal(false)} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer">
          <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-lg cursor-default rounded-2xl p-5 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-850 text-base">导入自学英文材料</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 text-slate-500 hover:bg-slate-100 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Import Mode Tabs */}
            <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-medium mt-3 mb-2">
              <button
                onClick={() => setImportMode('text')}
                className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all ${
                  importMode === 'text'
                    ? 'bg-white text-sky-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>📝 直接粘贴正文</span>
              </button>
              <button
                onClick={() => setImportMode('url')}
                className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all ${
                  importMode === 'url'
                    ? 'bg-white text-sky-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Globe className="w-3.5 h-3.5 text-sky-600" />
                <span>🌐 从网页链接提取</span>
              </button>
            </div>

            {importMode === 'url' && (
              <div className="p-3 bg-sky-50/60 border border-sky-200 rounded-xl space-y-2 mb-3">
                <label className="block text-xs font-medium text-sky-900">
                  粘贴外刊/新闻文章网址 (如 BBC, CNN, Medium, The Verge 等)
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={handleExtractFromUrl}
                    disabled={isExtractingUrl || !urlInput.trim()}
                    className="flex-none px-3 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-medium rounded-xl transition-colors disabled:bg-slate-300"
                  >
                    {isExtractingUrl ? '正在提取...' : '一键抓取'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-600 leading-tight">
                  💡 提取完成后将自动清洗标题与正文段落填入下方表单，你可以核对后保存。
                </p>
              </div>
            )}

            <div className="py-2 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  文章标题
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="例如: How Steve Jobs Built Apple"
                  className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  难度标签
                </label>
                <select
                  value={newLevel}
                  onChange={(e) => setNewLevel(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                >
                  <option value="入门 (Beginner)">入门 (Beginner)</option>
                  <option value="中级 (Intermediate)">中级 (Intermediate)</option>
                  <option value="进阶 (Advanced)">进阶 (Advanced)</option>
                  <option value="外刊精读 (Financial Times / Economist)">外刊精读 (FT / Economist)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  英文正文内容 (段落之间请空一行)
                </label>
                <textarea
                  rows={8}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="直接粘贴新闻、外刊、英文小说或美剧对白..."
                  className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-sky-500 focus:outline-hidden resize-none leading-relaxed"
                />
              </div>
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreateArticle}
                className="flex-1 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs transition-colors"
              >
                保存并开始精读
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Bottom Sheet: Sentence Highlight & Personal Note */}
      {editingAnnotation && (
        <div onClick={() => setEditingAnnotation(null)} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150 cursor-pointer">
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#fffdf7] cursor-default w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-amber-100 max-h-[88vh] overflow-y-auto overscroll-contain"
            style={{
              // Keep the sheet inside the *visual* mobile viewport and above the home indicator.
              maxHeight: 'min(88dvh, 720px)',
              paddingBottom: 'max(1.25rem, var(--safe-area-inset-bottom, 0px))',
            }}
          >
            <div className="w-10 h-1 bg-amber-200 rounded-full mx-auto mb-4 sm:hidden" />
            <div className="flex items-start justify-between pb-3 border-b border-amber-100">
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
                  <Highlighter className="w-4 h-4 text-amber-700" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">荧光笔 · 精读批注</h3>
                  <p className="text-[11px] text-slate-500">保存后，这句话会一直留在你的本篇笔记中</p>
                </div>
              </div>
              <button
                onClick={() => setEditingAnnotation(null)}
                className="p-1.5 text-slate-400 hover:bg-amber-50 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <blockquote className="mt-4 px-4 py-3 border-l-4 border-amber-400 bg-gradient-to-r from-amber-50 to-transparent text-sm font-serif italic text-slate-800 leading-relaxed">
              “{editingAnnotation.sentence}”
            </blockquote>

            <label className="block mt-4 text-xs font-bold text-slate-700 mb-1.5">
              ✍️ 我的理解、联想或使用场景 <span className="font-normal text-slate-400">（可不填）</span>
            </label>
            <textarea
              rows={4}
              value={annotationDraft}
              onChange={(e) => setAnnotationDraft(e.target.value)}
              placeholder="例如：这句话适合在工作汇报中表达‘先做重要的事’……"
              className="w-full p-3 text-sm leading-relaxed bg-white border border-amber-200 rounded-2xl outline-hidden focus:ring-2 focus:ring-amber-400/60 resize-none placeholder:text-slate-400"
            />

            <div
              className="sticky bottom-0 flex gap-2 mt-4 pt-3 border-t border-amber-100/80 bg-[#fffdf7]/95 backdrop-blur-sm"
              style={{ paddingBottom: 'max(0.25rem, var(--safe-area-inset-bottom, 0px))' }}
            >
              {currentAnnotations.some((item) => item.id === editingAnnotation.id) && (
                <button
                  onClick={() => removeAnnotation(editingAnnotation.id)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100"
                >
                  取消划线
                </button>
              )}
              <button
                onClick={saveAnnotation}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-xs active:scale-[0.99] transition-all"
              >
                保存划线与批注
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Modal: Reading Notes Collection & Markdown Export */}
      {showNotesModal && (
        <div onClick={() => setShowNotesModal(false)} className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150 cursor-pointer">
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#faf8f2] cursor-default w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl shadow-2xl border border-stone-200 max-h-[90vh] flex flex-col overflow-hidden overscroll-contain"
            style={{ maxHeight: 'min(90dvh, 720px)' }}
          >
            <div className="flex-none p-5 pb-3 border-b border-stone-200 bg-white/70">
              <div className="flex items-start justify-between">
                <div className="flex gap-2.5">
                  <span className="w-10 h-10 rounded-2xl bg-stone-900 text-amber-300 flex items-center justify-center shadow-sm">
                    <NotebookPen className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">本篇精读手记</h3>
                    <p className="text-[11px] text-slate-500 max-w-[250px] truncate">{currentArticle?.title}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowNotesModal(false)}
                  className="p-1.5 text-slate-400 hover:bg-stone-100 rounded-full"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-stone-600">
                  已珍藏 <strong className="text-amber-700">{currentAnnotations.length}</strong> 句划线摘录
                </p>
                <button
                  onClick={exportReadingNotes}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-black text-white text-xs font-bold shadow-xs active:scale-95 transition-all"
                >
                  <Download className="w-3.5 h-3.5 text-amber-300" />
                  导出 Markdown
                </button>
              </div>
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3 overscroll-contain"
              style={{ paddingBottom: 'max(1.5rem, calc(1.5rem + var(--safe-area-inset-bottom, 0px)))' }}
            >
              {currentAnnotations.length > 0 ? currentAnnotations.map((item, index) => (
                <div key={item.id} className="bg-white rounded-2xl p-4 border border-stone-200/80 shadow-2xs">
                  <div className="flex items-start gap-3">
                    <span className="flex-none w-6 h-6 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold flex items-center justify-center">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-serif text-slate-800 leading-relaxed bg-gradient-to-t from-yellow-200/80 from-45% to-transparent to-45% decoration-clone">
                        {item.sentence}
                      </p>
                      {item.note ? (
                        <p className="mt-2.5 pl-3 border-l-2 border-amber-300 text-xs text-slate-600 leading-relaxed">
                          <span className="text-amber-700 font-bold">我的批注：</span>{item.note}
                        </p>
                      ) : (
                        <p className="mt-2 text-[11px] text-slate-400">尚未填写个人心得</p>
                      )}
                      <div className="mt-3 flex gap-2 justify-end">
                        <button
                          onClick={() => {
                            setShowNotesModal(false);
                            openAnnotationEditor(item.sentence);
                          }}
                          className="text-[11px] text-sky-700 hover:bg-sky-50 px-2 py-1 rounded-lg"
                        >
                          编辑批注
                        </button>
                        <button
                          onClick={() => removeAnnotation(item.id)}
                          className="text-[11px] text-rose-500 hover:bg-rose-50 px-2 py-1 rounded-lg"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="py-14 px-6 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-3">
                    <Highlighter className="w-6 h-6 text-amber-700" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800">这页手记还是空白的</h4>
                  <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                    阅读时点击每句话末尾的荧光笔图标，就能收藏金句并写下自己的理解。
                  </p>
                  <button
                    onClick={() => setShowNotesModal(false)}
                    className="mt-4 px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold"
                  >
                    回到文章开始划线
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. Modal: AI Daily Editorial Refresh & Switcher */}
      {showRefreshModal && (
        <div onClick={() => setShowRefreshModal(false)} className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in cursor-pointer">
          <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-md cursor-default rounded-3xl p-5 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    换一篇新外刊 · AI 每日精选
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    一键刷新今日精选短文，巧妙融入你的生词本
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowRefreshModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Action: Pick from existing library */}
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/60 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-800 block">
                  文库已有 {articles.length} 篇经典外刊
                </span>
                <span className="text-[10.5px] text-slate-500">
                  不想调用 AI？直接在文库中随机抽取一篇阅读
                </span>
              </div>
              <button
                onClick={handleRandomPickExisting}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 shadow-2xs transition-all active:scale-95 flex items-center gap-1"
              >
                <Dices className="w-3.5 h-3.5 text-sky-600" />
                <span>文库随机挑</span>
              </button>
            </div>

            {/* AI Generator Section */}
            <div className="space-y-3 pt-1">
              <label className="block text-xs font-bold text-slate-800">
                或由 AI 特约专栏作家为你现场撰写一篇：
              </label>

              {/* Topic Select Grid */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'random', icon: '🎲', label: '随心惊喜', desc: '不设限的精彩短文' },
                  { id: 'lifestyle', icon: '☕', label: '生活与心智', desc: '纽约客风散文哲学' },
                  { id: 'tech', icon: '🚀', label: '前沿科技', desc: 'AI、硅谷与商业浪潮' },
                  { id: 'culture', icon: '🌍', label: '人文漫游', desc: '国家地理风土人情' },
                ].map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setRefreshTopic(t.id)}
                    className={`p-2.5 rounded-2xl border cursor-pointer transition-all ${
                      refreshTopic === t.id
                        ? 'bg-amber-50/90 border-amber-400 text-amber-950 font-bold ring-1 ring-amber-300 shadow-2xs'
                        : 'bg-white border-slate-200/80 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <span>{t.icon}</span>
                      <span>{t.label}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">{t.desc}</p>
                  </div>
                ))}
              </div>

              {/* Blend User Vocabulary Toggle */}
              <div className="flex items-center justify-between p-3 bg-amber-50/60 border border-amber-200/70 rounded-2xl">
                <div>
                  <span className="text-xs font-bold text-amber-900 block">
                    巧妙融入我的生词本单词
                  </span>
                  <span className="text-[10.5px] text-slate-500">
                    在文章中偶遇刚背的生词，并在正文中自动标黄
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={blendUserVocab}
                  onChange={(e) => setBlendUserVocab(e.target.checked)}
                  className="w-4 h-4 accent-amber-600 rounded"
                />
              </div>

              {/* Generate Action Button */}
              <button
                onClick={handleGenerateNewArticle}
                disabled={isGeneratingArticle}
                className="w-full py-2.5 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-bold shadow-md transition-all active:scale-95 flex items-center justify-center gap-1.5"
              >
                {isGeneratingArticle ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>AI 专栏作家正在起草外刊精读...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-100" />
                    <span>✨ 立即创作新外刊并开启精读</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
