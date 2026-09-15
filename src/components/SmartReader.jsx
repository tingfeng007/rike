import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { StorageService } from '../services/storage';
import { analyzeWordWithAI, analyzeSentenceWithAI, translateParagraphWithAI } from '../services/ai';
import { tts } from '../services/speech';

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

export default function SmartReader() {
  const [articles, setArticles] = useState([]);
  const [currentArticle, setCurrentArticle] = useState(null);
  const [fontSize, setFontSize] = useState('text-base'); // 'text-sm' | 'text-base' | 'text-lg'

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

  // Load articles
  useEffect(() => {
    const list = StorageService.getArticles();
    setArticles(list);
    if (list.length > 0) {
      setCurrentArticle(list[0]);
    }
  }, []);

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
    setCurrentArticle(updated[0]);
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
    if (confirm('确认删除这篇文章吗？')) {
      const updated = StorageService.deleteArticle(id);
      setArticles(updated);
      if (currentArticle?.id === id) {
        setCurrentArticle(updated[0]);
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
    } catch (err) {
      setWordAnalysis({
        word: clean,
        phonetic: '',
        pos: '',
        translation: '请在“设置”中配置正确的 API Key 获取深度中文释义与搭配',
        contextSentence: sentence,
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

    setSelectedSentence(cleanSentence);
    setSentenceAnalysis(null);
    setIsAnalyzingSentence(true);

    try {
      const result = await analyzeSentenceWithAI(cleanSentence);
      setSentenceAnalysis(result);
    } catch (err) {
      setSentenceAnalysis({
        translation: '解析失败，请检查 API Key 配置与网络连接。',
        structureSummary: err.message,
        clauses: [],
        grammarPoints: [],
      });
    } finally {
      setIsAnalyzingSentence(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent relative">
      {/* Top Header */}
      <header 
        className="flex-none glass-panel border-b border-white/80 px-4 py-2.5 shadow-xs z-10"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 10px)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <BookOpen className="w-5 h-5 text-sky-600" />
            <h2 className="font-bold text-slate-900 text-sm">
              智能精读伴读
            </h2>
          </div>

          <div className="flex items-center space-x-2">
            {/* Font size toggle */}
            <div className="flex items-center bg-slate-100/90 rounded-xl p-0.5 text-xs text-slate-600 border border-slate-200/60 shadow-2xs">
              <button
                onClick={() => setFontSize('text-sm')}
                className={`px-2 py-0.5 rounded-lg transition-all ${fontSize === 'text-sm' ? 'bg-white text-sky-600 shadow-xs font-semibold' : ''}`}
              >
                小
              </button>
              <button
                onClick={() => setFontSize('text-base')}
                className={`px-2 py-0.5 rounded-lg transition-all ${fontSize === 'text-base' ? 'bg-white text-sky-600 shadow-xs font-semibold' : ''}`}
              >
                中
              </button>
              <button
                onClick={() => setFontSize('text-lg')}
                className={`px-2 py-0.5 rounded-lg transition-all ${fontSize === 'text-lg' ? 'bg-white text-sky-600 shadow-xs font-semibold' : ''}`}
              >
                大
              </button>
            </div>

            {/* Add article button */}
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white px-2.5 py-1 rounded-xl text-xs font-semibold shadow-xs transition-all active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>导入文章</span>
            </button>
          </div>
        </div>

        {/* Article Selector Carousel */}
        <div className="flex space-x-2 overflow-x-auto pb-1 no-scrollbar text-xs">
          {articles.map((art) => {
            const isActive = art.id === currentArticle?.id;
            return (
              <div
                key={art.id}
                onClick={() => setCurrentArticle(art)}
                className={`flex-none flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                  isActive
                    ? 'bg-sky-50/90 text-sky-900 border-sky-300 font-semibold shadow-2xs'
                    : 'bg-white/80 text-slate-600 border-slate-200/80 hover:bg-white'
                }`}
              >
                <span className="truncate max-w-[140px]">{art.title}</span>
                {articles.length > 1 && (
                  <button
                    onClick={(e) => handleDeleteArticle(art.id, e)}
                    className="text-slate-400 hover:text-rose-500 p-0.5 rounded-md"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </header>

      {/* Reading Body */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24">
        {currentArticle ? (
          <article className="max-w-2xl mx-auto bg-white rounded-2xl p-5 md:p-7 shadow-xs border border-slate-200/80">
            {/* Title & Meta */}
            <div className="mb-5 pb-4 border-b border-slate-100">
              <span className="text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 bg-sky-50 text-sky-700 rounded-md">
                {currentArticle.level || '精选阅读'}
              </span>
              <h1 className="text-xl md:text-2xl font-bold text-slate-900 mt-2 tracking-tight">
                {currentArticle.title}
              </h1>
              <p className="text-xs text-slate-600 mt-1.5 flex items-center gap-2">
                <span>💡 提示：点击文中任意单词即可查词释义与加生词本；点击右侧 🔬 拆解长难句</span>
              </p>
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
                  <div key={pIdx} className="bg-slate-50/50 p-3 rounded-2xl border border-slate-100/80 space-y-2">
                    <div>
                      {sentences.map((sentence, sIdx) => {
                        const words = sentence.trim().split(/\s+/);

                        return (
                          <span
                            key={sIdx}
                            className={`inline leading-loose tracking-wide ${fontSize} text-slate-800 transition-colors rounded-sm group relative`}
                          >
                            {words.map((word, wIdx) => (
                              <span
                                key={wIdx}
                                onClick={() => handleWordClick(word)}
                                className="cursor-pointer hover:bg-amber-100 hover:text-amber-900 rounded px-0.5 py-0.5 transition-colors active:bg-sky-200"
                              >
                                {word}{' '}
                              </span>
                            ))}

                            {/* Sentence action trigger icon */}
                            <button
                              onClick={() => handleSentenceClick(sentence)}
                              title="点击剖析此长难句语法结构"
                              className="inline-flex items-center text-slate-400 hover:text-sky-600 hover:bg-sky-50 p-1 rounded-md text-xs transition-colors align-middle ml-0.5"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
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
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-slate-100 max-h-[85vh] overflow-y-auto">
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
                  onClick={() => tts.speak(selectedWord.word)}
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
                      <p className="text-sm font-semibold text-slate-800">
                        {wordAnalysis?.translation || '暂无释义'}
                      </p>
                    </div>

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
                          onClick={() => tts.speak(selectedWord.sentence)}
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
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl border border-slate-100 max-h-[85vh] overflow-y-auto">
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
                  onClick={() => tts.speak(selectedSentence)}
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
                    <p className="text-sm text-slate-800 bg-sky-50/50 p-2.5 rounded-lg border border-sky-100/60 leading-relaxed font-medium">
                      {sentenceAnalysis.translation}
                    </p>
                  </div>

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
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl p-5 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
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
    </div>
  );
}
