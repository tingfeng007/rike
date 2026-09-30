/**
 * 文本处理小工具。
 *
 * 背景：项目里同一段"转义正则元字符"的代码被重复实现了三处
 * （`nce.js:113`、`nceExam.js:59`、`SmartReader.jsx:300`），而另外两处该转义的地方
 * 忘了转义（`OralCoach.jsx:163`、`SmartReader.jsx:504`），后果分别是
 * "用户输入被静默吞掉"和"查词取到错误语境"。这里收敛成唯一实现。
 */

/**
 * 转义字符串中的正则元字符，使其可以安全地拼进 `new RegExp(...)`。
 * @param {unknown} value
 * @returns {string}
 */
export function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判断 `text` 中是否出现了 `term`（忽略大小写）。
 *
 * - 元字符一律转义，因此 `C++`、`(e.g.`、整句等输入既不会抛错也不会误匹配
 *   （未转义的 `\be.g\b` 会匹配 "egg"）。
 * - 只在词元本身以「词字符」开头/结尾时才要求词边界，否则像 `C++` 这种以符号结尾的
 *   词元永远匹配不上（`\bC\+\+\b` 在 "C++ " 上无法成立）。
 *
 * @param {string} text
 * @param {string} term
 * @returns {boolean}
 */
export function containsTerm(text, term) {
  const needle = String(term ?? '').trim();
  if (!needle) return false;
  const haystack = String(text ?? '');
  const pattern = `${/^\w/.test(needle) ? '\\b' : ''}${escapeRegExp(needle)}${/\w$/.test(needle) ? '\\b' : ''}`;
  try {
    return new RegExp(pattern, 'i').test(haystack);
  } catch {
    // 兜底：正则极端情况下失败时退化为子串匹配，绝不向上抛错。
    return haystack.toLowerCase().includes(needle.toLowerCase());
  }
}
