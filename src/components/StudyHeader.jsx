import React from 'react';

export default function StudyHeader({ eyebrow, title, description, icon, status, actions, children }) {
  return (
    <header className="study-hero flex-none px-4 pt-[max(env(safe-area-inset-top,0px),14px)] pb-3 text-white z-20">
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.18em] text-amber-300">
            {icon && <span className="grid h-7 w-7 place-items-center rounded-xl bg-white/10 text-sky-200 ring-1 ring-white/10">{icon}</span>}
            <span>{eyebrow}</span>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="editorial-serif text-[24px] font-bold leading-tight tracking-tight">{title}</h1>
            {status && <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold text-sky-100 ring-1 ring-white/10">{status}</span>}
          </div>
          {description && <p className="mt-2 max-w-xl text-xs leading-6 text-slate-300">{description}</p>}
        </div>
        {actions && <div className="flex flex-none items-center gap-1.5 pt-0.5">{actions}</div>}
      </div>
      {children && <div className="relative mt-3 border-t border-white/10 pt-3">{children}</div>}
    </header>
  );
}
