import { createContext, useContext } from 'react';

/**
 * Toast context + hook.
 *
 * Kept separate from `Toast.jsx` so that file only exports components (React Fast Refresh
 * requires that). `useToast()` never throws when the provider is missing: it falls back to
 * `alert` so a message can never vanish silently because a tree was not wrapped.
 */
export const ToastContext = createContext(null);

const FALLBACK = {
  push: (message) => {
    if (typeof window !== 'undefined' && window.alert) window.alert(String(message ?? ''));
    return '';
  },
  info(message) { return FALLBACK.push(message); },
  success(message) { return FALLBACK.push(message); },
  error(message) { return FALLBACK.push(message); },
  dismiss() {},
};

export function useToast() {
  return useContext(ToastContext) || FALLBACK;
}
