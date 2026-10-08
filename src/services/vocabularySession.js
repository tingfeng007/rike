import { VOCABULARY_CATEGORIES } from '../data/categoryVocabulary.js';

const text = (value) => typeof value === 'string' ? value : '';
function normalizeCard(raw) {
  if (!raw || typeof raw !== 'object' || !text(raw.word).trim() || !text(raw.id).trim()) return null;
  const result = { ...raw, id: raw.id, word: raw.word.trim() };
  for (const field of ['phonetic', 'pos', 'translation', 'definitionEn', 'contextSentence', 'contextSentenceCn', 'userNote', 'learningSense']) result[field] = text(raw[field]);
  result.tags = Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === 'string') : [];
  result.collocations = Array.isArray(raw.collocations) ? raw.collocations.filter((phrase) => typeof phrase === 'string') : [];
  result.sources = Array.isArray(raw.sources) ? raw.sources.filter((source) => source && typeof source === 'object' && typeof source.type === 'string').map((source) => ({ ...source, id: String(source.id || ''), label: text(source.label), key: text(source.key) })) : [];
  result.reviewCount = Number.isInteger(raw.reviewCount) && raw.reviewCount >= 0 ? raw.reviewCount : 0;
  result.intervalDays = Number.isFinite(raw.intervalDays) && raw.intervalDays >= 0 ? raw.intervalDays : 1;
  result.easeFactor = Number.isFinite(raw.easeFactor) && raw.easeFactor >= 1 ? raw.easeFactor : 2.5;
  result.level = ['starter', 'core', 'advanced'].includes(raw.level) ? raw.level : 'core';
  return result.translation.trim() ? result : null;
}

export function restoreVocabularySession(raw, { vocabulary = [], categories = VOCABULARY_CATEGORIES } = {}) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const selectedCategory = input.selectedCategory === 'personal' || categories.some((category) => category.id === input.selectedCategory) ? input.selectedCategory : 'personal';
  const validStored = (Array.isArray(vocabulary) ? vocabulary : []).map(normalizeCard).filter(Boolean);
  const storedById = new Map(validStored.map((word) => [word.id, word]));
  const inputIndex = Number.isInteger(input.currentIndex) && input.currentIndex >= 0 ? input.currentIndex : 0;
  const repeats = new Map();
  const normalized = (Array.isArray(input.dueCards) ? input.dueCards : []).slice(0, 1000).map((card, index) => {
    const value = selectedCategory === 'personal' ? storedById.get(card?.id) : normalizeCard(card);
    if (!value) return null;
    const count = repeats.get(value.id) || 0;
    if (count >= 2) return null;
    repeats.set(value.id, count + 1);
    return { value, index };
  }).filter(Boolean);
  const dueCards = normalized.map((entry) => entry.value);
  const currentIndex = Math.min(normalized.filter((entry) => entry.index < inputIndex).length, Math.max(0, dueCards.length - 1));
  const learningMode = input.learningMode === 'spelling' ? 'spelling' : 'recall';
  const spellingAnswer = text(input.spellingAnswer);
  const spellingChecked = input.spellingChecked === true && Boolean(spellingAnswer.trim());
  const requeuedIds = new Set(Array.isArray(input.requeuedIds) ? input.requeuedIds.filter((id) => typeof id === 'string' && repeats.has(id)) : []);
  for (const [id, count] of repeats) if (count > 1) requeuedIds.add(id);
  return { activeTab: ['flashcard', 'list', 'quiz'].includes(input.activeTab) ? input.activeTab : 'flashcard', selectedCategory,
    selectedLevel: ['starter', 'core', 'advanced'].includes(input.selectedLevel) ? input.selectedLevel : 'all',
    dueCards, currentIndex, learningMode, spellingAnswer, spellingChecked,
    isFlipped: input.isFlipped === true && (learningMode !== 'spelling' || spellingChecked),
    reviewCompleted: input.reviewCompleted === true && dueCards.length > 0, requeuedIds: [...requeuedIds] };
}

export function matchesVocabularySpelling(answer, word) {
  const normalize = (value) => text(value).trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
  return Boolean(normalize(answer)) && normalize(answer) === normalize(word);
}

/** Content occurrence keys stay stable when a distinct option or paragraph is inserted. */
export function keyedVocabularyText(values) {
  const occurrences = new Map();
  return (Array.isArray(values) ? values : []).map((value, index) => {
    const content = text(value);
    const occurrence = (occurrences.get(content) || 0) + 1;
    occurrences.set(content, occurrence);
    return { text: content, index, key: `${content}:${occurrence}` };
  });
}
