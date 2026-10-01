import React from 'react';

export default function StudyHeader({ eyebrow, title, description, icon, status, actions, children }) {
  return (
    <header className="study-hero flex-none px-4 pt-[max(env(safe-area-inset-top,0px),14px)] pb-3 z-20">
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="study-eyebrow">{eyebrow}</p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
            {icon && <span className="study-header-icon">{icon}</span>}
            <h1 className="study-header-title">{title}</h1>
            {status && <span className="study-header-status">{status}</span>}
          </div>
          {description && <p className="study-header-description">{description}</p>}
        </div>
        {actions && <div className="study-header-actions flex flex-none items-center gap-1.5 pt-0.5">{actions}</div>}
      </div>
      {children && <div className="study-header-controls relative mt-3 border-t border-slate-100 pt-3">{children}</div>}
    </header>
  );
}
