const LATIN_LETTER = String.raw`\p{Script=Latin}`;
const WORD_PART = `[${LATIN_LETTER}][${LATIN_LETTER}\\p{Mark}]*`;
const WORD_SOURCE = `${WORD_PART}(?:['’\\-‐‑]${WORD_PART})*`;
const WHOLE_WORD = new RegExp(`^(?:${WORD_SOURCE})$`, 'u');
const TOKEN_NEIGHBOR = /[\p{Script=Latin}\p{Mark}\p{Number}_]/u;
const HARD_CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'OPTGROUP']);
const CONTROL_TAGS = new Set(['A', 'BUTTON', 'NAV', 'LABEL', 'SUMMARY']);
const CONTROL_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
  'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'checkbox', 'radio', 'radiogroup', 'slider', 'spinbutton', 'switch',
  'tab', 'tablist', 'tree', 'treeitem', 'scrollbar', 'navigation',
]);

/** A complete lookup word, never an extracted substring or a sentence. */
export function normalizeLookupWord(raw) {
  if (typeof raw !== 'string') return '';
  const word = raw.trim();
  if (!WHOLE_WORD.test(word)) return '';
  return word.replace(/’/g, "'").replace(/[‐‑]/g, '-');
}

/** Caret APIs round to a character boundary; the caller must still test its rect. */
export function englishWordAtOffset(text, offset) {
  if (typeof text !== 'string' || !Number.isInteger(offset) || offset < 0 || offset > text.length) return null;
  const tokens = new RegExp(WORD_SOURCE, 'gu');
  for (const match of text.matchAll(tokens)) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset < start) return null;
    if (offset > end) continue;
    // Do not turn identifiers or partially supported spellings into another word.
    if (TOKEN_NEIGHBOR.test(text[start - 1] || '') || TOKEN_NEIGHBOR.test(text[end] || '')) return null;
    return { word: normalizeLookupWord(match[0]), start, end };
  }
  return null;
}

function elementFor(node) {
  return node?.nodeType === 1 ? node : node?.parentElement || null;
}

function parentElement(element) {
  return element.parentElement || element.getRootNode?.().host || null;
}

function isHardExcluded(element) {
  const editable = element.getAttribute?.('contenteditable');
  return HARD_CONTROL_TAGS.has(element.tagName?.toUpperCase())
    || element.isContentEditable === true
    || (editable !== null && editable !== undefined && editable.toLowerCase() !== 'false')
    || element.inert === true
    || element.hasAttribute?.('inert')
    || element.hasAttribute?.('hidden')
    || element.getAttribute?.('aria-hidden') === 'true'
    || element.getAttribute?.('data-word-lookup') === 'off';
}

function isExcluded(element, document, { onlyHard = false } = {}) {
  let allowOuterButton = false;
  for (let current = element; current; current = parentElement(current)) {
    if (isHardExcluded(current)) return true;
    const style = document.defaultView?.getComputedStyle?.(current);
    if (style && (style.display === 'none' || style.visibility === 'hidden'
      || style.visibility === 'collapse' || style.contentVisibility === 'hidden'
      || style.opacity === '0')) return true;
    if (onlyHard) continue;

    const tag = current.tagName?.toUpperCase();
    const roles = (current.getAttribute?.('role') || '').toLowerCase().split(/\s+/);
    const isControl = CONTROL_TAGS.has(tag) || roles.some((role) => CONTROL_ROLES.has(role));
    if (isControl) {
      // Explicit lesson text inside a larger lesson button remains readable.
      const buttonOnly = (tag === 'BUTTON' || roles.includes('button'))
        && tag !== 'A' && tag !== 'NAV' && tag !== 'LABEL' && tag !== 'SUMMARY'
        && roles.every((role) => !CONTROL_ROLES.has(role) || role === 'button');
      if (!(allowOuterButton && buttonOnly)) return true;
    }

    const lookupMode = current.getAttribute?.('data-word-lookup');
    if (!isControl && (lookupMode === 'text' || lookupMode === 'word')) allowOuterButton = true;
  }
  return false;
}

function containsNode(root, node) {
  return !root || root === node || root.contains?.(node) === true;
}

function caretCandidates(document, x, y) {
  const positions = [];
  try {
    const position = document.caretPositionFromPoint?.(x, y);
    if (position) positions.push({ node: position.offsetNode, offset: position.offset });
  } catch {
    // Some engines expose the API but cannot resolve this target.
  }
  try {
    const range = document.caretRangeFromPoint?.(x, y);
    if (range) positions.push({ node: range.startContainer, offset: range.startOffset });
  } catch {
    // The other browser API, or no valid caret, is enough.
  }
  return positions;
}

function wordAttribute(element) {
  for (let current = element; current; current = parentElement(current)) {
    if (current.hasAttribute?.('data-word')) return current.getAttribute('data-word');
  }
  return null;
}

function rectangleAtPoint(range, x, y) {
  const rects = range.getClientRects();
  for (const rect of rects) {
    if (rect.right > rect.left && rect.bottom > rect.top
      && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) {
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.right - rect.left, height: rect.bottom - rect.top };
    }
  }
  return null;
}

/**
 * Find the single visible word actually under a click. This does not alter DOM,
 * selection, event propagation, or focus. Controls can opt in only their text
 * descendants; data-word-lookup="off" always takes precedence.
 */
export function findWordAtPoint(event, { document = event?.target?.ownerDocument, root } = {}) {
  const x = event?.clientX;
  const y = event?.clientY;
  if (!document || !Number.isFinite(x) || !Number.isFinite(y)
    || (event.button !== undefined && event.button !== 0)) return null;

  const target = elementFor(event.target);
  if (!target || !containsNode(root, event.target) || isExcluded(target, document, { onlyHard: true })) return null;

  for (const { node, offset } of caretCandidates(document, x, y)) {
    if (node?.nodeType !== 3 || !containsNode(root, node)) continue;
    const element = elementFor(node);
    if (!element || isExcluded(element, document)) continue;
    // A caret must refer to the clicked surface, not text behind another control.
    if (!target.contains?.(node) && !element.contains?.(target)) continue;
    const hit = englishWordAtOffset(node.data ?? node.textContent, offset);
    if (!hit) continue;

    const explicitWord = wordAttribute(element);
    if (explicitWord !== null && (!normalizeLookupWord(explicitWord)
      || normalizeLookupWord(explicitWord).toLowerCase() !== hit.word.toLowerCase())) continue;

    let range;
    try {
      range = document.createRange();
      range.setStart(node, hit.start);
      range.setEnd(node, hit.end);
      const rect = rectangleAtPoint(range, x, y);
      if (rect) return { ...hit, rect, textNode: node, element };
    } catch {
      // An unmounted node or a browser without text geometry is not a word hit.
    } finally {
      range?.detach?.();
    }
  }
  return null;
}
