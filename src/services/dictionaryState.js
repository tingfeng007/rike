const STATE_KEY = 'lingoflow_dictionary_v1';
const clean = (value) => typeof value === 'string' ? value.trim() : '';

export function normalizeDictionaryQuery(value) {
  return clean(value).replace(/[‘’]/g, "'").replace(/\s+/g, ' ').toLowerCase();
}

export function isDictionaryQuery(value) {
  return /^[a-z][a-z '.-]{0,63}$/i.test(normalizeDictionaryQuery(value));
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
