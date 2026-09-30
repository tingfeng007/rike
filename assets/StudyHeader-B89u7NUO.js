import{M as e,_ as t,j as n,n as r,v as i}from"./index-BECJuJ5H.js";var a=6e4,o=3e4;function s(e,t=``){return typeof e==`string`?e:typeof e==`number`&&Number.isFinite(e)?String(e):t}function c(e,t=()=>!0){return Array.isArray(e)?e.map(e=>s(e)).filter(e=>e&&t(e)):[]}function l(e){let t=Array.isArray(e)?e:e?.questions;if(!Array.isArray(t))throw Error(`AI 返回的测验格式无法识别，请重试一次`);let n=new Set,r=[];if(t.forEach((e,t)=>{if(!e||typeof e!=`object`)return;let i=c(e.options);if(i.length<2)return;let a=Number(e.correctIndex);if(!Number.isInteger(a)||a<0||a>=i.length){let t=s(e.answer||e.correctOption).trim().toLowerCase(),n=t?i.findIndex(e=>e.trim().toLowerCase()===t):-1;if(n<0)return;a=n}let o=s(e.id).trim()||`q_${t+1}`;for(;n.has(o);)o=`${o}_${r.length+1}`;n.add(o),r.push({id:o,targetWord:s(e.targetWord||e.word),sentenceWithBlank:s(e.sentenceWithBlank||e.sentence||e.question),sentenceCn:s(e.sentenceCn),options:i,correctIndex:a,explanation:s(e.explanation)})}),r.length===0)throw Error(`AI 这次没有给出可用的测验题，请再试一次`);return{questions:r}}function u(e,{genre:t=`mystery`}={}){let n=e&&typeof e==`object`&&!Array.isArray(e)?e:{},r=s(n.storyEn||n.story||n.content).trim();if(!r)throw Error(`AI 这次没有返回故事正文，请重试一次`);return{title:s(n.title,`A LingoFlow Story`),titleCn:s(n.titleCn,`生词微剧场`),storyEn:r,storyCn:s(n.storyCn),genre:s(n.genre,t),usedWords:c(n.usedWords)}}function d(e){let t=e&&typeof e==`object`&&!Array.isArray(e)?e:{},n=s(t.content||t.body||t.text).trim();if(!n)throw Error(`AI 这次没有返回文章正文，请重试一次`);return{title:s(t.title,`AI 精选外刊`),titleCn:s(t.titleCn),level:s(t.level),content:n,tags:c(t.tags)}}function f(e,{word:t=``,sentence:n=``}={}){let r=e&&typeof e==`object`&&!Array.isArray(e)?e:{};return{...r,word:s(r.word,t),phonetic:s(r.phonetic),pos:s(r.pos),translation:s(r.translation),definitionEn:s(r.definitionEn),contextSentence:s(r.contextSentence,n),contextSentenceCn:s(r.contextSentenceCn),memoryTip:s(r.memoryTip),collocations:c(r.collocations)}}function p(e,{sentence:t=``}={}){let n=e&&typeof e==`object`&&!Array.isArray(e)?e:{},r=Array.isArray(n.clauses)?n.clauses.filter(e=>e&&typeof e==`object`).map(e=>({type:s(e.type,`成分`),text:s(e.text),explanation:s(e.explanation)})):[];return{...n,sentence:s(n.sentence,t),structureSummary:s(n.structureSummary),translation:s(n.translation),clauses:r,grammarPoints:c(n.grammarPoints)}}function m(e){return e?e.trim().replace(/\/+$/,``):`https://api.deepseek.com`}function h(e,t){let n=new AbortController,r=null,i=(e=t)=>{r&&clearTimeout(r),!(!Number.isFinite(e)||e<=0)&&(r=setTimeout(()=>{try{n.abort(new DOMException(`AI 请求超过 ${Math.round(e/1e3)} 秒未响应`,`TimeoutError`))}catch{n.abort()}},e))},a=()=>{try{n.abort(e?.reason)}catch{n.abort()}};return e&&(e.aborted?a():e.addEventListener(`abort`,a,{once:!0})),i(),{signal:n.signal,arm:i,cleanup(){r&&clearTimeout(r),r=null,e&&e.removeEventListener(`abort`,a)}}}function g(e){let t=e?.name;if(t===`TimeoutError`){let t=Error(e?.message||`AI 请求超时，请检查网络后重试`);return t.name=`TimeoutError`,t}if(t===`AbortError`){let e=Error(`AI 请求已取消`);return e.name=`AbortError`,e}return e instanceof TypeError?Error(`无法连接 AI 服务：请检查网络连接或设置中的接口地址`):e instanceof Error?e:Error(String(e))}function _(e){try{return JSON.parse(e)}catch{let t=e.match(/```(?:json)?\s*([\s\S]*?)\s*```/);if(t&&t[1])try{return JSON.parse(t[1])}catch{}let n=e.indexOf(`{`),r=e.lastIndexOf(`}`);if(n!==-1&&r!==-1&&r>n)try{return JSON.parse(e.slice(n,r+1))}catch{}let i=e.indexOf(`[`),a=e.lastIndexOf(`]`);if(i!==-1&&a!==-1&&a>i)try{return JSON.parse(e.slice(i,a+1))}catch{}throw Error(`未能从AI回复中解析出有效的JSON数据`)}}async function v({messages:e,temperature:n=.7,responseFormatJson:r=!1,onChunk:i,signal:a,idleTimeoutMs:s=o}){let c=t.getSettings(),l=c.apiKey?.trim();if(!l)throw Error(`未配置 API Key，请先进入“设置”页面填入您的 API Key`);let u=`${m(c.baseUrl)}/chat/completions`,d={model:c.model||`deepseek-chat`,messages:e,temperature:n,stream:!0};r&&(d.response_format={type:`json_object`});let f=h(a,s),p;try{p=await fetch(u,{method:`POST`,headers:{"Content-Type":`application/json`,Authorization:`Bearer ${l}`},body:JSON.stringify(d),signal:f.signal})}catch(e){throw f.cleanup(),g(e)}if(!p.ok){f.cleanup();let e=await p.text(),t=e;try{let n=JSON.parse(e);t=n.error?.message||n.message||e}catch{}throw Error(`AI请求失败 (${p.status}): ${t}`)}if(!p.body)throw f.cleanup(),Error(`当前环境不支持流式响应`);let _=p.body.getReader(),v=new TextDecoder(`utf-8`),y=``,b=``,x=!1;try{for(;!x;){let{done:e,value:t}=await _.read();if(e)break;f.arm(s),b+=v.decode(t,{stream:!0});let n=b.split(`
`);b=n.pop()||``;for(let e of n){let t=e.trim();if(t&&!t.startsWith(`:`)&&t.startsWith(`data: `)){let e=t.slice(6).trim();if(e===`[DONE]`){x=!0;break}try{let t=JSON.parse(e).choices?.[0]?.delta?.content||``;t&&(y+=t,i&&i(t,y))}catch{}}}}}catch(e){let t=g(e);if(y&&!a?.aborted)return y;throw t}finally{f.cleanup();try{await _.cancel()}catch{}}return y}function y(e){if(!e)return``;let t=e.indexOf(`"replyText"`);if(t===-1)return``;let n=e.indexOf(`:`,t);if(n===-1)return``;let r=e.indexOf(`"`,n);if(r===-1)return``;let i=e.slice(r+1),a=``,o=!1;for(let e=0;e<i.length;e++){let t=i[e];if(o)a+=t===`n`?`
`:t,o=!1;else if(t===`\\`)o=!0;else if(t===`"`)break;else a+=t}return a}async function b({messages:e,temperature:n=.7,responseFormatJson:r=!1,signal:i,timeoutMs:o=a}){let s=t.getSettings(),c=s.apiKey?.trim();if(!c)throw Error(`未配置 API Key，请先进入“设置”页面填入您的 API Key`);let l=`${m(s.baseUrl)}/chat/completions`,u={model:s.model||`deepseek-chat`,messages:e,temperature:n};r&&(u.response_format={type:`json_object`});let d=h(i,o);try{let e=await fetch(l,{method:`POST`,headers:{"Content-Type":`application/json`,Authorization:`Bearer ${c}`},body:JSON.stringify(u),signal:d.signal});if(!e.ok){let t=await e.text(),n=t;try{let e=JSON.parse(t);n=e.error?.message||e.message||t}catch{}throw Error(`AI请求失败 (${e.status}): ${n}`)}let t;try{t=await e.json()}catch{throw Error(`AI 服务返回了无法解析的内容（可能被网络登录页拦截），请稍后重试`)}return t.choices?.[0]?.message?.content||``}catch(e){throw g(e)}finally{d.cleanup()}}async function x(e,t=``){return f(_(await b({messages:[{role:`system`,content:`You are an expert bilingual lexicographer. Output strictly valid JSON.`},{role:`user`,content:`你是一位顶尖的英语语言学专家与中英双语词典编纂者。
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
}`}],temperature:.3,responseFormatJson:!0})),{word:e,sentence:t})}async function S(e){return p(_(await b({messages:[{role:`system`,content:`You are a warm, highly clear English grammar tutor. Output strictly valid JSON.`},{role:`user`,content:`你是一位富有洞察力的资深英语私教。请为学习者深入浅出地剖析以下英文句子：
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
}`}],temperature:.3,responseFormatJson:!0})),{sentence:e})}function C(e,t){let n=e=>(typeof e.content==`string`?e.content:e.replyText||e.text||``).trim(),r=e.map(e=>({role:e.role,content:n(e)})).filter(e=>e.content),i=r.at(-1),a=i?.role===`user`&&i.content===t.trim()?r.slice(0,-1):r;return{recentMessages:a.slice(-8),memoryCapsule:a.slice(0,-8).slice(-24).map(e=>`${e.role===`user`?`Learner`:`Echo`}: ${e.content.replace(/\s+/g,` `).slice(0,260)}`).join(`
`).slice(-4200)}}async function w({history:e=[],userMessage:t,scenarioPrompt:n=``,targetWords:r=[],onStreamText:i,signal:a}){let o=r.length>0?`用户正在进行【口语实战生词通缉挑战】，目标挑战词汇为: [${r.join(`, `)}]。
请在你的提问中巧妙设计情境，引导用户在接下来的回答中主动使用这些词汇。
特别注意：如果用户在上一句话中已经成功使用了这些单词中的任何一个，请在你的 replyText 开头真诚地热情表扬用户用词地道自然（例如 "Brilliant use of the word '${r[0]}'! That sounded super natural."），给用户强烈的正向成就感！`:``,s=`You are "Echo", a friendly, empathetic, and encouraging personal native English speaking coach.
Your mission is to have an engaging real-world spoken English conversation with the learner while helping them speak more naturally and accurately.

Context & Scenario:
${n||`A casual, natural daily conversation between close friends.`}

${o}

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
}`,{recentMessages:c,memoryCapsule:l}=C(e,t),u=await v({messages:[{role:`system`,content:`${s}${l?`\n\nEARLIER CONVERSATION MEMORY (compressed transcript):\n${l}\nUse this memory only to preserve the learner's previously shared background, preferences, plans, and conversational continuity. Do not repeat it verbatim.`:``}`},...c,{role:`user`,content:t}],temperature:.7,responseFormatJson:!0,signal:a,onChunk:(e,t)=>{if(i){let e=y(t);e&&i(e)}}});try{return _(u)}catch(e){let t=y(u);if(t)return{replyText:t,replyTextCn:``,feedback:{hasSlip:!1},suggestedReplies:[]};throw e}}async function T(e){return l(_(await b({messages:[{role:`system`,content:`You are an expert English quiz creator. Output strictly valid JSON.`},{role:`user`,content:`基于用户的生词本中的生词: [${e.map(e=>`${e.word} (${e.pos} ${e.translation})`).join(`, `)}]，为用户生成 3 道生动有趣的英语小测验（填空题或情境运用题）。
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
}`}],temperature:.4,responseFormatJson:!0})))}async function E(e){return(await b({messages:[{role:`system`,content:`You are a professional bilingual translator. Output only the translation.`},{role:`user`,content:`请将以下英文段落准确翻译为地道、通顺的中文，直接返回译文内容，不要包含任何多余前缀或寒暄：\n\n"${e}"`}],temperature:.3})).trim()}async function D({words:e=[],genre:t=`mystery`}){let n={mystery:`悬疑推理 (Suspense / Detective)`,workplace:`硅谷职场 (Tech & Workplace Drama)`,romance:`都市温情 (Heartwarming Romance)`,cyberpunk:`未来科幻 (Cyberpunk / Sci-Fi)`};return u(_(await b({messages:[{role:`system`,content:`You are an elite bilingual fiction author. Output strictly valid JSON.`},{role:`user`,content:`你是一位才华横溢的双语微小说作家与影视编剧。
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
}`}],temperature:.7,responseFormatJson:!0})),{genre:t})}async function O({topic:e=`random`,targetWords:t=[]}){let n={random:`随心惊喜 (Curated Surprise)`,lifestyle:`生活方式与心智散文 (The New Yorker / Lifestyle Essay)`,tech:`前沿科技与未来商业 (Wired / Tech & Business)`,culture:`人文地理与城市漫游 (National Geographic / Cultural Travelogue)`,psychology:`心智认知与习惯成长 (Cognitive Psychology & Habits)`},r=n[e]||n.random;return d(_(await b({messages:[{role:`system`,content:`You are an award-winning bilingual essayist and journalist. Output strictly valid JSON.`},{role:`user`,content:`你是一位享誉全球的国际双语特约撰稿人与专栏作家。
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
}`}],temperature:.7,responseFormatJson:!0})))}var k=e(n(),1),A=r();function j({open:e,onClose:t,title:n,description:r,children:a,footer:o,placement:s=`center`,size:c=`md`,closeOnBackdrop:l=!0,showCloseButton:u=!0,className:d=``,panelClassName:f=`bg-white`,bodyClassName:p=``}){let m=(0,k.useRef)(null),h=(0,k.useRef)(null),g=(0,k.useId)(),_=(0,k.useId)();if((0,k.useEffect)(()=>{if(!e)return;h.current=typeof document<`u`?document.activeElement:null;let n=e=>{e.key===`Escape`&&(e.stopPropagation(),t?.())};document.addEventListener(`keydown`,n);let r=document.body.style.overflow;return document.body.style.overflow=`hidden`,(m.current?.querySelector(`[data-autofocus]`)||m.current)?.focus?.({preventScroll:!0}),()=>{document.removeEventListener(`keydown`,n),document.body.style.overflow=r,h.current?.focus?.({preventScroll:!0})}},[e,t]),!e)return null;let v={sm:`max-w-xs`,md:`max-w-md`,lg:`max-w-2xl`},y=s===`bottom`;return(0,A.jsxs)(`div`,{className:`fixed inset-0 z-50 flex justify-center ${y?`items-end`:`items-center px-4`}`,children:[l&&(0,A.jsx)(`button`,{type:`button`,tabIndex:-1,"aria-label":`关闭对话框`,onClick:()=>t?.(),className:`absolute inset-0 h-full w-full cursor-default bg-slate-900/45 backdrop-blur-xs`}),(0,A.jsxs)(`div`,{ref:m,role:`dialog`,"aria-modal":`true`,"aria-labelledby":n?g:void 0,"aria-describedby":r?_:void 0,tabIndex:-1,className:[`relative z-10 flex w-full flex-col shadow-2xl outline-none`,f,v[c]||v.md,y?`rounded-t-3xl`:`rounded-3xl`,d].join(` `),style:{maxHeight:y?`min(88dvh, 720px)`:`min(86dvh, 680px)`,paddingBottom:y?`max(0px, var(--safe-area-inset-bottom, 0px))`:void 0},children:[(n||u)&&(0,A.jsxs)(`div`,{className:`flex flex-none items-start justify-between gap-3 border-b border-slate-100 px-4 py-3`,children:[(0,A.jsxs)(`div`,{className:`min-w-0`,children:[n&&(0,A.jsx)(`h2`,{id:g,className:`text-sm font-bold text-slate-900`,children:n}),r&&(0,A.jsx)(`p`,{id:_,className:`mt-0.5 text-[11px] text-slate-500`,children:r})]}),u&&(0,A.jsx)(`button`,{type:`button`,onClick:()=>t?.(),"aria-label":`关闭`,className:`relative -mr-1 flex-none rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']`,children:(0,A.jsx)(i,{className:`h-4 w-4`})})]}),(0,A.jsx)(`div`,{className:`flex-1 overflow-y-auto px-4 py-4 ${p}`,children:a}),o&&(0,A.jsx)(`div`,{className:`flex-none border-t border-slate-100 px-4 py-3`,children:o})]})]})}function M(e){return(0,A.jsx)(j,{placement:`bottom`,...e})}function N({eyebrow:e,title:t,description:n,icon:r,status:i,actions:a,children:o}){return(0,A.jsxs)(`header`,{className:`study-hero flex-none px-4 pt-[max(env(safe-area-inset-top,0px),14px)] pb-3 text-white z-20`,children:[(0,A.jsxs)(`div`,{className:`relative flex items-start justify-between gap-3`,children:[(0,A.jsxs)(`div`,{className:`min-w-0 flex-1`,children:[(0,A.jsxs)(`div`,{className:`flex items-center gap-2 text-[10px] font-bold tracking-[0.18em] text-amber-300`,children:[r&&(0,A.jsx)(`span`,{className:`grid h-7 w-7 place-items-center rounded-xl bg-white/10 text-sky-200 ring-1 ring-white/10`,children:r}),(0,A.jsx)(`span`,{children:e})]}),(0,A.jsxs)(`div`,{className:`mt-2 flex min-w-0 items-center gap-2`,children:[(0,A.jsx)(`h1`,{className:`editorial-serif truncate text-[23px] font-bold leading-tight tracking-tight`,children:t}),i&&(0,A.jsx)(`span`,{className:`flex-none rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold text-sky-100 ring-1 ring-white/10`,children:i})]}),n&&(0,A.jsx)(`p`,{className:`mt-1.5 max-w-[300px] text-[11px] leading-5 text-slate-300`,children:n})]}),a&&(0,A.jsx)(`div`,{className:`flex flex-none items-center gap-1.5 pt-0.5`,children:a})]}),o&&(0,A.jsx)(`div`,{className:`relative mt-3 border-t border-white/10 pt-3`,children:o})]})}export{x as a,D as c,E as d,S as i,T as l,M as n,b as o,j as r,O as s,N as t,w as u};