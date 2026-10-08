import { normalizeDictionaryQuery, isDictionaryQuery, readDictionaryState } from './dictionaryState.js';
export { normalizeDictionaryQuery, isDictionaryQuery, readDictionaryState, rememberDictionaryEntry, clearDictionaryHistory } from './dictionaryState.js';
import { VOCABULARY_CATEGORIES } from '../data/categoryVocabulary.js';
import { DEFAULT_SAMPLE_WORDS } from '../data/samples.js';
import { createTimedRequest } from './requestTimeout.js';

export const DICTIONARY_VERSION = 'ecdict-bc015ed-ipa-v2';
export const DICTIONARY_WORD_COUNT = 59136;
export const DICTIONARY_CACHE = 'lingoflow-dictionary-v1';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const curated = [
  ...VOCABULARY_CATEGORIES.flatMap((category) => category.words),
  ...DEFAULT_SAMPLE_WORDS,
];
const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const lines = (value) =>
  clean(value)
    .split(/\\n|\n/)
    .map((line) => line.trim())
    .filter(Boolean);


export function buildDictionaryWordPayload(entry) {
  return {
    word: clean(entry.word),
    phonetic: clean(entry.phonetic),
    pos: clean(entry.pos),
    // Flashcards already display POS separately; keep the saved translation free of duplicate labels.
    translation: entry.englishOnly
      ? ''
      : entry.meanings.map((meaning) => clean(meaning.text)).join('；'),
    definitionEn: clean(entry.definitionEn),
    contextSentence: clean(entry.contextSentence),
    contextSentenceCn: clean(entry.contextSentenceCn),
    tags: ['词典查词'],
    sources: [
      {
        type: 'dictionary',
        id: normalizeDictionaryQuery(entry.word),
        key: `dictionary:${normalizeDictionaryQuery(entry.word)}`,
        label: '英汉词典',
      },
    ],
  };
}

const formLabels = {
  d: '过去式',
  p: '过去分词',
  i: '现在分词',
  3: '第三人称单数',
  r: '比较级',
  t: '最高级',
  s: '复数',
  0: '原形',
};
export function decodeDictionaryRow(row) {
  if (
    !Array.isArray(row) ||
    row.length < 3 ||
    !row.slice(0, 3).every((item) => typeof item === 'string')
  )
    return null;
  const [word, phonetic, translation, definitionEn, exchange, tags] = row;
  if (!clean(word) || !clean(translation)) return null;
  const meanings = lines(translation).map((line) => {
    const match = line.match(/^((?:[a-z]+\.?\s*(?:\/|,)?\s*){1,3})\.\s+(.+)$/i);
    return match
      ? { pos: match[1] + '.', text: match[2] }
      : { pos: '', text: line };
  });
  const forms = clean(exchange)
    .split('/')
    .flatMap((form) => {
      const [code, value] = form.split(':');
      return formLabels[code] && value
        ? value
            .split(',')
            .filter(isDictionaryQuery)
            .map((word) => ({ label: formLabels[code], word }))
        : [];
    });
  return {
    word: clean(word),
    phonetic: phonetic ? `/${phonetic.replace(/^[/[]|[/\]]$/g, '')}/` : '',
    translation: lines(translation).join('\n'),
    definitionEn: lines(definitionEn).join('\n'),
    pos: [
      ...new Set(meanings.map((meaning) => meaning.pos).filter(Boolean)),
    ].join(' / '),
    meanings,
    forms,
    tags: clean(tags).split(' ').filter(Boolean),
    source: 'ECDICT',
    phoneticSource: clean(row[6]) || 'ECDICT',
    dictionaryVersion: DICTIONARY_VERSION,
  };
}

function fromLearningWord(word) {
  if (!word || !clean(word.word) || !clean(word.translation)) return null;
  return {
    word: clean(word.word),
    phonetic: clean(word.phonetic),
    pos: clean(word.pos),
    translation: clean(word.translation),
    definitionEn: clean(word.definitionEn),
    meanings: [{ pos: clean(word.pos), text: clean(word.translation) }],
    forms: [],
    tags: [],
    contextSentence: clean(word.contextSentence),
    contextSentenceCn: clean(word.contextSentenceCn),
    source: '学习词库',
    phoneticSource: '学习词库',
  };
}

function withLearningContext(entry, local) {
  if (!local || entry.aiEnriched) return entry;
  // Some older dictionary senses omit modern meanings such as sustainable transport.
  // Keep the curated example's meaning beside that example, while retaining other senses.
  const meanings = entry.translation.includes(local.translation)
    ? entry.meanings
    : [...local.meanings, ...entry.meanings];
  return {
    ...entry,
    meanings,
    translation: meanings
      .map(
        (meaning) => `${meaning.pos ? meaning.pos + ' ' : ''}${meaning.text}`,
      )
      .join('\n'),
    phonetic: local.phonetic || entry.phonetic,
    phoneticSource: local.phonetic ? '学习词库' : entry.phoneticSource,
    definitionEn: entry.definitionEn || local.definitionEn,
    contextSentence: local.contextSentence || entry.contextSentence,
    contextSentenceCn: local.contextSentenceCn || entry.contextSentenceCn,
  };
}


function editDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= right.length; j += 1) {
      next[j] = Math.min(
        next[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = next;
  }
  return previous[right.length];
}

export function suggestDictionaryWords(words, query, { fuzzy = false } = {}) {
  const key = normalizeDictionaryQuery(query);
  if (key.length < 2) return [];
  const prefix = words
    .filter((word) => word.startsWith(key) && word !== key)
    .slice(0, 6);
  if (!fuzzy || prefix.length >= 6) return prefix;
  const near = words
    .filter(
      (word) =>
        word !== key &&
        !prefix.includes(word) &&
        Math.abs(word.length - key.length) <= 2,
    )
    .map((word) => [word, editDistance(key, word)])
    .filter(([, distance]) => distance <= (key.length > 5 ? 2 : 1))
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  return [...prefix, ...near.map(([word]) => word)].slice(0, 6);
}

export function createDictionaryService({
  baseUrl = import.meta.env?.BASE_URL || '/',
  fetchImpl = (...args) => fetch(...args),
  cacheStorage = globalThis.caches,
} = {}) {
  const shards = new Map();
  const shardUrl = (letter) =>
    `${baseUrl}dictionary/${DICTIONARY_VERSION}/${letter}.json`;
  async function loadShard(letter, signal) {
    if (!LETTERS.includes(letter) || letter.length !== 1) return {};
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (shards.has(letter)) return shards.get(letter);
    let response;
    let cache;
    try {
      cache = await cacheStorage?.open(DICTIONARY_CACHE);
      response = await cache?.match(shardUrl(letter));
    } catch {
      /* Private browsing may disable Cache Storage; normal lookup still works. */
    }
    const validate = async (candidate) => {
      if (!candidate.ok) throw new Error('词库暂时无法加载，请检查网络后重试。已查过的词仍可离线查看。');
      const data = await candidate.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('词库数据无法读取，请重新加载页面。');
      const valid = Object.fromEntries(Object.entries(data).filter(([key, row]) => key.startsWith(letter) && decodeDictionaryRow(row)));
      if (!Object.keys(valid).length) throw new Error('词库数据无法读取，请重新加载页面。');
      return valid;
    };
    let valid;
    let copy;
    if (response) {
      try { copy = response.clone(); valid = await validate(response); }
      catch { await cache?.delete(shardUrl(letter)); response = null; }
    }
    if (!response) {
      const request = createTimedRequest(signal, 15000);
      try {
        response = await fetchImpl(shardUrl(letter), { signal: request.signal });
        copy = response.clone();
        valid = await validate(response);
      } finally { request.cleanup(); }
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    shards.set(letter, valid);
    try {
      await cache?.put(shardUrl(letter), copy);
    } catch {
      /* Cached results are optional. */
    }
    return valid;
  }
  return {
    async lookup(
      query,
      { signal, savedWords = [], storage = globalThis.localStorage } = {},
    ) {
      const key = normalizeDictionaryQuery(query);
      if (!isDictionaryQuery(key))
        throw new Error('请输入英文单词或短语，最多 64 个字符。');
      const cached = readDictionaryState(storage).entries.find(
        (entry) => normalizeDictionaryQuery(entry.word) === key,
      );
      const local = fromLearningWord(
        [...savedWords, ...curated].find(
          (word) => normalizeDictionaryQuery(word.word) === key,
        ),
      );
      if (cached?.dictionaryVersion === DICTIONARY_VERSION) return withLearningContext(cached, local);
      let data;
      try {
        data = await loadShard(key[0], signal);
      } catch (error) {
        if (!signal?.aborted && (cached || local)) return cached ? withLearningContext(cached, local) : local;
        throw error;
      }
      const entry = decodeDictionaryRow(data[key]);
      if (!entry) return cached || local;
      const refreshed = cached ? { ...entry, ...cached, phonetic: entry.phonetic || cached.phonetic, phoneticSource: entry.phoneticSource, dictionaryVersion: DICTIONARY_VERSION } : entry;
      return withLearningContext(refreshed, local);
    },
    async suggest(query, { signal, fuzzy = false } = {}) {
      const key = normalizeDictionaryQuery(query);
      if (!isDictionaryQuery(key) || key.length < 2) return [];
      const data = await loadShard(key[0], signal);
      return suggestDictionaryWords(Object.keys(data), key, { fuzzy });
    },
    async download({ signal, onProgress = () => {} } = {}) {
      if (!cacheStorage) throw new Error('当前浏览器不支持保存离线词库。');
      let completed = 0;
      // Sequential downloads keep the phone responsive and make cancellation predictable.
      for (const letter of LETTERS) {
        const data = await loadShard(letter, signal);
        const cache = await cacheStorage.open(DICTIONARY_CACHE);
        await cache.put(
          shardUrl(letter),
          new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
        completed += 1;
        onProgress(Math.round((completed / LETTERS.length) * 100));
      }
      const cache = await cacheStorage.open(DICTIONARY_CACHE);
      for (const request of await cache.keys()) {
        const url = typeof request === 'string' ? request : request.url;
        if (url.includes('/dictionary/') && !url.includes(`/dictionary/${DICTIONARY_VERSION}/`)) await cache.delete(request);
      }
    },
    async isDownloaded() {
      try {
        const cache = await cacheStorage?.open(DICTIONARY_CACHE);
        return Boolean(
          cache &&
            (
              await Promise.all(
                [...LETTERS].map((letter) => cache.match(shardUrl(letter))),
              )
            ).every(Boolean),
        );
      } catch {
        return false;
      }
    },
  };
}

export async function lookupOnlineDictionary(
  query,
  { signal, fetchImpl = fetch } = {},
) {
  const key = normalizeDictionaryQuery(query);
  if (!isDictionaryQuery(key)) throw new Error('请输入英文单词或短语。');
  const request = createTimedRequest(signal, 12000);
  try {
  const response = await fetchImpl(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`,
    {
      signal: request.signal,
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('在线词典暂时不可用，请稍后再试。');
  const raw = await response.json();
  const entries = Array.isArray(raw) ? raw : [];
  const meanings = entries
    .flatMap((entry) => (Array.isArray(entry?.meanings) ? entry.meanings : []))
    .flatMap((meaning) =>
      (Array.isArray(meaning?.definitions) ? meaning.definitions : []).map(
        (definition) => ({
          pos: clean(meaning.partOfSpeech),
          text: clean(definition?.definition),
          example: clean(definition?.example),
        }),
      ),
    )
    .filter((meaning) => meaning.text)
    .slice(0, 10);
  if (!meanings.length) return null;
  const example = meanings.find((meaning) => meaning.example)?.example || '';
  return {
    word: clean(entries[0]?.word) || key,
    phonetic:
      clean(entries[0]?.phonetic) ||
      entries
        .flatMap((entry) =>
          Array.isArray(entry?.phonetics) ? entry.phonetics : [],
        )
        .map((item) => clean(item?.text))
        .find(Boolean) ||
      '',
    translation: '',
    definitionEn: meanings.map((meaning) => meaning.text).join('\n'),
    pos: [
      ...new Set(meanings.map((meaning) => meaning.pos).filter(Boolean)),
    ].join(' / '),
    meanings,
    forms: [],
    tags: [],
    contextSentence: example,
    source: 'Free Dictionary API',
    englishOnly: true,
  };
  } finally { request.cleanup(); }
}
