/*!
 * 日课 · 间隔重复算法（SRS）
 *
 * 纯函数实现，不依赖 DOM，可直接在 Node 里测试：
 *     node tools/test-srs.mjs
 *
 * 设计要点
 *  1) 时间按「学习日」切分，凌晨 4 点前算前一天（熬夜学习不会被判成断签）
 *  2) 学习阶段用分钟级步进（1 分钟 / 10 分钟），毕业后才进入天级间隔
 *  3) 遗忘（忘了）不把间隔清零，而是缩水到 20%，避免"一夜回到解放前"
 *  4) 间隔加 ±5% 随机抖动，防止几百张卡堆在同一天
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SRS = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var DAY = 86400000;
  var MIN = 60000;

  /** 四档评分 */
  var RATING = { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 };

  var DEFAULTS = {
    dayBoundaryHour: 4,        // 一天从凌晨 4 点开始
    learningSteps: [1, 10],    // 学习阶段步进（分钟）
    graduatingInterval: 1,     // 毕业后的首个间隔（天）
    easyInterval: 4,           // 新词直接点「秒懂」的间隔（天）
    lapseMultiplier: 0.2,      // 遗忘后间隔保留比例
    easeStart: 2.5,
    easeMin: 1.3,
    easeMax: 3.0,
    easeBonus: 0.15,           // 「秒懂」加成
    easePenaltyHard: 0.15,     // 「模糊」扣减
    easePenaltyAgain: 0.2,     // 「忘了」扣减
    hardMultiplier: 1.2,       // 「模糊」的间隔倍率
    easyMultiplier: 1.3,       // 「秒懂」的额外倍率
    maxInterval: 730,          // 间隔上限（天）
    jitter: 0.05               // 天级间隔随机抖动幅度
  };

  function cfg(overrides) {
    var c = {};
    for (var k in DEFAULTS) c[k] = DEFAULTS[k];
    if (overrides) {
      for (var j in overrides) if (overrides[j] != null) c[j] = overrides[j];
      // 随机源可注入，测试里用它让结果可复现
      if (typeof overrides.rng === 'function') c.rng = overrides.rng;
    }
    return c;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /** 取 ts 所属「学习日」的起点时间戳 */
  function dayStart(ts, c) {
    c = c || DEFAULTS;
    var d = new Date(ts);
    var h = d.getHours();
    d.setHours(0, 0, 0, 0);
    if (h < c.dayBoundaryHour) d.setDate(d.getDate() - 1);
    return d.getTime();
  }

  /** 把时间戳格式化成 YYYY-MM-DD（按学习日） */
  function dayKey(ts, c) {
    c = c || DEFAULTS;
    var d = new Date(dayStart(ts, c));
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  /** 天级间隔加抖动（≥3 天才抖，短间隔抖了没意义） */
  function withJitter(days, c) {
    if (days < 3) return days;
    var rng = c.rng || Math.random;
    return days * (1 + (rng() * 2 - 1) * c.jitter);
  }

  /** 一张全新的卡片 */
  function newCard(now) {
    return {
      state: 'new',        // new | learning | review
      dueAt: now,
      intervalDays: 0,
      step: 0,
      ease: DEFAULTS.easeStart,
      reps: 0,
      lapses: 0,
      lastRating: null,
      graduatingInterval: DEFAULTS.graduatingInterval,
      history: []
    };
  }

  /**
   * 核心：对一张卡评分，返回新卡（不修改入参）
   * @param {object} card
   * @param {number} rating 0=忘了 1=模糊 2=记得 3=秒懂
   * @param {number} now    当前时间戳
   */
  function rate(card, rating, now, opts) {
    var c = cfg(opts);
    var out = {
      state: card.state,
      dueAt: card.dueAt,
      intervalDays: card.intervalDays || 0,
      step: card.step || 0,
      ease: card.ease == null ? c.easeStart : card.ease,
      reps: (card.reps || 0) + 1,
      lapses: card.lapses || 0,
      lastRating: rating,
      graduatingInterval: card.graduatingInterval == null ? c.graduatingInterval : card.graduatingInterval,
      history: (card.history || []).concat([{ t: now, r: rating }])
    };
    if (out.history.length > 60) out.history = out.history.slice(-60);

    var learning = card.state === 'new' || card.state === 'learning';
    var steps = c.learningSteps;

    if (learning) {
      if (rating === RATING.AGAIN) {
        // 回到第一步重来
        out.state = 'learning';
        out.step = 0;
        out.intervalDays = 0;
        out.dueAt = now + steps[0] * MIN;
      } else if (rating === RATING.HARD) {
        out.state = 'learning';
        out.intervalDays = 0;
        if (card.state === 'new') {
          // 新卡还没进过学习步。如果直接取 steps[0]，按钮上就会和「忘了」显示同一个
          // 间隔，用户点哪个都一样 —— 所以取前两步的中点（对应 Anki 新卡的 hard interval）
          var hardMin = steps.length > 1 ? Math.round((steps[0] + steps[1]) / 2) : steps[0];
          out.step = 0;
          out.dueAt = now + hardMin * MIN;
        } else {
          // 已经在学习里：重复当前这一步
          out.step = Math.min(card.step || 0, steps.length - 1);
          out.dueAt = now + steps[out.step] * MIN;
        }
      } else if (rating === RATING.GOOD) {
        // 新卡直接进第二个学习步，不要重复第一步（Anki 语义）
        var next = card.state === 'new' ? 1 : (card.step || 0) + 1;
        if (next < steps.length) {
          out.state = 'learning';
          out.step = next;
          out.intervalDays = 0;
          out.dueAt = now + steps[next] * MIN;
        } else {
          graduate(out, now, c);
        }
      } else {
        // 秒懂：直接毕业，并给个稍长的间隔
        out.ease = clamp(out.ease + c.easeBonus, c.easeMin, c.easeMax);
        out.state = 'review';
        out.step = 0;
        out.intervalDays = Math.max(out.graduatingInterval, c.easyInterval);
        out.dueAt = dayStart(now, c) + out.intervalDays * DAY;
      }
    } else {
      // 复习阶段
      if (rating === RATING.AGAIN) {
        out.lapses++;
        out.ease = clamp(out.ease - c.easePenaltyAgain, c.easeMin, c.easeMax);
        // 间隔缩水但不清零：这是"不推倒重来"的关键
        out.intervalDays = Math.max(1, Math.round((card.intervalDays || 1) * c.lapseMultiplier));
        out.graduatingInterval = out.intervalDays;
        out.state = 'learning';
        out.step = 0;
        out.dueAt = now + steps[0] * MIN;
      } else if (rating === RATING.HARD) {
        out.ease = clamp(out.ease - c.easePenaltyHard, c.easeMin, c.easeMax);
        out.intervalDays = schedule(out, card, Math.max(card.intervalDays + 1, card.intervalDays * c.hardMultiplier), now, c);
      } else if (rating === RATING.GOOD) {
        out.intervalDays = schedule(out, card, card.intervalDays * out.ease, now, c);
      } else {
        out.ease = clamp(out.ease + c.easeBonus, c.easeMin, c.easeMax);
        out.intervalDays = schedule(out, card, card.intervalDays * out.ease * c.easyMultiplier, now, c);
      }
    }
    return out;
  }

  function graduate(out, now, c) {
    out.state = 'review';
    out.step = 0;
    out.intervalDays = out.graduatingInterval || c.graduatingInterval;
    out.dueAt = dayStart(now, c) + out.intervalDays * DAY;
  }

  function schedule(out, card, rawDays, now, c) {
    var d = clamp(withJitter(rawDays, c), 1, c.maxInterval);
    out.state = 'review';
    out.step = 0;
    out.dueAt = dayStart(now, c) + Math.round(d) * DAY;
    return d;
  }

  /** 这张卡现在该复习吗 */
  function isDue(card, now) {
    return !card || card.state === 'new' || card.dueAt <= now;
  }

  /** 距离到期的可读描述 */
  function formatDelay(ms) {
    if (ms < 0) return '现在';
    if (ms < 3600000) return Math.max(1, Math.round(ms / MIN)) + ' 分钟';
    if (ms < DAY) return Math.round(ms / 3600000) + ' 小时';
    return formatDays(ms / DAY);
  }

  function formatDays(d) {
    if (d < 1) return '1 天内';
    if (d < 30) return Math.round(d) + ' 天';
    if (d < 365) return Math.round(d / 30) + ' 个月';
    return (d / 365).toFixed(1) + ' 年';
  }

  /** 按钮上显示的「下次何时再见」预览 */
  function describe(card, rating, now, opts) {
    var c = cfg(opts);
    var out = rate(card, rating, now, c);
    if (out.state === 'learning') return formatDelay(out.dueAt - now);
    return formatDays(out.intervalDays);
  }

  /** 人类可读的卡片状态 */
  function statusOf(card) {
    if (!card || card.state === 'new') return 'new';
    if (card.state === 'learning') return 'learning';
    if (card.intervalDays >= 30) return 'mastered';
    return 'review';
  }

  return {
    RATING: RATING,
    DEFAULTS: DEFAULTS,
    DAY: DAY,
    MIN: MIN,
    cfg: cfg,
    dayStart: dayStart,
    dayKey: dayKey,
    newCard: newCard,
    rate: rate,
    isDue: isDue,
    describe: describe,
    formatDays: formatDays,
    formatDelay: formatDelay,
    statusOf: statusOf
  };
});
