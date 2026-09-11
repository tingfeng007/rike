import { StorageService } from './storage';

/**
 * Clean and format the base URL
 */
function cleanBaseUrl(url) {
  if (!url) return 'https://api.deepseek.com';
  let cleaned = url.trim().replace(/\/+$/, '');
  return cleaned;
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
 */
export async function callAICompletionStream({
  messages,
  temperature = 0.7,
  responseFormatJson = false,
  onChunk,
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

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(bodyPayload),
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

  if (!res.body) {
    throw new Error('当前环境不支持流式响应');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;

      if (trimmed.startsWith('data: ')) {
        const dataStr = trimmed.slice(6).trim();
        if (dataStr === '[DONE]') {
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
 */
export async function callAICompletion({
  messages,
  temperature = 0.7,
  responseFormatJson = false,
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

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(bodyPayload),
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

  const data = await res.json();
  const rawContent = data.choices?.[0]?.message?.content || '';
  return rawContent;
}

/**
 * 1. Smart Word Lookup & Contextual Analysis
 */
export async function analyzeWordWithAI(word, contextSentence = '') {
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

  const raw = await callAICompletion({ messages, temperature: 0.3, responseFormatJson: true });
  return extractJson(raw);
}

/**
 * 2. Deep Sentence & Grammar Breakdown
 */
export async function analyzeSentenceWithAI(sentence) {
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

  const raw = await callAICompletion({ messages, temperature: 0.3, responseFormatJson: true });
  return extractJson(raw);
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

  const formattedMessages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8).map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.replyText || m.text,
    })),
    { role: 'user', content: userMessage },
  ];

  const fullRaw = await callAICompletionStream({
    messages: formattedMessages,
    temperature: 0.7,
    responseFormatJson: true,
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
    return extractJson(fullRaw);
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

/**
 * 4. Quick Paragraph Translation for Reader
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

  const formattedMessages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8).map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.replyText || m.text,
    })),
    { role: 'user', content: userMessage },
  ];

  const raw = await callAICompletion({
    messages: formattedMessages,
    temperature: 0.7,
    responseFormatJson: true,
  });

  return extractJson(raw);
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
  return extractJson(raw);
}
