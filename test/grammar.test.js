import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAMMAR_PATTERNS, GRAMMAR_COMPARISONS, getAllGrammarExamples } from '../src/data/grammar.js';
import { GRAMMAR_LESSONS } from '../src/data/grammarLessons.js';
import {
  buildGrammarQuiz,
  detectSentencePattern,
  gradeGrammarAnswer,
  applyGrammarAnswer,
  splitHighlight,
  summarizeGrammarProgress,
  validateGrammarData,
} from '../src/services/grammar.js';

/**
 * 语法模块（新功能）的回归测试。
 *
 * 最重要的一条：`detectSentencePattern` 必须与语料里**人工标注的句型完全一致** ——
 * 这既验证判定器，也反过来验证语料标注本身没有写错。
 */

test('内置语料自检通过（成分标注必须在原句里，且每个句型都有例句与易错点）', () => {
  assert.deepEqual(validateGrammarData(), []);
});

test('句型判定器与全部人工标注例句一致', () => {
  const examples = getAllGrammarExamples();
  assert.ok(examples.length >= 15, `语料量偏少：${examples.length}`);

  const mismatches = examples
    .map((example) => ({ example, got: detectSentencePattern(example.en).pattern }))
    .filter(({ example, got }) => got !== example.patternId)
    .map(({ example, got }) => `${example.en} 标注 ${example.patternId} 但判定为 ${got}`);

  assert.deepEqual(mismatches, [], '判定器与语料标注必须一致');
});

test('句型判定器覆盖五大基本句型与 there be', () => {
  assert.equal(detectSentencePattern('Birds fly.').pattern, 'sv');
  assert.equal(detectSentencePattern('I love music.').pattern, 'svo');
  assert.equal(detectSentencePattern('She is a teacher.').pattern, 'svp');
  assert.equal(detectSentencePattern('He gave me a book.').pattern, 'svoo');
  assert.equal(detectSentencePattern('They elected him president.').pattern, 'svoc');
  assert.equal(detectSentencePattern('There is a book on the desk.').pattern, 'there-be');
});

test('主谓宾与主系表的关键区分点可用 be 替换法检验', () => {
  // 系动词可换成 be 且句意不变 → 主系表
  assert.equal(detectSentencePattern('He became a doctor.').pattern, 'svp');
  // 及物动词换 be 后句意崩塌 → 主谓宾
  assert.equal(detectSentencePattern('He met a doctor.').pattern, 'svo');
  assert.equal(detectSentencePattern('The soup tastes delicious.').pattern, 'svp');
  // 系动词 + 副词是常见错误，判定器不因此改变结论（仍识别为系表结构）
  assert.equal(detectSentencePattern('The music sounds beautiful.').pattern, 'svp');
});

test('进行时不会被误判为主系表', () => {
  assert.equal(detectSentencePattern('The baby is sleeping.').pattern, 'sv');
  assert.equal(detectSentencePattern('She is reading a book.').pattern, 'svo');
});

test('限定词后的同形名词不会被当成谓语', () => {
  // "leaves" 既是 leaf 的复数也是 leave 的第三人称单数
  assert.equal(detectSentencePattern('The leaves turned yellow in autumn.').pattern, 'svp');
  assert.equal(detectSentencePattern('The leaves fall in autumn.').pattern, 'sv');
});

test('双宾与宾补靠"能否插入 be"区分', () => {
  assert.equal(detectSentencePattern('She told us a story.').pattern, 'svoo');
  assert.equal(detectSentencePattern('We found the room empty.').pattern, 'svoc');
  assert.equal(detectSentencePattern('She kept the door closed.').pattern, 'svoc');
  // 同一个 keep：后面只有一个成分时是系表
  assert.equal(detectSentencePattern('She kept calm.').pattern, 'svp');
});

test('副词与介词短语只作状语，不改变句型判定', () => {
  assert.equal(detectSentencePattern('The baby cried loudly.').pattern, 'sv');
  assert.equal(detectSentencePattern('Birds fly in the sky.').pattern, 'sv');
  assert.equal(detectSentencePattern('He arrived at the station.').pattern, 'sv');
});

test('判定器对超出能力范围的句子诚实返回 unknown 而不是猜', () => {
  const passive = detectSentencePattern('The window was broken by Tom.');
  assert.equal(passive.pattern, 'unknown');
  assert.match(passive.reason, /被动/);

  const noVerb = detectSentencePattern('do not know the answer');
  assert.equal(noVerb.pattern, 'unknown');
  assert.match(noVerb.reason, /谓语/);

  assert.equal(detectSentencePattern('').pattern, 'unknown');
  assert.equal(detectSentencePattern('Hello').pattern, 'unknown');
});

test('名词短语不按单词数误判双宾或宾补，时间词不误判宾语', () => {
  assert.equal(detectSentencePattern('I made a cake.').pattern, 'svo');
  assert.equal(detectSentencePattern('She gave a book.').pattern, 'svo');
  assert.equal(detectSentencePattern('I arrived yesterday.').pattern, 'sv');
  assert.equal(detectSentencePattern('She looks at me.').pattern, 'unknown');
  assert.equal(detectSentencePattern('The teacher who helped us lives nearby.').pattern, 'unknown');
  assert.equal(detectSentencePattern('The interesting books on the shelf.').pattern, 'unknown');
  assert.equal(detectSentencePattern('I can read a book.').pattern, 'unknown');
});

// --- 练习 -----------------------------------------------------------------------------

test('练习可复现且包含三种题型', () => {
  const first = buildGrammarQuiz({ count: 6, seed: 'unit-a' });
  const second = buildGrammarQuiz({ count: 6, seed: 'unit-a' });
  assert.deepEqual(first.map((q) => q.id), second.map((q) => q.id), '同 seed 必须完全一致');

  const types = new Set(first.map((q) => q.type));
  assert.ok(types.has('pattern'), '包含判断句型题');
  assert.ok(types.has('role'), '包含找成分题');
  assert.ok(types.has('fix'), '包含改错题');

  const other = buildGrammarQuiz({ count: 6, seed: 'unit-b' });
  assert.notDeepEqual(first.map((q) => q.id), other.map((q) => q.id), '不同 seed 应换一批');
});

test('每道题的答案都在选项中，且选项不重复', () => {
  for (const seed of ['a', 'b', 'c', 'd']) {
    const quiz = buildGrammarQuiz({ count: 9, seed });
    for (const question of quiz) {
      const values = question.options.map((option) => option.value);
      assert.equal(new Set(values).size, values.length, `${question.id} 选项重复`);
      assert.ok(values.includes(question.answer), `${question.id} 答案不在选项里`);
      assert.ok(question.options.length >= 2, `${question.id} 选项过少`);
      assert.ok(question.explanation, `${question.id} 缺少解析`);
    }
  }
});

test('找成分题的划线内容必须真的出现在题干句子里', () => {
  const quiz = buildGrammarQuiz({ count: 12, seed: 'role-check' });
  const roleQuestions = quiz.filter((q) => q.type === 'role');
  assert.ok(roleQuestions.length > 0, '应生成找成分题');
  for (const question of roleQuestions) {
    assert.ok(
      question.prompt.toLowerCase().includes(question.highlight.toLowerCase()),
      `划线“${question.highlight}”不在“${question.prompt}”中`,
    );
  }
});

test('改错题的正确答案是正确句，而不是错误句', () => {
  const quiz = buildGrammarQuiz({ count: 12, seed: 'fix-check' });
  const fixQuestions = quiz.filter((q) => q.type === 'fix');
  assert.ok(fixQuestions.length > 0, '应生成改错题');
  for (const question of fixQuestions) {
    assert.notEqual(question.answer, question.prompt, '答案不能是题目里的错误句');
  }
});

test('评分与进度累加', () => {
  const [question] = buildGrammarQuiz({ count: 1, seed: 'grade' });
  assert.equal(gradeGrammarAnswer(question, question.answer), true);
  assert.equal(gradeGrammarAnswer(question, '__wrong__'), false);
  assert.equal(gradeGrammarAnswer(null, 'x'), false);

  let progress = applyGrammarAnswer(null, { patternId: 'sv', correct: true, questionId: 'q1' });
  assert.equal(progress.totalAnswered, 1);
  assert.equal(progress.accuracy, 100);

  progress = applyGrammarAnswer(progress, { patternId: 'sv', correct: false, questionId: 'q2', sentence: 'Birds fly.' });
  assert.equal(progress.answers.sv.total, 2);
  assert.equal(progress.answers.sv.correct, 1);
  assert.equal(progress.accuracy, 50);
  assert.equal(progress.missed.length, 1, '错题进入复习列表');

  // 同一道错题再答对要移出复习列表
  progress = applyGrammarAnswer(progress, { patternId: 'sv', correct: true, questionId: 'q2' });
  assert.equal(progress.missed.length, 0);
  assert.equal(progress.accuracy, 67);
});

test('进度汇总给出每个句型的掌握标签', () => {
  let progress = applyGrammarAnswer(null, { patternId: 'sv', correct: true });
  progress = applyGrammarAnswer(progress, { patternId: 'sv', correct: true });
  progress = applyGrammarAnswer(progress, { patternId: 'sv', correct: true });
  progress = applyGrammarAnswer(progress, { patternId: 'svo', correct: false });

  const summary = summarizeGrammarProgress(progress);
  assert.equal(summary.length, GRAMMAR_PATTERNS.length + GRAMMAR_LESSONS.length);
  assert.equal(summary.find((item) => item.patternId === 'sv').label, '熟练');
  assert.equal(summary.find((item) => item.patternId === 'svo').label, '需加强');
  assert.equal(summary.find((item) => item.patternId === 'svoc').label, '未练习');
});

test('对比说明覆盖"主谓宾 vs 主系表"这一高频疑问', () => {
  const comparison = GRAMMAR_COMPARISONS.find((item) => item.id === 'svo-vs-svp');
  assert.ok(comparison, '必须包含主谓宾与主系表的对比');
  assert.ok(comparison.howToTell.length >= 2, '对比要给出可操作的判别方法');
  assert.ok(GRAMMAR_COMPARISONS.every((item) => item.left && item.right && item.answer));
});

test('splitHighlight 按片段切分句子（用于找成分题高亮）', () => {
  const found = splitHighlight('The soup tastes delicious.', 'tastes');
  assert.equal(found.before, 'The soup ');
  assert.equal(found.match, 'tastes');
  assert.equal(found.after, ' delicious.');

  // 大小写不敏感，并保留原文大小写
  const cased = splitHighlight('Birds Fly.', 'fly');
  assert.equal(cased.match, 'Fly');

  const missing = splitHighlight('Birds fly.', 'swim');
  assert.deepEqual(missing, { before: 'Birds fly.', match: '', after: '' });

  assert.deepEqual(splitHighlight('Birds fly.', ''), { before: 'Birds fly.', match: '', after: '' });
  assert.deepEqual(splitHighlight(null, 'x'), { before: '', match: '', after: '' });
});
