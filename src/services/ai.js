// `.js` extension required: this module is loaded directly by `node --test`, which (unlike
// Vite) does not resolve extension-less specifiers. Matches the convention used by the
// other service modules (studyPlan.js, nce.js, nceReview.js).
import { StorageService } from './storage.js';

/**
 * Request timeouts. The audit found that AI calls had no timeout and no way to cancel,
 * so a stalled provider (weak mobile network, long "thinking" models) left the UI in a
 * loading state forever with no recovery other than reloading the PWA.
 */
export const AI_REQUEST_TIMEOUT_MS = 60000;
// Streaming: abort only if the provider goes quiet for this long (a long answer is fine,
// a stalled socket is not).
export const AI_STREAM_IDLE_TIMEOUT_MS = 30000;

/**
 * Response shaping.
 *
 * `extractJson` only proves the reply *parsed*; it says nothing about structure. Components
 * then read fields like `q.options.map(...)` or `generatedStory.storyEn.replace(...)`, so a
 * model that omits a key or returns a different shape crashed the whole tab (the vocabulary
 * page even took the ErrorBoundary down). These normalizers turn any parseable reply into
 * the exact shape the UI needs, or raise one readable Chinese error.
 */

/**
 * Whether an API key is configured. Used to tell "you have not set this up yet" apart from
 * "the request failed", which the UI used to blur together.
 */
export function hasApiKey() {
  try {
    return Boolean(StorageService.getSettings()?.apiKey?.trim());
  } catch {
    return false;
  }
}

/**
 * Turn an AI failure into something the user can act on.
 *
 * The reader showed the single string "释义解析未成功（可能是网络波动或未配置 API Key）" for
 * every failure, which sends people to check their Wi-Fi when the real cause is a missing key.
 *
 * @param {unknown} error
 * @param {{ fallback?: string }} [options]
 * @returns {{ missingKey: boolean, message: string }}
 */
export function describeAIError(error, { fallback = 'AI 请求失败' } = {}) {
  if (!hasApiKey()) {
    return {
      missingKey: true,
      message: `${fallback}：还没有配置 API Key。去“设置”里填入密钥后即可使用 AI 功能。`,
    };
  }

  const name = String(error?.name || '');
  const message = String(error?.message || '');
  if (name === 'AbortError' || /超时|timeout/i.test(message)) {
    return { missingKey: false, message: `${fallback}：请求超时（网络较慢或服务商繁忙），请重试。` };
  }
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return { missingKey: false, message: `${fallback}：网络连接失败，请检查网络后重试。` };
  }
  if (/401|403|invalid.*key|api key/i.test(message)) {
    return { missingKey: false, message: `${fallback}：密钥被拒绝，请到“设置”里核对 API Key 与服务商。` };
  }
  return { missingKey: false, message: `${fallback}：${message || '请稍后重试'}` };
}

/**
 * Heuristic that used to be blamed for every reader failure. Kept for the placeholder shown in
 * the word-analysis card so that a failed lookup is visible but never stored as a meaning.
 */
export const WORD_ANALYSIS_FAILURE_TEXT = '释义解析未成功';

function asText(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function asStringList(value, predicate = () => true) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(item)).filter((item) => item && predicate(item));
}

export function normalizeOralResponse(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.replyText !== 'string' || !raw.replyText.trim()) {
    throw new Error('口语回复格式不完整，请重试这条消息');
  }
  const feedback = raw.feedback && typeof raw.feedback === 'object' ? raw.feedback : {};
  const shaped = Object.fromEntries(['userOriginal', 'corrected', 'explanationZh', 'betterAlternative']
    .map((key) => [key, typeof feedback[key] === 'string' ? feedback[key] : '']));
  return {
    replyText: raw.replyText.trim(),
    replyTextCn: typeof raw.replyTextCn === 'string' ? raw.replyTextCn : '',
    feedback: { ...shaped, hasSlip: feedback.hasSlip === true && Boolean(shaped.corrected && shaped.userOriginal) },
    suggestedReplies: Array.isArray(raw.suggestedReplies)
      ? raw.suggestedReplies.filter((item) => typeof item === 'string' && item.trim()).slice(0, 3) : [],
  };
}

/**
 * Normalize `{ questions: [...] }` from the quiz generator.
 * Invalid questions are dropped rather than crashing the reviewer; the surviving
 * questions are guaranteed to have a unique id, at least two options and an in-range
 * `correctIndex` (a missing/out-of-range index used to mark a correct answer wrong and
 * additionally reset the word's SRS scheduling).
 *
 * @throws {Error} when no usable question survives
 */
export function normalizeVocabularyQuiz(raw) {
  const source = Array.isArray(raw) ? raw : raw?.questions;
  if (!Array.isArray(source)) {
    throw new Error('AI 返回的测验格式无法识别，请重试一次');
  }

  const seenIds = new Set();
  const questions = [];

  source.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const options = asStringList(item.options);
    if (options.length < 2) return;

    let correctIndex = Number(item.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      // Fall back to the option that matches the target word/answer, otherwise drop it.
      const answer = asText(item.answer || item.correctOption).trim().toLowerCase();
      const matched = answer ? options.findIndex((option) => option.trim().toLowerCase() === answer) : -1;
      if (matched < 0) return;
      correctIndex = matched;
    }

    let id = asText(item.id).trim() || `q_${index + 1}`;
    while (seenIds.has(id)) id = `${id}_${questions.length + 1}`;
    seenIds.add(id);

    questions.push({
      id,
      targetWord: asText(item.targetWord || item.word),
      sentenceWithBlank: asText(item.sentenceWithBlank || item.sentence || item.question),
      sentenceCn: asText(item.sentenceCn),
      options,
      correctIndex,
      explanation: asText(item.explanation),
    });
  });

  if (questions.length === 0) {
    throw new Error('AI 这次没有给出可用的测验题，请再试一次');
  }
  return { questions };
}

/**
 * Normalize the micro-story response. `storyEn` is required — the UI calls
 * `.replace()` on it directly and offers a "save to reader" action.
 *
 * @throws {Error} when the story body is missing
 */
export function normalizeVocabStory(raw, { genre = 'mystery' } = {}) {
  const story = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const storyEn = asText(story.storyEn || story.story || story.content).trim();
  if (!storyEn) {
    throw new Error('AI 这次没有返回故事正文，请重试一次');
  }
  return {
    title: asText(story.title, 'A LingoFlow Story'),
    titleCn: asText(story.titleCn, '生词微剧场'),
    storyEn,
    storyCn: asText(story.storyCn),
    genre: asText(story.genre, genre),
    usedWords: asStringList(story.usedWords),
  };
}

/**
 * Normalize the generated reader article.
 *
 * @throws {Error} when the article body is missing
 */
export function normalizeArticle(raw) {
  const article = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const content = asText(article.content || article.body || article.text).trim();
  if (!content) {
    throw new Error('AI 这次没有返回文章正文，请重试一次');
  }
  return {
    title: asText(article.title, 'AI 精选外刊'),
    titleCn: asText(article.titleCn),
    level: asText(article.level),
    content,
    tags: asStringList(article.tags),
  };
}

/**
 * Normalize a word/sentence analysis so every field the UI reads is a string.
 * Never throws: a degraded card is better than a crashed reading view.
 */
export function normalizeWordAnalysis(raw, { word = '', sentence = '' } = {}) {
  const analysis = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...analysis,
    word: asText(analysis.word, word),
    phonetic: asText(analysis.phonetic),
    pos: asText(analysis.pos),
    translation: asText(analysis.translation),
    definitionEn: asText(analysis.definitionEn),
    contextSentence: asText(analysis.contextSentence, sentence),
    contextSentenceCn: asText(analysis.contextSentenceCn),
    memoryTip: asText(analysis.memoryTip),
    collocations: asStringList(analysis.collocations),
  };
}

/**
 * Normalize the sentence (long-sentence breakdown) analysis.
 * Never throws.
 */
export function normalizeSentenceAnalysis(raw, { sentence = '' } = {}) {
  const analysis = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const clauses = Array.isArray(analysis.clauses)
    ? analysis.clauses
      .filter((clause) => clause && typeof clause === 'object')
      .map((clause) => ({
        type: asText(clause.type, '成分'),
        text: asText(clause.text),
        explanation: asText(clause.explanation),
      }))
    : [];
  return {
    ...analysis,
    sentence: asText(analysis.sentence, sentence),
    structureSummary: asText(analysis.structureSummary),
    translation: asText(analysis.translation),
    clauses,
    grammarPoints: asStringList(analysis.grammarPoints),
  };
}

/**
 * Clean and format the base URL
 */
function cleanBaseUrl(url) {
  if (!url) return 'https://api.deepseek.com';
  let cleaned = url.trim().replace(/\/+$/, '');
  return cleaned;
}

/**
 * Build an AbortSignal that fires on timeout and also forwards any caller-provided signal.
 * @returns {{ signal: AbortSignal, arm: Function, cleanup: Function }}
 *   arm(ms) re-arms the idle timer (used between stream chunks), cleanup() must run in finally.
 */
function createRequestSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timer = null;

  const arm = (ms = timeoutMs) => {
    if (timer) clearTimeout(timer);
    if (!Number.isFinite(ms) || ms <= 0) return;
    timer = setTimeout(() => {
      try {
        controller.abort(new DOMException(`AI 请求超过 ${Math.round(ms / 1000)} 秒未响应`, 'TimeoutError'));
      } catch {
        controller.abort();
      }
    }, ms);
  };

  const forwardAbort = () => {
    try {
      controller.abort(externalSignal?.reason);
    } catch {
      controller.abort();
    }
  };

  if (externalSignal) {
    if (externalSignal.aborted) forwardAbort();
    else externalSignal.addEventListener('abort', forwardAbort, { once: true });
  }
  arm();

  return {
    signal: controller.signal,
    arm,
    cleanup() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (externalSignal) externalSignal.removeEventListener('abort', forwardAbort);
    },
  };
}

/**
 * Turn an abort/timeout into a readable Chinese error instead of a bare "AbortError".
 * The original `name` is preserved so callers can distinguish cancellation from failure.
 */
function toReadableRequestError(error) {
  const name = error?.name;
  if (name === 'TimeoutError') {
    const timedOut = new Error(error?.message || 'AI 请求超时，请检查网络后重试');
    timedOut.name = 'TimeoutError';
    return timedOut;
  }
  if (name === 'AbortError') {
    const cancelled = new Error('AI 请求已取消');
    cancelled.name = 'AbortError';
    return cancelled;
  }
  if (error instanceof TypeError) {
    return new Error('无法连接 AI 服务：请检查网络连接或设置中的接口地址');
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Extract clean JSON from LLM output (handles Markdown ```json ... ``` blocks)
 */
function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Try regex extraction of JSON block
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // Fall through
      }
    }

    // Try finding first { and last }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch {
        // Fall through
      }
    }

    // Try finding first [ and last ]
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(text.slice(firstBracket, lastBracket + 1));
      } catch {
        // Fall through
      }
    }

    throw new Error('未能从AI回复中解析出有效的JSON数据');
  }
}

/**
 * Universal Chat Completion Stream Caller (Server-Sent Events)
 * @param {object} options
 * @param {AbortSignal} [options.signal] caller-provided cancellation
 * @param {number} [options.idleTimeoutMs] abort if the stream goes quiet this long
 */
export async function callAICompletionStream({
  messages,
  temperature = 0.7,
  responseFormatJson = false,
  onChunk,
  signal,
  idleTimeoutMs = AI_STREAM_IDLE_TIMEOUT_MS,
}) {
  const settings = StorageService.getSettings();
  const apiKey = settings.apiKey?.trim();

  if (!apiKey) {
    throw new Error('未配置 API Key，请先进入“设置”页面填入您的 API Key');
  }

  const baseUrl = cleanBaseUrl(settings.baseUrl);
  const endpoint = `${baseUrl}/chat/completions`;
  const model = settings.model || 'deepseek-chat';

  const bodyPayload = {
    model,
    messages,
    temperature,
    stream: true,
  };

  if (responseFormatJson) {
    bodyPayload.response_format = { type: 'json_object' };
  }

  const request = createRequestSignal(signal, idleTimeoutMs);

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(bodyPayload),
      signal: request.signal,
    });
  } catch (error) {
    request.cleanup();
    throw toReadableRequestError(error);
  }

  if (!res.ok) {
    request.cleanup();
    const errorText = await res.text();
    let errorDetail = errorText;
    try {
      const errJson = JSON.parse(errorText);
      errorDetail = errJson.error?.message || errJson.message || errorText;
    } catch {
      // ignore
    }
    throw new Error(`AI请求失败 (${res.status}): ${errorDetail}`);
  }

  if (!res.body) {
    request.cleanup();
    throw new Error('当前环境不支持流式响应');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let fullText = '';
  let buffer = '';
  let sawDone = false;

  try {
    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) break;

      // Any traffic proves the socket is alive: re-arm the idle timer.
      request.arm(idleTimeoutMs);

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6).trim();
          if (dataStr === '[DONE]') {
            // Previously a bare `break` only exited this inner for-loop, so the outer
            // while kept waiting on reader.read() until the socket closed on its own.
            sawDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const chunk = parsed.choices?.[0]?.delta?.content || '';
            if (chunk) {
              fullText += chunk;
              if (onChunk) {
                onChunk(chunk, fullText);
              }
            }
          } catch {
            // ignore chunk parse failure
          }
        }
      }
    }
  } catch (error) {
    const readable = toReadableRequestError(error);
    // Keep whatever the user has already read — unless the caller cancelled on purpose
    // (scenario switch / leaving the page), in which case the result must not be applied.
    if (fullText && !signal?.aborted) return fullText;
    throw readable;
  } finally {
    request.cleanup();
    try {
      await reader.cancel();
    } catch {
      // already closed
    }
  }

  return fullText;
}

/**
 * Real-time parser for streaming JSON replyText
 */
export function extractPartialReplyText(text) {
  if (!text) return '';
  const keyIdx = text.indexOf('"replyText"');
  if (keyIdx === -1) return '';

  const colonIdx = text.indexOf(':', keyIdx);
  if (colonIdx === -1) return '';

  const firstQuoteIdx = text.indexOf('"', colonIdx);
  if (firstQuoteIdx === -1) return '';

  const afterQuote = text.slice(firstQuoteIdx + 1);
  let extracted = '';
  let isEscaped = false;

  for (let i = 0; i < afterQuote.length; i++) {
    const char = afterQuote[i];
    if (isEscaped) {
      extracted += char === 'n' ? '\n' : char;
      isEscaped = false;
    } else if (char === '\\') {
      isEscaped = true;
    } else if (char === '"') {
      break;
    } else {
      extracted += char;
    }
  }
  return extracted;
}

/**
 * Universal Chat Completion Caller
 * @param {object} options
 * @param {AbortSignal} [options.signal] caller-provided cancellation
 * @param {number} [options.timeoutMs] abort if the provider does not answer in time
 */
export async function callAICompletion({
  messages,
  temperature = 0.7,
  responseFormatJson = false,
  signal,
  timeoutMs = AI_REQUEST_TIMEOUT_MS,
}) {
  const settings = StorageService.getSettings();
  const apiKey = settings.apiKey?.trim();

  if (!apiKey) {
    throw new Error('未配置 API Key，请先进入“设置”页面填入您的 API Key');
  }

  const baseUrl = cleanBaseUrl(settings.baseUrl);
  const endpoint = `${baseUrl}/chat/completions`;
  const model = settings.model || 'deepseek-chat';

  const bodyPayload = {
    model,
    messages,
    temperature,
  };

  // DeepSeek / OpenAI support response_format = { type: 'json_object' }
  if (responseFormatJson) {
    bodyPayload.response_format = { type: 'json_object' };
  }

  const request = createRequestSignal(signal, timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(bodyPayload),
      signal: request.signal,
    });

    if (!res.ok) {
      const errorText = await res.text();
      let errorDetail = errorText;
      try {
        const errJson = JSON.parse(errorText);
        errorDetail = errJson.error?.message || errJson.message || errorText;
      } catch {
        // ignore
      }
      throw new Error(`AI请求失败 (${res.status}): ${errorDetail}`);
    }

    // A captive portal can answer 200 with HTML; surface that as a readable error
    // instead of a raw "Unexpected token <" from JSON.parse.
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('AI 服务返回了无法解析的内容（可能被网络登录页拦截），请稍后重试');
    }
    const rawContent = data.choices?.[0]?.message?.content || '';
    return rawContent;
  } catch (error) {
    throw toReadableRequestError(error);
  } finally {
    request.cleanup();
  }
}

/**
 * 1. Smart Word Lookup & Contextual Analysis
 */
export async function analyzeWordWithAI(word, contextSentence = '', { signal } = {}) {
  const prompt = `你是一位顶尖的英语语言学专家与中英双语词典编纂者。
请详细分析英文单词或词组: "${word}"。
${contextSentence ? `该词出现在以下上下文中: "${contextSentence}"` : ''}

请务必以严格的 JSON 格式输出，不要包含任何Markdown之外的额外寒暄，格式如下:
{
  "word": "${word}",
  "phonetic": "/美式音标/",
  "pos": "词性，如 n. / v. / adj.",
  "translation": "准确贴合该语境的简练中文释义 (可附带1-2个常见含义)",
  "definitionEn": "Concise and clear English definition",
  "contextSentence": "${contextSentence ? contextSentence.replace(/"/g, '\\"') : '例句'}",
  "contextSentenceCn": "该上下文句子的优雅中文翻译",
  "collocations": ["常见搭配1", "常见搭配2"],
  "memoryTip": "一句趣味联想或词根词缀助记法"
}`;

  const messages = [
    { role: 'system', content: 'You are an expert bilingual lexicographer. Output strictly valid JSON.' },
    { role: 'user', content: prompt },
  ];

  const raw = await callAICompletion({ messages, temperature: 0.3, responseFormatJson: true, signal });
  return normalizeWordAnalysis(extractJson(raw), { word, sentence: contextSentence });
}

/**
 * 2. Deep Sentence & Grammar Breakdown
 */
export async function analyzeSentenceWithAI(sentence, { signal } = {}) {
  const prompt = `你是一位富有洞察力的资深英语私教。请为学习者深入浅出地剖析以下英文句子：
"${sentence}"

请以严格的 JSON 格式输出，结构如下：
{
  "translation": "纯正地道的中文参考译文",
  "structureSummary": "一句话点破该句子的主干骨架（例如：主句为主系表结构，后接现在分词短语作伴随状语）",
  "clauses": [
    {
      "type": "主句 / 定语从句 / 条件状语 / 分词短语",
      "text": "对应英文片段",
      "explanation": "通俗剖析该部分的作用与连词使用"
    }
  ],
  "grammarPoints": [
    "语法亮点1（如虚拟语气、倒装、强调句式等具体讲解）",
    "语法亮点2"
  ],
  "betterExpressions": [
    "如果日常口语/写作中想表达类似意思，更地道或更简明的替代说法"
  ]
}`;

  const messages = [
    { role: 'system', content: 'You are a warm, highly clear English grammar tutor. Output strictly valid JSON.' },
    { role: 'user', content: prompt },
  ];

  const raw = await callAICompletion({ messages, temperature: 0.3, responseFormatJson: true, signal });
  return normalizeSentenceAnalysis(extractJson(raw), { sentence });
}

/**
 * Compress older oral-chat turns into a lightweight memory capsule.
 * Keeps long conversations coherent without sending the entire history on every request.
 */
function buildOralConversationContext(history, userMessage) {
  const getText = (message) => (
    typeof message.content === 'string'
      ? message.content
      : message.replyText || message.text || ''
  ).trim();

  const normalized = history
    .map((message) => ({ role: message.role, content: getText(message) }))
    .filter((message) => message.content);

  // OralCoach already appends the current user message before calling this service.
  // Remove it here because userMessage is added once at the end of the final request.
  const last = normalized.at(-1);
  const historyWithoutCurrent =
    last?.role === 'user' && last.content === userMessage.trim()
      ? normalized.slice(0, -1)
      : normalized;

  const recentMessages = historyWithoutCurrent.slice(-8);
  const earlierMessages = historyWithoutCurrent.slice(0, -8);
  const memoryLines = earlierMessages.slice(-24).map((message) => {
    const speaker = message.role === 'user' ? 'Learner' : 'Echo';
    const compactText = message.content.replace(/\s+/g, ' ').slice(0, 260);
    return `${speaker}: ${compactText}`;
  });

  return {
    recentMessages,
    memoryCapsule: memoryLines.join('\n').slice(-4200),
  };
}

/**
 * 3. Oral Dialogue with Dual-Track Feedback (Chat + Correction) - Stream Support
 */
export async function getOralCoachResponseStream({
  history = [],
  userMessage,
  scenarioPrompt = '',
  targetWords = [],
  onStreamText,
  signal,
}) {
  const targetWordsPrompt =
    targetWords.length > 0
      ? `用户正在进行【口语实战生词通缉挑战】，目标挑战词汇为: [${targetWords.join(', ')}]。
请在你的提问中巧妙设计情境，引导用户在接下来的回答中主动使用这些词汇。
特别注意：如果用户在上一句话中已经成功使用了这些单词中的任何一个，请在你的 replyText 开头真诚地热情表扬用户用词地道自然（例如 "Brilliant use of the word '${targetWords[0]}'! That sounded super natural."），给用户强烈的正向成就感！`
      : '';

  const systemPrompt = `You are "Echo", a friendly, empathetic, and encouraging personal native English speaking coach.
Your mission is to have an engaging real-world spoken English conversation with the learner while helping them speak more naturally and accurately.

Context & Scenario:
${scenarioPrompt || 'A casual, natural daily conversation between close friends.'}

${targetWordsPrompt}

CRITICAL: You must return your response in strictly valid JSON format matching this schema:
{
  "replyText": "Your natural, conversational spoken reply in English (keep it conversational, 2-4 sentences max, ask a thought-provoking open question to keep the dialogue flowing).",
  "replyTextCn": "中文口语化大意（帮助初学者理解）",
  "feedback": {
    "hasSlip": true/false (true if user had grammar mistakes, awkward word choice, or unnatural phrasing),
    "userOriginal": "Exact problematic phrase or sentence from the user",
    "corrected": "How a native speaker would say it correctly and naturally",
    "explanationZh": "用温和易懂的中文指出小毛病（如时态、单复数、搭配、中式英语思维）",
    "betterAlternative": "更有高级感或更加口语地道的外教级表达推荐 (1句)"
  },
  "suggestedReplies": [
    "A sample short reply the user could say next (Option 1)",
    "Another interesting angle reply (Option 2)"
  ]
}`;

  const { recentMessages, memoryCapsule } = buildOralConversationContext(history, userMessage);
  const memoryPrompt = memoryCapsule
    ? `\n\nEARLIER CONVERSATION MEMORY (compressed transcript):\n${memoryCapsule}\nUse this memory only to preserve the learner's previously shared background, preferences, plans, and conversational continuity. Do not repeat it verbatim.`
    : '';

  const formattedMessages = [
    { role: 'system', content: `${systemPrompt}${memoryPrompt}` },
    ...recentMessages,
    { role: 'user', content: userMessage },
  ];

  const fullRaw = await callAICompletionStream({
    messages: formattedMessages,
    temperature: 0.7,
    responseFormatJson: true,
    signal,
    onChunk: (_chunk, accumulated) => {
      if (onStreamText) {
        const partial = extractPartialReplyText(accumulated);
        if (partial) {
          onStreamText(partial);
        }
      }
    },
  });

  try {
    return normalizeOralResponse(extractJson(fullRaw));
  } catch (err) {
    const fallbackText = extractPartialReplyText(fullRaw);
    if (fallbackText) {
      return {
        replyText: fallbackText,
        replyTextCn: '',
        feedback: { hasSlip: false },
        suggestedReplies: [],
      };
    }
    throw err;
  }
}

export async function getOralCoachResponse({
  history = [],
  userMessage,
  scenarioPrompt = '',
  targetWords = [],
}) {
  const targetWordsPrompt =
    targetWords.length > 0
      ? `用户当前正在复习以下重点生词: [${targetWords.join(', ')}]。如果情境自然，请尽量在你的回答中恰当地使用它们，或者巧妙地引导用户在下一句使用它们。`
      : '';

  const systemPrompt = `You are "Echo", a friendly, empathetic, and encouraging personal native English speaking coach.
Your mission is to have an engaging real-world spoken English conversation with the learner while helping them speak more naturally and accurately.

Context & Scenario:
${scenarioPrompt || 'A casual, natural daily conversation between close friends.'}

${targetWordsPrompt}

CRITICAL: You must return your response in strictly valid JSON format matching this schema:
{
  "replyText": "Your natural, conversational spoken reply in English (keep it conversational, 2-4 sentences max, ask a thought-provoking open question to keep the dialogue flowing).",
  "replyTextCn": "中文口语化大意（帮助初学者理解）",
  "feedback": {
    "hasSlip": true/false (true if user had grammar mistakes, awkward word choice, or unnatural phrasing),
    "userOriginal": "Exact problematic phrase or sentence from the user",
    "corrected": "How a native speaker would say it correctly and naturally",
    "explanationZh": "用温和易懂的中文指出小毛病（如时态、单复数、搭配、中式英语思维）",
    "betterAlternative": "更有高级感或更加口语地道的外教级表达推荐 (1句)"
  },
  "suggestedReplies": [
    "A sample short reply the user could say next (Option 1)",
    "Another interesting angle reply (Option 2)"
  ]
}`;

  const { recentMessages, memoryCapsule } = buildOralConversationContext(history, userMessage);
  const memoryPrompt = memoryCapsule
    ? `\n\nEARLIER CONVERSATION MEMORY (compressed transcript):\n${memoryCapsule}\nUse it to preserve continuity without repeating it verbatim.`
    : '';

  const formattedMessages = [
    { role: 'system', content: `${systemPrompt}${memoryPrompt}` },
    ...recentMessages,
    { role: 'user', content: userMessage },
  ];

  const raw = await callAICompletion({
    messages: formattedMessages,
    temperature: 0.7,
    responseFormatJson: true,
  });

  return normalizeOralResponse(extractJson(raw));
}

/**
 * 4. Generate AI Quiz from Vocabulary Book
 */
export async function generateVocabularyQuiz(words) {
  const wordsSummary = words.map((w) => `${w.word} (${w.pos} ${w.translation})`).join(', ');

  const prompt = `基于用户的生词本中的生词: [${wordsSummary}]，为用户生成 3 道生动有趣的英语小测验（填空题或情境运用题）。
请以严格的 JSON 格式输出：
{
  "questions": [
    {
      "id": 1,
      "targetWord": "考察的单词",
      "sentenceWithBlank": "英文语境句子，用 ____ 代表需要填入的词",
      "sentenceCn": "该句子的中文意思",
      "options": ["正确选项", "干扰项1", "干扰项2", "干扰项3"],
      "correctIndex": 0,
      "explanation": "简短的中文解析与搭配讲解"
    }
  ]
}`;

  const messages = [
    { role: 'system', content: 'You are an expert English quiz creator. Output strictly valid JSON.' },
    { role: 'user', content: prompt },
  ];

  const raw = await callAICompletion({ messages, temperature: 0.4, responseFormatJson: true });
  return normalizeVocabularyQuiz(extractJson(raw));
}

/**
 * 5. Quick Paragraph Translation for Reader
 */
export async function translateParagraphWithAI(paragraph) {
  const prompt = `请将以下英文段落准确翻译为地道、通顺的中文，直接返回译文内容，不要包含任何多余前缀或寒暄：\n\n"${paragraph}"`;
  const messages = [
    { role: 'system', content: 'You are a professional bilingual translator. Output only the translation.' },
    { role: 'user', content: prompt },
  ];
  const raw = await callAICompletion({ messages, temperature: 0.3 });
  return raw.trim();
}

/**
 * 6. Vocab Story Studio (AI Micro-Drama Generator)
 */
export async function generateVocabStoryWithAI({
  words = [],
  genre = 'mystery',
}) {
  const genreLabels = {
    mystery: '悬疑推理 (Suspense / Detective)',
    workplace: '硅谷职场 (Tech & Workplace Drama)',
    romance: '都市温情 (Heartwarming Romance)',
    cyberpunk: '未来科幻 (Cyberpunk / Sci-Fi)',
  };
  const genreDesc = genreLabels[genre] || genreLabels.mystery;
  const wordsFormatted = words.map((w) => `${w.word} (${w.translation || ''})`).join(', ');

  const prompt = `你是一位才华横溢的双语微小说作家与影视编剧。
请为英语自学者创作一篇极具情节张力与画面感的英语微短剧/小说（约 150~220 英文词）。
题材风格: 【${genreDesc}】。

核心任务要求：
1. 必须将以下所有目标生词【严丝合缝、自然巧妙地融入情节中】，每个生词在故事中出现时，必须使用 Markdown 加粗标记为 **word**（例如 **ubiquitous**）:
[${wordsFormatted}]

2. 故事必须扣人心弦，节奏紧凑，分成 2~3 个自然段落。

3. 请以严格的 JSON 格式输出，格式如下：
{
  "title": "A Punchy English Title",
  "titleCn": "生动吸引人的中文译名",
  "storyEn": "The full English micro-story with the **target words** bolded in Markdown...",
  "storyCn": "对应的高水准优雅中文译文...",
  "genre": "${genre}",
  "usedWords": ["考察词1", "考察词2"]
}`;

  const messages = [
    { role: 'system', content: 'You are an elite bilingual fiction author. Output strictly valid JSON.' },
    { role: 'user', content: prompt },
  ];

  const raw = await callAICompletion({ messages, temperature: 0.7, responseFormatJson: true });
  return normalizeVocabStory(extractJson(raw), { genre });
}

/**
 * 7. AI Daily Editorial Article Generator
 */
export async function generateDailyArticleWithAI({
  topic = 'random',
  targetWords = [],
}) {
  const topicMap = {
    random: '随心惊喜 (Curated Surprise)',
    lifestyle: '生活方式与心智散文 (The New Yorker / Lifestyle Essay)',
    tech: '前沿科技与未来商业 (Wired / Tech & Business)',
    culture: '人文地理与城市漫游 (National Geographic / Cultural Travelogue)',
    psychology: '心智认知与习惯成长 (Cognitive Psychology & Habits)',
  };

  const topicLabel = topicMap[topic] || topicMap.random;
  const targetWordsPrompt =
    targetWords.length > 0
      ? `特别要求：请在文章中巧妙、自然地融入学习者的重点生词: [${targetWords.join(', ')}]，让读者在真实上下文情境中自然偶遇它们！`
      : '';

  const prompt = `你是一位享誉全球的国际双语特约撰稿人与专栏作家。
请为英语自学进阶者撰写一篇短小精悍、文笔优雅生动、极具深度的现代英文外刊短文（约 180~250 英文词，2~3 个自然段）。
题材定位: 【${topicLabel}】。
${targetWordsPrompt}

写作要求：
1. 语言纯正自然，富有行文节奏美，适合自学者精读与长难句剖析。
2. 请以严格的 JSON 格式输出，格式如下：
{
  "title": "A Compelling Editorial Headline",
  "titleCn": "生动优雅的中文译名",
  "level": "中级精选 (Intermediate)",
  "content": "Paragraph 1 (approx 70 words)...\\n\\nParagraph 2 (approx 80 words)...\\n\\nParagraph 3 (approx 70 words)...",
  "tags": ["AI 每日精读", "${topicLabel.split(' ')[0]}"],
  "summaryCn": "一句话中文导读推荐语"
}`;

  const messages = [
    { role: 'system', content: 'You are an award-winning bilingual essayist and journalist. Output strictly valid JSON.' },
    { role: 'user', content: prompt },
  ];

  const raw = await callAICompletion({ messages, temperature: 0.7, responseFormatJson: true });
  return normalizeArticle(extractJson(raw));
}
