import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { findWordAtPoint, normalizeLookupWord } from '../services/wordHitTest';
import { WordLookupContext } from './wordLookupContext';
import { Modal } from './ui/Modal';
import './WordLookup.css';

const QuickWordLookup = lazy(() => import('./QuickWordLookup'));
const REQUEST_HISTORY_LIMIT = 32;
const CONTEXT_LIMIT = 2000;
const contextText = (value) => typeof value === 'string' ? value.slice(0, CONTEXT_LIMIT).trim() : '';

function visibleLookupContext(hit, scope) {
  const paragraph = hit.element.closest?.('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, th, dd, dt, [data-word-lookup="text"]');
  const container = paragraph && (!scope || scope.contains(paragraph)) ? paragraph : hit.element;
  const parts = [];
  let length = 0;
  let hitOffset = -1;
  let visited = 0;
  let overflow = false;
  const walk = (node) => {
    if (overflow || ++visited > 128) { overflow = true; return; }
    if (node.nodeType === 3) {
      const text = node.data || '';
      if (node === hit.textNode) hitOffset = length + hit.start;
      length += text.length;
      if (length > CONTEXT_LIMIT * 3) { overflow = true; return; }
      parts.push(text);
      return;
    }
    if (node.nodeType !== 1) return;
    const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
    if (node.hasAttribute?.('hidden') || node.hasAttribute?.('inert') || node.inert
      || node.getAttribute?.('aria-hidden') === 'true' || node.getAttribute?.('data-word-lookup') === 'off'
      || /(?:^|\s)sr-only(?:\s|$)/.test(node.getAttribute?.('class') || '')
      || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName)
      || style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse'
      || style?.contentVisibility === 'hidden' || style?.opacity === '0') return;
    for (const child of node.childNodes || []) walk(child);
  };
  walk(container);
  const text = overflow || hitOffset < 0 ? hit.textNode.data : parts.join('');
  const offset = overflow || hitOffset < 0 ? hit.start : hitOffset;
  const start = Math.max(0, Math.min(offset - 600, text.length - CONTEXT_LIMIT));
  const context = text.slice(start, start + CONTEXT_LIMIT).replace(/\s+/g, ' ').trim();
  const onlyWord = context.replace(/^[^\p{Script=Latin}\p{Mark}]+|[^\p{Script=Latin}\p{Mark}]+$/gu, '');
  return normalizeLookupWord(onlyWord).toLowerCase() === hit.word.toLowerCase() ? '' : context;
}

export default function WordLookupProvider({ children, onOpenDictionary }) {
  const scopeRef = useRef(null);
  const pointerRef = useRef(null);
  const movedRef = useRef(false);
  const suppressedRef = useRef(false);
  const sequenceRef = useRef(0);
  const requestHistoryRef = useRef(new Map());
  const historyPrefixRef = useRef('');
  const closingRef = useRef(false);
  const afterCloseRef = useRef(null);
  const [lookup, setLookup] = useState(() => {
    const overlay = typeof window !== 'undefined' ? window.history?.state?.lingoflowWordLookup : null;
    const word = normalizeLookupWord(overlay?.word);
    return word ? { word, context: contextText(overlay.context), contextCn: contextText(overlay.contextCn), token: 0 } : null;
  });

  const openWordLookup = useCallback((request) => {
    const word = normalizeLookupWord(request?.word);
    if (!word || suppressedRef.current || closingRef.current) return false;
    request.onBeforeLookup?.({ word, context: request.context });
    const token = ++sequenceRef.current;
    if (!historyPrefixRef.current) historyPrefixRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const historyToken = `${historyPrefixRef.current}:${token}`;
    const restored = { ...request, word, context: contextText(request.context), contextCn: contextText(request.contextCn), token };
    const previousToken = window.history.state?.lingoflowWordLookup?.token;
    if (previousToken) requestHistoryRef.current.delete(previousToken);
    requestHistoryRef.current.set(historyToken, restored);
    while (requestHistoryRef.current.size > REQUEST_HISTORY_LIMIT) requestHistoryRef.current.delete(requestHistoryRef.current.keys().next().value);
    const method = window.history.state?.lingoflowWordLookup ? 'replaceState' : 'pushState';
    window.history[method]({ ...window.history.state, lingoflowWordLookup: { word, context: restored.context, contextCn: restored.contextCn, token: historyToken } }, '', window.location.href);
    setLookup(restored);
    return true;
  }, []);
  const close = useCallback((afterClose) => {
    if (closingRef.current) return;
    setLookup(null);
    if (window.history.state?.lingoflowWordLookup) {
      afterCloseRef.current = typeof afterClose === 'function' ? afterClose : null;
      closingRef.current = true;
      window.history.back();
    } else if (typeof afterClose === 'function') afterClose();
  }, []);

  useEffect(() => {
    const onHistory = () => {
      const overlay = window.history.state?.lingoflowWordLookup;
      const word = normalizeLookupWord(overlay?.word);
      const stored = requestHistoryRef.current.get(overlay?.token);
      setLookup(word ? { ...(stored?.word === word ? stored : {}), word, context: contextText(overlay.context), contextCn: contextText(overlay.contextCn), token: ++sequenceRef.current } : null);
      closingRef.current = false;
      const action = afterCloseRef.current;
      afterCloseRef.current = null;
      action?.();
    };
    window.addEventListener('popstate', onHistory);
    return () => window.removeEventListener('popstate', onHistory);
  }, []);

  function captureClick(event) {
    const selecting = typeof window !== 'undefined' && !window.getSelection()?.isCollapsed && Boolean(window.getSelection()?.toString().trim());
    suppressedRef.current = event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.detail > 1 || (event.detail > 0 && movedRef.current) || selecting;
    pointerRef.current = null;
    if (suppressedRef.current || event.detail === 0) return;
    const hit = findWordAtPoint(event.nativeEvent, { root: scopeRef.current });
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    openWordLookup({ word: hit.word, context: visibleLookupContext(hit, scopeRef.current) });
  }

  function pointerDown(event) {
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, type: event.pointerType };
    movedRef.current = false;
  }
  function pointerMove(event) {
    const start = pointerRef.current;
    if (start && start.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) movedRef.current = true;
  }

  return (
    <WordLookupContext.Provider value={{ openWordLookup }}>
      <div
        ref={scopeRef}
        className="word-lookup-scope"
        onClickCapture={captureClick}
        onPointerDownCapture={pointerDown}
        onPointerMoveCapture={pointerMove}
        onPointerUpCapture={pointerMove}
        onPointerCancelCapture={() => { movedRef.current = true; pointerRef.current = null; }}
        onScrollCapture={() => { if (['touch', 'pen'].includes(pointerRef.current?.type)) movedRef.current = true; }}
      >
        {children}
        {lookup && (
          <div data-word-lookup="off">
            <Modal open onClose={() => close()} title={lookup.word} placement="bottom" size="md" className="quick-word-sheet" bodyClassName="quick-word-body">
              <Suspense fallback={<output className="quick-word-loading"><Loader2 size={20} className="animate-spin" /><span>正在查词…</span></output>}>
                <QuickWordLookup
                  request={lookup}
                  onOpenDictionary={(word) => close(() => onOpenDictionary?.(word))}
                  onExplore={() => close(() => lookup.onExplore?.())}
                />
              </Suspense>
            </Modal>
          </div>
        )}
      </div>
    </WordLookupContext.Provider>
  );
}
