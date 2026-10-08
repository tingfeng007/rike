> 历史记录：本文描述检查时的版本。当前能力与已修复项请见 [2026-10-08 实施记录](IMPLEMENTATION_2026-10-08.md)。

# LingoFlow 项目优化诊断报告

> **文档性质**：只读诊断分析报告（不含任何业务代码改动）
> **诊断对象**：`D:\d\lingoflow`（React 19 + Vite 8 PWA，中文界面，移动端自用英语学习应用）
> **代码基线**：`main` 分支，`git rev-parse --short HEAD` = `33bbc45`，最后提交时间 `2026-09-24 15:33:37 +0800`，工作区干净（`git status --short` 无输出）
> **生成时间**：2026-09-30 10:08 (+08:00)
> **运行环境**：Node v24.15.0 / npm 11.12.1 / vite 8.2.2 / oxlint 1.82.0 / react 19.2.8
> **文档路径**：`docs/OPTIMIZATION_DIAGNOSIS_REPORT.md`

---

## 一、结论摘要

### 1.1 一句话结论

LingoFlow 的功能完成度和产品设计（本地优先、每日闭环、学习闭环）明显高于其工程质量水位：**当前最需要优化的不是"再加一个功能"，而是数据安全底线（4 处静默数据丢失/篡改路径：D-01、D-03、D-05、D-07）、AI 调用的健壮性（无超时/无取消）、以及 PWA 离线缓存的自我破坏行为**。这三类问题都会在真实使用中造成"用户数据没了、界面卡死、离线打不开"的实质损失，且都已在本报告中被复现或定位到具体行号。

### 1.2 优先修复清单（按影响 × 可复现性排序）

按严重度排序（编号为全文统一编号，正文第四~八章的条目按 D-01 → D-39 顺序排列，共 39 项）：

| # | 问题 | 严重度 | 定位 | 状态 |
| :-- | :--- | :--- | :--- | :--- |
| D-01 | `getVocabulary()` 读取即写入：卡组 ≤3 个词且含 `sample_1` 时，被 30 个演示词整体覆盖，用户自建词丢失 | 🔴 高 | `src/services/storage.js:169-172` | **已复现** |
| D-03 | 导入备份非原子且无回滚：返回"导入失败"但设置已被部分写入，且本地 `speechApiKey` 被清空 | 🔴 高 | `src/services/storage.js:843-851` | **已复现** |
| D-05 | 写入失败（配额/隐私模式）被静默吞掉：SRS 返回"已推进"的卡片，实际未落盘 | 🔴 高 | `src/services/storage.js:20-27` + 17 处调用点 | **已复现** |
| D-06 | 损坏的 localStorage 值（`"null"`）使读取返回 `null`，在 `useState` 初始化器中抛错 → **整页白屏**（ErrorBoundary 在 App 内部，拦不住） | 🔴 高 | `src/services/storage.js:138,167` + `src/App.jsx:32,39,42,114` | **已复现** |
| D-07 | 备份合并方向错误：导入旧备份会把已掌握单词的 `intervalDays/easeFactor/nextReviewDate` 回退为立即到期 | 🔴 高 | `src/services/storage.js:870-880` | 已复现（子审计） |
| D-02 | Service Worker 激活时删除**所有**非自身缓存，含用户手动下载的课程音频与云端 TTS 缓存 | 🔴 高 | `public/sw-v10.js:12-18` + `src/services/offline.js:1` + `src/services/speech.js:9` | 代码确证 |
| D-04 | 全部 AI 请求无超时、无 `AbortController`、流式不可取消；`[DONE]` 无法结束读取循环 | 🔴 高 | `src/services/ai.js:86-93`、`:116-132`、`:217-224` | 代码确证 |
| D-28 | **108 处 CSS 类名不产生任何样式**：`shadow-xs`(44)、`shadow-2xs`(14)、`animate-in`(12)、`text-slate-850`(11)、`animate-fade-in`(8)、`no-scrollbar`(8)、`w-4.5`/`h-4.5`(各 5)、`pb-safe`(1) —— 设计好的阴影层级与淡入动画实际全部未渲染 | 🔴 高 | `tailwind.config.js:7-35` | **已实测（构建产物验证）** |
| D-29 | 中文输入法按 Enter 确认候选词会误触发提交/判题（2 处缺 `isComposing` 判断） | 🔴 高 | `NewConcept.jsx:897`、`NceReview.jsx:88` | 代码确证 |
| D-13 | 无请求去重与并发保护：点 A 词未返回时点 B 词，A 的结果会渲染到 B 词下 | 🟠 中高 | `src/components/SmartReader.jsx:509-539` | 代码确证 |
| D-08 | 导入数据校验为零：`{}`、`[]`、其他应用的 JSON 都会被当作备份接受并合并 | 🟠 中高 | `src/services/storage.js:835-841` | 已复现（子审计） |
| D-30 | 15 个弹层全部没有 `role="dialog"` / `aria-modal` / 焦点管理；31 个纯图标按钮无可访问名称 | 🟠 中高 | `src/components/*` | **已实测** |
| D-22 | 77 条可访问性告警全部不可见：`.oxlintrc.json` 未启用 `jsx-a11y` 插件 | 🟠 中高 | `.oxlintrc.json:3` | **已实测** |
| D-21 | 11 条列表 key 错误全部不可见：`react/no-array-index-key` 未启用 | 🟠 中 | `src/components/*`（11 处） | **已实测** |
| D-16 | 6 个 Service Worker 文件为死代码（仅 `sw-v10.js` 被注册），版本靠"改文件名"维护 | 🟠 中 | `index.html:21` vs `public/sw*.js` | **已实测** |
| D-17 | 离线能力被自己的缓存策略削弱：无预缓存、全量 network-first、缓存无淘汰 | 🟠 中 | `public/sw-v10.js:8-10,24-32` | 代码确证 |
| D-12 | 错误文案直出上游英文：7 处把 `err.message` 直接展示给中文用户 | 🟠 中 | `src/services/ai.js:104,235` + 7 处调用点 | **已实测** |
| D-23 | 单文件巨型组件：`SmartReader.jsx` 1,583 行 / 32 个 `useState`，`NewConcept.jsx` 31 个 `useState` / 6 个 `useEffect` | 🟠 中 | `src/components/*` | **已实测** |
| D-25 | 20 处 `alert()` + 4 处 `confirm()` 作为主要反馈手段 | 🟠 中 | 4 个组件 | **已实测** |
| D-31 | `src/App.css`（184 行）是 Vite 模板残留的死文件，且是全项目唯一写 `:focus-visible` 的地方 | 🟠 中 | `src/App.css` | **已实测** |
| D-36 | README 完全未覆盖"新概念英语"模块（占应用约三分之一的代码量） | 🟠 中 | `README.md` | **已实测** |
| D-37 | 审计文档描述的 `sw.js` 行为与文件实际内容不符，会误导后续施工 | 🟠 中 | `docs/PRODUCT_FUNCTION_AUDIT.md:71-72`、`docs/PRODUCT_ROADMAP.md:46,87` | **已实测** |
| — | 零测试基础设施：`test/` 仅 355 行且只覆盖 services，6,638 行组件代码无法被测试 | 🟠 中 | `test/`、`package.json:10` | **已实测**（见 3.2 节） |

> 严重度口径：🔴 高 = 可导致用户数据丢失/应用不可用且已定位到具体行；🟠 中高/中 = 显著影响正确性、质量或可维护性，且有客观度量支撑；🟡 低 = 整洁度/一致性问题。
> 未列入本表的其余 17 项（D-09 ~ D-11、D-14、D-15、D-18 ~ D-20、D-24、D-26、D-27、D-32 ~ D-35、D-38、D-39）详见正文对应章节。

### 1.3 项目健康度评分（基于本次实测）

| 维度 | 评分 | 依据 |
| :--- | :--- | :--- |
| 产品功能完整度 | ★★★★☆ | 口语/精读/生词 SRS/新概念课程/每日计划五大模块闭环完整；`P0_P1_IMPROVEMENT_PLAN.md` 全部 7 项任务均已落地 |
| 构建与静态检查 | ★★★★☆ | `vite build` 8.44s 成功；`npm test` 24/24 通过；`npm run lint` 0 问题 |
| 静态检查**覆盖度** | ★★☆☆☆ | 0 问题的代价是 `jsx-a11y` 未启用（实际 77 条告警）、`no-array-index-key` 未启用（实际 11 条错误） |
| 数据层安全性 | ★★☆☆☆ | 3 条静默数据丢失/篡改路径、无迁移链、无配额处理、无跨标签页协调 |
| 网络层健壮性 | ★★☆☆☆ | 无超时、无取消、无重试、无并发保护；错误文案直出上游英文 |
| PWA/离线 | ★★☆☆☆ | 无预缓存、缓存策略未分层、SW 删除无关缓存、图标规格不全 |
| 前端架构 | ★★☆☆☆ | 组件巨型化、154 个 `useState`、关键派生计算未 memo、渲染期同步 IO、复制粘贴式重复 |
| 样式/视觉实现完整度 | ★★☆☆☆ | **108 处类名不产出 CSS**：阴影层级与淡入动画静默失效（D-28） |
| 移动端/无障碍 | ★★☆☆☆ | 0 处 `role="dialog"`、31 个图标按钮无可访问名称、IME Enter 误触发；安全区与 `dvh` 部分写法正确 |
| 工程化/文档 | ★★☆☆☆ | 无 CI、无类型检查、无格式化配置、文档与代码漂移 |

---

## 二、评估方法与边界（可复现性声明）

### 2.1 本次实际执行的命令（均为只读或输出到项目外）

| 命令 | 目的 | 结果 |
| :--- | :--- | :--- |
| `npm test` | 运行单元测试 | **24 passed / 0 failed**，总耗时 94.2ms |
| `npx oxlint` | 运行项目配置的静态检查 | **0 warnings / 0 errors**（38 文件 / 104 规则） |
| `npx oxlint -D react/no-array-index-key src` | 启用列表 key 规则探测 | **11 errors**（详见 D-21） |
| `npx oxlint --jsx-a11y-plugin src` | 启用可访问性插件探测 | **77 warnings**（详见 D-20） |
| `npx oxlint --jsx-a11y-plugin --format=json src` | 按规则聚合告警 | 5 类规则，明细见 5.3 节 |
| `npx vite build --outDir $env:TEMP\lingoflow-build-probe --emptyOutDir` | 验证生产构建并测量真实产物 | **成功，8.44s**，产物写入系统临时目录，**未触碰项目 `dist/`** |
| `git log/status/ls-files/check-ignore/ls-tree` | 版本与产物追踪状态核查 | 工作区干净；`dist/` 已被 `.gitignore:11` 忽略 |
| `node %TEMP%\lf-probe\probe.mjs` | **独立复现**数据层缺陷（mock `localStorage`） | 7 组缺陷全部复现，见第九节 |

### 2.2 关键假设（信息不足时的合理推定）

1. **单人自用定位**：依据 `README.md:3` 与 `docs/PRODUCT_ROADMAP.md`，本项目为个人自用、单设备、无后端、无多用户并发。因此"跨标签页写冲突"与"无鉴权"类问题按**中**而非高评估；但数据丢失类问题不因单人使用而降低严重度。
2. **`dist/` 为构建产物**：已由 `git check-ignore -v dist` → `.gitignore:11:dist` 与 `git ls-files dist`（空）证实，不视为业务代码。
3. **`node_modules/` 为第三方依赖**，不在诊断范围内。
4. **平台行为标注规则**：涉及 iOS Safari / Android Chrome 具体渲染或安装行为（如 SVG 图标是否被接受）的结论，本机无法运行浏览器验证，一律标注"**依据平台文档，未经本机浏览器验证**"，不计入"已复现"。

### 2.3 本次**未**做的事（避免读者误读）

- 未修改任何业务代码、配置或文档（本报告为新增文件）。
- 未启动开发服务器、未做浏览器端 E2E 验证，因此所有 UI 交互结论均来自代码静态确证，而非运行观测。
- 未做真实 AI 接口调用（无 API Key，也避免产生费用）。
- 未做性能实测（无 Lighthouse/真机数据），"性能"类结论均为代码结构层面的推断，已明确标注。

---

## 三、项目现状基线（实测）

### 3.1 代码规模

> 计数口径：`(Get-Content <file>).Count`（含空行的真实行数）。全报告引用的 `文件:行号` 均与行号定位工具一致。

| 范围 | 行数 | 说明 |
| :--- | ---: | :--- |
| `src/` 合计 | **10,064** | 24 个 `.js/.jsx` 文件 |
| `src/services/` | 3,360 | 8 个服务模块 |
| `src/components/` | 6,418 | 11 个组件 |
| `src/App.jsx` | 220 | 应用外壳 + 底部导航 |
| `src/index.css` | 190 | 全局样式与设计令牌 |
| `src/App.css` | 184 | **死文件**（见 D-31） |
| `test/` | **355** | 4 个测试文件（仅覆盖 services） |

最大的 6 个源文件：

| 行数 | 文件 |
| ---: | :--- |
| 1,624 | `src/services/storage.js` |
| 1,583 | `src/components/SmartReader.jsx` |
| 1,452 | `src/components/VocabularySRS.jsx` |
| 934 | `src/components/OralCoach.jsx` |
| 910 | `src/components/NewConcept.jsx` |
| 856 | `src/components/Settings.jsx` |

### 3.2 测试与静态检查现状

- **测试**：`node --test`，24 个用例全部通过，覆盖 `nce.js`、`nceExam.js`、`nceReview.js`、`storage.js`（5 例）、`studyPlan.js`、`studyView.js`。
- **测试基础设施缺口**：`node_modules/` 中**不存在** `vitest` / `jest` / `jsdom` / `happy-dom` / `@testing-library/*` / `playwright` / `cypress`（实测列举为空）。即当前配置**无法编写任何组件或 E2E 测试**，这是 6,638 行组件代码（`components/` 6,418 + `App.jsx` 220）零测试的根因，而非"懒得写"。
- **`test/storage.test.js:6-16`** 用手写 `createMemoryStorage()` 替代 jsdom，是一个务实做法；但其 `setItem` 永不抛错，因此**所有配额/写入失败路径天然无法被测**。

### 3.3 构建产物（本次在临时目录实测）

```
✓ 1869 modules transformed.
✓ built in 8.44s
index.html                          1.45 kB │ gzip:  0.75 kB
assets/index-ljqvaTzi.css          56.41 kB │ gzip: 10.31 kB
assets/NewConcept-TrDDPvCx.js      74.93 kB │ gzip: 19.85 kB
assets/SmartReader-BdQpLkf3.js     43.79 kB │ gzip: 12.87 kB
assets/VocabularySRS-B4XTwtL5.js   41.80 kB │ gzip: 11.27 kB
assets/Settings-D8tZiff-.js        32.43 kB │ gzip:  9.58 kB
assets/OralCoach-CsKbuMsj.js       29.20 kB │ gzip: 10.83 kB
assets/index-BbVwPC1P.js          269.30 kB │ gzip: 88.81 kB   ← 唯一的 >200KB 分块
```

- 入口分块 **269.30 kB / 88.81 kB gzip**，占首屏下载绝对主体（`vite.config.js` 全文仅 12 行，无 `manualChunks`，代码分割完全依赖 `App.jsx:13-17` 的 `React.lazy`）。
- 构建耗时 8.44s，其中 `vite:build-html` 插件钩子占 7.6s（91%），属 rolldown/vite 8 的正常表现，非项目问题。

### 3.4 技术栈与工程配置

| 项 | 现状 |
| :--- | :--- |
| UI | React 19.2.8 + TailwindCSS 3.4.17 + lucide-react 1.42.0 |
| 构建 | Vite 8.2.2（rolldown）+ `@vitejs/plugin-react` 6.1.1 |
| 静态检查 | oxlint 1.82.0，`.oxlintrc.json` **仅显式配置 2 条规则** |
| 类型系统 | **无**（无 `tsconfig.json`，10,064 行纯 JS/JSX） |
| 格式化 | **无**（无 `.prettierrc` / `.editorconfig`） |
| CI | **无**（无 `.github` 目录，`Test-Path .github` → `False`） |
| Git hooks | **无**（无 `.husky`） |
| PWA | 手写 Service Worker，无 `vite-plugin-pwa` / Workbox |
| 后端 | 无（浏览器直连 OpenAI 兼容接口） |

---

## 四、🔴 高优先级：数据安全与正确性

> 本节 D-01 ~ D-07 全部位于 `src/services/storage.js`（1,624 行、45 个方法的单一数据访问模块）。核心结构性问题是：**该模块把"取数据"和"改数据"混在一起，且所有错误都退化为静默默认值。**

### D-01 🔴 读取路径静默销毁用户词库（已复现）

**位置**：`src/services/storage.js:169-172`

```js
// Auto upgrade if user only had the 3 legacy sample words
if (Array.isArray(parsed) && parsed.length <= 3 && parsed.some((w) => w.id === 'sample_1')) {
  this.saveVocabulary(DEFAULT_SAMPLE_WORDS);
  return DEFAULT_SAMPLE_WORDS;
}
```

**问题**：该"自动升级"启发式判断的条件是"词条数 ≤ 3 **且** 含 `sample_1`"。用户只要删到剩 3 个词（其中保留 `sample_1`），**下一次任何页面调用 `getVocabulary()` 都会把整个词库覆盖为 30 个演示词并立即落盘**，用户自己收集的词无确认、无提示、无备份地消失。

触发路径很"日常"：`VocabularySRS.jsx:215` 提供逐词删除（`confirm('确认将此单词从生词本中删除？')`），用户清理演示词时极易命中。且因为它在 **getter** 里，可以在渲染、轮询（`App.jsx:87` 每 30 秒）、或任何只读调用中被触发。

**实测复现结果**：

```
1. stored 2 words incl. sample_1 -> getVocabulary() returns count: 30
1. did user word "myownword" survive?: false
1. persisted localStorage count now: 30
```

**优化方向**：把数据迁移从读取路径剥离为显式、一次性、带版本门控的迁移；getter 永不写盘；确需替换时先备份原值并提供确认。

---

### D-02 🔴 Service Worker 删除用户的离线音频与语音缓存

**位置**：`public/sw-v10.js:12-18`

```js
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => key === CACHE_NAME ? undefined : caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});
```

**问题**：`key === CACHE_NAME ? undefined : caches.delete(key)` 会删除**除自身以外的全部 Cache Storage**。而项目另外定义了至少两个缓存：

- `src/services/offline.js:1` — `const NCE_AUDIO_CACHE = 'lingoflow-nce-audio-v1';`（用户主动点击"缓存本课音频"下载的课程音频）
- `src/services/speech.js:9` — `const CLOUD_CACHE_NAME = 'lingoflow-tts-v1';`（云端 TTS 音频缓存）

因此**每次 Service Worker 版本变更（文件名从 `sw-v5` 到 `sw-v10` 的历次升级、以及从旧注册迁移）都会静默清空用户已经等待下载完成的课程音频**。`Settings.jsx:148` 还提供了"清除课程缓存"入口并把计数展示给用户，说明这是用户明确感知并珍视的功能。

**优化方向**：SW 只清理自己命名空间下的旧版本（如 `key.startsWith('lingoflow-offline-')`），或由 SW 统一托管这些缓存并在白名单中保留业务缓存。

> 附带确认：`public/sw.js:15-18` 有完全相同的删除逻辑，只是该文件已不被注册（见 D-09）。

---

### D-03 🔴 导入备份非原子、无回滚，且清空本地语音 Key（已复现）

**位置**：`src/services/storage.js:835-851`

```js
importAllData(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!data || typeof data !== 'object') { throw ... }
    // 1. Settings Merge: keep existing API Key if imported is empty
    if (data.settings) {
      const currentSettings = this.getSettings();
      const mergedSettings = {
        ...currentSettings,
        ...data.settings,
        apiKey: data.settings.apiKey?.trim() || currentSettings.apiKey || '',
      };
      this.saveSettings(mergedSettings);   // ← 先落盘
    }
    // …后续词汇合并可能抛错，但设置已经写进去了
```

**问题**：
1. **先写设置、后校验词汇**。词汇合并（`:867` `imp.word.toLowerCase()`）遇到非字符串 `word` 会抛 `TypeError`，被 `:1044` 的宽 `catch` 捕获并返回 `{success:false}`，但**设置已经落盘**，调用方只看到"导入失败"弹窗（`Settings.jsx:192`）且不刷新页面 → 用户以为"什么都没变"，实际配置已被改。
2. **只保护了 `apiKey`，没有保护 `speechApiKey`**。安全模式导出的备份中 `speechApiKey` 为空串（`:754-757`），展开后即覆盖本地值 → 用户恢复备份后神经 TTS 静默失效。
3. **`:1034` 结尾还会调用 `ensureSchema()`**，把版本号盖章为最新。

**实测复现结果**：

```
2. import result: {"success":false,"error":"imp.word.toLowerCase is not a function"}
2. provider after failed import: openai          ← 原为 deepseek，被改
2. apiKey after failed import: LOCAL_KEY         ← 被保护，正确
2. speechApiKey after failed import: (空)         ← 被清空
```

**优化方向**：先在全内存暂存对象上完成解析、校验与合并，全部成功后再单次提交；密钥字段统一走"导入值非空才覆盖"的白名单规则。

---

### D-04 🔴 所有 AI 请求无超时、无取消；流式读取无法正确结束

**位置一：无超时/无 `signal`** — `src/services/ai.js:86-93` 与 `:217-224`

```js
const res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(bodyPayload),
});   // 没有 signal，函数签名（:58-63、:190-194）也不接受 signal
```

全仓 `AbortController` 仅出现在**课程静态资源**拉取处（`NewConcept.jsx:126`、`:288`，`NceExam.jsx:90`）——**最慢、最容易挂起的 AI 请求反而没有任何超时保护**。手机网络"连上但打不通"（尤其中转/代理/弱网）时，口语对练、查词、翻译、生成测验都会永久停在加载态。

**位置二：`[DONE]` 不能结束读取循环** — `src/services/ai.js:124-132`

```js
for (const line of lines) {
  const trimmed = line.trim();
  ...
  if (trimmed.startsWith('data: ')) {
    const dataStr = trimmed.slice(6).trim();
    if (dataStr === '[DONE]') {
      break;            // ← 只跳出内层 for，外层 while(true) 继续阻塞在 reader.read()
    }
```

`break` 只退出内层 `for`，外层 `while (true) { const { done, value } = await reader.read(); … }`（`:116-118`）会继续等待直到连接被服务端关闭。若服务端在 `[DONE]` 后保持连接（keep-alive / 反代常见），**该 Promise 永不 resolve**，打字机状态无限持续。叠加"无超时"，这是可稳定触发的挂死路径。

**位置三：流中断会丢弃已收到的全部文本** — `:116-148` 的读取循环无 `try/catch`、无 `reader.cancel()`；`OralCoach.jsx:269-271` 在 reject 时直接把气泡替换为错误消息，用户已经读到的内容一并消失。

**优化方向**：抽出统一的 `postChatCompletion({ signal, timeoutMs, maxTokens })`，两处调用共用；`[DONE]` 用标签跳转或 `reader.cancel()` 终止外层循环；`finally` 中释放 reader；中断时保留部分文本并标记"未完成"。

---

### D-05 🔴 写入失败被静默吞掉，SRS 会"假装"推进（已复现）

**位置**：`src/services/storage.js:20-27`

```js
function safeSetItem(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { return false; }        // 配额满、隐私模式、存储被禁 —— 全部合并成一个 false
}
```

17 个调用点（`:115,116,119,145,159,180,358,395,409,539,564,609,633,685,697,713,1025`）中**没有一个检查返回值**。`updateWordSRS`（`:239-307`）在 `:305` 调用 `this.saveVocabulary(words)` 后直接 `return updated`，与落盘结果无关。

**实测复现结果（令 `setItem` 抛 `QuotaExceededError`）**：

```
3. updateWordSRS returned (claimed) card: {"step":1,"intervalDays":1,"easeFactor":2.6}
3. what is actually persisted:            {"id":"w1","word":"alpha","step":0,"intervalDays":1,"easeFactor":2.5,"tags":[]}
```

界面上卡片被判定"复习成功"并推进了记忆曲线，实际数据一步没动；用户下次复习时看到的仍是旧状态。`Settings.jsx:75` 同样会在 `saveSettings` 返回 `false` 的情况下弹出"已保存"。

**优化方向**：保留失败原因（区分 `QuotaExceededError` 与存储被禁），向调用方传播 `{ok, error}`，在 UI 上给出"本地存储已满/不可用"的持久提示与导出引导。

---

### D-06 🔴 单个 localStorage 键损坏 → 整页白屏，且无兜底

**位置**：`src/services/storage.js:136-141`、`:163-177`；受害点 `src/App.jsx:32,39,42,114`；`src/main.jsx:6-9`

`getAppState()` / `getVocabulary()` 等读取函数只包了 `JSON.parse`，不校验解析结果的形状。当存的是字符串 `"null"` 时 `JSON.parse` 返回 `null`，函数把这个 `null` 原样返回（`if (!data) return DEFAULT_SAMPLE_WORDS` 只拦住"键不存在"，拦不住 `"null"`）。

而 `App.jsx` 在 **`useState` 初始化器**里就使用它们：

```js
const [activeTab, setActiveTab] = useState(() => {
  const saved = StorageService.getAppState().activeTab;   // :39  null.activeTab → TypeError
  ...
});
const [dueVocabCount, setDueVocabCount] = useState(() => countDueWords());  // :42 → :32 getVocabulary().filter(...)
```

关键在于 **`ErrorBoundary` 挂在 `App` 内部**（`App.jsx:114`），`main.jsx:6-9` 没有任何边界包裹 `<App />`。因此初始化器抛出的异常发生在边界**之外**，用户看到的是**全白页面**，连"重新加载"卡片都不会出现。

**实测复现结果**：

```
4. getVocabulary() with stored "null": null
4. getAppState() with stored "null": null
4. .filter() on the result THREW: TypeError: Cannot read properties of null (reading 'filter')
```

**优化方向**：写一个 `normalizeXxx()` 在每次读取出口做形状归一（`Array.isArray` / 对象判定 / 回退默认值），并在 `main.jsx` 根部再包一层 ErrorBoundary。同类隐患还包括 `getArticles`（`:551`）、`getNceCache`（`:690`）、`getLocalDataSummary`（`:722`）、`getStorageDiagnostics`（`:456`，`cache.lessons` 为 null 时抛错，会整页替换设置页）。

---

### D-07 🔴 备份合并会把已掌握单词"打回原形"

**位置**：`src/services/storage.js:870-880`

```js
const merged = {
  ...existing,
  ...imp,                                                    // ← 备份值全量覆盖
  userNote: imp.userNote || existing.userNote || '',
  reviewCount: Math.max(existing.reviewCount || 0, imp.reviewCount || 0),
  step: Math.max(existing.step || 0, imp.step || 0),
  status: existing.status === 'mastered' || imp.status === 'mastered' ? 'mastered' : imp.status,
};
```

只有 `reviewCount` / `step` / `status` 三个字段做了"取优"，**`intervalDays`、`easeFactor`、`nextReviewDate` 以及 `id` 一律由备份覆盖**。子审计复现结果：本地 `{step:6, intervalDays:30, easeFactor:2.8, status:'mastered', nextReviewDate:999999999}` 与一份旧备份合并后得到 `{id:'imp1', step:6, status:'mastered', intervalDays:1, easeFactor:2.5, nextReviewDate:111}` —— **一个"已掌握"的词立刻变成每天到期**，且 `id` 被替换。用户从旧手机恢复备份时，最宝贵的复习进度恰好被破坏。

**优化方向**：把 `max`/新近性规则同样应用到调度三字段（或整体以本地为准、只补空字段），本地存在时保留本地 `id`。

---

### D-08（补充）🔴 导入数据校验为零，任何 JSON 都会被吃进去

**位置**：`src/services/storage.js:835-841`（唯一校验）、`:899/903`（文章按标题去重）、`:951`（聊天按 `length <= 1` 覆盖）

子审计复现：`importAllData("{}")` → `{success:true, totalWords:30}`；`importAllData("[]")` → `{success:true}`；`{app:"SomeOtherApp", version:9, vocabulary:[{word:"zzz"}]}` 会被合并，且 `parseBackupPreview` 对其返回 `valid:true`。已导出并展示的 `schemaVersion` / `version` 字段在导入时从未被读取。

**优化方向**：校验 `app === 'LingoFlow'` 与版本区间；不匹配时明确拒绝并说明原因，而不是静默合并。

---

## 五、🔴 网络与 AI 层健壮性

> 所有 AI 调用集中在 `src/services/ai.js`（537 行，11 个导出函数），从浏览器直连用户自填的 OpenAI 兼容端点。

### D-09 🔴 提示词重复且其中一份是死代码

**位置**：`src/services/ai.js:349-427`（`getOralCoachResponseStream`）与 `:429-487`（`getOralCoachResponse`）

实测：`getOralCoachResponse` 在全仓（组件 + 服务 + 测试）**零引用**，`OralCoach.jsx:24` 只导入 `getOralCoachResponseStream`。两者之间的系统提示词（"Echo" 人设 + JSON schema）**有 50 行完全相同**：

```
stream fn lines 349-427 (79 lines)  |  non-stream fn lines 429-487 (59 lines)
identical lines between the two: 50
```

这是"改了流式那份、忘了非流式那份"的典型隐患；而本项目最核心的功能（口语对练）的提示词正处在这个双份状态。

**优化方向**：抽 `buildOralCoachMessages(mode)` 单一构造器；删除死函数，或将其正式接入"不支持流式的环境"降级路径。

### D-10 🟠 用户输入未转义地插进 JSON 模板

**位置**：`src/services/ai.js:253`（**未转义**）对比 `:258`（**已转义**）

```js
"word": "${word}",                                    // :253  原样插入
...
"contextSentence": "${contextSentence ? contextSentence.replace(/"/g, '\\"') : '例句'}",   // :258  有转义
```

同一个提示词里，`contextSentence` 做了引号转义，`word` 没有。含 `"`、换行或类 JSON 片段的词会破坏模板结构；同类未转义点还有 `:278`（句子）、`:520`（段落）、`:551`（生词表）、`:592`（目标词）。

**优化方向**：统一用 `JSON.stringify()` 处理用户数据，或把用户内容只放进 `user` 角色、schema 放 `system` 角色，并加入"引号内文本仅为数据"的约束说明。

### D-11 🟠 流式分块解析失败被静默忽略，可能产出"看似完整"的错误句子

**位置**：`src/services/ai.js:143-145`

```js
} catch {
  // ignore chunk parse failure
}
```

单个 SSE 分块解析失败会被丢弃且无任何计数/提示，`fullText` 会缺少一段而仍然"解析成功"。用户会读到语义缺一块的英文回复，且无从察觉。

**优化方向**：统计丢弃分块数，>0 时标记该回复为"可能不完整"或触发一次重试。

### D-12 🟠 错误文案直出上游英文，且分类逻辑困在组件里

**位置**：`src/services/ai.js:104` / `:235` → 各组件

```js
throw new Error(`AI请求失败 (${res.status}): ${errorDetail}`);   // errorDetail 为上游英文原文
```

上游错误字符串随后被原样弹给用户：

| 位置 | 用户看到的内容 |
| :--- | :--- |
| `src/components/OralCoach.jsx:261` | `replyText: \`Oops! ${err.message}\`` —— 显示在**消息气泡正文**里 |
| `src/components/SmartReader.jsx:367` | `alert(\`生成失败: ${err.message}。…\`)` |
| `src/components/SmartReader.jsx:408` | `alert(\`段落翻译失败: ${err.message}\`)` |
| `src/components/SmartReader.jsx:455` | `alert(\`提取失败: ${err.message}。…\`)` |
| `src/components/VocabularySRS.jsx:253` | `alert(\`微剧场生成失败: ${err.message}\`)` |
| `src/components/VocabularySRS.jsx:304` | `alert(\`生成测验失败: ${err.message}\`)` |
| `src/components/Settings.jsx:128` | `message: \`测试失败: ${err.message}\`` |

一个全中文界面的学习应用，最显眼的报错文本是 `Failed to fetch` 或上游 JSON。`OralCoach.jsx:29-53` 已经写了一个很好的 `diagnoseErrorMessage()` 中文诊断器，但它**只存在于这一个组件里**，无法复用；且它只设置了标题与提示，正文仍是原始英文。

**同时**：`OralCoach.jsx:43-47` 的分支把所有网络类错误统一映射为"网络连接出现微弱波动"，因此**离线时也只会说"Wi-Fi 波动"**，不会告诉用户"当前离线，AI 需要联网"。

**优化方向**：在 `ai.js` 中定义带 `code/status/zhTitle/zhTip` 的结构化错误类型，把 `diagnoseErrorMessage` 上移为共享模块，调用方只渲染中文标题与建议，原始文本折叠进"技术详情"。

### D-13 🟠 无请求去重、无并发保护 → 查词结果可能贴错单词

**位置**：`src/components/SmartReader.jsx:509-539` 与 `:585-609`

```js
const analysis = await analyzeWordWithAI(clean, sentence);
setWordAnalysis(analysis);      // 没有校验 selectedWord.word 是否仍是 clean
```

用户在 A 词请求未返回时点 B 词，A 的响应回来后会把分析结果渲染到 B 词的弹窗标题下，同时 `setIsAnalyzingWord(false)` 还会关掉 B 的加载态。这是本应用**招牌功能（点词即查）上的正确性缺陷**。

同类问题：`OralCoach.jsx:116-124` 切换情景时不中断进行中的流，`OralCoach.jsx:245-247` 之后用旧闭包 `setMessages(finalMessages)` 并 `saveChatMessages(currentScenario.id, …)`，会把上一情景的对话写进当前情景。

**优化方向**：为每次请求生成 token/请求序号，响应回来时校验 token 与当前选中项一致才应用；切换场景/卸载时中断在途请求。

### D-14 🟠 外部依赖：课程内容与文章抓取都押在第三方域名上

| 位置 | 硬编码外部依赖 | 说明 |
| :--- | :--- | :--- |
| `src/components/NewConcept.jsx:33` | `const NCE1_BASE = 'https://nce.mleo.site/NCE1';` | 全部课程目录 `book.json`、课文 `lrc`、音频 `mp3` 的唯一来源 |
| `src/components/SmartReader.jsx:428` | `fetch(\`https://r.jina.ai/${encodeURIComponent(url)}\`)` | "粘贴网址提取文章"功能把用户输入的完整 URL 发给第三方 |

**问题**：
1. **单点依赖且非项目自有基础设施**（非 jsDelivr/CDN 等公共设施，而是一个看起来属于个人的域名）。该域名若变更或不可用，新概念整个模块失效；本地离线缓存只在"曾经联网成功加载过"之后才有内容（`NewConcept.jsx:119-124`）。
2. **隐私未告知**：用户以为只是"提取网页正文"，实际把目标 URL 交给了 `r.jina.ai`。应用在别处（`README.md:27`）明确承诺"Key 与历史记录保存在浏览器本地；对话内容会直接发送给你选择的 AI 服务商处理"，但没提这个第三方代理。

**优化方向**：为课程资源准备备用源或把课程静态资源纳入本仓库/自有 CDN 并加版本清单；对 `r.jina.ai` 在 UI 上明示，或改为"让用户直接粘贴正文"为主路径。

### D-15 🟡 无重试、无 `finish_reason` 处理、无 `max_tokens`

`ai.js:75-84` / `:206-215` 的请求体只有 `model/messages/temperature[/response_format/stream]`；无 `max_tokens`，也从不读取 `finish_reason`。因此**输出被长度截断**与**模型返回格式错误**在代码里无法区分，统一表现为 `:51` 的 `未能从AI回复中解析出有效的JSON数据`。无自动重试，429/502 只能靠用户手动点"重试"（`OralCoach.jsx:278-283`、`SmartReader.jsx:543-561`）。

---

## 六、🔴 PWA / 离线 / 部署

### D-16 🔴 7 个 Service Worker 文件中只有 1 个生效，版本靠"复制文件改名"维护

**实测**：

- 全仓（排除 `node_modules`/`dist`）对 `sw-v*.js` / `sw.js` 的引用**只有一处**：`index.html:21` → `navigator.serviceWorker.register('./sw-v10.js')`。
- 即 `public/sw.js`（68 行，注释最完整）与 `sw-v5.js`~`sw-v9.js` **全部为死文件**，但仍被复制进 `dist/` 并发布（合计 9,302 字节）。
- 版本间差异极小，`Compare-Object` 实测：`sw-v5→v6` 4 行、`sw-v7→v8` 4 行、`sw-v8→v9` 4 行、`sw-v9→v10` 4 行 —— **仅 `CACHE_NAME` 字符串和注释行不同**。
- 命名空间冲突：`public/sw.js:6` 与 `public/sw-v5.js:6` 使用了**同一个** `CACHE_NAME = 'lingoflow-offline-v5'`。

后果：每次发布都要"复制上一版 → 改名为 v11 → 改里面的字符串 → 改 index.html 的注册路径"，任何一步漏掉就会导致缓存不失效，而**死文件仍然公开可访问**。

### D-17 🟠 离线能力被自己的缓存策略削弱

| 问题 | 位置 | 说明 |
| :--- | :--- | :--- |
| **无预缓存** | `public/sw-v10.js:8-10` | `install` 里只有 `skipWaiting()`，全仓无 `cache.addAll` / precache 清单。缓存完全靠运行时"顺路"填充 |
| **全部走 network-first，包括内容哈希静态资源** | `public/sw-v10.js:24-32` | 连 `assets/index-<hash>.js` 也先走网络。这类文件内容寻址、永不变更，理应采用 cache-first / stale-while-revalidate，可显著改善弱网重复启动 |
| **缓存写在 `waitUntil` 之外** | `public/sw-v10.js:29` | `caches.open(...).then(cache => cache.put(...))` 未被 `event.waitUntil` 托管，SW 可能在写盘前被终止 |
| **缓存无上限、无淘汰** | `public/sw-v10.js` 全文 | 仅删除"其它缓存名"，同一缓存内旧哈希产物永不清理；多次发布后 Cache Storage 持续增长 |
| **激活时清空自身缓存** | `public/sw-v10.js:12-18` | 新旧 SW 交替瞬间，旧缓存被删而新缓存尚空（页面资源在 `load` 事件后才注册 SW，见 `index.html:20-21`），此时断网即命中 `:40-43` 的纯文本 503 页面 |
| **无"新版本可用"提示** | — | `skipWaiting()` + `clients.claim()` 让新 SW 静默接管，`src/` 中 **零处** `serviceWorker` 相关代码（实测 grep 无匹配）。而 `docs/PRODUCT_ROADMAP.md:87` 明确把"新版本上线后提示刷新"写成了验收标准 |
| **开发环境也注册 SW** | `index.html:19` | 只判断 `protocol.startsWith('http')`，因此在 README 推荐的 `http://192.168.x.x:5173` 手机调试场景下会注册并缓存 dev 响应，造成难排查的"改了没生效" |

### D-18 🟠 离线状态没有传导到任何 AI 入口

`App.jsx:45` 定义了 `isOffline` 并监听 `online/offline`（`:53-69`），但**只用于顶部横幅**（`:101-110`）；全仓 `onLine` 仅出现在 `App.jsx:45`。因此离线时所有 AI 按钮照常可点，用户点下去、请求失败、才得到"网络波动"文案。`docs/PRODUCT_ROADMAP.md:87` 的验收标准"③ AI 功能明确显示'联网后可用'，而不是无限加载"**未达成**。

### D-19 🟠 PWA 图标规格不全（依据平台文档，未经本机浏览器验证）

| 位置 | 现状 | 影响 |
| :--- | :--- | :--- |
| `public/manifest.json:12-19` | 仅 1 个 SVG 图标，`"sizes": "any"`，`"purpose": "any maskable"` | 仓库内**不存在任何 192×192 / 512×512 PNG**（`public/` 实测只有 `.svg/.js/.json`）。Android 安装横幅/启动图缺少标准位图回退；`any maskable` 共用一张带 `rx=128` 圆角的图（`public/icon.svg:2`），被 maskable 裁切时会"二次圆角" |
| `index.html:14` | `<link rel="apple-touch-icon" href="./icon.svg" />` | Apple 文档要求的 `apple-touch-icon` 为 PNG；仓库内无 PNG 可回退，iOS 添加到主屏幕的图标可能显示为页面截图/通用图标 |
| `index.html:5` | `maximum-scale=1.0, user-scalable=no` | 禁止双指缩放，对一个以长文本阅读为主的学习应用是可访问性倒退（`viewport-fit=cover` 部分是正确的，`App.jsx:131`、`StudyHeader.jsx:5` 都在用安全区） |
| `index.html`（全文 32 行） | 无 `<meta name="description">`、无 OG 标签、无 `<noscript>` | 分享到微信/IM 无摘要预览；JS 失败时页面全空 |

### D-20 🟠 部署链路手工且会累积孤儿产物

- `package.json:6-12` 只有 `dev/build/lint/test/preview`，**无 `deploy` 脚本**；无 `.github` 目录 —— 而 `gh-pages` 分支确实存在（`git branch -a`）。
- 子审计实测 `git ls-tree -r gh-pages` = 53 文件 / 1,188,998 字节，其中 **20 个文件（574,116 字节）不被当前 `gh-pages:index.html` 引用**（例如 `assets/index-CaOm9F5Z.js` 268,980 字节），即历史构建的孤儿哈希文件长期留在公开分支上。
- `gh-pages` 分支无 `.nojekyll`。
- **正面结论**：`dist/` 本身管理正确 —— `git ls-files dist` 为空，`.gitignore:11` 已忽略，不存在"把构建产物提交进主分支"的问题。

---

## 七、🟠 前端架构与可访问性

### D-21 🟠 11 条列表 key 错误因规则未启用而长期不可见（已实测）

`.oxlintrc.json` 全文只显式配置了 2 条规则：

```json
{ "plugins": ["react", "oxc"],
  "rules": { "react/rules-of-hooks": "error",
             "react/only-export-components": ["warn", { "allowConstantExport": true }] } }
```

实测 `npx oxlint -D react/no-array-index-key src` → **11 errors**，全部为真实存在、且 `npm run lint` 永远不会报出的问题：

| 文件 | 行号 |
| :--- | :--- |
| `src/components/NceDictation.jsx` | 109（同文件 2 处） |
| `src/components/OralCoach.jsx` | 675 |
| `src/components/VocabularySRS.jsx` | 951、1182 |
| `src/components/SmartReader.jsx` | 726、781、794、985、1127、1153 |

### D-22 🟠 77 条可访问性告警因 `jsx-a11y` 插件未启用而不可见（已实测）

`npx oxlint --jsx-a11y-plugin src` → **77 warnings**。按规则聚合：

| 数量 | 规则 |
| ---: | :--- |
| 26 | `jsx-a11y(label-has-associated-control)` —— 表单 label 与控件未关联 |
| 24 | `jsx-a11y(click-events-have-key-events)` —— 可点击元素无键盘事件 |
| 24 | `jsx-a11y(no-static-element-interactions)` —— 静态元素绑定交互 |
| 2 | `jsx-a11y(prefer-tag-over-role)` |
| 1 | `jsx-a11y(media-has-caption)` |

按文件聚合：`SmartReader.jsx` 34、`VocabularySRS.jsx` 20、`Settings.jsx` 11、`OralCoach.jsx` 9、`NceReview.jsx` 2、`NewConcept.jsx` 1。

**优化方向**：在 `.oxlintrc.json` 加入 `"jsx-a11y"` 插件并把上述两条规则设为 `warn`，让真实的 88 条问题（11 + 77）进入可见范围，再分批治理。

### D-23 🟠 组件巨型化：单文件承担过多职责（已实测 hook 数）

| 文件 | 行数 | `useState` | `useEffect` | `useMemo` | `useCallback` | `useRef` |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `SmartReader.jsx` | 1,583 | **32** | 3 | 1 | **0** | 2 |
| `VocabularySRS.jsx` | 1,452 | **29** | 1 | 0 | **0** | 0 |
| `NewConcept.jsx` | 910 | **31** | 6 | 7 | **0** | 9 |
| `OralCoach.jsx` | 934 | 18 | 1 | 0 | **0** | 1 |
| `Settings.jsx` | 856 | 15 | 2 | 0 | **0** | 0 |
| `App.jsx` | 220 | 6 | 3 | 0 | 0 | 0 |
| **合计** | — | **154** | — | — | — | — |

`NewConcept.jsx:66-101` 是 31 个 `useState` 连成一串；`SmartReader.jsx` 同时管理"文库 + 文章生成 + 点词查询 + 长难句分析 + 段落翻译 + 朗读 + 划线批注 + 网址抓取 + 阅读位置"。`useCallback` 在最大的 6 个组件里**全部为 0**，意味着每个渲染周期所有回调身份都变化，配合 154 个 state，重渲染成本难以收敛。

### D-24 🟠 渲染期做未记忆化的 O(n) 派生计算

以 `src/components/NewConcept.jsx:172-183` 为例，每次渲染都会：

```js
const completedCount  = units.filter(u => progress[u.filename]?.status === 'completed').length;      // :172
const learningCount   = units.filter(u => progress[u.filename] && … !== 'completed').length;         // :173
const exerciseCount   = units.filter(u => progress[u.filename]?.exercisesCompleted).length;          // :174
const dictationCount  = units.filter(u => progress[u.filename]?.dictationCompleted).length;          // :175
const examCount       = units.reduce((t,u) => t + (progress[u.filename]?.examAttempts || 0), 0);     // :176
const reviewCount     = units.filter(u => pendingReviewCount(progress[u.filename]) > 0).length;      // :177
const courseWordCount = [...savedWords.values()].filter(…).length;                                   // :179
const courseProgressPercent = units.length ? Math.round(completedCount / units.length * 100) : 0;    // :180
const averageMastery  = units.length ? Math.round(units.reduce(… getNceMastery(…) …) / units.length) : 0;  // :181-183
```

`units` 被 `.filter()` 遍历 6 次、`savedWords` 全量展开一次、每个单元再跑一次 `getNceMastery`。同文件里只有 `exercises/dictationItems/lessonWords/filteredWords/filteredUnits/latestUnit/reviewItemCount` 用了 `useMemo`，以上 9 个派生值没有。单元数增长后（第一册 144 课）这是明显的主线程开销。

### D-25 🟠 阻塞式原生弹窗作为主要反馈手段（实测 20 + 4 处）

| 组件 | `alert()` 次数 | `confirm()` 次数 |
| :--- | ---: | ---: |
| `SmartReader.jsx` | 9（202/322/367/408/418/422/455/464/485） | 1（488） |
| `Settings.jsx` | 5（151/168/181/192/201） | 1（147） |
| `VocabularySRS.jsx` | 4（234/253/290/304） | 1（215） |
| `OralCoach.jsx` | 2（915/923） | 1（347） |
| **合计** | **20** | **4** |

在一个视觉打磨到"paper-grain / 毛玻璃 / 3D 翻转卡片"水准的应用里，所有错误与危险操作确认都退回浏览器原生对话框：不可样式化、会阻塞主线程、无法放置"重试"或"查看详情"动作，且在 iOS PWA 全屏模式下观感割裂。

### D-26 🟠 组件绕过服务层直接读写 localStorage

| 位置 | 代码 | 冲突点 |
| :--- | :--- | :--- |
| `src/components/SmartReader.jsx:258` | `localStorage.setItem('lingoflow_reading_annotations', …)` | `storage.js:8` 已定义 `STORAGE_KEYS.READING_ANNOTATIONS` |
| `src/components/SmartReader.jsx:151,162` | `` localStorage.getItem(`lingoflow_read_pos_${id}`) `` | `storage.js:618,632` 负责同一前缀；该 key **未在 `STORAGE_KEYS` 中声明** |

后果：批注写入**没有走 `safeSetItem`**，配额或无痕模式失败时会直接抛错；键名在两处硬编码，任一处改名都会静默孤立已有用户数据。

### D-27 🟠 同一业务概念存在 5 份不一致的实现

"哪些词今天到期"这个判定被写了 5 次：

| 位置 | 判定条件 |
| :--- | :--- |
| `src/App.jsx:33` | `<= now + 60 * 60 * 1000`（1 小时宽限） |
| `src/components/HomeDashboard.jsx:46` | `<= now + 60 * 60 * 1000` |
| `src/components/VocabularySRS.jsx:113` | `<= now + 60 * 60 * 1000` |
| `src/services/studyPlan.js:96` | `<= nowMs + 60 * 60 * 1000` |
| `src/services/studyPlan.js:211` | **`<= now.getTime()`（无宽限）** |

同一个 `studyPlan.js` 内部就有两种口径，导致"今日到期词"在不同界面（首页胶囊 / 复习队列 / 周报）可能给出不同数字。同类重复还有：`getLocalDateKey`（`storage.js:29-34`）与 `getDateKey`（`studyPlan.js:5-10`）函数体相同；`ONE_DAY_MS`（`storage.js:247`）与 `DAY_MS`（`studyPlan.js:3`）并存；课程标签正则 `/^\d+&\d+\./` 在 `studyPlan.js:13` 与 `nceReview.js:23` 各写一遍；"困难词 / `easeFactor <= 1.8`"在 `studyView.js:23` 与 `VocabularySRS.jsx:735` 各写一遍。

---

### D-28 🔴 108 处 CSS 类名不产生任何样式：设计好的阴影层级与淡入动画实际全部失效（已实测）

这是本次诊断中**最出乎意料、也最容易被误判为"已完成"**的问题：代码里写了精心设计的阴影与动画类，但它们在实际产物中**一个字节的 CSS 都没有生成**。

项目使用 **Tailwind CSS 3.4.17**（`package.json:26` 声明 `^3.4.17`，`node_modules/tailwindcss/package.json` 实测 `3.4.17`），而 `tailwind.config.js:7-35` 的 `theme.extend` **只扩展了 `colors.brand` 与 `fontFamily.sans`**，`plugins: []`。因此下列类名既不是 Tailwind v3 的内置工具类，也没有在 `index.css` / `App.css` 中手写实现：

| 类名 | 用量 | 为什么无效 |
| :--- | ---: | :--- |
| `shadow-xs` | 44 | Tailwind 3.4 默认 `boxShadow` 仅含 `sm / DEFAULT / md / lg / xl / inner / none`（实测读取 `node_modules/tailwindcss/stubs/config.full.js` 确认为这 7 个），**无 `xs`**（`shadow-xs` 是 Tailwind v4 的命名） |
| `shadow-2xs` | 14 | 同上，**无 `2xs`** |
| `animate-in` | 12 | 来自 `tailwindcss-animate` 插件，项目 `plugins: []` 未安装该插件 |
| `text-slate-850` | 11 | slate 色阶只有 800/900，**无 850** |
| `animate-fade-in` | 8 | 需要 `theme.extend.keyframes/animation` 定义，项目中不存在 |
| `no-scrollbar` | 8 | 既非 Tailwind 内置类，`index.css` / `App.css` 中也没有对应规则（实测 grep 为 0） |
| `w-4.5` / `h-4.5` | 各 5 | Tailwind 3.4 默认 `spacing` 刻度实测为 `px,0,0.5,1,1.5,2,2.5,3,3.5,4,5,…,96`，**不含 `4.5`** |
| `pb-safe` | 1 | 同为自定义命名，项目未定义该规则 |

**验证方式（端到端，非静态推断）**：对本次生产构建产物直接检索：

```
built CSS size: 56418 bytes

class                        present in built CSS?
shadow-xs              False          ← 44 处使用，0 字节产出
shadow-2xs             False
animate-in             False
animate-fade-in        False
text-slate-850         False
w-4.5                  False
h-4.5                  False
no-scrollbar           False
pb-safe                False

=== 对照组（确实存在的类，证明检索方法有效）===
shadow-sm              True
shadow-lg              True
animate-pulse          True
text-slate-800         True
w-4                  True
select-none            True
```

**影响**：这是纯视觉层面的静默降级 —— 项目所有层次的卡片阴影退化为无阴影或落回浏览器默认，`animate-fade-in` 的淡入过渡全部变成"瞬间出现"，`w-4.5/h-4.5` 的图标尺寸失去约束。因为不报错、lint 也检测不到，这类问题可以长期存在而无人发现。**它同时解释了为什么这个视觉设计用心的应用在真机上观感会与代码意图有落差。**

**优化方向**：把 `shadow-xs/2xs`、`w-4.5/h-4.5`、`text-slate-850` 的键补进 `theme.extend`（或在全项目替换为 v3 合法类名）；`animate-in` 需引入 `tailwindcss-animate`，或改为自定义 `keyframes`；`no-scrollbar` / `pb-safe` 在 `index.css` 中补实现。若倾向彻底解决，可评估升级到 Tailwind v4（v4 已内置 `shadow-xs` 与动态 spacing 刻度）。**建议顺手加一条构建后检查**（例如断言产物 CSS 中包含关键类名），避免这类问题再次静默发生。

---

### D-29 🔴 中文输入法按 Enter 确认候选词会误触发提交

**位置**：`src/components/NewConcept.jsx:897`、`src/components/NceReview.jsx:88`

```jsx
// NewConcept.jsx:897
onKeyDown={(event) => event.key === 'Enter' && answerExercise(exerciseAnswer)}

// NceReview.jsx:88
onKeyDown={(event) => { if (event.key === 'Enter') checkAnswer(); }}
```

两处都只判断 `event.key === 'Enter'`。对中文用户来说，用拼音输入法打字时**按 Enter 确认候选词**是最高频操作之一，此时会直接把尚未完成的答案提交/判错。

项目里**已经有正确写法**（实测全仓 `isComposing` 仅出现 1 次）：

```jsx
// OralCoach.jsx:764 —— 正确，但只此一处
if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing && !e.isComposing)
```

值得注意的是：该项目的提交历史里曾专门修过同类问题（`git log` 中 `73148b7 fix(ux): enable click-outside and ESC key to dismiss modals across reader and vocab, and prevent IME enter misfire`），说明这是已被识别过的缺陷类别，但**修复没有覆盖到新概念模块**。

**优化方向**：抽一个 `onEnterSubmit(handler)` 工具函数统一带上 composition 判断，替换全部 Enter 提交点。

---

### D-30 🟠 弹层缺少对话框语义与焦点管理；31 个图标按钮无可访问名称（已实测）

**弹层（实测全仓计数）**：`role="dialog"` **0 处**、`aria-modal` **0 处**。15 个弹层分布在 `SmartReader.jsx`(6)、`VocabularySRS.jsx`(4)、`Settings.jsx`(3)、`OralCoach.jsx`(2)，全部没有：对话框语义、打开时焦点转移、`focus trap`、关闭后焦点归还。全项目唯一的 Esc 处理在 `SmartReader.jsx:373-387`（且该 effect 依赖多个 state）。另有 5 个弹窗**既不能点遮罩关闭也没有 Esc**：`VocabularySRS.jsx:1042-1044`、`:1225-1227`、`Settings.jsx:704-706`、`:773-775`、`:808-810`（均有取消按钮，故非硬性死锁）。

**图标按钮（人工逐个人工核对 195 个 `<button>`）**：31 个纯图标按钮缺少可访问名称，其中 **17 个连 `title` 都没有**（如 `OralCoach.jsx:785` 的发送按钮、6 处 X 关闭按钮）。**另有 29 处信息仅存在于 `title` 属性**，而手机触屏没有 hover，`title` 永不显示（例如 `NewConcept.jsx:832` 的"本课笔记/切换中英"）。

**同时**：`aria-label` 被贴在无语义的 `<div>` 上（`HomeDashboard.jsx:159,182`、`NceExam.jsx:157`、`SmartReader.jsx:638,666,697,764`），无障碍树通常会忽略无 role 元素上的 `aria-label`，属于"写了但无效"。**反面样例说明能力是有的**：`HomeDashboard.jsx:142`、`Settings.jsx:505-509` 写了正确的 `aria-label`。

**优化方向**：抽一个 `Modal` 组件一次性解决 15 个弹层的语义/焦点/Esc/遮罩/安全区；给图标按钮补 `aria-label`。这与 D-22 的 77 条 a11y 告警是同一批问题。

---

### D-31 🟠 `src/App.css` 是死文件（184 行 Vite 模板残留）

**实测**：`src/App.css` 共 184 行，在被检索的全部位置（`src/**/*.{js,jsx}`、`index.html`、`tailwind.config.js`、`postcss.config.js`）中**引用次数为 0**；`src/main.jsx:3` 只 `import './index.css'`。

文件内容是 Vite 脚手架默认样式（`.counter`、`.hero`、`.base`、`.framework`、`.vite`、`#next-steps`、`#docs`、`#spacer`、`.ticks`），并引用了本项目**并未定义**的 CSS 变量：`var(--accent)`、`var(--accent-bg)`、`var(--accent-border)`、`var(--border)`、`var(--text-h)`、`var(--social-bg)`、`var(--shadow)`。

**附带发现**：该文件第 14 行的 `:focus-visible { outline: 2px solid var(--accent); }` 是**全项目唯一一处键盘焦点样式**。也就是说，删除死文件的同时，应当把这个意图正式迁移到 `index.css`，否则键盘用户的焦点可见性会进一步退化。

---

### D-32 🟠 渲染体中的同步存储 IO 与滚动期写盘（实测）

| 位置 | 问题 |
| :--- | :--- |
| `src/components/SmartReader.jsx:143-146` | 在**渲染函数体内**同步读词库并遍历建映射：`const savedVocabMap = {}; StorageService.getVocabulary().forEach(...)`，而 `storage.js:163-167` 每次都会 `localStorage.getItem` + `JSON.parse`。未 `useMemo`，每次渲染都重复 |
| `src/components/SmartReader.jsx:159-165` | `onScroll` 处理器里**每帧写 localStorage** 并 `setState`，进而触发文章段落（`:715-718`）与逐词 `<span>`（`:772-806`）全量重建，无节流、无虚拟化 |
| `src/components/SmartReader.jsx:718` | 渲染期对每个段落调用 `splitIntoSentences(para)`（`:35-76`：构造 `Intl.Segmenter` + 14 条缩略语正则替换），文章越长越慢 |
| `src/components/OralCoach.jsx:175` | 在 `hitWords.forEach` **循环内部**调用 `StorageService.getVocabulary()`，N 个命中词 = N 次全量 JSON 解析 |
| `src/components/NewConcept.jsx:679-682` | 音频 `timeupdate`（约 4Hz）中执行 `lines.findIndex(...)` O(n) 扫描并 `setState` |
| `src/components/VocabularySRS.jsx:731-737` | 每次渲染 5 个内联 `vocabulary.filter(...)`（另加 `:372-373` 两个），任一 state 变化（含每次答题）都会重跑 |
| `src/components/Settings.jsx:306` → `:72-78` | 密钥输入框**每敲一个字符**就全量 `JSON.stringify` 写一次 settings，并重置一个未清理的 `setTimeout`（40 位密钥 ≈ 40 次全量写盘） |

**优化方向**：把存储读取集中到挂载/依赖变化的 `useMemo`；滚动落盘改 debounce，滚动显示改 `requestAnimationFrame` 节流；对关键词映射按文章 id 预切分缓存。

---

### D-33 🟠 卸载清理缺失：录音/朗读/定时器在组件卸载后仍会 `setState`

| 位置 | 问题 |
| :--- | :--- |
| `src/components/OralCoach.jsx:111-113` | 该组件**唯一**的 `useEffect` 是滚动到底部，**没有任何卸载清理**；而 `App.jsx:117-119` 用条件渲染在切换 Tab 时卸载组件。切走时若正在录音，麦克风会话继续（`speech.js:424-458` 的回调持续 `setInputText`），对已卸载组件 setState |
| `src/components/OralCoach.jsx:332-334` | `tts.speak(text).finally(() => setIsSpeakingId(...))` 无卸载保护 |
| `src/components/VocabularySRS.jsx:268-270` | 同型问题（`setIsPlayingStory(false)`） |
| `src/components/SmartReader.jsx:579-581`、`VocabularySRS.jsx:153-155`、`OralCoach.jsx:192`、`:375-377`、`Settings.jsx:82`、`App.jsx:57` | 6 处 `setTimeout` 均未在清理函数中 `clearTimeout` |

**对照**：`NceReview.jsx:19` 有一行正确的 `useEffect(() => () => tts.stop(), [])`，`NceExam.jsx:57-70` 的两个 effect 都带了完整 cleanup —— **说明团队已经掌握正确模式，只是没有贯彻到旧组件**。

---

### D-34 🟠 三处有偏随机打乱与一处正确实现并存；两处永不更新的 state

**有偏打乱**：`VocabularySRS.jsx:36-43` 实现了正确的 Fisher-Yates（`shuffleArray`），但另外三处用了经典的错误写法 `[...x].sort(() => 0.5 - Math.random())`：`SmartReader.jsx:340`、`VocabularySRS.jsx:300`、`OralCoach.jsx:59`。`Array.prototype.sort` 的比较器并非随机采样器，其分布有偏且依赖引擎排序实现 —— "随机抽词/随机出题"可能反复给到同一批词。

**永不更新的 state（实测无 setter）**：
- `src/components/OralCoach.jsx:79` `const [scenarios] = useState(SCENARIOS);` —— 常量套了一层 state，无 setter。
- `src/components/Settings.jsx:45` `const [localSummary] = useState(() => StorageService.getLocalDataSummary());` —— 无 setter，因此清理缓存/导入备份后，`:618-637` 展示的存储统计仍是挂载时的旧值；该问题被 `:190`/`:202` 的 `window.location.reload()` 掩盖。

**方向**：删除无 setter 的 state（`scenarios` 直接用常量）；`localSummary` 改为在操作后重新计算。

---

### D-35 🟡 移动端细节：全局 `position: fixed`、正文不可选中、`!important` 字号、`vh/dvh` 混用

| 位置 | 现状 | 风险 |
| :--- | :--- | :--- |
| `src/index.css:16-25` | `html, body { height:100dvh; overflow:hidden; position:fixed; }` | iOS 键盘弹出时，弹层内底部输入框可能无法滚动到可视区（body 级滚动兜底被移除）。**未经真机验证** |
| `src/index.css:35` | 全局 `@apply ... select-none` | 而 `SmartReader.jsx:699` 的文章容器未加 `allow-select`，**iPhone 用户无法长按选取英文原文**去查词/翻译，只能逐词点击。对照 `NceDictation.jsx:98` 的 textarea 正确带了 `allow-select` |
| `src/index.css:44-46` | `input, textarea, select { font-size: 16px !important; }` | 防 iOS 聚焦缩放的目的正确，但 `!important` 使 `SmartReader.jsx:1217`、`VocabularySRS.jsx:1276`、`Settings.jsx:308` 的 `text-xs` 全部失效，且无法局部推翻 |
| 6 个弹层用裸 `85vh/90vh`（`SmartReader.jsx:878,1036,1170,1471`、`VocabularySRS.jsx:1044`、`Settings.jsx:810`） | 同文件内已有正确写法 `SmartReader.jsx:1304` `maxHeight:'min(88dvh, 720px)'` | iOS Safari 的 `vh` 含地址栏高度，弹层底部会被浏览器 UI 遮挡 |
| `touch-action` 全仓 0 处（实测） | 大量横向滚动条带（`SmartReader.jsx:666`、`OralCoach.jsx:415,439`…） | 横滑与页面滚动可能互相干扰 |
| `OralCoach.jsx:793` 底部弹层 | 无安全区底部内边距（`SmartReader.jsx:1305` 有正确写法） | iPhone 底部横条可能压住"保存并开始聊天"按钮 |

**正面结论（实测）**：全仓 `100vh` 出现 **0 次**、`100dvh` **3 次**，且 `index.css:17-18` 先写 `height:100%` 再写 `100dvh` 作降级 —— 这是正确写法；安全区在 `App.jsx:131`、`StudyHeader.jsx:5`、`index.css:7-8` 都有正确使用。说明移动端细节**部分是达标的**，问题集中在旧组件未跟进统一约定。

---

## 八、🟠 文档与工程化

### D-36 🟠 README 完全未覆盖"新概念英语"模块（已实测）

`README.md` 只描述了 4 项功能（口语对练、智能精读、生词 SRS、个人配置，`:7-28`），但应用当前有 **5 个底部导航标签**（`App.jsx:19` `VALID_TABS = ['home','oral','reader','nce','vocab','settings']`），其中 `nce`（新概念）对应的代码体量是**全项目最大的一块**：

- `NewConcept.jsx` 910 行 + `NceDictation.jsx` 116 + `NceExam.jsx` 204 + `NceReview.jsx` 98
- 支撑服务 `nce.js` 138 + `nceExam.js` 89 + `nceReview.js` 52 + `nceMastery.js` 29
- 相关存储键 `NCE_PROGRESS` / `NCE_CACHE` / `NCE_EXAMS`（`storage.js:9-11`）

实测 `README.md` 中 `新概念|New Concept|NCE` 出现次数为 **0**。新用户按 README 上手，会完全不知道占应用三分之一的课程模块存在。

### D-37 🟠 审计文档描述的代码行为与实际不符（已实测）

| 文档位置 | 文档说法 | 实际代码 |
| :--- | :--- | :--- |
| `docs/PRODUCT_FUNCTION_AUDIT.md:71-72` | "当前部署的 `sw.js` 是自毁清空型脚本" | `public/sw.js` 已是完整的 network-first 缓存脚本（`:26-67`），文件内**没有** `unregister()` |
| `docs/PRODUCT_ROADMAP.md:46` | "`public/sw.js` 当前只清理旧缓存并注销自己，不承担离线访问" | 同上；且**真正被注册的是 `sw-v10.js`**（`index.html:21`），文档从未提及该文件 |
| `docs/PRODUCT_ROADMAP.md:87` | 把"新版本上线后提示刷新"列为 P0 验收项 | `src/` 中零处 service worker 相关代码，该功能不存在 |

**风险**：后续任何按文档施工的人（或 AI 助手）会基于错误前提行动 —— 例如以为 `sw.js` 已自毁而去删除它，或以为离线未实现而重写一套。

### D-38 🟠 `P0_P1_IMPROVEMENT_PLAN.md` 的 7 项任务已全部完成，但文档未标记状态

根目录 `P0_P1_IMPROVEMENT_PLAN.md`（203 行）读起来仍像一份待办清单。逐项核对结果：

| 任务 | 文档要求 | 代码现状 | 结论 |
| :--- | :--- | :--- | :--- |
| 1 | 口语收藏直达生词本 + 补全词条字段 | `OralCoach.jsx:661` "去生词本 →"；`App.jsx:118` 传入 `onNavigateToVocab` | ✅ 已实现 |
| 2 | 闪卡背完不再硬塞 5 个词 | `VocabularySRS.jsx:55` `reviewCompleted` state、`:480` 结算视图；`slice(0, 5)` 硬塞逻辑已不存在 | ✅ 已实现 |
| 3 | 测验成绩单 + 错题打回重背 | `VocabularySRS.jsx:68` `quizScore`、`:326` `updateWordSRS(found.id,'again')`、`:981-1004` 成绩卡与薄弱词提示 | ✅ 已实现 |
| 4 | 分句防缩写腰斩 | `SmartReader.jsx:38-41` 使用 `Intl.Segmenter('en', {granularity:'sentence'})` | ✅ 已实现 |
| 5 | 口语流式打字机 | `ai.js:58` `callAICompletionStream`、`:399-411` `onChunk` → `extractPartialReplyText` | ✅ 已实现 |
| 6 | 网页链接提取 + 整段双语对照 | `SmartReader.jsx:415-459` `handleExtractFromUrl`、`:402` `translateParagraphWithAI` | ✅ 已实现（但见 D-14 隐私提示） |
| 7 | 自适应 easeFactor + 打卡统计 | `storage.js:251-291` 动态 ease（1.3~2.8）；`studyPlan.js` / `HomeDashboard.jsx:147-149` 连续天数与周报 | ✅ 已实现（但见 D-39 算法与断言不符） |

**建议**：给该文档加"已完成（2026-09）"状态头并归档到 `docs/archive/`，否则它会持续误导后续开发。

### D-39 🟡 SM-2 算法实现与注释/文案声明不一致（已复现数值）

`storage.js:254` 的注释写 `// Standard SuperMemo SM-2 Adaptive Ease Factor Adjustment`，`README.md:21` 对外宣传"科学的 SM-2 艾宾浩斯遗忘曲线算法"，但实现是**三档固定增量启发式**，不是 SM-2 公式 `EF' = EF + (0.1 - (5-q)(0.08 + (5-q)·0.02))`：

```js
newEase = Math.max(1.3, Number((newEase - 0.2).toFixed(2)));    // :260  again
newEase = Math.max(1.3, Number((newEase - 0.15).toFixed(2)));   // :266  hard
newEase = Math.min(2.8, Number((newEase + 0.1).toFixed(2)));    // :270  good  ← 上限 2.8，SM-2 为 2.5
newStep = Math.max(0, newStep);                                 // :262  hard 分支：对非负整数是空操作
```

实测数值结论：

```
6. intervalDays after 9 consecutive "good": [1,3,8,22,62,174,487,1364,3819]
6. "hard" on a 1-day card ->: {"step":0,"intervalDays":1,"easeFactor":2.35,"status":"review"}
```

- 连续 9 次"good"后间隔达 **3,819 天（约 10.4 年）** —— 无上限钳制。
- "hard" 对 1 天卡片的间隔计算为 `max(1, round(1*1.2)) = 1`，**永远停在 1 天**，且 `status` 被无条件设为 `'review'`，与 `step=0` 的学习态自相矛盾。
- `:262` 的 `Math.max(0, newStep)` 是空操作，意味着"hard"从不降级 `step`；因此一张 step=4 的卡片按一次"hard"后，下一次"good"就直接晋级 `mastered`（`:278-280`）。
- `:1285-1288` 的种子词 `sample_15` 使用 `step:3, status:'mastered'`，与 `:272-284` 的状态机（`step>=2` → review，`>=5` → mastered）不一致，是第三套口径。

**优化方向**：要么实现真正的 SM-2 并同步 README 文案，要么在注释与文案中改为"三档自适应记忆间隔（非标准 SM-2）"，并补上间隔上限、修掉 `hard` 的空操作与状态矛盾。

---

## 九、验证结果（本次实际执行与复现记录）

### 9.1 项目自带检查：全部通过

```
$ npm test
ℹ tests 24   ℹ pass 24   ℹ fail 0   ℹ duration_ms 94.2029

$ npx oxlint
Found 0 warnings and 0 errors.   (38 files, 104 rules, 89ms)

$ npx vite build --outDir %TEMP%\lingoflow-build-probe --emptyOutDir
✓ 1869 modules transformed.   ✓ built in 8.44s
```

**结论**：项目当前"绿灯"，但绿灯的成因包含检查项缺口（D-21、D-22）。

### 9.2 独立复现脚本与输出

复现脚本写入系统临时目录（`%TEMP%\lf-probe\probe.mjs`），**未在项目内创建或修改任何文件**。脚本仅以 mock `localStorage` 导入 `src/services/storage.js`。

```
1. stored 2 words incl. sample_1 -> getVocabulary() returns count: 30
1. did user word "myownword" survive?: false
1. persisted localStorage count now: 30
2. import result: {"success":false,"error":"imp.word.toLowerCase is not a function"}
2. provider after failed import: openai
2. apiKey after failed import: LOCAL_KEY
2. speechApiKey after failed import: 
3. updateWordSRS returned (claimed) card: {"step":1,"intervalDays":1,"easeFactor":2.6}
3. what is actually persisted: {"id":"w1","word":"alpha","step":0,"intervalDays":1,"easeFactor":2.5,"tags":[]}
4. getVocabulary() with stored "null": null
4. getAppState() with stored "null": null
4. .filter() on the result THREW: TypeError: Cannot read properties of null (reading 'filter')
5. DEFAULT_SAMPLE_WORDS.length before/after: [30,31]
5. DEFAULT_SAMPLE_WORDS[0].word before/after: ["ubiquitous","brandnewword"]
6. intervalDays after 9 consecutive "good": [1,3,8,22,62,174,487,1364,3819]
6. "hard" on a 1-day card ->: {"step":0,"intervalDays":1,"easeFactor":2.35,"status":"review"}
7. ensureSchema() with stored version "abc" ->: 3
7. raw stored version stays: abc
```

**逐条对应**：第 1 组 → D-01；第 2 组 → D-03；第 3 组 → D-05；第 4 组 → D-06；第 5 组 → 补充发现（`getVocabulary()` 返回模块常量引用，`storage.js:166` 返回 `DEFAULT_SAMPLE_WORDS` 本体，`storage.js:232` 的 `words.unshift(newEntry)` 直接改写了导出常量，此后 `Settings.jsx:198` 的"恢复官方初始演示数据"会写入被污染的数据）；第 6 组 → D-39；第 7 组 → `ensureSchema()` 对非数字版本号（`NaN`）永不修复，却仍返回 3。

### 9.3 静态检查缺口实测

```
$ npx oxlint -D react/no-array-index-key src
Found 0 warnings and 11 errors.        → D-21

$ npx oxlint --jsx-a11y-plugin src
Found 77 warnings and 0 errors.        → D-22
```

### 9.3.1 构建产物 CSS 类名有效性验证（D-28 的端到端证明）

不是静态推断，而是对本次生产构建产物直接检索类名是否真的生成了规则：

```
built CSS size: 56418 bytes

class                  present in built CSS?
shadow-xs              False      ← 源码中使用了 44 次
shadow-2xs             False      ← 14 次
animate-in             False      ← 12 次
animate-fade-in        False      ←  8 次
text-slate-850         False      ← 11 次
w-4.5 / h-4.5          False      ← 各 5 次
no-scrollbar           False      ←  8 次
pb-safe                False      ←  1 次

对照组（预期存在，全部 True，证明检索方法可靠）：
shadow-sm True | shadow-lg True | animate-pulse True | text-slate-800 True | w-4 True | select-none True
```

同时读取 Tailwind 3.4.17 自带的默认主题确认为"该键不存在"，而非"未被打包"：

```
=== tailwind 3.4.x 默认 boxShadow 键 ===
sm, DEFAULT, md, lg, xl, inner, none      → 无 xs / 2xs
=== 默认 spacing 键 ===
px,0,0.5,1,1.5,2,2.5,3,3.5,4,5,…,96      → 无 4.5
tailwindcss installed version: 3.4.17
```

### 9.3.2 前端结构与无障碍计数实测

```
useState 合计（10 个组件）: 154        useCallback 合计: 2（均在 NceExam.jsx）
React.memo 使用: 0                     role="dialog" 出现: 0
aria-modal 出现: 0                     touch-action 出现: 0
100vh 出现: 0                          100dvh 出现: 3      （写法正确）
isComposing 出现: 1（仅 OralCoach.jsx:764 正确）
alert() 20 处 / confirm() 4 处（定位见 D-25）
```

### 9.4 版本与产物核查

```
$ git ls-files dist | Measure-Object -Line   → 0            （dist 未被提交）
$ git check-ignore -v dist
.gitignore:11:dist	dist                                  （已正确忽略）
$ Test-Path .github                          → False        （无 CI）
$ Test-Path tsconfig.json                    → False        （无类型检查）
```

### 9.5 未经本机验证的事项（诚实标注）

以下结论来自代码静态确证或平台文档，**本次未在真机/浏览器中验证**，实施前建议实测：

- iOS Safari 是否接受 SVG 格式 `apple-touch-icon`（D-19）
- Android Chrome 对 `"sizes": "any"` SVG 图标的安装判定与 maskable 裁切效果（D-19）
- 各 TTS/SpeechRecognition 引擎对超长 utterance 的截断行为（`speech.js:273` 无长度上限，而云端路径有 4096 上限）
- 具体 AI 服务商在 `[DONE]` 后是否保持连接（D-04 的挂死路径在 keep-alive/反代场景成立）
- 性能类结论（D-24）为代码结构推断，**未做真机 Profiler 测量**

---

## 十、优化路线图建议

> 以下为**建议方向**，本次诊断未实施任何改动。分批原则：先止血（数据安全）→ 再稳定（网络与离线）→ 后提质（架构与工程化）。

### 第零批：改动极小、收益确定的即时修补（可与其它批次并行）

这些项都是"几行改动、无需设计决策"，但每一项都能立刻消除一类静默失效：

1. **修 IME Enter 误提交**（D-29）：`NewConcept.jsx:897` 与 `NceReview.jsx:88` 补 `!event.nativeEvent?.isComposing && !event.isComposing`，或抽 `onEnterSubmit` 工具（对齐 `OralCoach.jsx:764` 的正确写法）。
2. **补齐 Tailwind 缺失键**（D-28）：在 `tailwind.config.js` 的 `theme.extend` 中补 `boxShadow.xs/2xs`、`spacing[4.5]`、`colors.slate[850]`，并在 `index.css` 补 `.no-scrollbar` / `.pb-safe`；`animate-in` 需引入 `tailwindcss-animate` 或自写 keyframes。**改完请复查构建产物 CSS 中这些类名是否出现**。
3. **打开静态检查视野**（D-21、D-22）：`.oxlintrc.json` 加入 `"jsx-a11y"` 插件与 `react/no-array-index-key` 规则，把实际存在的 88 条问题纳入可见范围。
4. **删除死文件**（D-31、D-16）：删除 `src/App.css`（并把 `:focus-visible` 焦点样式迁移进 `index.css`）、6 个未注册的 `public/sw-v5.js`~`sw-v9.js`、被取代的 `public/sw.js`，以及零引用的 `public/favicon.svg`(9,522B)、`public/icons.svg`(5,055B)、`src/assets/hero.png`(13,057B)、`src/assets/react.svg`、`src/assets/vite.svg`。
5. **删除两处永不更新的 state**（D-34）：`OralCoach.jsx:79` 与 `Settings.jsx:45`。

### 第一批：数据安全止血（建议优先，改动面小、收益确定）

1. **拆掉读取路径的写操作**（D-01）：`getVocabulary()` / `getArticles()` 只读；把"演示词升级"改成显式的版本化迁移，触达前先备份原值。
2. **统一读取出口的形状归一**（D-06）：每个 getter 返回 `Array.isArray(x) ? x : []` / 对象兜底；在 `main.jsx` 根部再包一层 ErrorBoundary。
3. **导入改为"暂存 → 校验 → 单次提交"**（D-03、D-08）：加 `app`/`version` 校验；密钥字段统一白名单保留；失败时零副作用。
4. **修正备份合并方向**（D-07）：调度三字段同样取优，保留本地 `id`。
5. **写入失败可见化**（D-05）：`safeSetItem` 保留错误类型，修改器返回 `{ok, error}`，UI 给出可操作的提示。

### 第二批：网络与离线稳定

6. **统一 AI 请求封装**（D-04、D-15）：`postChatCompletion({ signal, timeoutMs, maxTokens })`，流式加空闲超时、`[DONE]` 正确终止、`finally` 释放 reader、中断保留部分文本。
7. **结构化中文错误 + 共享诊断器**（D-12）：把 `OralCoach.jsx:29-53` 的 `diagnoseErrorMessage` 上移为共享模块，剔除 6 处 `err.message` 直出。
8. **并发防护**（D-13）：查词/长难句/段落翻译加请求 token 校验；切换情景或卸载时中断在途请求。
9. **修 SW 缓存删除逻辑**（D-02）：只清理自身命名空间；把课程音频与 TTS 缓存纳入白名单。
10. **缓存策略分层 + 预缓存**（D-17）：`/assets/*` 内容哈希资源改 cache-first；`install` 中 `waitUntil` 预缓存应用外壳；加"新版本可用，点击刷新"提示。
11. **离线状态传导**（D-18）：把 `isOffline` 下传到 AI 入口，离线时禁用并按 `docs/PRODUCT_ROADMAP.md:87` 的要求显示"联网后可用"。

### 第三批：架构与工程化提质

12. **打开静态检查的视野**（D-21、D-22）：`.oxlintrc.json` 启用 `jsx-a11y` 插件与 `react/no-array-index-key`，把实际存在的 88 条问题纳入可见范围，分批消化。
13. **补测试基础设施**（D-11）：引入 `vitest` + `jsdom` + `@testing-library/react`，优先覆盖 `updateWordSRS` 状态矩阵、导入失败、损坏 payload 三条路径 —— 这些正是本次复现出缺陷的地方。
14. **拆解巨型组件**（D-23、D-24）：`SmartReader.jsx` 至少按"文库/查词弹窗/长难句/翻译/批注"拆 4-5 个；`NewConcept.jsx` 按"课程列表/学习页/音频控制"拆分；把 D-24 列出的 9 个派生值 `useMemo` 化。
15. **消除概念重复**（D-27、D-09）：抽取 `src/services/time.js`、`text.js`；"今日到期"统一为单一导出函数；口语提示词合并为单构造器并删除死函数 `getOralCoachResponse`。
16. **文档与代码对齐**（D-36、D-37、D-38）：README 补全新概念模块与离线说明；修正 `PRODUCT_FUNCTION_AUDIT.md:71-72`、`PRODUCT_ROADMAP.md:46,87` 中关于 `sw.js` 的错误描述；为 `P0_P1_IMPROVEMENT_PLAN.md` 加完成状态。
17. **清理死代码与产物**（D-16、D-20）：删除 6 个未注册的 SW 文件、`public/favicon.svg`（9,522B，零引用）、`public/icons.svg`（5,055B，零引用）、`src/assets/hero.png`（13,057B，零引用）、`src/assets/react.svg`、`src/assets/vite.svg`；补 `deploy` 脚本与 `.nojekyll`。
18. **图标与 head 补全**（D-19）：补 192/512 PNG、maskable 独立图、`apple-touch-icon-180.png`；补 `description`/OG；去掉 `user-scalable=no`。
19. **引入 CI**：GitHub Actions 跑 `npm test` + `npm run lint` + `npm run build`，让"D-21/D-22 这类问题不会被发现"不再复发。
20. **拆分入口分块**（3.3 节）：`vite.config.js` 加 `manualChunks`，把 React 运行时与业务代码分离，削减 269 kB 入口块的重复下载成本。
21. **抽 `Modal` 与 `Toast` 两个基础组件**（D-30、D-25）：一次解决 15 个弹层的 `role="dialog"`/`aria-modal`/焦点管理/Esc/遮罩/安全区/`dvh` 问题，并替换 20 处 `alert()` 与 4 处 `confirm()`；同时统一遮罩透明度与圆角这些目前各写一套的细节（`bg-black/40`、`/45`、`/50` 并存）。
22. **补齐卸载清理**（D-33）：`OralCoach.jsx` 增加 `useEffect(() => () => stt.stop(), [])`，并为 6 处 `setTimeout` 统一加 `clearTimeout`；可抽 `useTimeout` hook。
23. **收敛渲染期副作用与滚动性能**（D-32）：存储读取移入 `useMemo`、滚动落盘 debounce、滚动显示 `requestAnimationFrame` 节流、句子切分按文章 id 预切分缓存。
24. **统一随机与常量工具**（D-34、D-27）：把正确的 Fisher-Yates `shuffleArray`（`VocabularySRS.jsx:36-43`）导出复用，替换 3 处 `sort(() => 0.5 - Math.random())`；把 `isComposing` 判断、日期格式化、Blob 下载助手各收敛为单一实现。

---

## 十一、剩余风险与下一步

### 11.1 剩余风险

| 风险 | 说明 |
| :--- | :--- |
| **静态诊断不能替代真机验证** | 本报告未运行浏览器，D-19（图标/安装）、D-17（iOS 缓存淘汰行为）、语音相关结论需真机复测后才能定稿实施方案。 |
| **数据丢失风险仍在生效** | D-01/D-03/D-05/D-07 在报告生成时**均未被修复**。任何继续使用都可能触发，建议尽快导出一次安全备份（`Settings.jsx:135` 的默认脱敏导出）作为保险。 |
| **`getVocabulary()` 常量污染是跨会话隐患** | 已在 9.2 第 5 组复现：导出常量被 `addWord` 改写。虽然多数情况下会随后落盘，但同会话内任何依赖 `DEFAULT_SAMPLE_WORDS` 的逻辑（如 `Settings.jsx:198` 恢复演示数据）会读到被污染的值。 |
| **无跨标签页机制** | 全仓无 `storage` 事件监听、无 `BroadcastChannel`、无 `navigator.locks`（实测 grep 无匹配）。单设备打开两个标签页/PWA 窗口时，整键读-改-写会互相覆盖。按"个人自用"假设评估为中，但装到主屏后同时开浏览器与 PWA 的场景并不罕见。 |
| **外部依赖不可控** | `nce.mleo.site`（D-14）与 `r.jina.ai`（D-14）均在项目控制范围之外，其可用性变化会直接表现为功能失效或隐私面扩大。 |
| **文档漂移会放大后续返工** | 若在修正文档前先动代码，D-37 描述的错误前提可能被进一步引用。 |
| **视觉层静默失效不易被察觉** | D-28 的 108 处类名不产出 CSS 不会报错、lint 也检测不到，只能靠"看真机 + 查构建产物"发现。同理 D-31 删掉 `App.css` 时会连带删掉全项目唯一的 `:focus-visible` 规则，需先迁移。 |
| **中文用户的输入体验缺陷已存在** | D-29 的 IME 误提交在新概念练习与复盘两处生效；项目历史上修过同类问题（`git log` 提交 `73148b7`）但未覆盖新模块，说明该缺陷类别有反复出现的倾向。 |

### 11.2 下一步建议（按投入产出排序）

1. **立即（今天就能做完）**：先按 9.5 的提示用现有导出功能做一次完整安全备份，规避 D-01/D-03/D-07 的持续风险；同时执行"第零批"第 1、2 项（IME 判断 + Tailwind 缺失键），这两处合计改动不到 30 行，却能立刻消除中文用户误提交与全部视觉静默失效。
2. **本轮迭代**：实施"第一批：数据安全止血"5 项（D-01/03/05/06/07）。这几处改动集中在 `storage.js` 与 `main.jsx`，且已有 `test/storage.test.js` 可扩展，回归成本低。
3. **下一轮**：实施"第二批"中的 D-04（AI 超时/取消）与 D-02（SW 误删缓存）—— 这两项分别对应"界面卡死"和"离线音频丢失"两个用户可直接感知的故障。
4. **并行可做**：D-21/D-22 只是 `.oxlintrc.json` 两行配置，改动极小却能把 88 条真实问题纳入视野，建议尽早开启以便后续改动有护栏；D-16/D-31 的删文件同样是零风险清理。
5. **需要确认后再动**：D-19 的图标方案与 D-17 的缓存策略调整建议先在你自己的 iPhone + Android 上实测当前表现，再决定引入 `vite-plugin-pwa` 还是继续手写 SW。D-28 若选择"升级 Tailwind v4"而非补键，属于较大范围改动，建议单独评估。

### 11.3 需要你确认的关键歧义

以下问题会改变实施方向，建议确认后再进入改造：

1. **新概念课程内容（`nce.mleo.site`）的归属**：是自有可控资源，还是第三方站点？如果是第三方，是否计划把课程数据本地化（影响 D-14 的修法）。
2. **"网页链接提取"是否必须保留**：若可接受"手动粘贴正文"为主路径，D-14 的隐私问题可直接规避。
3. **多设备同步的优先级**：当前是"本地优先 + 手动备份导入"。若近期要上真正的云同步，D-07 的合并规则设计需要一次系统性重构而非打补丁。

---

## 十二、实施记录（已落地的修复）

> 本节记录本报告发布**之后**实际执行的代码改动，使本文档同时充当"问题清单"与"修复台账"。
> 第一批修复已提交为 `8fc5a3a` 并推送到 `origin/main`，随后发布到 `gh-pages`（`08015f7`）；D-31 护栏与部署自动化在其后补入。

### 12.1 验证结论（本次改动后实测）

```
$ npm test
ℹ tests 39   ℹ pass 39   ℹ fail 0        （原 24 例 + 新增 15 例回归测试）

$ npx oxlint
Found 88 warnings and 0 errors.          （88 条为本次主动启用的可见告警，详见下）
   26 jsx-a11y(label-has-associated-control)
   24 jsx-a11y(click-events-have-key-events)
   24 jsx-a11y(no-static-element-interactions)
   11 react(no-array-index-key)
    2 jsx-a11y(prefer-tag-over-role)
    1 jsx-a11y(media-has-caption)

$ npm run build
✓ 1870 modules transformed.   ✓ built in ~0.7s
```

**红→绿验证（证明新测试不是空测试）**：把新增用例指向 `git show HEAD~1:`（即全部改动之前的 `33bbc45`）运行：

| 测试文件 | 对旧代码 | 对新代码 |
| :--- | :--- | :--- |
| `test/storage-safety.test.js`（13 例） | **12 fail / 1 pass** | 13 pass |
| `test/service-worker.test.js`（缓存清理 1 例） | **1 fail** | pass |

> 唯一的旧代码通过项是 `"again" 把卡片重置为明天再学` —— 该行为原本就正确，属于"防止后续改坏"的护栏测试。
> 注意：验证时必须使用 `HEAD~1` 而非 `HEAD`，否则拿到的是已修复版本，红测会假通过。

### 12.2 已修复清单

| 编号 | 修复内容 | 改动位置 | 验证方式 |
| :--- | :--- | :--- | :--- |
| D-01 | 读取路径不再写盘：删除 `getVocabulary()` 里的"自动升级"覆盖逻辑；改为显式一次性迁移 `migrateLegacySampleData()`——仅在**整个词库全部为 `sample_*` 演示词**时替换，且替换前把原值备份到 `lingoflow_vocabulary_legacy_backup` | `src/services/storage.js` | 新测试 + 红绿验证 |
| D-02 | Service Worker 激活时只清理自身命名空间（`lingoflow-offline-*`），并把 `lingoflow-nce-audio-v1` / `lingoflow-tts-v1` 列入保护名单 | `public/sw.js` | `test/service-worker.test.js`（红绿验证） |
| D-03 | 导入前先做快照，写入失败即整体回滚；`speechApiKey` 与 `apiKey` 同样"导入值非空才覆盖" | `src/services/storage.js` | 新测试 ×2 |
| D-04 | AI 请求新增超时（默认 60s，流式空闲 30s）与 `AbortSignal` 支持；修正 `[DONE]` 只跳出内层循环导致的不结束；`finally` 中 `reader.cancel()`；中断时保留已收到的文本；超时/取消/连不上分别给出中文错误 | `src/services/ai.js` | 代码确证 + 构建 |
| D-05 | `safeSetItem` 记录失败原因并累计计数；`updateWordSRS` 写盘失败返回 `null` 而非"已推进"的卡片；设置页保存失败显示"未能保存"而不是"已保存" | `src/services/storage.js`、`src/components/Settings.jsx` | 新测试 |
| D-06 | 所有 getter 增加形状归一（`asArray` / `asObject` / `readJson`），损坏值退化为空值而不再返回 `null`；`main.jsx` 根部补 ErrorBoundary | `src/services/storage.js`、`src/main.jsx` | 新测试（含白屏用例） |
| D-07 | 备份合并改为"调度状态只前进不后退"：`intervalDays`/`easeFactor` 取较大值，`nextReviewDate` 取更晚者，`id`/`createdAt` 保留本地 | `src/services/storage.js` | 新测试 |
| D-08 | 导入前校验 `app === 'LingoFlow'` 与版本上限；`parseBackupPreview` 同样拒绝外部 JSON；词汇 `word` 非字符串不再抛错 | `src/services/storage.js` | 新测试 |
| D-16 | 8 个 Service Worker 文件收敛为**唯一** `public/sw.js`，删除 `sw-v5`~`sw-v10` 与旧的重复实现；`index.html` 注册路径同步 | `public/`、`index.html` | 构建产物核查 |
| D-21/D-22 | `.oxlintrc.json` 启用 `jsx-a11y` 插件与 `react/no-array-index-key`，把实际存在的 88 条问题纳入可见范围 | `.oxlintrc.json` | lint 输出对比 |
| D-26 | 阅读进度与批注不再绕过服务层：新增 `getReadingPosition`/`saveReadingPosition`，`SmartReader` 改走 `StorageService` | `src/services/storage.js`、`src/components/SmartReader.jsx` | 代码确证 |
| D-28 | 补齐 Tailwind 缺失令牌：`boxShadow.2xs/xs`、`spacing.4.5`、`slate.850`、`fade-in` keyframes/animation；`no-scrollbar`/`pb-safe` 在 `index.css` 实现；并加 `prefers-reduced-motion` 保护 | `tailwind.config.js`、`src/index.css` | **构建产物 CSS 逐条核对（9/9 已生成规则）** |
| D-29 | 中文输入法按 Enter 不再误提交：新增 `src/services/keyboard.js`（`onEnterSubmit`/`isImeComposing`），替换 `NewConcept.jsx`、`NceReview.jsx` 两处裸 Enter 判断 | `src/services/keyboard.js` + 2 组件 | 代码确证 + lint |
| D-31 | 排程语义修正（**保留三档启发式，只加护栏**，不改评分档位）：① 新增 `MAX_INTERVAL_DAYS = 365` 上限——此前连续 9 次"good"会把间隔推到 3819 天，单词等于消失；② `hard` 至少前进 1 天——此前 `max(1, round(1×1.2)) = 1`，1 天卡片会永远每天到期；③ 删除 `Math.max(0, newStep)` 这行空操作并注明 `step` 为何故意不降级（降级会把已知难词打回每日阶梯，反而加重每日负担）；④ 修正注释与 README 对"SM-2"的表述 | `src/services/storage.js` | 新测试 ×3（红绿验证：旧代码 2 例失败） |
| D-33/D-37（部分） | `OralCoach` 新增卸载清理：离开页面时中断在途 AI 流并 `stt.stop()`；切换情景时中断旧流；被取消的请求不再写回对话 | `src/components/OralCoach.jsx` | 代码确证 + lint |
| D-17（部分） | 部署链路自动化（见 12.3）：`npm run deploy` + `scripts/deploy-gh-pages.mjs` 取代手工铺 `gh-pages`；新增 CI 与自动部署工作流 | `scripts/`、`.github/workflows/`、`package.json` | 脚本 dry-run 实测 |
| — | 删除零引用死资源：`src/App.css`(184 行)、`src/assets/{react.svg,vite.svg,hero.png}`、`public/{favicon.svg,icons.svg}`；`App.css` 中唯一的 `:focus-visible` 规则已迁移进 `index.css` | 多处 | git 引用复查 |
| — | `Settings` 清理课程缓存补 `.catch`，失败不再静默；删除两处永不更新的 state（`OralCoach` 的 `scenarios`、`Settings` 的 `localSummary`） | 2 组件 | lint |

### 12.3 部署链路自动化（本次新增）

手工铺 `gh-pages` 是"线上落后于 main"这一风险的根源，因此一并自动化：

| 新增 | 作用 |
| :--- | :--- |
| `scripts/deploy-gh-pages.mjs` | 用临时 git worktree 把 `dist/` **整体替换**到部署分支（因此删除的文件会真正消失），附加 `.nojekyll`，**普通快进提交、绝不 force push**；支持 `--dry-run`；`finally` 中清理 worktree |
| `npm run deploy` / `npm run deploy:dry` | 构建后一键发布 / 空跑校验 |
| `.github/workflows/ci.yml` | 每次 push / PR 跑 `npm test` + `npm run lint` + `npm run build` |
| `.github/workflows/deploy.yml` | push 到 `main` 后自动构建并发布到 `gh-pages`（先跑测试，且带并发保护） |

> 踩坑记录（已修）：脚本最初在 `try` 内调用 `process.exit(0)`，导致 `finally` 不执行、临时 worktree 泄漏。已改为 `return` + 顶层 `process.exitCode`，dry-run 实测 worktree 正常回收。另外首版日志打印的是分支上的**旧**入口分块，已改为读取 `dist/index.html`。

### 12.4 本次**未做**的部分及原因（保持诚实）

| 未做项 | 原因 |
| :--- | :--- |
| **D-17 剩余部分：缓存策略调整**（`/assets/*` 改 cache-first、`install` 预缓存应用外壳、缓存淘汰上限） | 会改变离线行为，需要真机验证。本次只做了其中的明确缺陷（D-02）与部署自动化，策略本身仍待真机确认。**已知残留**：新 worker 激活时会清掉旧 app-shell 缓存且尚无预缓存，老用户更新后立刻断网可能看到 503 文本页。 |
| **D-19 PWA 图标**（192/512 PNG、maskable 独立图、`apple-touch-icon-180.png`） | 需要设计与位图资源，且 iOS/Android 表现需真机确认。 |
| **D-31 的评分档位本身**（是否改成正真 SM-2 的 0–5 评分与 EF 公式） | 本次按"保留启发式 + 加护栏"处理，因为它不改变复习负担；改成真 SM-2 会显著改变每日复习量，属产品决策。 |
| **D-12 错误文案全面中文化**（把 `diagnoseErrorMessage` 上移为共享模块、7 处调用点改造） | 本次已在 `ai.js` 内完成超时/取消/断网三类的中文映射；其余上游错误原文的处理留待与 D-12 一并做。 |
| **D-13 查词并发竞态**（点 B 词时 A 的结果贴错） | 需要请求 token 与状态核对，属于 SmartReader 的独立改造；本次先解决了 `OralCoach` 的取消与写回问题。 |
| **D-23/D-24 组件拆分与 memo 化**、**D-27 概念去重**、**D-25 alert→toast**、**D-30 弹层 Modal 化**、**D-32 渲染期 IO 收敛**、**D-34 打乱统一** | 均为较大范围重构，且与外观/交互强相关，建议作为独立批次推进。 |
| **D-35~D-39 文档对齐**（README 补新概念模块、修正审计文档对 `sw.js` 的错误描述、标注 P0_P1 计划已完成） | 属于文档工作，本次聚焦代码与部署；建议紧接着做，避免文档继续误导。 |

### 12.5 变更规模与发布记录

```
第一批（8fc5a3a）：25 files changed, 708 insertions(+), 717 deletions(-)
第二批（D-31 护栏 + 部署自动化）：见 12.1 的测试与构建结果

gh-pages： 53 文件 / 1,188,998 B  →  26 文件 / 598,888 B
           （清掉 47 个不可达文件，约 859 KB）
```

新增文件：`src/services/keyboard.js`、`scripts/deploy-gh-pages.mjs`、`.github/workflows/{ci,deploy}.yml`、`test/storage-safety.test.js`、`test/service-worker.test.js`。

---

## 附录 A：本报告引用的关键文件清单

| 文件 | 行数 | 本报告涉及 |
| :--- | ---: | :--- |
| `src/services/storage.js` | 1,624 | D-01/03/05/06/07/08/27/31 |
| `src/components/SmartReader.jsx` | 1,583 | D-13/14/21/23/25/26/36/37/39 |
| `src/components/VocabularySRS.jsx` | 1,452 | D-21/23/25/36/37/38 |
| `src/components/OralCoach.jsx` | 934 | D-12/13/21/25/33/36/37/38/39 |
| `src/components/NewConcept.jsx` | 910 | D-14/23/24/33/36/39 |
| `src/components/Settings.jsx` | 856 | D-03/25/36/38/39 |
| `src/services/ai.js` | 619 | D-04/09/10/11/12/15 |
| `src/services/speech.js` | 481 | D-02/37 |
| `src/services/studyPlan.js` | 239 | D-27 |
| `src/App.jsx` | 220 | D-06/18/23/27 |
| `src/index.css` | 190 | D-35 |
| `src/App.css` | 184 | D-31（死文件） |
| `test/storage.test.js` | 110 | D-11/3.2 |
| `public/sw.js` | 68 | D-02/16/29 |
| `public/sw-v10.js` | 46 | D-02/17 |
| `index.html` | 32 | D-16/17/19 |
| `public/manifest.json` | 20 | D-19 |
| `tailwind.config.js` | 36 | D-28 |
| `.oxlintrc.json` | 8 | D-21/22 |

## 附录 B：复现脚本位置

- 数据层独立复现脚本：`%TEMP%\lf-probe\probe.mjs`（本次生成，位于系统临时目录，**不在项目内**，可随时删除）
- 构建验证输出目录：`%TEMP%\lingoflow-build-probe\`（同上，项目 `dist/` 未被触碰）
- 如需保留脚本以备复核，可将其复制到项目外任意位置；脚本依赖仅为 Node 内置模块与项目内的 `src/services/storage.js`。

---

*本报告为只读诊断产物。生成过程中未修改、未删除、未新建项目内的任何业务代码或配置文件。*
