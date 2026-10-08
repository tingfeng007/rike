import { GRAMMAR_LESSONS, SENTENCE_BUILDER } from '../data/grammarLessons.js';

export function composeLearningSentence(selections = {}, timeFirst = false) {
  const values = Object.fromEntries(SENTENCE_BUILDER.slots.map((slot) => [slot.id, slot.options.includes(selections[slot.id]) ? selections[slot.id] : '']));
  const part = (text, role) => ({ text, role });
  const parts = [part('I', '主语'), ...(values.frequency ? [part(values.frequency, '频率状语')] : []), part('read', '谓语'), part('a book', '宾语')];
  for (const slot of SENTENCE_BUILDER.slots.filter((item) => item.id !== 'frequency')) {
    if (values[slot.id] && !(slot.id === 'time' && timeFirst)) parts.push(part(values[slot.id], slot.role));
  }
  if (timeFirst && values.time) {
    const text = values.time[0].toUpperCase() + values.time.slice(1);
    parts.unshift(part(`${text},`, '时间状语'));
  }
  return { parts, sentence: `${parts.map((item) => item.text).join(' ')}.`, core: 'I read a book.' };
}

// Authored questions, stable IDs for wrong-answer replay, seeded option positions.
export function buildGrammarLessonQuiz({ topicIds = GRAMMAR_LESSONS.map((item) => item.id), count = 5, seed = '' } = {}) {
  let hash = Array.from(String(seed)).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 17);
  const random = () => { hash = (hash * 1664525 + 1013904223) >>> 0; return hash / 4294967296; };
  const shuffle = (items) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const pool = GRAMMAR_LESSONS.filter((lesson) => topicIds.includes(lesson.id)).flatMap((lesson) => lesson.questions.map((q) => ({ ...q, patternId: lesson.id, topicName: lesson.name })));
  const remaining = shuffle(pool);
  const selected = [];
  // Give a short session more than one mode before filling its remaining slots.
  for (const type of shuffle([...new Set(pool.map((q) => q.type || 'application'))])) {
    if (selected.length >= Math.max(0, count)) break;
    const index = remaining.findIndex((q) => (q.type || 'application') === type);
    if (index >= 0) selected.push(...remaining.splice(index, 1));
  }
  selected.push(...remaining.slice(0, Math.max(0, count - selected.length)));
  return shuffle(selected).map((q) => ({
    id: `lesson:${q.patternId}:${q.id}`, patternId: q.patternId, type: q.type || 'application', hint: q.topicName, highlight: q.highlight || '',
    prompt: q.prompt, answer: String(q.answer), explanation: q.explanation,
    options: shuffle(q.choices.map((label, index) => ({ label, value: String(index) }))),
  }));
}
