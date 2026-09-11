// LocalStorage keys
const STORAGE_KEYS = {
  SETTINGS: 'lingoflow_settings',
  VOCABULARY: 'lingoflow_vocabulary',
  CHAT_MESSAGES: 'lingoflow_chat_messages',
  ARTICLES: 'lingoflow_articles',
  STUDY_STATS: 'lingoflow_study_stats',
};

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
  voicePitch: 1.0,
  voiceAccent: 'en-US',
  autoPlayOralAudio: true,
  currentScenarioId: 'daily_chat',
};

export const StorageService = {
  // --- Settings ---
  getSettings() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  },

  // --- Vocabulary ---
  getVocabulary() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.VOCABULARY);
      return data ? JSON.parse(data) : DEFAULT_SAMPLE_WORDS;
    } catch {
      return DEFAULT_SAMPLE_WORDS;
    }
  },

  saveVocabulary(words) {
    localStorage.setItem(STORAGE_KEYS.VOCABULARY, JSON.stringify(words));
  },

  addWord(wordObj) {
    const words = this.getVocabulary();
    const existingIndex = words.findIndex(
      (w) => w.word.toLowerCase() === wordObj.word.trim().toLowerCase()
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
    };

    if (existingIndex >= 0) {
      // Update existing
      words[existingIndex] = { ...words[existingIndex], ...newEntry, id: words[existingIndex].id };
    } else {
      words.unshift(newEntry);
    }

    this.saveVocabulary(words);
    return newEntry;
  },

  updateWordSRS(wordId, quality) {
    // quality: 'again' (0) | 'hard' (1) | 'good' (2)
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

    // Standard SuperMemo SM-2 Adaptive Ease Factor Adjustment
    if (quality === 'again') {
      newStep = 0;
      newInterval = 1;
      newStatus = 'learning';
      // Penalize ease factor for forgotten word (floor at 1.3)
      newEase = Math.max(1.3, Number((newEase - 0.2).toFixed(2)));
    } else if (quality === 'hard') {
      newStep = Math.max(0, newStep);
      newInterval = Math.max(1, Math.round(newInterval * 1.2));
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
        newInterval = Math.round(newInterval * newEase);
        newStatus = 'mastered';
      } else {
        newInterval = Math.round(newInterval * newEase);
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
      nextReviewDate: now + newInterval * ONE_DAY_MS,
    };

    words[index] = updated;
    this.saveVocabulary(words);
    return updated;
  },

  // --- Study Habit & Streak Stats ---
  getStudyStats() {
    const todayStr = new Date().toISOString().slice(0, 10);
    const defaultStats = {
      streakDays: 1,
      lastActiveDate: '',
      todayReviewedCount: 0,
      totalReviewedCount: 0,
    };

    try {
      const data = localStorage.getItem(STORAGE_KEYS.STUDY_STATS);
      if (!data) return defaultStats;

      const stats = { ...defaultStats, ...JSON.parse(data) };

      // If opening on a new day, reset today's counter
      if (stats.lastActiveDate !== todayStr) {
        return {
          ...stats,
          todayReviewedCount: 0,
        };
      }
      return stats;
    } catch {
      return defaultStats;
    }
  },

  saveStudyStats(stats) {
    localStorage.setItem(STORAGE_KEYS.STUDY_STATS, JSON.stringify(stats));
  },

  recordReviewActivity(count = 1) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const current = this.getStudyStats();

    let newStreak = current.streakDays || 1;

    if (current.lastActiveDate && current.lastActiveDate !== todayStr) {
      const lastDate = new Date(current.lastActiveDate);
      const todayDate = new Date(todayStr);
      const diffDays = Math.round((todayDate - lastDate) / (24 * 60 * 60 * 1000));

      if (diffDays === 1) {
        newStreak += 1;
      } else if (diffDays > 1) {
        newStreak = 1;
      }
    }

    const updated = {
      streakDays: newStreak,
      lastActiveDate: todayStr,
      todayReviewedCount: (current.todayReviewedCount || 0) + count,
      totalReviewedCount: (current.totalReviewedCount || 0) + count,
    };

    this.saveStudyStats(updated);
    return updated;
  },

  deleteWord(wordId) {
    const words = this.getVocabulary().filter((w) => w.id !== wordId);
    this.saveVocabulary(words);
    return words;
  },

  // --- Chat Messages ---
  getChatMessages(scenarioId) {
    try {
      const data = localStorage.getItem(`${STORAGE_KEYS.CHAT_MESSAGES}_${scenarioId}`);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  saveChatMessages(scenarioId, messages) {
    localStorage.setItem(`${STORAGE_KEYS.CHAT_MESSAGES}_${scenarioId}`, JSON.stringify(messages));
  },

  clearChatMessages(scenarioId) {
    localStorage.removeItem(`${STORAGE_KEYS.CHAT_MESSAGES}_${scenarioId}`);
  },

  // --- Articles (Reader) ---
  getArticles() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ARTICLES);
      return data ? JSON.parse(data) : DEFAULT_SAMPLE_ARTICLES;
    } catch {
      return DEFAULT_SAMPLE_ARTICLES;
    }
  },

  saveArticles(articles) {
    localStorage.setItem(STORAGE_KEYS.ARTICLES, JSON.stringify(articles));
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
    return list;
  },

  // --- Full Backup & Restore ---
  exportAllData() {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      vocabulary: this.getVocabulary(),
      articles: this.getArticles(),
    };
    return JSON.stringify(backup, null, 2);
  },

  importAllData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (data.settings) this.saveSettings(data.settings);
      if (Array.isArray(data.vocabulary)) this.saveVocabulary(data.vocabulary);
      if (Array.isArray(data.articles)) this.saveArticles(data.articles);
      return { success: true, count: data.vocabulary?.length || 0 };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
};

// Default sample words so the user sees something immediately
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
];

// Default sample articles for reading
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
    tags: ['学习方法', '励志精读'],
  },
];
