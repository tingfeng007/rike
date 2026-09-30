// Offline, authored teaching content. The examples are original; sources explain the rules.
export const GRAMMAR_SOURCES = [
  { title: 'Cambridge · 状语的位置', url: 'https://dictionary.cambridge.org/grammar/british-grammar/adverbs-and-adverb-phrases' },
  { title: 'Cambridge · 形容词与副词', url: 'https://dictionary.cambridge.org/grammar/british-grammar/adjectives-and-adverbs' },
];

const example = (en, zh, parts, note) => ({ en, zh, parts: parts.map(([text, role]) => ({ text, role })), note });
const question = (id, prompt, choices, answer, explanation) => ({ id, prompt, choices, answer, explanation });

export const GRAMMAR_LESSONS = [
  {
    id: 'expansion', name: '把短句说完整', subtitle: '方式 · 地点 · 时间', symbol: 'S + V + O + M + P + T',
    summary: '先表达谁做了什么，再补充怎么做、在哪里、什么时候。句末多个状语连用时，方式 → 地点 → 时间是常见的中性顺序，不是所有句子的唯一答案。',
    rules: [
      ['先找骨架', 'I read a book. 中 I 是主语，read 是谓语，a book 是宾语。方式、地点与时间描述这次阅读，不会把主谓宾变成另一种基本句型。'],
      ['再问三个问题', 'How? → carefully；Where? → in the library；When? → every evening。需要哪条信息就加哪条，不必凑齐所有成分。'],
      ['不要拆散动词和短宾语', '中性语序通常写 read the instructions carefully，避免 read carefully the instructions。副词也能放在动词前：carefully read the instructions。'],
      ['可以移动重点', 'Every evening, I read a book in the library. 把时间放在句首是在设置背景；若末尾的地点是重点，也可能采用其他顺序。'],
    ],
    examples: [
      example('I read a book carefully in the library every evening.', '我每天晚上在图书馆认真读一本书。', [['I', '主语'], ['read', '谓语'], ['a book', '宾语'], ['carefully', '方式状语'], ['in the library', '地点状语'], ['every evening', '时间状语']], '去掉三个状语，仍是 I read a book.。'),
      example('Yesterday, we played tennis happily in the park.', '昨天，我们在公园里开心地打网球。', [['Yesterday', '时间状语'], ['we', '主语'], ['played', '谓语'], ['tennis', '宾语'], ['happily', '方式状语'], ['in the park', '地点状语']], '时间可以放在句首，主干仍是 we played tennis。'),
    ],
    pitfall: ['She speaks fluently English.', 'She speaks English fluently.', '不要把方式副词夹在 speak 和短宾语 English 之间。'],
    questions: [
      question('order', '选择方式、地点、时间都放在句末时最自然的中性语序。', ['She practises the piano carefully at home every night.', 'She practises carefully the piano at home every night.', 'She the piano practises at home carefully every night.'], 0, '先保留 practises the piano，再接方式 carefully、地点 at home、时间 every night。'),
      question('skeleton', 'I read a book carefully in the library every evening. 的主干是什么？', ['I read a book.', 'I carefully in the library.', 'a book every evening.'], 0, '方式、地点、时间是本例的补充信息，去掉后主谓宾骨架不变。'),
    ],
  },
  {
    id: 'state-manner', name: '状态还是方式', subtitle: 'happy ≠ happily', symbol: '状态：形容词 / 方式：副词',
    summary: '你说的“状态”要看它描述谁：描述主语的性质常用表语，描述动作怎样发生常用方式状语，描述宾语的结果可能是宾语补足语。',
    rules: [
      ['主语是什么状态', 'She looks happy. 中 happy 描述 she，经系动词 looks 连接，是表语。不是所有形容词都能直接接在动作动词后。'],
      ['动作怎样发生', 'She sings happily. 中 happily 描述唱歌的方式，是状语；原来的主谓骨架没有改变。'],
      ['宾语变成什么状态', 'The song made her happy. 中 her 是宾语，happy 补充说明 her 的状态，是宾语补足语。'],
      ['看形式，也看意思', 'He arrived tired. 也能成立，tired 描述到达时“他”的状态。这类补充述语不等于把 tired 当方式副词；初学先掌握前三种对比。'],
    ],
    examples: [
      example('She looks happy today.', '她今天看起来很开心。', [['She', '主语'], ['looks', '系动词'], ['happy', '表语'], ['today', '时间状语']], 'happy 说明人的状态。'),
      example('She sings happily on the stage.', '她在台上开心地唱歌。', [['She', '主语'], ['sings', '谓语'], ['happily', '方式状语'], ['on the stage', '地点状语']], 'happily 说明唱歌的方式。'),
      example('The song made her happy.', '那首歌使她开心。', [['The song', '主语'], ['made', '谓语'], ['her', '宾语'], ['happy', '宾语补足语']], 'her 与 happy 之间有“她是开心的”这一关系。'),
    ],
    pitfall: ['The soup tastes wonderfully.', 'The soup tastes wonderful.', '本句 taste 是系动词，描述汤的味道用形容词 wonderful；若是主动品尝，则可用方式副词。'],
    questions: [
      question('adjective', '描述音乐听起来很美：The music sounds ___.', ['beautiful', 'beautifully', 'beauty'], 0, 'sound 在这里连接主语和表语，选择形容词 beautiful。'),
      question('adverb', 'She answered the question politely. 中 politely 描述什么？', ['回答的方式', 'question 的身份', 'She 的职业'], 0, 'politely 回答“怎样回答”，是方式状语，不是宾语或表语。'),
    ],
  },
  {
    id: 'frequency', name: '频率放在哪里', subtitle: 'often · always · never', symbol: '频率副词 + 实义动词',
    summary: '频率副词通常在实义动词前、be 后；遇到助动词或情态动词，通常放在第一个助动词之后。every day 这类频率短语常在句末。',
    rules: [
      ['实义动词前', 'I often read at home. / She never eats breakfast. 注意 often 不必挪到方式、地点、时间之后。'],
      ['be 动词后', 'He is always late. 不是 He always is late.（特殊强调语境另论）。'],
      ['助动词后', 'I can usually finish it. / She has never visited Paris. 频率副词常在 can、has 等第一个助动词之后。'],
      ['次数短语常放末尾', 'We meet twice a week. / I read every day. 问的是多久一次，短语不机械套用单个频率副词的位置。'],
    ],
    examples: [
      example('I often read books at home.', '我经常在家读书。', [['I', '主语'], ['often', '频率状语'], ['read', '谓语'], ['books', '宾语'], ['at home', '地点状语']], 'often 位于实义动词 read 前。'),
      example('She is always ready.', '她总是准备好了。', [['She', '主语'], ['is', '系动词'], ['always', '频率状语'], ['ready', '表语']], 'always 位于 is 后。'),
    ],
    pitfall: ['He goes always to school by bus.', 'He always goes to school by bus.', '普通陈述中 always 放在实义动词 goes 前。'],
    questions: [
      question('be-position', '选择中性语序。', ['She is usually busy.', 'She usually is busy.', 'She is busy usually always.'], 0, '频率副词 usually 通常放在 be 后。第二项在强调或对比语境可见，但不是本题的中性语序。'),
      question('modal', 'I ___ finish my homework before dinner. （用 can 和 usually）', ['can usually', 'usually can always', 'can finish usually'], 0, '情态动词 can 后、实义动词 finish 前放 usually。'),
    ],
  },
  {
    id: 'place-time', name: '地点与时间短语', subtitle: 'in · on · at', symbol: '介词 + 名词短语',
    summary: '地点或时间可以由介词短语表达。介词选择取决于具体含义，不要按一个中文“在”去翻译所有场景。',
    rules: [
      ['地点：范围、表面、点位', 'in the room（空间内），on the table（表面上），at the station（地点作为点位）。at school 与 in the school 可能表达不同意思。'],
      ['时间：较大单位、日期、时点', 'in September / in 2026；on Monday / on Monday morning；at seven / at night。普通 morning 用 in the morning。'],
      ['这些时间前通常不加介词', 'every day、last night、next week、this morning、yesterday：I studied last night. 不写 in last night。'],
      ['别把地点都当可删除信息', 'I read at home. 的地点可省；I put the book on the desk. 中 put 通常需要补出“放到哪里”，不能一律删除地点。'],
    ],
    examples: [
      example('We met at the station on Monday morning.', '我们周一上午在车站见面。', [['We', '主语'], ['met', '谓语'], ['at the station', '地点状语'], ['on Monday morning', '时间状语']], '具体哪一天的上午用 on。'),
      example('I put the book on the desk.', '我把书放在桌上。', [['I', '主语'], ['put', '谓语'], ['the book', '宾语'], ['on the desk', '地点补足语']], '地点在本例是动词要求的补足信息，不能只按“状语都可省”处理。'),
    ],
    pitfall: ['I studied in last night.', 'I studied last night.', 'last / next / this / every 引导的常见时间表达前通常不加 in、on、at。'],
    questions: [
      question('specific-day', 'We have a lesson ___ Friday afternoon.', ['on', 'in', 'at'], 0, 'Friday afternoon 指具体某一天的下午，用 on。'),
      question('required-place', '哪句话里的地点不能轻易删除，动词通常需要它来补全意思？', ['I put the bag on the chair.', 'I read a book in the park.', 'I slept at home.'], 0, 'put 常要求“把什么放到哪里”；后两句的地点是可选补充信息。'),
    ],
  },
  {
    id: 'noun-modifiers', name: '修饰名词的定语', subtitle: '哪一个 · 什么样的', symbol: '前置定语 + 名词 + 后置定语',
    summary: '定语描述名词，状语描述动作或句子。同样是介词短语，放在不同位置、修饰不同对象，作用也会不同。',
    rules: [
      ['短形容词常在名词前', 'a useful book / the young teacher。冠词和形容词不能代替中心名词；英语通常说 a red bag，而不是 a bag red。'],
      ['较长修饰常在名词后', 'the book on the desk / a student from China / something interesting。on the desk 可说明是哪本书。'],
      ['不要把定语当新的骨架成分', 'The girl in the red coat reads a book. 中整个 The girl in the red coat 是主语，中心词是 girl。'],
      ['先找修饰关系，再找主干', 'The book on the desk is mine. 短语修饰 book；I read the book on the bus. 在普通语境下 on the bus 描述阅读地点，语义有歧义时要看上下文。'],
    ],
    examples: [
      example('The girl in the red coat reads a useful book.', '穿红外套的女孩读一本有用的书。', [['The girl in the red coat', '主语'], ['reads', '谓语'], ['a useful book', '宾语']], '主语内部有后置定语，宾语内部有前置定语；两个名词短语仍各算一块。'),
      example('The book on the desk is mine.', '桌上的那本书是我的。', [['The book on the desk', '主语'], ['is', '系动词'], ['mine', '表语']], '不要因为看见介词短语就一律标成状语。'),
    ],
    pitfall: ['I bought a bag red.', 'I bought a red bag.', '普通形容词 red 通常在被修饰的名词 bag 前。'],
    questions: [
      question('whole-subject', 'The boy with glasses likes music. 的完整主语是哪一部分？', ['The boy with glasses', 'with glasses', 'music'], 0, 'with glasses 修饰 boy，整个名词短语一起作主语。'),
      question('modifier', 'The keys on the table are mine. 中 on the table 修饰谁？', ['keys', 'are', 'mine'], 0, '它说明哪一串钥匙，是名词短语内部的后置修饰。'),
    ],
  },
  {
    id: 'negatives-questions', name: '否定句与疑问句', subtitle: 'do · be · can', symbol: '助动词 + 主语 + 动词原形',
    summary: '先检查谓语里有没有 be、情态动词或助动词。已有的拿到前面；一般现在时或过去时的普通实义动词常需要 do / does / did 帮忙。',
    rules: [
      ['实义动词用 do 帮忙', 'She reads books. → She does not read books. → Does she read books? does 已标记时态与人称，read 回到原形。'],
      ['be 直接变', 'She is ready. → She is not ready. → Is she ready? 不加 does。'],
      ['情态动词直接变', 'He can swim. → He cannot swim. → Can he swim? can 后用原形 swim。'],
      ['特殊疑问词放前面', 'Where does she read? 仍保留助动词倒装。Who reads this book? 中 who 本身作主语，一般不再加 does。'],
    ],
    examples: [
      example('Does she read books every day?', '她每天读书吗？', [['Does', '助动词'], ['she', '主语'], ['read', '谓语'], ['books', '宾语'], ['every day', '时间状语']], '疑问句不沿用陈述句的表面词序，但核心成分仍在。'),
      example('She does not read books at night.', '她晚上不读书。', [['She', '主语'], ['does not read', '谓语'], ['books', '宾语'], ['at night', '时间状语']], 'does not read 是完整谓语的一部分。'),
    ],
    pitfall: ['Does she reads books?', 'Does she read books?', 'does 后不要再给 read 加第三人称单数 -s。'],
    questions: [
      question('do-base', '把 She likes tea. 变成一般疑问句。', ['Does she like tea?', 'Does she likes tea?', 'Is she like tea?'], 0, '用 does 提问，实义动词 like 恢复原形。'),
      question('be', '把 He is tired. 变成否定句。', ['He is not tired.', 'He does not is tired.', 'He not tired.'], 0, '谓语已有 be，直接在 is 后加 not。'),
    ],
  },
  {
    id: 'tense-aspect', name: '谓语不止一个词', subtitle: '时态 · 进行 · 完成', symbol: '助动词 + 主要动词',
    summary: '句型描述成分关系，时态描述时间与观察角度。is reading、has read 都是一整块谓语，不因为有 be 就自动成为主系表。',
    rules: [
      ['习惯与正在发生', 'I read every day. 表示习惯；I am reading now. 表示当前进行。be + -ing 一起构成谓语。'],
      ['过去与当前关联', 'I read the book yesterday. 说过去事件；I have read the book. 强调已经读过这一结果或经历与现在有关。'],
      ['看主要动词需要什么', 'She is reading a book. 的主要动词 read 仍有宾语；She is happy. 中 happy 是表语。'],
      ['从句型学习过渡到时态', '先确定要表达的是动作还是状态，再根据时间信息和语境选择形式；不能只看 yesterday 或 now 就忽视主谓一致与不规则变化。'],
    ],
    examples: [
      example('She is reading a book now.', '她现在正在读一本书。', [['She', '主语'], ['is reading', '谓语'], ['a book', '宾语'], ['now', '时间状语']], 'is reading 整体作谓语；句型仍是主谓宾。'),
      example('I have finished my homework.', '我已经完成了作业。', [['I', '主语'], ['have finished', '谓语'], ['my homework', '宾语']], 'have finished 不是两个独立谓语。'),
    ],
    pitfall: ['She is read a book now.', 'She is reading a book now.', '要表达“正在读”，使用 be + 动词 -ing。'],
    questions: [
      question('predicate', 'She has finished her work. 的完整谓语是什么？', ['has finished', 'has', 'her work'], 0, '助动词 has 和主要动词 finished 一起构成完整谓语。'),
      question('progressive', 'She is reading a book. 属于哪种基本骨架？', ['主谓宾', '主系表', '主谓双宾'], 0, 'is reading 是进行时谓语，a book 是 read 的宾语。'),
    ],
  },
  {
    id: 'clauses', name: '把两层信息接起来', subtitle: '原因 · 条件 · 定语从句', symbol: '主句 + 从句',
    summary: '从句有自己的主语和谓语。先识别每一层结构，再判断从句是在说明原因、时间、条件，还是修饰一个名词。',
    rules: [
      ['原因、时间与条件', 'because she was tired 说明原因；when I arrived 说明时间；if it rains 说明条件。它们不是孤零零的单词，而是一层完整小结构。'],
      ['定语从句跟着名词', 'The book that you lent me is useful. 中 that you lent me 修饰 book，主句谓语是 is，不是 lent。'],
      ['宾语也可以是一层句子', 'I know that she likes music. 中 that she likes music 整体是 know 的宾语。'],
      ['连词不要重复堆叠', 'Because she was tired, she went home. 普通英语不同时再加 so；Although it was raining, we went out. 不再加 but。'],
    ],
    examples: [
      example('I stayed at home because it was raining.', '因为下雨，我待在家里。', [['I', '主语'], ['stayed', '谓语'], ['at home', '地点状语'], ['because it was raining', '原因状语从句']], '从句内部 it 为主语，was raining 为谓语。'),
      example('The book that you lent me is useful.', '你借给我的那本书很有用。', [['The book that you lent me', '主语'], ['is', '系动词'], ['useful', '表语']], '先把修饰 book 的从句括起来，便能看清主句的主系表。'),
    ],
    pitfall: ['Because she was tired, so she went home.', 'Because she was tired, she went home.', '英语原因从句通常用 because 或主句用 so，避免照搬中文“因为……所以……”同时出现。'],
    questions: [
      question('main-verb', 'The student who sits near me speaks English well. 主句的谓语是哪一个？', ['speaks', 'sits', 'near'], 0, 'who sits near me 是修饰 student 的从句，主句是 The student speaks English well。'),
      question('cause', 'because it was cold 在 We stayed inside because it was cold. 中说明什么？', ['待在室内的原因', 'inside 的颜色', 'We 的身份'], 0, 'because 引导原因状语从句；从句内部也有自己的主语和谓语。'),
    ],
  },
];

export const SENTENCE_BUILDER = {
  core: [['I', '主语'], ['read', '谓语'], ['a book', '宾语']],
  slots: [
    { id: 'frequency', label: '频率', question: '多久一次？', options: ['', 'often', 'usually', 'sometimes'], role: '频率状语' },
    { id: 'manner', label: '方式', question: '怎样读？', options: ['', 'carefully', 'quietly', 'slowly'], role: '方式状语' },
    { id: 'place', label: '地点', question: '在哪里读？', options: ['', 'at home', 'in the library', 'in the park'], role: '地点状语' },
    { id: 'time', label: '时间', question: '什么时候读？', options: ['', 'in the evening', 'after dinner', 'on Sunday mornings'], role: '时间状语' },
  ],
};
