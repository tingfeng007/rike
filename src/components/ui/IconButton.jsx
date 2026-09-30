import React from 'react';

/**
 * Icon-only button with a guaranteed touch target.
 *
 * The sweep found icon buttons ranging from 20px to 26px across modules (O-17, R-20, R-21,
 * V-19): the icon is 12-16px and the padding gives it ~26px, which is well under the 44px
 * minimum and made taps miss (tapping a word instead of the sentence action costs an AI call).
 *
 * The visual box is left untouched — a `::before` pseudo-element expands only the *hit area*
 * to 44x44, so dense rows keep their layout while touch accuracy improves.
 *
 * `label` is required and becomes both `aria-label` and the tooltip.
 */
export function IconButton({
  label,
  children,
  onClick,
  tone = 'neutral',
  disabled = false,
  className = '',
  type = 'button',
  ...rest
}) {
  const tones = {
    neutral: 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
    sky: 'text-sky-600 hover:bg-sky-50 hover:text-sky-700',
    amber: 'text-amber-600 hover:bg-amber-50 hover:text-amber-700',
    danger: 'text-slate-400 hover:bg-rose-50 hover:text-rose-500',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={[
        'relative inline-flex flex-none items-center justify-center rounded-lg transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        // Expands the touch target to 44x44 without changing layout.
        "before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
        tones[tone] || tones.neutral,
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}

export default IconButton;
