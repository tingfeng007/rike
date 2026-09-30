/**
 * 语法模块的纯逻辑（无 React、无存储依赖，可直接单测）。
 *
 * 两部分能力：
 * 1. `buildGrammarQuiz` / `gradeGrammarAnswer` —— 由内置语料生成可复现的练习。
 *    题目的**正确答案来自语料标注**（人工校对），不是靠判定器猜出来的。
 * 2. `detectSentencePattern` —— 启发式句型判定，用于「自己输入句子看看」。
 *    它只认识内置的系动词 / 双宾动词 / 宾补动词与常见动词词形；超出范围会诚实地返回
 *    `unknown`，此时 UI 会引导用户改用 AI 拆句，而不是给一个可能错误的答案。
 */

import {
  GRAMMAR_PATTERNS,
  GRAMMAR_ROLES,
  getAllGrammarExamples,
  getAllGrammarPitfalls,
  getGrammarPattern,
} from '../data/grammar.js';

// --- 词表 -----------------------------------------------------------------------------

const BE_FORMS = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being']);

const LINKING_VERBS = new Set([
  'become', 'becomes', 'became', 'seem', 'seems', 'seemed', 'appear', 'appears', 'appeared',
  'look', 'looks', 'looked', 'feel', 'feels', 'felt', 'smell', 'smells', 'smelled', 'smelt',
  'taste', 'tastes', 'tasted', 'sound', 'sounds', 'sounded', 'remain', 'remains', 'remained',
  'stay', 'stays', 'stayed', 'keep', 'keeps', 'kept', 'turn', 'turns', 'turned', 'grow',
  'grows', 'grew', 'prove', 'proves', 'proved', 'get', 'gets', 'got',
]);

/** 常见双宾动词（人 + 物）。 */
const DITRANSITIVE_VERBS = new Set([
  'give', 'gives', 'gave', 'given', 'tell', 'tells', 'told', 'send', 'sends', 'sent',
  'show', 'shows', 'showed', 'shown', 'bring', 'brings', 'brought', 'offer', 'offers',
  'offered', 'lend', 'lends', 'lent', 'teach', 'teaches', 'taught', 'buy', 'buys', 'bought',
  'write', 'writes', 'wrote', 'written', 'pass', 'passes', 'passed', 'hand', 'hands', 'handed',
  'ask', 'asks', 'asked', 'pay', 'pays', 'paid', 'promise', 'promises', 'promised', 'wish',
  'wishes', 'wished', 'cook', 'cooks', 'cooked', 'find', 'finds', 'found',
]);

/** 常见宾补动词：这些动词后面跟"宾语 + 补足语"，不需要额外判断。 */
const STRICT_COMPLEX_VERBS = new Set([
  'make', 'makes', 'made', 'let', 'lets', 'elect', 'elects', 'elected', 'consider',
  'considers', 'considered', 'call', 'calls', 'called', 'name', 'names', 'named',
  'want', 'wants', 'wanted',
]);

/** 主句动词与宾补动词同形的常见词：只有末位是形容词 / 分词时才判为宾补。 */
const AMBIGUOUS_MULTI_VERBS = new Set([
  'have', 'has', 'had', 'get', 'gets', 'got', 'find', 'finds', 'found', 'keep', 'keeps',
  'kept', 'leave', 'leaves', 'left', 'see', 'sees', 'saw', 'seen', 'hear', 'hears', 'heard',
  'watch', 'watches', 'watched', 'ask', 'asks', 'asked',
]);

/** 复数形式与动词同形的名词：紧跟在限定词后面时按名词处理。 */
const NOUN_VERB_HOMOGRAPHS = new Set([
  'leaves', 'works', 'hands', 'turns', 'names', 'calls', 'tastes', 'looks', 'sounds',
  'feels', 'smells', 'watches', 'asks', 'rains', 'books', 'faces', 'matters', 'means',
  'ends', 'stays', 'keeps', 'finds',
]);

const DETERMINERS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its',
  'our', 'their',
]);

/** 语料里出现的其他动词（含不及物与及物），用于识别谓语位置。 */
const COMMON_VERBS = new Set([
  'fly', 'flies', 'flew', 'sleep', 'sleeps', 'slept', 'arrive', 'arrives', 'arrived',
  'happen', 'happens', 'happened', 'work', 'works', 'worked', 'listen', 'listens', 'listened',
  'love', 'loves', 'loved', 'like', 'likes', 'liked', 'read', 'reads', 'build', 'builds',
  'built', 'finish', 'finishes', 'finished', 'visit', 'visits', 'visited', 'marry', 'marries',
  'married', 'agree', 'agrees', 'agreed', 'explain', 'explains', 'explained', 'meet', 'meets',
  'met', 'enjoy', 'enjoys', 'enjoyed', 'go', 'goes', 'went', 'come', 'comes', 'came',
  'fall', 'falls', 'fell', 'cry', 'cries', 'cried', 'play', 'plays', 'played', 'run', 'runs',
  'ran', 'walk', 'walks', 'walked', 'talk', 'talks', 'talked', 'laugh', 'laughs', 'laughed',
]);

const PREPOSITIONS = new Set([
  'in', 'on', 'at', 'for', 'to', 'with', 'from', 'by', 'of', 'about', 'during', 'after',
  'before', 'under', 'over', 'into', 'near', 'behind', 'between',
]);

const IRREGULAR_PARTICIPLES = new Set([
  'given', 'told', 'sent', 'shown', 'brought', 'made', 'kept', 'found', 'written', 'built',
  'taken', 'seen', 'heard', 'eaten', 'done', 'put', 'left', 'sold', 'held', 'read',
  // 被动语态识别需要：be + 过去分词。缺一个就会把被动句误判成主系表。
  'broken', 'spoken', 'chosen', 'driven', 'forgotten', 'begun', 'drunk', 'sung', 'stolen',
  'woken', 'frozen', 'hidden', 'ridden', 'risen', 'shaken', 'thrown', 'worn', 'torn',
  'sworn', 'drawn', 'grown', 'known', 'blown', 'flown', 'beaten', 'bitten', 'burnt',
]);

// --- 工具 -----------------------------------------------------------------------------

/** 与 nceExam 相同的可复现洗牌（同一 seed 必得同一顺序）。 */
function seededShuffle(items, seedText) {
  const result = [...items];
  let seed = Array.from(String(seedText)).reduce(
    (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
    17,
  );
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function tokenize(sentence) {
  return String(sentence || '').match(/[A-Za-z][A-Za-z'-]*/g) || [];
}

/** 以 -ly 结尾但不是副词（不参与"副词不算成分"的过滤）。 */
const LY_EXCEPTIONS = new Set([
  'family', 'italy', 'july', 'supply', 'reply', 'apply', 'fly', 'belly', 'jelly', 'silly',
  'friendly', 'lovely', 'likely', 'early', 'daily', 'weekly', 'monthly', 'lonely',
]);

/** 副词只作状语，不可能是宾语 / 表语，计数句型成分时应排除。 */
function isAdverb(token) {
  const word = String(token || '').toLowerCase();
  return /ly$/.test(word) && !LY_EXCEPTIONS.has(word);
}

/** 取谓语之后、第一个介词之前的实词（介词短语一般作状语，不算句型成分）。 */
function tokensAfterVerb(tokens, verbIndex) {
  const tail = [];
  for (let i = verbIndex + 1; i < tokens.length; i += 1) {
    const word = tokens[i].toLowerCase();
    if (PREPOSITIONS.has(word)) break;
    if (isAdverb(word)) continue;
    tail.push(tokens[i]);
  }
  return tail;
}

/** 常见形容词（用于区分"宾补"与"双宾"这两种都跟两个成分的结构）。 */
const COMMON_ADJECTIVES = new Set([
  'empty', 'happy', 'closed', 'open', 'clean', 'tired', 'ready', 'clear', 'quiet', 'busy',
  'sure', 'sorry', 'interesting', 'interested', 'delicious', 'beautiful', 'good', 'well',
  'kind', 'nice', 'safe', 'angry', 'proud', 'yellow', 'red', 'green', 'blue', 'cold',
  'warm', 'hot', 'young', 'old', 'easy', 'hard', 'true', 'false', 'president', 'chairman',
]);

function isLikelyAdjective(token) {
  const word = String(token || '').toLowerCase();
  if (COMMON_ADJECTIVES.has(word)) return true;
  if (IRREGULAR_PARTICIPLES.has(word)) return true;
  // 只认比较可靠的形容词后缀，避免把 student / parent 这类名词误判成形容词。
  return /(?:ful|ous|ive|able|ible)$/.test(word);
}

// --- 句型判定 -------------------------------------------------------------------------

/**
 * 启发式判断句子属于哪种基本句型。
 *
 * @param {string} sentence
 * @returns {{ pattern: 'sv'|'svo'|'svp'|'svoo'|'svoc'|'there-be'|'unknown', reason: string, verbIndex: number }}
 */
export function detectSentencePattern(sentence) {
  const tokens = tokenize(sentence);
  const lower = tokens.map((token) => token.toLowerCase());
  const unknown = (reason) => ({ pattern: 'unknown', reason, verbIndex: -1 });

  if (tokens.length < 2) return unknown('句子太短，至少需要一个主语和一个谓语。');

  // There be
  if (lower[0] === 'there' && (BE_FORMS.has(lower[1]) || LINKING_VERBS.has(lower[1]))) {
    return { pattern: 'there-be', reason: 'there 是引导词，be 后面的名词才是主语。', verbIndex: 1 };
  }

  // 谓语位置：第一个看起来像动词的词（首词默认视作主语）。
  // 紧随限定词之后的"动词同形名词"（The leaves…）要跳过，否则会把主语里的名词当成谓语。
  const isCandidate = (index) => {
    const word = lower[index];
    if (DETERMINERS.has(lower[index - 1]) && NOUN_VERB_HOMOGRAPHS.has(word)) return false;
    return BE_FORMS.has(word) || LINKING_VERBS.has(word) || DITRANSITIVE_VERBS.has(word)
      || STRICT_COMPLEX_VERBS.has(word) || AMBIGUOUS_MULTI_VERBS.has(word) || COMMON_VERBS.has(word);
  };

  let verbIndex = -1;
  for (let i = 1; i < tokens.length; i += 1) {
    if (isCandidate(i)) {
      verbIndex = i;
      break;
    }
  }
  // 兜底：没命中词表时，认第一个带常见动词词尾的词（cried / played / running…）。
  if (verbIndex === -1) {
    for (let i = 1; i < tokens.length; i += 1) {
      const word = lower[i];
      if (DETERMINERS.has(lower[i - 1]) && NOUN_VERB_HOMOGRAPHS.has(word)) continue;
      if (/(?:s|es|ed|ing)$/.test(word)) {
        verbIndex = i;
        break;
      }
    }
  }
  if (verbIndex === -1) {
    return unknown('没有识别出谓语动词，可换一种写法或改用 AI 拆句。');
  }

  let verb = lower[verbIndex];
  let tail = tokensAfterVerb(tokens, verbIndex);

  // be + 现在分词是进行时，"is sleeping"整体是谓语，不是"系动词 + 表语"。
  if (BE_FORMS.has(verb) && tail.length > 0 && /ing$/.test(tail[0].toLowerCase())) {
    verbIndex += 1;
    verb = tail[0].toLowerCase();
    tail = tail.slice(1);
  }

  if (BE_FORMS.has(verb) || LINKING_VERBS.has(verb)) {
    // be + 过去分词多半是被动语态，不属于五大基本句型，宁可说"不确定"。
    if (tail.length > 0 && (IRREGULAR_PARTICIPLES.has(tail[0].toLowerCase())
      || (/ed$/.test(tail[0].toLowerCase()) && !isLikelyAdjective(tail[0])))) {
      return unknown('这看起来是被动语态，不在这五种基本句型的判定范围内。');
    }
    // keep / get / have / find 等既是系动词也能带宾补："She kept calm"（主系表）与
    // "She kept the door closed"（主谓宾补）靠后面成分的数量与词性区分。
    const ambiguousMulti = AMBIGUOUS_MULTI_VERBS.has(verb);
    if (!(ambiguousMulti && tail.length >= 2)) {
      const hasFollowingTokens = tokens.length > verbIndex + 1;
      if (tail.length === 0 && !hasFollowingTokens) {
        return unknown('系动词后面缺表语，句子可能不完整。');
      }
      return { pattern: 'svp', reason: '系动词后面的成分说明主语的身份 / 性质 / 状态，是表语。', verbIndex };
    }
  }

  const inStrictComplex = STRICT_COMPLEX_VERBS.has(verb);
  const inAmbiguous = AMBIGUOUS_MULTI_VERBS.has(verb);
  const inDitransitive = DITRANSITIVE_VERBS.has(verb);

  if ((inStrictComplex || inAmbiguous || inDitransitive) && tail.length >= 2) {
    const lastWord = tail[tail.length - 1];
    // find / get / keep 既能带双宾（find me a seat）也能带宾补（find the room empty），
    // 只能靠末位成分是不是形容词 / 分词来区分。
    if (inStrictComplex || isLikelyAdjective(lastWord)) {
      return { pattern: 'svoc', reason: '宾语后面的成分补充说明宾语（可在两者之间加 be 检验）。', verbIndex };
    }
    if (inDitransitive) {
      return { pattern: 'svoo', reason: '动词后面跟了“给谁”和“给了什么”两个宾语。', verbIndex };
    }
    return { pattern: 'svo', reason: '动词需要一个承受动作的宾语。', verbIndex };
  }

  if (tail.length >= 1) {
    return { pattern: 'svo', reason: '动词需要一个承受动作的宾语，去掉后句子不完整。', verbIndex };
  }
  return { pattern: 'sv', reason: '动词是不及物动词，后面不需要宾语。', verbIndex };
}

// --- 练习生成 -------------------------------------------------------------------------

const ROLE_DISTRACTORS = GRAMMAR_ROLES.filter((role) => role !== '谓语');

function buildPatternQuestion(example, seed) {
  const others = GRAMMAR_PATTERNS.filter((pattern) => pattern.id !== example.patternId);
  const distractors = seededShuffle(others, `${seed}:${example.id}:p`).slice(0, 3);
  return {
    id: `p-${example.id}`,
    type: 'pattern',
    patternId: example.patternId,
    prompt: example.en,
    hint: '这句话属于哪种基本句型？',
    options: seededShuffle([example.patternId, ...distractors.map((item) => item.id)], `${seed}:${example.id}:po`)
      .map((id) => ({ value: id, label: getGrammarPattern(id)?.name || id })),
    answer: example.patternId,
    explanation: `${example.en} — ${example.parts.map((part) => `${part.text}（${part.role}）`).join(' + ')}。${getGrammarPattern(example.patternId)?.summary || ''}`,
  };
}

function buildRoleQuestion(example, partIndex, distractors, seed) {
  const part = example.parts[partIndex];
  const roles = new Set([part.role, ...distractors]);
  return {
    id: `r-${example.id}-${partIndex}`,
    type: 'role',
    patternId: example.patternId,
    prompt: example.en,
    highlight: part.text,
    hint: '划线的部分在句中充当什么成分？',
    options: seededShuffle([...roles], `${seed}:${example.id}:${partIndex}:ro`)
      .map((role) => ({ value: role, label: role })),
    answer: part.role,
    explanation: `${part.text} 是${part.role}。整句结构：${example.parts.map((item) => `${item.text}（${item.role}）`).join(' + ')}。`,
  };
}

function buildFixQuestion(pitfall, allPitfalls, seed) {
  const others = allPitfalls.filter((item) => item.id !== pitfall.id);
  const picks = seededShuffle(others, `${seed}:${pitfall.id}:f`).slice(0, 2);
  const candidates = [pitfall.right, pitfall.wrong, ...picks.map((item) => item.right)];
  const options = seededShuffle([...new Set(candidates)], `${seed}:${pitfall.id}:fo`).slice(0, 4);
  return {
    id: `f-${pitfall.id}`,
    type: 'fix',
    patternId: pitfall.patternId,
    prompt: pitfall.wrong,
    hint: '下面哪一句是正确的？',
    options: options.map((sentence) => ({ value: sentence, label: sentence })),
    answer: pitfall.right,
    explanation: pitfall.explanation,
  };
}

/**
 * 生成一套可复现的语法练习。
 *
 * @param {{ count?: number, seed?: string|number, types?: Array<'pattern'|'role'|'fix'> }} [options]
 * @returns {Array<object>} 题目数组（答案来自语料标注）
 */
export function buildGrammarQuiz({ count = 5, seed = '', types = ['pattern', 'role', 'fix'] } = {}) {
  const examples = getAllGrammarExamples();
  const pitfalls = getAllGrammarPitfalls();
  const seedText = String(seed);

  const patternPool = seededShuffle(examples, `${seedText}:examples`);
  const rolePool = seededShuffle(
    examples.flatMap((example) => example.parts.map((part, index) => ({ example, index, part }))),
    `${seedText}:roles`,
  );
  const fixPool = seededShuffle(pitfalls, `${seedText}:pitfalls`);

  const questions = [];
  let patternCursor = 0;
  let roleCursor = 0;
  let fixCursor = 0;

  for (let i = 0; i < Math.max(1, count); i += 1) {
    const type = types[i % types.length];

    if (type === 'role') {
      // 找成分题跳过"引导词 / 状语"等不易考的标注，优先考主干成分。
      let picked = null;
      while (roleCursor < rolePool.length) {
        const candidate = rolePool[roleCursor];
        roleCursor += 1;
        if (['主语', '谓语', '宾语', '表语', '间接宾语', '直接宾语', '宾语补足语'].includes(candidate.part.role)) {
          picked = candidate;
          break;
        }
      }
      if (!picked) continue;
      const distractors = seededShuffle(ROLE_DISTRACTORS, `${seedText}:${picked.example.id}:d`).slice(0, 3);
      questions.push(buildRoleQuestion(picked.example, picked.index, distractors, seedText));
      continue;
    }

    if (type === 'fix') {
      const pitfall = fixPool[fixCursor % fixPool.length];
      fixCursor += 1;
      questions.push(buildFixQuestion(pitfall, pitfalls, seedText));
      continue;
    }

    const example = patternPool[patternCursor % patternPool.length];
    patternCursor += 1;
    questions.push(buildPatternQuestion(example, seedText));
  }

  return questions;
}

export function gradeGrammarAnswer(question, answer) {
  if (!question) return false;
  return question.answer === answer;
}

/**
 * 把一个句子按要强调的片段拆成前 / 中 / 后三段（用于「找成分」题的高亮）。
 * 找不到时 `match` 为空字符串，调用方按普通句子渲染即可。
 *
 * @returns {{ before: string, match: string, after: string }}
 */
export function splitHighlight(text, highlight) {
  const source = String(text || '');
  const needle = String(highlight || '');
  if (!needle) return { before: source, match: '', after: '' };
  const index = source.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return { before: source, match: '', after: '' };
  return {
    before: source.slice(0, index),
    match: source.slice(index, index + needle.length),
    after: source.slice(index + needle.length),
  };
}

// --- 进度 -----------------------------------------------------------------------------

/** 纯函数：把一次答题结果并入进度对象（写盘交给 storage）。 */
export function applyGrammarAnswer(progress, { patternId, correct, questionId = '', sentence = '', at = Date.now() } = {}) {
  const base = progress && typeof progress === 'object' ? progress : {};
  const answers = { ...(base.answers || {}) };
  const key = patternId || 'unknown';
  const current = answers[key] || { correct: 0, total: 0 };
  answers[key] = {
    correct: current.correct + (correct ? 1 : 0),
    total: current.total + 1,
  };

  const missed = Array.isArray(base.missed) ? [...base.missed] : [];
  if (!correct && questionId) {
    const existingIndex = missed.findIndex((item) => item.questionId === questionId);
    const entry = { questionId, sentence, patternId: key, at };
    if (existingIndex >= 0) missed[existingIndex] = entry;
    else missed.unshift(entry);
  } else if (correct && questionId) {
    const index = missed.findIndex((item) => item.questionId === questionId);
    if (index >= 0) missed.splice(index, 1);
  }

  const totalAnswered = Object.values(answers).reduce((sum, item) => sum + item.total, 0);
  const totalCorrect = Object.values(answers).reduce((sum, item) => sum + item.correct, 0);

  return {
    answers,
    missed: missed.slice(0, 50),
    totalAnswered,
    totalCorrect,
    accuracy: totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0,
    updatedAt: at,
  };
}

/**
 * 汇总每个句型的掌握情况，供进度条与错题复习使用。
 */
export function summarizeGrammarProgress(progress) {
  const answers = (progress && progress.answers) || {};
  return GRAMMAR_PATTERNS.map((pattern) => {
    const item = answers[pattern.id] || { correct: 0, total: 0 };
    const accuracy = item.total ? Math.round((item.correct / item.total) * 100) : 0;
    let label = '未练习';
    if (item.total > 0) {
      if (accuracy >= 90 && item.total >= 3) label = '熟练';
      else if (accuracy >= 70) label = '掌握中';
      else label = '需加强';
    }
    return {
      patternId: pattern.id,
      name: pattern.name,
      correct: item.correct,
      total: item.total,
      accuracy,
      label,
    };
  });
}

/**
 * 数据自检：每个成分标注的文本必须真的出现在对应例句里。
 * 这条不变量保证「找成分」题不会问一个句子里根本不存在的片段。
 */
export function validateGrammarData() {
  const problems = [];
  getAllGrammarExamples().forEach((example) => {
    const normalized = String(example.en).toLowerCase();
    example.parts.forEach((part) => {
      if (!normalized.includes(String(part.text).toLowerCase())) {
        problems.push(`例句 “${example.en}” 的标注 “${part.text}” 不在原句中`);
      }
    });
    if (!example.parts.some((part) => part.role === '主语')) {
      problems.push(`例句 “${example.en}” 缺少主语标注`);
    }
    if (!example.parts.some((part) => part.role === '谓语')) {
      problems.push(`例句 “${example.en}” 缺少谓语标注`);
    }
  });

  getAllGrammarPitfalls().forEach((pitfall) => {
    if (pitfall.wrong === pitfall.right) {
      problems.push(`易错句 “${pitfall.wrong}” 的“错误”与“正确”写法完全相同`);
    }
    if (!pitfall.explanation) {
      problems.push(`易错句 “${pitfall.wrong}” 缺少解释`);
    }
  });

  GRAMMAR_PATTERNS.forEach((pattern) => {
    if (!pattern.examples?.length) problems.push(`句型 ${pattern.id} 没有例句`);
    if (!pattern.pitfalls?.length) problems.push(`句型 ${pattern.id} 没有易错点`);
    if (!pattern.formula) problems.push(`句型 ${pattern.id} 缺少公式`);
  });

  return problems;
}
