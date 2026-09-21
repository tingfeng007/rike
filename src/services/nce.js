const STOP_WORDS = new Set([
  'a', 'an', 'the', 'am', 'is', 'are', 'was', 'were', 'i', 'you', 'he', 'she', 'it',
  'we', 'they', 'this', 'that', 'to', 'of', 'in', 'on', 'at', 'and', 'or', 'but', 'for',
  'my', 'your', 'his', 'her', 'me', 'please', 'yes', 'no',
]);

export function parseLrc(text) {
  return String(text || '').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (!match) return [];
    const time = Number(match[1]) * 60 + Number(match[2]);
    const [en, zh = ''] = match[3].split('|').map((part) => part.trim());
    return en ? [{ id: `${time}-${en}`, time, en, zh }] : [];
  });
}

export function safeAssetName(name) {
  return encodeURIComponent(name);
}

function stableShuffle(values, seedText) {
  const result = [...values];
  let seed = Array.from(seedText).reduce((sum, char) => sum + char.charCodeAt(0), 0) || 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    seed = (seed * 9301 + 49297) % 233280;
    const swapIndex = Math.floor((seed / 233280) * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function isCourseMetadata(line) {
  return /^Lesson\s+\d+/i.test(line.en) || /^Listen to the tape/i.test(line.en);
}

function normalizeLearningWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function wordDistance(targetWords, attemptWords) {
  const previous = Array.from({ length: attemptWords.length + 1 }, (_, index) => index);
  targetWords.forEach((targetWord, targetIndex) => {
    const current = [targetIndex + 1];
    attemptWords.forEach((attemptWord, attemptIndex) => {
      const replaceCost = targetWord === attemptWord ? 0 : 1;
      current.push(Math.min(
        current[attemptIndex] + 1,
        previous[attemptIndex + 1] + 1,
        previous[attemptIndex] + replaceCost,
      ));
    });
    previous.splice(0, previous.length, ...current);
  });
  return previous.at(-1) || 0;
}

function subtractWordCounts(sourceWords, comparisonWords) {
  const counts = new Map();
  comparisonWords.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  return sourceWords.filter((word) => {
    const count = counts.get(word) || 0;
    if (count === 0) return true;
    counts.set(word, count - 1);
    return false;
  });
}

export function scoreDictation(target, attempt) {
  const targetWords = normalizeLearningWords(target);
  const attemptWords = normalizeLearningWords(attempt);
  const longestLength = Math.max(targetWords.length, attemptWords.length, 1);
  const distance = wordDistance(targetWords, attemptWords);
  const score = Math.max(0, Math.round((1 - distance / longestLength) * 100));

  return {
    score,
    isPerfect: score === 100,
    targetWords,
    attemptWords,
    missingWords: subtractWordCounts(targetWords, attemptWords),
    extraWords: subtractWordCounts(attemptWords, targetWords),
  };
}

export function buildDictationItems(lines, limit = 8) {
  return lines
    .map((line, lineIndex) => ({ ...line, lineIndex }))
    .filter((line) => !isCourseMetadata(line) && normalizeLearningWords(line.en).length >= 2)
    .slice(0, limit)
    .map((line) => ({
      id: `${line.id}-dictation`,
      lineId: line.id,
      lineIndex: line.lineIndex,
      time: line.time,
      text: line.en,
      zh: line.zh || '',
    }));
}

export function buildExercises(lines, limit = 5) {
  const usable = lines
    .filter((line) => !isCourseMetadata(line) && line.en.split(/\s+/).length >= 4)
    .slice(0, limit);
  return usable.map((line, index) => {
    const words = line.en.replace(/[^A-Za-z' ]/g, '').split(/\s+/).filter(Boolean);
    const candidateWords = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()));
    const answer = candidateWords[0] || words[Math.min(1, words.length - 1)];
    const masked = line.en.replace(new RegExp(`\\b${answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), '_____');
    const distractors = words.filter((word) => word.toLowerCase() !== answer.toLowerCase());
    const options = stableShuffle(
      Array.from(new Set([answer, distractors[0], distractors.at(-1), 'please'].filter(Boolean))).slice(0, 4),
      line.id,
    );
    return {
      id: `${line.id}-exercise`,
      type: index % 2 === 0 ? 'choice' : 'fill',
      prompt: index % 2 === 0 ? '选择句中缺少的单词' : '填写句子中的缺词',
      sentence: masked,
      answer: answer.toLowerCase(),
      options,
      zh: line.zh || '先听懂句子，再尝试复述。',
    };
  });
}

export function extractWords(lines) {
  const map = new Map();
  lines.forEach((line) => {
    if (isCourseMetadata(line)) return;
    const words = line.en.match(/[A-Za-z][A-Za-z'-]*/g) || [];
    words.forEach((raw) => {
      const word = raw.toLowerCase();
      if (word.length < 3 || STOP_WORDS.has(word)) return;
      const item = map.get(word) || {
        word,
        count: 0,
        sentence: line.en,
        sentenceCn: line.zh || '',
      };
      item.count += 1;
      map.set(word, item);
    });
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}
