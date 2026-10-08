// `.js` extension required: loaded directly by `node --test` (Vite would resolve either).
import { escapeRegExp } from './text.js';

const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'am', 'is', 'are', 'was', 'were', 'i', 'you', 'he', 'she', 'it',
  'we', 'they', 'this', 'that', 'to', 'of', 'in', 'on', 'at', 'and', 'or', 'but', 'for',
  'my', 'your', 'his', 'her', 'me', 'please', 'yes', 'no', 'not', 'have', 'has',
]);

function shuffled(items, seedText) {
  const result = [...items];
  let seed = Array.from(seedText).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 17);
  for (let index = result.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const other = seed % (index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function normalized(text) {
  return String(text || '').toLowerCase().replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Build a unit exam paper.
 *
 * @param {Array} lines parsed lesson lines (from `parseLrc`)
 * @param {string} unitId unit filename
 * @param {number} [limit] max number of questions
 * @param {string|number} [variant] attempt salt. Seeds were derived only from
 *   `unitId`/`line.id`, so every retake produced the *identical* paper (same questions,
 *   same option order) and the test measured answer memorisation. Pass a per-attempt
 *   value (e.g. the attempt count or start timestamp); omit it to keep the previous
 *   deterministic behaviour.
 */
export function buildNceExamQuestions(lines, unitId, limit = 10, variant = '') {
  // Keep the historical seeds exactly when no variant is supplied, so existing callers
  // (and tests) stay deterministic; only a per-attempt variant perturbs the paper.
  const hasVariant = variant !== '' && variant !== null && variant !== undefined;
  const salt = hasVariant ? `${unitId}#${variant}` : unitId;
  const uniqueEnglish = new Set();
  const usable = lines.filter((line) => {
    if (/^Lesson\s+\d+|^Listen to the tape/i.test(line.en || '')) return false;
    const english = normalized(line.en);
    if (!line.zh?.trim() || !english || uniqueEnglish.has(english)) return false;
    uniqueEnglish.add(english);
    return true;
  });

  const choiceLines = usable.filter((line) => (
    (line.en.match(/[A-Za-z']+/g) || []).length >= 2
    && usable.filter((other) => other.zh !== line.zh).length >= 2
  ));
  const choices = shuffled(choiceLines, `${salt}:choice`).slice(0, Math.ceil(limit / 2)).map((line) => {
    const alternatives = shuffled(
      usable.filter((other) => other.id !== line.id && other.zh !== line.zh),
      `${salt}:${line.id}:options`,
    ).slice(0, 3).map((item) => item.en);
    return {
      id: `${unitId}:meaning:${line.id}`,
      type: 'choice',
      prompt: '根据课文，选出对应的英文原句',
      question: line.zh,
      answer: line.en,
      options: shuffled([line.en, ...alternatives], `${salt}:${line.id}:order`),
      source: line.en,
      translation: line.zh,
    };
  });

  const blanks = shuffled(usable, `${salt}:blank`).flatMap((line) => {
    const words = line.en.match(/[A-Za-z][A-Za-z'-]*/g) || [];
    if (words.length < 2) return [];
    const answer = words.find((word) => word.length >= 3 && !FUNCTION_WORDS.has(word.toLowerCase()));
    if (!answer) return [];
    const escaped = escapeRegExp(answer);
    return [{
      id: `${unitId}:blank:${line.id}`,
      type: 'fill',
      prompt: '根据中文和语境，填写缺少的英文单词',
      question: line.en.replace(new RegExp(`\\b${escaped}\\b`, 'i'), '______'),
      answer,
      source: line.en,
      translation: line.zh,
    }];
  }).slice(0, Math.floor(limit / 2));

  const questions = [];
  while (choices.length || blanks.length) {
    if (choices.length) questions.push(choices.shift());
    if (blanks.length) questions.push(blanks.shift());
  }
  return questions.slice(0, limit);
}

export function gradeNceExam(questions, answers) {
  const results = questions.map((question) => {
    const submitted = String(answers?.[question.id] || '').trim();
    return {
      ...question,
      submitted,
      isCorrect: Boolean(submitted) && normalized(submitted) === normalized(question.answer),
    };
  });
  const correct = results.filter((result) => result.isCorrect).length;
  return {
    score: results.length ? Math.round((correct / results.length) * 100) : 0,
    correct,
    total: results.length,
    unanswered: results.filter((result) => !result.submitted).length,
    results,
  };
}

/** Commit the paper and course completion together; failed submissions keep their draft. */
export function commitNceExamAttempt(current, attempt, { persist, onComplete } = {}) {
  if (!current?.draft || current.attempts?.some((item) => item.id === attempt.id)) return null;
  const next = { attempts: [attempt, ...(current.attempts || [])].slice(0, 30), draft: null };
  if (!persist(next)) return null;
  try {
    if (onComplete?.(attempt) === false) { persist(current); return null; }
  } catch { persist(current); return null; }
  return next;
}
