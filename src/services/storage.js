// LocalStorage keys
const STORAGE_KEYS = {
  SETTINGS: 'lingoflow_settings',
  VOCABULARY: 'lingoflow_vocabulary',
  CHAT_MESSAGES: 'lingoflow_chat_messages',
  ARTICLES: 'lingoflow_articles',
  STUDY_STATS: 'lingoflow_study_stats',
  READING_ANNOTATIONS: 'lingoflow_reading_annotations',
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
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      at: Date.now(),
    };
    const events = [...this.getStudyEvents({ limit: 2000 }), event].slice(-2000);
    safeSetItem(STORAGE_KEYS.STUDY_EVENTS, JSON.stringify(events));
    return event;
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
      byType[event.type] = (byType[event.type] || 0) + (event.count || 1);
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

    this.saveStudyStats(updated);
    this.recordStudyEvent({ type, count, ...eventMeta });
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
    this.saveArticles(list);
    return list;
  },

  deleteArticle(id) {
    const list = this.getArticles().filter((a) => a.id !== id);
    this.saveArticles(list);

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
export const DEFAULT_SAMPLE_WORDS = [
  {
    id: 'sample_1',
    word: 'ubiquitous',
    phonetic: '/juːˈbɪkwɪtəs/',
    pos: 'adj.',
    translation: '无处不在的，普遍存在的',
    definitionEn: 'present, appearing, or found everywhere.',
    contextSentence: 'Smartphones have become ubiquitous in modern daily life.',
    contextSentenceCn: '智能手机在现代日常生活中已经无处不在。',
    step: 1,
    intervalDays: 1,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 1,
    tags: ['高频词', '精读摘录'],
  },
  {
    id: 'sample_2',
    word: 'resilience',
    phonetic: '/rɪˈzɪliəns/',
    pos: 'n.',
    translation: '恢复力，韧性，适应力',
    definitionEn: 'the capacity to recover quickly from difficulties; toughness.',
    contextSentence: 'Courage and resilience are essential when facing unforeseen challenges.',
    contextSentenceCn: '面对意想不到的挑战时，勇气与韧性至关重要。',
    step: 2,
    intervalDays: 3,
    nextReviewDate: Date.now(),
    status: 'review',
    reviewCount: 2,
    tags: ['心智思维', '表达升级'],
  },
  {
    id: 'sample_3',
    word: 'serendipity',
    phonetic: '/ˌserənˈdɪpəti/',
    pos: 'n.',
    translation: '意外发现珍宝的运气，美好的巧合',
    definitionEn: 'the occurrence and development of events by chance in a happy or beneficial way.',
    contextSentence: 'Finding this charming café on a rainy afternoon was pure serendipity.',
    contextSentenceCn: '在雨天的午后偶遇这家迷人的咖啡馆，纯属美好的意外。',
    step: 0,
    intervalDays: 1,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 0,
    tags: ['地道表达', '美词赏析'],
  },
  {
    id: 'sample_4',
    word: 'epiphany',
    phonetic: '/ɪˈpɪfəni/',
    pos: 'n.',
    translation: '顿悟，突然的灵光一现',
    definitionEn: 'a moment of sudden and great revelation or realization.',
    contextSentence: 'She had an epiphany while walking in the forest and changed her career path.',
    contextSentenceCn: '她在森林漫步时突然顿悟，随后改变了自己的职业规划。',
    step: 1,
    intervalDays: 2,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 1,
    tags: ['思维洞察', '进阶词汇'],
  },
  {
    id: 'sample_5',
    word: 'pragmatic',
    phonetic: '/præɡˈmætɪk/',
    pos: 'adj.',
    translation: '务实的，注重实效的',
    definitionEn: 'dealing with things sensibly and realistically in a way that is based on practical considerations.',
    contextSentence: 'We need a pragmatic approach to solve this dilemma rather than theoretical debates.',
    contextSentenceCn: '我们需要务实的方法来解决这个两难困境，而不是纯理论争论。',
    step: 2,
    intervalDays: 3,
    nextReviewDate: Date.now(),
    status: 'review',
    reviewCount: 2,
    tags: ['职场商务', '高频词'],
  },
  {
    id: 'sample_6',
    word: 'empathy',
    phonetic: '/ˈempəθi/',
    pos: 'n.',
    translation: '同理心，感同身受的能力',
    definitionEn: 'the ability to understand and share the feelings of another.',
    contextSentence: 'True leadership requires genuine empathy and active listening.',
    contextSentenceCn: '真正的领导力需要真诚的同理心与积极的倾听。',
    step: 1,
    intervalDays: 1,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 1,
    tags: ['情商领导力', '核心表达'],
  },
  {
    id: 'sample_7',
    word: 'articulate',
    phonetic: '/ɑːrˈtɪkjuleɪt/',
    pos: 'v. / adj.',
    translation: '清楚地表达；善于表达的',
    definitionEn: 'express an idea fluently and coherently; having the ability to speak clearly.',
    contextSentence: 'He was able to articulate the complex proposal in simple terms.',
    contextSentenceCn: '他能够用极其通俗的语言清晰阐明这项复杂的提案。',
    step: 0,
    intervalDays: 1,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 0,
    tags: ['表达沟通', '口语高频'],
  },
  {
    id: 'sample_8',
    word: 'procrastinate',
    phonetic: '/prəʊˈkræstɪneɪt/',
    pos: 'v.',
    translation: '拖延，耽搁',
    definitionEn: 'delay or postpone action; put off doing something.',
    contextSentence: 'When you procrastinate, minor tasks snowball into overwhelming burdens.',
    contextSentenceCn: '当你习惯性拖延时，微小的任务就会如滚雪球般变成难以承受的重担。',
    step: 1,
    intervalDays: 2,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 1,
    tags: ['日常高频', '学习心态'],
  },
  {
    id: 'sample_9',
    word: 'ambiguous',
    phonetic: '/æmˈbɪɡjuəs/',
    pos: 'adj.',
    translation: '模棱两可的，含糊不清的',
    definitionEn: 'open to more than one interpretation; having a double meaning.',
    contextSentence: 'The contract clauses were too ambiguous, leading to mutual confusion.',
    contextSentenceCn: '合同条款过于模棱两可，导致双方都产生了误解。',
    step: 2,
    intervalDays: 3,
    nextReviewDate: Date.now(),
    status: 'review',
    reviewCount: 2,
    tags: ['职场交流', '逻辑思辨'],
  },
  {
    id: 'sample_10',
    word: 'spontaneous',
    phonetic: '/spɒnˈteɪniəs/',
    pos: 'adj.',
    translation: '随性的，自发的，心血来潮的',
    definitionEn: 'performed or occurring as a result of a sudden impulse and without premeditation.',
    contextSentence: 'Taking that spontaneous road trip was the highlight of our summer.',
    contextSentenceCn: '那次说走就走的随性自驾游成了我们整个夏天的最大亮点。',
    step: 0,
    intervalDays: 1,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 0,
    tags: ['生活方式', '地道口语'],
  },
  {
    id: 'sample_11',
    word: 'meticulous',
    phonetic: '/məˈtɪkjələs/',
    pos: 'adj.',
    translation: '一丝不苟的，极细致周密的',
    definitionEn: 'showing great attention to detail; very careful and precise.',
    contextSentence: 'The architect was meticulous about every measurement in the blueprint.',
    contextSentenceCn: '这位建筑师对蓝图里的每一个尺寸数据都做到了一丝不苟。',
    step: 1,
    intervalDays: 2,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 1,
    tags: ['工作素养', '进阶词汇'],
  },
  {
    id: 'sample_12',
    word: 'vulnerable',
    phonetic: '/ˈvʌlnərəbl/',
    pos: 'adj.',
    translation: '脆弱的，易受伤害的，真诚袒露的',
    definitionEn: 'susceptible to physical or emotional attack or harm; exposing one\'s true self.',
    contextSentence: 'Being vulnerable with loved ones deepens emotional intimacy.',
    contextSentenceCn: '向挚爱之人袒露自己真实脆弱的一面，能加深彼此的情感联结。',
    step: 2,
    intervalDays: 4,
    nextReviewDate: Date.now(),
    status: 'review',
    reviewCount: 2,
    tags: ['心理洞察', '情感表达'],
  },
  {
    id: 'sample_13',
    word: 'nostalgia',
    phonetic: '/nɒˈstældʒə/',
    pos: 'n.',
    translation: '怀旧，对往事的留恋',
    definitionEn: 'a sentimental longing or wistful affection for the past.',
    contextSentence: 'Hearing that old song filled him with a bittersweet wave of nostalgia.',
    contextSentenceCn: '听到那首老歌时，一股五味杂陈的怀旧之情涌上他的心头。',
    step: 0,
    intervalDays: 1,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 0,
    tags: ['情感共鸣', '文学美词'],
  },
  {
    id: 'sample_14',
    word: 'eloquent',
    phonetic: '/ˈeləkwənt/',
    pos: 'adj.',
    translation: '雄辩的，生动感人的，有说服力的',
    definitionEn: 'fluent or persuasive in speaking or writing.',
    contextSentence: 'Her eloquent speech moved the entire audience to tears.',
    contextSentenceCn: '她那篇感人至深、极具说服力的演讲让全场观众为之动容落泪。',
    step: 1,
    intervalDays: 2,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 1,
    tags: ['演讲表达', '高级赞美'],
  },
  {
    id: 'sample_15',
    word: 'authentic',
    phonetic: '/ɔːˈθentɪk/',
    pos: 'adj.',
    translation: '真实的，原汁原味的，真诚的',
    definitionEn: 'of undisputed origin; genuine; true to one\'s own personality.',
    contextSentence: 'People are naturally drawn to leaders who remain authentic and honest.',
    contextSentenceCn: '人们总是会被那些保持真诚与本色的领导者自然吸引。',
    step: 3,
    intervalDays: 5,
    nextReviewDate: Date.now(),
    status: 'mastered',
    reviewCount: 3,
    tags: ['品牌素养', '高频热词'],
  },
  {
    id: 'sample_16',
    word: 'compelling',
    phonetic: '/kəmˈpelɪŋ/',
    pos: 'adj.',
    translation: '引人入胜的，令人信服的，不可抗拒的',
    definitionEn: 'evoking interest, attention, or admiration in a powerfully irresistible way.',
    contextSentence: 'The documentary presents a compelling argument for climate action.',
    contextSentenceCn: '这部纪录片为应对气候变化提出了极具说服力的有力论据。',
    step: 1,
    intervalDays: 1,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 1,
    tags: ['外刊精读', '说服力'],
  },
  {
    id: 'sample_17',
    word: 'nuance',
    phonetic: '/ˈnjuːɑːns/',
    pos: 'n.',
    translation: '细微差别，微妙之处',
    definitionEn: 'a subtle difference in or shade of meaning, expression, or sound.',
    contextSentence: 'Translating poetry requires capturing every subtle cultural nuance.',
    contextSentenceCn: '翻译诗歌需要精准捕捉到每一个细微的文化微妙意蕴。',
    step: 2,
    intervalDays: 3,
    nextReviewDate: Date.now(),
    status: 'review',
    reviewCount: 2,
    tags: ['语言精髓', '深度理解'],
  },
  {
    id: 'sample_18',
    word: 'paradox',
    phonetic: '/ˈpærədɒks/',
    pos: 'n.',
    translation: '悖论，看似矛盾却蕴含真理的话题',
    definitionEn: 'a seemingly absurd or self-contradictory statement that may prove to be well-founded or true.',
    contextSentence: 'The paradox of choice is that having too many options often makes us less satisfied.',
    contextSentenceCn: '选择的悖论在于：拥有过多的选项往往反而会降低我们的幸福感。',
    step: 1,
    intervalDays: 2,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 1,
    tags: ['哲思心理', '名著高频'],
  },
  {
    id: 'sample_19',
    word: 'catalyst',
    phonetic: '/ˈkætəlɪst/',
    pos: 'n.',
    translation: '催化剂，促成重大变革的人或事',
    definitionEn: 'a person or thing that precipitates an event or change.',
    contextSentence: 'His inspiring keynote acted as a catalyst for educational reform.',
    contextSentenceCn: '他那场发人深省的主题演讲成为了推动教育变革的催化剂。',
    step: 2,
    intervalDays: 4,
    nextReviewDate: Date.now(),
    status: 'review',
    reviewCount: 2,
    tags: ['商业创新', '影响力'],
  },
  {
    id: 'sample_20',
    word: 'compromise',
    phonetic: '/ˈkɒmprəmaɪz/',
    pos: 'v. / n.',
    translation: '妥协，折中，让步',
    definitionEn: 'an agreement or settlement of a dispute that is reached by each side making concessions.',
    contextSentence: 'Successful negotiation is the art of finding a fair compromise.',
    contextSentenceCn: '成功的谈判是一门找到公平折中妥协方案的艺术。',
    step: 0,
    intervalDays: 1,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 0,
    tags: ['日常沟通', '职场谈判'],
  },
  {
    id: 'sample_21',
    word: 'play it by ear',
    phonetic: '/pleɪ ɪt baɪ ɪər/',
    pos: 'phrase',
    translation: '见机行事，看情况再说',
    definitionEn: 'proceed flexibly without a strict plan.',
    contextSentence: "Let's not book dinner yet; we can just play it by ear after the movie.",
    contextSentenceCn: '先别急着定餐厅，看完电影后再看情况见机行事吧。',
    step: 1,
    intervalDays: 1,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 1,
    tags: ['地道习惯表达', '口语黄金短语'],
  },
  {
    id: 'sample_22',
    word: 'silver lining',
    phonetic: '/ˈsɪlvər ˈlaɪnɪŋ/',
    pos: 'phrase',
    translation: '困境中的一线生机，黑暗中的希望',
    definitionEn: 'a consoling or hopeful aspect of an otherwise bleak situation.',
    contextSentence: 'Losing my job had a silver lining—it pushed me to start my dream venture.',
    contextSentenceCn: '失业反倒让我因祸得福——它逼着我开启了自己梦寐以求的事业。',
    step: 2,
    intervalDays: 3,
    nextReviewDate: Date.now(),
    status: 'review',
    reviewCount: 2,
    tags: ['心智思维', '地道习惯表达'],
  },
  {
    id: 'sample_23',
    word: 'cut corners',
    phonetic: '/kʌt ˈkɔːnərz/',
    pos: 'phrase',
    translation: '偷工减料，走捷径省事',
    definitionEn: 'undertake something in what seems the easiest, quickest, or cheapest way, usually omitting something important.',
    contextSentence: 'Never cut corners when it comes to product security and quality.',
    contextSentenceCn: '在涉及产品安全和质量的问题上，绝不能偷工减料。',
    step: 0,
    intervalDays: 1,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 0,
    tags: ['职场法则', '地道习惯表达'],
  },
  {
    id: 'sample_24',
    word: 'hit the ground running',
    phonetic: '/hɪt ðə ɡraʊnd ˈrʌnɪŋ/',
    pos: 'phrase',
    translation: '迅速进入工作状态，一开始就全力推进',
    definitionEn: 'start a new activity immediately with enthusiasm and complete confidence.',
    contextSentence: 'The new engineer hit the ground running and solved our biggest backlog bug.',
    contextSentenceCn: '新来的工程师一入职就迅速进入状态，解决了我们最头疼的一个历史 Bug。',
    step: 1,
    intervalDays: 2,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 1,
    tags: ['外企职场', '地道习惯表达'],
  },
  {
    id: 'sample_25',
    word: 'think outside the box',
    phonetic: '/θɪŋk ˌaʊtˈsaɪd ðə bɒks/',
    pos: 'phrase',
    translation: '跳出条条框框，打破常规思维',
    definitionEn: 'think creatively, unconventionally, or from a new perspective.',
    contextSentence: 'To beat industry giants, startups must think outside the box.',
    contextSentenceCn: '初创企业要想击败行业巨头，必须敢于打破常规创新思考。',
    step: 3,
    intervalDays: 6,
    nextReviewDate: Date.now(),
    status: 'mastered',
    reviewCount: 3,
    tags: ['创新灵感', '地道习惯表达'],
  },
  {
    id: 'sample_26',
    word: 'spill the beans',
    phonetic: '/spɪl ðə biːnz/',
    pos: 'phrase',
    translation: '说漏嘴，提前泄露秘密',
    definitionEn: 'reveal secret information unintentionally or indiscreetly.',
    contextSentence: 'We wanted the party to be a surprise, but Tom spilled the beans.',
    contextSentenceCn: '我们本想给大伙一个惊喜派对，结果汤姆提前说漏了嘴。',
    step: 0,
    intervalDays: 1,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 0,
    tags: ['美剧口语', '地道习惯表达'],
  },
  {
    id: 'sample_27',
    word: 'burn the midnight oil',
    phonetic: '/bɜːn ðə ˈmɪdnaɪt ɔɪl/',
    pos: 'phrase',
    translation: '挑灯夜战，熬夜苦读/加班',
    definitionEn: 'read or work late into the night.',
    contextSentence: 'The team burned the midnight oil all week to finish the launch on time.',
    contextSentenceCn: '整个团队整整一周都在挑灯夜战，只为了按时完成产品发布上线。',
    step: 2,
    intervalDays: 3,
    nextReviewDate: Date.now(),
    status: 'review',
    reviewCount: 2,
    tags: ['工作学习', '地道习惯表达'],
  },
  {
    id: 'sample_28',
    word: 'bite the bullet',
    phonetic: '/baɪt ðə ˈbʊlɪt/',
    pos: 'phrase',
    translation: '咬紧牙关硬着头皮上，下定决心面对困难',
    definitionEn: 'decide to do something difficult or unpleasant that one has been putting off.',
    contextSentence: 'I finally bit the bullet and had the uncomfortable conversation with my boss.',
    contextSentenceCn: '我终于咬咬牙硬着头皮，跟老板进行了一次必须面对的严肃长谈。',
    step: 1,
    intervalDays: 2,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 1,
    tags: ['心智行动力', '地道习惯表达'],
  },
  {
    id: 'sample_29',
    word: 'piece of cake',
    phonetic: '/piːs əv keɪk/',
    pos: 'phrase',
    translation: '小菜一碟，轻而易举的事',
    definitionEn: 'something that is very easy to do.',
    contextSentence: 'Once you grasp the fundamental principles, the exam is a piece of cake.',
    contextSentenceCn: '一旦你掌握了底层基本原理，这场考试就是小菜一碟。',
    step: 3,
    intervalDays: 7,
    nextReviewDate: Date.now(),
    status: 'mastered',
    reviewCount: 3,
    tags: ['高频口语', '地道习惯表达'],
  },
  {
    id: 'sample_30',
    word: 'on the same page',
    phonetic: '/ɒn ðə seɪm peɪdʒ/',
    pos: 'phrase',
    translation: '达成共识，想法一致，步调相同',
    definitionEn: 'in agreement or having the same understanding about something.',
    contextSentence: "Let's do a quick sync meeting to ensure all departments are on the same page.",
    contextSentenceCn: '我们来开个简短的对齐会，确保所有部门在认知和行动上完全步调一致。',
    step: 1,
    intervalDays: 1,
    nextReviewDate: Date.now(),
    status: 'learning',
    reviewCount: 1,
    tags: ['团队协同', '地道习惯表达'],
  },
];

// Default sample articles for reading (8 enriched editorial pieces across topics)
export const DEFAULT_SAMPLE_ARTICLES = [
  {
    id: 'art_1',
    title: 'The Art of Coffee & Conversation',
    level: 'Intermediate (中级)',
    content: `In modern urban life, the coffee shop is far more than a place to grab a quick dose of caffeine. It serves as a third place—a transitional sanctuary between the hectic workplace and the intimate quiet of home.

When you sit with a warm ceramic mug between your palms, the aroma of roasted beans creates an instant atmosphere of relaxed contemplation. Psychologists suggest that the gentle ambient hum of café chatter actually enhances creative thinking and fosters genuine serendipity.

Next time you visit your favorite barista, take a breath. Don't rush out with a paper takeaway cup. Allow yourself fifteen minutes to savor the brew and observe the subtle rhythms of life unfolding around you.`,
    tags: ['生活方式', '散文精读'],
  },
  {
    id: 'art_2',
    title: 'Why Consistency Trumps Talent',
    level: 'Beginner-Intermediate (入门进阶)',
    content: `Most people believe that mastering a foreign language requires innate linguistic talent. However, cognitive science reveals a much more empowering truth: consistency invariably beats raw intensity.

Spending fifteen focused minutes every single day with English does far more for your neurological wiring than cramming for five exhausting hours on a Sunday afternoon. Small, daily habits accumulate like compound interest.

When you embrace the journey with curiosity rather than anxiety, the fear of making mistakes gradually dissolves. Speak fearlessly, read with wonder, and let momentum do the heavy lifting.`,
    tags: ['学习方法', '心智思维'],
  },
  {
    id: 'art_3',
    title: 'The Quiet Power of Deep Work',
    level: 'Intermediate-Advanced (中高进阶)',
    content: `In an era defined by incessant notifications and algorithmic distractions, the ability to concentrate deeply has become as scarce as it is valuable. Deep work is the superpower of the twenty-first century knowledge economy.

When you deliberately disconnect from Slack channels and social feeds to lose yourself in demanding cognitive tasks, your brain enters a profound state of flow. Superficial busywork feels intoxicatingly productive, but it leaves behind no enduring legacy.

Cultivating uninterrupted stretches of focused solitude requires ruthless intentionality. Protect your mental bandwidth fiercely; the world remembers what you built with deep dedication, not how rapidly you responded to trivial emails.`,
    tags: ['职场专注', '极简心智'],
  },
  {
    id: 'art_4',
    title: 'Artificial Intelligence: Mirror to Human Potential',
    level: 'Advanced (前沿进阶)',
    content: `The rapid rise of artificial intelligence has sparked widespread anxiety about human obsolescence. Yet, when viewed through a broader historical lens, machine intelligence is not our rival, but an unprecedented cognitive mirror.

By automating repetitive synthesis, computational algorithms force us to confront what makes humanity truly irreplaceable: our empathy, moral discernment, and radical creative courage. Technology magnifies our reach, but our values must steer its trajectory.

The future will not belong to machines, nor to humans who resist them, but to visionary minds who master the delicate synergy between algorithmic calculation and poetic intuition.`,
    tags: ['科技前沿', '哲学思考'],
  },
  {
    id: 'art_5',
    title: 'Embracing Discomfort: The True Fuel of Growth',
    level: 'Intermediate (中级)',
    content: `Comfort is a deceptive oasis. While it offers temporary safety, staying within familiar borders slowly atrophies our adaptability and shrinks our horizons.

Every meaningful breakthrough—whether speaking a foreign tongue without stammering or pitching an audacious project—demands a willing encounter with vulnerability. Discomfort is not an obstacle on the path; discomfort is the very signpost confirming that genuine learning is taking place.

When you welcome awkward beginnings with grace, the dread of imperfection vanishes. Lean directly into the tension, for courage is built one trembling step at a time.`,
    tags: ['心智成长', '心理韧性'],
  },
  {
    id: 'art_6',
    title: 'The Poetics of Midnight Cities',
    level: 'Intermediate (中级)',
    content: `There is a peculiar magic that descends upon a bustling metropolis after midnight. The frantic corporate tempo recedes, leaving empty avenues bathed in the golden glow of incandescent streetlamps.

In these quiet hours, the city reveals its true texture. Solitary cyclists glide past shuttered bistros, while steam drifts mysteriously from underground grates into the crisp night air. It is a sanctuary for nocturnal dreamers, poets, and restless coders seeking solace beneath towering silhouettes of glass and steel.

To wander through a sleeping city is to experience urban poetry in its purest, unchoreographed form.`,
    tags: ['纽约客风', '散文美篇'],
  },
  {
    id: 'art_7',
    title: 'The Architecture of Atomic Habits',
    level: 'Beginner-Intermediate (入门进阶)',
    content: `We rarely rise to the level of our grandest goals; instead, we fall to the level of our daily systems. Extraordinary accomplishments are merely the compound interest of ordinary, repeated choices.

Reading three pages before bed, journaling two reflections at sunrise, or reviewing ten flashcards over morning tea might seem negligible in isolation. Yet, sustained over a calendar year, these micro-commitments fundamentally reshape your identity.

Stop obsessing over overnight transformations. Fall in love with the unglamorous ritual of daily craftsmanship, and let cumulative progress take care of the outcome.`,
    tags: ['习惯养成', '自我管理'],
  },
  {
    id: 'art_8',
    title: 'Simplicity in an Overcomplicated World',
    level: 'Intermediate-Advanced (中高进阶)',
    content: `Our modern culture equates more with better: more possessions, more commitments, more data. Yet true sophistication invariably lies in the courage to subtract.

Voluntary simplicity is not about ascetic deprivation; it is the deliberate pruning of non-essentials to nourish what genuinely matters. When you declutter your schedule and eliminate noisy obligations, mental clarity naturally rushes in to fill the void.

To live lightly is to live deliberately. Possess only what speaks to your spirit, cherish unhurried afternoons, and discover the profound abundance hidden within stillness.`,
    tags: ['极简主义', '心灵栖居'],
  },
];
