import { useStudyClock } from '../hooks/useStudyClock';
import { useLearningSession } from '../hooks/useLearningSession';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SpellCheck,
  BookOpen,
  Target,
  Wand2,
  Check,
  X,
  RotateCcw,
  Sparkles,
  ChevronRight,
  Lightbulb,
  AlertTriangle,
  Search,
} from 'lucide-react';
import StudyHeader from './StudyHeader';
import GrammarWorkbench from './GrammarWorkbench';
import { useToast } from './ui/toastContext';
import { ApiKeyNotice } from './ui/ApiKeyNotice';
import { IconButton } from './ui/IconButton';
import { StorageService } from '../services/storage';
import { analyzeSentenceWithAI, describeAIError, hasApiKey, normalizeSentenceAnalysis } from '../services/ai';
import { createLatestRequest } from '../services/latestRequest';
import { GRAMMAR_COMPARISONS, GRAMMAR_PATTERNS } from '../data/grammar';
import { GRAMMAR_LESSONS } from '../data/grammarLessons';
import { buildGrammarLessonQuiz } from '../services/grammarLessons';
import {
  buildGrammarQuiz,
  detectSentencePattern,
  gradeGrammarAnswer,
  splitHighlight,
  summarizeGrammarProgress,
} from '../services/grammar';

/** 成分配色：同一套颜色贯穿例句、练习与解析，便于建立视觉记忆。 */
const ROLE_STYLES = {
  主语: 'bg-sky-50 text-sky-800 ring-sky-200',
  谓语: 'bg-rose-50 text-rose-800 ring-rose-200',
  宾语: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  表语: 'bg-amber-50 text-amber-900 ring-amber-200',
  间接宾语: 'bg-teal-50 text-teal-800 ring-teal-200',
  直接宾语: 'bg-lime-50 text-lime-900 ring-lime-200',
  宾语补足语: 'bg-violet-50 text-violet-800 ring-violet-200',
  状语: 'bg-slate-100 text-slate-600 ring-slate-200',
  引导词: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
};

const PATTERN_NAMES = Object.fromEntries([...GRAMMAR_PATTERNS, ...GRAMMAR_LESSONS].map((pattern) => [pattern.id, pattern.name]));

function normalizeGrammarLabSession(raw = {}) {
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const text = (value, maximum = 3000) => typeof value === 'string' ? value.slice(0, maximum) : '';
  const questions = Array.isArray(stored.questions) ? stored.questions.slice(0, 30).flatMap((question) => {
    if (!question || typeof question.id !== 'string' || !question.id.trim() || typeof question.patternId !== 'string' || !Object.hasOwn(PATTERN_NAMES, question.patternId) || typeof question.prompt !== 'string' || !Array.isArray(question.options)) return [];
    const options = question.options.slice(0, 8).filter((option) => option && typeof option.label === 'string' && typeof option.value === 'string').map((option) => ({ label: text(option.label), value: text(option.value) }));
    if (options.length < 2 || new Set(options.map((option) => option.value)).size !== options.length || !options.some((option) => option.value === question.answer)) return [];
    return [{ id: text(question.id, 200), patternId: question.patternId, prompt: text(question.prompt), explanation: text(question.explanation, 6000), hint: text(question.hint), highlight: text(question.highlight), type: ['pattern', 'role', 'fix', 'application', 'order'].includes(question.type) ? question.type : 'application', answer: question.answer, options }];
  }) : [];
  const uniqueQuestions = [...new Map(questions.map((question) => [question.id, question])).values()];
  const storedAnswers = stored.answers && typeof stored.answers === 'object' && !Array.isArray(stored.answers) ? stored.answers : {};
  const answers = Object.fromEntries(uniqueQuestions.flatMap((question) => question.options.some((option) => option.value === storedAnswers[question.id]) ? [[question.id, storedAnswers[question.id]]] : []));
  const aiSentence = text(stored.aiSentence);
  return {
    activeTab: ['workbench', 'explain', 'practice', 'analyze'].includes(stored.activeTab) ? stored.activeTab : 'workbench',
    selectedPatternId: GRAMMAR_PATTERNS.some((pattern) => pattern.id === stored.selectedPatternId) ? stored.selectedPatternId : GRAMMAR_PATTERNS[0].id,
    questions: uniqueQuestions, answers, questionIndex: Number.isInteger(stored.questionIndex) ? Math.max(0, Math.min(uniqueQuestions.length - 1, stored.questionIndex)) : 0,
    finished: stored.finished === true && uniqueQuestions.length > 0 && uniqueQuestions.every((question) => answers[question.id] !== undefined),
    quizRunId: text(stored.quizRunId, 200), detectInput: text(stored.detectInput), aiSentence,
    analysis: stored.analysis && typeof stored.analysis === 'object' && !Array.isArray(stored.analysis) && stored.analysis.sentence === aiSentence.trim() ? normalizeSentenceAnalysis(stored.analysis, { sentence: aiSentence.trim() }) : null,
  };
}

function roleChipClass(role) {
  return ROLE_STYLES[role] || 'bg-slate-100 text-slate-600 ring-slate-200';
}

function PartedSentence({ parts, highlight }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {parts.map((part) => (
        <span
          key={`${part.role}-${part.text}`}
          className={`rounded-lg px-2 py-0.5 text-[13px] ring-1 ${roleChipClass(part.role)} ${
            highlight && highlight === part.text ? 'ring-2 ring-offset-1 ring-sky-400' : ''
          }`}
        >
          {part.text}
          <span className="ml-1 text-[9px] opacity-70">{part.role}</span>
        </span>
      ))}
    </div>
  );
}

export default function GrammarLab({ onOpenSettings, sectionSwitch = null }) {
  const toast = useToast();
  const studyClock = useStudyClock();
  const [restored] = useState(() => normalizeGrammarLabSession(StorageService.getLearningSession('grammar-lab')));
  const [activeTab, updateActiveTab] = useState(restored.activeTab);
  const [selectedPatternId, setSelectedPatternId] = useState(restored.selectedPatternId);
  const progress = useMemo(() => StorageService.getGrammarProgress(), []);
  const [summary, setSummary] = useState(() => summarizeGrammarProgress(progress));

  // --- 练习 ---
  const [questions, setQuestions] = useState(restored.questions);
  const [questionIndex, setQuestionIndex] = useState(restored.questionIndex);
  const [answers, setAnswers] = useState(restored.answers);
  const [finished, setFinished] = useState(restored.finished);
  const [quizRunId, setQuizRunId] = useState(() => restored.quizRunId || `restored-${Date.now()}`);
  const [sessionId] = useState(() => `grammar-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const practiceRunRef = useRef(0);
  const completionRef = useRef(restored.finished);
  const completionDurationRef = useRef(null);
  const answerLockRef = useRef('');
  const analysisGate = useRef(createLatestRequest());
  const [sessionError, setSessionError] = useState('');

  // --- 自测判定器 ---
  const [detectInput, setDetectInput] = useState(restored.detectInput);
  const [detectResult, setDetectResult] = useState(null);

  // --- AI 拆句 ---
  const [aiSentence, setAiSentence] = useState(restored.aiSentence);
  const [analysis, setAnalysis] = useState(restored.analysis);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const hasKey = hasApiKey();
  const snapshot = useMemo(() => ({ activeTab, selectedPatternId, questions, questionIndex, answers, finished, quizRunId, detectInput, aiSentence, analysis }), [activeTab, selectedPatternId, questions, questionIndex, answers, finished, quizRunId, detectInput, aiSentence, analysis]);
  useLearningSession('grammar-lab', snapshot, () => setSessionError('本次草稿暂未保存到设备，当前内容仍可继续使用，请检查存储空间。'));
  useEffect(() => {
    const gate = analysisGate.current;
    return () => gate.cancel();
  }, []);
  const setActiveTab = (value) => {
    if (value !== 'analyze') { analysisGate.current.cancel(); setIsAnalyzing(false); }
    updateActiveTab(value);
  };

  const changeAiSentence = (value) => {
    analysisGate.current.cancel();
    setIsAnalyzing(false);
    setAnalysis(null);
    setAiSentence(value.slice(0, 3000));
  };

  const selectedPattern = GRAMMAR_PATTERNS.find((pattern) => pattern.id === selectedPatternId) || GRAMMAR_PATTERNS[0];
  const currentQuestion = questions[questionIndex];
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;
  const isAnswered = currentAnswer !== undefined;

  const startQuiz = (options = {}) => {
    practiceRunRef.current += 1;
    const seed = `${sessionId}-${practiceRunRef.current}`;
    const next = options.questions || (options.topicId
      ? buildGrammarLessonQuiz({ topicIds: [options.topicId], count: 5, seed })
      : [...buildGrammarQuiz({ count: 3, seed }), ...buildGrammarLessonQuiz({ count: 2, seed })]);
    if (!next.length) {
      toast.error('暂时无法生成练习，请稍后重试。');
      return;
    }
    setQuestions(next);
    setQuizRunId(seed);
    completionRef.current = false;
    completionDurationRef.current = null;
    answerLockRef.current = '';
    setQuestionIndex(0);
    setAnswers({});
    setFinished(false);
    setActiveTab('practice');
  };

  const finishQuiz = (finalAnswers, quizQuestions) => {
    if (completionRef.current || !quizQuestions.length || !quizQuestions.every((question) => finalAnswers[question.id] !== undefined)) return;
    const correctCount = quizQuestions.filter((question) => gradeGrammarAnswer(question, finalAnswers[question.id])).length;
    // 学习活动只记一次，count 为本次题量，避免把每一题都算成一次独立动作。
    const alreadySaved = StorageService.getStudyEvents().some((event) => event.source === 'grammar-quiz' && event.metadata?.sessionId === quizRunId);
    if (completionDurationRef.current === null) completionDurationRef.current = studyClock.takeMinutes();
    const saved = alreadySaved || StorageService.recordStudyActivity({
      type: 'grammar',
      count: quizQuestions.length,
      durationMinutes: completionDurationRef.current,
      source: 'grammar-quiz',
      label: '完成语法句型练习',
      metadata: { sessionId: quizRunId, correct: correctCount, total: quizQuestions.length },
    });
    if (!saved) { setSessionError('本次完成记录没有保存成功，答案已保留，请重试。'); return; }
    completionRef.current = true;
    setSessionError('');
    setFinished(true);
    return correctCount;
  };

  const answerQuestion = (value) => {
    if (!currentQuestion || isAnswered || answerLockRef.current === currentQuestion.id) return;
    const correct = gradeGrammarAnswer(currentQuestion, value);
    const nextAnswers = { ...answers, [currentQuestion.id]: value };
    const saved = StorageService.recordGrammarAnswer({
      patternId: currentQuestion.patternId,
      correct,
      questionId: currentQuestion.id,
      sentence: currentQuestion.prompt,
    });
    if (!saved) { toast.error('答案没有保存成功，请检查存储空间后重试。'); return; }
    answerLockRef.current = currentQuestion.id;
    setAnswers(nextAnswers);
    setSummary(summarizeGrammarProgress(saved));
  };

  // 答题后手动进入下一题（给出解析阅读时间，而不是自动跳走）
  const goNext = () => {
    if (!isAnswered || completionRef.current) return;
    if (questionIndex + 1 < questions.length) {
      answerLockRef.current = '';
      setQuestionIndex((index) => index + 1);
      return;
    }
    finishQuiz(answers, questions);
  };

  const restartWithMissed = () => {
    const missed = StorageService.getGrammarProgress().missed || [];
    if (!missed.length) {
      toast.info('还没有错题，先做一组练习吧。');
      return;
    }
    // 从错题所在句型重新抽题，避免"背原题"。
    const seed = `${sessionId}-missed-${practiceRunRef.current + 1}`;
    const rebuilt = [...buildGrammarQuiz({ count: 100, seed }), ...buildGrammarLessonQuiz({ count: 100, seed })]
      .filter((question) => missed.some((item) => item.patternId === question.patternId));
    const unique = [...new Map(rebuilt.map((question) => [question.id, question])).values()].slice(0, 5);
    if (!unique.length) { toast.info('旧错题暂时没有对应练习，请先做综合练习。'); return; }
    startQuiz({ questions: unique });
  };

  const runDetect = () => {
    const sentence = detectInput.trim();
    if (!sentence) return;
    setDetectResult(detectSentencePattern(sentence));
  };

  const runAnalysis = async () => {
    const sentence = aiSentence.trim();
    if (!sentence) {
      toast.error('请先输入要拆解的英文句子。');
      return;
    }
    const request = analysisGate.current.start();
    setIsAnalyzing(true);
    setAnalysis(null);
    try {
      const result = await analyzeSentenceWithAI(sentence, { signal: request.signal });
      if (request.isCurrent()) setAnalysis(result);
    } catch (error) {
      if (request.isCurrent()) toast.error(describeAIError(error, { fallback: '拆句失败' }).message);
    } finally {
      if (request.isCurrent()) setIsAnalyzing(false);
    }
  };

  const quizCorrectCount = questions.filter((question) => gradeGrammarAnswer(question, answers[question.id])).length;
  const practicedTotal = summary.reduce((sum, item) => sum + item.total, 0);
  const practicedAccuracy = practicedTotal
    ? Math.round((summary.reduce((sum, item) => sum + item.correct, 0) / practicedTotal) * 100)
    : 0;

  return (
    <div className="study-page grammar-page flex flex-col h-full">
      <StudyHeader
        eyebrow="GRAMMAR · PATTERNS & PRACTICE"
        title="语法实验室"
        description="句子骨架 → 补充信息 → 完整表达"
        icon={<SpellCheck className="w-4 h-4" />}
        status={practicedTotal ? `已练 ${practicedTotal} 题 · 正确率 ${practicedAccuracy}%` : '尚未开始练习'}
      >
        {sectionSwitch && <div className="mb-2">{sectionSwitch}</div>}
        <div className="mt-3 flex rounded-xl bg-white/10 p-1 text-[11px] ring-1 ring-white/10">
          {[['workbench', '句子拓展', Lightbulb], ['explain', '基本骨架', BookOpen], ['practice', '巩固练习', Target], ['analyze', 'AI 拆句', Wand2]].map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setActiveTab(value)}
              aria-pressed={activeTab === value}
              className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                activeTab === value ? 'bg-white text-[#102a43] font-semibold shadow-xs' : 'text-slate-300 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </StudyHeader>

      <div className="grammar-scroll flex-1 min-h-0 overflow-y-auto p-4 pb-8 space-y-4">
        {sessionError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">{sessionError}</p>}
        <div hidden={activeTab !== 'workbench'}><GrammarWorkbench onPractice={(topicId) => startQuiz({ topicId })} onShowPatterns={() => setActiveTab('explain')} onAnalyze={(sentence) => { changeAiSentence(sentence); setActiveTab('analyze'); }} /></div>
        {/* ============ 句型讲解 ============ */}
        {activeTab === 'explain' && (
          <>
            <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {GRAMMAR_PATTERNS.map((pattern) => (
                <button
                  key={pattern.id}
                  type="button"
                  onClick={() => setSelectedPatternId(pattern.id)}
                  className={`flex-none rounded-xl px-3 py-1.5 text-[11px] font-semibold ring-1 transition-colors ${
                    pattern.id === selectedPatternId
                      ? 'bg-[#102a43] text-white ring-[#102a43]'
                      : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {pattern.name}
                </button>
              ))}
            </div>

            <div className="study-card paper-grain rounded-[24px] p-4 space-y-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">{selectedPattern.name}</h2>
                  <span className="rounded-lg bg-sky-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200">
                    {selectedPattern.symbol}
                  </span>
                </div>
                <p className="mt-2 text-xs font-medium text-slate-700">{selectedPattern.formula}</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{selectedPattern.summary}</p>
              </div>

              <div className="space-y-2">
                <h3 className="text-[11px] font-bold tracking-wide text-slate-400">例句拆解</h3>
                {selectedPattern.examples.map((example) => (
                  <div key={example.en} className="rounded-2xl border border-slate-100 bg-white/70 p-3">
                    <p className="text-sm font-semibold text-slate-900">{example.en}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{example.zh}</p>
                    <div className="mt-2">
                      <PartedSentence parts={example.parts} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <h3 className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-slate-400">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-500" />要点
                </h3>
                <ul className="space-y-1">
                  {selectedPattern.keys.map((key) => (
                    <li key={key} className="flex gap-1.5 text-[11.5px] leading-relaxed text-slate-600">
                      <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-sky-400" />
                      <span>{key}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-slate-400">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />常见错误
                </h3>
                {selectedPattern.pitfalls.map((pitfall) => (
                  <div key={pitfall.wrong} className="rounded-2xl border border-rose-100 bg-rose-50/60 p-3">
                    <p className="flex items-start gap-1.5 text-[11.5px] text-rose-800">
                      <X className="mt-0.5 h-3.5 w-3.5 flex-none" />
                      <span className="line-through decoration-rose-300">{pitfall.wrong}</span>
                    </p>
                    <p className="mt-1 flex items-start gap-1.5 text-[11.5px] font-medium text-emerald-800">
                      <Check className="mt-0.5 h-3.5 w-3.5 flex-none" />
                      <span>{pitfall.right}</span>
                    </p>
                    <p className="mt-1.5 text-[10.5px] leading-relaxed text-slate-500">{pitfall.explanation}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* 句型对比：主谓宾 vs 主系表 等高频混淆点 */}
            <div className="study-card paper-grain rounded-[24px] p-4 space-y-3">
              <h2 className="text-sm font-bold text-slate-900">最容易混的两种句型</h2>
              {GRAMMAR_COMPARISONS.map((comparison) => (
                <div key={comparison.id} className="rounded-2xl border border-slate-100 bg-white/70 p-3">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{comparison.title}</span>
                  </div>
                  <p className="mt-2 text-[11.5px] font-medium text-slate-800">{comparison.question}</p>
                  <p className="mt-1 text-[11.5px] text-emerald-700">→ {comparison.answer}</p>
                  <ul className="mt-2 space-y-1">
                    {comparison.howToTell.map((tip) => (
                      <li key={tip} className="flex gap-1.5 text-[11px] leading-relaxed text-slate-600">
                        <ChevronRight className="mt-0.5 h-3 w-3 flex-none text-sky-500" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 space-y-0.5">
                    {comparison.examples.map((example) => (
                      <p key={example} className="text-[10.5px] text-slate-500">· {example}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* 自测：自己写的句子属于哪种句型 */}
            <div className="study-card paper-grain rounded-[24px] p-4 space-y-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">自己写一句，看看是哪种句型</h2>
                <p className="mt-0.5 text-[10.5px] text-slate-500">
                  基于内置词表的启发式判断，只覆盖常见动词；超出范围会明说“不确定”，不会硬猜。
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                <Search className="w-4 h-4 flex-none text-slate-400" />
                <input
                  value={detectInput}
                  onChange={(event) => { setDetectInput(event.target.value.slice(0, 3000)); setDetectResult(null); }}
                  onKeyDown={(event) => { if (event.key === 'Enter') runDetect(); }}
                  placeholder="例如：The soup tastes delicious."
                  aria-label="输入要判定的英文句子"
                  className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                />
              </div>
              <button
                type="button"
                onClick={runDetect}
                disabled={!detectInput.trim()}
                className="w-full rounded-xl bg-[#102a43] py-2 text-xs font-bold text-white disabled:opacity-40"
              >
                判定句型
              </button>
              {detectResult && (
                <div className={`rounded-2xl border p-3 ${detectResult.pattern === 'unknown' ? 'border-slate-200 bg-slate-50' : 'border-emerald-200 bg-emerald-50/70'}`}>
                  <p className="text-xs font-bold text-slate-900">
                    {detectResult.pattern === 'unknown' ? '判定结果：不确定' : `判定结果：${PATTERN_NAMES[detectResult.pattern]}`}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{detectResult.reason}</p>
                  {detectResult.pattern === 'unknown' && (
                    <button
                      type="button"
                      onClick={() => { changeAiSentence(detectInput.trim()); setActiveTab('analyze'); }}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 underline"
                    >
                      <Wand2 className="w-3 h-3" />改用 AI 拆句
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 每个句型的练习成绩 */}
            <details className="study-card paper-grain rounded-[24px] p-4 space-y-2">
              <summary className="cursor-pointer text-sm font-bold text-slate-900">查看各主题练习情况</summary>
              <p className="pt-2 text-[11px] leading-5 text-slate-500">这里记录选择题表现，结合自由造句判断自己能否在实际表达中使用。</p>
              <div className="space-y-1.5 pt-2">
                {summary.map((item) => (
                  <div key={item.patternId} className="flex items-center gap-2 text-[11px]">
                    <span className="w-20 flex-none text-slate-600">{item.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${item.accuracy >= 90 ? 'bg-emerald-500' : item.accuracy >= 70 ? 'bg-amber-400' : 'bg-rose-400'}`}
                        style={{ width: `${item.total ? Math.max(6, item.accuracy) : 0}%` }}
                      />
                    </div>
                    <span className="w-24 flex-none text-right text-slate-500">
                      {item.total ? `${item.correct}/${item.total} · ${item.label}` : item.label}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}

        {/* ============ 句型练习 ============ */}
        {activeTab === 'practice' && (
          <>
            {questions.length === 0 && (
              <div className="study-card paper-grain rounded-[24px] p-5 text-center space-y-3">
                <Target className="mx-auto h-8 w-8 text-sky-500" />
                <h2 className="text-sm font-bold text-slate-900">5 道题，练骨架，也练完整表达</h2>
                <p className="text-[11.5px] leading-relaxed text-slate-500">
                  综合练习包含句型、成分、改错与词序应用。也可以在讲解里只练当前一节；每题作答后都有解析。
                </p>
                <button
                  type="button"
                  onClick={() => startQuiz()}
                  className="w-full rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 py-2.5 text-xs font-bold text-white"
                >
                  开始练习
                </button>
                <button
                  type="button"
                  onClick={restartWithMissed}
                  className="w-full rounded-xl bg-white py-2.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200"
                >
                  只练错题（{StorageService.getGrammarProgress().missed.length}）
                </button>
              </div>
            )}

            {currentQuestion && !finished && (
              <div className="study-card paper-grain rounded-[24px] p-4 space-y-3">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>{PATTERN_NAMES[currentQuestion.patternId] || '语法'} · {currentQuestion.type === 'pattern' ? '判断句型' : currentQuestion.type === 'role' ? '找成分' : currentQuestion.type === 'application' ? '结构应用' : currentQuestion.type === 'order' ? '语序迁移' : '改错'}</span>
                  <span className="font-mono">{questionIndex + 1} / {questions.length}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/80">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-500 to-blue-600 transition-all"
                    style={{ width: `${((questionIndex + (isAnswered ? 1 : 0)) / questions.length) * 100}%` }}
                  />
                </div>

                <p className="text-[11px] font-semibold text-slate-400">{currentQuestion.hint}</p>
                <p className="text-base font-semibold leading-relaxed text-slate-900">
                  {currentQuestion.type === 'role' && currentQuestion.highlight
                    ? (() => {
                      const { before, match, after } = splitHighlight(currentQuestion.prompt, currentQuestion.highlight);
                      if (!match) return currentQuestion.prompt;
                      return (
                        <>
                          {before}
                          <mark className="rounded bg-amber-200 px-0.5">{match}</mark>
                          {after}
                        </>
                      );
                    })()
                    : currentQuestion.prompt}
                </p>

                <div className="grid gap-2">
                  {currentQuestion.options.map((option) => {
                    const isCorrect = option.value === currentQuestion.answer;
                    const isPicked = option.value === currentAnswer;
                    let style = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
                    if (isAnswered) {
                      if (isCorrect) style = 'border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold';
                      else if (isPicked) style = 'border-rose-300 bg-rose-50 text-rose-700 line-through';
                      else style = 'border-slate-200 bg-white text-slate-400';
                    }
                    return (
                      <button
                        key={String(option.value)}
                        type="button"
                        disabled={isAnswered}
                        onClick={() => answerQuestion(option.value)}
                        className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${style}`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                {isAnswered && (
                  <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-3">
                    <p className="text-xs font-bold text-slate-900">
                      {gradeGrammarAnswer(currentQuestion, currentAnswer) ? '✅ 答对了' : '❌ 答错了'}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{currentQuestion.explanation}</p>
                    <button
                      type="button"
                      onClick={goNext}
                      className="mt-3 w-full rounded-xl bg-[#102a43] py-2 text-xs font-bold text-white"
                    >
                      {questionIndex + 1 < questions.length ? '下一题' : '看结果'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {finished && (
              <div className="study-card paper-grain rounded-[24px] p-5 space-y-3 text-center">
                <h2 className="text-sm font-bold text-slate-900">
                  本组完成：{quizCorrectCount} / {questions.length} 正确
                </h2>
                <p className="text-[11.5px] text-slate-500">
                  正确率 {questions.length ? Math.round((quizCorrectCount / questions.length) * 100) : 0}%
                  {quizCorrectCount < questions.length ? ' · 错题已加入错题本' : ' · 全对，很棒'}
                </p>
                <div className="space-y-2 text-left">
                  {questions.filter((question) => !gradeGrammarAnswer(question, answers[question.id])).map((question) => (
                    <div key={question.id} className="rounded-2xl border border-rose-100 bg-rose-50/60 p-3">
                      <p className="text-[11.5px] font-medium text-slate-800">{question.prompt}</p>
                      <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">{question.explanation}</p>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => startQuiz()}
                  className="w-full rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 py-2.5 text-xs font-bold text-white"
                >
                  再来一组
                </button>
                <button
                  type="button"
                  onClick={() => { setQuestions([]); setAnswers({}); setQuestionIndex(0); setFinished(false); completionRef.current = false; completionDurationRef.current = null; answerLockRef.current = ''; }}
                  className="w-full rounded-xl bg-white py-2.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200"
                >
                  回到练习首页
                </button>
              </div>
            )}
          </>
        )}

        {/* ============ AI 拆句 ============ */}
        {activeTab === 'analyze' && (
          <>
            {!hasKey && <ApiKeyNotice onOpenSettings={onOpenSettings} />}
            <div className="study-card paper-grain rounded-[24px] p-4 space-y-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">粘贴一个句子，拆出主干与从句</h2>
                <p className="mt-0.5 text-[10.5px] text-slate-500">
                  AI 会给出句子主干、各成分作用与语法要点；与内置句型库互相印证。
                </p>
              </div>
              <textarea
                value={aiSentence}
                onChange={(event) => changeAiSentence(event.target.value)}
                rows={3}
                placeholder="例如：What he said at the meeting surprised everyone."
                aria-label="要拆解的英文句子"
                className="w-full rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-400"
              />
              <div className="flex flex-wrap gap-1.5">
                {['She is a teacher.', 'He gave me a book.', 'What he said surprised everyone.'].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => changeAiSentence(sample)}
                    className="rounded-lg bg-slate-100 px-2 py-1 text-[10.5px] text-slate-600 hover:bg-slate-200"
                  >
                    {sample}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={runAnalysis}
                disabled={isAnalyzing || !aiSentence.trim() || !hasKey}
                className="w-full rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 py-2.5 text-xs font-bold text-white disabled:opacity-40"
              >
                {isAnalyzing ? '正在拆解…' : '开始拆句'}
              </button>
            </div>

            {analysis && (
              <div className="study-card paper-grain rounded-[24px] p-4 space-y-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">句子主干</h2>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-slate-700">{analysis.structureSummary || '（未给出主干说明）'}</p>
                </div>
                {analysis.translation && (
                  <div className="rounded-2xl border border-slate-100 bg-white/70 p-3">
                    <p className="text-[10.5px] font-semibold text-slate-400">参考译文</p>
                    <p className="mt-0.5 text-[11.5px] text-slate-700">{analysis.translation}</p>
                  </div>
                )}
                {analysis.clauses.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[11px] font-bold tracking-wide text-slate-400">成分拆解</h3>
                    {analysis.clauses.map((clause) => (
                      <div key={`${clause.type}|${clause.text}|${clause.explanation}`} className="rounded-2xl border border-slate-100 bg-white/70 p-3">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-lg px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${roleChipClass(clause.type)}`}>{clause.type}</span>
                          <span className="text-[12.5px] font-semibold text-slate-900">{clause.text}</span>
                        </div>
                        {clause.explanation && (
                          <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">{clause.explanation}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {analysis.grammarPoints.length > 0 && (
                  <div className="space-y-1">
                    <h3 className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-slate-400">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />语法要点
                    </h3>
                    <ul className="space-y-1">
                      {analysis.grammarPoints.map((point) => (
                        <li key={point} className="flex gap-1.5 text-[11px] leading-relaxed text-slate-600">
                          <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-amber-400" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <IconButton
                  label="清空拆句结果"
                  onClick={() => changeAiSentence('')}
                  className="mx-auto p-2 text-slate-400"
                >
                  <RotateCcw className="w-4 h-4" />
                </IconButton>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
