export function dueVocabulary(words, now = Date.now()) {
  return words.filter((word) => !word.nextReviewDate || word.nextReviewDate <= now + 3600000)
    .sort((a, b) => (a.nextReviewDate || 0) - (b.nextReviewDate || 0)
      || Number(b.tags?.includes('困难词')) - Number(a.tags?.includes('困难词'))
      || (a.lastReviewedAt || 0) - (b.lastReviewedAt || 0));
}

export function selectReviewSession(words, { wordIds, size = 20, now = Date.now() } = {}) {
  if (wordIds?.length) {
    const byId = new Map(words.map((word) => [word.id, word]));
    return wordIds.map((id) => byId.get(id)).filter(Boolean);
  }
  const due = dueVocabulary(words, now);
  return size === 'all' ? due : due.slice(0, size);
}
