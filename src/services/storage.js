import { DEFAULT_SAMPLE_WORDS, DEFAULT_SAMPLE_ARTICLES } from '../data/samples.js';
export { DEFAULT_SAMPLE_WORDS, DEFAULT_SAMPLE_ARTICLES } from '../data/samples.js';
// LocalStorage keys
import { applyGrammarAnswer } from './grammar.js';

const STORAGE_KEYS = {
  SETTINGS: 'lingoflow_settings',
  VOCABULARY: 'lingoflow_vocabulary',
  CHAT_MESSAGES: 'lingoflow_chat_messages',
  ARTICLES: 'lingoflow_articles',
  STUDY_STATS: 'lingoflow_study_stats',
  READING_ANNOTATIONS: 'lingoflow_reading_annotations',
  ARTICLE_READ_STATE: 'lingoflow_article_read_state_v1',
  ONBOARDING: 'lingoflow_onboarding_v1',
  GRAMMAR: 'lingoflow_grammar_v1',
  NCE_PROGRESS: 'lingoflow_nce1_progress',
  NCE_CACHE: 'lingoflow_nce1_cache_v1',
  NCE_EXAMS: 'lingoflow_nce1_exams_v1',
  APP_STATE: 'lingoflow_app_state',
  STUDY_EVENTS: 'lingoflow_study_events_v1',
  STUDY_PLAN: 'lingoflow_study_plan_v1',
  SCHEMA_VERSION: 'lingoflow_schema_version',
  VOCABULARY_LEGACY_BACKUP: 'lingoflow_vocabulary_legacy_backup',
  SAMPLE_MIGRATION: 'lingoflow_sample_migration_v2',
};

// Reading scroll position is stored per article under this prefix.
const READ_POSITION_PREFIX = 'lingoflow_read_pos_';

const STORAGE_SCHEMA_VERSION = 3;

// Upper bound for a single review interval. Without it the multiplicative growth of
// "good" answers scheduled a card ~3800 days out, i.e. beyond any practical horizon.
export const MAX_INTERVAL_DAYS = 365;

// Reason of the most recent failed write. Surfaced through getStorageDiagnostics /
// getLastWriteError so a full disk or blocked storage is never silent.
let lastWriteError = null;

// Monotonic failure counter. importAllData is fully synchronous, so comparing this
// before/after a run reliably detects that some write was dropped (and triggers rollback).
let writeFailureCount = 0;

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    lastWriteError = null;
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('lingoflow:storage', { detail: { key } }));
    }
    return true;
  } catch (error) {
    writeFailureCount += 1;
    lastWriteError = {
      key,
      name: error?.name || 'Error',
      quotaExceeded: error?.name === 'QuotaExceededError',
      message: error?.message || '本地存储写入失败',
    };
    return false;
  }
}

// Shape guards. A corrupted stored value ("null", a bare string, an object where an
// array is expected) must never reach component render code as null/undefined:
// App.jsx calls these getters inside useState initializers, outside the ErrorBoundary.
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

// The sample decks are module-level constants. Never hand them out by reference:
// callers do `words.unshift(...)` / `list.unshift(...)`, which would corrupt the
// seed data for the rest of the session.
function copySampleWords() {
  return DEFAULT_SAMPLE_WORDS.map((word) => ({ ...word }));
}

function copySampleArticles() {
  return DEFAULT_SAMPLE_ARTICLES.map((article) => ({ ...article }));
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateKeyToDayNumber(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / (24 * 60 * 60 * 1000));
}

// Preset providers
export const PROVIDER_PRESETS = {
  deepseek: {
    name: 'DeepSeek (推荐·高性价比)',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    helpUrl: 'https://platform.deepseek.com',
  },
  siliconflow: {
    name: '硅基流动 (SiliconFlow)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'meta-llama/Meta-Llama-3.1-8B-Instruct'],
    helpUrl: 'https://cloud.siliconflow.cn',
  },
  openai: {
    name: 'OpenAI (官方)',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
    helpUrl: 'https://platform.openai.com',
  },
  moonshot: {
    name: '月之暗面 (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k'],
    helpUrl: 'https://platform.moonshot.cn',
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.0-flash-001',
    models: ['google/gemini-2.0-flash-001', 'deepseek/deepseek-chat', 'anthropic/claude-3.5-haiku'],
    helpUrl: 'https://openrouter.ai',
  },
  custom: {
    name: '自定义接口 (兼容OpenAI格式)',
    baseUrl: '',
    defaultModel: '',
    models: [],
    helpUrl: '',
  },
};

// Default Settings
export const DEFAULT_SETTINGS = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  voiceRate: 0.95,
  voicePitch: 1.05,
  voiceAccent: 'en-US',
  preferredVoiceURI: '',
  // Non-course speech can prefer higher-quality browser voices or an optional
  // OpenAI-compatible neural TTS endpoint. New Concept lesson audio remains
  // controlled by the course player and passes an explicit course channel.
  speechMode: 'natural',
  speechApiKey: '',
  speechBaseUrl: 'https://api.openai.com/v1',
  speechModel: 'gpt-4o-mini-tts',
  speechVoice: 'coral',
  speechInstructions: 'Warm, natural English tutor voice. Clear articulation, gentle pauses, and a friendly conversational tone.',
  autoPlayOralAudio: true,
  currentScenarioId: 'daily_chat',
};

export const StorageService = {
  ensureSchema() {
    try {
      const rawVersion = localStorage.getItem(STORAGE_KEYS.SCHEMA_VERSION);
      const parsedVersion = Number(rawVersion);
      // A non-numeric marker ("abc") previously made every comparison false, which
      // permanently blocked migrations while still reporting the newest version.
      const current = Number.isFinite(parsedVersion) ? parsedVersion : 0;
      if (current < 1) {
        if (localStorage.getItem(STORAGE_KEYS.STUDY_EVENTS) == null) safeSetItem(STORAGE_KEYS.STUDY_EVENTS, '[]');
        if (localStorage.getItem(STORAGE_KEYS.STUDY_PLAN) == null) safeSetItem(STORAGE_KEYS.STUDY_PLAN, '{}');
      }
      // Explicit, one-time data migration. This used to run inside the getVocabulary()
      // read path, where it could silently overwrite a user's own words.
      this.migrateLegacySampleData();
      if (current < STORAGE_SCHEMA_VERSION) {
        safeSetItem(STORAGE_KEYS.SCHEMA_VERSION, String(STORAGE_SCHEMA_VERSION));
      }
      return STORAGE_SCHEMA_VERSION;
    } catch {
      return 0;
    }
  },

  /**
   * One-time upgrade of the legacy demo decks (3 words / 2 articles) to the enriched
   * samples. Guard rails, in contrast to the previous read-path behaviour:
   *  - runs once, marked by STORAGE_KEYS.SAMPLE_MIGRATION;
   *  - only touches a deck that consists *entirely* of legacy sample entries,
   *    so any user-created word makes the migration a no-op;
   *  - copies the replaced value to STORAGE_KEYS.VOCABULARY_LEGACY_BACKUP first;
   *  - never runs from a getter.
   * @returns {boolean} whether a replacement happened
   */
  migrateLegacySampleData() {
    try {
      if (localStorage.getItem(STORAGE_KEYS.SAMPLE_MIGRATION)) return false;
      let migrated = false;

      const rawVocabulary = localStorage.getItem(STORAGE_KEYS.VOCABULARY);
      if (rawVocabulary) {
        const parsed = JSON.parse(rawVocabulary);
        const onlyLegacySamples = Array.isArray(parsed) && parsed.length > 0
          && parsed.every((word) => word && typeof word.id === 'string' && /^sample_\d+$/.test(word.id));
        if (onlyLegacySamples && parsed.length < DEFAULT_SAMPLE_WORDS.length) {
          safeSetItem(STORAGE_KEYS.VOCABULARY_LEGACY_BACKUP, rawVocabulary);
          this.saveVocabulary(copySampleWords());
          migrated = true;
        }
      }

      const rawArticles = localStorage.getItem(STORAGE_KEYS.ARTICLES);
      if (rawArticles) {
        const parsed = JSON.parse(rawArticles);
        const onlyLegacySamples = Array.isArray(parsed) && parsed.length > 0
          && parsed.every((article) => article && typeof article.id === 'string' && /^art_\d+$/.test(article.id));
        if (onlyLegacySamples && parsed.length < DEFAULT_SAMPLE_ARTICLES.length) {
          this.saveArticles(copySampleArticles());
          migrated = true;
        }
      }

      safeSetItem(STORAGE_KEYS.SAMPLE_MIGRATION, 'done');
      return migrated;
    } catch {
      return false;
    }
  },

  getSchemaVersion() {
    try {
      return Number(localStorage.getItem(STORAGE_KEYS.SCHEMA_VERSION) || 0);
    } catch {
      return 0;
    }
  },

  // --- App navigation state ---
  getAppState() {
    return asObject(readJson(STORAGE_KEYS.APP_STATE, {}));
  },

  saveAppState(state) {
    return safeSetItem(STORAGE_KEYS.APP_STATE, JSON.stringify(state || {}));
  },

  // --- Settings ---
  getSettings() {
    // Always merge onto a fresh copy: callers must not be able to mutate DEFAULT_SETTINGS.
    return { ...DEFAULT_SETTINGS, ...asObject(readJson(STORAGE_KEYS.SETTINGS, {})) };
  },

  saveSettings(settings) {
    return safeSetItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  },

  // --- Last write failure (quota / blocked storage) ---
  getLastWriteError() {
    return lastWriteError ? { ...lastWriteError } : null;
  },

  // --- Demo / sample data ---------------------------------------------------------------
  // On a fresh install both decks are served from memory without being written to disk, so
  // "the key is absent" is exactly "the user is still looking at demo content". The app had no
  // way to say that: the home screen reported "今日到期词 30" and the due badge showed 30 as if
  // the learner had built that deck, while the settings page called the same words 演示生词.
  isUsingSampleData() {
    try {
      return localStorage.getItem(STORAGE_KEYS.VOCABULARY) === null
        || localStorage.getItem(STORAGE_KEYS.ARTICLES) === null;
    } catch {
      return false;
    }
  },

  isUsingSampleVocabulary() {
    try {
      return localStorage.getItem(STORAGE_KEYS.VOCABULARY) === null;
    } catch {
      return false;
    }
  },

  /**
   * Replace the in-memory demo decks with real (empty) ones, so the learner starts from zero.
   * Writing `[]` matters: `getVocabulary()` falls back to the demo deck whenever the key is
   * absent, so merely "not saving" would bring the samples straight back.
   */
  clearSampleData({ keepArticles = false } = {}) {
    const wordsSaved = this.saveVocabulary([]);
    const articlesSaved = keepArticles || this.saveArticles([]);
    return Boolean(wordsSaved && articlesSaved);
  },

  getOnboardingState() {
    return asObject(readJson(STORAGE_KEYS.ONBOARDING, {}));
  },

  saveOnboardingState(state) {
    return safeSetItem(STORAGE_KEYS.ONBOARDING, JSON.stringify(asObject(state) || {}));
  },

  markOnboardingSeen(key) {
    if (!key) return false;
    const state = this.getOnboardingState();
    state[key] = Date.now();
    return this.saveOnboardingState(state);
  },

  hasSeenOnboarding(key) {
    if (!key) return false;
    return Boolean(this.getOnboardingState()[key]);
  },

  // --- Grammar (语法) ---
  // Shape: { answers: { [patternId]: { correct, total } }, missed: [...], accuracy, ... }
  // The progression maths lives in services/grammar.js (pure, unit-tested); this only persists.
  getGrammarProgress() {
    const stored = asObject(readJson(STORAGE_KEYS.GRAMMAR, {}));
    return {
      answers: asObject(stored.answers),
      missed: Array.isArray(stored.missed) ? stored.missed : [],
      totalAnswered: Number(stored.totalAnswered) || 0,
      totalCorrect: Number(stored.totalCorrect) || 0,
      accuracy: Number(stored.accuracy) || 0,
      updatedAt: Number(stored.updatedAt) || 0,
    };
  },

  saveGrammarProgress(progress) {
    return safeSetItem(STORAGE_KEYS.GRAMMAR, JSON.stringify(asObject(progress) || {}));
  },

  /** Merge one answered question into the stored progress. Returns null when the write failed. */
  recordGrammarAnswer(entry) {
    const next = applyGrammarAnswer(this.getGrammarProgress(), entry);
    return this.saveGrammarProgress(next) ? next : null;
  },

  // --- Vocabulary ---
  getVocabulary() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEYS.VOCABULARY);
    } catch {
      return [];
    }
    // Key absent = first run: hand back a copy of the demo deck, but do not persist it.
    if (raw === null) return copySampleWords();
    try {
      const parsed = JSON.parse(raw);
      // Pure read: a corrupted or wrongly-shaped value returns an empty deck and is
      // left untouched on disk (never overwritten by the demo deck).
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  saveVocabulary(words) {
    return safeSetItem(STORAGE_KEYS.VOCABULARY, JSON.stringify(words));
  },

  addWord(wordObj) {
    const word = typeof wordObj?.word === 'string' ? wordObj.word.trim() : '';
    if (!word) return null;
    const words = this.getVocabulary();
    const existingIndex = words.findIndex(
      (w) => typeof w?.word === 'string' && w.word.toLowerCase() === word.toLowerCase()
    );

    const now = Date.now();
    const newEntry = {
      id: wordObj.id || `w_${now}_${Math.random().toString(36).slice(2, 7)}`,
      word: wordObj.word.trim(),
      phonetic: wordObj.phonetic || '',
      pos: wordObj.pos || '',
      translation: wordObj.translation || '',
      definitionEn: wordObj.definitionEn || '',
      contextSentence: wordObj.contextSentence || '',
      contextSentenceCn: wordObj.contextSentenceCn || '',
      createdAt: now,
      nextReviewDate: now,
      intervalDays: 1,
      step: 0,
      easeFactor: 2.5,
      reviewCount: 0,
      status: 'learning', // 'learning' | 'review' | 'mastered'
      tags: wordObj.tags || ['自学收集'],
      sources: Array.isArray(wordObj.sources) ? wordObj.sources : [],
      lastEncounteredAt: now,
    };

    if (existingIndex >= 0) {
      const existing = words[existingIndex];
      const mergedTags = Array.from(new Set([...(existing.tags || []), ...(wordObj.tags || [])]));
      const sourceMap = new Map((existing.sources || []).map((source) => [source.key || `${source.type}:${source.id}`, source]));
      (wordObj.sources || []).forEach((source) => {
        if (!source || typeof source !== 'object') return;
        sourceMap.set(source.key || `${source.type || 'source'}:${source.id || source.label || source.key}`, source);
      });
      words[existingIndex] = {
        ...existing,
        phonetic: existing.phonetic || newEntry.phonetic,
        pos: existing.pos || newEntry.pos,
        translation: existing.translation || newEntry.translation,
        definitionEn: existing.definitionEn || newEntry.definitionEn,
        contextSentence: existing.contextSentence || newEntry.contextSentence,
        contextSentenceCn: existing.contextSentenceCn || newEntry.contextSentenceCn,
        tags: mergedTags.length ? mergedTags : ['自学收集'],
        sources: [...sourceMap.values()],
        lastEncounteredAt: now,
      };
    } else {
      words.unshift(newEntry);
    }

    const saved = this.saveVocabulary(words);
    return saved ? (existingIndex >= 0 ? words[existingIndex] : newEntry) : null;
  },

  updateWordSRS(wordId, quality) {
    // quality: 'again' | 'hard' | 'good'
    const words = this.getVocabulary();
    const index = words.findIndex((w) => w.id === wordId);
    if (index === -1) return null;

    const word = words[index];
    const now = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    let newStep = word.step || 0;
    let newInterval = word.intervalDays || 1;
    let newEase = word.easeFactor || 2.5;
    let newStatus = 'learning';

    // Three-grade adaptive interval heuristic (again / hard / good).
    // NOTE: this is *not* the standard SuperMemo SM-2 EF formula
    // (EF' = EF + (0.1 - (5-q)*(0.08 + (5-q)*0.02))); the deltas below are fixed steps.
    // The three grades and the ease deltas are intentionally unchanged — rewriting them
    // would change the user's real review load. Only the pathologies below were fixed:
    //   1. intervals could grow without bound (9x "good" reached ~3800 days → the word
    //      effectively disappeared), now capped by MAX_INTERVAL_DAYS;
    //   2. "hard" on a 1-day card computed max(1, round(1*1.2)) = 1, so the card stayed
    //      due every single day forever, now it always advances by at least a day.
    const capInterval = (days) => Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(days)));

    // "again" means the word is due for relearning *today*, not tomorrow. The UI promises
    // exactly that ("已自动重置加入今日待复习闪卡队伍" / "重头复习"), and the product plan
    // (P0_P1_IMPROVEMENT_PLAN 任务 3) required it; the previous code pushed the due date a
    // full day out, so a forgotten word silently skipped the current session.
    let dueNow = false;

    if (quality === 'again') {
      newStep = 0;
      newInterval = 1;
      newStatus = 'learning';
      dueNow = true;
      // Penalize ease factor for forgotten word (floor at 1.3)
      newEase = Math.max(1.3, Number((newEase - 0.2).toFixed(2)));
    } else if (quality === 'hard') {
      // Step is deliberately left unchanged: "hard" is not a success, but demoting it
      // would send a known-but-difficult word back to the daily ladder and inflate the
      // daily workload. (The previous `Math.max(0, newStep)` here was a no-op.)
      newInterval = capInterval(Math.max(newInterval + 1, newInterval * 1.2));
      newStatus = 'review';
      // Slight ease penalty for difficult word
      newEase = Math.max(1.3, Number((newEase - 0.15).toFixed(2)));
    } else if (quality === 'good') {
      newStep += 1;
      // Reward ease factor for mastered word (cap at 2.8)
      newEase = Math.min(2.8, Number((newEase + 0.1).toFixed(2)));

      if (newStep === 1) {
        newInterval = 1;
        newStatus = 'learning';
      } else if (newStep === 2) {
        newInterval = 3;
        newStatus = 'review';
      } else if (newStep >= 5) {
        newInterval = capInterval(newInterval * newEase);
        newStatus = 'mastered';
      } else {
        newInterval = capInterval(newInterval * newEase);
        newStatus = 'review';
      }
    }

    const updated = {
      ...word,
      step: newStep,
      intervalDays: newInterval,
      easeFactor: newEase,
      status: newStatus,
      reviewCount: (word.reviewCount || 0) + 1,
      lastReviewedAt: now,
      // dueNow keeps intervalDays as the "next interval to apply" while making the card
      // immediately due again (it re-enters today's queue instead of disappearing).
      nextReviewDate: dueNow ? now : now + newInterval * ONE_DAY_MS,
      tags: (() => {
        const tags = new Set(word.tags || []);
        if (quality === 'again' || quality === 'hard') tags.add('困难词');
        if (quality === 'good' && newStep >= 2) tags.delete('困难词');
        return [...tags];
      })(),
    };

    words[index] = updated;
    // Do not report a scheduling advance that never reached disk: a failed write used
    // to be swallowed, so the UI showed "reviewed" while storage kept the old card.
    const saved = this.saveVocabulary(words);
    return saved ? updated : null;
  },

  updateWord(wordId, updatedFields) {
    const words = this.getVocabulary();
    const index = words.findIndex((w) => w.id === wordId);
    if (index === -1) return null;
    words[index] = { ...words[index], ...updatedFields };
    // Report a dropped write instead of pretending the edit was saved.
    return this.saveVocabulary(words) ? words[index] : null;
  },

  /**
   * Undo a single flashcard rating.
   *
   * Restores the word exactly as it was before the rating, puts the study counters back,
   * and removes the review event that was recorded for it — otherwise "undo" would leave
   * inflated stats/streak/calendar entries behind.
   *
   * @param {{ snapshot?: object, previousStats?: object, entityId?: string }} options
   * @returns {boolean} whether the word itself was restored (the meaningful part)
   */
  revertReview({ snapshot, previousStats, entityId } = {}) {
    let restoredWord = false;

    if (snapshot && snapshot.id) {
      const words = this.getVocabulary();
      const index = words.findIndex((w) => w.id === snapshot.id);
      if (index !== -1) {
        words[index] = { ...snapshot };
        restoredWord = this.saveVocabulary(words) === true;
      }
    }

    if (previousStats && typeof previousStats === 'object') {
      this.saveStudyStats(previousStats);
    }

    if (entityId) {
      try {
        const events = this.getStudyEvents({ limit: 2000 });
        for (let i = events.length - 1; i >= 0; i -= 1) {
          if (events[i].type === 'review' && events[i].entityId === entityId) {
            events.splice(i, 1);
            safeSetItem(STORAGE_KEYS.STUDY_EVENTS, JSON.stringify(events));
            break;
          }
        }
      } catch {
        // Undoing the word is what matters; a stale event is not worth failing the undo.
      }
    }

    return restoredWord;
  },

  // --- Study Habit & Streak Stats 2.0 (Multi-module activity tracker) ---
  getStudyStats() {
    const todayStr = getLocalDateKey();
    const defaultStats = {
      streakDays: 0,
      lastActiveDate: '',
      todayReviewedCount: 0,
      todayOralCount: 0,
      todayAnnotationCount: 0,
      todayCourseCount: 0,
      todayVocabCount: 0,
      todayTotalActions: 0,
      totalReviewedCount: 0,
    };

    try {
      const data = localStorage.getItem(STORAGE_KEYS.STUDY_STATS);
      if (!data) return defaultStats;

      const stats = { ...defaultStats, ...asObject(readJson(STORAGE_KEYS.STUDY_STATS, {})) };

      // If opening on a new day, reset today's counters
      if (stats.lastActiveDate !== todayStr) {
        return {
          ...stats,
          todayReviewedCount: 0,
          todayOralCount: 0,
          todayAnnotationCount: 0,
          todayCourseCount: 0,
          todayVocabCount: 0,
          todayTotalActions: 0,
        };
      }
      return stats;
    } catch {
      return defaultStats;
    }
  },

  saveStudyStats(stats) {
    return safeSetItem(STORAGE_KEYS.STUDY_STATS, JSON.stringify(stats));
  },

  getStudyEvents({ since = 0, limit = 2000 } = {}) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.STUDY_EVENTS) || '[]');
      if (!Array.isArray(saved)) return [];
      return saved
        .filter((event) => event && typeof event === 'object' && (!since || (event.at || 0) >= since))
        .sort((a, b) => (a.at || 0) - (b.at || 0))
        .slice(-Math.max(1, limit));
    } catch {
      return [];
    }
  },

  recordStudyEvent({
    type = 'review',
    count = 1,
    durationMinutes = 0,
    source = '',
    entityId = '',
    label = '',
    metadata = {},
  } = {}) {
    const event = {
      id: `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      count: Math.max(1, Number(count) || 1),
      durationMinutes: Math.max(0, Number(durationMinutes) || 0),
      source,
      entityId,
      label,
      durationKind: durationMinutes > 0 ? 'measured' : 'none',
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      at: Date.now(),
    };
    const events = [...this.getStudyEvents({ limit: 2000 }), event].slice(-2000);
    return safeSetItem(STORAGE_KEYS.STUDY_EVENTS, JSON.stringify(events)) ? event : null;
  },

  getStudyPlan() {
    return asObject(readJson(STORAGE_KEYS.STUDY_PLAN, {}));
  },

  saveStudyPlan(plan) {
    return safeSetItem(STORAGE_KEYS.STUDY_PLAN, JSON.stringify(plan || {}));
  },

  getStudyOverview(days = 7) {
    const since = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;
    const events = this.getStudyEvents({ since });
    const byType = {};
    const byDay = {};
    const byDayMinutes = {};
    events.forEach((event) => {
      if (event.source !== 'daily-plan') byType[event.type] = (byType[event.type] || 0) + (event.count || 1);
      const date = getLocalDateKey(new Date(event.at || 0));
      byDay[date] = (byDay[date] || 0) + (event.count || 1);
      byDayMinutes[date] = (byDayMinutes[date] || 0) + (event.durationMinutes || 0);
    });
    const activeDays = Object.keys(byDay).length;
    return {
      days,
      events,
      byType,
      byDay,
      byDayMinutes,
      activeDays,
      totalActions: events.reduce((sum, event) => sum + (event.count || 1), 0),
      totalMinutes: events.reduce((sum, event) => sum + (event.durationMinutes || 0), 0),
      latestAt: events.at(-1)?.at || 0,
    };
  },

  getStorageDiagnostics() {
    let bytes = 0;
    let keyCount = 0;
    try {
      keyCount = localStorage.length;
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key) bytes += (localStorage.getItem(key) || '').length * 2;
      }
    } catch {
      // Some privacy modes deny storage inspection; keep the diagnostic useful.
    }
    const cache = this.getNceCache();
    return {
      keyCount,
      approximateBytes: bytes,
      approximateMegabytes: Number((bytes / 1024 / 1024).toFixed(2)),
      studyEventCount: this.getStudyEvents().length,
      nceLessonCacheCount: Object.keys(cache.lessons || {}).length,
      hasCourseBookCache: Boolean(cache.book?.units?.length),
      cacheUpdatedAt: cache.updatedAt || 0,
      // A previous write may have failed (full disk / blocked storage): surface it.
      lastWriteError: this.getLastWriteError(),
    };
  },

  clearNceCache() {
    try {
      localStorage.removeItem(STORAGE_KEYS.NCE_CACHE);
      return true;
    } catch {
      return false;
    }
  },

  recordStudyActivity({ type = 'review', count = 1, ...eventMeta } = {}) {
    const todayStr = getLocalDateKey();
    const current = this.getStudyStats();

    let newStreak = current.streakDays || 0;

    if (current.lastActiveDate !== todayStr) {
      if (!current.lastActiveDate) {
        newStreak = 1;
      } else {
        const diffDays = dateKeyToDayNumber(todayStr) - dateKeyToDayNumber(current.lastActiveDate);

        if (diffDays === 1) {
          newStreak += 1;
        } else if (diffDays > 1) {
          newStreak = 1;
        }
      }
    } else if (newStreak === 0) {
      newStreak = 1;
    }

    const todayReviewed = type === 'review' ? (current.todayReviewedCount || 0) + count : (current.todayReviewedCount || 0);
    const todayOral = type === 'oral' ? (current.todayOralCount || 0) + count : (current.todayOralCount || 0);
    const todayAnnotation = type === 'annotation' ? (current.todayAnnotationCount || 0) + count : (current.todayAnnotationCount || 0);
    const todayCourse = type === 'course' ? (current.todayCourseCount || 0) + count : (current.todayCourseCount || 0);
    const todayVocab = type === 'vocab' ? (current.todayVocabCount || 0) + count : (current.todayVocabCount || 0);
    const todayTotal = (current.todayTotalActions || 0) + count;

    const updated = {
      ...current,
      streakDays: newStreak,
      lastActiveDate: todayStr,
      todayReviewedCount: todayReviewed,
      todayOralCount: todayOral,
      todayAnnotationCount: todayAnnotation,
      todayCourseCount: todayCourse,
      todayVocabCount: todayVocab,
      todayTotalActions: todayTotal,
      totalReviewedCount: (current.totalReviewedCount || 0) + (type === 'review' ? count : 0),
    };

    let statsBefore;
    let eventsBefore;
    try {
      statsBefore = localStorage.getItem(STORAGE_KEYS.STUDY_STATS);
      eventsBefore = localStorage.getItem(STORAGE_KEYS.STUDY_EVENTS);
    } catch { return null; }
    if (!this.saveStudyStats(updated)) return null;
    const recorded = this.recordStudyEvent({ type, count, ...eventMeta });
    if (!recorded) {
      try {
        if (statsBefore === null) localStorage.removeItem(STORAGE_KEYS.STUDY_STATS);
        else localStorage.setItem(STORAGE_KEYS.STUDY_STATS, statsBefore);
        if (eventsBefore === null) localStorage.removeItem(STORAGE_KEYS.STUDY_EVENTS);
        else localStorage.setItem(STORAGE_KEYS.STUDY_EVENTS, eventsBefore);
      } catch { /* The storage diagnostic retains the failure. */ }
      return null;
    }
    return updated;
  },

  recordReviewActivity(count = 1, metadata = {}) {
    return this.recordStudyActivity({ type: 'review', count, source: 'vocab-review', label: '完成生词复习', ...metadata });
  },

  deleteWord(wordId) {
    const words = this.getVocabulary().filter((w) => w.id !== wordId);
    // null means "the deletion was not persisted" — the word is still on disk.
    return this.saveVocabulary(words) ? words : null;
  },

  // --- Chat Messages ---
  getChatMessages(scenarioId) {
    return asArray(readJson(`${STORAGE_KEYS.CHAT_MESSAGES}_${scenarioId}`, []));
  },

  saveChatMessages(scenarioId, messages) {
    return safeSetItem(`${STORAGE_KEYS.CHAT_MESSAGES}_${scenarioId}`, JSON.stringify(messages));
  },

  clearChatMessages(scenarioId) {
    localStorage.removeItem(`${STORAGE_KEYS.CHAT_MESSAGES}_${scenarioId}`);
  },

  // --- Articles (Reader) ---
  getArticles() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEYS.ARTICLES);
    } catch {
      return [];
    }
    if (raw === null) return copySampleArticles();
    try {
      const parsed = JSON.parse(raw);
      // Pure read (the legacy demo upgrade now lives in migrateLegacySampleData).
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  saveArticles(articles) {
    return safeSetItem(STORAGE_KEYS.ARTICLES, JSON.stringify(articles));
  },

  saveArticle(article) {
    const list = this.getArticles();
    const existing = list.findIndex((a) => a.id === article.id);
    if (existing >= 0) {
      list[existing] = { ...list[existing], ...article, updatedAt: Date.now() };
    } else {
      list.unshift({ ...article, id: article.id || `art_${Date.now()}`, createdAt: Date.now() });
    }
    return this.saveArticles(list) ? list : null;
  },

  deleteArticle(id) {
    const list = this.getArticles().filter((a) => a.id !== id);
    if (!this.saveArticles(list)) return null;

    // Synchronously purge orphaned annotations and reading scroll position
    try {
      const annotations = this.getReadingAnnotations();
      if (annotations[String(id)]) {
        delete annotations[String(id)];
        this.saveReadingAnnotations(annotations);
      }
      localStorage.removeItem(`${READ_POSITION_PREFIX}${id}`);
    } catch {
      // ignore
    }

    return list;
  },

  // --- Reading Annotations ---
  getReadingAnnotations() {
    return asObject(readJson(STORAGE_KEYS.READING_ANNOTATIONS, {}));
  },

  saveReadingAnnotations(annotations) {
    return safeSetItem(STORAGE_KEYS.READING_ANNOTATIONS, JSON.stringify(annotations));
  },

  // --- Reading Scroll Positions ---
  // Components must use these instead of touching localStorage directly, so the key
  // format stays in one place and writes go through safeSetItem (quota-safe).
  getReadingPosition(articleId) {
    try {
      return localStorage.getItem(`${READ_POSITION_PREFIX}${articleId}`);
    } catch {
      return null;
    }
  },

  saveReadingPosition(articleId, position) {
    return safeSetItem(`${READ_POSITION_PREFIX}${articleId}`, String(position));
  },

  getAllReadingPositions() {
    const positions = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(READ_POSITION_PREFIX)) {
          positions[key] = localStorage.getItem(key);
        }
      }
    } catch {
      // ignore
    }
    return positions;
  },

  saveAllReadingPositions(positions) {
    if (!positions || typeof positions !== 'object') return;
    try {
      Object.entries(positions).forEach(([key, val]) => {
        if (key.startsWith(READ_POSITION_PREFIX) && val != null) {
          safeSetItem(key, String(val));
        }
      });
    } catch {
      // ignore
    }
  },

  // --- Article read state (powers the library's 已读 filter and progress) ---
  // Shape: { [articleId]: { readAt: number, percent: number } }. Older records may be a bare
  // number (readAt), so reads normalise both forms.
  getArticleReadState() {
    return asObject(readJson(STORAGE_KEYS.ARTICLE_READ_STATE, {}));
  },

  getArticleProgress(articleId) {
    if (!articleId) return { readAt: 0, percent: 0 };
    const entry = this.getArticleReadState()[String(articleId)];
    if (entry == null) return { readAt: 0, percent: 0 };
    if (typeof entry === 'number') return { readAt: entry, percent: 0 };
    return {
      readAt: Number(entry.readAt) || 0,
      percent: Math.max(0, Math.min(100, Math.round(Number(entry.percent) || 0))),
    };
  },

  saveArticleReadState(state) {
    return safeSetItem(STORAGE_KEYS.ARTICLE_READ_STATE, JSON.stringify(asObject(state) || {}));
  },

  markArticleRead(articleId) {
    if (!articleId) return false;
    const state = this.getArticleReadState();
    const previous = this.getArticleProgress(articleId);
    state[String(articleId)] = { readAt: Date.now(), percent: Math.max(previous.percent, 100) };
    return this.saveArticleReadState(state);
  },

  /**
   * Persist how far through an article the reader has scrolled (0-100).
   * Deliberately ignores 0 so that merely opening an article does not look like progress.
   */
  saveArticleProgress(articleId, percent) {
    if (!articleId) return false;
    const clamped = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (clamped <= 0) return false;
    const state = this.getArticleReadState();
    const key = String(articleId);
    const previous = this.getArticleProgress(articleId);
    const nextPercent = Math.max(previous.percent, clamped);
    if (previous.percent === nextPercent && previous.readAt) return true;
    state[key] = { readAt: previous.readAt || 0, percent: nextPercent };
    return this.saveArticleReadState(state);
  },

  /**
   * Whether an event of this type/entity has already been recorded today.
   * Used to keep an automatic reading session from being counted twice in one day.
   */
  hasStudyEventToday({ type, entityId } = {}) {
    if (!type) return false;
    const todayKey = getLocalDateKey();
    return this.getStudyEvents({ limit: 2000 }).some((event) => (
      event?.type === type
      && (!entityId || String(event.entityId) === String(entityId))
      && event.at
      && getLocalDateKey(new Date(event.at)) === todayKey
    ));
  },

  // --- All Scenarios Chat Messages ---
  getAllChatMessages() {
    const chats = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`${STORAGE_KEYS.CHAT_MESSAGES}_`)) {
          const scenarioId = key.replace(`${STORAGE_KEYS.CHAT_MESSAGES}_`, '');
          try {
            chats[scenarioId] = asArray(JSON.parse(localStorage.getItem(key)));
          } catch {
            chats[scenarioId] = [];
          }
        }
      }
    } catch {
      // ignore
    }
    return chats;
  },

  saveAllChatMessages(chatMap) {
    if (!chatMap || typeof chatMap !== 'object') return;
    try {
      Object.entries(chatMap).forEach(([scenarioId, msgs]) => {
        if (Array.isArray(msgs)) {
          this.saveChatMessages(scenarioId, msgs);
        }
      });
    } catch {
      // ignore
    }
  },

  // --- New Concept English Book 1 ---
  getNceProgress() {
    return asObject(readJson(STORAGE_KEYS.NCE_PROGRESS, {}));
  },

  saveNceProgress(progress) {
    return safeSetItem(STORAGE_KEYS.NCE_PROGRESS, JSON.stringify(progress || {}));
  },

  getNceCache() {
    return asObject(readJson(STORAGE_KEYS.NCE_CACHE, {}));
  },

  saveNceCache(cache) {
    return safeSetItem(STORAGE_KEYS.NCE_CACHE, JSON.stringify(cache || {}));
  },

  getNceExams() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.NCE_EXAMS) || '{}');
      return {
        attempts: Array.isArray(saved?.attempts) ? saved.attempts : [],
        draft: saved?.draft && typeof saved.draft === 'object' ? saved.draft : null,
      };
    } catch {
      return { attempts: [], draft: null };
    }
  },

  saveNceExams(exams) {
    return safeSetItem(STORAGE_KEYS.NCE_EXAMS, JSON.stringify(exams));
  },

  // --- Local Data Overview ---
  getLocalDataSummary() {
    const vocab = this.getVocabulary();
    const articles = this.getArticles();
    const annotations = this.getReadingAnnotations();
    let totalAnnotations = 0;
    Object.values(annotations).forEach((arr) => {
      if (Array.isArray(arr)) totalAnnotations += arr.length;
    });
    const chats = this.getAllChatMessages();
    const scenarioCount = Object.keys(chats).length;
    const stats = this.getStudyStats();
    const nceProgress = this.getNceProgress();
    const nceEntries = Object.values(nceProgress).filter((item) => item && typeof item === 'object');

    return {
      vocabCount: vocab.length,
      masteredCount: vocab.filter((w) => w.status === 'mastered').length,
      articleCount: articles.length,
      annotationCount: totalAnnotations,
      scenarioCount,
      streakDays: stats.streakDays || 0,
      todayReviewedCount: stats.todayReviewedCount || 0,
      studyEventCount: this.getStudyEvents().length,
      storage: this.getStorageDiagnostics(),
      schemaVersion: this.getSchemaVersion(),
      nceStartedCount: nceEntries.length,
      nceCompletedCount: nceEntries.filter((item) => item.status === 'completed').length,
      nceExamCount: this.getNceExams().attempts.length,
    };
  },

  // --- Full Backup & Restore 2.0 (With API Key Sanitization) ---
  exportAllData({ includeApiKey = false } = {}) {
    const settings = { ...this.getSettings() };
    const hadKey = Boolean(settings.apiKey?.trim());
    const hadSpeechKey = Boolean(settings.speechApiKey?.trim());

    if (!includeApiKey) {
      settings.apiKey = '';
      settings.speechApiKey = '';
    }

    const backup = {
      app: 'LingoFlow',
      version: 3,
      schemaVersion: this.getSchemaVersion() || STORAGE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      meta: {
        includeApiKey,
        hadKeyBeforeExport: hadKey,
        hadSpeechKeyBeforeExport: hadSpeechKey,
      },
      settings,
      vocabulary: this.getVocabulary(),
      articles: this.getArticles(),
      readingAnnotations: this.getReadingAnnotations(),
      readingPositions: this.getAllReadingPositions(),
      chatMessages: this.getAllChatMessages(),
      studyStats: this.getStudyStats(),
      nceProgress: this.getNceProgress(),
      nceExams: this.getNceExams(),
      appState: this.getAppState(),
      studyEvents: this.getStudyEvents({ limit: 2000 }),
      studyPlan: this.getStudyPlan(),
    };
    return JSON.stringify(backup, null, 2);
  },

  parseBackupPreview(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { valid: false, error: '备份文件格式不正确，不是有效的 JSON 数据' };
      }
      // Reject other apps' JSON here too, so the UI never offers to merge a foreign file.
      if (data.app && data.app !== 'LingoFlow') {
        return { valid: false, error: `这不是 LingoFlow 的备份文件（app=${String(data.app)}）` };
      }

      const vocabCount = Array.isArray(data.vocabulary) ? data.vocabulary.length : 0;
      const articleCount = Array.isArray(data.articles) ? data.articles.length : 0;
      let annotationCount = 0;
      if (data.readingAnnotations && typeof data.readingAnnotations === 'object') {
        Object.values(data.readingAnnotations).forEach((arr) => {
          if (Array.isArray(arr)) annotationCount += arr.length;
        });
      }
      const chatCount =
        data.chatMessages && typeof data.chatMessages === 'object'
          ? Object.keys(data.chatMessages).length
          : 0;

      const hasApiKey = Boolean(data.settings?.apiKey?.trim());
      const hasSpeechApiKey = Boolean(data.settings?.speechApiKey?.trim());
      const nceProgressCount = data.nceProgress && typeof data.nceProgress === 'object'
        ? Object.keys(data.nceProgress).length
        : 0;
      const nceExamCount = Array.isArray(data.nceExams?.attempts) ? data.nceExams.attempts.length : 0;
      const studyEventCount = Array.isArray(data.studyEvents) ? data.studyEvents.length : 0;
      const hasNceDraft = Boolean(data.nceExams?.draft);
      const exportedAt = data.exportedAt
        ? new Date(data.exportedAt).toLocaleString('zh-CN')
        : '未知时间';

      return {
        valid: true,
        version: data.version || 1,
        exportedAt,
        vocabCount,
        articleCount,
        annotationCount,
        chatCount,
        nceProgressCount,
        nceExamCount,
        hasNceDraft,
        studyEventCount,
        hasApiKey,
        hasSpeechApiKey,
      };
    } catch (err) {
      return { valid: false, error: `解析失败: ${err.message}` };
    }
  },

  /**
   * Snapshot the raw value of every key importAllData may write, so a failed import
   * can be rolled back to the exact previous state.
   */
  snapshotImportTargets(data) {
    const keys = new Set([
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.VOCABULARY,
      STORAGE_KEYS.ARTICLES,
      STORAGE_KEYS.READING_ANNOTATIONS,
      STORAGE_KEYS.STUDY_STATS,
      STORAGE_KEYS.NCE_PROGRESS,
      STORAGE_KEYS.NCE_EXAMS,
      STORAGE_KEYS.APP_STATE,
      STORAGE_KEYS.STUDY_EVENTS,
      STORAGE_KEYS.STUDY_PLAN,
    ]);
    if (data?.chatMessages && typeof data.chatMessages === 'object') {
      Object.keys(data.chatMessages).forEach((scenarioId) => {
        keys.add(`${STORAGE_KEYS.CHAT_MESSAGES}_${scenarioId}`);
      });
    }
    if (data?.readingPositions && typeof data.readingPositions === 'object') {
      Object.keys(data.readingPositions).forEach((key) => {
        if (key.startsWith(READ_POSITION_PREFIX)) keys.add(key);
      });
    }
    const snapshot = new Map();
    keys.forEach((key) => {
      try {
        snapshot.set(key, localStorage.getItem(key));
      } catch {
        snapshot.set(key, null);
      }
    });
    return snapshot;
  },

  restoreSnapshot(snapshot) {
    if (!snapshot || typeof snapshot.forEach !== 'function') return false;
    try {
      snapshot.forEach((value, key) => {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      return true;
    } catch {
      return false;
    }
  },

  importAllData(jsonString) {
    let data;
    try {
      data = JSON.parse(jsonString);
    } catch {
      return { success: false, error: '备份文件不是有效的 JSON，无法解析' };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { success: false, error: '备份文件格式不正确：顶层应为一个 JSON 对象' };
    }
    if (data.app && data.app !== 'LingoFlow') {
      return { success: false, error: `这不是 LingoFlow 的备份文件（app=${String(data.app)}）` };
    }
    const incomingVersion = Number(data.version ?? data.schemaVersion ?? 1);
    if (Number.isFinite(incomingVersion) && incomingVersion > STORAGE_SCHEMA_VERSION) {
      return { success: false, error: `备份来自更新的版本（v${incomingVersion}），请先升级应用再导入` };
    }

    // Nothing above this line writes. The snapshot plus the failure counter below let a
    // failed import roll back, instead of leaving settings half-applied (the old code
    // wrote settings first and could then throw during the vocabulary merge).
    const snapshot = this.snapshotImportTargets(data);
    const failuresBefore = writeFailureCount;

    try {
      // 1. Settings Merge: keep existing secrets when the backup carries none.
      //    speechApiKey used to be wiped here because only apiKey was protected.
      if (data.settings && typeof data.settings === 'object') {
        const currentSettings = this.getSettings();
        const incomingSettings = asObject(data.settings);
        const keepSecret = (field) => {
          const next = typeof incomingSettings[field] === 'string' ? incomingSettings[field].trim() : '';
          return next || currentSettings[field] || '';
        };
        this.saveSettings({
          ...currentSettings,
          ...incomingSettings,
          apiKey: keepSecret('apiKey'),
          speechApiKey: keepSecret('speechApiKey'),
        });
      }

      let addedWords = 0;
      let updatedWords = 0;

      // 2. Vocabulary Merge: smart merge progress, notes and status
      if (Array.isArray(data.vocabulary)) {
        const localWords = this.getVocabulary();
        const mergedMap = new Map();

        localWords.forEach((w) => {
          if (w && typeof w.word === 'string' && w.word.trim()) {
            mergedMap.set(w.word.toLowerCase().trim(), w);
          }
        });

        data.vocabulary.forEach((imp) => {
          if (!imp || typeof imp !== 'object') return;
          // Defensive: a non-string "word" used to throw a TypeError mid-import.
          if (typeof imp.word !== 'string' || !imp.word.trim()) return;
          const key = imp.word.toLowerCase().trim();
          if (mergedMap.has(key)) {
            const existing = mergedMap.get(key);
            const existingCreated = Number(existing.createdAt) || 0;
            const incomingCreated = Number(imp.createdAt) || 0;
            const existingNext = Number(existing.nextReviewDate) || 0;
            const incomingNext = Number(imp.nextReviewDate) || 0;
            const merged = {
              ...existing,
              ...imp,
              // Identity and creation stay local; only genuinely newer scheduling wins.
              // Previously intervalDays / easeFactor / nextReviewDate came wholesale from
              // the backup, so restoring an old file reset mastered words to "due today".
              id: existing.id || imp.id,
              createdAt: existingCreated ? existingCreated : incomingCreated,
              userNote: imp.userNote || existing.userNote || '',
              reviewCount: Math.max(existing.reviewCount || 0, imp.reviewCount || 0),
              step: Math.max(existing.step || 0, imp.step || 0),
              intervalDays: Math.max(Number(existing.intervalDays) || 1, Number(imp.intervalDays) || 1),
              easeFactor: Math.max(Number(existing.easeFactor) || 2.5, Number(imp.easeFactor) || 2.5),
              nextReviewDate: incomingNext > existingNext ? incomingNext : (existingNext || Date.now()),
              status:
                existing.status === 'mastered' || imp.status === 'mastered'
                  ? 'mastered'
                  : (imp.status || existing.status || 'learning'),
            };
            mergedMap.set(key, merged);
            updatedWords += 1;
          } else {
            mergedMap.set(key, imp);
            addedWords += 1;
          }
        });

        const finalMerged = Array.from(mergedMap.values());
        this.saveVocabulary(finalMerged);
      }

      // 3. Articles Merge
      let addedArticles = 0;
      if (Array.isArray(data.articles)) {
        const localArticles = this.getArticles();
        const artMap = new Map();
        localArticles.forEach((a) => {
          if (a.title) artMap.set(a.title.trim().toLowerCase(), a);
        });
        data.articles.forEach((a) => {
          if (!a.title) return;
          const k = a.title.trim().toLowerCase();
          if (!artMap.has(k)) {
            artMap.set(k, a);
            addedArticles += 1;
          }
        });
        this.saveArticles(Array.from(artMap.values()));
      }

      // 4. Reading Annotations Merge
      let addedAnnotations = 0;
      if (data.readingAnnotations && typeof data.readingAnnotations === 'object') {
        const localAnnotations = this.getReadingAnnotations();
        const mergedAnnotations = { ...localAnnotations };

        Object.entries(data.readingAnnotations).forEach(([artId, incomingList]) => {
          if (!Array.isArray(incomingList)) return;
          const currentList = mergedAnnotations[artId] || [];
          const sentenceMap = new Map();
          currentList.forEach((item) => {
            if (item.sentence) sentenceMap.set(item.sentence.trim(), item);
          });

          incomingList.forEach((incomingItem) => {
            if (!incomingItem.sentence) return;
            const sKey = incomingItem.sentence.trim();
            if (sentenceMap.has(sKey)) {
              // merge note
              const ex = sentenceMap.get(sKey);
              if (!ex.note && incomingItem.note) {
                ex.note = incomingItem.note;
              }
            } else {
              sentenceMap.set(sKey, incomingItem);
              addedAnnotations += 1;
            }
          });
          mergedAnnotations[artId] = Array.from(sentenceMap.values());
        });
        this.saveReadingAnnotations(mergedAnnotations);
      }

      // 5. Chat Messages Merge: keep the local conversation order, append unseen
      //    incoming messages. The previous rule only restored a chat when the local one
      //    had <= 1 message, so a longer local chat silently dropped the whole backup.
      if (data.chatMessages && typeof data.chatMessages === 'object') {
        const localChats = this.getAllChatMessages();
        Object.entries(data.chatMessages).forEach(([scenarioId, msgs]) => {
          if (!Array.isArray(msgs) || msgs.length === 0) return;
          const local = Array.isArray(localChats[scenarioId]) ? localChats[scenarioId] : [];
          if (local.length === 0) {
            this.saveChatMessages(scenarioId, msgs);
            return;
          }
          const seen = new Set(local.map((message) => message?.id).filter(Boolean));
          const appended = msgs.filter((message) => message && message.id && !seen.has(message.id));
          if (appended.length === 0) return;
          const mergedMessages = [...local, ...appended]
            .sort((a, b) => (Number(a?.timestamp) || 0) - (Number(b?.timestamp) || 0));
          this.saveChatMessages(scenarioId, mergedMessages);
        });
      }

      // 6. Reading Positions
      if (data.readingPositions && typeof data.readingPositions === 'object') {
        this.saveAllReadingPositions(data.readingPositions);
      }

      // 7. Study Stats Merge
      if (data.studyStats && typeof data.studyStats === 'object') {
        const currentStats = this.getStudyStats();
        const incomingStats = asObject(data.studyStats);
        const todayKey = getLocalDateKey();
        const incomingIsToday = incomingStats.lastActiveDate === todayKey;
        // Today's counters may only be merged when the backup was taken today; otherwise a
        // months-old backup would inject its "today" numbers into the current day.
        const pickToday = (field) => (incomingIsToday
          ? Math.max(currentStats[field] || 0, incomingStats[field] || 0)
          : (currentStats[field] || 0));
        const mergedStats = {
          // `|| 1` used to turn a genuine 0-day streak into 1.
          streakDays: Math.max(currentStats.streakDays || 0, incomingStats.streakDays || 0),
          lastActiveDate: [currentStats.lastActiveDate, incomingStats.lastActiveDate]
            .filter(Boolean)
            .sort()
            .at(-1) || '',
          todayReviewedCount: pickToday('todayReviewedCount'),
          todayOralCount: pickToday('todayOralCount'),
          todayAnnotationCount: pickToday('todayAnnotationCount'),
          todayCourseCount: pickToday('todayCourseCount'),
          todayVocabCount: pickToday('todayVocabCount'),
          todayTotalActions: pickToday('todayTotalActions'),
          totalReviewedCount: Math.max(
            currentStats.totalReviewedCount || 0,
            incomingStats.totalReviewedCount || 0
          ),
        };
        this.saveStudyStats(mergedStats);
      }

      // 8. NCE course progress: keep the most recently studied record per lesson
      if (data.nceProgress && typeof data.nceProgress === 'object') {
        const localProgress = this.getNceProgress();
        const mergedProgress = { ...localProgress };
        Object.entries(data.nceProgress).forEach(([lessonId, incoming]) => {
          if (!incoming || typeof incoming !== 'object') return;
          const current = mergedProgress[lessonId];
          if (!current || (incoming.lastStudiedAt || 0) >= (current.lastStudiedAt || 0)) {
            mergedProgress[lessonId] = incoming;
          }
        });
        this.saveNceProgress(mergedProgress);
      }

      if (data.nceExams && typeof data.nceExams === 'object') {
        const current = this.getNceExams();
        const attempts = new Map(current.attempts.map((attempt) => [attempt.id, attempt]));
        (Array.isArray(data.nceExams.attempts) ? data.nceExams.attempts : [])
          .filter((attempt) => attempt?.id && Array.isArray(attempt.results))
          .forEach((attempt) => attempts.set(attempt.id, attempt));
        const incomingDraft = data.nceExams.draft;
        const draft = incomingDraft?.unitId && Array.isArray(incomingDraft.questions)
          && (incomingDraft.startedAt || 0) > (current.draft?.startedAt || 0)
          ? incomingDraft : current.draft;
        this.saveNceExams({
          attempts: [...attempts.values()].sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0)).slice(0, 30),
          draft,
        });
      }

      if (data.appState && typeof data.appState === 'object') {
        this.saveAppState({ ...this.getAppState(), ...data.appState });
      }

      if (Array.isArray(data.studyEvents)) {
        const currentEvents = this.getStudyEvents({ limit: 2000 });
        const events = new Map(currentEvents.map((event) => [event.id, event]));
        data.studyEvents.forEach((event) => {
          if (event?.id) events.set(event.id, event);
        });
        safeSetItem(STORAGE_KEYS.STUDY_EVENTS, JSON.stringify(
          [...events.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-2000),
        ));
      }

      if (data.studyPlan && typeof data.studyPlan === 'object') {
        this.saveStudyPlan({ ...this.getStudyPlan(), ...data.studyPlan });
      }

      // Any dropped write during this run (quota / blocked storage) invalidates the whole
      // import: roll back rather than reporting success on a half-applied merge.
      // importAllData is synchronous, so this counter cannot be disturbed by other code.
      if (writeFailureCount > failuresBefore) {
        throw new Error(`部分数据写入失败（${lastWriteError?.name || '写入错误'}）`);
      }

      this.ensureSchema();

      return {
        success: true,
        totalWords: this.getVocabulary().length,
        addedWords,
        updatedWords,
        addedArticles,
        addedAnnotations,
      };
    } catch (e) {
      const rolledBack = this.restoreSnapshot(snapshot);
      return {
        success: false,
        error: `${e.message}${rolledBack ? '（已回滚，本地数据未改变）' : '（回滚失败，请检查浏览器存储空间）'}`,
        rolledBack,
      };
    }
  },
};

// Default enriched sample words (30 high-frequency & idiomatic terms)
