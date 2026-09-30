import React, {
  useCallback, useMemo, useRef, useState,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { ToastContext } from './toastContext';

/**
 * Lightweight toast system, replacing `window.alert`.
 *
 * `alert()` blocks the whole UI, cannot be styled, is dismissed by a blocking OK button, and
 * on mobile shows the browser chrome with the page URL. It was used for 23 messages across the
 * app (sweep finding D-25).
 *
 * Use `useToast()` from `./toastContext` to raise one.
 */

const TONES = {
  info: {
    icon: Info,
    className: 'border-slate-200 bg-white text-slate-800',
    iconClass: 'text-sky-600',
  },
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    iconClass: 'text-emerald-600',
  },
  error: {
    icon: AlertTriangle,
    className: 'border-rose-200 bg-rose-50 text-rose-900',
    iconClass: 'text-rose-600',
  },
};

let toastSeq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((message, { tone = 'info', duration } = {}) => {
    const text = String(message ?? '').trim();
    if (!text) return '';
    toastSeq += 1;
    const id = `toast_${Date.now()}_${toastSeq}`;
    // Errors stay a little longer: they usually carry an actionable instruction.
    const lifetime = duration ?? (tone === 'error' ? 5000 : 3200);

    setToasts((list) => [...list.slice(-2), { id, message: text, tone }]);
    if (lifetime > 0) {
      timersRef.current.set(id, setTimeout(() => dismiss(id), lifetime));
    }
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({
    push,
    info: (message, options) => push(message, { ...options, tone: 'info' }),
    success: (message, options) => push(message, { ...options, tone: 'success' }),
    error: (message, options) => push(message, { ...options, tone: 'error' }),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* <output> is the semantically correct live region for status messages. */}
      <output
        aria-label="操作提示"
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3"
        style={{ paddingTop: 'max(0.75rem, var(--safe-area-inset-top, 0px))' }}
      >
        {toasts.map((toast) => {
          const tone = TONES[toast.tone] || TONES.info;
          const Icon = tone.icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-2xl border px-3 py-2.5 text-[11.5px] leading-5 shadow-lg ${tone.className}`}
            >
              <Icon className={`mt-0.5 h-3.5 w-3.5 flex-none ${tone.iconClass}`} />
              <p className="min-w-0 flex-1 break-words">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="关闭提示"
                className="relative -mr-1 flex-none rounded-md p-1 opacity-60 transition-opacity hover:opacity-100 before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </output>
    </ToastContext.Provider>
  );
}

export default ToastProvider;
