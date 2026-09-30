import React from 'react';

/**
 * 顶部分段切换器（用于「词法」页在「生词」与「语法」两个板块之间切换）。
 *
 * 样式与 StudyHeader 内部既有的标签行保持一致，切换时只有内容区变化，标题与状态随板块更新。
 *
 * @param {{ items: Array<{ value: string, label: string, icon?: React.ComponentType }>, value: string, onChange: (value: string) => void, ariaLabel?: string }} props
 */
export function SectionSwitch({ items, value, onChange, ariaLabel = '板块切换' }) {
  return (
    <div className="flex rounded-xl bg-white/10 p-1 text-[11px] ring-1 ring-white/10" role="tablist" aria-label={ariaLabel}>
      {items.map(({ value: itemValue, label, icon: Icon }) => (
        <button
          key={itemValue}
          type="button"
          role="tab"
          aria-selected={value === itemValue}
          onClick={() => onChange(itemValue)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 transition-all ${
            value === itemValue ? 'bg-white font-semibold text-[#102a43] shadow-xs' : 'text-slate-300 hover:text-white'
          }`}
        >
          {Icon && <Icon className="h-3.5 w-3.5" />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export default SectionSwitch;
