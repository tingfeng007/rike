import { normalizeLookupWord } from './wordHitTest.js';

/** The bundled English dictionary indexes borrowed accents by their plain spelling. */
export function lookupQueryForWord(word) {
  return normalizeLookupWord(word).normalize('NFKD').replace(/\p{Mark}/gu, '').toLowerCase();
}

/** Preserve the source text while identifying individual lookup targets. */
export function tokenizeLookupText(text) {
  const value = typeof text === 'string' ? text : '';
  const tokens = [];
  let cursor = 0;
  const pattern = /[\p{Script=Latin}][\p{Script=Latin}\p{Mark}]*(?:['’\-‐‑][\p{Script=Latin}][\p{Script=Latin}\p{Mark}]*)*/gu;
  for (const match of value.matchAll(pattern)) {
    if (match.index > cursor) tokens.push({ text: value.slice(cursor, match.index), index: cursor });
    const identifier = /[\p{Number}_]/u.test(value[match.index - 1] || '') || /[\p{Number}_]/u.test(value[match.index + match[0].length] || '');
    tokens.push({ text: match[0], word: identifier ? '' : normalizeLookupWord(match[0]), index: match.index });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) tokens.push({ text: value.slice(cursor), index: cursor });
  return tokens;
}
