import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const backgroundLocks = new WeakMap();
const scrollLocks = new WeakMap();
const focusOrigins = new WeakMap();
function lockBackground(node) {
  const previous = backgroundLocks.get(node) || { count: 0, inert: node.inert };
  previous.count += 1;
  backgroundLocks.set(node, previous);
  node.inert = true;
  return () => {
    previous.count -= 1;
    if (!previous.count) { node.inert = previous.inert; backgroundLocks.delete(node); }
  };
}

function lockBodyScroll(body) {
  const previous = scrollLocks.get(body) || { count: 0, overflow: body.style.overflow };
  previous.count += 1;
  scrollLocks.set(body, previous);
  body.style.overflow = 'hidden';
  return () => {
    previous.count -= 1;
    if (!previous.count) { body.style.overflow = previous.overflow; scrollLocks.delete(body); }
  };
}

/**
 * Base dialog for the whole app.
 *
 * Before this existed every overlay was hand-rolled, which produced the same defects over and
 * over (see docs/FUNCTIONALITY_UX_SWEEP.md, §2.4-E): no `role="dialog"` / `aria-modal`,
 * no Escape handling, no focus management, a `vh` height that fights mobile browser chrome,
 * and a missing bottom safe-area inset (so buttons sat under the iPhone home indicator on
 * some sheets but not others).
 *
 * Usage:
 *   <Modal open={show} onClose={() => setShow(false)} title="…">…</Modal>
 *   <BottomSheet open={show} onClose={…} title="…">…</BottomSheet>
 *
 * ⚠️ GOTCHA — always render the caller's state-dependent children conditionally:
 *
 *   {item && <Modal open onClose={…}>{item.word}</Modal>}     ✅
 *   <Modal open={Boolean(item)} onClose={…}>{item.word}</Modal>  ❌ crashes when item is null
 *
 * React evaluates JSX children in the *parent* before this component runs, so returning null
 * here cannot stop `item.word` from being evaluated. Passing `open={Boolean(item)}` while the
 * children read `item` is what produced the "这个页面刚刚卡住了" crash on the vocabulary,
 * reader and settings pages; `test/render-smoke.test.js` now renders every page to catch it.
 */
export function Modal({
  open,
  onClose,
  title,
  ariaLabel,
  labelledBy,
  description,
  children,
  footer,
  placement = 'center',
  variant = 'dialog',
  size = 'md',
  closeOnBackdrop = true,
  showCloseButton = true,
  className = '',
  // Replaces the default panel background/border. Passing a conflicting utility through
  // `className` would depend on Tailwind's generated CSS order, which is not guaranteed.
  panelClassName = 'bg-white',
  bodyClassName = '',
}) {
  const panelRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const openedPanel = panelRef.current;
    restoreFocusRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    if (openedPanel) focusOrigins.set(openedPanel, restoreFocusRef.current);
    const unlock = [];
    let branch = panelRef.current?.parentElement;
    while (branch && branch !== document.body) {
      for (const sibling of branch.parentElement?.children || []) {
        if (sibling !== branch && !['SCRIPT', 'STYLE'].includes(sibling.tagName)) unlock.push(lockBackground(sibling));
      }
      branch = branch.parentElement;
    }
    if (!title && !labelledBy && !ariaLabel) {
      const heading = panelRef.current?.querySelector('h1, h2, h3, [role="heading"]');
      if (heading) {
        heading.id ||= `${titleId}-custom`;
        panelRef.current.setAttribute('aria-labelledby', heading.id);
        panelRef.current.removeAttribute('aria-label');
      }
    }

    const handleKeyDown = (event) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs.length && dialogs[dialogs.length - 1] !== panelRef.current) return;
      if (event.key === 'Tab') {
        const panel = panelRef.current;
        const targets = Array.from(panel?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]') || []).filter((node) => node.getClientRects().length && !node.closest('[inert], [aria-hidden="true"]'));
        const first = targets[0];
        const last = targets.at(-1);
        if (!first) { event.preventDefault(); panel?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    // Keep the page behind the dialog from scrolling while it is open.
    const unlockScroll = lockBodyScroll(document.body);

    // Move focus into the dialog so keyboard/screen-reader users land inside it.
    const focusTarget = panelRef.current?.querySelector('[data-autofocus]') || panelRef.current;
    focusTarget?.focus?.({ preventScroll: true });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unlockScroll();
      unlock.forEach((release) => release());
      const remaining = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).filter((node) => node !== openedPanel && !node.closest('[inert]'));
      const topDialog = remaining.at(-1);
      let target = restoreFocusRef.current;
      const visited = new Set();
      // A dialog beneath this one may already have closed. Follow its original trigger.
      while (target && !target.isConnected && !visited.has(target)) {
        visited.add(target);
        target = focusOrigins.get(target.closest?.('[role="dialog"]')) || null;
      }
      if (topDialog && !topDialog.contains(target)) target = topDialog;
      if (target?.isConnected && !target.closest?.('[inert]')) target.focus?.({ preventScroll: true });
    };
  }, [open, title, labelledBy, ariaLabel, titleId]);

  if (!open) return null;

  const widths = { sm: 'max-w-xs', md: 'max-w-md', lg: 'max-w-2xl' };
  const isSheet = variant === 'sheet';
  const isBottom = placement === 'bottom' || isSheet;

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center ${isBottom ? 'items-end' : 'items-center px-4'}`}
    >
      {/* The backdrop is a real button (kept out of the tab order), so dismissing by tapping
          outside is keyboard-agnostic and does not need an interactive `div`. Escape and the
          explicit close button remain the primary accessible paths. */}
      {closeOnBackdrop && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="关闭对话框"
          onClick={() => onClose?.()}
          className="absolute inset-0 h-full w-full cursor-default bg-slate-900/45 backdrop-blur-xs"
        />
      )}
      <div
        ref={panelRef}
        // Native <dialog> would satisfy jsx-a11y(prefer-tag-over-role) but requires imperative
        // showModal() and bespoke ::backdrop styling; this element provides the same semantics
        // (role, aria-modal, labelled-by, Escape, focus move + restore) without that rewrite.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || (title ? titleId : undefined)}
        aria-label={!title && !labelledBy ? ariaLabel || '对话框' : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={[
          'relative z-10 flex w-full flex-col shadow-2xl outline-none',
          panelClassName,
          isSheet ? 'max-w-2xl lg:ml-auto lg:h-full lg:max-w-2xl' : widths[size] || widths.md,
          isBottom ? `rounded-t-3xl ${isSheet ? 'lg:rounded-l-3xl lg:rounded-tr-none' : ''}` : 'rounded-3xl',
          className,
        ].join(' ')}
        style={{
          maxHeight: isSheet ? '92dvh' : isBottom ? 'min(88dvh, 720px)' : 'min(86dvh, 680px)',
          paddingBottom: isBottom ? 'max(0px, var(--safe-area-inset-bottom, 0px))' : undefined,
        }}
      >
        {(title || showCloseButton) && (
          <div className="flex flex-none items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="min-w-0">
              {title && <h2 id={titleId} className="text-sm font-bold text-slate-900">{title}</h2>}
              {description && <p id={descriptionId} className="mt-0.5 text-[11px] text-slate-500">{description}</p>}
            </div>
            {showCloseButton && (
              <button
                type="button"
                onClick={() => onClose?.()}
                aria-label="关闭"
                className="relative -mr-1 flex-none rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        <div className={`flex-1 overflow-y-auto px-4 py-4 ${bodyClassName}`}>{children}</div>

        {footer && <div className="flex-none border-t border-slate-100 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Bottom-sheet presentation of `Modal` (rounded top corners, anchored to the bottom, keeps the
 * home-indicator safe area clear). Thin preset so both share one implementation.
 */
export function BottomSheet(props) {
  return <Modal placement="bottom" {...props} />;
}
