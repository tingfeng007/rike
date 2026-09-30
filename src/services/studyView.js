export function getReadingMetrics(content, wordsPerMinute = 180) {
  const wordCount = String(content || '').trim().split(/\s+/).filter(Boolean).length;
  return {
    wordCount,
    minutes: wordCount ? Math.max(1, Math.ceil(wordCount / wordsPerMinute)) : 0,
  };
}

/**
 * Human-readable description of when a card is next due.
 *
 * The vocabulary screens only showed "间隔: N 天", which is the scheduling *input* — never
 * the date. Users could not answer "when will this come back?" at all.
 *
 * @param {number} nextReviewDate epoch ms
 * @param {number} [now] injectable clock for tests
 * @returns {string} e.g. '今天到期' | '明天' | '3 天后' | '10月3日' | '已到期'
 */
export function formatDueDate(nextReviewDate, now = Date.now()) {
  const timestamp = Number(nextReviewDate);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '待安排';

  const startOfDay = (value) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };

  const days = Math.round((startOfDay(timestamp) - startOfDay(now)) / 86400000);
  if (days < 0) return '已到期';
  if (days === 0) return '今天到期';
  if (days === 1) return '明天';
  if (days <= 30) return `${days} 天后`;

  const due = new Date(timestamp);
  const sameYear = due.getFullYear() === new Date(now).getFullYear();
  const stamp = `${due.getMonth() + 1}月${due.getDate()}日`;
  return sameYear ? stamp : `${due.getFullYear()}年${stamp}`;
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
