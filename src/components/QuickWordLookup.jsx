import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookmarkPlus, Check, Loader2, Volume2 } from 'lucide-react';
import { useToast } from './ui/toastContext';
import { StorageService } from '../services/storage';
import { buildDictionaryWordPayload, createDictionaryService, lookupOnlineDictionary, normalizeDictionaryQuery, rememberDictionaryEntry } from '../services/dictionary';
import { isDictionaryQuery } from '../services/dictionaryState';
import { lookupQueryForWord } from '../services/wordTokens';
import { createLatestRequest } from '../services/latestRequest';
import { tts } from '../services/speech';

export default function QuickWordLookup({ request, onOpenDictionary, onExplore }) {
  const toast = useToast();
  const service = useMemo(() => createDictionaryService(), []);
  const query = lookupQueryForWord(request.word);
  const gateRef = useRef(createLatestRequest());
  const [result, setResult] = useState({ token: request.token, entry: null, loading: true, error: '' });
  const [savedWords, setSavedWords] = useState(() => StorageService.getVocabulary());
  const current = result.token === request.token ? result : { entry: null, loading: true, error: '' };
  const entry = current.entry;
  const saved = entry && savedWords.some((word) => normalizeDictionaryQuery(word.word) === normalizeDictionaryQuery(entry.word));

  useEffect(() => {
    const gate = gateRef.current;
    return () => { gate.cancel(); tts.stop(); };
  }, []);
  useEffect(() => {
    const refresh = () => setSavedWords(StorageService.getVocabulary());
    window.addEventListener('lingoflow:storage', refresh);
    return () => window.removeEventListener('lingoflow:storage', refresh);
  }, []);

  const lookup = useCallback(async (online = false) => {
    const latest = gateRef.current.start();
    try {
      const found = !isDictionaryQuery(query) ? null : online
        ? await lookupOnlineDictionary(query, { signal: latest.signal })
        : await service.lookup(query, { signal: latest.signal, savedWords: StorageService.getVocabulary() });
      if (!latest.isCurrent()) return;
      if (found) rememberDictionaryEntry(found);
      setResult({ token: request.token, entry: found, loading: false, error: '' });
    } catch (error) {
      if (!latest.isCurrent()) return;
      setResult({ token: request.token, entry: null, loading: false, error: error.name === 'TimeoutError' ? '查询超时，请重试。' : '暂时无法查词，请检查网络后重试。' });
    }
  }, [request.token, query, service]);

  useEffect(() => {
    lookup();
    const gate = gateRef.current;
    return () => gate.cancel();
  }, [lookup]);

  function save() {
    const payload = buildDictionaryWordPayload(entry);
    // An English-only response cannot make a usable bilingual review card.
    if (!payload.translation) { onOpenDictionary(entry.word); return; }
    if (request.context && lookupQueryForWord(request.context) !== query
      && (request.context !== entry.contextSentence || request.contextCn)) {
      payload.contextSentence = request.context;
      payload.contextSentenceCn = request.contextCn || '';
    }
    const word = StorageService.addWord(payload);
    if (word) { setSavedWords(StorageService.getVocabulary()); toast.success('已加入生词本'); }
    else toast.error('保存失败，请检查本地存储空间。');
  }

  return <div data-word-lookup="off">
      <div className="quick-word-pronunciation">
        {entry?.phonetic && <span>{entry.phonetic}</span>}
        <button type="button" aria-label={`播放 ${request.word} 发音`} onClick={() => tts.speak(request.word)}><Volume2 size={18} />发音</button>
      </div>
      {current.loading ? <output className="quick-word-loading"><Loader2 size={20} className="animate-spin" /><span>正在查词…</span></output> : current.error ? <div className="quick-word-empty"><p role="alert">{current.error}</p><button type="button" onClick={() => { setResult({ token: request.token, entry: null, loading: true, error: '' }); lookup(); }}>重试</button></div> : entry ? <div className="quick-word-meanings">{entry.meanings.map((meaning) => <p key={`${meaning.pos}:${meaning.text}`}>{meaning.pos && <span>{meaning.pos}</span>}{meaning.text}</p>)}</div> : <div className="quick-word-empty"><p>词库暂未收录</p><button type="button" onClick={() => { setResult({ token: request.token, entry: null, loading: true, error: '' }); lookup(true); }}>在线查词</button></div>}
      <div className="quick-word-actions">
        {entry && !entry.englishOnly && <button type="button" onClick={save} disabled={saved} className="quick-word-save">{saved ? <Check size={17} /> : <BookmarkPlus size={17} />}{saved ? '已收藏' : '收藏'}</button>}
        {request.onExplore && <button type="button" onClick={onExplore}>语境解析</button>}
        <button type="button" onClick={() => onOpenDictionary(entry?.word || query || request.word)}>词典<ArrowRight size={16} /></button>
      </div>
    </div>;
}
