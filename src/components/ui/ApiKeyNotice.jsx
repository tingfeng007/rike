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
        <p className={isCard ? 'text-xs font-bold' : 'text-[11px] font-semibold'}>
          AI 功能需要先配置 API Key
        </p>
        <p className={`mt-0.5 leading-relaxed text-amber-800 ${isCard ? 'text-[11px]' : 'text-[10.5px]'}`}>
          AI 口语、深度讲解和 AI 测验需要联网及 Key；基础查词、词卡、笔记和语法课程可直接使用。下载词库及课程离线包后，也能离线查词和学课文。
        </p>
      </div>
      {typeof onOpenSettings === 'function' && (
        <button
          type="button"
          onClick={onOpenSettings}
          className={`flex-none rounded-xl bg-amber-500 px-2.5 py-1.5 font-bold text-white transition-colors hover:bg-amber-600 ${isCard ? 'text-[11px]' : 'text-[10.5px]'}`}
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
