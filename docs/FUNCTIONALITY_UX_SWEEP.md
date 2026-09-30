# LingoFlow 功能性与用户体验优化扫描报告

> **文档性质**：只读扫描（未改动任何业务代码）
> **扫描对象**：`D:\d\lingoflow`，`main` @ `c2e3b69`
> **生成时间**：2026-09-30
> **与既有文档的关系**：本报告**不重复** `docs/OPTIMIZATION_DIAGNOSIS_REPORT.md`（D-01~D-39，偏数据安全/网络/PWA/工程化）。本文聚焦**产品功能缺口与真实使用体验**，结论以 `[新增]` 标注新发现，与既有项重叠时标注 `[已记录 D-xx]` 并只给新角度。

---

## 一、方法与边界（先声明，避免误读）

### 1.1 这次扫描怎么做的

| 方式 | 覆盖 |
| :--- | :--- |
| **逐行深扫（5 路并行审读，覆盖全部 5 个模块）** | ①新概念课程（`NewConcept.jsx` 911 + 3 子组件 + 4 服务）；②口语对练（`OralCoach.jsx` 957 全文 + `speech.js` 481 全文）；③智能精读（`SmartReader.jsx` 1587 全文 + `studyView.js` + 阅读相关服务）；④生词 SRS（`VocabularySRS.jsx` 1453 全文 + quiz/story 相关）；⑤首次上手/今日闭环/设置/壳层（`App.jsx`/`HomeDashboard.jsx`/`Settings.jsx`/`ErrorBoundary.jsx`/`main.jsx`/`index.css`/`index.html`/`manifest.json`/`studyPlan.js` 等） |
| **我本人复核（每一项高风险结论都回查代码）** | 逐条验证了生词评分守卫、`again` 的到期语义、演示词计数链路、"稍后即收工"、`markTask` 不记事件、未转义正则、占位释义入库路径、重考种子、144 课/72 单元、首页 hero 缺 safe-area 等 |
| **反证检验（专门找误报）** | 已排除 4 条候选误报并纠正 1 条子审计结论，见 1.4 |
| **既有认知** | 本次会话早前已通读 `storage.js`(1871)、`ai.js`(757) 等核心服务 |

### 1.2 本次**没有**做的事

- **未运行应用**（无浏览器 E2E、无真机）。凡涉及播放器暂停/恢复、音频缓存命中、iOS 聚焦缩放、手势策略、视觉观感、像素尺寸的结论，均标注"未经运行验证"，或已被我**排除/纠正**（见 1.4）。
- 未实测性能。
- 未对既有 D 清单做重复计数（重叠项标注 `[已记录 D-xx]`）。

### 1.3 判断口径

- `[新增]` = 既有 D 清单里没有，本轮第一次提出。
- `[已记录 D-xx]` = 既有报告已记录；本文只在与使用流程交叉处引用，不重复计入。
- 严重度：**高** = 直接让某个学习环节失去价值或让用户天天踩到；**中** = 明显降低效率或造成困惑；**低** = 整洁度/细节。

### 1.4 我复核后**纠正/排除**的误报（重要）

| 候选结论 | 复核结果 |
| :--- | :--- |
| "答题/练习输入框字号 <16px，iOS 聚焦会放大页面" | **误报，已排除**。`src/index.css:44-46` 有全局 `input, textarea, select { font-size: 16px !important; }`；由于**带 `!important` 的早期层声明优先于后续层的普通声明**，`text-sm`(14px) 被它压过，缩放防护实际已生效。 |
| "微剧场/生成的文章没有落盘，刷新即丢" | **误报，已排除**。`VocabularySRS.jsx:277-279` 走 `saveArticle`，`SmartReader.jsx:345-357` 的 AI 生成文章同样 `saveArticle` 入库，两条都有持久化路径。 |
| "语音识别结果用户看不到就得发送" | **误报，已排除**。`OralCoach.jsx:321-322` 把识别文本写进 `inputText`，`:784` 可编辑后再发送，且 `interimResults` 期间有实时回显。 |
| "生词本里'来源'不可见" | **部分误报**。来源**可见**（`VocabularySRS.jsx:843`），但**不可点击跳转**——真正的问题是"只读死文本 + 闪卡页不显示"，见 V-06/V-23。 |
| 精读模块审计称"失败释义存进生词本后**再也改不回来**" | **纠正为"不会自动纠正，但可手工修改"**。词条编辑弹窗支持修改"中文释义"（`VocabularySRS.jsx:1271-1277` + `handleSaveEdit` → `updateWord({translation})`）。准确表述见 R-05：重新查词不会覆盖它，且因占位文案非空，用户无法用"需要释义"筛出这些词。 |

> 记录这些是为了说明：本报告的结论经过反证检验，不是"看代码猜功能"。

---

## 二、结论摘要

### 2.1 一句话结论

**这个工具的功能骨架已经相当完整（五模块闭环 + 每日计划 + SRS + 课程），当前最影响真实使用的是三类"半截闭环"**：① **复盘回不到原文**（错题/生词知道来源却跳不过去）；② **做完就丢**（测验题目与成绩、听写结果、练习错题离开页面即消失）；③ **词表不自足**（本课重点词没有释义，必须绕道生词本才有意义）。

### 2.2 优先修复清单（Top 15，按"是否让某个学习环节失去价值"排序）

> 编号与第三、四章各模块表格一一对应。全部发现（共约 **110 项**）按模块列在第三、四章；其中 🔴 高 共 **31 项**（新概念 5 / 口语 5 / 精读 6 / 生词 9 / 上手闭环 6）。

| 排序 | 编号 | 问题 | 严重度 | 定位 |
| :-- | :--- | :--- | :--- | :--- |
| 1 | **V-02** | **"遗忘/模糊"当天不回炉，但界面与既有计划都承诺了回炉** —— `again` 只是把到期日推到明天，会话内不再入队；卡片会显示"重头复习"、测验页会写"已加入**今日**待复习队伍" | 🔴 高 | `storage.js:377-382,419`、`VocabularySRS.jsx:152,326,641,1004` |
| 2 | **V-01** | **同一张卡可被重复评分**（150ms 内双击 → 同卡评两次、跳过一张、复习数虚增），因为推进 index 依赖 `setTimeout` 而守卫只判 `dueCards.length` | 🔴 高 | `VocabularySRS.jsx:142-155` |
| 3 | **Q-04** | **把任务全点"稍后"，首页就宣布"今天的学习闭环已完成"**，同屏却写 0/总 | 🔴 高 | `HomeDashboard.jsx:108,145,159` |
| 4 | **Q-05** | **手动勾"完成"不产生学习事件** → 进度条全绿与"近 7 天 0 天有学习"同屏互相打脸 | 🔴 高 | `HomeDashboard.jsx:120-124`、`storage.js:533-557` |
| 5 | **N-18** | **同一单元重考，题目与选项完全不变** → 测验沦为背答案 | 🔴 高 | `nceExam.js:7-16,37,40,48,54` |
| 6 | **R-04** | **查词的"原文语境"常取错句并写进生词本**（取第一个命中句 + 正则未转义） | 🔴 高 | `SmartReader.jsx:501-507,517,573` |
| 7 | **O-01** | **未转义正则吞掉输入**：命中判定在 `setInputText('')` 之后且在 `try` 之外，词库含 `C++`/整句即抛错 → 输入消失、零提示 | 🔴 高 | `OralCoach.jsx:157,162-164` |
| 8 | **V-03 / V-09** | **评分不可撤销且未翻卡可评**（误触"遗忘"立即写盘）；**词条只能改 3 个字段**（单词/音标只读，改错只能删了重加、连带丢 SRS 进度） | 🔴 高 | `VocabularySRS.jsx:96-100,635-659,1246` |
| 9 | **R-05 / V-24** | **AI 失败时的占位文案被当成释义写进词库**（"释义解析未成功…"/"自主添加生词"），且因非空而绕过应用自己的"需要释义"筛查；重新查词也不会自动纠正 | 🔴 高 | `SmartReader.jsx:529-537,571,1010`、`VocabularySRS.jsx:180-190` |
| 10 | **Q-01 / V-17** | **30 个演示词被当成用户自己的进度**：首屏"到期 30"+红色徽标，而设置页管它们叫"演示生词"；一评分就落盘变成真实数据 | 🔴 高 | `storage.js:277-278,1310+`、`App.jsx:32-34,208-212` |
| 11 | **Q-02 / Q-03** | **首启零引导 + 首页不提"AI 需先配 Key"**，且四个模块对缺 Key 有四种不同表现，只有口语给了"去配置"的出口 | 🔴 高 | `App.jsx:116`、`studyPlan.js:151-173`、`OralCoach.jsx:150-155`、`SmartReader.jsx:535` |
| 12 | **O-02 / O-03** | **"一键重试"把错误气泡贴回来**（并用旧闭包落盘重复句）；**用户消息只在 AI 成功后落盘** —— 在途/失败的一轮切 Tab 即永久消失 | 🔴 高 | `OralCoach.jsx:221,264-266,300-305` |
| 13 | **V-04 / Q-11** | **写入失败在 UI 层无感**：词库的评分/添加/编辑/删除全部丢弃返回值（服务层已返回 `null`）；`lastWriteError` 记录后从不展示 → 配额满时"假成功"，刷新全回退 | 🔴 高 | `VocabularySRS.jsx:96,146,192,216`、`storage.js:44-49`、`Settings.jsx:47,661` |
| 14 | **V-05 / V-08** | **AI JSON 不校验结构**（`options` 缺失 → 整页 ErrorBoundary；`correctIndex` 越界 → 答对判错并触发惩罚）；**复习队列无上限、无法选择学多少**，停学一周回来面对 200+ 张卡无出口 | 🔴 高 | `VocabularySRS.jsx:113-118,302,933-935`、`ai.js:93-131` |
| 15 | **R-01 / R-02 / R-03** | **整篇连续朗读被移除且查词会清零句位**；**文库不可检索/排序、不显示难度与进度**；**默读不计入任何学习记录、也无法"标记读完"** | 🔴 高 | `SmartReader.jsx:195,515,667-689,733`、`:223,283` |

### 2.3 我认为最该先修的三件事

1. **V-02 + V-01 + V-03（生词复习闭环的三处硬伤）** —— 这是用户每天必做的动作：说"忘了"却当天不再考、手快会重复评分、按错无法撤销。三处改动都很小（一条 requeue、一个 `isRatingRef` 守卫、一次撤销栈），但直接决定 SRS 是否可信。
2. **Q-04 + Q-05（今日闭环的自相矛盾）** —— 一个"稍后"就能骗出"今天已完成"，勾完三项又显示"0 天有学习"。这是用户对"打卡/统计"信任的来源。
3. **N-18 + R-04 + O-01（"看起来在工作但结果是错的"三类）** —— 重考同一份卷子、查词取错语境并写进生词本、未转义正则吞输入。它们不会报错，只会静默给出错误结果。

### 2.4 跨模块的同类根因（比单点修复更值钱）

把 110 项按**根因**归并后，会发现大量问题其实是同一个模式反复出现。修根因比修 110 个点更划算：

| 根因 | 出现位置（举例） | 统一解法 |
| :--- | :--- | :--- |
| **A. 未转义的用户/文本内容被拼进正则** | `OralCoach.jsx:162`（吞输入，最高危）、`SmartReader.jsx:504`（语境取错句）；而同仓 `SmartReader.jsx:~300` 的导出函数**已经**用了 `.replace(/[.*+?^${}()\|[\]\\]/g, '\\$&')` | 抽一个 `escapeRegExp()` 并全仓替换（模式已存在于代码里） |
| **B. 失败时"静默降级成看起来正常的结果"** | 查词失败 → 占位释义可入库（R-05/V-24）；口语截断 → 伪装成"这次没纠错"（O-16）；流式分块失败被忽略（D-11）；写入失败被丢弃（V-04/Q-11） | 定义统一的"降级可见"约定：降级必须留下可见标记或空值（让既有筛选器能筛出来） |
| **C. 同一业务口径存在多份实现** | 到期词 5 份（D-27）+ 计划/周报口径不一致（Q-…）；"困难词"阈值 2 处；活动/打卡口径不统一（Q-05、O-21、R-03、V-… 与 NCE 的 `type:'vocab'`） | 抽 `src/services/metrics.js` 单一口径，UI 只消费 |
| **D. 交互状态只存在内存，卸载即失** | 测验题目与成绩（V-…）、微剧场（V-12）、字号（R-17）、"已收藏"4 秒窗口（O-14）、口语在途轮次（O-03） | 统一"用户产生的内容必须落盘"原则 + 明确的会话级临时态清单 |
| **E. 卡片/弹层/图标各自实现，尺寸与语义不一致** | 15 个弹层无 dialog 语义（D-30）、底部弹层安全区只有部分实现（R-19、D-35）、图标按钮 20–26px 并存（O-17、R-20、R-21、V-19） | 抽 `Modal`/`BottomSheet`/`IconButton` 三个基础组件（这一条能一次消掉十几项） |

---

## 三、新概念课程模块（本次深扫）

> 覆盖 `NewConcept.jsx` 全 911 行 + 三个子组件 + 四个服务。以下 26 项中，标注「已复核」的是我本人逐行确认过的；其余来自该模块的完整通读，行号已给出可自行核对。

### 3.1 功能缺口

| # | 问题 | severity | 证据 |
| :-- | :--- | :--- | :--- |
| N-01 | 本课词表只有"出现次数 + 例句"，无释义/音标/词性；收录进 SRS 时 `translation: ''` | 高 | `nce.js:139-144`、`NewConcept.jsx:617-618,889` **已复核** |
| N-02 | 掌握度公式不可见，测验占 1/5 权重 | 高 | `nceMastery.js:1-7`、`NewConcept.jsx:903` |
| N-03 | 掌握度均值分母含未学单元 | 中 | `NewConcept.jsx:182-184,747` |
| N-04 | 不做任何一步即可"标记完成"，完成后无"下一步"引导 | 中 | `NewConcept.jsx:557-564,904` |
| N-05 | 错题不存 `lineId`/完整原句，复盘只能整课跳转；听写错题原句为空 | 高 | `NewConcept.jsx:515-524`、`NceReview.jsx:27,93` **已复核** |
| N-06 | 本课笔记只能开着课文看，无总览/检索/导出 | 中 | `NewConcept.jsx:583,833` |
| N-07 | 无单课导出/打印（只有全量 JSON 备份） | 低 | `storage.js:869-903` |

### 3.2 体验摩擦

| # | 问题 | severity | 证据 |
| :-- | :--- | :--- | :--- |
| N-08 | "继续上次学习"第二次点击静默失效 | 高 | `NewConcept.jsx:313`、`App.jsx:74` |
| N-09 | 播速档位缺 0.5×（仅 0.75/1/1.25/1.5），零基础最需要的慢速跟读受限；只有"当前句 ×3" | 中 | `NewConcept.jsx:35,850,852` |
| N-10 | 课程地图只给一个百分比，看不出卡在哪一步；`audioPosition` 每 5 秒落盘却从不展示，"打开过 1 秒"与"听到第 30 句"无法区分 | 中 | `NewConcept.jsx:280-282,686-689,807` |
| N-11 | 听写/练习被 `slice(0,limit)` 截断但 UI 不说明，也无"换一批" | 中 | `nce.js:90,105`、`NewConcept.jsx:841-842` |
| N-12 | 笔记必须手动保存；切课会静默丢草稿并强制关闭笔记面板 | 中 | `NewConcept.jsx:271-272,838,907` |
| N-13 | 听写刻意不显示英文，判分后缺少"你差在哪个词"的词级对照 | 中 | `NewConcept.jsx:239-252`、`NceDictation.jsx:93,108` |
| N-14 | 练习结果页无逐题回看（试题有 `ANSWER REVIEW`，练习没有）；"历史最佳"更新规则不透明 | 中 | `NewConcept.jsx:547,896` 对比 `NceExam.jsx:186-188` |

### 3.3 音频与离线

| # | 问题 | severity | 证据 |
| :-- | :--- | :--- | :--- |
| N-15 | 缓存每课手动、失败无原因、无已缓存清单、无批量 | 中 | `NewConcept.jsx:418-430,852`、`offline.js:7-14`、`Settings.jsx:661` |
| N-16 | 缓存下载无超时/取消（课文与组卷都有 12s 超时） | 中 | `offline.js:9` vs `NewConcept.jsx:255-258`、`NceExam.jsx:79-82` |
| N-17 | 切标签即停止播放，无"后台继续"，返回也无"已暂停在第 x 句"提示 | 低 | `NewConcept.jsx:157-163`、`App.jsx:121`（未经运行验证） |

### 3.4 测验与反馈质量

| # | 问题 | severity | 证据 |
| :-- | :--- | :--- | :--- |
| N-18 | **重考同单元题目与选项完全不变**（确定性洗牌，种子无 attempt 盐） | 高 | `nceExam.js:7-16,37,40,48,54` **已复核** |
| N-19 | 判分不解释错因；归一化去掉所有非字母数字 → `don't` 写成 `dont` 判对（拼写题过度宽容） | 中 | `nceExam.js:18-21,85`、`NceExam.jsx:188` |
| N-20 | 过期草稿一进去就自动交卷 | 中 | `NceExam.jsx:18,57-63` |
| N-21 | `saveError` 提示只在答题页分支渲染，而"自动保存"文案也在答题页 | 中 | `NceExam.jsx:149,173` |
| N-22 | 听写/复盘判分口径分散且不一致（"标点大小写不扣分" vs "相似度 90% 即过" vs 编辑距离） | 低 | `NceDictation.jsx:113`、`NceReview.jsx:95`、`nce.js:78` |

### 3.5 移动端

| # | 问题 | severity | 证据 |
| :-- | :--- | :--- | :--- |
| N-23 | 听写框禁用后无法回车提交，判分与翻页需两次点击（高频重复 8 次）；可复用已修好的 `onEnterSubmit` | 中 | `NceDictation.jsx:98,103,110`、`keyboard.js:15-34` |
| N-24 | 72 项扁平长列表 + "144 课/72 单元"计数混用 | 低 | `NewConcept.jsx:780-781` **已复核** |
| N-25 | 词表单词被 `toLowerCase()`，"Excuse"显示为"excuse"；仅按频率排序，无"按课文顺序" | 低 | `nce.js:137,149` |

> 已排除项：该模块审计曾提出"输入框 <16px 导致 iOS 缩放"，经复核为**误报**（见 1.4）。

---

## 四、各模块发现（均已完成逐行深扫）

> 这些模块本轮**未逐行深扫**，以下均为我按具体功能疑问查证过的结论，缺失能力以"全仓命中 0"或"无对应 prop"作为证据。

### 4.1 生词 SRS（本轮已逐行深扫 `VocabularySRS.jsx` 1453 行 + 相关服务）

| # | 问题 | severity | 证据 |
| :-- | :--- | :--- | :--- |
| V-01 | **同一张卡可以重复评分，双击还会跳掉下一张**：`handleRateCard` 唯一守卫是 `if (dueCards.length === 0) return`，而 index 要等 150ms 的 `setTimeout` 才推进 → 150ms 内的第二次点击会对**同一张卡**再评一次（`reviewCount` 与 `step` 各 +2，good 两连击把 1 天推到 3 天），并少复习一张 | 🔴 高 | `VocabularySRS.jsx:142-155` **已复核**；`storage.js:399,417` |
| V-02 | **"遗忘/模糊"当天不回炉，但界面承诺了回炉**：`again` 把间隔设为 1 天 → 到期在**明天**，本次会话不会重新入队；而界面写着"重头复习"与"已自动重置加入**今日**待复习闪卡队伍"（测验错题走同一分支）。既有 `P0_P1_IMPROVEMENT_PLAN.md` 任务 3 也承诺"自动加回当天的待复习闪卡队伍" | 🔴 高 | `storage.js:377-382,419`、`VocabularySRS.jsx:152,326,641,1004` **已复核** |
| V-03 | **三档评分不可撤销，且未翻卡就能评**：三个按钮始终可点（无 `disabled`、不读 `isFlipped`），误触"遗忘"立刻写盘（step 归零、ease-0.2、间隔回 1 天）且无回退 | 🔴 高 | `VocabularySRS.jsx:635-659,509-511` **已复核** |
| V-04 | **词库模块所有写入失败都无感**：评分/添加/编辑/删除全部丢弃返回值（服务层已分别返回 `null`）；对照正确写法 `NewConcept.jsx:626-630` 有 `if (!saved) setWordSaveError(...)` —— 我此前的 D-05 修复只接到了设置页 | 🔴 高 | `VocabularySRS.jsx:96,146,192,216`、`storage.js:348,431,441,647` **已复核（自我审查）** |
| V-05 | **AI 返回的 JSON 只校验"能否 parse"，不校验结构**：`options` 缺失 → `q.options.map` 抛错 → ErrorBoundary 整页"这个页面刚刚卡住了"；`correctIndex` 越界 → 答对也判错并触发 'again' 惩罚；`id` 缺失/重复 → 得分卡永不出现（判分条件是"已答键数 === 题目数"） | 🔴 高 | `ai.js:93-131,636`、`VocabularySRS.jsx:302,311-316,332,933-935`；故事侧 `:267,1181` |
| V-06 | **来源只读不可跳转，闪卡页也不显示来源**：`来源 · {label}` 是纯 span；`VocabularySRS` 是**无 props** 组件（对比 `App.jsx:118` 给口语页传了 `onNavigateToVocab`），写入端却存了可跳转的 id | 高 | `VocabularySRS.jsx:45,843`、`App.jsx:122` **已复核** |
| V-07 | **全站看不到"下次复习日期"**：列表只有"复习次数/间隔 N 天"、卡背只有"遗忘难度系数/下次间隔"，`nextReviewDate` 从不渲染 —— 用户无法回答"什么时候再考我"，也无法理解 easeFactor | 高 | `VocabularySRS.jsx:113,628,833,837`、`App.jsx:33` |
| V-08 | **无法选择学多少、无提前学、无积压保护**：`:113` 全量入队无上限（唯一抽样是"今天没到期词"时随机 8 个）—— 停学一周回来面对 200+ 张卡没有任何出口 | 高 | `VocabularySRS.jsx:113-118` |
| V-09 | **词条只能改 3 个字段**：只提交 translation/contextSentence/userNote，"目标生词（只读）"—— AI 给错音标/词性、或拼写打错，都只能删除重加（连带丢掉 SRS 进度、来源与笔记） | 高 | `VocabularySRS.jsx:96-100,1246` **已复核** |
| V-10 | **微剧场只从最近 10 个词里选**：`vocabulary.slice(0, 10)`，默认再 `slice(0, 4)` —— 最难、最旧的词不在候选，"把背不会的单词编进故事"落空 | 中 | `VocabularySRS.jsx:224,1107` |
| V-11 | **"换一批题目"先清成绩、失败不回滚**：`setQuizScore(null)` 在 `await` 之前，失败分支只弹 alert | 中 | `VocabularySRS.jsx:294-304` |
| V-12 | **生成内容不持久化 + 可能重复入库**：story/quiz 只是 state；开窗即清空、"换个题材重写"直接覆盖；"存入精读"不带 id，而 `saveArticle` 无 id 就新建 → 手抖两次堆重复文章 | 中 | `VocabularySRS.jsx:65,75,226-227,245,1210-1216`、`storage.js:692` |
| V-13 | **错题反哺可能静默失效却宣告成功**：`if (found)` 没有 else，匹配用大小写严格相等；界面无条件写"错题反哺已生效" | 中 | `VocabularySRS.jsx:319-329,997-1006` |
| V-14 | **评分后 150ms 零反馈**（先 `setIsFlipped(false)` 再等 150ms 才换卡），进度条首张卡就显示 1/N —— 用户怀疑没点上而重复点，正好放大 V-01 | 中 | `VocabularySRS.jsx:150-155,498` |
| V-15 | **进度/到期数/结算三者互相矛盾**：头部"N 词 · M 到期"，但"没有到期词"时的随机强化 8 个词也被称作"到期词"；结算固定写"下一次复习将在明天到来"，而 good 连击实际是 3~8 天后 | 中 | `VocabularySRS.jsx:380,382,675`、`storage.js:399-407` |
| V-16 | **无批量操作、标签不可点筛选、无词表导入导出**：行内只有单个编辑/删除，标签是死文本，导出只有全量备份 | 中 | `VocabularySRS.jsx:831,851-866`、`Settings.jsx:143` |
| V-17 | **30 个演示词无任何标识**，且"一评分就落盘"变成用户自己的数据；标签还写成拟真的 `['高频词','精读摘录']` | 中 | `storage.js:277-278,1313`、`VocabularySRS.jsx`（无 sample 判断） |
| V-18 | **发音失败完全静默**：`tts.speak` 返回值被丢弃（底层只 `console.warn` 或静默回退）；例句没有朗读入口（只能读单词） | 中 | `VocabularySRS.jsx:519-528,573-581,602-613,808-813`、`speech.js:252-263` |
| V-19 | **列表行编辑/删除 26px 竖排相邻**；确认文案也没说明会丢 SRS 进度/来源/笔记 | 中 | `VocabularySRS.jsx:215,851-866` |
| V-20 | **添加/编辑弹层无 `max-h`/`overflow`**（同文件故事弹层有 `max-h-[90vh] overflow-y-auto`），叠加全局 `position:fixed` 与 16px 强制字号，键盘弹起时"保存修改"可能不可达 | 中 | `VocabularySRS.jsx:1227,1329` vs `:1044`、`index.css:16-25`（未经真机验证） |
| V-21 | **词库清单全量渲染，无分页/虚拟化** | 中 | `VocabularySRS.jsx:791-869` |
| V-22 | **手动加词无法键盘提交、无自动聚焦、无成功/重复提示**；遮罩点击即关 | 低 | `VocabularySRS.jsx:203-206,1328,1339-1345` |
| V-23 | 词条的"来源"在**闪卡页不显示**（只在列表显示），复习时看不到语境出处 | 低 | `VocabularySRS.jsx:843` 仅列表分支 |
| V-24 | **手动加词在 AI 失败时写入占位释义** `'自主添加生词'`：文案非空 → 绕过应用自己的「需要释义」筛选（`studyView.js:22` 判空），用户看到一张"看起来完整、其实没有释义"的卡片（与精读 R-05 同源） | 高 | `VocabularySRS.jsx:180-190` **已复核** |

> **收敛证据（两名独立审读得出同一结论）**："30 个演示词被当成用户自己的进度/积累"由生词模块与上手模块**分别独立**提出（V-17 / Q-01）——两份报告都指向 `storage.js` 的 `copySampleWords()` 与种子数据的 `nextReviewDate: Date.now()`，可信度高。

### 4.2 口语对练（本轮已逐行深扫 `OralCoach.jsx` 957 行 + `speech.js` 481 行）

| # | 问题 | severity | 证据 |
| :-- | :--- | :--- | :--- |
| O-01 | **生词命中判定用未转义的用户词构造正则，抛错时输入被静默吞掉**：`hitWords` 过滤在 `setInputText('')` **之后**、且位于 `try` **之外**；`addWord` 会把整句 `betterAlternative` 当词存，句中出现 `(`/`[`/`C++` 即 `new RegExp` 抛错 → async 函数 reject，输入已清空、零提示、零恢复 | 🔴 高 | `OralCoach.jsx:157,162-164` **已复核**；上游 `OralCoach.jsx:388-395`、`ai.js:518` |
| O-02 | **"一键重试此句"会把错误气泡重新贴回来**：`setMessages(filter...)` 后调用同一渲染闭包里的 `handleSendMessage`，其 `[...messages, userMsg]` 仍含 errorMsg 与失败气泡，落盘后重复句永久留在历史 | 🔴 高 | `OralCoach.jsx:221,224,264,266,300-305`（未经运行验证） |
| O-03 | **用户消息只在 AI 成功后落盘**：在途/失败的一轮，切 Tab 或切情景即永久消失（`saveChatMessages` 只在这一条路径），且失败回合的"重试/填回输入框"入口随卸载消失 | 🔴 高 | `OralCoach.jsx:266,290-292`、`App.jsx:114-119` |
| O-04 | **语音输入不能核验也不能回听**：识别结果无条件覆盖输入框（吞掉已打的半句），转写直接触发发送无确认；无任何真实录音能力（`MediaRecorder`/`getUserMedia`/`audioBlob` 命中 0） | 高 | `OralCoach.jsx:322,753-756`、`speech.js:391-399`、全仓 grep 命中 0 **已复核** |
| O-05 | **纠错面板是"文本孤岛"**：`corrected`/`betterAlternative` 只能看不能听、不能跟读；面板唯一操作是"存入生词本"；纠错只随消息流存在，清空对话即清零 | 高 | `OralCoach.jsx:573,615,646-676`、`storage.js:656` |
| O-06 | **没有"停止生成"入口**：`AbortSignal` 已打通（D-04）但 UI 无取消按钮，`isLoading` 期间只禁用发送；切 Tab 虽会中断但会连带丢整轮 | 中 | `OralCoach.jsx:229-231,800`、`:119,125` |
| O-07 | **已发送消息不可编辑/删除/重录**：用户气泡只渲染文本，辅助控件被 `!isUser` 排除；说错只能再发一条，AI 上下文里错句与正确句并存 | 中 | `OralCoach.jsx:503-534,547-555,569` **已复核** |
| O-08 | **无法调整 AI 难度**，也**不能在对话内调语速**：`getOralCoachResponseStream` 入参无 level；`tts.speak(text)` 未传 options，读全局 `voiceRate`，写入口只在设置页（需"生词→设置→找滑块→返回"≥3 次点击） | 中 | `ai.js:486-493,504-505`、`OralCoach.jsx:354`、`speech.js:282`、`Settings.jsx:581-615` |
| O-09 | **通缉目标不可挑选、不可跨会话保留；情景无任何进度**：每次随机抽 3 词、切情景即换人；情景 pill 无轮次/纠错数；`loadScenarioMessages` 能读历史却不用于任何提示 | 中 | `OralCoach.jsx:55-59,94,128,437-453`（有偏打乱见 D-34） |
| O-10 | **把整句当"生词"存**：`betterAlternative` 整句进入 `word`，于是整句进入通缉池、目标 pill 与 `tts.speak` 都以整句为单位 | 中 | `OralCoach.jsx:388-395,467-477`、`ai.js:518` |
| O-11 | **流式期间滚动被强行拽到底**：effect 依赖 `[messages, isLoading]`，每个 chunk 都 setMessages → 数秒内反复 smooth 滚动，无法对照上一条纠错，也没有"回到最新"按钮 | 中 | `OralCoach.jsx:111-113,241-248` |
| O-12 | **命中奖励先于评价**：请求发出前就弹彩带、`updateWordSRS(found.id,'good')`、记 3 分钟学习时长；把生词**用错**（同一屏的纠错面板正要指出）也照样升级 | 中 | `OralCoach.jsx:166-172,183-198,267` |
| O-13 | **快捷回复药丸不消失、无"已用"状态**：药丸随 `finalMessages` 落盘，重开历史里每轮药丸都在，易误点十轮前的建议；加载中点它被 `if (isLoading) return` 静默吞掉 | 中 | `OralCoach.jsx:148,259,693-705` |
| O-14 | **收藏后的"去生词本 →"只有 4 秒窗口**：state 仅内存、卸载即重置，超时或切 Tab 后按钮变回"存入生词本"，用户无法确认是否已存 | 中 | `OralCoach.jsx:396-399,677-685`、`App.jsx:117-119` |
| O-15 | **麦克风报错的原因与指引都指错**：`network`（离线）/`audio-capture`（无麦）都归入"浏览器不支持"；权限指引只写 iPhone Safari，Android/微信内用户按步骤找不到菜单；`stop()` 后立刻重启可能撞 `InvalidStateError` 同样归入"不支持" | 中 | `OralCoach.jsx:319,330-338,469-478,826-847`（D-18 在语音侧的新表现） |
| O-16 | **截断/不吐 JSON 时静默降级为"一条更短的正常回复"**：无"可能不完整"标记，中文译文按钮与纠错面板都不出现，用户以为"这次没纠错"；换不兼容接口后只会反复重试同样报错 | 中 | `ai.js:255,552-565`、`OralCoach.jsx:593,615`（区别于 D-11 的分块解析失败） |
| O-17 | **输入区人体工学**：单行 `textarea` 无随内容增高（`max-h-24` 形同虚设），长句只能左右看；朗读/看中文按钮约 22px 且相邻 4px、药丸同尺寸、"换一批"约 20px 且手机上只剩无文字图标 | 中 | `OralCoach.jsx:481-488,573-601,693-699,766-777,781-793` |
| O-18 | **自动朗读在 `await` 之后触发**，可能被浏览器手势策略拦下且失败全被吞（云端与本地 TTS 的 catch 都只 `console.warn` 或静默回退） | 中 | `OralCoach.jsx:270-273`、`speech.js:202,291-294,308-311`、`storage.js:164`（未经真机验证） |
| O-19 | **自动朗读与录音可能重叠；录音中切情景不停麦**：麦克风按钮无 `disabled`，识别会把外教声音一并拾取；`handleSelectScenario` 没有 `stt.stop()`，`isRecording` 保持 true，后续识别落到新情景输入框 | 中 | `OralCoach.jsx:124-133,764-777,800`、`speech.js:396` |
| O-20 | 未配置 Key 时要多点一次发送：保存 Key 后不自动补发，也未提示"内容已留存" | 低 | `OralCoach.jsx:152-155,933-946` |
| O-21 | 存词不计入当日活动（同 V-05） | 中 | `OralCoach.jsx:394` 附近无 `recordStudyActivity` **已复核** |
| O-22 | 没有复制能力：`navigator.clipboard` 在 `OralCoach.jsx`/`SmartReader.jsx` 命中 **0**，AI 给的"外教级表达"无法一键带走 | 中 | 全仓 grep 命中 0 **已复核** |

### 4.3 智能精读（本轮已逐行深扫 `SmartReader.jsx` 1587 行 + 相关服务）

| # | 问题 | severity | 证据 |
| :-- | :--- | :--- | :--- |
| R-01 | **整篇连续朗读被移除，且查词会把句位清零**：`9e46e41` 删掉了 `startArticleSpeech`/页头播放条，现仅剩每段按钮；查词走 `stopParagraphSpeech()` → `if (resetProgress) setParagraphSpeechIndex(0)`，听到一半点词查义即从本段第 1 句重听 | 🔴 高 | `SmartReader.jsx:733`、`:515`、`:195`；`git show 9e46e41` |
| R-02 | **文库不可检索/排序，也不显示难度、阅读进度、已读状态**：只有一条横滑芯片，标题是唯一信息（`max-w-[155px] truncate`）；而同类能力生词页已有（`filterVocabulary`） | 🔴 高 | `SmartReader.jsx:667-689` vs `VocabularySRS.jsx:369`、`studyView.js:9` |
| R-03 | **正常默读不计入任何学习记录，也无法"标记读完"**：全组件只上报"段落朗读"与"收藏句子"两类事件；今日任务完成只认手动勾选 | 🔴 高 | `SmartReader.jsx:223,283`、`studyPlan.js:186`、`HomeDashboard.jsx:121` |
| R-04 | **查词的"原文语境"常取错句，而且会存进生词本**：`findEnclosingSentence` 传整篇正文并取**第一个**命中句；该句匹配用的正则**未转义**（token `e.g` → `\be.g\b` 会匹配 "egg"）；错误语境随后被写入 `contextSentence` | 🔴 高 | `SmartReader.jsx:501-507,517,573` **已复核（未转义正则与 O-01 同一根因）** |
| R-05 | **失败释义会被存成词条释义**：占位文案 `'释义解析未成功（可能是网络波动或未配置 API Key）'` 在 `isError` 状态下仍可保存（按钮 `disabled` 不判 `isError`），因非空而绕过"需要释义"筛查 | 🔴 高 | `SmartReader.jsx:529-537,571,1010` **已复核** |
| R-06 | **网址抓取无超时/无取消**：第三方 `r.jina.ai` 挂起时永久"正在提取..."，只能关弹层逃生，URL 与已抓内容都不保留（对比 AI 请求已有 60s 超时） | 🔴 高 | `SmartReader.jsx:429-431,1223-1226`、`ai.js:8,338`（未经弱网验证） |
| R-07 | **无法查词组/短语，正文也不可选中**：按空白切词后只清洗单 token；正文容器无 `allow-select` 且全局 `select-none`；多词词条永远无法高亮（而 AI 提示词本身允许词组） | 中高 | `SmartReader.jsx:512,774,796,700,791`、`index.css:35`、`ai.js:385` |
| R-08 | **查词结果不缓存、无历史**：每次点击都发新请求，结果只在 state；同篇重复遇到同词仍要等 AI，没存的词彻底消失 | 中 | `SmartReader.jsx:519,527,567` |
| R-09 | **文章导入后不可编辑**：`saveArticle` 支持按 id 覆盖，但两处调用都是新建；改错字只能删掉重导，而删除会连批注与阅读位置一起清空 | 中 | `storage.js:686-690,698-708`、`SmartReader.jsx:357,474` |
| R-10 | **笔记导出只覆盖当前篇且内容不全，笔记项无法回到原文**：导出仅含"划线与批注 + 本篇生词"，不含正文/难度；手记项只有编辑/删除，点了不滚动到正文句子 | 中 | `SmartReader.jsx:297-318,1427-1443` |
| R-11 | **段落翻译的"翻译中"是一个全局下标，跨段互相清掉**：任一请求的 `finally` 无条件清空，A 段未返回时点 B 段会让 A 的按钮恢复可点（可重复发请求） | 中 | `SmartReader.jsx:112,410-412,722,835` |
| R-12 | **在途的"AI 生成新外刊"会抢走正在读的文章**：生成期间只禁用生成按钮，遮罩可关但请求继续，返回后无条件 `selectArticle(updated[0])`；进行中的批注可能记到另一篇名下 | 中 | `SmartReader.jsx:274-275,357-360,1471,1504,1566` |
| R-13 | **切换文章是"先回顶、再跳回"的双段滚动**：`selectArticle` 的 `scrollToTop` 是死参数（4 个调用点都不传），随后 100ms 又滚到 `savedTop`（无越界校验），过程无任何提示 | 中 | `SmartReader.jsx:167-178,149-157` |
| R-14 | **保存生词后词卡 1.1 秒无条件关闭**：定时器不与该词绑定、也不清理；手速快时新词卡会被上一个定时器关掉 | 中 | `SmartReader.jsx:579-582`（未经运行验证触发概率） |
| R-15 | **语音不可用时"整段朗读"只是置灰，原因藏在 tooltip**（触屏不显示）；`alert` 兜底分支实际不可达 | 中 | `SmartReader.jsx:201-204,734,740` |
| R-16 | **难度与题材的能力可达性不一致**：AI 服务题材表有 5 项，生成弹层网格只有 4 项（`psychology` 在 UI 点不到）；文库芯片不展示难度 | 低 | `SmartReader.jsx:1258-1261,1521-1526`、`ai.js:725` |
| R-17 | **字号不持久化**：离开精读页即回中号（组件随 tab 卸载），也没有行距/更大档位 | 低 | `SmartReader.jsx:90,642-658`、`App.jsx:120` |
| R-18 | **"融入我的生词本单词"开关与真实行为不符**：文案承诺"在正文中自动标黄"，但开关只进提示词，标黄是无条件的 | 低 | `SmartReader.jsx:337,791,1551-1553` |
| R-19 | **词卡/句卡底部弹层无安全区底部内边距且用 85vh**（同文件批注弹层有正确写法可参照） | 中 | `SmartReader.jsx:878-879` vs `:1302-1306`（`vh` 部分见 D-35，安全区缺失为新增） |
| R-20 | **句末两个无标签小图标 + 逐词点击区过小**：每句末尾连着两个约 14px 按钮（仅 `title`），点错词会真的发 AI 请求并朗读 | 中 | `SmartReader.jsx:797,812-820,524`（像素未经真机测量） |
| R-21 | **文库芯片删除按钮仅 12px 且紧贴标题按钮**，横滑找文章极易误点；确认后会连批注与阅读位置一起清空且无撤销 | 中 | `SmartReader.jsx:675-684,489`、`storage.js:698-708` |
| R-22 | **抓取/生成中断后的残留与文案错位**：取消不清空草稿、抓取不记 `sourceUrl`；空库文案与"AI 外刊生成"按钮名称都和实际按钮不一致 | 低 | `SmartReader.jsx:452-453,468-479,871,323,1577` |

> **更正一条子审计结论**：该模块审计提出"失败释义存进生词本后**再也改不回来**"。经我复核，**不成立** —— 词条编辑弹窗可修改"中文释义"（`VocabularySRS.jsx:1271-1277`，`handleSaveEdit` → `updateWord({translation})`）。准确表述是：**重新查词不会自动纠正它，需要用户自己去编辑**（且因为占位文案非空，用户无法用"需要释义"筛出这些词）。

### 4.4 首次上手 / 今日闭环 / 设置 / 壳层（本轮已逐行深扫）

| # | 问题 | severity | 证据 |
| :-- | :--- | :--- | :--- |
| Q-01 | **首装即背上 30 个"到期词"，演示数据被当成用户自己的进度**：`getVocabulary()` 在无键时返回演示词副本（不落盘、不留标记），30 条种子词的 `nextReviewDate` 都是 `Date.now()` → 首屏"今日到期词 30"、底部红色脉冲徽标 30、计划卡"复习 12 个到期词"；而设置页自己管它们叫"30 个演示生词"，首页零标识 | 🔴 高 | `storage.js:277-278,1310+`、`App.jsx:32-34,208-212`、`HomeDashboard.jsx:148,205`、`studyPlan.js:111`、`Settings.jsx:802` **已复核** |
| Q-02 | **首启零引导，首页完全不提"AI 需要先配 Key"，而第一条计划就是 AI 任务**：无首启分支；设置页把 Key 说成"按需连接"；计划恒生成"口语练习 N 轮"与精读任务 | 🔴 高 | `App.jsx:116`、`Settings.jsx:240`、`studyPlan.js:151-173` |
| Q-03 | **无 Key 时四种不同行为，只有一种给了"去配置"的出口**：①口语主动拦截+快速配置弹窗；②设置页内联提示；③精读 `alert` 或静默降级卡片；④生词 `alert`。设置入口只有首页右上角一个 36px 齿轮；③还把"缺 Key"说成"可能是网络波动"，误导排查 | 🔴 高 | `OralCoach.jsx:150-155,727-743`、`Settings.jsx:110-117`、`SmartReader.jsx:368,535`、`VocabularySRS.jsx:253,304`、`ai.js:151` |
| Q-04 | **把任务全点"稍后"，首页就宣布"今天的学习闭环已完成"**：`remainingTasks` 只排除 done 与 deferred，而同屏进度条仍写 0/总、被推迟项仍列在下面 → 用户会把"稍后"理解成"已完成" | 🔴 高 | `HomeDashboard.jsx:108,145,156,159,162` **已复核** |
| Q-05 | **手动勾"完成"不产生学习事件，进度条与"近 7 天/连续天数"同屏互相打脸**：`markTask` 只写计划状态，不调 `recordStudyActivity`；而周数据与连续天数都来自事件流 | 🔴 高 | `HomeDashboard.jsx:120-124`、`storage.js:533-557,594-638` **已复核** |
| Q-06 | **计划恒有一条课程任务，不用新概念的用户永远无法收工**：`else` 分支无条件 push `nce-lesson`，完成条件依赖 `todayCourseCount > 0`，而整页文案由 `remainingTasks` 决定 → "今天的学习闭环已完成"永不出现 | 🔴 高 | `studyPlan.js:138-150,190`、`HomeDashboard.jsx:145` |
| Q-07 | **计划算出的"下一步课"没传给模块，断点用的是另一份状态**：`openTask` 丢掉 `task.entityId`，`App.jsx` 改读 `lastNceLesson`（打开课程时就写入）→ 卡片写"继续：某一课"，点进去可能是另一课 | 🟠 中 | `studyPlan.js:101,147`、`HomeDashboard.jsx:132`、`App.jsx:74`、`NewConcept.jsx:283` |
| Q-08 | **导航不写 history：Android 返回键直接退出应用；设置页在底栏无归属标签**（`VALID_TABS` 含 `settings` 但只有 5 个按钮，在设置页时全部非选中态） | 🟠 中 | `App.jsx:19,71-79,133-217`（退出行为未经真机验证） |
| Q-09 | **首页快照只在挂载时读一次**：跨零点、跨标签页、导入后都不刷新；`nextDayRefreshAt` 全仓无消费者；无 `storage`/`visibilitychange` 监听；补救入口是页面最底部一行 11px 下划线文字 | 🟠 中 | `HomeDashboard.jsx:85,89-99,207`、`App.jsx:86-89`、`studyPlan.js:205` |
| Q-10 | **"测试连接"结果不随配置失效**：改完 Key 或换服务商都不重置 `testStatus`，绿框"测试成功！"会一直挂在那里 → 用户以为新 Key 已验证 | 🟠 中 | `Settings.jsx:37,73-79,95-107,397-412` |
| Q-11 | **写入失败已被记录却从不展示**：`lastWriteError` 进了 diagnostics，但设置页只读体积/条数；`getLastWriteError` 全仓只有 storage.js 自己调用 → 高频写入失败时界面无提示（D-05 的"持久提示"未落实） | 🟠 中 | `storage.js:44-49,265,581`、`Settings.jsx:47,661` `[已记录 D-05 的新角度]` |
| Q-12 | **"恢复官方初始演示数据"语义含混**：只重置词库+文章，不动口语记录/课程进度/打卡；弹窗不列"将重置 X / 将保留 Y"，也不强制先备份，且不可撤销 | 🟠 中 | `Settings.jsx:211-217,801-807` |
| Q-13 | **导出没有任何完成确认，也无"上次备份"提醒；备份说明还漏了口语对话记录**（实际导出含 `chatMessages` 等） | 🟠 中 | `Settings.jsx:142-152,628-630`、`storage.js:894` |
| Q-14 | **离线横幅宣称"本地文章、闪卡与笔记完整可用"却不提 AI 全不可用，而计划里的 AI 任务照常显示** | 🟠 中 | `App.jsx:101-105`、`HomeDashboard.jsx:151-173` `[已记录 D-18 的新角度]` |
| Q-15 | **ErrorBoundary 只有"重新加载"**：根边界崩溃（错误可复现）会把用户锁在重载循环里，且无法在重载前导出/清理数据自救，也不展示错误摘要 | 🟠 中 | `ErrorBoundary.jsx:19-27`、`main.jsx:10-15` |
| Q-16 | **首页 hero 缺 safe-area 顶部适配**（其他页用 `StudyHeader` 的 `env(safe-area-inset-top)`），全屏运行时标题与右上角设置齿轮（进设置的唯一入口）可能被状态栏/灵动岛覆盖 | 🟠 中 | `HomeDashboard.jsx:137` vs `StudyHeader.jsx:5`、`index.html:5`（未经真机验证） |
| Q-17 | **"禁止缩放"与 9–10px 文案并存**：周历星期 9px、底栏标签/计划副标题 10px，同时 `user-scalable=no` → 视力不佳用户无法放大 | 🟠 中 | `index.html:5`、`HomeDashboard.jsx:188`、`App.jsx:145,159,174,189,214` `[已记录 D-19 的组合角度]` |
| Q-18 | **口语页"一键开启"弹窗写死 DeepSeek，且只写 `apiKey` 不写 provider/baseUrl/model，保存后即宣布"配置成功"**：若此前选过 OpenAI/Kimi，会把 DeepSeek 的 key 发往别的 baseUrl → 401，界面刚恭喜过用户 | 🟠 中 | `OralCoach.jsx:903,909,920,940-945` vs `Settings.jsx:95-107` |
| Q-19 | **安装引导不判断"已安装"，Android 也没有应用内安装按钮**（`display-mode`/`beforeinstallprompt` 命中 0） | 🟡 低 | `Settings.jsx:255-275,845-868` |
| Q-20 | **设置页诊断数字是"整站 localStorage 体积"，且没有按数据的删除出口**：用户无法删除口语记录/学习事件来腾空间或保护隐私，而它们会全量写进备份 | 🟡 低 | `storage.js:559-567`、`Settings.jsx:154-167,211,661` |
| Q-21 | **完成一天没有任何可感知的庆祝，且 `plan.totalCount === 0` 的空状态是死代码** | 🟡 低 | `HomeDashboard.jsx:145,156,168`、`studyPlan.js:138-150,177-182` |
| Q-22 | **首屏与启动阶段没有任何占位内容**：`#root` 为空，`PageFallback` 只在 `Suspense` 内且首页是静态导入 → 冷启动到 JS 执行前是一片纯色空页 | 🟡 低 | `index.html:29`、`App.jsx:9,21-28`（未经运行验证） |

---

## 五、覆盖度声明与后续

### 5.1 覆盖度

| 模块 | 本轮覆盖 | 发现数 | 说明 |
| :--- | :--- | ---: | :--- |
| 新概念课程 | ✅ 逐行深扫（`NewConcept.jsx` 911 + 3 子组件 + 4 服务） | 26 | 含 4 项我本人复核 + 1 项误报排除 |
| 口语对练 | ✅ 逐行深扫（`OralCoach.jsx` 957 全文 + `speech.js` 481 全文） | 22 | 含 1 项我本人复核（未转义正则） |
| 智能精读 | ✅ 逐行深扫（`SmartReader.jsx` 1587 全文 + 阅读相关服务） | 22 | 含 2 项我本人复核 + 1 项子审计结论纠正 |
| 生词 SRS | ✅ 逐行深扫（`VocabularySRS.jsx` 1453 全文 + quiz/story） | 23 | 含 3 项我本人复核 |
| 首次上手/今日闭环/设置/壳层 | ✅ 逐行深扫（`App.jsx`/`HomeDashboard.jsx`/`Settings.jsx`/`ErrorBoundary.jsx`/`main.jsx`/`index.css`/`index.html`/`manifest.json`/`studyPlan.js` 等） | 22 | 含 6 项我本人复核 + 1 项误报排除 |
| **合计** | 5/5 模块 | **约 115 项**（去重后），其中 🔴 高 31 项 | 5 路并行审读 + 我逐项复核高风险结论 |

**仍未覆盖的**：
- **真机/浏览器验证**：所有"未经运行验证"标记的条目（音频手势策略、滚动行为、iOS 缩放/安全区、播放器暂停恢复、误触概率、性能）都需要一次真机走查才能定案。
- **其他分支的对比**：仓库存在 `origin/legacy-backup` 分支，本轮未评估其内容是否有值得回收的能力（例如 R-01 疑似的"整篇朗读"在旧版本里存在，`9e46e41` 后被移除）。

### 5.2 建议的推进顺序

**第一批（让环节重新有效，改动都很小）**
1. **V-02** `again`/错题在当前会话内 requeue + 改掉两处过度承诺的文案。
2. **V-01** 加 `isRatingRef` 守卫（一个 ref），杜绝同卡重复评分。
3. **V-03** 未翻面禁用三档按钮 + 3~5 秒撤销。
4. **Q-04** 文案区分 done/deferred；**Q-05** `markTask` 补记学习事件（或明确"不计入统计"）。
5. **N-18** 试卷种子加 attempt 盐。
6. **O-01 / R-04** 抽 `escapeRegExp()` 并替换两处（同仓已有正确写法可复制）。
7. **R-05 / V-24** 降级时不写占位释义（留空以便被"需要释义"筛出），`isError` 时禁用"存入生词本"。**（V-24 已于第二批修复；R-05 的 `isError` 禁用仍待做）**

**第二批（闭环缺口）**
8. **N-05** 错题存 `lineId` + 原句 + 复盘页"跳到该句"；**N-01** 词表补释义入口。
9. **N-08 / Q-07** "继续学习"改用自增 intent token，并把 `task.entityId` 传进模块。
10. **Q-01 / V-17** 首启说明卡 + "清空示例开始我自己的词库"；**Q-02/Q-03** 统一的 `MissingKeyNotice`（含"去设置"）。
11. **V-05** 给 AI 返回加结构校验（并本地补 `id`），避免整页崩。
12. **V-04 / Q-11** 把 D-05 的失败契约贯彻到词库的增/改/删 + 在设置页展示 `lastWriteError`。
13. **R-01/R-02/R-03** 恢复整篇朗读（查词保留句位）、文库检索排序、默读计入 + "标记读完"。

**第三批（打磨，能一次消掉多项）**
14. **抽三个基础组件**：`Modal`/`BottomSheet`（含 dialog 语义、Esc、遮罩、安全区、dvh）+ `IconButton`（≥44px + `aria-label`）+ `Toast`（替换 `alert`）—— 直接覆盖 D-25/D-30/D-35/R-19/R-20/R-21/V-19/O-17 十余项。
15. **统一口径**：到期词、难度阈值、活动/打卡口径收敛为单一模块（见 2.4-C）。
16. **V-07/V-08** 展示"下次复习日期"、允许选择本次学多少与提前复习。
17. 其余中低项按模块表格逐条处理。

**需要产品决策**
18. **O-04/O-05** 要不要做"回听自己的发音"（涉及录音权限与本地存储；`PRODUCT_ROADMAP` 已有相关设想）与"跨轮次纠错汇总"。
19. **N-02 / V-…** 掌握度是否保留"测验占 20%"，以及 SRS 是否要从"三档启发式"走向真 SM-2（报告 D-31 已把护栏补齐，评分档位未动）。

### 5.3 下一轮建议

- 做一次**真机走查**（iPhone + Android 各一轮完整流程：今日 → 口语 → 精读 → 生词 → 新概念），把本文所有"未经运行验证"的条目一次性定案。
- 抽查 `origin/legacy-backup`，确认是否有被移除但值得恢复的能力（R-01 是候选）。

---

## 六、实施记录（第一批已落地）

> 本节记录本报告"Top 15"中第一批 8 项的**实际修复结果**，使文档同时充当问题清单与修复台账。全部改动在 `main` 工作区完成。

### 6.1 已修复

| 编号 | 修复内容 | 改动位置 | 验证 |
| :--- | :--- | :--- | :--- |
| **V-02** | `again` 改为**当天回炉**：`nextReviewDate = now`（`intervalDays` 仍保留"下次要用的间隔"），并修正按钮副文案"重头复习"→"今天再来一次" | `storage.js:377-390,427` | 新测试（红测失败） |
| **V-01** | 评分双击守卫：以「卡片 id + 时间窗」判定，同一张卡在 `RATING_LOCK_MS=600ms` 内重复点击被忽略 | `VocabularySRS.jsx:57-62,150-160` | 代码确证（UI 层） |
| **V-03** | ①未翻面时三档评分按钮 `disabled`（并给出提示"先轻触卡片看释义"）；②评分按钮 `stopPropagation`，不再连带触发翻卡；③新增**5 秒撤销**：恢复词条 SRS 快照 + 回退统计 + 删除该次复习事件，并把卡片放回原位；④写盘失败时给出可见错误而不是静默翻页 | `VocabularySRS.jsx`、`storage.js` 新增 `revertReview()` | 新测试 ×3（红测失败） |
| **Q-04** | 区分「已完成 / 已推迟」：新增 `deferredCount` 与 `dayIsFinished`，全部推迟不再显示"闭环已完成"，改为"还有 N 项被推迟到明天，已完成 x/y 项" | `HomeDashboard.jsx:108-115,146,158` | 代码确证（UI 层） |
| **Q-05** | 勾选计划项时补记学习事件（`source:'daily-plan'`），映射抽为可测的 `activityTypeForTask()`；勾选后同步刷新 `stats` | `studyPlan.js` 新增导出、`HomeDashboard.jsx:markTask` | 新测试（红测失败） |
| **N-18** | 试卷种子加入**attempt 盐**：`buildNceExamQuestions(..., variant)`，`NceExam` 传入 `Date.now()`；不传 variant 时保持历史确定性（老调用与老测试不受影响） | `nceExam.js:23-31,50,61,67`、`NceExam.jsx:100` | 新测试 ×3（红测失败） |
| **R-04** | ①查词改用**用户实际点击的那一句**（`handleWordClick(word, sentence)`，渲染处直接传 `sentence`），不再全篇取第一个命中句；②匹配改用 `containsTerm`（安全转义） | `SmartReader.jsx` | 新测试（`text.test.js`） |
| **O-01** | 命中判定**前移到清空输入框之前**，并改用 `containsTerm`；元字符不再抛错，输入不可能被静默吞掉 | `OralCoach.jsx:145-165` | 新测试 + 前后对比演示 |

**顺带收敛的根因**（本报告 2.4-A）：新增 `src/services/text.js` 提供唯一的 `escapeRegExp` / `containsTerm`，并把原先散落的 3 处手写转义（`nce.js`、`nceExam.js`、`SmartReader.jsx` 导出笔记处）统一改为调用它。

### 6.2 验证结果（本次改动后实测）

```
$ npm test
ℹ tests 53   ℹ pass 53   ℹ fail 0        （原 39 例 + 新增 14 例）
   新增：test/text.test.js（5 例）、storage-safety 增加 6 例、
         nce.test 增加 3 例、studyPlan.test 增加 1 例

$ npm run lint
Found 88 warnings and 0 errors.          （与修复前一致，未引入新告警）

$ npm run build
✓ built in 1.13s
```

**红→绿验证**：把新测试指向修复前基线（`HEAD` = `c2e3b69`）运行：

| 用例 | 修复前 | 修复后 |
| :--- | :--- | :--- |
| `a new attempt variant produces a different paper` | ✖ 失败 | ✔ |
| `"again" makes the card due immediately…` | ✖ 失败 | ✔ |
| `revertReview restores the word, the stats and the event` | ✖ 失败（方法不存在） | ✔ |
| `revertReview reports failure…` / `only drops the event…` | ✖ 失败 | ✔ |
| `studyPlan.test.js`（`activityTypeForTask` 未导出） | ✖ 模块级失败 | ✔ |

并直接演示了旧代码路径的行为差异：

```
OLD  new RegExp("\bC++\b") -> THROWS: Invalid regular expression: Nothing to repeat
OLD  /\be.g\b/i vs "I had an egg"      -> true      ← 查词取到错误语境
NEW  containsTerm("I write C++ daily","C++")        -> true
NEW  containsTerm("I had an egg","e.g")             -> false
```

### 6.3 本次**未做**（第一批之外）

仍待处理：V-04（词库增/改/删的写入失败可见化）、V-05（AI 返回结构校验）、V-06/V-07/V-08（来源可跳转、显示下次复习日期、可选学多少）、N-05/N-01（错题定位到原句、词表补释义）、N-08/Q-07（"继续学习"intent 与 `entityId` 传递）、Q-01/Q-02/Q-03（首启引导与缺 Key 统一提示）、R-01/R-02/R-03（整篇朗读、文库检索、默读计入），以及 2.4 中列出的组件抽取与口径统一。详见 5.2 的第二、三批。

**V-01 与 Q-04 属 UI 层改动**：本轮通过代码确证（守卫为纯 id+时间比较、文案分支互斥），但**未经浏览器验证**，建议纳入下次真机走查。

### 6.4 第二批（数据可信与写入可见化）已落地

| 编号 | 修复内容 | 改动位置 | 验证 |
| :--- | :--- | :--- | :--- |
| **V-05** | 新增 5 个响应归一化器（`normalizeVocabularyQuiz` / `normalizeVocabStory` / `normalizeArticle` / `normalizeWordAnalysis` / `normalizeSentenceAnalysis`）并接入全部 5 个非口语 AI 入口：非法题目**丢弃**而不是让页面崩、`correctIndex` 越界时从答案文本**恢复**或丢弃（此前会"答对判错"并额外触发 `again` 惩罚）、`id` 缺失/重复**本地补齐**（判分依赖 id 唯一）、`storyEn`/`content` 缺失时抛一条**可读中文错误**而不是稍后 `TypeError`、分析与长难句字段一律规范为字符串/数组 | `ai.js`（新增归一化段 + 5 处接线） | 新测试 13 例（红测：模块级失败） |
| **V-04 / Q-11** | 写入失败契约贯彻到词库：`updateWord` / `deleteWord` 写盘失败返回 `null`（与 `addWord` / `updateWordSRS` 一致）；词库的**改 / 增 / 删**三处均消费返回值并提示；错误提示从闪卡页**上移为全标签可见的横幅**；设置页新增 `lastWriteError` 展示（区分"空间已满"与"存储被禁用"，并指引先导出备份） | `storage.js`、`VocabularySRS.jsx`、`Settings.jsx` | 新测试 2 例（红测失败） |
| **V-24** | 手动加词在 AI 失败时不再写入占位文案 `'自主添加生词'`，改为**留空** —— 于是这个词能被应用自己的「需要释义」筛选出来（`studyView.js:22` 判空）；同时删除确认文案补上"复习进度/来源/笔记一并移除且不可撤销" | `VocabularySRS.jsx` | 新测试 1 例（该例对修复前后**均通过**，属契约护栏；真正的修复在组件层，无法在无渲染器环境下做红绿验证） |
| — | 顺带把 `ai.js` 的 `'./storage'` 导入补上 `.js` 扩展名：Node 的 `node --test` 不解析省略扩展名的说明符（Vite 会），补上后该模块才可被单测直接加载；这也与 `studyPlan.js` / `nce.js` / `nceReview.js` 的既有写法一致 | `ai.js:1-4` | 测试可加载即为证 |

```
$ npm test
ℹ tests 69   ℹ pass 69   ℹ fail 0        （第一批 53 例 + 第二批新增 16 例）

$ npm run lint
Found 88 warnings and 0 errors.          （仍与基线一致）

$ npm run build
✓ built in 1.02s
```

**红→绿（第二批）**：指向 `HEAD` = `b3fe5f4` 运行 → `ai-normalize.test.js` 模块级失败（归一化器不存在）、
`updateWord and deleteWord report a failed write` 失败；修复后 69/69 全通过。

### 6.5 第二批之后仍未做

V-06/V-07/V-08（来源可跳转、显示下次复习日期、可选学多少）、N-05/N-01（错题定位到原句、词表补释义）、N-08/Q-07（"继续学习"intent 与 `entityId` 传递）、Q-01/Q-02/Q-03（首启引导与缺 Key 统一提示）、R-01/R-02/R-03（整篇朗读、文库检索、默读计入 + 标记读完），以及 2.4 的组件抽取与口径统一。详见 5.2 第三批。

### 6.6 第三批（复盘闭环：回到原句 / 知道何时再考 / 积压可退）已落地

| 编号 | 修复内容 | 改动位置 | 验证 |
| :--- | :--- | :--- | :--- |
| **V-06** | 生词列表的"来源"由死文本改为**可点击跳转**：新增 `onOpenSource`，`App.openSourceFromVocab` 把三种来源映射到对应模块——`reader → 打开该篇文章`、`nce → 打开该课`、`oral → 切到该情景`。三种 `source.type` 与写入端逐一核对过（`NewConcept.jsx:648` / `OralCoach.jsx:406` / `SmartReader.jsx:594`）；无 `type` 的旧数据仍按纯文本降级显示 | `App.jsx`、`VocabularySRS.jsx`、`SmartReader.jsx`、`OralCoach.jsx` | 类型映射经写入端核对 |
| **V-07** | 展示**下次复习日期**：列表行新增"下次复习: 今天到期 / 明天 / 3 天后 / 10月31日 / 已到期 / 待安排"（新增可测的 `formatDueDate(nextReviewDate, now)`，`now` 可注入） | `studyView.js`、`VocabularySRS.jsx` | 新测试 2 例（红测） |
| **V-08** | **积压保护**：每会话默认 20 张（可选 10/20/50/全部，落 `AppState`），并在卡片上方显示"今天到期 N 个，本次做 M 个"；一组做完后若仍有到期词，明确显示"还剩 N 个"并给"继续下一组"按钮，**不再**在还有到期词时说"今日已全部搞定" | `VocabularySRS.jsx` | 代码确证（UI 层） |
| **N-05** | 错题可回到**犯错那一句**：`buildExercises` 输出补 `lineId` / `sourceText`，听写错题补 `lineId`；`buildNceReviewQueue` 透传两字段（旧数据缺字段时降级为空串）；复盘页按钮由"回课文理解"变为"**回到该句**"，`NewConcept.openUnit(unit, { lineId })` 在字幕到达后定位并高亮该句（复用既有 `activeLine` 滚动）。听写的 `prompt` **仍保持为空**——否则等于提前给出答案 | `nce.js`、`nceReview.js`、`NewConcept.jsx`、`NceReview.jsx` | 新测试 3 例（红测失败） |
| **N-08 / Q-07** | "继续学习"改为**自增 intent token** 驱动：此前用 `autoResumedRef === resumeLesson` 判重，第二次点同一个目标被静默忽略、用户落在课程地图；`App` 统一为 `nceIntent / readerIntent / oralIntent`（带 `token`），`NewConcept` 据此重新打开课程、也可以切换 `review/exam` 入口。同时把计划任务的 `entityId` 透传下去（此前 `openTask` 丢掉它，改用"打开过的最后一课"，卡片写 A、点进去可能是 B） | `App.jsx`、`NewConcept.jsx`、`HomeDashboard.jsx` | 代码确证（UI 层） |

```
$ npm test
ℹ tests 74   ℹ pass 74   ℹ fail 0        （第二批 69 例 + 本批新增 5 例）

$ npm run lint
Found 88 warnings and 0 errors.          （与基线一致）

$ npm run build
✓ built in 1.12s
```

**红→绿（第三批）**：指向 `HEAD` = `9b471ba` → 4 项失败：
`exercises carry the lesson line they came from`、`the review queue passes the source line through…`、
`review queue tolerates older mistake records without a line id`、`studyPlan.test.js`（`formatDueDate` 不存在）。

**过程中修正的两处自身问题**：
1. 新增的"下次复习"日期让 `reloadVocabulary` 变成依赖 React state 的函数，触发 `react-hooks(exhaustive-deps)` 与 `react(purity)` 两条新告警。改法是让 `reloadVocabulary` 从 storage 读取会话大小而非闭包捕获 state（消除前一条），并对"读取当前时间"这一固有 impurity 加**带理由的定向豁免**（后一条），告警回到基线 88。
2. `formatDueDate` 的月内边界写成了 `days <= 30`，我的测试却断言 30 天显示日期 —— 是**测试期望写错**，已按实现意图修正并补上"30 天相对 / 31 天日期"的边界断言。

### 6.7 第三批之后仍未做

N-01（词表补释义入口）、Q-01（首启演示数据说明与"清空示例"）、Q-02/Q-03（统一缺 Key 提示含"去设置"）、R-01（整篇连续朗读 + 查词保留句位）、R-02（文库检索/排序/难度与进度）、R-03（默读计入 + 标记读完），以及 2.4 的组件抽取（Modal/BottomSheet/IconButton/Toast，可一次消掉 D-25/D-30/D-35 与 R-19~R-21、V-19、O-17 等十余项）与口径统一。

### 6.8 第四批（精读三大缺口）已落地

| 编号 | 修复内容 | 改动位置 | 验证 |
| :--- | :--- | :--- | :--- |
| **R-01** | ①**恢复整篇连续朗读**：页头新增"整篇朗读/停止朗读"按钮，按段落顺序连续朗读并在读完后自动滚到当前段（`paragraphRefs` + `scrollIntoView`），读完一遍记录一条"完整听读一篇文章"；②**查词不再清零句位**：`handleWordClick` / `handleSentenceClick` 改用 `stopParagraphSpeech(false)`，听到一半点词查义后再点段落播放会**从原句继续**，而不是从头重放 | `SmartReader.jsx` | 代码确证（音频行为未经真机验证） |
| **R-02** | **文库可检索/筛选/排序**：新增搜索框（标题/题材/难度）、筛选面板（状态：全部/在读/未读/已读完；难度；排序：在读优先/最新/标题/进度），芯片行显示每篇的**难度与阅读进度**（"读到 x%"/"已读完"）；筛选结果为空时给出可操作的文案。过滤排序逻辑抽为可测的 `filterArticles(articles, options, getProgress)` | `studyView.js`、`SmartReader.jsx` | 新测试 6 例（红测：模块级失败） |
| **R-03** | **默读计入学习记录**：①新增"标记读完"按钮（标记 + 记一条 `reader` 活动 + 庆祝动效）；②**停留/滚动达标即自动计入**：每次打开文章记录 `dwell`，离开或换篇时若"≥1 分钟"或"有滚动且 ≥24 秒"则记一条"静读一篇文章"（含 `durationMinutes`），并用 `hasStudyEventToday` 保证**每篇每天只计一次**；③滚动进度按 5% 步长持久化（避免每次滚动都写 localStorage） | `storage.js`、`SmartReader.jsx` | 新测试 4 例（红测失败） |

```
$ npm test
ℹ tests 84   ℹ pass 84   ℹ fail 0        （第三批 74 例 + 本批新增 10 例）

$ npm run lint
Found 88 warnings and 0 errors.          （与基线一致）

$ npm run build
✓ built in 1.06s
```

**红→绿（第四批）**：指向 `HEAD` = `2bb78ab` → 5 项失败：
`markArticleRead records a finished article…`、`saveArticleProgress keeps the furthest position…`、
`markArticleRead keeps existing progress…`、`hasStudyEventToday distinguishes today…`、
以及 `studyView.test.js`（`filterArticles` 不存在）。

**过程中修正的一处自身问题**：最初用 `readStateVersion` 计数器给 `useMemo` 当"缓存失效键"，
oxlint 报 `useMemo has unnecessary dependency`（依赖没在回调里被引用）。改为把阅读进度放进
`articleProgressMap` state、并让 `libraryArticles` 真实依赖它 —— 依赖变成诚实的，告警回到基线。

### 6.9 第四批之后仍未做

N-01（本课词表补释义入口）、Q-01（首启演示数据说明 + "清空示例"）、Q-02/Q-03（统一缺 Key 提示含"去设置"入口），以及 2.4 的**组件抽取**（`Modal`/`BottomSheet`/`IconButton`/`Toast`）与口径统一（到期词、"困难词"阈值、活动/打卡口径收敛为单一模块）。

### 6.10 第五批（2.4-E 基础组件抽取）已落地

新增 `src/components/ui/`：`Modal.jsx`（`Modal` + `BottomSheet`）、`IconButton.jsx`、`Toast.jsx` + `toastContext.js`。

| 项 | 修复内容 | 覆盖的既有发现 |
| :--- | :--- | :--- |
| **Modal / BottomSheet** | 统一弹层：`role="dialog"` + `aria-modal` + `aria-labelledby`、**Esc 关闭**、焦点移入面板并在关闭后**归还焦点**、打开时锁背景滚动、`dvh` 高度上限、底部安全区（`max(…, var(--safe-area-inset-bottom))`）、遮罩为真实 `<button>`（可点击关闭且不污染语义）、面板背景用 `panelClassName` 显式传入（避免依赖 Tailwind 生成顺序） | **D-30**（15 个弹层无 dialog 语义）、**D-35**（`vh` 假设）、**R-19**（卡片弹层无安全区 + 85vh）、**V-20**（加/改词弹层无高度上限） |
| **Toast** | 轻量 toast 替换 `alert`：3 种语气（info/success/error）、错误停留更久、`<output>` 语义化 live region、可手动关闭、**provider 缺失时回退 `alert`**（消息不会静默丢失） | **D-25**（`alert` 阻塞且不可样式化） |
| **IconButton** | 图标按钮统一：`aria-label` + `title`、用 `::before` 把**点击区域扩到 44×44 而不改变视觉尺寸**（密集行布局不受影响） | **O-17**（20–26px 图标按钮）、**R-20**（句末图标误触会真的发 AI 请求）、**R-21**（12px 删除键紧贴标题）、**V-19**（26px 竖排编辑/删除） |

**实际迁移量**：`alert()` **23 处全部替换**（OralCoach 2 / Settings 6 / SmartReader 11 / VocabularySRS 4）；`fixed inset-0` 手写遮罩 **15 处全部迁移**（SmartReader 6、VocabularySRS 4、Settings 3、OralCoach 2；现仅 `Modal.jsx` 自身保留该模式）；IconButton 已用于精读文库删除、精读句末两个图标、词库列表行编辑/删除。

```
$ npm run lint
Found 48 warnings and 0 errors.   ← 本批开始前为 88（−40，全部是弹层/遮罩带来的 a11y 告警）

$ npm test
ℹ tests 84   ℹ pass 84   ℹ fail 0

$ npm run build
✓ built in 1.36s
```

**本批抓到一个真实缺陷（构建不会报，运行时会崩）**：`SmartReader.jsx` 迁移时用了 `<Modal>` 但只导入了 `BottomSheet`。Vite 构建**不校验未定义标识符**，所以 `npm run build` 通过；是 oxlint 的 `react(jsx-no-undef)` 把它报了出来（否则打开"导入文章"与"换一篇新外刊"两个弹层时会直接 ReferenceError）。已修复并复查了四个文件的 `ui/` 导入完整性。

**仍未做**：O-17 中口语页的小图标按钮（未逐一迁移）；`label-has-associated-control` 26 处（表单 label 与控件未关联）、`no-array-index-key` 11 处、NceReview 的 `role="status"` 2 处、`media-has-caption` 1 处 —— 这些是独立的小项，不属于本次组件抽取范围。

---

## 附录：本次扫描用到的核验手法

| 手法 | 用途 | 例子 |
| :--- | :--- | :--- |
| 全仓符号命中计数 | 证明"某能力不存在" | `MediaRecorder`/`getUserMedia`/`AudioContext` 命中 0 → 无录音回放 |
| 逐行读关键函数 | 证明数据流向 | `handleSaveToVocab` 取 `wordAnalysis.translation` → 占位文案会入库 |
| 交叉比对筛选器语义 | 证明"兜底机制被绕过" | `studyView.js:22` 判空 vs `'自主添加生词'` 非空 |
| 对候选结论反证 | 排除误报 | 全局 `!important` 字号 → 排除"iOS 缩放"；`saveArticle` → 排除"内容不落盘" |

*本报告为只读扫描产物，生成过程中未修改项目内任何业务代码。*
