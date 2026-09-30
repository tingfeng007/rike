# 语法实验室（Grammar Lab）

> 新增模块 · 面向中文母语者的英语基本句型学习
> 文件：`src/data/grammar.js`（内容）、`src/services/grammar.js`（纯逻辑）、`src/components/GrammarLab.jsx`（界面）

## 1. 为什么这样设计

| 决定 | 原因 |
| :--- | :--- |
| **独立标签页**（底部导航第 5 项「语法」） | 五个既有标签各对应一个学习域；语法是新的学习域，塞进「新概念」会让非 NCE 用户看不到。 |
| **离线优先** | 句型讲解与练习全部内置，没有 API Key 也能完整使用；AI 只用于可选的「拆句」增强。 |
| **纯逻辑放服务层** | 判定器、出题、判分、进度汇总都是纯函数，`node --test` 可直接测（16 例）。 |
| **内容和判定分开** | 练习的**正确答案来自人工校对的语料标注**，不是判定器猜出来的；判定器只用于「自己写一句试试」。 |

## 2. 内容范围

**6 种基本句型**（`GRAMMAR_PATTERNS`）：

| id | 句型 | 公式 |
| :--- | :--- | :--- |
| `sv` | 主谓 | 主语 + 不及物动词 |
| `svo` | 主谓宾 | 主语 + 及物动词 + 宾语 |
| `svp` | **主系表** | 主语 + 系动词 + 表语 |
| `svoo` | 主谓双宾 | 主语 + 动词 + 间接宾语（人）+ 直接宾语（物） |
| `svoc` | 主谓宾补 | 主语 + 动词 + 宾语 + 宾语补足语 |
| `there-be` | There be | There + be + 主语 |

每个句型包含：公式、一句话说明、判别要点、**带成分标注的例句**（主语/谓语/宾语/表语/间接宾语/直接宾语/宾语补足语/状语/引导词）、常见错误（错误 ✗ / 正确 ✓ / 中文解释）。

**易混淆对比**（`GRAMMAR_COMPARISONS`）：

- **主谓宾 vs 主系表** —— 用「能否换成 be 且句意不变」判别；系动词后形容词作表语 vs 及物动词后名词作宾语。
- **主谓双宾 vs 主谓宾补** —— 用「能否在两成分间插入 be」判别（elect him president ≈ he is president ✓；give me a book ≈ I am a book ✗），以及「直接宾语能否用 to/for 提前」。

## 3. 三种练习题型

1. **判断句型**：给一句英文，选出所属句型。
2. **找成分**：句中某片段高亮，选出它的成分。
3. **改错**：给出常见错误句，选出正确写法。

出题是**可复现的**（同一 `seed` 得到同一套题），答错进入错题本，「只练错题」按错题所在句型重新抽题（避免背原题）。练习完成后记一条 `type: 'grammar'` 的学习活动 —— 它会进入连击天数与周报的 `byType`。

## 4. 句型判定器的能力边界（重要）

`detectSentencePattern()` 是**启发式**，只认识内置词表：

- be 动词、常见系动词（become / seem / look / feel / taste / smell / sound / remain / stay / keep / turn / grow / prove…）
- 双宾动词（give / tell / send / show / bring / offer / lend / teach / buy / write / pass / hand / ask / pay…）
- 宾补动词（make / let / have / keep / find / consider / elect / call / name / see / hear / watch / want / leave）
- 常见动词与规则动词词尾（-s / -es / -ed / -ing）

**它会做的事**：识别 `be + 现在分词` 是进行时而不是主系表；跳过限定词后的同形名词（The **leaves** turned yellow）；把 `-ly` 副词与介词短语视为状语而不计入成分；区分「同一动词的系表用法与宾补用法」（She kept calm / She kept the door closed）。

**它不会硬猜**：被动语态（be + 过去分词）、没有识别出谓语的句子、过短的输入、缺表语的句子，一律返回 `unknown` 并给出原因，界面引导改用 AI 拆句。

**已用全部 20 条内置例句做一致性验证**：判定结果必须与人工标注的句型完全一致（见 `test/grammar.test.js`）。这条测试同时保护了判定器与语料本身 —— 开发过程中它就抓出了 3 个真实缺陷（进行时被误判为主系表、限定词后的 `leaves` 被当成谓语、`broken` 漏在分词表外导致被动句误判）。

## 5. 数据与存储

- 进度键：`lingoflow_grammar_v1`，形状 `{ answers: { [patternId]: { correct, total } }, missed: [...], totalAnswered, totalCorrect, accuracy, updatedAt }`。
- 写入走 `StorageService.recordGrammarAnswer()`（内部调用纯函数 `applyGrammarAnswer`，写失败返回 `null`）。
- 自检：`validateGrammarData()` 校验「成分标注必须真的出现在原句里」「每个句型都有例句/易错点/公式」「易错句的错误与正确写法不能相同」。

## 6. 测试

`test/grammar.test.js`（17 例）：语料自检、判定器 vs 语料全量一致性、六大句型覆盖、进行时、同形名词、双宾/宾补区分、副词与介词短语、`unknown` 的诚实性、出题可复现与题型齐全、选项去重与答案在选项中、划线内容必须在题干里、改错题答案不能是错误句、判分与进度累加、错题进出、掌握标签、对比说明、`splitHighlight`。

## 7. 尚未做

- 时态与语态（现在完成时、被动语态、虚拟语气）尚未纳入 —— 目前只做基本句型。
- 语法练习尚未进入每日计划（`studyPlan.js`），目前只计入学习活动与周报。
- 主谓宾 vs 主系表的判定依赖内置词表；遇到词表外的动词会返回 `unknown` 而不是猜测。
