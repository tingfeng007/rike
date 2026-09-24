import{E as e,m as t,t as n}from"./index-CrvCporr.js";function r(e){return e?e.trim().replace(/\/+$/,``):`https://api.deepseek.com`}function i(e){try{return JSON.parse(e)}catch{let t=e.match(/```(?:json)?\s*([\s\S]*?)\s*```/);if(t&&t[1])try{return JSON.parse(t[1])}catch{}let n=e.indexOf(`{`),r=e.lastIndexOf(`}`);if(n!==-1&&r!==-1&&r>n)try{return JSON.parse(e.slice(n,r+1))}catch{}let i=e.indexOf(`[`),a=e.lastIndexOf(`]`);if(i!==-1&&a!==-1&&a>i)try{return JSON.parse(e.slice(i,a+1))}catch{}throw Error(`未能从AI回复中解析出有效的JSON数据`)}}async function a({messages:e,temperature:n=.7,responseFormatJson:i=!1,onChunk:a}){let o=t.getSettings(),s=o.apiKey?.trim();if(!s)throw Error(`未配置 API Key，请先进入“设置”页面填入您的 API Key`);let c=`${r(o.baseUrl)}/chat/completions`,l={model:o.model||`deepseek-chat`,messages:e,temperature:n,stream:!0};i&&(l.response_format={type:`json_object`});let u=await fetch(c,{method:`POST`,headers:{"Content-Type":`application/json`,Authorization:`Bearer ${s}`},body:JSON.stringify(l)});if(!u.ok){let e=await u.text(),t=e;try{let n=JSON.parse(e);t=n.error?.message||n.message||e}catch{}throw Error(`AI请求失败 (${u.status}): ${t}`)}if(!u.body)throw Error(`当前环境不支持流式响应`);let d=u.body.getReader(),f=new TextDecoder(`utf-8`),p=``,m=``;for(;;){let{done:e,value:t}=await d.read();if(e)break;m+=f.decode(t,{stream:!0});let n=m.split(`
`);m=n.pop()||``;for(let e of n){let t=e.trim();if(t&&!t.startsWith(`:`)&&t.startsWith(`data: `)){let e=t.slice(6).trim();if(e===`[DONE]`)break;try{let t=JSON.parse(e).choices?.[0]?.delta?.content||``;t&&(p+=t,a&&a(t,p))}catch{}}}}return p}function o(e){if(!e)return``;let t=e.indexOf(`"replyText"`);if(t===-1)return``;let n=e.indexOf(`:`,t);if(n===-1)return``;let r=e.indexOf(`"`,n);if(r===-1)return``;let i=e.slice(r+1),a=``,o=!1;for(let e=0;e<i.length;e++){let t=i[e];if(o)a+=t===`n`?`
`:t,o=!1;else if(t===`\\`)o=!0;else if(t===`"`)break;else a+=t}return a}async function s({messages:e,temperature:n=.7,responseFormatJson:i=!1}){let a=t.getSettings(),o=a.apiKey?.trim();if(!o)throw Error(`未配置 API Key，请先进入“设置”页面填入您的 API Key`);let s=`${r(a.baseUrl)}/chat/completions`,c={model:a.model||`deepseek-chat`,messages:e,temperature:n};i&&(c.response_format={type:`json_object`});let l=await fetch(s,{method:`POST`,headers:{"Content-Type":`application/json`,Authorization:`Bearer ${o}`},body:JSON.stringify(c)});if(!l.ok){let e=await l.text(),t=e;try{let n=JSON.parse(e);t=n.error?.message||n.message||e}catch{}throw Error(`AI请求失败 (${l.status}): ${t}`)}return(await l.json()).choices?.[0]?.message?.content||``}async function c(e,t=``){return i(await s({messages:[{role:`system`,content:`You are an expert bilingual lexicographer. Output strictly valid JSON.`},{role:`user`,content:`你是一位顶尖的英语语言学专家与中英双语词典编纂者。
请详细分析英文单词或词组: "${e}"。
${t?`该词出现在以下上下文中: "${t}"`:``}

请务必以严格的 JSON 格式输出，不要包含任何Markdown之外的额外寒暄，格式如下:
{
  "word": "${e}",
  "phonetic": "/美式音标/",
  "pos": "词性，如 n. / v. / adj.",
  "translation": "准确贴合该语境的简练中文释义 (可附带1-2个常见含义)",
  "definitionEn": "Concise and clear English definition",
  "contextSentence": "${t?t.replace(/"/g,`\\"`):`例句`}",
  "contextSentenceCn": "该上下文句子的优雅中文翻译",
  "collocations": ["常见搭配1", "常见搭配2"],
  "memoryTip": "一句趣味联想或词根词缀助记法"
}`}],temperature:.3,responseFormatJson:!0}))}async function l(e){return i(await s({messages:[{role:`system`,content:`You are a warm, highly clear English grammar tutor. Output strictly valid JSON.`},{role:`user`,content:`你是一位富有洞察力的资深英语私教。请为学习者深入浅出地剖析以下英文句子：
"${e}"

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
}`}],temperature:.3,responseFormatJson:!0}))}function u(e,t){let n=e=>(typeof e.content==`string`?e.content:e.replyText||e.text||``).trim(),r=e.map(e=>({role:e.role,content:n(e)})).filter(e=>e.content),i=r.at(-1),a=i?.role===`user`&&i.content===t.trim()?r.slice(0,-1):r;return{recentMessages:a.slice(-8),memoryCapsule:a.slice(0,-8).slice(-24).map(e=>`${e.role===`user`?`Learner`:`Echo`}: ${e.content.replace(/\s+/g,` `).slice(0,260)}`).join(`
`).slice(-4200)}}async function d({history:e=[],userMessage:t,scenarioPrompt:n=``,targetWords:r=[],onStreamText:s}){let c=r.length>0?`用户正在进行【口语实战生词通缉挑战】，目标挑战词汇为: [${r.join(`, `)}]。
请在你的提问中巧妙设计情境，引导用户在接下来的回答中主动使用这些词汇。
特别注意：如果用户在上一句话中已经成功使用了这些单词中的任何一个，请在你的 replyText 开头真诚地热情表扬用户用词地道自然（例如 "Brilliant use of the word '${r[0]}'! That sounded super natural."），给用户强烈的正向成就感！`:``,l=`You are "Echo", a friendly, empathetic, and encouraging personal native English speaking coach.
Your mission is to have an engaging real-world spoken English conversation with the learner while helping them speak more naturally and accurately.

Context & Scenario:
${n||`A casual, natural daily conversation between close friends.`}

${c}

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
}`,{recentMessages:d,memoryCapsule:f}=u(e,t),p=await a({messages:[{role:`system`,content:`${l}${f?`\n\nEARLIER CONVERSATION MEMORY (compressed transcript):\n${f}\nUse this memory only to preserve the learner's previously shared background, preferences, plans, and conversational continuity. Do not repeat it verbatim.`:``}`},...d,{role:`user`,content:t}],temperature:.7,responseFormatJson:!0,onChunk:(e,t)=>{if(s){let e=o(t);e&&s(e)}}});try{return i(p)}catch(e){let t=o(p);if(t)return{replyText:t,replyTextCn:``,feedback:{hasSlip:!1},suggestedReplies:[]};throw e}}async function f(e){return i(await s({messages:[{role:`system`,content:`You are an expert English quiz creator. Output strictly valid JSON.`},{role:`user`,content:`基于用户的生词本中的生词: [${e.map(e=>`${e.word} (${e.pos} ${e.translation})`).join(`, `)}]，为用户生成 3 道生动有趣的英语小测验（填空题或情境运用题）。
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
}`}],temperature:.4,responseFormatJson:!0}))}async function p(e){return(await s({messages:[{role:`system`,content:`You are a professional bilingual translator. Output only the translation.`},{role:`user`,content:`请将以下英文段落准确翻译为地道、通顺的中文，直接返回译文内容，不要包含任何多余前缀或寒暄：\n\n"${e}"`}],temperature:.3})).trim()}async function m({words:e=[],genre:t=`mystery`}){let n={mystery:`悬疑推理 (Suspense / Detective)`,workplace:`硅谷职场 (Tech & Workplace Drama)`,romance:`都市温情 (Heartwarming Romance)`,cyberpunk:`未来科幻 (Cyberpunk / Sci-Fi)`};return i(await s({messages:[{role:`system`,content:`You are an elite bilingual fiction author. Output strictly valid JSON.`},{role:`user`,content:`你是一位才华横溢的双语微小说作家与影视编剧。
请为英语自学者创作一篇极具情节张力与画面感的英语微短剧/小说（约 150~220 英文词）。
题材风格: 【${n[t]||n.mystery}】。

核心任务要求：
1. 必须将以下所有目标生词【严丝合缝、自然巧妙地融入情节中】，每个生词在故事中出现时，必须使用 Markdown 加粗标记为 **word**（例如 **ubiquitous**）:
[${e.map(e=>`${e.word} (${e.translation||``})`).join(`, `)}]

2. 故事必须扣人心弦，节奏紧凑，分成 2~3 个自然段落。

3. 请以严格的 JSON 格式输出，格式如下：
{
  "title": "A Punchy English Title",
  "titleCn": "生动吸引人的中文译名",
  "storyEn": "The full English micro-story with the **target words** bolded in Markdown...",
  "storyCn": "对应的高水准优雅中文译文...",
  "genre": "${t}",
  "usedWords": ["考察词1", "考察词2"]
}`}],temperature:.7,responseFormatJson:!0}))}async function h({topic:e=`random`,targetWords:t=[]}){let n={random:`随心惊喜 (Curated Surprise)`,lifestyle:`生活方式与心智散文 (The New Yorker / Lifestyle Essay)`,tech:`前沿科技与未来商业 (Wired / Tech & Business)`,culture:`人文地理与城市漫游 (National Geographic / Cultural Travelogue)`,psychology:`心智认知与习惯成长 (Cognitive Psychology & Habits)`},r=n[e]||n.random;return i(await s({messages:[{role:`system`,content:`You are an award-winning bilingual essayist and journalist. Output strictly valid JSON.`},{role:`user`,content:`你是一位享誉全球的国际双语特约撰稿人与专栏作家。
请为英语自学进阶者撰写一篇短小精悍、文笔优雅生动、极具深度的现代英文外刊短文（约 180~250 英文词，2~3 个自然段）。
题材定位: 【${r}】。
${t.length>0?`特别要求：请在文章中巧妙、自然地融入学习者的重点生词: [${t.join(`, `)}]，让读者在真实上下文情境中自然偶遇它们！`:``}

写作要求：
1. 语言纯正自然，富有行文节奏美，适合自学者精读与长难句剖析。
2. 请以严格的 JSON 格式输出，格式如下：
{
  "title": "A Compelling Editorial Headline",
  "titleCn": "生动优雅的中文译名",
  "level": "中级精选 (Intermediate)",
  "content": "Paragraph 1 (approx 70 words)...\\n\\nParagraph 2 (approx 80 words)...\\n\\nParagraph 3 (approx 70 words)...",
  "tags": ["AI 每日精读", "${r.split(` `)[0]}"],
  "summaryCn": "一句话中文导读推荐语"
}`}],temperature:.7,responseFormatJson:!0}))}e();var g=n();function _({eyebrow:e,title:t,description:n,icon:r,status:i,actions:a,children:o}){return(0,g.jsxs)(`header`,{className:`study-hero flex-none px-4 pt-[max(env(safe-area-inset-top,0px),14px)] pb-3 text-white z-20`,children:[(0,g.jsxs)(`div`,{className:`relative flex items-start justify-between gap-3`,children:[(0,g.jsxs)(`div`,{className:`min-w-0 flex-1`,children:[(0,g.jsxs)(`div`,{className:`flex items-center gap-2 text-[10px] font-bold tracking-[0.18em] text-amber-300`,children:[r&&(0,g.jsx)(`span`,{className:`grid h-7 w-7 place-items-center rounded-xl bg-white/10 text-sky-200 ring-1 ring-white/10`,children:r}),(0,g.jsx)(`span`,{children:e})]}),(0,g.jsxs)(`div`,{className:`mt-2 flex min-w-0 items-center gap-2`,children:[(0,g.jsx)(`h1`,{className:`editorial-serif truncate text-[23px] font-bold leading-tight tracking-tight`,children:t}),i&&(0,g.jsx)(`span`,{className:`flex-none rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold text-sky-100 ring-1 ring-white/10`,children:i})]}),n&&(0,g.jsx)(`p`,{className:`mt-1.5 max-w-[300px] text-[11px] leading-5 text-slate-300`,children:n})]}),a&&(0,g.jsx)(`div`,{className:`flex flex-none items-center gap-1.5 pt-0.5`,children:a})]}),o&&(0,g.jsx)(`div`,{className:`relative mt-3 border-t border-white/10 pt-3`,children:o})]})}export{h as a,d as c,s as i,p as l,l as n,m as o,c as r,f as s,_ as t};