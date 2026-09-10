/*!
 * 日课 · DAILY WORDS —— 主逻辑
 * 无框架、无构建工具、无后端。全部数据存在本机浏览器。
 */
(function () {
  'use strict';

  /* ═══════════════ 0. 常量 ═══════════════ */

  var KEY = {
    progress: 'rike.progress.v1',
    settings: 'rike.settings.v1',
    sessions: 'rike.sessions.v1',
    meta: 'rike.meta.v1',
    custom: 'rike.custom.v1'
  };
  var VERSION = '0.4.0';

  var DEFAULT_SETTINGS = {
    dailyNew: 12,
    dailyReviewCap: 60,      // 0 表示不限
    engine: 'online',        // online=在线真人发音  tts=内置语音合成
    accent: 'us',            // us | uk
    autoSpeak: true,
    speechRate: 1,
    dayBoundaryHour: 4,

    // ── 题型 ──
    // 「认词」是基础题型，始终开启，不给开关 —— 关掉它就不是背单词 App 了
    modeSpell: true,         // 看中文 + 听发音 → 拼出英文
    modeListen: true,        // 只听发音 → 拼出英文
    modeChoice: true,        // 看英文 → 从 4 个中文释义里选
    spellHint: true,         // 拼写/听音时给「提示」按钮（露首字母）

    // ── AI ──
    aiProvider: 'deepseek',
    aiKey: '',               // 只有走「浏览器直连」时才需要
    aiModel: '',             // 留空则用服务商默认模型
    aiBaseUrl: '',           // 仅 custom 服务商需要
    aiUseProxy: true         // 优先用本机 tools/serve.mjs 的 /api/ai，Key 不进浏览器
  };

  /** 静音 WAV：首次触摸时播一下，解除 iOS 的音频播放锁 */
  var SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

  var $ = function (id) { return document.getElementById(id); };
  var S = {
    words: [], byId: new Map(), builtin: [], custom: [],
    progress: {}, settings: {}, sessions: [], meta: {},
    view: 'home', session: null, lastSession: null,
    ui: { backup: null, ai: null, passage: null }
  };
  var cfgCache = null;

  /* ═══════════════ 1. 工具 ═══════════════ */

  function cfg() {
    if (!cfgCache) cfgCache = SRS.cfg({ dayBoundaryHour: S.settings.dayBoundaryHour });
    return cfgCache;
  }
  function invalidateCfg() { cfgCache = null; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 把例句里出现的目标词高亮（含常见变形） */
  function highlight(sentence, word) {
    var safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('\\b' + safe + '(?:s|es|ed|d|ing|n)?\\b', 'gi');
    return esc(sentence).replace(re, function (m) { return '<mark>' + m + '</mark>'; });
  }

  function shiftDay(key, delta) {
    var p = key.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function todayKey() { return SRS.dayKey(Date.now(), cfg()); }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { toast('写入失败：浏览器存储空间不足'); return false; }
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }

  /** 复制到剪贴板。局域网 http 下 Clipboard API 不可用，退回 execCommand。 */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  /* ═══════════════ 2. 语音 ═══════════════ */

  var Speech = {
    el: null,
    unlocked: false,
    voices: [],

    init: function () {
      this.el = new Audio();
      this.el.preload = 'auto';
      var self = this;
      if (window.speechSynthesis) {
        var load = function () {
          self.voices = window.speechSynthesis.getVoices().filter(function (v) { return /^en/i.test(v.lang); });
        };
        load();
        window.speechSynthesis.onvoiceschanged = load;
      }
    },

    /** 必须在用户手势里调用一次，否则 iOS 之后不让自动播放 */
    unlock: function () {
      if (this.unlocked) return;
      this.unlocked = true;
      try {
        this.el.src = SILENT_WAV;
        var p = this.el.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
      try {
        if (window.speechSynthesis) {
          var u = new SpeechSynthesisUtterance(' ');
          u.volume = 0;
          window.speechSynthesis.speak(u);
        }
      } catch (e) {}
    },

    url: function (word) {
      var type = S.settings.accent === 'uk' ? 1 : 2;
      return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(word) + '&type=' + type;
    },

    /** 在线真人发音，失败返回 false */
    online: function (word) {
      var self = this;
      return new Promise(function (resolve) {
        var done = false;
        var finish = function (ok) { if (done) return; done = true; clearTimeout(timer); resolve(ok); };
        var timer = setTimeout(function () { finish(false); }, 5000);
        try {
          self.el.onended = function () { finish(true); };
          self.el.onerror = function () { finish(false); };
          self.el.playbackRate = S.settings.speechRate;
          self.el.pause();
          self.el.src = self.url(word);
          var p = self.el.play();
          if (p && p.catch) p.catch(function () { finish(false); });
        } catch (e) { finish(false); }
      });
    },

    pickVoice: function (lang) {
      var exact = this.voices.filter(function (v) { return v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase(); });
      var pool = exact.length ? exact : this.voices;
      if (!pool.length) return null;
      var local = pool.filter(function (v) { return v.localService; });
      return (local[0] || pool[0]);
    },

    /** 内置语音合成，用于朗读整句 */
    tts: function (text, overrideLang) {
      var self = this;
      return new Promise(function (resolve) {
        if (!window.speechSynthesis) return resolve(false);
        var lang = overrideLang || (S.settings.accent === 'uk' ? 'en-GB' : 'en-US');
        var u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        u.rate = S.settings.speechRate;
        var v = self.pickVoice(lang);
        if (v) u.voice = v;
        var done = false;
        var finish = function (ok) { if (done) return; done = true; clearTimeout(timer); resolve(ok); };
        var timer = setTimeout(function () { finish(true); }, 12000);
        u.onend = function () { finish(true); };
        u.onerror = function () { finish(false); };
        try {
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
        } catch (e) { finish(false); }
      });
    },

    /** 统一入口：在线优先，失败自动退回内置合成 */
    pronounce: function (word) {
      var self = this;
      flashSpeaker(true);
      var chain = S.settings.engine === 'online'
        ? this.online(word).then(function (ok) { return ok || self.tts(word); })
        : this.tts(word);
      return chain.then(function (ok) { flashSpeaker(false); return ok; },
                        function () { flashSpeaker(false); return false; });
    },

    /** 预热下一张卡的音频，减少点击后的等待 */
    preload: function (word) {
      if (S.settings.engine !== 'online' || !word) return;
      try { var a = new Audio(); a.preload = 'auto'; a.src = this.url(word); } catch (e) {}
    },

    stop: function () {
      try { this.el.pause(); } catch (e) {}
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    }
  };

  var speakerTimer = null;
  function flashSpeaker(on) {
    var b = $('btnSpeak');
    if (!b) return;
    clearTimeout(speakerTimer);
    if (on) {
      b.classList.add('playing');
      // 固定时长后自动熄灭，避免 promise 卡住时按钮一直亮着
      speakerTimer = setTimeout(function () { b.classList.remove('playing'); }, 900);
    } else {
      b.classList.remove('playing');
    }
  }

  /* ═══════════════ 3. AI ═══════════════ */

  var AI_PRESETS = {
    deepseek:    { name: 'DeepSeek',  base: 'https://api.deepseek.com/v1',                        model: 'deepseek-chat' },
    siliconflow: { name: '硅基流动',   base: 'https://api.siliconflow.cn/v1',                      model: 'Qwen/Qwen2.5-7B-Instruct' },
    moonshot:    { name: 'Kimi',      base: 'https://api.moonshot.cn/v1',                         model: 'moonshot-v1-8k' },
    zhipu:       { name: '智谱 GLM',   base: 'https://open.bigmodel.cn/api/paas/v4',               model: 'glm-4-flash' },
    dashscope:   { name: '通义千问',   base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',   model: 'qwen-turbo' },
    openai:      { name: 'OpenAI',    base: 'https://api.openai.com/v1',                          model: 'gpt-4o-mini' },
    custom:      { name: '自定义',     base: '',                                                  model: '' }
  };

  function friendlyError(status, msg) {
    if (status === 401) return 'API Key 无效或已过期（401）';
    if (status === 402 || /insufficient|balance|quota|欠费|余额/i.test(msg)) return '账户余额不足或额度已用完（' + status + '）';
    if (status === 403) return '没有权限，可能是 Key 或模型名不对（403）';
    if (status === 404) return '模型不存在，检查一下模型名（404）';
    if (status === 429) return '请求太频繁，等十几秒再试（429）';
    if (status >= 500) return '服务商那边出故障了（' + status + '），过会儿再试';
    return msg;
  }

  var AI = {
    proxy: null,
    proxyChecked: false,

    preset: function () { return AI_PRESETS[S.settings.aiProvider] || AI_PRESETS.deepseek; },
    base: function () {
      return String(S.settings.aiBaseUrl || this.preset().base || '').replace(/\/+$/, '');
    },
    model: function () { return S.settings.aiModel || this.preset().model || ''; },
    directReady: function () { return !!(S.settings.aiKey && this.base() && this.model()); },
    viaProxy: function () { return !!(S.settings.aiUseProxy && this.proxy && this.proxy.configured); },
    ready: function () { return this.viaProxy() || this.directReady(); },

    /** 探测本机有没有配好代理（只问状态，不涉及 Key） */
    detect: function () {
      var self = this;
      return fetch('api/ai', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { self.proxy = (j && j.ok) ? j : null; self.proxyChecked = true; return self.proxy; })
        .catch(function () { self.proxy = null; self.proxyChecked = true; return null; });
    },

    statusText: function () {
      if (this.viaProxy()) return '本机代理 · ' + (this.proxy.providerName || '') + (this.proxy.model ? ' · ' + this.proxy.model : '');
      if (this.directReady()) return '浏览器直连 · ' + this.preset().name + ' · ' + this.model();
      return '未配置';
    },

    chat: function (messages, opts) {
      opts = opts || {};
      var body = { messages: messages, temperature: opts.temperature == null ? 0.3 : opts.temperature };
      if (this.viaProxy()) return this.post('api/ai', body, null);
      if (!S.settings.aiKey) {
        return Promise.resolve({ ok: false, error: '还没配置 AI。去「设置 → AI」填 API Key，或在本机放好 ai.config.json。' });
      }
      if (!this.base() || !this.model()) return Promise.resolve({ ok: false, error: '服务商地址或模型名没填完整' });
      body.model = this.model();
      return this.post(this.base() + '/chat/completions', body, { Authorization: 'Bearer ' + S.settings.aiKey });
    },

    post: function (url, body, headers) {
      var h = { 'Content-Type': 'application/json' };
      if (headers) for (var k in headers) h[k] = headers[k];
      return fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) })
        .then(function (res) {
          return res.text().then(function (text) {
            var j = null;
            try { j = JSON.parse(text); } catch (e) {}
            if (!res.ok) {
              var raw = (j && j.error) ? (typeof j.error === 'string' ? j.error : (j.error.message || JSON.stringify(j.error)))
                                       : (text.slice(0, 300) || 'HTTP ' + res.status);
              return { ok: false, status: res.status, error: friendlyError(res.status, raw) };
            }
            // 本机代理返回 {ok, content}；直连返回 OpenAI 结构
            if (j && typeof j.content === 'string') return { ok: true, content: j.content };
            if (j && j.choices && j.choices[0] && j.choices[0].message && typeof j.choices[0].message.content === 'string') {
              return { ok: true, content: j.choices[0].message.content };
            }
            return { ok: false, error: '返回格式看不懂：' + text.slice(0, 200) };
          });
        })
        .catch(function (e) {
          return { ok: false, error: '网络请求失败：' + e.message +
            '。如果是浏览器直连模式，多半是跨域被拦或网络不通 —— 把「优先用本机代理」打开试试。' };
        });
    }
  };

  /* ── 提示词 ── */

  var SYS_JSON = '只输出 JSON，不要任何解释文字，不要 markdown 代码块。';

  var PROMPT = {
    word: function (input) {
      return [
        { role: 'system', content: '你是英语词典编辑，服务中文母语的英语学习者。' + SYS_JSON },
        { role: 'user', content:
          '为下面这个词条生成词典数据（它可能是单词、短语或固定搭配）：\n「' + input + '」\n\n' +
          '严格按这个 JSON 结构输出：\n' +
          '{"word":"词条原型","phonetic_uk":"/英式音标/","phonetic_us":"/美式音标/","pos":"词性缩写如 v. / n. / adj.","meaning_cn":"中文释义，多个义项用中文分号隔开，最多3个","example_en":"一句自然的英文例句，必须包含该词，不超过14个词","example_cn":"例句的中文翻译","tags":["标签1","标签2"]}\n' +
          '音标用 IPA 并用斜杠包裹。tags 用中文，1-2 个，从这些里选：高频/工作/口语/学术/易混/经济/生活。'
        }
      ];
    },
    extract: function (article, known) {
      return [
        { role: 'system', content: '你是英语老师，服务中文母语的英语学习者。' + SYS_JSON },
        { role: 'user', content:
          '从下面这段英文里挑出对中文母语学习者有价值的生词或短语，最多 15 个，按在原文中出现的顺序排列。\n' +
          '不要选专有名词、人名、地名。不要选已掌握列表里的词。\n\n' +
          (known.length ? '已掌握（跳过这些）：' + known.join(', ') + '\n\n' : '') +
          '原文：\n"""\n' + article + '\n"""\n\n' +
          '严格按这个 JSON 数组输出，每项：\n' +
          '[{"word":"原型","phonetic_us":"/美式音标/","pos":"v.","meaning_cn":"在这段话里的中文意思","example_en":"原文中包含该词的那一句","example_cn":"该句的中文翻译"}]\n' +
          '如果确实没有值得学的生词，输出 []。'
        }
      ];
    },
    passage: function (words) {
      return [
        { role: 'system', content: '你是英语写作老师，服务中文母语的学习者。' + SYS_JSON },
        { role: 'user', content:
          '用下面这些词写一段连贯、自然、生活化的英文短文，把这些词都用进去（可以用它们的变形）：\n' + words.join(', ') + '\n\n' +
          '要求：长度 100-140 词；难度接近四六级；语气像朋友聊天，不要像教科书。\n\n' +
          '严格按这个 JSON 输出：\n' +
          '{"title":"英文小标题","text":"英文短文","translation":"整段中文翻译","questions":["一个用英文提的思考问题","第二个","第三个"]}'
        }
      ];
    }
  };

  /** 模型经常把 JSON 包在 ``` 里或前后带话，这里做宽容解析 */
  function parseLoose(text) {
    if (!text) return null;
    var s = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch (e) {}
    var start = s.search(/[{[]/);
    if (start < 0) return null;
    var end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (end <= start) return null;
    try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { return null; }
  }

  /** 把模型返回的字段名归一化，容错不同写法 */
  function normalizeWord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var w = String(raw.word || raw.term || '').trim();
    if (!w || !/[A-Za-z]/.test(w) || w.length > 60) return null;
    var ph = String(raw.phonetic || '').trim();
    return {
      word: w,
      phonetic_uk: String(raw.phonetic_uk || ph || '').trim(),
      phonetic_us: String(raw.phonetic_us || ph || '').trim(),
      pos: String(raw.pos || '').trim(),
      meaning_cn: String(raw.meaning_cn || raw.meaning || '').trim(),
      example_en: String(raw.example_en || raw.example || '').trim(),
      example_cn: String(raw.example_cn || '').trim(),
      tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 3).map(String) : []
    };
  }

  /** 输入像单词还是像文章 */
  function aiKindOf(text) {
    var t = String(text || '').trim();
    var words = t.split(/\s+/).filter(Boolean);
    if (words.length <= 4 && t.length <= 40) return 'word';
    return 'article';
  }

  /* ── 自建生词库 ── */

  function persistCustom() { writeJSON(KEY.custom, S.custom); }

  /** 自建生词排在内置词库前面 —— 自己遇到的词优先级最高 */
  function rebuildWords() {
    S.words = S.custom.concat(S.builtin);
    S.byId = new Map(S.words.map(function (w) { return [w.id, w]; }));
  }

  /** 已掌握的词，用来让 AI 跳过它们（太多会撑爆提示词，所以封顶 400 个） */
  function knownWords(limit) {
    var out = [];
    for (var i = 0; i < S.words.length && out.length < (limit || 400); i++) {
      var c = S.progress[S.words[i].id];
      if (c && c.state === 'review') out.push(S.words[i].word);
    }
    return out;
  }

  function addCustomWords(list) {
    var added = 0, skipped = 0;
    (list || []).forEach(function (raw) {
      var w = normalizeWord(raw);
      if (!w) { skipped++; return; }
      var id = w.word.toLowerCase();
      if (S.byId.has(id)) { skipped++; return; }
      var entry = {
        id: id, word: w.word,
        phonetic_uk: w.phonetic_uk || w.phonetic_us,
        phonetic_us: w.phonetic_us || w.phonetic_uk,
        pos: w.pos, meaning_cn: w.meaning_cn,
        example_en: w.example_en, example_cn: w.example_cn,
        deck: '我的生词', tags: w.tags,
        addedAt: Date.now(), source: 'ai'
      };
      S.custom.push(entry);
      S.words.push(entry);
      S.byId.set(id, entry);
      added++;
    });
    if (added) persistCustom();
    return { added: added, skipped: skipped };
  }

  /* ═══════════════ 4. 数据统计 ═══════════════ */

  var DAY = 86400000;

  function cardOf(id) { return S.progress[id] || null; }

  function dueStats() {
    var now = Date.now();
    var dueIds = [], newPool = 0;
    for (var i = 0; i < S.words.length; i++) {
      var id = S.words[i].id;
      var c = S.progress[id];
      if (!c || c.state === 'new') { newPool++; }
      else if (c.dueAt <= now) { dueIds.push(c.dueAt); }
    }
    var introduced = introducedToday();
    var newRemaining = Math.max(0, S.settings.dailyNew - introduced);
    var plannedNew = Math.min(newRemaining, newPool);
    var cap = S.settings.dailyReviewCap === 0 ? Infinity : S.settings.dailyReviewCap;
    var plannedReview = Math.min(dueIds.length, cap);
    var total = plannedNew + plannedReview;
    return {
      newPool: newPool, newRemaining: newRemaining, newIntroduced: introduced,
      dueCount: dueIds.length, plannedNew: plannedNew, plannedReview: plannedReview,
      total: total, minutes: Math.max(1, Math.round(total * 8 / 60)), deferred: Math.max(0, dueIds.length - plannedReview)
    };
  }

  /** 今天「第一次见到」的词数 —— 从数据推导，不靠计数器，关掉浏览器也不丢 */
  function introducedToday() {
    var today = todayKey(), n = 0;
    for (var id in S.progress) {
      var p = S.progress[id];
      if (p && p.firstSeenAt && SRS.dayKey(p.firstSeenAt, cfg()) === today) n++;
    }
    return n;
  }

  function statusCounts() {
    var out = { fresh: 0, learning: 0, review: 0, mastered: 0 };
    for (var i = 0; i < S.words.length; i++) {
      var c = S.progress[S.words[i].id];
      if (!c || c.state === 'new') out.fresh++;
      else if (c.state === 'learning') out.learning++;
      else if (c.intervalDays >= 30) out.mastered++;
      else out.review++;
    }
    return out;
  }

  function computeStreak() {
    var done = {}, frozen = S.meta.freezes || {};
    S.sessions.forEach(function (s) { if (s.completed) done[s.date] = 1; });
    var d = todayKey();
    if (!done[d] && !frozen[d]) d = shiftDay(d, -1);   // 今天还没学不算断签
    var n = 0;
    while ((done[d] || frozen[d]) && n < 3650) { n++; d = shiftDay(d, -1); }
    return n;
  }

  /**
   * 断签保护：完成今天的会话时，把最近一段没学的日子用「冻结卡」补上。
   * 每月配额默认 2 张，用完就真的断签 —— 但绝不覆盖已有记录。
   */
  function reconcileFreezes() {
    var today = todayKey();
    var done = {};
    S.sessions.forEach(function (s) { if (s.completed) done[s.date] = 1; });
    var frozen = S.meta.freezes || (S.meta.freezes = {});
    var month = today.slice(0, 7);
    var quota = 2;
    var used = Object.keys(frozen).filter(function (k) { return k.slice(0, 7) === month; }).length;
    var gaps = [], cursor = shiftDay(today, -1);
    for (var i = 0; i < 14; i++) {
      if (done[cursor]) break;
      if (frozen[cursor]) { cursor = shiftDay(cursor, -1); continue; }
      gaps.push(cursor);
      cursor = shiftDay(cursor, -1);
    }
    gaps.reverse().forEach(function (g) {
      if (used < quota) { frozen[g] = 1; used++; }
    });
    writeJSON(KEY.meta, S.meta);
  }

  /** 明天一整天预计到期多少张（不含今天剩下的零星学习步进） */
  function dueTomorrow() {
    var start = SRS.dayStart(Date.now(), cfg()) + DAY;
    var end = start + DAY;
    var n = 0;
    for (var id in S.progress) {
      var p = S.progress[id];
      if (p && p.state !== 'new' && p.dueAt >= start && p.dueAt < end) n++;
    }
    return n;
  }

  /** 今天碰过的词（用于「用今天的词写一段」） */
  function todayWords(n) {
    var today = todayKey(), out = [];
    for (var i = 0; i < S.words.length && out.length < (n || 8); i++) {
      var w = S.words[i], c = S.progress[w.id];
      if (!c || !c.history || !c.history.length) continue;
      var last = c.history[c.history.length - 1].t;
      if (SRS.dayKey(last, cfg()) === today) out.push(w);
    }
    return out;
  }

  /** 反复出问题的词：遗忘次数 + 拼写/听音错误次数综合排序 */
  function troubleWords(limit) {
    var out = [];
    for (var i = 0; i < S.words.length; i++) {
      var w = S.words[i], c = S.progress[w.id];
      if (!c) continue;
      var spellFail = Quiz.failCount(c, 'spell') + Quiz.failCount(c, 'listen');
      var lapses = c.lapses || 0;
      if (lapses === 0 && spellFail === 0) continue;
      out.push({ w: w, c: c, lapses: lapses, spellFail: spellFail, score: lapses * 2 + spellFail });
    }
    out.sort(function (a, b) { return b.score - a.score || b.c.reps - a.c.reps; });
    return out.slice(0, limit);
  }

  /** 各题型累计练了多少张 */
  function modeTotals() {
    var t = { recognize: 0, spell: 0, listen: 0, choice: 0 };
    S.sessions.forEach(function (s) {
      var m = s.modes || {};
      for (var k in t) t[k] += m[k] || 0;
    });
    return t;
  }

  /* ═══════════════ 5. 持久化 ═══════════════ */

  function persistProgress() { writeJSON(KEY.progress, S.progress); }
  function persistSessions() { writeJSON(KEY.sessions, S.sessions); }
  function persistSettings() { writeJSON(KEY.settings, S.settings); }

  function loadAll() {
    S.progress = readJSON(KEY.progress, {}) || {};
    S.sessions = readJSON(KEY.sessions, []) || [];
    S.meta = readJSON(KEY.meta, {}) || {};
    S.custom = readJSON(KEY.custom, []) || [];
    var st = readJSON(KEY.settings, {}) || {};
    S.settings = {};
    for (var k in DEFAULT_SETTINGS) S.settings[k] = st[k] == null ? DEFAULT_SETTINGS[k] : st[k];
  }

  /* ═══════════════ 6. 视图：今日 ═══════════════ */

  function dateParts() {
    var d = new Date();
    var wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
    return {
      latin: d.getFullYear() + ' · ' + String(d.getMonth() + 1).padStart(2, '0') + ' · ' + String(d.getDate()).padStart(2, '0'),
      cn: wd
    };
  }

  function viewHome() {
    var dp = dateParts();
    var st = dueStats();
    var streak = computeStreak();
    var today = todayKey();
    var todayRec = S.sessions.filter(function (s) { return s.date === today && s.completed; })[0];
    var frozen = S.meta.freezes || {};
    var lastFreeze = Object.keys(frozen).sort().pop();

    var hero, cta;
    if (st.total > 0) {
      hero =
        '<div class="home-hero">' +
          '<div class="big">' + st.total + '<span class="unit">张<br>卡片</span></div>' +
          '<div class="cap">今日待处理</div>' +
          '<div class="brk">' +
            '<span><b>' + st.plannedNew + '</b> <i>新词</i></span>' +
            '<span><b>' + st.plannedReview + '</b> <i>复习</i></span>' +
            '<span><b>' + st.minutes + '</b> <i>分钟</i></span>' +
          '</div>' +
        '</div>';
      cta =
        '<div class="home-cta">' +
          '<button class="btn-main" data-act="start">开始今日学习</button>' +
          '<button class="btn-ghost" data-act="start-one">只学 1 个词 · 通勤模式</button>' +
          (st.newRemaining === 0 && st.newPool > 0
            ? '<button class="btn-ghost" data-act="start-extra">今日新词已学完 · 再多学 5 个</button>' : '') +
        '</div>';
    } else if (st.newPool > 0) {
      hero =
        '<div class="home-hero">' +
          '<div class="big">0<span class="unit">张<br>卡片</span></div>' +
          '<div class="cap">今天没有要复习的</div>' +
          '<div class="brk"><span><i>词库里还有</i> <b>' + st.newPool + '</b> <i>个词没学</i></span></div>' +
        '</div>';
      cta =
        '<div class="home-cta">' +
          '<button class="btn-main" data-act="start-extra">再多学 5 个新词</button>' +
          '<button class="btn-ghost" data-act="start-one">只学 1 个词</button>' +
        '</div>';
    } else {
      hero =
        '<div class="all-clear">' +
          '<div class="glyph">✓</div>' +
          '<div class="t">全部清空</div>' +
          '<div class="s">这个词库里的词都安排上了<br>明天再来</div>' +
        '</div>';
      cta = '';
    }

    var back = '';
    if (lastFreeze && streak > 0) {
      back = '<div class="welcome-back">上次漏掉的 <b>' + lastFreeze.slice(5).replace('-', '/') +
             '</b> 已用冻结卡补上，连续天数没有断。<br>今天只有 ' + (st.plannedReview + st.plannedNew) + ' 张，慢慢来。</div>';
    }

    var seg7 = [];
    for (var i = 6; i >= 0; i--) {
      var k = shiftDay(today, -i);
      var cls = 'miss';
      if (S.sessions.some(function (s) { return s.date === k && s.completed; })) cls = 'done';
      else if (frozen[k]) cls = 'freeze';
      if (i === 0) cls += ' today';
      seg7.push('<span class="' + cls + '"></span>');
    }

    return '' +
      '<div class="view on" data-view="home">' +
        '<div class="masthead"><div class="mark">日课<em>DAILY WORDS</em></div></div>' +
        '<div class="rule-double"></div>' +
        '<div class="home-date"><div class="d">' + dp.latin + '</div><div class="w">' + dp.cn + '</div></div>' +
        hero + back + cta +
        '<div class="streak">' +
          '<div class="streak-top">' +
            '<div class="n">' + streak + '<small>天连续</small></div>' +
            '<div class="eyebrow">最近 7 天</div>' +
          '</div>' +
          '<div class="dots">' + seg7.join('') + '</div>' +
          '<div class="dots-cap"><span>' + shiftDay(today, -6).slice(5).replace('-', '/') + '</span>' +
            (todayRec ? '<span>今日已完成</span>' : '<span>今日未完成</span>') +
            '<span>' + today.slice(5).replace('-', '/') + '</span></div>' +
        '</div>' +
      '</div>';
  }

  /* ═══════════════ 7. 视图：完成页 ═══════════════ */

  function viewDone() {
    var rec = S.lastSession || {};
    var ratings = rec.ratings || [0, 0, 0, 0];
    var total = ratings.reduce(function (a, b) { return a + b; }, 0) || 1;
    var correct = Math.round((ratings[2] + ratings[3]) / total * 100);
    var streak = computeStreak();
    var tm = dueTomorrow();

    // 用今天学过的词写一段 —— 从"认得"推到"用得出"
    var todays = todayWords(8);
    var ps = S.ui.passage || {};
    var passageHtml;
    if (!todays.length) {
      passageHtml = '<div class="empty">今天还没学词，明天再来。</div>';
    } else if (ps.busy) {
      passageHtml = '<div class="ai-msg">AI 正在写…</div>';
    } else if (ps.error) {
      passageHtml = '<div class="ai-msg err">' + esc(ps.error) + '</div>' +
        '<button class="btn-line" data-act="aipassage">再试一次</button>';
    } else if (ps.data) {
      var d = ps.data;
      passageHtml =
        '<div class="passage">' +
          (d.title ? '<div class="p-title">' + esc(d.title) + '</div>' : '') +
          '<p class="p-text">' + esc(d.text) + '</p>' +
          (d.translation ? '<p class="p-cn">' + esc(d.translation) + '</p>' : '') +
          (Array.isArray(d.questions) && d.questions.length
            ? '<ol class="p-q">' + d.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol>'
            : '') +
        '</div>' +
        '<button class="btn-line" data-act="aisaytext">朗读整段</button>' +
        '<button class="btn-line" data-act="aipassage">换一段</button>';
    } else {
      passageHtml =
        '<div class="desc" style="font-size:12.5px;color:var(--ink-3);line-height:1.7;margin-bottom:12px">' +
          '把今天学的 <b>' + todays.length + '</b> 个词（' + esc(todays.slice(0, 4).map(function (w) { return w.word; }).join('、')) +
          (todays.length > 4 ? ' 等' : '') + '）串成一段小短文，读一遍、跟读一遍。' +
          '只会认不会用，是这个 App 唯一还没解决的问题。' +
        '</div>' +
        '<button class="btn-line" data-act="aipassage">用今天的词写一段</button>';
    }

    return '' +
      '<div class="view on" data-view="done">' +
        '<div class="done-wrap">' +
          '<div class="eyebrow">' + todayKey().replace(/-/g, ' · ') + '</div>' +
          '<div class="done-mark">✓</div>' +
          '<div class="done-t">今天的量已经清空</div>' +
          '<div class="done-s">可以关掉了。<br>剩下的交给明天的自己。</div>' +
          '<div class="done-grid">' +
            '<div><div class="k">新学</div><div class="v">' + (rec.newCount || 0) + '</div></div>' +
            '<div><div class="k">复习</div><div class="v">' + (rec.reviewCount || 0) + '</div></div>' +
            '<div><div class="k">正确率</div><div class="v">' + correct + '<small style="font-size:14px">%</small></div></div>' +
          '</div>' +
          '<div class="done-grid" style="margin-top:12px">' +
            '<div><div class="k">连续</div><div class="v">' + streak + '<small style="font-size:14px">天</small></div></div>' +
            '<div><div class="k">用时</div><div class="v">' + Math.max(1, Math.round((rec.durationSec || 0) / 60)) + '<small style="font-size:14px">分</small></div></div>' +
            '<div><div class="k">明天</div><div class="v">' + tm + '<small style="font-size:14px">张</small></div></div>' +
          '</div>' +
          '<div class="sec" style="margin-top:32px">' +
            '<div class="sec-head"><h2>用今天的词写一段</h2><span>读一遍，再跟读一遍</span></div>' +
            passageHtml +
          '</div>' +
          '<div class="home-cta"><button class="btn-main" data-act="nav" data-to="home">好，收工</button></div>' +
        '</div>' +
      '</div>';
  }

  /* ═══════════════ 8. 视图：统计 ═══════════════ */

  function viewStats() {
    var sc = statusCounts();
    var totalWords = S.words.length;
    var streak = computeStreak();
    var days = {};
    S.sessions.forEach(function (s) { if (s.completed) days[s.date] = 1; });
    var studiedDays = Object.keys(days).length;
    var st = dueStats();

    var bars = [
      ['新词', sc.fresh, 'var(--ink-3)'],
      ['学习中', sc.learning, 'var(--zhu)'],
      ['复习中', sc.review, 'var(--zhe)'],
      ['已掌握', sc.mastered, 'var(--tai)']
    ].map(function (b) {
      var pct = totalWords ? Math.round(b[1] / totalWords * 100) : 0;
      return '<div class="bar-row"><span class="nm">' + b[0] + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%;background:' + b[2] + '"></span></span>' +
        '<span class="vl">' + b[1] + '</span></div>';
    }).join('');

    // 近 14 天热力
    var heat = '';
    var today = todayKey();
    for (var i = 13; i >= 0; i--) {
      var k = shiftDay(today, -i);
      var rec = S.sessions.filter(function (s) { return s.date === k; })[0];
      var n = rec ? (rec.newCount + rec.reviewCount) : 0;
      var lv = n === 0 ? '' : n < 10 ? 'l1' : n < 30 ? 'l2' : 'l3';
      var extra = i === 0 ? ' today' : '';
      heat += '<i class="' + lv + extra + '" title="' + k + '  ' + n + ' 张"></i>';
    }

    var trouble = troubleWords(10);
    var troubleHtml = trouble.length
      ? '<div class="trouble">' + trouble.map(function (t) {
          var badge = [];
          if (t.lapses) badge.push('忘 ' + t.lapses);
          if (t.spellFail) badge.push('拼错 ' + t.spellFail);
          return '<button data-act="say" data-word="' + esc(t.w.word) + '">' +
            '<span class="w">' + esc(t.w.word) + '</span>' +
            '<span class="m">' + esc(t.w.meaning_cn) + '</span>' +
            '<span class="c">' + badge.join(' · ') + '</span></button>';
        }).join('') + '</div>'
      : '<div class="empty">还没有反复出错的词。<br>继续保持。</div>';

    // 各题型练了多少
    var mt = modeTotals();
    var mtTotal = mt.recognize + mt.spell + mt.listen + mt.choice;
    var modeColor = { recognize: 'var(--ink-3)', spell: 'var(--zhu)', listen: 'var(--dian)', choice: 'var(--zhe)' };
    var modeBars = Quiz.MODES.map(function (m) {
      var pct = mtTotal ? Math.round(mt[m] / mtTotal * 100) : 0;
      return '<div class="bar-row"><span class="nm">' + Quiz.label(m) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%;background:' + modeColor[m] + '"></span></span>' +
        '<span class="vl">' + mt[m] + '</span></div>';
    }).join('');

    var rate = (function () {
      var r = [0, 0, 0, 0];
      S.sessions.forEach(function (s) {
        (s.ratings || []).forEach(function (v, i) { r[i] += v; });
      });
      var tot = r.reduce(function (a, b) { return a + b; }, 0);
      return tot ? Math.round((r[2] + r[3]) / tot * 100) : 0;
    })();

    return '' +
      '<div class="view on" data-view="stats">' +
        '<div class="masthead"><div class="mark">统计<em>RECORD</em></div></div>' +
        '<div class="rule-double"></div>' +

        '<div class="sec"><div class="stat-row">' +
          '<div><div class="k">连续天数</div><div class="v">' + streak + '<small>天</small></div></div>' +
          '<div><div class="k">累计学习</div><div class="v">' + studiedDays + '<small>天</small></div></div>' +
          '<div><div class="k">已掌握</div><div class="v">' + sc.mastered + '<small>词</small></div></div>' +
          '<div><div class="k">总体正确率</div><div class="v">' + rate + '<small>%</small></div></div>' +
        '</div></div>' +

        '<div class="sec">' +
          '<div class="sec-head"><h2>词库构成</h2><span>共 ' + totalWords + ' 词</span></div>' +
          '<div class="bars">' + bars + '</div>' +
        '</div>' +

        '<div class="sec">' +
          '<div class="sec-head"><h2>题型分布</h2><span>累计 ' + mtTotal + ' 张</span></div>' +
          '<div class="bars">' + modeBars + '</div>' +
          '<div class="desc" style="margin-top:12px;font-size:11.5px;color:var(--ink-3);line-height:1.7">' +
            '认词只证明"看到能想起意思"。拼写和听音才是"用得出"的那一半。' +
          '</div>' +
        '</div>' +

        '<div class="sec">' +
          '<div class="sec-head"><h2>最近 14 天</h2><span>色深 = 当天卡片数</span></div>' +
          '<div class="heat">' + heat + '</div>' +
        '</div>' +

        '<div class="sec">' +
          '<div class="sec-head"><h2>反复忘掉的词</h2><span>点一下听发音</span></div>' +
          troubleHtml +
        '</div>' +

        '<div class="sec">' +
          '<div class="sec-head"><h2>待办</h2><span></span></div>' +
          '<div class="stat-row">' +
            '<div><div class="k">今天到期</div><div class="v">' + st.dueCount + '<small>张</small></div></div>' +
            '<div><div class="k">顺延到下一天</div><div class="v">' + st.deferred + '<small>张</small></div></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ═══════════════ 9. 视图：设置 ═══════════════ */

  function seg(name, options, current) {
    return '<div class="seg">' + options.map(function (o) {
      var on = String(o.v) === String(current) ? ' on' : '';
      return '<button class="' + on.trim() + '" data-set="' + name + '" data-val="' + o.v + '">' + o.t + '</button>';
    }).join('') + '</div>';
  }

  function viewSettings() {
    var s = S.settings;
    var sw = S.ui.backup;
    var proxyOn = !!(AI.proxy && AI.proxy.configured);
    var proxyNote;
    if (proxyOn) {
      proxyNote = '✓ 检测到本机代理：' + esc(AI.proxy.providerName || '') + (AI.proxy.model ? ' · ' + esc(AI.proxy.model) : '') +
        '。Key 只在你电脑上，浏览器全程拿不到它 —— 这是最安全的方式。';
    } else if (!AI.proxyChecked) {
      proxyNote = '正在检测本机代理…';
    } else {
      proxyNote = '没检测到本机代理（部署到静态托管时正常）。此时会走浏览器直连，需要上面那个 API Key。';
    }
    var offline = ('serviceWorker' in navigator) && window.isSecureContext;
    var inChina = location.protocol === 'http:' && !/^(localhost|127\.)/.test(location.hostname);
    var usedBytes = 0;
    try { for (var k in KEY) usedBytes += (localStorage.getItem(KEY[k]) || '').length; } catch (e) {}
    var frozen = Object.keys(S.meta.freezes || {}).length;

    var backupBox = '';
    if (sw === 'export') {
      backupBox = '<textarea class="backup-box" id="backupBox" spellcheck="false">' + esc(exportPayload()) + '</textarea>' +
        '<button class="btn-line" data-act="copy">复制到剪贴板</button>' +
        '<div class="field"><div class="desc">也可以直接全选上面的文字，粘到微信收藏、备忘录或网盘里。<br>' +
        '每天花 10 秒存一次，比什么都强 —— 浏览器清缓存是真的会把进度清掉。</div></div>';
    } else if (sw === 'import') {
      backupBox = '<textarea class="backup-box" id="backupBox" spellcheck="false" placeholder="把备份的 JSON 粘贴到这里，然后点下面的按钮"></textarea>' +
        '<button class="btn-line" data-act="doimport">导入并覆盖当前进度</button>';
    }

    return '' +
      '<div class="view on" data-view="settings">' +
        '<div class="masthead"><div class="mark">设置<em>SETTINGS</em></div></div>' +
        '<div class="rule-double"></div>' +

        '<div class="sec">' +
          '<div class="sec-head"><h2>每日份量</h2><span>宁少勿多</span></div>' +
          '<div class="field"><div class="field-top"><span class="lb">每天新词</span><span class="vl">' + s.dailyNew + ' 个</span></div>' +
            seg('dailyNew', [{ v: 5, t: '5' }, { v: 10, t: '10' }, { v: 12, t: '12' }, { v: 20, t: '20' }], s.dailyNew) +
            '<div class="desc">新词是最费脑力的部分。12 个大约 4 分钟，够用。</div>' +
          '</div>' +
          '<div class="field"><div class="field-top"><span class="lb">每天复习上限</span><span class="vl">' + (s.dailyReviewCap === 0 ? '不限' : s.dailyReviewCap + ' 张') + '</span></div>' +
            seg('dailyReviewCap', [{ v: 30, t: '30' }, { v: 60, t: '60' }, { v: 100, t: '100' }, { v: 0, t: '不限' }], s.dailyReviewCap) +
            '<div class="desc">超出上限的卡片自动顺延到明天，不会滚成复习债。这是这个 App 和你以前用过的那些最大的不同。</div>' +
          '</div>' +
        '</div>' +

        '<div class="sec">' +
          '<div class="sec-head"><h2>题型</h2><span>' + (1 + (s.modeSpell ? 1 : 0) + (s.modeListen ? 1 : 0) + (s.modeChoice ? 1 : 0)) + ' / 4 种</span></div>' +
          '<div class="field"><div class="desc">复习到一定程度的词会自动换题型考你。' +
            '没见过、还在学习阶段的词只出「认词」—— 让人拼一个从没见过的词没有意义。</div></div>' +
          '<div class="switch" data-act="toggle" data-key="modeSpell">' +
            '<span class="lb">拼写 · 看中文打英文</span>' +
            '<span class="track' + (s.modeSpell ? ' on' : '') + '"></span>' +
          '</div>' +
          '<div class="switch" data-act="toggle" data-key="modeListen">' +
            '<span class="lb">听音 · 只听发音打单词</span>' +
            '<span class="track' + (s.modeListen ? ' on' : '') + '"></span>' +
          '</div>' +
          '<div class="switch" data-act="toggle" data-key="modeChoice">' +
            '<span class="lb">选义 · 从 4 个释义里选</span>' +
            '<span class="track' + (s.modeChoice ? ' on' : '') + '"></span>' +
          '</div>' +
          '<div class="switch" data-act="toggle" data-key="spellHint">' +
            '<span class="lb">拼写时给「提示」按钮</span>' +
            '<span class="track' + (s.spellHint ? ' on' : '') + '"></span>' +
          '</div>' +
          '<div class="field"><div class="desc">拼错一两个字母算「差一点」，按「模糊」记 —— 不会一次手滑就把攒了很久的间隔打回原形。' +
            '四个字母以内的短词从严（cat 和 cut 是两个词）。用了提示再答对，同样按「模糊」算。</div></div>' +
        '</div>' +

        '<div class="sec">' +
          '<div class="sec-head"><h2>发音</h2><span></span></div>' +
          '<div class="field"><div class="field-top"><span class="lb">发音引擎</span><span class="vl">' + (s.engine === 'online' ? '在线真人' : '内置合成') + '</span></div>' +
            seg('engine', [{ v: 'online', t: '在线真人' }, { v: 'tts', t: '内置合成' }], s.engine) +
            '<div class="desc">在线真人来自有道词典的真人录音，音质好但需要联网；断网时自动退回内置合成。</div>' +
          '</div>' +
          '<div class="field"><div class="field-top"><span class="lb">口音</span><span class="vl">' + (s.accent === 'uk' ? '英音' : '美音') + '</span></div>' +
            seg('accent', [{ v: 'us', t: '美音' }, { v: 'uk', t: '英音' }], s.accent) +
          '</div>' +
          '<div class="field"><div class="field-top"><span class="lb">语速</span><span class="vl">' + s.speechRate + '×</span></div>' +
            seg('speechRate', [{ v: 0.75, t: '0.75×' }, { v: 1, t: '1×' }, { v: 1.25, t: '1.25×' }], s.speechRate) +
          '</div>' +
          '<div class="switch" data-act="toggle" data-key="autoSpeak">' +
            '<span class="lb">翻到新卡片时自动发音</span>' +
            '<span class="track' + (s.autoSpeak ? ' on' : '') + '"></span>' +
          '</div>' +
          '<button class="btn-line" data-act="testsound">试听一下</button>' +
        '</div>' +

        '<div class="sec">' +
          '<div class="sec-head"><h2>AI</h2><span>' + esc(AI.statusText()) + '</span></div>' +

          '<div class="field">' +
            '<div class="field-top"><span class="lb">服务商</span><span class="vl">' + esc(AI.preset().name) + '</span></div>' +
            '<select class="sel" data-input="aiProvider">' +
              Object.keys(AI_PRESETS).map(function (k) {
                return '<option value="' + k + '"' + (s.aiProvider === k ? ' selected' : '') + '>' + esc(AI_PRESETS[k].name) + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +

          '<div class="field">' +
            '<div class="field-top"><span class="lb">API Key</span><span class="vl">' +
              (s.aiKey ? '已填 · ' + s.aiKey.length + ' 字符' : '走本机代理时可留空') + '</span></div>' +
            '<input class="inp" type="password" data-input="aiKey" value="' + esc(s.aiKey) + '" ' +
              'placeholder="sk-..." autocomplete="off" autocapitalize="off" spellcheck="false">' +
            '<div class="desc">填在这里 = 存在这台设备的浏览器里。如果在本机跑着 tools/serve.mjs，' +
              '更推荐把 Key 写进 ai.config.json —— 那样浏览器全程拿不到它。</div>' +
          '</div>' +

          '<div class="field">' +
            '<div class="field-top"><span class="lb">模型</span><span class="vl">' + esc(AI.model() || '未填') + '</span></div>' +
            '<input class="inp" type="text" data-input="aiModel" value="' + esc(s.aiModel) + '" ' +
              'placeholder="' + esc(AI.preset().model || '模型名') + '" autocomplete="off" autocapitalize="off" spellcheck="false">' +
            '<div class="desc">留空就用服务商默认模型。省钱的话，DeepSeek 用 deepseek-chat，智谱用 glm-4-flash。</div>' +
          '</div>' +

          (s.aiProvider === 'custom'
            ? '<div class="field">' +
                '<div class="field-top"><span class="lb">接口地址</span><span class="vl"></span></div>' +
                '<input class="inp" type="text" data-input="aiBaseUrl" value="' + esc(s.aiBaseUrl) + '" ' +
                  'placeholder="https://example.com/v1" autocomplete="off" autocapitalize="off" spellcheck="false">' +
                '<div class="desc">任意 OpenAI 兼容接口，地址填到 /v1 为止。</div>' +
              '</div>'
            : '') +

          '<div class="switch" data-act="toggle" data-key="aiUseProxy">' +
            '<span class="lb">优先用本机代理</span>' +
            '<span class="track' + (s.aiUseProxy ? ' on' : '') + '"></span>' +
          '</div>' +
          '<div class="field"><div class="desc">' + proxyNote + '</div></div>' +

          '<button class="btn-line" data-act="aitest">测试连接</button>' +
        '</div>' +

        '<div class="sec">' +
          '<div class="sec-head"><h2>数据</h2><span>' + (usedBytes / 1024).toFixed(1) + ' KB</span></div>' +
          '<button class="btn-line" data-act="backup" data-mode="export">导出备份</button>' +
          '<button class="btn-line" data-act="backup" data-mode="import">导入备份</button>' +
          backupBox +
          '<div class="field"><div class="desc">冻结卡已用 ' + frozen + ' 张（每月 2 张，用来补断签）。</div></div>' +
          '<button class="btn-line danger" data-act="reset">清空全部学习进度</button>' +
        '</div>' +

        '<div class="about">' +
          '<b>日课 v' + VERSION + '</b> · 一个人的背单词工具<br>' +
          '所有数据只存在这台设备的浏览器里，不上传任何服务器。<br>' +
          '离线可用：' + (offline ? '<b>已开启</b>' : '<span class="warn">未开启</span>' +
            (inChina ? '（当前是局域网 http 访问，浏览器不允许注册离线缓存；部署到 HTTPS 后自动生效）' : '')) + '<br>' +
          '词库：' + S.words.length + ' 词' + (S.words.length ? '（' + esc(S.words[0].deck) + '）' : '') + '<br>' +
          '算法：SM-2 变体 · 一天从凌晨 ' + S.settings.dayBoundaryHour + ' 点算起' +
        '</div>' +
      '</div>';
  }

  /* ═══════════════ 10. 视图：AI 加词 ═══════════════ */

  function defaultAIState() {
    return { input: '', busy: false, kind: '', results: [], selected: {}, error: '', note: '' };
  }
  function aiState() { return S.ui.ai || (S.ui.ai = defaultAIState()); }

  function speakerSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/>' +
      '<path d="M15.5 8.8a4.6 4.6 0 0 1 0 6.4"/></svg>';
  }

  function viewAI() {
    var st = aiState();
    var ready = AI.ready();
    var kind = aiKindOf(st.input);
    var btnLabel = st.busy ? 'AI 正在想…' : (kind === 'word' ? 'AI 补全这个词条' : 'AI 挑出其中的生词');

    var statusBar =
      '<div class="ai-status' + (ready ? ' on' : '') + '">' +
        '<span class="dot"></span>' +
        '<span class="txt">' + (ready ? esc(AI.statusText()) : 'AI 未配置') + '</span>' +
        (ready ? '' : '<button class="mini" data-nav="settings">去设置</button>') +
      '</div>';

    var body = '';
    if (st.error) {
      body = '<div class="ai-msg err">' + esc(st.error) + '</div>';
    } else if (st.note) {
      body = '<div class="ai-msg">' + esc(st.note) + '</div>';
    } else if (st.results.length) {
      var sel = 0;
      st.results.forEach(function (_, i) { if (st.selected[i]) sel++; });
      body =
        '<div class="sec-head" style="margin-top:26px"><h2>AI 挑出 ' + st.results.length + ' 个</h2><span>点一下切换勾选</span></div>' +
        '<div class="ai-list">' + st.results.map(function (w, i) {
          var on = st.selected[i];
          var ipa = S.settings.accent === 'uk' ? (w.phonetic_uk || w.phonetic_us) : (w.phonetic_us || w.phonetic_uk);
          return '<div class="ai-item' + (on ? ' on' : '') + '" data-act="aipick" data-i="' + i + '" role="checkbox" aria-checked="' + (!!on) + '" tabindex="0">' +
            '<div class="tick">' + (on ? '✓' : '') + '</div>' +
            '<div class="ai-body">' +
              '<div class="ai-hd">' +
                '<b>' + esc(w.word) + '</b>' +
                (ipa ? '<span class="ai-ipa">' + esc(ipa) + '</span>' : '') +
                (w.pos ? '<span class="ai-pos">' + esc(w.pos) + '</span>' : '') +
                '<button class="ai-spk" data-act="aisay" data-word="' + esc(w.word) + '" aria-label="朗读">' + speakerSvg() + '</button>' +
              '</div>' +
              '<div class="ai-mn">' + esc(w.meaning_cn || '（没有释义）') + '</div>' +
              (w.example_en ? '<div class="ai-ex">' + esc(w.example_en) + '</div>' : '') +
              (w.example_cn ? '<div class="ai-ex-cn">' + esc(w.example_cn) + '</div>' : '') +
            '</div>' +
          '</div>';
        }).join('') + '</div>' +
        '<button class="btn-main" data-act="aiadd"' + (sel ? '' : ' disabled') + '>加入我的生词库（' + sel + '）</button>' +
        '<button class="btn-ghost" data-act="aireset">清空重来</button>';
    }

    return '' +
      '<div class="view on" data-view="ai">' +
        '<div class="masthead"><div class="mark">加词<em>AI IMPORT</em></div></div>' +
        '<div class="rule-double"></div>' +

        statusBar +

        '<div class="ai-input-wrap">' +
          '<textarea id="aiInput" class="ai-input" spellcheck="false" ' +
            'placeholder="输入一个单词，或粘一整段英文…">' + esc(st.input) + '</textarea>' +
          '<div class="ai-hint">' + (kind === 'word'
            ? '识别为<b>单个词条</b>，AI 会补全音标 / 词性 / 释义 / 例句'
            : '识别为<b>一段文章</b>，AI 会挑出适合你的生词，并跳过你已经会的') + '</div>' +
          '<button class="btn-main" id="aiGo" data-act="airun"' + (st.busy ? ' disabled' : '') + '>' + esc(btnLabel) + '</button>' +
        '</div>' +

        body +

        '<div class="sec" style="margin-top:34px">' +
          '<div class="sec-head"><h2>我的生词库</h2><span>' + S.custom.length + ' 个词</span></div>' +
          (S.custom.length
            ? '<div class="ai-mine">' + S.custom.slice(-14).reverse().map(function (w) {
                return '<span class="chip" data-act="aisay" data-word="' + esc(w.word) + '">' + esc(w.word) + '</span>';
              }).join('') + '</div>'
            : '<div class="empty">还是空的。<br>把你在剧里、文档里、会议里遇到的词丢进来。<br>背自己的词，比背别人的词表有用得多。</div>') +
        '</div>' +

        '<div class="about">' +
          'AI 只在点按钮时调用一次，一次几分钱。<br>' +
          '生成的内容会先给你过目勾选，确认后才进词库 —— 模型偶尔会出错，别照单全收。<br>' +
          '当前连接方式：<b>' + esc(AI.statusText()) + '</b>' +
        '</div>' +
      '</div>';
  }

  function aiRun() {
    var st = aiState();
    var text = String(st.input || '').trim();
    if (!text) return toast('先输入一个词或一段英文');
    if (!AI.ready()) {
      st.error = '还没配置 AI。可以在「设置 → AI」里填 API Key；如果在本机跑着 tools/serve.mjs，放好 ai.config.json 重启即可，那样 Key 不会进浏览器。';
      return render();
    }
    st.busy = true; st.error = ''; st.note = ''; st.results = []; st.selected = {};
    st.kind = aiKindOf(text);
    render();

    var msgs = st.kind === 'word' ? PROMPT.word(text) : PROMPT.extract(text, knownWords());
    AI.chat(msgs, { temperature: 0.2 }).then(function (res) {
      var cur = aiState();
      cur.busy = false;
      if (!res.ok) { cur.error = res.error; return render(); }

      var data = parseLoose(res.content);
      var list = [];
      if (Array.isArray(data)) list = data.map(normalizeWord).filter(Boolean);
      else if (data && Array.isArray(data.words)) list = data.words.map(normalizeWord).filter(Boolean);
      else if (data && typeof data === 'object') {
        var one = normalizeWord(data);
        if (one) list = [one];
      }

      if (!list.length) {
        cur.note = st.kind === 'word'
          ? 'AI 没给出能解析的词条。再点一次试试，或换个写法（比如只输单词原型）。'
          : '这段话里没挑出合适的生词 —— 也可能只是模型格式没给对，再点一次试试。';
        return render();
      }
      cur.results = list;
      list.forEach(function (_, i) { cur.selected[i] = true; });
      render();
    });
  }

  function aiAdd() {
    var st = aiState();
    var picked = st.results.filter(function (_, i) { return st.selected[i]; });
    if (!picked.length) return toast('先勾选几个词');
    var r = addCustomWords(picked);
    S.ui.ai = defaultAIState();
    render();
    toast('已加入 ' + r.added + ' 个词' + (r.skipped ? '，跳过 ' + r.skipped + ' 个（词库里已经有）' : ''));
    if (r.added) setTimeout(function () { Speech.pronounce(picked[0].word); }, 260);
  }

  function toggleAIPick(i) {
    var st = aiState();
    if (!st.results[i]) return;
    st.selected[i] = !st.selected[i];
    render();
  }

  function aiTest() {
    toast('正在测试…');
    AI.detect().then(function () {
      if (!AI.ready()) { render(); return toast('还没配置好：' + AI.statusText()); }
      return AI.chat([{ role: 'user', content: '只回复两个字：可以' }], { temperature: 0 }).then(function (res) {
        toast(res.ok ? '✓ 连接正常 · ' + String(res.content).trim().slice(0, 16) : '✗ ' + res.error);
        render();
      });
    });
  }

  function aiPassage() {
    var list = todayWords(8);
    if (!list.length) return toast('今天还没学词');
    if (!AI.ready()) {
      S.ui.passage = { error: '还没配置 AI。去「设置 → AI」看看。' };
      return render();
    }
    S.ui.passage = { busy: true };
    render();
    AI.chat(PROMPT.passage(list.map(function (w) { return w.word; })), { temperature: 0.75 })
      .then(function (res) {
        if (!res.ok) { S.ui.passage = { error: res.error }; return render(); }
        var d = parseLoose(res.content);
        if (!d || typeof d !== 'object' || !d.text) {
          S.ui.passage = { error: 'AI 返回的格式没解析出来，再点一次。' };
          return render();
        }
        S.ui.passage = { data: d };
        render();
      });
  }

  /* ═══════════════ 11. 学习会话 ═══════════════ */

  /** 这次给这张卡出什么题 */
  function pickModeFor(id, forceRecognize) {
    if (forceRecognize) return 'recognize';
    var mode = Quiz.pickMode(S.progress[id], {
      spell: S.settings.modeSpell,
      listen: S.settings.modeListen,
      choice: S.settings.modeChoice
    });
    // 选义题至少要 3 个选项。词库太小、或释义重复太多的时候退回认词
    if (mode === 'choice' && Quiz.buildChoices(S.byId.get(id), S.words).length < 3) {
      mode = 'recognize';
    }
    return mode;
  }

  function buildSession(opts) {
    opts = opts || {};
    var now = Date.now();
    var dueIds = [], newIds = [];
    for (var i = 0; i < S.words.length; i++) {
      var id = S.words[i].id, c = S.progress[id];
      if (!c || c.state === 'new') newIds.push(id);
      else if (c.dueAt <= now) dueIds.push(id);
    }
    dueIds.sort(function (a, b) { return S.progress[a].dueAt - S.progress[b].dueAt; });

    // 「只学 1 个词」一律出认词题：这个模式的用途是"再忙也能完成今天"，
    // 不该在通勤路上突然甩一道拼写题给你
    var one = opts.limit === 1;
    var queue = [];
    function push(id) { queue.push({ id: id, mode: pickModeFor(id, one) }); }

    if (one) {
      if (dueIds.length) push(dueIds[0]);
      else if (newIds.length) push(newIds[0]);
    } else {
      var cap = S.settings.dailyReviewCap === 0 ? dueIds.length : S.settings.dailyReviewCap;
      var rev = dueIds.slice(0, cap);
      var maxNew = Math.max(0, S.settings.dailyNew - introducedToday()) + (opts.newExtra || 0);
      var nw = newIds.slice(0, maxNew);
      // 交错排队：每 4 张复习夹 1 个新词，节奏不至于闷
      var a = 0, b = 0;
      while (a < rev.length || b < nw.length) {
        for (var k = 0; k < 4 && a < rev.length; k++) push(rev[a++]);
        if (b < nw.length) push(nw[b++]);
      }
    }

    return {
      queue: queue, index: 0,
      revealed: false, answered: false, busy: false, result: null, choiceOptions: null,
      startedAt: now, ratings: [0, 0, 0, 0], modes: {},
      newIds: {}, revIds: {}, requeues: {},
      kind: one ? 'one' : 'day'
    };
  }

  function startSession(opts) {
    Speech.unlock();
    var s = buildSession(opts);
    if (!s.queue.length) {
      toast(opts.limit === 1 ? '暂时没有可以学的卡片' : '今天没有待办，休息一下');
      return;
    }
    S.session = s;
    $('study').hidden = false;
    document.body.style.overflow = 'hidden';
    renderCard();
  }

  function currentCard() {
    var s = S.session;
    if (!s) return null;
    var item = s.queue[s.index];
    if (!item) return null;
    return { id: item.id, mode: item.mode, word: S.byId.get(item.id), card: S.progress[item.id] || null };
  }

  function ipaOf(w) {
    return (S.settings.accent === 'uk' ? w.phonetic_uk : w.phonetic_us) || w.phonetic_uk || w.phonetic_us || '';
  }

  /** 卡片上半部分（题目区）。答案绝不提前渲染进 DOM —— 拼写题的单词只能出现在作答之后 */
  function cardTopHtml(cur) {
    var w = cur.word, card = cur.card, mode = cur.mode;
    var isNew = !card || card.state === 'new';
    var isRelearn = !isNew && card.state === 'learning';
    if (mode === 'choice' && S.session.choiceOptions && S.session.choiceOptions.length < 3) mode = 'recognize';

    var tagCls, tagText;
    if (mode === 'recognize') {
      tagCls = isNew ? 'new' : (isRelearn ? 'relearn' : '');
      tagText = isNew ? '新词' : (isRelearn ? '重学' : '复习');
    } else {
      tagCls = 'quiz';
      tagText = Quiz.label(mode);
    }

    var head =
      '<div class="card-kind">' +
        '<span class="tag ' + tagCls + '">' + tagText + '</span>' +
        '<span>' + esc(w.deck || '') + '</span>' +
        '<span class="stamp">' + (isNew ? '' : '第 ' + ((card.reps || 0) + 1) + ' 次') + '</span>' +
      '</div>';

    if (mode === 'recognize' || mode === 'choice') {
      return head +
        '<h1 class="word" id="cardWord">' + esc(w.word) + '</h1>' +
        '<div class="ipa-row">' +
          '<span class="ipa" id="cardIpa">' + esc(ipaOf(w)) + '</span>' +
          '<button class="speak" id="btnSpeak" aria-label="朗读这个单词">' + speakerSvg() + '</button>' +
        '</div>' +
        (mode === 'choice'
          ? '<div class="choices" id="choices">' + (S.session.choiceOptions || []).map(function (o, i) {
              return '<button class="choice" data-choice="' + i + '">' +
                '<span class="k">' + 'ABCD'.charAt(i) + '</span>' +
                '<span class="t">' + esc(o.text) + '</span></button>';
            }).join('') + '</div>'
          : '<p class="hint" id="cardHint">轻点卡片，或按「显示释义」</p>');
    }

    var typeBox =
      '<div class="type-row">' +
        '<input id="typeInput" class="type-input" type="text" enterkeyhint="done" ' +
          'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" ' +
          'placeholder="打出这个单词">' +
      '</div>';

    if (mode === 'spell') {
      return head +
        '<div class="prompt-cn" id="promptCn">' + esc(w.meaning_cn || '') + '</div>' +
        '<div class="ipa-row">' +
          '<button class="speak" id="btnSpeak" aria-label="听发音">' + speakerSvg() + '</button>' +
          '<span class="dim">点一下听发音</span>' +
        '</div>' +
        typeBox +
        '<p class="hint" id="cardHint">看中文，打出英文</p>' +
        '<p class="hint-line" id="hintLine"></p>';
    }

    // listen：不给中文，只听
    return head +
      '<button class="big-speak" id="btnSpeak" aria-label="播放发音">' + speakerSvg() + '</button>' +
      typeBox +
      '<p class="hint" id="cardHint">听发音，打出这个单词</p>' +
      '<p class="hint-line" id="hintLine"></p>';
  }

  /**
   * 答案区：始终先渲染成一个空壳。
   * 内容等到「揭示」或「作答」时才由 fillAnswer 填进去 ——
   * 否则答案（以及含目标词的例句）会提前躺在 DOM 里，
   * 拼写题就变成了抄写题。
   */
  function cardRevealHtml() {
    return '<div class="reveal" id="reveal"><div class="inner"><div class="pad" id="answerPad"></div></div></div>';
  }

  function fillAnswer(cur) {
    var pad = $('answerPad');
    if (!pad) return;
    var w = cur.word, mode = cur.mode;
    var showWord = Quiz.isTyping(mode);     // 拼写/听音：答案就是单词本身
    var showMeaning = (mode !== 'spell');   // 拼写题的中文已经在题目里了，不用重复

    pad.innerHTML =
      (showWord ? '<div class="answer-word" id="cardWord">' + esc(w.word) + '</div>' : '') +
      '<hr class="rule">' +
      '<div class="answer-line">' +
        '<span class="pos" id="cardPos">' + esc(w.pos || '') + '</span>' +
        '<span class="ipa" id="cardIpa">' + esc(ipaOf(w)) + '</span>' +
      '</div>' +
      (showMeaning ? '<div class="meaning" id="cardMeaning">' + esc(w.meaning_cn || '') + '</div>' : '') +
      (w.example_en
        ? '<figure class="example">' +
            '<p class="ex-en" id="cardExEn">' + highlight(w.example_en, w.word) + '</p>' +
            '<p class="ex-cn" id="cardExCn">' + esc(w.example_cn || '') + '</p>' +
          '</figure>'
        : '') +
      '<div class="card-meta" id="cardMeta"></div>';
    fillMeta(cur);
  }

  function renderCard() {
    var s = S.session;
    if (!s) return;
    if (s.index >= s.queue.length) return finishSession(false);

    var cur = currentCard();
    if (!cur || !cur.word) { s.index++; return renderCard(); }

    s.revealed = false;
    s.answered = false;
    s.busy = false;
    s.result = null;
    s.usedHint = false;

    // 选义题的选项在这里生成并缓存，判分时必须用同一份
    if (cur.mode === 'choice') {
      s.choiceOptions = Quiz.buildChoices(cur.word, S.words);
      if (s.choiceOptions.length < 3) { cur.mode = 'recognize'; s.choiceOptions = null; }
    } else {
      s.choiceOptions = null;
    }

    var cardEl = $('card');
    cardEl.className = 'card mode-' + cur.mode;
    cardEl.innerHTML = cardTopHtml(cur) + cardRevealHtml();

    // 预热下一张的音频
    for (var i = s.index + 1; i < s.queue.length; i++) {
      var nw = S.byId.get(s.queue[i].id);
      if (nw) { Speech.preload(nw.word); break; }
    }

    $('railFill').style.width = Math.round(s.index / s.queue.length * 100) + '%';
    $('counter').textContent = (s.index + 1) + ' / ' + s.queue.length;

    // 重新触发入场动画
    cardEl.style.animation = 'none';
    void cardEl.offsetWidth;
    cardEl.style.animation = '';

    renderActions();
    if (S.settings.autoSpeak) Speech.pronounce(cur.word.word);

    if (Quiz.isTyping(cur.mode)) {
      var input = $('typeInput');
      if (input) setTimeout(function () { try { input.focus(); } catch (e) {} }, 80);
    }
  }

  function renderActions() {
    var s = S.session;
    if (!s) return;
    var box = $('actions');
    var cur = currentCard();
    if (!cur) { box.innerHTML = ''; return; }

    // 已作答：只剩「继续」，评分已经算好了
    if (s.answered) {
      box.innerHTML = '<button class="btn-reveal" data-act="nextq">继续</button>';
      return;
    }

    if (cur.mode === 'recognize') {
      if (!s.revealed) {
        box.innerHTML = '<button class="btn-reveal" data-act="reveal">显示释义</button>';
      } else {
        box.innerHTML = rateGridHtml(cur);
      }
      return;
    }

    if (Quiz.isTyping(cur.mode)) {
      box.innerHTML =
        '<div class="type-actions">' +
          (S.settings.spellHint ? '<button class="btn-side" data-act="hint">提示</button>' : '') +
          '<button class="btn-reveal" data-act="submit">提交</button>' +
        '</div>';
      return;
    }

    // 选义：选项就在卡片上，底部不需要按钮
    box.innerHTML = '<p class="hint center">选一个你认为对的释义</p>';
  }

  function rateGridHtml(cur) {
    var card = cur.card || SRS.newCard(Date.now());
    var now = Date.now();
    var labels = ['忘了', '模糊', '记得', '秒懂'];
    return '<div class="rate-grid">' + labels.map(function (lb, i) {
      return '<button class="rate" data-rate="' + i + '">' +
        '<span class="lb">' + lb + '</span>' +
        '<span class="wn">' + esc(SRS.describe(card, i, now, cfg())) + '</span>' +
        '</button>';
    }).join('') + '</div>';
  }

  function fillMeta(cur) {
    var meta = $('cardMeta');
    if (!meta) return;
    var c = cur.card, w = cur.word, parts = [];
    if (c && c.reps) {
      parts.push('复习 <b>' + c.reps + '</b> 次');
      parts.push('间隔 <b>' + SRS.formatDays(c.intervalDays || 0) + '</b>');
      if (c.lapses) parts.push('忘过 <b>' + c.lapses + '</b> 次');
      var spellFail = Quiz.failCount(c, 'spell') + Quiz.failCount(c, 'listen');
      if (spellFail) parts.push('拼错 <b>' + spellFail + '</b> 次');
      parts.push('难度系数 <b>' + (c.ease || 2.5).toFixed(2) + '</b>');
    } else {
      parts.push('第一次见到这个词');
      if (w.tags && w.tags.length) parts.push('标签 <b>' + esc(w.tags.join(' · ')) + '</b>');
    }
    meta.innerHTML = parts.join('');
  }

  /** 认词模式：显示释义 */
  function revealCard() {
    var s = S.session;
    if (!s || s.revealed || s.answered) return;
    var cur = currentCard();
    if (!cur || cur.mode !== 'recognize') return;
    s.revealed = true;
    fillAnswer(cur);
    $('reveal').classList.add('on');
    $('card').classList.add('revealed');
    var h = $('cardHint');
    if (h) h.style.opacity = '0';
    renderActions();
  }

  /** 拼写/听音：提交作答 */
  function submitTyping() {
    var s = S.session;
    if (!s || s.answered || s.busy) return;
    var cur = currentCard();
    var input = $('typeInput');
    if (!cur || !input) return;
    var g = Quiz.gradeTyping(input.value, cur.word.word);
    if (g.verdict === 'empty') { toast('先打出你记得的拼写'); return; }
    finishAnswer(cur, g);
  }

  /** 选义：点了某个选项 */
  function pickChoice(i) {
    var s = S.session;
    if (!s || s.answered || s.busy) return;
    var cur = currentCard();
    var picked = (s.choiceOptions || [])[i];
    if (!cur || !picked) return;
    finishAnswer(cur, picked.ok
      ? { verdict: 'right', rating: Quiz.RATING.GOOD }
      : { verdict: 'wrong', rating: Quiz.RATING.AGAIN }, i);
  }

  /** 提示：露出首字母和长度 */
  function showHint() {
    var s = S.session;
    if (!s || s.answered) return;
    var cur = currentCard();
    var line = $('hintLine');
    if (!cur || !line) return;
    line.textContent = '提示：' + Quiz.hintOf(cur.word.word);
    s.usedHint = true;
  }

  // 判定结果 → CSS 类名。别直接用 g.verdict 拼类名：
  // typo 对应的类是 v-near，直接拼会得到 v-typo，样式里没有这个选择器，
  // 「差一点」就会变成没有任何视觉反馈（这个 bug 被 e2e 抓到过一次）
  var VERDICT_CLASS = { right: 'v-right', typo: 'v-near', wrong: 'v-wrong', empty: 'v-wrong' };

  function verdictHtml(g) {
    if (g.verdict === 'right') return '<b>✓ 对了</b><span>拼得很准</span>';
    if (g.verdict === 'typo') {
      if (g.hinted) return '<b>差一点</b><span>用了提示，这次按「模糊」算</span>';
      return '<b>差一点</b><span>拼错了 ' + (g.dist || 1) + ' 个字母</span>';
    }
    return '<b>没拼对</b><span>正确答案在下面</span>';
  }

  /** 作答后：锁住输入、标出对错、展开答案 */
  function finishAnswer(cur, g, pickedIdx) {
    var s = S.session;
    // 用了提示还答对，不该算「记得」—— 按「模糊」处理
    if (s.usedHint && g.verdict === 'right') g = { verdict: 'typo', rating: Quiz.RATING.HARD, hinted: true };
    s.answered = true;
    s.result = g;

    var cardEl = $('card');
    var input = $('typeInput');
    if (input) {
      input.disabled = true;
      input.classList.add(g.verdict === 'right' ? 'v-right' : (g.verdict === 'typo' ? 'v-near' : 'v-wrong'));
    }

    if (cur.mode === 'choice') {
      var nodes = cardEl.querySelectorAll('.choice');
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].disabled = true;
        var o = (s.choiceOptions || [])[i];
        if (!o) continue;
        if (o.ok) nodes[i].classList.add('is-right');
        else if (i === pickedIdx) nodes[i].classList.add('is-wrong');
      }
    }

    // 顶部对错条（拼写/听音才有，认词和选义本身就有视觉反馈）
    if (Quiz.isTyping(cur.mode)) {
      var banner = document.createElement('div');
      banner.className = 'verdict ' + (VERDICT_CLASS[g.verdict] || 'v-wrong');
      banner.innerHTML = verdictHtml(g);
      cardEl.insertBefore(banner, $('reveal'));
    }

    fillAnswer(cur);
    $('reveal').classList.add('on');
    cardEl.classList.add('revealed');
    var h = $('cardHint');
    if (h) h.style.opacity = '0';
    renderActions();
  }

  /** 继续下一张 */
  function nextQuestion() {
    var s = S.session;
    if (!s || !s.answered) return;
    applyRating(s.result ? s.result.rating : Quiz.RATING.GOOD);
  }

  function applyRating(rating) {
    var s = S.session;
    if (!s || s.busy) return;
    s.busy = true;

    var item = s.queue[s.index];
    if (!item) { s.busy = false; return; }
    var id = item.id, mode = item.mode;
    var now = Date.now();
    var before = S.progress[id];
    var wasNew = !before || before.state === 'new';
    var base = before || Object.assign(SRS.newCard(now), { firstSeenAt: now });
    if (!base.firstSeenAt) base.firstSeenAt = now;

    var next = SRS.rate(base, rating, now, cfg());
    if (!next.firstSeenAt) next.firstSeenAt = base.firstSeenAt;
    // 每个题型单独记对错：拼写考砸过的词，之后会被优先再考拼写
    next.skills = Quiz.recordSkill(base.skills, mode, rating >= Quiz.RATING.GOOD, now);
    S.progress[id] = next;

    s.ratings[rating]++;
    s.modes[mode] = (s.modes[mode] || 0) + 1;
    if (wasNew) s.newIds[id] = 1; else s.revIds[id] = 1;

    // 「忘了」的卡片本次会话里再过一遍，而且用同一个题型
    if (rating === Quiz.RATING.AGAIN) {
      var n = s.requeues[id] || 0;
      if (n < 3) { s.requeues[id] = n + 1; s.queue.push({ id: id, mode: mode }); }
    }

    persistProgress();

    $('card').classList.add('leaving');
    setTimeout(function () {
      s.index++;
      s.busy = false;
      renderCard();
    }, 170);
  }

  function finishSession(aborted) {
    var s = S.session;
    if (!s) return;
    var ratings = s.ratings.slice();
    var total = ratings.reduce(function (a, b) { return a + b; }, 0);
    var rec = {
      date: todayKey(),
      durationSec: Math.round((Date.now() - s.startedAt) / 1000),
      newCount: Object.keys(s.newIds).length,
      reviewCount: Object.keys(s.revIds).length,
      ratings: ratings,
      modes: s.modes || {},
      completed: !aborted
    };

    if (total > 0 || aborted === false) {
      var prev = S.sessions.filter(function (x) { return x.date === rec.date; })[0];
      if (prev) {
        prev.durationSec += rec.durationSec;
        prev.newCount += rec.newCount;
        prev.reviewCount += rec.reviewCount;
        prev.ratings = prev.ratings.map(function (v, i) { return v + ratings[i]; });
        prev.modes = prev.modes || {};
        for (var mk in rec.modes) prev.modes[mk] = (prev.modes[mk] || 0) + rec.modes[mk];
        prev.completed = prev.completed || rec.completed;
        S.lastSession = prev;
      } else {
        S.sessions.push(rec);
        S.lastSession = rec;
      }
      persistSessions();
      if (rec.completed) reconcileFreezes();
    }

    S.session = null;
    Speech.stop();
    $('study').hidden = true;
    document.body.style.overflow = '';
    $('actions').innerHTML = '';
    s.index = 0;

    go(aborted ? 'home' : 'done');
  }

  /* ═══════════════ 12. 备份 ═══════════════ */

  function exportPayload() {
    // 刻意不导出 API Key —— 备份多半会被粘进微信收藏或备忘录
    var safeSettings = {};
    for (var k in S.settings) if (k !== 'aiKey') safeSettings[k] = S.settings[k];
    return JSON.stringify({
      app: '日课', version: VERSION, exportedAt: new Date().toISOString(),
      progress: S.progress, sessions: S.sessions, settings: safeSettings, meta: S.meta,
      custom: S.custom
    });
  }

  function doImport() {
    var box = $('backupBox');
    if (!box || !box.value.trim()) return toast('请先粘贴备份内容');
    var data;
    try { data = JSON.parse(box.value); }
    catch (e) { return toast('解析失败：不是合法的备份内容'); }
    if (!data || typeof data.progress !== 'object' || data.progress === null) return toast('解析失败：缺少 progress 字段');
    var n = Object.keys(data.progress).length;
    S.progress = data.progress;
    S.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    S.meta = data.meta || {};
    S.custom = Array.isArray(data.custom) ? data.custom : [];
    if (data.settings) {
      for (var k in DEFAULT_SETTINGS) {
        if (data.settings[k] != null) S.settings[k] = data.settings[k];
      }
    }
    persistCustom();
    rebuildWords();
    persistProgress(); persistSessions(); persistSettings(); writeJSON(KEY.meta, S.meta);
    invalidateCfg();
    S.ui.backup = null;
    toast('已导入 ' + n + ' 个词的学习进度' + (S.custom.length ? '、' + S.custom.length + ' 个自建生词' : ''));
    render();
  }

  /* ═══════════════ 13. 路由与事件 ═══════════════ */

  function go(view) {
    if (view !== 'done') S.ui.passage = null;
    S.view = view;
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    var html;
    if (S.view === 'stats') html = viewStats();
    else if (S.view === 'settings') html = viewSettings();
    else if (S.view === 'ai') html = viewAI();
    else if (S.view === 'done') html = viewDone();
    else html = viewHome();

    var app = $('app');
    app.innerHTML = html;
    app.setAttribute('data-tabs', S.view === 'done' ? 'off' : 'on');

    var tabs = $('tabbar');
    var showTabs = S.view !== 'done';
    tabs.hidden = !showTabs;
    Array.prototype.forEach.call(tabs.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-nav') === S.view);
    });
  }

  var NUMERIC = { dailyNew: 1, dailyReviewCap: 1, speechRate: 1 };

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-nav],[data-act],[data-set],[data-rate],[data-choice]');
    if (!t) return;

    if (t.hasAttribute('data-rate')) return applyRating(+t.getAttribute('data-rate'));
    if (t.hasAttribute('data-choice')) return pickChoice(+t.getAttribute('data-choice'));
    if (t.hasAttribute('data-nav')) return go(t.getAttribute('data-nav'));
    if (t.hasAttribute('data-set')) return applySetting(t);

    var act = t.getAttribute('data-act');
    switch (act) {
      case 'start': startSession({}); break;
      case 'start-one': startSession({ limit: 1 }); break;
      case 'start-extra': startSession({ newExtra: 5 }); break;
      case 'reveal': revealCard(); break;
      case 'submit': submitTyping(); break;
      case 'hint': showHint(); break;
      case 'nextq': nextQuestion(); break;
      case 'nav': go(t.getAttribute('data-to') || 'home'); break;
      case 'say': Speech.pronounce(t.getAttribute('data-word')); break;
      case 'toggle': toggleSetting(t.getAttribute('data-key')); break;
      case 'testsound': Speech.unlock(); Speech.pronounce('vocabulary'); break;
      case 'backup':
        S.ui.backup = t.getAttribute('data-mode');
        render();
        if (S.ui.backup === 'export') {
          var bx = $('backupBox');
          if (bx) { bx.focus(); bx.setSelectionRange(0, 30); }
        }
        break;
      case 'copy':
        copyText(exportPayload()).then(function (ok) {
          toast(ok ? '已复制 · 粘到微信收藏里存着' : '复制被浏览器拦了，请手动全选复制');
        });
        break;
      case 'doimport': doImport(); break;

      // ── AI ──
      case 'airun': aiRun(); break;
      case 'aiadd': aiAdd(); break;
      case 'aipick': toggleAIPick(+t.getAttribute('data-i')); break;
      case 'aisay': Speech.unlock(); Speech.pronounce(t.getAttribute('data-word')); break;
      case 'aitest': aiTest(); break;
      case 'aipassage': aiPassage(); break;
      case 'aisaytext': {
        var pd = S.ui.passage && S.ui.passage.data;
        if (pd && pd.text) { Speech.unlock(); Speech.tts(pd.text); }
        break;
      }
      case 'aireset': S.ui.ai = defaultAIState(); render(); break;

      case 'reset':
        if (confirm('清空全部学习进度？\n\n这会删掉所有复习记录和连续天数，且无法撤销。\n建议先导出备份。')) {
          S.progress = {}; S.sessions = []; S.meta = {};
          persistProgress(); persistSessions(); writeJSON(KEY.meta, S.meta);
          S.ui.backup = null;
          toast('已清空');
          render();
        }
        break;
    }
  });

  function applySetting(btn) {
    var key = btn.getAttribute('data-set');
    var raw = btn.getAttribute('data-val');
    S.settings[key] = NUMERIC[key] ? Number(raw) : raw;
    persistSettings();
    invalidateCfg();
    render();
    if (key === 'engine' || key === 'accent') { Speech.unlock(); Speech.pronounce('vocabulary'); }
  }

  function toggleSetting(key) {
    S.settings[key] = !S.settings[key];
    persistSettings();
    render();
  }

  // ── 学习卡片的交互 ──
  $('btnQuit').addEventListener('click', function () {
    // 已评分的卡片在 applyRating 里就落盘了，退出不丢任何东西
    var rated = S.session ? S.session.ratings.reduce(function (a, b) { return a + b; }, 0) : 0;
    finishSession(true);
    toast(rated > 0 ? '已退出，' + rated + ' 张的进度都存好了' : '已退出，进度随时保留');
  });

  // 卡片内容是按题型动态生成的，没法提前绑事件，所以统一委托到 #card 上
  $('card').addEventListener('click', function (e) {
    var cur = currentCard();

    // 喇叭：四种题型通用
    if (e.target.closest('.speak') || e.target.closest('.big-speak')) {
      e.stopPropagation();
      if (cur) { Speech.unlock(); Speech.pronounce(cur.word.word); }
      return;
    }
    // 点例句 → 朗读整句
    if (e.target.closest('#cardExEn')) {
      if (cur && cur.word.example_en) { Speech.unlock(); Speech.tts(cur.word.example_en); }
      return;
    }
    // 认词模式：点卡片任意处显示释义
    var s = S.session;
    if (!s || s.answered || s.revealed || !cur) return;
    if (cur.mode === 'recognize' && !e.target.closest('.reveal')) revealCard();
  });

  document.addEventListener('keydown', function (e) {
    var s = S.session;
    if (!s) return;
    if (e.key === 'Escape') { finishSession(true); return; }

    // 打字题：输入框里回车 = 提交 / 继续（桌面上测试用）
    if (e.target && e.target.id === 'typeInput' && e.key === 'Enter') {
      e.preventDefault();
      if (s.answered) nextQuestion(); else submitTyping();
      return;
    }

    var cur = currentCard();
    if (!cur) return;

    if (s.answered) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); nextQuestion(); }
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (cur.mode === 'recognize' && !s.revealed) revealCard();
      return;
    }
    if (/^[1-4]$/.test(e.key)) {
      e.preventDefault();
      if (cur.mode === 'choice') pickChoice(+e.key - 1);
      else if (cur.mode === 'recognize' && s.revealed) applyRating(+e.key - 1);
    }
  });

  // 设置项里的文本框 / 下拉框：只在 change 时写回，避免边打字边重绘把光标顶掉
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || !el.getAttribute || !el.getAttribute('data-input')) return;
    var key = el.getAttribute('data-input');
    if (key === 'aiProvider') {
      S.settings.aiProvider = el.value;
      S.settings.aiModel = '';   // 换服务商就清掉模型名，免得张冠李戴
    } else {
      S.settings[key] = String(el.value || '').trim();
    }
    persistSettings();
    render();
  });

  // AI 输入框：只更新按钮文案，不整页重绘（重绘会把焦点和光标位置弄丢）
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || el.id !== 'aiInput') return;
    aiState().input = el.value;
    var btn = $('aiGo');
    if (btn) btn.textContent = aiKindOf(el.value) === 'word' ? 'AI 补全这个词条' : 'AI 挑出其中的生词';
  });

  // 页面切到后台时停掉正在播的声音
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) Speech.stop();
  });

  /* ═══════════════ 14. 启动 ═══════════════ */

  function boot() {
    loadAll();
    Speech.init();

    fetch('words.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        S.builtin = data.words || [];
        rebuildWords();
        render();
        // 顺便问一句本机代理在不在。没有也不影响，AI 会退化成浏览器直连或提示未配置
        AI.detect().then(function () { if (S.view === 'ai' || S.view === 'settings') render(); });
      })
      .catch(function (err) {
        $('app').innerHTML =
          '<div class="view on"><div class="masthead"><div class="mark">日课</div></div>' +
          '<div class="rule-double"></div>' +
          '<div class="empty">词库加载失败：' + esc(err.message) +
          '<br><br>如果在手机上打开，请确认手机和电脑在同一个 WiFi 下，' +
          '并且地址栏里是电脑的局域网 IP。</div></div>';
      });

    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
