/*!
 * 日课 · 题型引擎
 *
 * 纯函数，不依赖 DOM，可直接在 Node 里测试：
 *     node tools/test-quiz.mjs
 *
 * 设计要点
 *  1) 一个词只有一份记忆状态（复习量不会因为加了题型就翻三倍），
 *     但每个题型单独记 ok/fail 计数，考砸过的题型会被优先补考。
 *  2) 没见过、还在学习阶段的词只能「认词」。拼一个从没见过的词没有意义。
 *  3) 判分区分「全对 / 差一点 / 不会」。拼错一个字母当 typo 处理（映射到「模糊」），
 *     而不是「忘了」—— 不然一个手滑就把攒了很久的间隔打回原形，很打击人。
 *     短词从严：4 个字母以内拼错一个字母就是错，因为 cat / cut 是两个字。
 *  4) 所有随机源可注入，测试才能复现。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Quiz = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var MODES = ['recognize', 'spell', 'listen', 'choice'];
  var MODE_LABEL = { recognize: '认词', spell: '拼写', listen: '听音', choice: '选义' };
  var TYPING_MODES = ['spell', 'listen'];

  var RATING = { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 };

  /* ── 编辑距离 ── */
  function levenshtein(a, b) {
    a = String(a); b = String(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      for (var k = 1; k <= b.length; k++) {
        var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  /** 归一化：统一大小写、弯引号、多余空格。中文释义不参与归一化，只用于选择题。 */
  function normalize(s) {
    return String(s == null ? '' : s)
      .trim()
      .toLowerCase()
      .replace(/[\u2018\u2019\u02bc]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/\s+/g, ' ');
  }

  /** 允许拼错几个字母还判「差一点」 */
  function toleranceFor(answer) {
    var n = String(answer || '').replace(/\s/g, '').length;
    if (n >= 9) return 2;
    if (n >= 5) return 1;
    return 0;
  }

  /**
   * 给打字类题目判分
   * @returns {{verdict:'right'|'typo'|'wrong'|'empty', rating:number|null, dist?:number, tolerance?:number}}
   */
  function gradeTyping(input, answer) {
    var a = normalize(input);
    var b = normalize(answer);
    if (!a) return { verdict: 'empty', rating: null };
    if (a === b) return { verdict: 'right', rating: RATING.GOOD };
    var tol = toleranceFor(b);
    var d = levenshtein(a, b);
    if (d <= tol) return { verdict: 'typo', rating: RATING.HARD, dist: d, tolerance: tol };
    return { verdict: 'wrong', rating: RATING.AGAIN, dist: d, tolerance: tol };
  }

  /** 选择题判分 */
  function gradeChoice(picked, answer) {
    if (picked == null) return { verdict: 'empty', rating: null };
    return String(picked) === String(answer)
      ? { verdict: 'right', rating: RATING.GOOD }
      : { verdict: 'wrong', rating: RATING.AGAIN };
  }

  /**
   * 这张卡这次用什么题型
   * @param {object} card    学习进度（可能为 null）
   * @param {object} enabled 各题型开关 { spell, listen, choice }
   * @param {function} rng   随机源，可注入
   */
  function pickMode(card, enabled, rng) {
    enabled = enabled || {};
    rng = rng || Math.random;

    // 没见过 / 还在学习阶段：只能认词
    if (!card || card.state === 'new' || card.state === 'learning') return 'recognize';

    var skills = card.skills || {};
    var fail = function (m) { return (skills[m] && skills[m].fail) || 0; };

    // 考砸过的题型优先补考
    if (enabled.listen && fail('listen') > 0 && rng() < 0.5) return 'listen';
    if (enabled.spell && fail('spell') > 0 && rng() < 0.5) return 'spell';

    // 间隔还太短的词老实认词，别一上来就让人拼
    if ((card.intervalDays || 0) < 3) return 'recognize';

    // 认词占一半，其余题型平分剩下的一半
    var others = [];
    if (enabled.spell) others.push('spell');
    if (enabled.listen) others.push('listen');
    if (enabled.choice) others.push('choice');
    if (!others.length) return 'recognize';

    var each = 0.5 / others.length;
    var r = rng();
    if (r < 0.5) return 'recognize';
    var idx = Math.floor((r - 0.5) / each);
    return others[Math.min(idx, others.length - 1)];
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /**
   * 造选择题的选项。优先挑同词性的词当干扰项，读起来才像回事。
   * @returns {Array<{text:string, ok:boolean}>} 选项少于 2 个说明词库太小，调用方应退回认词模式
   */
  function buildChoices(word, pool, rng, count) {
    count = count || 4;
    rng = rng || Math.random;
    if (!word || !word.meaning_cn) return [];

    var correct = word.meaning_cn;
    var cands = (pool || []).filter(function (w) {
      return w && w.id !== word.id && w.meaning_cn && w.meaning_cn !== correct;
    });

    // 同词性排前面
    cands = shuffle(cands, rng).sort(function (a, b) {
      var pa = a.pos === word.pos ? 0 : 1;
      var pb = b.pos === word.pos ? 0 : 1;
      return pa - pb;
    });

    var head = cands.slice(0, Math.max(count * 3, 12));
    var picked = [];
    var seen = {};
    seen[correct] = 1;
    for (var i = 0; i < head.length && picked.length < count - 1; i++) {
      var text = head[i].meaning_cn;
      if (seen[text]) continue;
      seen[text] = 1;
      picked.push({ text: text, ok: false });
    }

    if (!picked.length) return [];
    picked.push({ text: correct, ok: true });
    return shuffle(picked, rng);
  }

  /** 记录某个题型的作答结果，返回新的 skills（不改入参） */
  function recordSkill(skills, mode, ok, now) {
    var out = {};
    var src = skills || {};
    for (var k in src) out[k] = src[k];
    if (MODES.indexOf(mode) < 0) mode = 'recognize';
    var cur = out[mode] || { ok: 0, fail: 0, last: 0 };
    out[mode] = { ok: cur.ok + (ok ? 1 : 0), fail: cur.fail + (ok ? 0 : 1), last: now || 0 };
    return out;
  }

  /** 某个题型累计错了多少次 */
  function failCount(card, mode) {
    var s = (card && card.skills && card.skills[mode]) || null;
    return s ? s.fail : 0;
  }

  /** 拼写提示：首字母 + 剩余长度 */
  function hintOf(word) {
    var w = String(word || '');
    if (!w) return '';
    var dots = '';
    for (var i = 1; i < w.length; i++) dots += (w.charAt(i) === ' ' ? ' ' : '·');
    return w.charAt(0) + dots;
  }

  function isTyping(mode) { return TYPING_MODES.indexOf(mode) >= 0; }
  function label(mode) { return MODE_LABEL[mode] || mode; }

  return {
    MODES: MODES,
    MODE_LABEL: MODE_LABEL,
    TYPING_MODES: TYPING_MODES,
    RATING: RATING,
    levenshtein: levenshtein,
    normalize: normalize,
    toleranceFor: toleranceFor,
    gradeTyping: gradeTyping,
    gradeChoice: gradeChoice,
    pickMode: pickMode,
    buildChoices: buildChoices,
    recordSkill: recordSkill,
    failCount: failCount,
    hintOf: hintOf,
    isTyping: isTyping,
    label: label
  };
});
