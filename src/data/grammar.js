/**
 * 英语基本句型与核心语法点（离线内容）。
 *
 * 面向中文母语者的自学场景：每个句型给出「公式 → 讲解 → 例句（带成分标注）→ 易错点」，
 * 练习与判定逻辑在 `src/services/grammar.js`（纯函数、可单测）。
 *
 * 成分命名用中文教学惯例：
 *   主语 / 谓语 / 宾语 / 表语 / 间接宾语 / 直接宾语 / 宾语补足语 / 状语 / 引导词
 */

export const GRAMMAR_ROLES = ['主语', '谓语', '宾语', '表语', '间接宾语', '直接宾语', '宾语补足语', '状语', '引导词'];

export const GRAMMAR_PATTERNS = [
  {
    id: 'sv',
    name: '主谓',
    symbol: 'S + V',
    formula: '主语 + 谓语（不及物动词）',
    summary: '说明“谁 / 什么 做了什么”，动词后面不需要宾语，句子意思已经完整。',
    keys: [
      '谓语由不及物动词充当，如 rise, arrive, happen, sleep, fly, work, come, go, listen。',
      '若动词是不及物动词却要接对象，必须借介词：arrive at the station、listen to music。',
      '常可带状语（时间、地点、方式），但状语不是句子成立的必要成分。',
    ],
    examples: [
      {
        en: 'Birds fly.',
        zh: '鸟儿飞翔。',
        parts: [{ text: 'Birds', role: '主语' }, { text: 'fly', role: '谓语' }],
      },
      {
        en: 'The baby is sleeping.',
        zh: '宝宝正在睡觉。',
        parts: [
          { text: 'The baby', role: '主语' },
          { text: 'is sleeping', role: '谓语' },
        ],
      },
      {
        en: 'He arrived at the station.',
        zh: '他到达了车站。',
        parts: [
          { text: 'He', role: '主语' },
          { text: 'arrived', role: '谓语' },
          { text: 'at the station', role: '状语' },
        ],
      },
    ],
    pitfalls: [
      {
        wrong: 'He arrived the station yesterday.',
        right: 'He arrived at the station yesterday.',
        explanation: 'arrive 是不及物动词，不能直接接宾语，必须加介词 at / in。',
      },
      {
        wrong: 'The accident was happened last night.',
        right: 'The accident happened last night.',
        explanation: 'happen 是不及物动词，没有被动语态，直接用主动形式。',
      },
    ],
  },
  {
    id: 'svo',
    name: '主谓宾',
    symbol: 'S + V + O',
    formula: '主语 + 谓语（及物动词） + 宾语',
    summary: '动词的动作需要一个承受者，去掉宾语句子就不完整。',
    keys: [
      '谓语由及物动词充当，如 love, like, buy, read, build, finish, make（作“制作”时）。',
      '宾语通常是名词、代词或动名词：I enjoy reading。',
      '判断技巧：把动词后面部分遮住，若句子意思残缺，说明它是宾语而不是状语。',
    ],
    examples: [
      {
        en: 'I love music.',
        zh: '我喜欢音乐。',
        parts: [{ text: 'I', role: '主语' }, { text: 'love', role: '谓语' }, { text: 'music', role: '宾语' }],
      },
      {
        en: 'She reads English novels every night.',
        zh: '她每晚读英文小说。',
        parts: [
          { text: 'She', role: '主语' },
          { text: 'reads', role: '谓语' },
          { text: 'English novels', role: '宾语' },
          { text: 'every night', role: '状语' },
        ],
      },
      {
        en: 'They built a bridge last year.',
        zh: '他们去年建了一座桥。',
        parts: [
          { text: 'They', role: '主语' },
          { text: 'built', role: '谓语' },
          { text: 'a bridge', role: '宾语' },
          { text: 'last year', role: '状语' },
        ],
      },
    ],
    pitfalls: [
      {
        wrong: 'I very like English.',
        right: 'I like English very much.',
        explanation: 'very 不能直接修饰动词；修饰动词要用 very much 或 really。',
      },
      {
        wrong: 'She married with a doctor.',
        right: 'She married a doctor.',
        explanation: 'marry 是及物动词，直接接宾语，不加 with。',
      },
    ],
  },
  {
    id: 'svp',
    name: '主系表',
    symbol: 'S + V(link) + P',
    formula: '主语 + 系动词 + 表语',
    summary: '系动词不表示动作，而是把主语和表语连起来，用来说明主语的“身份、性质、状态”。',
    keys: [
      '常见系动词：be（am / is / are / was / were）、become、get、turn、grow、go、come、seem、appear、look、feel、smell、taste、sound、remain、stay、keep、prove。',
      '表语回答“主语是什么 / 怎么样”，可以是名词、形容词、介词短语或从句。',
      '关键区分：系动词后面接形容词作表语（The soup tastes good），及物动词后面接名词作宾语（She tasted the soup）。',
      '判断技巧：很多系动词可用 be 替换而句意基本不变——He looks tired ≈ He is tired。',
    ],
    examples: [
      {
        en: 'She is a teacher.',
        zh: '她是一名教师。',
        parts: [{ text: 'She', role: '主语' }, { text: 'is', role: '谓语' }, { text: 'a teacher', role: '表语' }],
      },
      {
        en: 'The soup tastes delicious.',
        zh: '这汤尝起来很美味。',
        parts: [{ text: 'The soup', role: '主语' }, { text: 'tastes', role: '谓语' }, { text: 'delicious', role: '表语' }],
      },
      {
        en: 'He became a doctor.',
        zh: '他成了一名医生。',
        parts: [{ text: 'He', role: '主语' }, { text: 'became', role: '谓语' }, { text: 'a doctor', role: '表语' }],
      },
      {
        en: 'The leaves turned yellow in autumn.',
        zh: '秋天树叶变黄了。',
        parts: [
          { text: 'The leaves', role: '主语' },
          { text: 'turned', role: '谓语' },
          { text: 'yellow', role: '表语' },
          { text: 'in autumn', role: '状语' },
        ],
      },
    ],
    pitfalls: [
      {
        wrong: 'The music sounds beautifully.',
        right: 'The music sounds beautiful.',
        explanation: '系动词后要用形容词作表语，beautifully 是副词，只能修饰动词。',
      },
      {
        wrong: 'He is agree with you.',
        right: 'He agrees with you.',
        explanation: 'agree 是动词，不能像形容词一样放在 be 后面作表语；“同意”直接用 agree 作谓语。',
      },
      {
        wrong: 'The soup is tasted delicious.',
        right: 'The soup tastes delicious.',
        explanation: 'taste 在这里是系动词，不用被动语态，直接接形容词作表语。',
      },
    ],
  },
  {
    id: 'svoo',
    name: '主谓双宾',
    symbol: 'S + V + IO + DO',
    formula: '主语 + 谓语 + 间接宾语（人） + 直接宾语（物）',
    summary: '动词后面跟两个宾语：先说“给谁”（间接宾语），再说“给了什么”（直接宾语）。',
    keys: [
      '常见可带双宾的动词：give、send、show、tell、bring、offer、lend、teach、buy、write、pass、hand、ask、pay、promise、wish、cook、find、get。',
      '两个宾语一般一“人”一“物”，且它们之间没有逻辑上的主谓关系：give me a book 中 me ≠ book。',
      '可直接宾语提前加 to / for，句意不变：give a book to me、buy a bike for me。',
    ],
    examples: [
      {
        en: 'He gave me a book.',
        zh: '他给了我一本书。',
        parts: [
          { text: 'He', role: '主语' },
          { text: 'gave', role: '谓语' },
          { text: 'me', role: '间接宾语' },
          { text: 'a book', role: '直接宾语' },
        ],
      },
      {
        en: 'She told us a story.',
        zh: '她给我们讲了一个故事。',
        parts: [
          { text: 'She', role: '主语' },
          { text: 'told', role: '谓语' },
          { text: 'us', role: '间接宾语' },
          { text: 'a story', role: '直接宾语' },
        ],
      },
      {
        en: 'My father bought me a bike.',
        zh: '我爸爸给我买了一辆自行车。',
        parts: [
          { text: 'My father', role: '主语' },
          { text: 'bought', role: '谓语' },
          { text: 'me', role: '间接宾语' },
          { text: 'a bike', role: '直接宾语' },
        ],
      },
    ],
    pitfalls: [
      {
        wrong: 'Please explain me this rule.',
        right: 'Please explain this rule to me.',
        explanation: 'explain / suggest / describe 等动词不能带双宾语，必须用 explain sth to sb。',
      },
      {
        wrong: 'He gave to me a book.',
        right: 'He gave me a book.',
        explanation: '间接宾语在双宾结构里紧跟动词；若把直接宾语提前才需要用 to。',
      },
    ],
  },
  {
    id: 'svoc',
    name: '主谓宾补',
    symbol: 'S + V + O + C',
    formula: '主语 + 谓语 + 宾语 + 宾语补足语',
    summary: '宾语后面还要再加一个成分补充说明“宾语怎么样 / 是什么”，句子才完整。',
    keys: [
      '常见动词：make、let、have、keep、find、consider、elect、call、name、see、hear、watch、want、ask、leave。',
      '宾语与补足语之间有逻辑主谓关系：They elected him president ≈ He is president。',
      '判断技巧：能在宾语和补足语之间插入 be 且句意成立的是宾补；不能插入的是双宾。',
      '使役动词 make / let / have 后接不带 to 的不定式：make him go（不是 to go）。',
    ],
    examples: [
      {
        en: 'They elected him president.',
        zh: '他们选他当主席。',
        parts: [
          { text: 'They', role: '主语' },
          { text: 'elected', role: '谓语' },
          { text: 'him', role: '宾语' },
          { text: 'president', role: '宾语补足语' },
        ],
      },
      {
        en: 'We found the room empty.',
        zh: '我们发现房间是空的。',
        parts: [
          { text: 'We', role: '主语' },
          { text: 'found', role: '谓语' },
          { text: 'the room', role: '宾语' },
          { text: 'empty', role: '宾语补足语' },
        ],
      },
      {
        en: 'She made me happy.',
        zh: '她让我很开心。',
        parts: [
          { text: 'She', role: '主语' },
          { text: 'made', role: '谓语' },
          { text: 'me', role: '宾语' },
          { text: 'happy', role: '宾语补足语' },
        ],
      },
      {
        en: 'She kept the door closed.',
        zh: '她让门一直关着。',
        parts: [
          { text: 'She', role: '主语' },
          { text: 'kept', role: '谓语' },
          { text: 'the door', role: '宾语' },
          { text: 'closed', role: '宾语补足语' },
        ],
      },
    ],
    pitfalls: [
      {
        wrong: 'We made him to go home.',
        right: 'We made him go home.',
        explanation: 'make / let / have 作使役动词时，宾补用省略 to 的不定式。',
      },
      {
        wrong: 'I found the book is interesting on the desk.',
        right: 'I found the book interesting.',
        explanation: 'find + 宾语 + 形容词作宾补，不需要再补一个谓语动词 is。',
      },
    ],
  },
  {
    id: 'there-be',
    name: 'There be 句型',
    symbol: 'There + be + S',
    formula: 'There + be + 主语（+ 地点 / 时间）',
    summary: '表示“某处有某物 / 某事发生”，there 是引导词，be 后面的名词才是真正的主语。',
    keys: [
      'be 的单复数由后面的名词决定：There is a book. / There are two books.',
      '就近原则：并列主语时，be 与最靠近它的那个名词一致——There is a pen and two books. / There are two books and a pen.',
      'There be 表示“存在”，have 表示“拥有”，两者不能混用：不说 There has a book。',
      '也可与情态动词或 seem / appear 连用：There must be a mistake. / There seems to be a problem.',
    ],
    examples: [
      {
        en: 'There is a book on the desk.',
        zh: '桌上有一本书。',
        parts: [
          { text: 'There', role: '引导词' },
          { text: 'is', role: '谓语' },
          { text: 'a book', role: '主语' },
          { text: 'on the desk', role: '状语' },
        ],
      },
      {
        en: 'There are two cats in the garden.',
        zh: '花园里有两只猫。',
        parts: [
          { text: 'There', role: '引导词' },
          { text: 'are', role: '谓语' },
          { text: 'two cats', role: '主语' },
          { text: 'in the garden', role: '状语' },
        ],
      },
      {
        en: 'There is a pen and two books on the table.',
        zh: '桌上有一支笔和两本书。',
        parts: [
          { text: 'There', role: '引导词' },
          { text: 'is', role: '谓语' },
          { text: 'a pen and two books', role: '主语' },
          { text: 'on the table', role: '状语' },
        ],
      },
    ],
    pitfalls: [
      {
        wrong: 'There have a book on the desk.',
        right: 'There is a book on the desk.',
        explanation: '“有”在 there 句型里用 be，不能用 have。',
      },
      {
        wrong: 'There is two books on the desk.',
        right: 'There are two books on the desk.',
        explanation: 'be 的单复数跟随后面的主语 two books，用 are。',
      },
    ],
  },
];

/**
 * 特别容易混淆的句型对比（尤其“主谓宾 vs 主系表”，这是中文母语者最高频的疑问）。
 */
export const GRAMMAR_COMPARISONS = [
  {
    id: 'svo-vs-svp',
    title: '主谓宾 vs 主系表',
    left: 'svo',
    right: 'svp',
    question: 'Her mother is a doctor. 和 Her mother visited a doctor. 结构一样吗？',
    answer: '不一样：前者是主系表，后者是主谓宾。',
    howToTell: [
      '把动词换成 be：主系表原本就是 be 或可换成 be（is a doctor → is a doctor 句意不变），主谓宾换 be 后句意会崩（visited → is a doctor 不通）。',
      '看动词后面：系动词后是“说明主语”的表语（形容词 / 名词 / 介词短语）；及物动词后是“承受动作”的宾语。',
      '形容词作表语很常见（The soup tastes good）；形容词一般不直接作宾语，所以“系动词 + 形容词”几乎一定是主系表。',
    ],
    examples: ['He became a teacher.（主系表：a teacher 说明他成了什么人）', 'He met a teacher.（主谓宾：a teacher 是 met 的承受者）'],
  },
  {
    id: 'svoo-vs-svoc',
    title: '主谓双宾 vs 主谓宾补',
    left: 'svoo',
    right: 'svoc',
    question: 'He gave me a book. 和 She made me happy. 后面都跟两个成分，怎么区分？',
    answer: '前者是双宾（人 + 物，两宾语并列），后者是宾补（happy 补充说明 me）。',
    howToTell: [
      '两成分之间有逻辑主谓关系的是宾补：made me happy ≈ I am happy ✓；gave me a book ≈ I am a book ✗。',
      '能被 to / for 提前的是直接宾语（双宾结构）：gave a book to me ✓；made happy to me ✗。',
      '双宾的两个成分通常一个指人、一个指物；宾补的第二个成分常是形容词、名词、分词或不带 to 的不定式。',
    ],
    examples: ['She told us a story.（双宾：us + a story）', 'They elected him president.（宾补：he is president）'],
  },
];

/** 由练习数据统一导出所有例句（判断句型 / 找成分两类题共用）。 */
export function getAllGrammarExamples() {
  return GRAMMAR_PATTERNS.flatMap((pattern) => pattern.examples.map((example, index) => ({
    id: `${pattern.id}-${index}`,
    patternId: pattern.id,
    patternName: pattern.name,
    en: example.en,
    zh: example.zh,
    parts: example.parts,
  })));
}

/** 由练习数据统一导出所有易错句（改错题用）。 */
export function getAllGrammarPitfalls() {
  return GRAMMAR_PATTERNS.flatMap((pattern) => pattern.pitfalls.map((pitfall, index) => ({
    id: `${pattern.id}-pitfall-${index}`,
    patternId: pattern.id,
    patternName: pattern.name,
    wrong: pitfall.wrong,
    right: pitfall.right,
    explanation: pitfall.explanation,
  })));
}

export function getGrammarPattern(patternId) {
  return GRAMMAR_PATTERNS.find((pattern) => pattern.id === patternId) || null;
}
