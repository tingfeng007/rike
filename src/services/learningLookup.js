import { createDictionaryService, buildDictionaryWordPayload, normalizeDictionaryQuery } from './dictionary.js';
import { StorageService } from './storage.js';
import { analyzeWordWithAI, hasApiKey } from './ai.js';

/** One basic dictionary path for every learning surface; paid enrichment is opt-in. */
export function createLearningLookup({ dictionary = createDictionaryService(), getWords = () => StorageService.getVocabulary(), analyze = analyzeWordWithAI, hasKey = hasApiKey } = {}) {
  return async (word, contextSentence = '', { signal, enrich = false } = {}) => {
    const query = normalizeDictionaryQuery(word).replace(/^["“”‘’(]+|["“”‘’,.;:!?)]+$/g, '');
    signal?.throwIfAborted();
    const entry = await dictionary.lookup(query, { signal, savedWords: getWords() });
    signal?.throwIfAborted();
    const basic = entry ? {
      ...buildDictionaryWordPayload(entry),
      source: entry.source || '英汉词典',
      contextSentence: contextSentence || entry.contextSentence || '',
      contextSentenceCn: !contextSentence || contextSentence === entry.contextSentence ? entry.contextSentenceCn || '' : '',
    } : null;
    if (!enrich) return basic;
    if (!hasKey()) throw new Error('AI 语境解析需要先在设置中连接 AI。基础词义无需 Key。');
    const extra = await analyze(query, contextSentence, { signal });
    signal?.throwIfAborted();
    return { ...basic, ...extra, source: 'AI 语境解析', aiEnriched: true };
  };
}

export const lookupLearningWord = createLearningLookup();
