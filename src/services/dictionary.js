import { VOCABULARY_CATEGORIES } from '../data/categoryVocabulary.js';
import { DEFAULT_SAMPLE_WORDS } from '../data/samples.js';

export const DICTIONARY_VERSION = 'ecdict-bc015ed-v1';
export const DICTIONARY_WORD_COUNT = 59136;
export const DICTIONARY_CACHE = 'lingoflow-dictionary-v1';
const STATE_KEY = 'lingoflow_dictionary_v1';
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

export function normalizeDictionaryQuery(value) {
  return clean(value).replace(/[‘’]/g, "'").replace(/\s+/g, ' ').toLowerCase();
}

export function isDictionaryQuery(value) {
  return /^[a-z][a-z '.-]{0,63}$/i.test(normalizeDictionaryQuery(value));
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
    definitionEn: entry.definitionEn || local.definitionEn,
    contextSentence: local.contextSentence || entry.contextSentence,
    contextSentenceCn: local.contextSentenceCn || entry.contextSentenceCn,
  };
}

export function readDictionaryState(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem(STATE_KEY) || '{}');
    const history = Array.isArray(raw?.history)
      ? raw.history.filter(isDictionaryQuery).slice(0, 12)
      : [];
    const entries = Array.isArray(raw?.entries)
      ? raw.entries
          .filter(
            (item) =>
              item &&
              isDictionaryQuery(item.word) &&
              typeof item.translation === 'string' &&
              (item.translation ||
                (item.englishOnly && clean(item.definitionEn))) &&
              Array.isArray(item.meanings) &&
              item.meanings.every(
                (meaning) => typeof meaning?.text === 'string',
              ) &&
              Array.isArray(item.forms) &&
              item.forms.every(
                (form) =>
                  typeof form?.word === 'string' &&
                  typeof form?.label === 'string',
              ),
          )
          .slice(0, 40)
          .map((item) => ({
            ...item,
            word: clean(item.word),
            phonetic: clean(item.phonetic),
            pos: clean(item.pos),
            definitionEn: clean(item.definitionEn),
            contextSentence: clean(item.contextSentence),
            contextSentenceCn: clean(item.contextSentenceCn),
            memoryTip: clean(item.memoryTip),
            source: clean(item.source),
            meanings: item.meanings.map((meaning) => ({
              pos: clean(meaning.pos),
              text: clean(meaning.text),
            })),
            tags: Array.isArray(item.tags)
              ? item.tags.filter((tag) => typeof tag === 'string')
              : [],
            collocations: Array.isArray(item.collocations)
              ? item.collocations.filter((text) => typeof text === 'string')
              : [],
          }))
      : [];
    return { history, entries };
  } catch {
    return { history: [], entries: [] };
  }
}

export function rememberDictionaryEntry(
  entry,
  storage = globalThis.localStorage,
) {
  const state = readDictionaryState(storage);
  const key = normalizeDictionaryQuery(entry.word);
  const next = {
    history: [key, ...state.history.filter((word) => word !== key)].slice(
      0,
      12,
    ),
    entries: [
      entry,
      ...state.entries.filter(
        (word) => normalizeDictionaryQuery(word.word) !== key,
      ),
    ].slice(0, 40),
  };
  // Leave room for the user's flashcards and articles, even for unusually long entries.
  while (JSON.stringify(next).length > 300000 && next.entries.length > 1)
    next.entries.pop();
  try {
    storage?.setItem(STATE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function clearDictionaryHistory(storage = globalThis.localStorage) {
  const state = readDictionaryState(storage);
  try {
    storage?.setItem(STATE_KEY, JSON.stringify({ ...state, history: [] }));
    return true;
  } catch {
    return false;
  }
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
    if (!response) {
      response = await fetchImpl(shardUrl(letter), {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new Error(
          '词库暂时无法加载，请检查网络后重试。已查过的词仍可离线查看。',
        );
    }
    const copy = response.clone();
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('词库数据无法读取，请重新加载页面。');
    const valid = Object.fromEntries(
      Object.entries(data).filter(
        ([key, row]) => key.startsWith(letter) && decodeDictionaryRow(row),
      ),
    );
    if (!Object.keys(valid).length)
      throw new Error('词库数据无法读取，请重新加载页面。');
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
      if (cached) return withLearningContext(cached, local);
      let data;
      try {
        data = await loadShard(key[0], signal);
      } catch (error) {
        if (local && !signal?.aborted) return local;
        throw error;
      }
      const entry = decodeDictionaryRow(data[key]);
      if (!entry) return local;
      return withLearningContext(entry, local);
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
  const response = await fetchImpl(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`,
    {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000),
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
}
