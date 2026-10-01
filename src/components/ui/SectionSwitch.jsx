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
    <div className="section-switch" role="tablist" aria-label={ariaLabel}>
      {items.map(({ value: itemValue, label, icon: Icon }) => (
        <button
          key={itemValue}
          type="button"
          role="tab"
          aria-selected={value === itemValue}
          onClick={() => onChange(itemValue)}
          className="section-switch-tab"
        >
          {Icon && <Icon className="h-3.5 w-3.5" />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export default SectionSwitch;
