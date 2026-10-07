import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  BookmarkPlus,
  Check,
  ChevronDown,
  Download,
  History,
  Loader2,
  Search,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { StorageService } from '../services/storage';
import { analyzeWordWithAI, describeAIError, hasApiKey } from '../services/ai';
import { tts } from '../services/speech';
import { createLatestRequest } from '../services/latestRequest';
import {
  clearDictionaryHistory,
  createDictionaryService,
  DICTIONARY_WORD_COUNT,
  lookupOnlineDictionary,
  normalizeDictionaryQuery,
  readDictionaryState,
  rememberDictionaryEntry,
} from '../services/dictionary';
import { VOCABULARY_CATEGORIES } from '../data/categoryVocabulary';
import { useToast } from './ui/toastContext';
import './Dictionary.css';

const featured = ['resilience', 'serendipity', 'perspective', 'curiosity'];
const tagLabels = {
  zk: '中考',
  gk: '高考',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  ielts: '雅思',
  gre: 'GRE',
};

export default function Dictionary({ onNavigate = () => {}, intent = null }) {
  const toast = useToast();
  const service = useMemo(() => createDictionaryService(), []);
  const request = useRef(createLatestRequest());
  const suggestionRequest = useRef(createLatestRequest());
  const enrichmentRequest = useRef(createLatestRequest());
  const downloadRequest = useRef(createLatestRequest());
  const inputRef = useRef(null);
  const handledIntent = useRef(null);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [history, setHistory] = useState(() => readDictionaryState().history);
  const [savedWords, setSavedWords] = useState(() =>
    StorageService.getVocabulary(),
  );
  const [offlineReady, setOfflineReady] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const hasKey = hasApiKey();
  const saved =
    entry &&
    savedWords.some(
      (word) =>
        normalizeDictionaryQuery(word.word) ===
        normalizeDictionaryQuery(entry.word),
    );

  useEffect(() => {
    if (intent?.query && intent.token !== handledIntent.current) {
      handledIntent.current = intent.token;
      search(intent.query);
    }
  });

  useEffect(() => {
    let alive = true;
    const gates = [
      request.current,
      suggestionRequest.current,
      enrichmentRequest.current,
      downloadRequest.current,
    ];
    service.isDownloaded().then((ready) => {
      if (alive) setOfflineReady(ready);
    });
    const refresh = () => setSavedWords(StorageService.getVocabulary());
    window.addEventListener('lingoflow:storage', refresh);
    return () => {
      alive = false;
      window.removeEventListener('lingoflow:storage', refresh);
      gates.forEach((gate) => gate.cancel());
      tts.stop();
    };
  }, [service]);

  useEffect(() => {
    if (!query || normalizeDictionaryQuery(query) === submitted)
      return undefined;
    const gate = suggestionRequest.current;
    const current = gate.start();
    const timer = setTimeout(() => {
      service
        .suggest(query, { signal: current.signal })
        .then((words) => {
          if (current.isCurrent()) setSuggestions(words);
        })
        .catch(() => {
          if (current.isCurrent()) setSuggestions([]);
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      gate.cancel();
    };
  }, [query, submitted, service]);

  function remember(result) {
    if (!rememberDictionaryEntry(result))
      toast.info('查词结果已显示，但本地空间不足，暂未保存查词记录。');
    setHistory(readDictionaryState().history);
  }

  async function search(value, online = false) {
    const key = normalizeDictionaryQuery(value);
    if (!key) {
      inputRef.current?.focus();
      return;
    }
    suggestionRequest.current.cancel();
    enrichmentRequest.current.cancel();
    tts.stop();
    const current = request.current.start();
    setQuery(value);
    setSubmitted(key);
    setSuggestions([]);
    setEntry(null);
    setError('');
    setLoading(true);
    setEnriching(false);
    try {
      const result = online
        ? await lookupOnlineDictionary(key, { signal: current.signal })
        : await service.lookup(key, { signal: current.signal, savedWords });
      if (!current.isCurrent()) return;
      setEntry(result);
      if (result) remember(result);
      else {
        const words = await service.suggest(key, {
          signal: current.signal,
          fuzzy: true,
        });
        if (current.isCurrent()) setSuggestions(words);
      }
    } catch (cause) {
      if (current.isCurrent())
        setError(
          cause.name === 'TimeoutError'
            ? '词库加载超时，请检查网络后重试。'
            : cause.message || '暂时无法查词，请稍后重试。',
        );
    } finally {
      if (current.isCurrent()) setLoading(false);
    }
  }

  function changeQuery(value) {
    request.current.cancel();
    enrichmentRequest.current.cancel();
    setQuery(value);
    setSubmitted('');
    setEntry(null);
    setSuggestions([]);
    setError('');
    setLoading(false);
    setEnriching(false);
  }

  async function enrich() {
    if (!entry) return;
    if (!hasKey) {
      onNavigate('settings');
      return;
    }
    const current = enrichmentRequest.current.start();
    const original = entry;
    setEnriching(true);
    try {
      const analysis = await analyzeWordWithAI(original.word, '', {
        signal: current.signal,
      });
      if (!current.isCurrent()) return;
      if (!analysis.translation || !analysis.contextSentence)
        throw new Error('暂未得到完整的双语用法，请重试。');
      const result = {
        ...original,
        phonetic: original.phonetic || analysis.phonetic,
        translation: original.translation || analysis.translation,
        meanings: original.englishOnly
          ? [{ pos: analysis.pos, text: analysis.translation }]
          : original.meanings,
        englishOnly: false,
        contextSentence: analysis.contextSentence,
        contextSentenceCn: analysis.contextSentenceCn,
        collocations: analysis.collocations,
        memoryTip: analysis.memoryTip,
        aiEnriched: true,
      };
      setEntry(result);
      remember(result);
    } catch (cause) {
      if (current.isCurrent())
        toast.error(
          describeAIError(cause, { fallback: '补充用法失败，请稍后重试。' })
            .message,
        );
    } finally {
      if (current.isCurrent()) setEnriching(false);
    }
  }

  function saveWord() {
    if (!entry) return;
    const word = StorageService.addWord({
      word: entry.word,
      phonetic: entry.phonetic,
      pos: entry.pos,
      translation: entry.translation,
      definitionEn: entry.definitionEn,
      contextSentence: entry.contextSentence,
      contextSentenceCn: entry.contextSentenceCn,
      tags: ['词典查词'],
      sources: [
        {
          type: 'dictionary',
          id: normalizeDictionaryQuery(entry.word),
          key: `dictionary:${normalizeDictionaryQuery(entry.word)}`,
          label: '英汉词典',
        },
      ],
    });
    if (word) {
      setSavedWords(StorageService.getVocabulary());
      toast.success('已加入生词本，可以在闪卡里复习了。');
    } else toast.error('保存失败，请在设置中检查本地存储空间。');
    return word;
  }

  function reviewWord() {
    const word =
      savedWords.find(
        (item) =>
          normalizeDictionaryQuery(item.word) ===
          normalizeDictionaryQuery(entry?.word),
      ) || saveWord();
    if (word) onNavigate('vocab', { section: 'vocab', wordIds: [word.id] });
  }

  async function download() {
    const current = downloadRequest.current.start();
    setDownloadProgress(0);
    try {
      await service.download({
        signal: current.signal,
        onProgress: (progress) => {
          if (current.isCurrent()) setDownloadProgress(progress);
        },
      });
      if (current.isCurrent()) {
        setOfflineReady(true);
        toast.success('离线词库已保存，断网也能查词。');
      }
    } catch (cause) {
      if (current.isCurrent())
        toast.error(cause.message || '下载未完成，联网后可继续下载。');
    } finally {
      if (current.isCurrent()) setDownloadProgress(null);
    }
  }

  return (
    <section className="dictionary-page h-full overflow-y-auto">
      <div className="dictionary-layout">
        <header className="dictionary-header">
          <div>
            <p>YOUR POCKET DICTIONARY</p>
            <h1>每个词，都读懂。</h1>
            <span>
              英汉词典 · {Math.floor(DICTIONARY_WORD_COUNT / 1000) / 10} 万词条
            </span>
          </div>
          <span className="dictionary-mark">
            <BookOpen size={26} strokeWidth={1.6} />
          </span>
        </header>
        <div className="dictionary-main">
          <form
            className="dictionary-search"
            onSubmit={(event) => {
              event.preventDefault();
              search(query);
            }}
            aria-label="英文查词"
          >
            <Search size={21} aria-hidden="true" />
            <input
              ref={inputRef}
              aria-label="英文单词或短语"
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              placeholder="输入英文单词或短语"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              type="search"
              maxLength={64}
            />
            {query && (
              <button
                type="button"
                className="dictionary-clear"
                aria-label="清空搜索"
                onClick={() => {
                  changeQuery('');
                  inputRef.current?.focus();
                }}
              >
                <X size={16} />
              </button>
            )}
            <button
              className="dictionary-submit"
              type="submit"
              aria-label="查词"
            >
              <ArrowRight size={20} />
            </button>
          </form>
          {!submitted && suggestions.length > 0 && (
            <div className="dictionary-suggestions" aria-label="拼写建议">
              {suggestions.map((word) => (
                <button type="button" key={word} onClick={() => search(word)}>
                  <Search size={14} />
                  {word}
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          )}
          <div aria-live="polite" aria-busy={loading}>
            {loading && (
              <div className="dictionary-loading">
                <Loader2 size={22} className="animate-spin" />
                <p>正在查找 {submitted}…</p>
              </div>
            )}
            {error && (
              <div className="dictionary-empty">
                <Search size={28} />
                <h2>暂时没查到</h2>
                <p>{error}</p>
                <button type="button" onClick={() => search(query)}>
                  重新查词
                </button>
              </div>
            )}
            {!loading && !error && submitted && !entry && (
              <div className="dictionary-empty">
                <Search size={28} />
                <h2>词库暂未收录 “{submitted}”</h2>
                <p>检查一下拼写，也可以试试在线英文词典。</p>
                {suggestions.length > 0 && (
                  <div className="dictionary-chips" aria-label="你可能要查">
                    {suggestions.map((word) => (
                      <button
                        type="button"
                        key={word}
                        onClick={() => search(word)}
                      >
                        {word}
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => search(query, true)}>
                  联网查词 <ArrowRight size={14} />
                </button>
              </div>
            )}
            {entry && !loading && (
              <article
                className="dictionary-result"
                aria-label={`${entry.word} 的词典释义`}
              >
                <div className="dictionary-word-heading">
                  <div>
                    <span className="dictionary-entry-label">
                      {entry.englishOnly ? '英文词典' : '英汉释义'}
                    </span>
                    <h2>{entry.word}</h2>
                    <div className="dictionary-pronunciation">
                      <span>{entry.phonetic || '词库暂未提供音标'}</span>
                      <button
                        type="button"
                        aria-label={`播放 ${entry.word} 发音`}
                        onClick={() => tts.speak(entry.word)}
                      >
                        <Volume2 size={18} />
                        听发音
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`dictionary-save ${saved ? 'is-saved' : ''}`}
                    aria-label={saved ? '已加入生词本' : '加入生词本'}
                    onClick={saved ? reviewWord : saveWord}
                  >
                    {saved ? <Check size={20} /> : <BookmarkPlus size={20} />}
                    <span>{saved ? '已收藏' : '收藏'}</span>
                  </button>
                </div>
                {entry.tags?.some((tag) => tagLabels[tag]) && (
                  <div className="dictionary-tags">
                    {entry.tags
                      .filter((tag) => tagLabels[tag])
                      .map((tag) => (
                        <span key={tag}>{tagLabels[tag]}</span>
                      ))}
                  </div>
                )}
                <div className="dictionary-meanings">
                  {entry.meanings.map((meaning, index) => (
                    <div key={`${meaning.pos}:${meaning.text}`}>
                      <span className="dictionary-sense-number">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <p>
                        {meaning.pos && (
                          <span className="dictionary-pos">{meaning.pos}</span>
                        )}
                        {meaning.text}
                      </p>
                    </div>
                  ))}
                </div>
                {entry.definitionEn && !entry.englishOnly && (
                  <details className="dictionary-definition">
                    <summary>
                      英文释义 <ChevronDown size={16} />
                    </summary>
                    <p>{entry.definitionEn}</p>
                  </details>
                )}
                {entry.forms.length > 0 && (
                  <section className="dictionary-forms">
                    <h3>词形变化</h3>
                    <div>
                      {entry.forms.map((form) => (
                        <button
                          type="button"
                          key={`${form.label}:${form.word}`}
                          onClick={() => search(form.word)}
                        >
                          <span>{form.label}</span>
                          <strong>{form.word}</strong>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {entry.contextSentence && (
                  <section className="dictionary-example">
                    <div>
                      <h3>放进句子里</h3>
                      <button
                        type="button"
                        aria-label="播放例句"
                        onClick={() => tts.speak(entry.contextSentence)}
                      >
                        <Volume2 size={17} />
                      </button>
                    </div>
                    <p>{entry.contextSentence}</p>
                    {entry.contextSentenceCn && (
                      <span>{entry.contextSentenceCn}</span>
                    )}
                    {entry.aiEnriched && <small>AI 补充例句与用法</small>}
                  </section>
                )}
                {entry.collocations?.length > 0 && (
                  <section className="dictionary-collocations">
                    <h3>常用搭配</h3>
                    <div>
                      {[...new Set(entry.collocations)].map((text) => (
                        <span key={text}>{text}</span>
                      ))}
                    </div>
                  </section>
                )}
                {entry.memoryTip && (
                  <p className="dictionary-memory">
                    <Sparkles size={16} />
                    {entry.memoryTip}
                  </p>
                )}
                {!entry.aiEnriched && (
                  <button
                    type="button"
                    className="dictionary-enrich"
                    onClick={enrich}
                    disabled={enriching}
                  >
                    {enriching ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    <span>
                      {enriching
                        ? '正在补充双语用法…'
                        : hasKey
                          ? 'AI 补充双语例句与搭配'
                          : '设置 AI，补充双语例句与搭配'}
                    </span>
                    <ArrowRight size={15} />
                  </button>
                )}
                <footer className="dictionary-source">
                  {entry.source === 'ECDICT' ? (
                    <a
                      href="https://github.com/skywind3000/ECDICT"
                      target="_blank"
                      rel="noreferrer"
                    >
                      释义来源：ECDICT · MIT
                    </a>
                  ) : entry.source === 'Free Dictionary API' ? (
                    <a
                      href="https://dictionaryapi.dev/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      释义来源：Free Dictionary API
                    </a>
                  ) : (
                    <span>释义来源：学习词库</span>
                  )}
                  <button type="button" onClick={reviewWord}>
                    {saved ? '复习这个词' : '收藏并复习'}{' '}
                    <ArrowRight size={13} />
                  </button>
                </footer>
              </article>
            )}
          </div>
          {!submitted && !entry && (
            <section className="dictionary-discover">
              <span className="dictionary-discover-icon">
                <Sparkles size={24} />
              </span>
              <p>ONE WORD AT A TIME</p>
              <h2>
                遇见一个词，
                <br />
                打开一个新世界。
              </h2>
              <span>
                读文章、练口语时遇到的生词，
                <br />
                随时回来查一查。
              </span>
              <div className="dictionary-featured">
                <span>不妨从这些词开始</span>
                <div>
                  {featured.map((word) => (
                    <button
                      type="button"
                      key={word}
                      onClick={() => search(word)}
                    >
                      {word}
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>
        <aside className="dictionary-sidebar">
          {history.length > 0 && (
            <section className="dictionary-recent">
              <header>
                <h2>
                  <History size={17} />
                  最近查过
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    if (clearDictionaryHistory()) setHistory([]);
                    else toast.error('查词记录暂时无法清除，请检查本地存储。');
                  }}
                >
                  清除记录
                </button>
              </header>
              <div>
                {history.map((word) => (
                  <button type="button" key={word} onClick={() => search(word)}>
                    {word}
                    <ArrowRight size={13} />
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="dictionary-topics">
            <header>
              <h2>换个领域，认识新词</h2>
              <span>点击查看一个分类词</span>
            </header>
            <div>
              {VOCABULARY_CATEGORIES.map((category) => (
                <button
                  type="button"
                  key={category.id}
                  onClick={() =>
                    search(
                      category.words[
                        Math.floor(Math.random() * category.words.length)
                      ].word,
                    )
                  }
                >
                  <span>{category.icon}</span>
                  {category.label}
                  <ArrowRight size={13} />
                </button>
              ))}
            </div>
          </section>
          <details className="dictionary-offline">
            <summary>
              <span>
                <Download size={17} />
                {offlineReady ? '离线词库已就绪' : '把词典装进口袋'}
              </span>
              <ChevronDown size={16} />
            </summary>
            <p>
              {offlineReady
                ? '全部基础词条已保存在此设备。例句补充和在线词典需要联网。'
                : '下载约 11 MB 的词库，断网也能查基础释义。查过的词会自动保存。'}
            </p>
            {!offlineReady &&
              (downloadProgress === null ? (
                <button type="button" onClick={download}>
                  下载离线词库 <Download size={14} />
                </button>
              ) : (
                <div className="dictionary-download">
                  <progress max="100" value={downloadProgress} />
                  <span>{downloadProgress}%</span>
                  <button
                    type="button"
                    onClick={() => {
                      downloadRequest.current.cancel();
                      setDownloadProgress(null);
                    }}
                  >
                    取消
                  </button>
                </div>
              ))}
          </details>
        </aside>
      </div>
    </section>
  );
}
