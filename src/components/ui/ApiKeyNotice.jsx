import React from 'react';
import { KeyRound, ArrowRight } from 'lucide-react';

/**
 * One consistent "AI needs an API key" notice.
 *
 * Before this, the four modules each invented their own handling and copy: the oral coach
 * blocked with a quick-config dialog, settings showed an inline hint, the reader alerted or
 * silently degraded to an error card, and the vocabulary page alerted — and one of them even
 * blamed the network for a missing key (see docs/FUNCTIONALITY_UX_SWEEP.md, Q-02/Q-03).
 *
 * @param {{ onOpenSettings?: () => void, variant?: 'card'|'inline', className?: string }} props
 */
export function ApiKeyNotice({ onOpenSettings, variant = 'card', className = '' }) {
  const isCard = variant === 'card';

  return (
    <div
      role="note"
      className={[
        'flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900',
        isCard ? 'p-3.5' : 'px-3 py-2',
        className,
      ].join(' ')}
    >
      <KeyRound className={`${isCard ? 'h-4 w-4' : 'h-3.5 w-3.5'} mt-0.5 flex-none text-amber-600`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          连接 AI 后使用
        </p>
      </div>
      {typeof onOpenSettings === 'function' && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex-none rounded-xl bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
        >
          <span className="inline-flex items-center gap-1">
            去设置
            <ArrowRight className="h-3 w-3" />
          </span>
        </button>
      )}
    </div>
  );
}

export default ApiKeyNotice;
