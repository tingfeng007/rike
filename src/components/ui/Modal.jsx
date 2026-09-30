import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

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
  description,
  children,
  footer,
  placement = 'center',
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

  useEffect(() => {
    if (!open) return undefined;

    restoreFocusRef.current = typeof document !== 'undefined' ? document.activeElement : null;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    // Keep the page behind the dialog from scrolling while it is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog so keyboard/screen-reader users land inside it.
    const focusTarget = panelRef.current?.querySelector('[data-autofocus]') || panelRef.current;
    focusTarget?.focus?.({ preventScroll: true });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-xs', md: 'max-w-md', lg: 'max-w-2xl' };
  const isBottom = placement === 'bottom';

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
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={[
          'relative z-10 flex w-full flex-col shadow-2xl outline-none',
          panelClassName,
          widths[size] || widths.md,
          isBottom ? 'rounded-t-3xl' : 'rounded-3xl',
          className,
        ].join(' ')}
        style={{
          maxHeight: isBottom ? 'min(88dvh, 720px)' : 'min(86dvh, 680px)',
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
