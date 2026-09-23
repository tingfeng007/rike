export function getReadingMetrics(content, wordsPerMinute = 180) {
  const wordCount = String(content || '').trim().split(/\s+/).filter(Boolean).length;
  return {
    wordCount,
    minutes: wordCount ? Math.max(1, Math.ceil(wordCount / wordsPerMinute)) : 0,
  };
}

export function filterVocabulary(words, query = '', status = 'all') {
  const normalizedQuery = query.trim().toLowerCase();
  return (words || []).filter((item) => {
    const searchable = [
      item.word,
      item.translation,
      item.userNote,
      item.contextSentence,
      ...(item.tags || []),
      ...(Array.isArray(item.sources) ? item.sources : []).map((source) => source.label || source.id || ''),
    ].filter(Boolean).join(' ').toLowerCase();
    if (normalizedQuery && !searchable.includes(normalizedQuery)) return false;
    if (status === 'all') return true;
    if (status === 'needsMeaning') return !item.translation?.trim();
    if (status === 'hard') return item.tags?.includes('困难词') || (item.easeFactor || 2.5) <= 1.8;
    return item.status === status;
  });
}
