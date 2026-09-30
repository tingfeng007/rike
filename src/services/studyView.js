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

/**
 * Filter + sort the精读 library.
 *
 * The library used to be a single horizontally scrolling row of titles with no way to search,
 * sort, see difficulty, or tell which articles were finished or half-read.
 *
 * @param {Array} articles
 * @param {{ query?: string, level?: string, status?: 'all'|'unread'|'reading'|'read', sort?: 'recent'|'title'|'progress'|'unfinished' }} [options]
 * @param {(id: unknown) => { readAt?: number, percent?: number }} [getProgress]
 */
export function filterArticles(articles, {
  query = '', level = 'all', status = 'all', sort = 'recent',
} = {}, getProgress = () => ({ readAt: 0, percent: 0 })) {
  const normalizedQuery = query.trim().toLowerCase();
  const progressOf = (id) => {
    const raw = getProgress(id) || {};
    return {
      readAt: Number(raw.readAt) || 0,
      percent: Math.max(0, Math.min(100, Math.round(Number(raw.percent) || 0))),
    };
  };

  const filtered = (articles || []).filter((article) => {
    if (!article) return false;
    if (normalizedQuery) {
      const searchable = [
        article.title,
        article.level,
        ...(Array.isArray(article.tags) ? article.tags : []),
      ].filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(normalizedQuery)) return false;
    }
    if (level !== 'all' && (article.level || '') !== level) return false;

    const { readAt, percent } = progressOf(article.id);
    if (status === 'unread') return !readAt && percent === 0;
    if (status === 'reading') return percent > 0 && percent < 100;
    if (status === 'read') return Boolean(readAt) && percent >= 100;
    return true;
  });

  const sorted = [...filtered];
  const recency = (article) => Number(article.createdAt || article.updatedAt || 0);

  if (sort === 'title') {
    sorted.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN'));
  } else if (sort === 'progress') {
    sorted.sort((a, b) => progressOf(b.id).percent - progressOf(a.id).percent || recency(b) - recency(a));
  } else if (sort === 'unfinished') {
    // Half-read articles first, then the furthest along, so "continue reading" is on top.
    sorted.sort((a, b) => {
      const left = progressOf(a.id).percent;
      const right = progressOf(b.id).percent;
      const leftOpen = left > 0 && left < 100 ? 0 : 1;
      const rightOpen = right > 0 && right < 100 ? 0 : 1;
      if (leftOpen !== rightOpen) return leftOpen - rightOpen;
      if (left !== right) return right - left;
      return recency(b) - recency(a);
    });
  } else {
    sorted.sort((a, b) => recency(b) - recency(a));
  }

  return sorted;
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
